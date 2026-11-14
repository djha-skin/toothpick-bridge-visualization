import { DEFAULT_MATERIAL } from './truss.mjs';

export function sampleLoadTest(result, progress, options = {}) {
  const boundedProgress = Math.max(0, Math.min(1, progress));
  const gravity = options.gravity ?? DEFAULT_MATERIAL.gravity;
  const terminalLoadN = Number.isFinite(result.failureLoadN) ? Math.max(0, result.failureLoadN) : 0;
  const currentLoadN = terminalLoadN * boundedProgress;
  const epsilon = Math.max(1e-9, terminalLoadN * 1e-9);
  const completedEvents = result.events.filter(event => event.loadN <= currentLoadN + epsilon);
  const nextEvent = result.events.find(event => event.loadN > currentLoadN + epsilon);
  const forceEvent = nextEvent ?? result.events.at(-1) ?? null;
  const forceScale = forceEvent?.loadN > 0 ? currentLoadN / forceEvent.loadN : 0;
  const memberForces = (forceEvent?.memberForces ?? []).map(force => ({
    ...force,
    forceN: force.forceN * forceScale,
  }));
  const brokenMemberIds = new Set(completedEvents.flatMap(event => event.brokenMemberIds));
  const isComplete = boundedProgress >= 1;

  return {
    progress: boundedProgress,
    currentLoadN,
    currentLoadKg: currentLoadN / gravity,
    maxStableLoadN: result.maxStableLoadN,
    maxStableLoadKg: result.maxStableLoadKg,
    memberForces,
    brokenMemberIds,
    eventIndex: completedEvents.length,
    isComplete,
    collapsed: Boolean(result.collapsed && isComplete),
    failed: Boolean(result.collapsed && (isComplete
      || result.events.some(event => event.collapse && event.loadN <= currentLoadN + epsilon))),
  };
}

export function loadTestDurationMs(speed = 2, prefersReducedMotion = false) {
  if (prefersReducedMotion) return 120;
  const boundedSpeed = Math.max(1, Math.min(5, Number(speed) || 1));
  return 3600 / boundedSpeed;
}
