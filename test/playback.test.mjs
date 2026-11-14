import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestDurationMs, sampleLoadTest } from '../src/playback.mjs';

const result = {
  collapsed: true,
  failureLoadN: 100,
  maxStableLoadN: 100,
  maxStableLoadKg: 100 / 9.81,
  events: [
    { loadN: 30, brokenMemberIds: ['m1'], memberFailures: [{ memberId: 'm1', cause: 'glue', endpointNode: 2 }], memberForces: [{ id: 'm1', forceN: 12, type: 'tension' }], collapse: false },
    { loadN: 100, brokenMemberIds: ['m2'], memberFailures: [{ memberId: 'm2', cause: 'wood', endpointNode: null }], memberForces: [{ id: 'm2', forceN: -40, type: 'compression' }], collapse: true }
  ],
};

test('playback interpolates load and stress while applying recorded failures', () => {
  const early = sampleLoadTest(result, 0.15);
  assert.equal(early.currentLoadN, 15);
  assert.equal(early.brokenMemberIds.size, 0);
  assert.equal(early.memberForces[0].forceN, 6);
  assert.equal(early.failed, false);

  const afterFirstBreak = sampleLoadTest(result, 0.5);
  assert.equal(afterFirstBreak.currentLoadN, 50);
  assert.equal(afterFirstBreak.brokenMemberIds.has('m1'), true);
  assert.equal(afterFirstBreak.brokenMemberIds.has('m2'), false);
  assert.equal(afterFirstBreak.memberForces[0].forceN, -20);
  assert.deepEqual(afterFirstBreak.failedJointNodes, new Set([2]));
  assert.equal(afterFirstBreak.failureCauseByMember.get('m1'), 'glue');
});

test('completed playback shows the final collapse and reduced-motion duration', () => {
  const completed = sampleLoadTest(result, 1);
  assert.equal(completed.collapsed, true);
  assert.equal(completed.brokenMemberIds.size, 2);
  assert.equal(completed.currentLoadKg, 100 / 9.81);
  assert.equal(loadTestDurationMs(5), 720);
  assert.equal(loadTestDurationMs(2, true), 120);
});
