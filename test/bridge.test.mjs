import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APEX_OFFSET_LIMIT,
  GENOME_LENGTH,
  MAX_APEX_HEIGHT,
  MIN_APEX_HEIGHT,
  MAX_MEMBER_LENGTH,
  createInitialPopulation,
  createTopology,
  decodeGenome,
  genomeKey,
  validateBridge,
} from '../src/bridge.mjs';


test('topology fixes the span, supports, center load, and connected triangulated strip', () => {
  const topology = createTopology();
  const baseline = decodeGenome(topology.baselineGenome, topology);

  assert.equal(topology.span, 8);
  assert.equal(topology.bays, 10);
  assert.equal(baseline.nodes.length, 21);
  assert.equal(topology.memberTemplates.length, 39);
  assert.equal(topology.triangles.length, 19);
  assert.equal(topology.supports.left.node, 0);
  assert.equal(baseline.nodes[topology.supports.left.node].x, 0);
  assert.equal(topology.supports.right.node, 10);
  assert.equal(baseline.nodes[topology.supports.right.node].x, topology.span);
  assert.equal(topology.loadNode, 5);
  assert.equal(validateBridge(topology.baselineGenome, topology).valid, true);
});

test('genome evolves apex coordinates and triangle proportions while every side stays under one toothpick', () => {
  const topology = createTopology();
  const shortLow = new Uint16Array(GENOME_LENGTH);
  const tallOffset = new Uint16Array(GENOME_LENGTH).fill(0xffff);
  const alternating = new Uint16Array(GENOME_LENGTH);
  for (let bay = 0; bay < topology.bays; bay += 1) {
    alternating[bay * 2] = bay % 2 ? 0xffff : 0;
    alternating[bay * 2 + 1] = bay % 2 ? 0xffff : 0;
  }
  const first = decodeGenome(shortLow, topology);
  const second = decodeGenome(tallOffset, topology);
  const worstChord = decodeGenome(alternating, topology);
  const baseline = decodeGenome(topology.baselineGenome, topology);

  assert.notDeepEqual(first.nodes, second.nodes);
  assert.notDeepEqual(first.nodes.slice(topology.bays + 1), baseline.nodes.slice(topology.bays + 1));
  for (const [geometry, genome] of [
    [first, shortLow], [second, tallOffset], [worstChord, alternating], [baseline, topology.baselineGenome],
  ]) {
    const result = validateBridge(genome, topology);
    assert.equal(result.valid, true, result.issues.join(', '));
    assert.equal(result.members.length, 39);
    assert.ok(result.members.every(member => member.length > 0 && member.length < MAX_MEMBER_LENGTH));
    assert.ok(result.nodes.slice(topology.bays + 1).every(node =>
      Math.abs(node.x - (node.bay + 0.5) * 0.8) <= APEX_OFFSET_LIMIT + 1e-9
      && node.y >= MIN_APEX_HEIGHT && node.y <= MAX_APEX_HEIGHT));
  }
  assert.ok(new Set(baseline.members.map(member => member.length.toFixed(6))).size > 1);
  assert.ok(Math.max(...worstChord.members.map(member => member.length)) < 0.96);
});

test('seeded initial populations are repeatable, diverse, valid, and within the 40-segment budget', () => {
  const topology = createTopology();
  const first = createInitialPopulation(24, 'bridge-seed-42', topology);
  const replay = createInitialPopulation(24, 'bridge-seed-42', topology);
  const otherSeed = createInitialPopulation(24, 'bridge-seed-43', topology);

  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, otherSeed);
  assert.equal(new Set(first.map(genomeKey)).size, first.length);
  for (const genome of first) {
    const result = validateBridge(genome, topology);
    assert.equal(result.valid, true, result.issues.join(', '));
    assert.equal(result.stickCount, 39);
    assert.ok(result.stickCount <= topology.maxSticks);
    assert.equal(result.loadReachable, true);
  }
});

test('validation detects over-budget and disconnected member templates', () => {
  const topology = createTopology();
  const overBudget = { ...topology, maxSticks: 38 };
  assert.ok(validateBridge(topology.baselineGenome, overBudget).issues.includes('over-budget'));

  const apexZero = topology.bays + 1;
  const disconnected = {
    ...topology,
    memberTemplates: topology.memberTemplates.filter(member =>
      member.a !== apexZero && member.b !== apexZero),
  };
  assert.ok(validateBridge(topology.baselineGenome, disconnected).issues.includes('disconnected-members'));
});

test('genome decoder rejects malformed vectors and non-integer gene values', () => {
  const topology = createTopology();
  assert.throws(() => decodeGenome(new Uint16Array(1), topology), /Expected/);
  const malformed = Array.from(topology.baselineGenome);
  malformed[0] = 1.5;
  assert.throws(() => decodeGenome(malformed, topology), /integers/);
});

test('fixed support span and toothpick-budget configuration cannot drift', () => {
  assert.throws(() => createTopology({ span: 9 }), /fixed at 8/);
  assert.throws(() => createTopology({ bays: 8 }), /exactly 10/);
  assert.throws(() => createTopology({ maxSticks: 41 }), /budget/);
});
