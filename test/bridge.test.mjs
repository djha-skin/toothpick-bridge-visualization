import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialPopulation,
  createTopology,
  decodeGenome,
  genomeKey,
  validateBridge,
} from '../src/bridge.mjs';


test('triangular lattice members are exactly one toothpick long', () => {
  const topology = createTopology();
  assert.ok(topology.edges.length > 0);
  for (const edge of topology.edges) assert.ok(Math.abs(edge.length - 1) < 1e-9);
  assert.equal(topology.nodes[topology.supports.left.node].x, 0);
  assert.equal(topology.nodes[topology.supports.right.node].x, topology.span);
  assert.equal(topology.loadNode, topology.span / 2);
});

test('seeded initial populations are repeatable, diverse, valid, and budget-bounded', () => {
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
    assert.ok(result.stickCount <= topology.maxSticks);
    assert.equal(result.loadReachable, true);
  }
});

test('validation detects over-budget and disconnected added members', () => {
  const topology = createTopology({ maxSticks: 32 });
  const overBudget = new Uint8Array(topology.baselineGenome);
  for (let index = 0; index < topology.optionalEdges.length; index += 1) overBudget[index] = 1;
  assert.ok(validateBridge(overBudget, topology).issues.includes('over-budget'));

  const disconnected = new Uint8Array(topology.baselineGenome);
  const floatingEdgeIndex = topology.optionalEdges.findIndex(edge => {
    const a = topology.nodes[edge.a];
    const b = topology.nodes[edge.b];
    return edge.type === 'horizontal' && a.row === 2 && b.row === 2;
  });
  assert.notEqual(floatingEdgeIndex, -1);
  disconnected[floatingEdgeIndex] = 1;
  assert.ok(validateBridge(disconnected, topology).issues.includes('disconnected-members'));
});

test('genome decoder rejects a vector with the wrong length', () => {
  const topology = createTopology();
  assert.throws(() => decodeGenome(new Uint8Array(1), topology), /Expected/);
});
