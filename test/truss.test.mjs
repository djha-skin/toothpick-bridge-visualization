import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPopulation, createTopology, decodeGenome } from '../src/bridge.mjs';
import { evaluatePopulation } from '../src/genetics.mjs';
import { DEFAULT_MATERIAL, evaluateBridge, solveTruss } from '../src/truss.mjs';

function bridgeFixture(genome = null) {
  const topology = createTopology();
  const candidate = genome ?? topology.baselineGenome;
  const geometry = decodeGenome(candidate, topology);
  const supports = [
    { node: topology.supports.left.node, x: true, y: true },
    { node: topology.supports.right.node, x: false, y: true },
  ];
  const loads = [{ node: topology.loadNode, x: 0, y: -1 }];
  return { topology, genome: candidate, geometry, supports, loads };
}

function memberCapacities(member, material) {
  return {
    tension: material.tensileStrengthN,
    compression: material.compressiveStrengthN * (material.referenceLength / member.length) ** 2,
  };
}

function firstFailureThreshold(geometry, topology, material) {
  const solution = solveTruss({
    nodes: geometry.nodes,
    members: geometry.members,
    supports: [
      { node: topology.supports.left.node, x: true, y: true },
      { node: topology.supports.right.node, x: false, y: true },
    ],
    loads: [{ node: topology.loadNode, x: 0, y: -1 }],
    axialRigidity: material.axialRigidity,
  });
  assert.equal(solution.stable, true);
  const forces = new Map(solution.memberForces.map(({ id, force }) => [id, force]));
  const thresholds = geometry.members.flatMap(member => {
    const unitForce = forces.get(member.id);
    const capacities = memberCapacities(member, material);
    const capacity = unitForce >= 0 ? capacities.tension : capacities.compression;
    const candidates = [{
      id: member.id,
      cause: 'wood',
      type: unitForce >= 0 ? 'tension' : 'compression',
      endpointNode: null,
      load: capacity / Math.abs(unitForce),
    }];
    if (unitForce > 1e-12) {
      for (const endpointNode of [member.a, member.b]) {
        candidates.push({
          id: member.id,
          cause: 'glue',
          type: 'tension',
          endpointNode,
          load: material.tensileStrengthN * material.glueStrengthRatio / unitForce,
        });
      }
    }
    return candidates;
  });
  const minimum = Math.min(...thresholds.map(item => item.load));
  return { load: minimum, candidates: thresholds.filter(item => Math.abs(item.load - minimum) <= Math.max(1e-8, minimum * 1e-8)) };
}

test('simply supported triangle has expected reactions and member-force signs', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }];
  const members = [
    { id: 'base', a: 0, b: 1 },
    { id: 'left', a: 0, b: 2 },
    { id: 'right', a: 1, b: 2 },
  ];
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

test('variable-height geometry solves stably with actual unequal member lengths', () => {
  const topology = createTopology();
  const genome = createInitialPopulation(2, 'unequal-lengths', topology)[1];
  const geometry = decodeGenome(genome, topology);
  const solution = solveTruss({
    nodes: geometry.nodes,
    members: geometry.members,
    supports: [
      { node: topology.supports.left.node, x: true, y: true },
      { node: topology.supports.right.node, x: false, y: true },
    ],
    loads: [{ node: topology.loadNode, x: 0, y: -1 }],
  });

  assert.ok(new Set(geometry.members.map(member => member.length.toFixed(5))).size > 3);
  assert.equal(solution.stable, true);
  assert.ok(solution.memberForces.every(item => Number.isFinite(item.force)));
  assert.ok(Math.abs(solution.reactions.reduce((sum, item) => sum + item.y, 0) - 1) < 1e-8);
});

test('raised central ridge cap remains stable with every member below one toothpick', () => {
  const { topology, geometry } = bridgeFixture();
  const solution = solveTruss({
    nodes: geometry.nodes,
    members: geometry.members,
    supports: [
      { node: topology.supports.left.node, x: true, y: true },
      { node: topology.supports.right.node, x: false, y: true },
    ],
    loads: [{ node: topology.loadNode, x: 0, y: -1 }],
  });
  const ridgeNodes = geometry.nodes.slice(topology.bays + 1);

  assert.ok(ridgeNodes[4].y > 0.55 && ridgeNodes[5].y > 0.55);
  assert.ok(geometry.members.every(member => member.length < 1));
  assert.equal(solution.stable, true);
});

