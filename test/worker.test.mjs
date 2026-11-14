import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPopulation, createTopology } from '../src/bridge.mjs';


test('module worker evaluates a generation and returns the matching request id', async () => {
  let handler;
  let response;
  const fakeSelf = {
    addEventListener(type, callback) {
      assert.equal(type, 'message');
      handler = callback;
    },
    postMessage(message) { response = message; },
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: fakeSelf });
  await import(`../src/evaluation-worker.mjs?worker-test=${Date.now()}`);

  const topology = createTopology();
  const population = createInitialPopulation(3, 'worker-seed', topology);
  handler({ data: {
    id: 17,
    population: population.map(genome => Array.from(genome)),
    topology: { span: topology.span, rows: topology.rows, maxSticks: topology.maxSticks },
  } });

  assert.equal(response.id, 17);
  assert.equal(response.evaluations.length, 3);
  assert.ok(response.evaluations.every(item => item.result.maxStableLoadN > 0));
  assert.equal(response.error, undefined);
});
