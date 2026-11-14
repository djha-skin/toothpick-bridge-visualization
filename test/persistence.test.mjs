import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPopulation, createTopology } from '../src/bridge.mjs';
import { deleteSavedRun, hasSavedRun, loadRun, RUN_STORAGE_KEY, saveRun, validateRunSnapshot } from '../src/persistence.mjs';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

function makeRun(topology) {
  return {
    seed: 'save-me',
    generation: 3,
    population: createInitialPopulation(24, 'save-me', topology),
    testedCount: 5,
    selectedIndex: 4,
    progress: 0.42,
    history: [{ generation: 1, bestKg: 1.2, averageKg: 0.8 }, { generation: 2, bestKg: 1.8, averageKg: 1.1 }],
  };
}

test('saved runs round-trip genomes, paused progress, history, and settings locally', () => {
  const storage = memoryStorage();
  const topology = createTopology();
  const run = makeRun(topology);
  saveRun(storage, run, { speed: 4, mutationPercent: 15 }, topology);

  assert.equal(hasSavedRun(storage), true);
  const restored = loadRun(storage, topology);
  assert.equal(restored.seed, run.seed);
  assert.equal(restored.generation, run.generation);
  assert.deepEqual(restored.population, run.population);
  assert.equal(restored.testedCount, run.testedCount);
  assert.equal(restored.activeIndex, 5);
  assert.equal(restored.selectedIndex, run.selectedIndex);
  assert.equal(restored.progress, run.progress);
  assert.equal(restored.phase, 'paused');
  assert.deepEqual(restored.history, run.history);
  assert.deepEqual(restored.settings, { speed: 4, mutationPercent: 15 });

  deleteSavedRun(storage);
  assert.equal(hasSavedRun(storage), false);
  assert.throws(() => loadRun(storage, topology), /no saved run/i);
});

test('saved-run loader rejects damaged, incompatible, and malformed snapshots', () => {
  const storage = memoryStorage();
  const topology = createTopology();
  assert.equal(hasSavedRun(storage), false);
  assert.throws(() => loadRun(storage, topology), /no saved run/i);

  storage.setItem(RUN_STORAGE_KEY, '{not-json');
  assert.throws(() => loadRun(storage, topology), /damaged/i);

  storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ schemaVersion: 0 }));
  assert.throws(() => loadRun(storage, topology), /incompatible/i);

  const run = makeRun(topology);
  saveRun(storage, run, { speed: 2, mutationPercent: 8 }, topology);
  const snapshot = JSON.parse(storage.getItem(RUN_STORAGE_KEY));
  snapshot.population[0][0] = 7;
  assert.throws(() => validateRunSnapshot(snapshot, topology), /invalid genome/i);
});

test('restoring a completed generation returns it ready to inspect/evolve', () => {
  const topology = createTopology();
  const run = {
    ...makeRun(topology),
    testedCount: 24,
    selectedIndex: 2,
    progress: 1,
  };
  const storage = memoryStorage();
  saveRun(storage, run, { speed: 2, mutationPercent: 8 }, topology);
  const restored = loadRun(storage, topology);

  assert.equal(restored.phase, 'generation-complete');
  assert.equal(restored.activeIndex, -1);
  assert.equal(restored.selectedIndex, 2);
});