test('tension capacity failure matches the exact geometry-based threshold', () => {
  const { topology, genome, geometry } = bridgeFixture();
  const material = { ...DEFAULT_MATERIAL, tensileStrengthN: 0.25, compressiveStrengthN: 100, glueStrengthRatio: 1.5 };
  const expected = firstFailureThreshold(geometry, topology, material);
  const result = evaluateBridge(genome, topology, { material });

  assert.equal(result.valid, true);
  assert.equal(result.collapsed, true);
  assert.ok(Math.abs(result.failureLoadN - expected.load) < 1e-8);
  const failure = result.events[0].memberFailures[0];
  assert.ok(expected.candidates.some(item => item.id === failure.memberId && item.cause === failure.cause));
  assert.equal(failure.cause, 'wood');
  assert.equal(result.events[0].memberForces.find(force => force.id === failure.memberId).type,
    expected.candidates.find(item => item.id === failure.memberId && item.cause === failure.cause).type);
});

test('compression failure applies buckling capacity using each actual member length', () => {
  const { topology, genome, geometry } = bridgeFixture();
  const material = { ...DEFAULT_MATERIAL, tensileStrengthN: 100, compressiveStrengthN: 0.5, glueStrengthRatio: 1.5 };
  const expected = firstFailureThreshold(geometry, topology, material);
  const result = evaluateBridge(genome, topology, { material });

  assert.equal(result.collapsed, true);
  assert.ok(Math.abs(result.failureLoadN - expected.load) < 1e-8);
  const brokenId = result.events[0].brokenMemberIds[0];
  assert.ok(expected.candidates.some(item => item.id === brokenId && item.cause === 'wood' && item.type === 'compression'));
  const brokenMember = geometry.members.find(member => member.id === brokenId);
  assert.ok(brokenMember.length !== 1);
});

test('a glue-governed member-end failure is identified and triggers a deterministic collapse cascade', () => {
  const { topology, genome } = bridgeFixture();
  const options = { material: { tensileStrengthN: 120, compressiveStrengthN: 1_000_000, glueStrengthRatio: 0.44 } };
  const result = evaluateBridge(genome, topology, options);
  const replay = evaluateBridge(genome, topology, options);
  const failure = result.events[0].memberFailures[0];

  assert.deepEqual(result, replay);
  assert.equal(result.valid, true);
  assert.equal(result.collapsed, true);
  assert.equal(result.collapseReason, 'unstable-or-singular-truss');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].collapse, true);
  assert.equal(failure.cause, 'glue');
  assert.ok(Number.isInteger(failure.endpointNode));
  assert.ok(failure.endpointId);
  assert.equal(result.events[0].brokenMemberIds[0], failure.memberId);
});

test('adjusting the glue ratio changes a glue-governed design into a wood-governed design', () => {
  const topology = createTopology();
  const genome = createInitialPopulation(24, 'toothpick-01', topology)[7];
  const weakGlue = evaluateBridge(genome, topology, { material: { glueStrengthRatio: 0.44 } });
  const strongGlue = evaluateBridge(genome, topology, { material: { glueStrengthRatio: 1.44 } });

  assert.equal(weakGlue.events[0].memberFailures[0].cause, 'glue');
  assert.equal(strongGlue.events[0].memberFailures[0].cause, 'wood');
  assert.ok(strongGlue.maxStableLoadN > weakGlue.maxStableLoadN);
});

test('a seeded population distinguishes mixed wood and glue failure causes deterministically', () => {
  const topology = createTopology();
  const population = createInitialPopulation(24, 'toothpick-01', topology);
  const options = { material: { glueStrengthRatio: 0.44 } };
  const first = evaluatePopulation(population, topology, undefined, options);
  const replay = evaluatePopulation(population, topology, undefined, options);
  const causes = new Set(first.map(item => item.result.events[0].memberFailures[0].cause));

  assert.deepEqual(first, replay);
  assert.deepEqual(causes, new Set(['wood', 'glue']));
});

test('glue strength ratio rejects invalid values', () => {
  const { topology, genome } = bridgeFixture();
  assert.throws(() => evaluateBridge(genome, topology, { material: { glueStrengthRatio: -0.1 } }), /non-negative/);
});

test('seeded bridge evaluations repeat exactly for evolved geometries', () => {
  const topology = createTopology();
  const population = createInitialPopulation(24, 'same-seed', topology);
  const first = evaluateBridge(population[2], topology);
  const replay = evaluateBridge(population[2], topology);

  assert.deepEqual(first, replay);
  assert.equal(first.collapsed, true);
  assert.ok(first.maxStableLoadN > 0);
});
