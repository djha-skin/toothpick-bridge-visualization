import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENOME_LENGTH,
  HORIZONTAL_OFFSET_LIMIT,
  MAX_MEMBER_COUNT,
  MAX_MEMBER_LENGTH,
  ROW_HEIGHT_VARIATION,
  ROW_SPACING,
  createInitialPopulation,
  createTopology,
  decodeGenome,
  genomeKey,
  validateBridge,
} from '../src/bridge.mjs';


test('topology creates two connected rows of triangles within a 500-stick fair budget', () => {
  const topology = createTopology();
  const geometry = decodeGenome(topology.baselineGenome, topology);
  const secondRowTriangles = geometry.triangles.filter(triangle =>
    triangle.some(index => geometry.nodes[index].row === 2));

  assert.equal(topology.span, 8);
  assert.equal(topology.bays, 10);
  assert.equal(topology.triangleLayers, 2);
  assert.equal(topology.maxSticks, 500);
  assert.equal(GENOME_LENGTH, 56);
  assert.equal(geometry.nodes.length, 33);
  assert.equal(topology.memberTemplates.length, 72);
  assert.equal(geometry.members.length, 72);
  assert.equal(geometry.triangles.length, 40);
  assert.equal(secondRowTriangles.length, 20);
  assert.equal(topology.supports.left.node, 0);
  assert.equal(geometry.nodes[topology.supports.left.node].x, 0);
  assert.equal(topology.supports.right.node, 10);
  assert.equal(geometry.nodes[topology.supports.right.node].x, topology.span);
  assert.equal(topology.loadNode, 5);
  assert.equal(validateBridge(topology.baselineGenome, topology).valid, true);
});

test('evolved row coordinates and diagonal choices stay triangulated with every member below one toothpick', () => {
  const topology = createTopology();
  const allLow = new Uint16Array(GENOME_LENGTH);
  const allHigh = new Uint16Array(GENOME_LENGTH).fill(0xffff);
  const alternating = new Uint16Array(GENOME_LENGTH);
  for (let index = 0; index < alternating.length; index += 1) {
    alternating[index] = index % 2 ? 0xffff : 0;
  }
  const baseline = decodeGenome(topology.baselineGenome, topology);
  const lowGeometry = decodeGenome(allLow, topology);
  const highGeometry = decodeGenome(allHigh, topology);
  const alternatingGeometry = decodeGenome(alternating, topology);

  assert.notDeepEqual(lowGeometry.nodes, highGeometry.nodes);
  assert.notDeepEqual(lowGeometry.members.filter(member => member.type === 'diagonal'),
    highGeometry.members.filter(member => member.type === 'diagonal'));
  for (const [genome, geometry] of [
    [allLow, lowGeometry], [allHigh, highGeometry], [alternating, alternatingGeometry],
    [topology.baselineGenome, baseline],
  ]) {
    const result = validateBridge(genome, topology);
    assert.equal(result.valid, true, result.issues.join(', '));
    assert.equal(result.members.length, 72);
    assert.ok(result.members.every(member => member.length > 0 && member.length < MAX_MEMBER_LENGTH));
    assert.equal(result.triangles.length, 40);
    for (const node of geometry.nodes) {
      if (node.row === 0 || node.bay === 0 || node.bay === topology.bays) continue;
      const nominalX = node.bay * topology.span / topology.bays;
      assert.ok(Math.abs(node.x - nominalX) <= HORIZONTAL_OFFSET_LIMIT + 1e-9);
      assert.ok(Math.abs(node.y - node.row * ROW_SPACING) <= ROW_HEIGHT_VARIATION + 1e-9);
    }
  }
  assert.ok(new Set(baseline.members.map(member => member.length.toFixed(6))).size > 1);
  assert.ok(Math.max(...alternatingGeometry.members.map(member => member.length)) < 0.95);
});

test('seeded initial populations are repeatable, diverse, valid, and below the 500-stick budget', () => {
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
    assert.equal(result.stickCount, 72);
    assert.ok(result.stickCount <= topology.maxSticks);
    assert.equal(result.loadReachable, true);
  }
});

test('validation detects candidates over a configured member budget', () => {
  const topology = createTopology();
  const overBudget = { ...topology, maxSticks: 71 };
  assert.ok(validateBridge(topology.baselineGenome, overBudget).issues.includes('over-budget'));
});

test('genome decoder rejects malformed vectors and non-integer gene values', () => {
  const topology = createTopology();
  assert.throws(() => decodeGenome(new Uint16Array(1), topology), /Expected/);
  const malformed = Array.from(topology.baselineGenome);
  malformed[0] = 1.5;
  assert.throws(() => decodeGenome(malformed, topology), /integers/);
});

test('fixed span, mesh resolution, and fair member budget cannot drift', () => {
  assert.throws(() => createTopology({ span: 9 }), /fixed at 8/);
  assert.throws(() => createTopology({ bays: 8 }), /exactly 10/);
  assert.throws(() => createTopology({ triangleLayers: 3 }), /exactly 2 triangle layers/);
  assert.throws(() => createTopology({ maxSticks: 71 }), /between 72 and 500/);
  assert.throws(() => createTopology({ maxSticks: MAX_MEMBER_COUNT + 1 }), /between 72 and 500/);
});
