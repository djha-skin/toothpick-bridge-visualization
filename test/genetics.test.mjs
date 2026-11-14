import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPopulation, createTopology, genomeKey, validateBridge } from '../src/bridge.mjs';
import {
  createNextGeneration,
  evaluatePopulation,
  rankEvaluations,
} from '../src/genetics.mjs';


test('fitness ranks valid bridges by carried load and uses stick count as tie-breaker', () => {
  const shortGenome = new Uint8Array([0, 1]);
  const longGenome = new Uint8Array([1, 0]);
  const ranked = rankEvaluations([
    { index: 0, genome: longGenome, result: { valid: true, maxStableLoadN: 80, stickCount: 35 } },
    { index: 1, genome: shortGenome, result: { valid: true, maxStableLoadN: 80, stickCount: 32 } },
    { index: 2, genome: new Uint8Array([0, 0]), result: { valid: false, maxStableLoadN: 0, stickCount: 1 } },
  ]);

  assert.equal(ranked[0].index, 1);
  assert.equal(ranked[1].index, 0);
  assert.equal(ranked[2].index, 2);
});

test('generation transitions preserve elites, size, validity, budget, and seed repeatability', () => {
  const topology = createTopology();
  const population = createInitialPopulation(24, 'ga-repeatability', topology);
  const evaluations = evaluatePopulation(population, topology);
  const ranked = rankEvaluations(evaluations);
  const options = { populationSize: 24, eliteCount: 2, tournamentSize: 3, mutationRate: 0.08, seed: 'run-7', generation: 1 };
  const first = createNextGeneration(evaluations, topology, options);
  const replay = createNextGeneration(evaluations, topology, options);

  assert.deepEqual(first, replay);
  assert.equal(first.length, population.length);
  assert.deepEqual(first[0], ranked[0].genome);
  assert.deepEqual(first[1], ranked[1].genome);
  assert.ok(new Set(first.map(genomeKey)).size >= 2);
  for (const genome of first) {
    assert.equal(validateBridge(genome, topology).valid, true);
    assert.ok(validateBridge(genome, topology).stickCount <= topology.maxSticks);
  }
});

test('elitism keeps the best score from declining across generations', () => {
  const topology = createTopology();
  const config = { populationSize: 24, eliteCount: 2, tournamentSize: 3, mutationRate: 0.08 };
  let population = createInitialPopulation(config.populationSize, 'long-run', topology);
  let bestLoad = 0;

  for (let generation = 0; generation < 5; generation += 1) {
    const evaluations = evaluatePopulation(population, topology);
    const ranked = rankEvaluations(evaluations);
    assert.ok(ranked[0].result.maxStableLoadN >= bestLoad);
    bestLoad = ranked[0].result.maxStableLoadN;
    population = createNextGeneration(evaluations, topology, {
      ...config,
      seed: 'long-run',
      generation: generation + 1,
    });
  }
});
