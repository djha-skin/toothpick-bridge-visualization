import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPopulation, createTopology } from '../src/bridge.mjs';
import { evaluateBridge, solveTruss } from '../src/truss.mjs';

function triangle() {
  const nodes = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }];
  const members = [
    { id: 'base', a: 0, b: 1 },
    { id: 'left', a: 0, b: 2 },
    { id: 'right', a: 1, b: 2 },
  ];
  const topology = {
    nodes,
    edges: members,
    deckEdges: [members[0]],
    optionalEdges: members.slice(1),
    supports: {
      left: { node: 0, type: 'pin' },
      right: { node: 1, type: 'roller' },
    },
    loadNode: 2,
    maxSticks: 3,
  };
  return { nodes, members, topology, genome: new Uint8Array([1, 1]) };
}

test('simply supported triangle has expected reactions and member-force signs', () => {
  const { nodes, members } = triangle();
  const result = solveTruss({
    nodes,
    members,
    supports: [{ node: 0, x: true, y: true }, { node: 1, x: false, y: true }],
    loads: [{ node: 2, x: 0, y: -1 }],
  });

  assert.equal(result.stable, true);
  assert.ok(Math.abs(result.reactions[0].y - 0.5) < 1e-9);
  assert.ok(Math.abs(result.reactions[1].y - 0.5) < 1e-9);
  assert.ok(Math.abs(result.memberForces[0].force - 0.5) < 1e-9);
  assert.equal(result.memberForces[0].type, 'tension');
  assert.ok(Math.abs(result.memberForces[1].force + Math.SQRT1_2) < 1e-9);
  assert.equal(result.memberForces[1].type, 'compression');
  assert.equal(result.memberForces[2].type, 'compression');
});

test('tension capacity breaks the deck member at its predicted load', () => {
  const { topology, genome } = triangle();
  const result = evaluateBridge(genome, topology, {
    material: { tensileStrengthN: 0.25, compressiveStrengthN: 100 },
  });

  assert.equal(result.collapsed, true);
  assert.ok(Math.abs(result.failureLoadN - 0.5) < 1e-9);
  assert.equal(result.events[0].brokenMemberIds[0], 'base');
  assert.equal(result.events[0].memberForces.find(force => force.id === 'base').type, 'tension');
});

test('compression capacity applies the length-sensitive buckling limit', () => {
  const { topology, genome } = triangle();
  const result = evaluateBridge(genome, topology, {
    material: { tensileStrengthN: 100, compressiveStrengthN: 0.5 },
  });
  const expectedFailureLoad = (0.5 / 2) / Math.SQRT1_2;

  assert.equal(result.collapsed, true);
  assert.ok(Math.abs(result.failureLoadN - expectedFailureLoad) < 1e-9);
  assert.equal(result.events[0].brokenMemberIds[0], 'left');
  assert.equal(result.events[0].memberForces.find(force => force.id === 'left').type, 'compression');
});

test('a connected but under-braced truss fails safely as unstable', () => {
  const { topology, members } = triangle();
  const mechanism = {
    ...topology,
    edges: members.slice(0, 2),
    deckEdges: members.slice(0, 1),
    optionalEdges: [members[1]],
    maxSticks: 2,
  };
  const result = evaluateBridge(new Uint8Array([1]), mechanism);

  assert.equal(result.valid, true);
  assert.equal(result.collapsed, true);
  assert.equal(result.maxStableLoadN, 0);
  assert.equal(result.collapseReason, 'unstable-or-singular-truss');
});

test('a broken redundant member redistributes load before the next failure', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const members = [
    { id: 'bottom', a: 0, b: 1, length: 1 },
    { id: 'right', a: 1, b: 2, length: 1 },
    { id: 'top', a: 3, b: 2, length: 1 },
    { id: 'left', a: 0, b: 3, length: 1 },
    { id: 'diagAC', a: 0, b: 2, length: Math.SQRT2 },
    { id: 'diagBD', a: 1, b: 3, length: Math.SQRT2 },
  ];
  const topology = {
    nodes,
    edges: members,
    deckEdges: [members[0]],
    optionalEdges: members.slice(1),
    supports: { left: { node: 0, type: 'pin' }, right: { node: 1, type: 'roller' } },
    loadNode: 2,
    maxSticks: members.length,
  };
  const allMembers = new Uint8Array(members.length - 1).fill(1);
  const result = evaluateBridge(allMembers, topology, {
    material: { tensileStrengthN: 1, compressiveStrengthN: 20 },
  });
  const afterFirstBreak = solveTruss({
    nodes,
    members: members.filter(member => member.id !== 'bottom'),
    supports: [{ node: 0, x: true, y: true }, { node: 1, x: false, y: true }],
    loads: [{ node: 2, x: 0, y: -1 }],
  });

  assert.equal(afterFirstBreak.stable, true);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].brokenMemberIds[0], 'bottom');
  assert.equal(result.events[0].collapse, false);
  assert.ok(result.events[1].loadN > result.events[0].loadN);
  assert.equal(result.events[1].collapse, true);
});

test('seeded bridge evaluations repeat exactly', () => {
  const topology = createTopology();
  const population = createInitialPopulation(24, 'same-seed', topology);
  const first = evaluateBridge(population[2], topology);
  const replay = evaluateBridge(population[2], topology);

  assert.deepEqual(first, replay);
  assert.equal(first.collapsed, true);
  assert.ok(first.maxStableLoadN > 0);
});
