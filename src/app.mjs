import { createInitialPopulation, createTopology, decodeGenome } from './bridge.mjs';
import {
  createNextGeneration,
  evaluatePopulation,
  rankEvaluations,
} from './genetics.mjs';
import { loadTestDurationMs, sampleLoadTest } from './playback.mjs';
import { drawBridge } from './renderer.mjs';
import { updateGenerationHistory, updateSummary, renderPopulation } from './ui.mjs';
import { deleteSavedRun, hasSavedRun, loadRun, saveRun } from './persistence.mjs';

const POPULATION_SIZE = 24;
const ELITE_COUNT = 2;
const topology = createTopology();
const bridgeCanvas = document.querySelector('#bridge-canvas');
const historyCanvas = document.querySelector('#history-canvas');
const historyDescription = document.querySelector('#history-description');
const populationGrid = document.querySelector('#population-grid');
const leaderboard = document.querySelector('#leaderboard');
const seedInput = document.querySelector('#seed-input');
const speedControl = document.querySelector('#speed-control');
const mutationControl = document.querySelector('#mutation-control');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let state;
let animationId = null;
let generationTimer = null;
let evaluationWorker = null;
let nextEvaluationId = 1;
const pendingEvaluations = new Map();

function placeholderEvaluations(population) {
  return population.map((genome, index) => ({
    index,
    genome,
    result: {
      valid: true,
      collapsed: false,
      maxStableLoadN: 0,
      maxStableLoadKg: 0,
      failureLoadN: 0,
      events: [],
      stickCount: decodeGenome(genome, topology).length,
    },
  }));
}

function makeGeneration(seed, generation, population) {
  return {
    seed,
    generation,
    population,
    evaluations: placeholderEvaluations(population),
    testedCount: 0,
    activeIndex: 0,
    selectedIndex: 0,
    progress: 0,
    replayProgress: 0,
    phase: 'preparing',
    autoRun: false,
    history: state?.history ?? [],
    lastTimestamp: null,
  };
}

function cancelPendingWork() {
  if (animationId !== null) cancelAnimationFrame(animationId);
  if (generationTimer !== null) clearTimeout(generationTimer);
  animationId = null;
  generationTimer = null;
}

function createEvaluationWorker() {
  if (evaluationWorker || typeof Worker === 'undefined') return evaluationWorker;
  try {
    evaluationWorker = new Worker(new URL('./evaluation-worker.mjs', import.meta.url), { type: 'module' });
    evaluationWorker.addEventListener('message', event => {
      const pending = pendingEvaluations.get(event.data.id);
      if (!pending) return;
      pendingEvaluations.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.evaluations);
    });
    evaluationWorker.addEventListener('error', event => {
      for (const pending of pendingEvaluations.values()) pending.reject(event.error ?? new Error('Evaluation worker failed.'));
      pendingEvaluations.clear();
      evaluationWorker.terminate();
      evaluationWorker = null;
    });
  } catch {
    evaluationWorker = null;
  }
  return evaluationWorker;
}

function evaluatePopulationOffThread(population) {
  const worker = createEvaluationWorker();
  if (!worker) {
    return new Promise(resolve => setTimeout(() => resolve(evaluatePopulation(population, topology)), 0));
  }
  const id = nextEvaluationId++;
  return new Promise((resolve, reject) => {
    pendingEvaluations.set(id, { resolve, reject });
    worker.postMessage({
      id,
      population: population.map(genome => Array.from(genome)),
      topology: { span: topology.span, rows: topology.rows, maxSticks: topology.maxSticks },
    });
  }).catch(() => new Promise(resolve => setTimeout(() => resolve(evaluatePopulation(population, topology)), 0)));
}

async function prepareGeneration(targetState, phaseAfter = 'ready', autoRun = false) {
  render();
  try {
    const evaluations = await evaluatePopulationOffThread(targetState.population);
    if (state !== targetState) return;
    targetState.evaluations = evaluations;
    targetState.phase = phaseAfter;
    targetState.autoRun = false;
    render();
    if (autoRun) startAnimation();
  } catch (error) {
    if (state === targetState) {
      targetState.phase = 'ready';
      document.querySelector('#test-status').textContent = error.message || 'Bridge evaluation failed.';
      render();
    }
  }
}

function startNewRun(seed) {
  cancelPendingWork();
  const nextSeed = seed.trim() || 'toothpick-01';
  seedInput.value = nextSeed;
  const population = createInitialPopulation(POPULATION_SIZE, nextSeed, topology);
  state = makeGeneration(nextSeed, 1, population);
  state.history = [];
  void prepareGeneration(state);
}

function testedEvaluations() {
  return state.evaluations.filter(item => item.index < state.testedCount);
}

function generationStats() {
  const ranked = rankEvaluations(testedEvaluations());
  if (!ranked.length) return { bestKg: Number.NaN, averageKg: Number.NaN };
  const loads = ranked.map(item => item.result.maxStableLoadKg).filter(Number.isFinite);
  return {
    bestKg: ranked[0].result.maxStableLoadKg,
    averageKg: loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : 0,
  };
}

function selectedEvaluation() {
  return state.evaluations[state.selectedIndex] ?? state.evaluations[0];
}

function visibleProgress() {
  if (state.phase === 'running') return state.progress;
  if (state.phase === 'replay') return state.replayProgress;
  if (state.phase === 'paused' && state.selectedIndex === state.activeIndex && state.activeIndex >= state.testedCount) {
    return state.progress;
  }
  if (state.selectedIndex < state.testedCount) return 1;
  return 0;
}

function visibleFrame(evaluation) {
  const progress = visibleProgress();
  return sampleLoadTest(evaluation.result, progress);
}

function phaseText() {
  if (state.phase === 'preparing') return 'Calculating bridge strength';
  if (state.phase === 'running') return `Testing bridge ${state.activeIndex + 1} of ${state.population.length}`;
  if (state.phase === 'replay') return `Replaying bridge ${state.selectedIndex + 1}`;
  if (state.phase === 'generation-complete') return `Generation ${state.generation} complete`;
  if (state.phase === 'paused') return 'Evolution paused';
  return 'Ready to experiment';
}

function renderStage() {
  const evaluation = selectedEvaluation();
  if (!evaluation) return;
  const frame = visibleFrame(evaluation);
  drawBridge(bridgeCanvas, topology, evaluation.genome, frame);
  document.querySelector('#candidate-number').textContent = String(state.selectedIndex + 1).padStart(2, '0');
  document.querySelector('#load-value').textContent = frame.currentLoadKg.toFixed(1);
  document.querySelector('#stick-count').textContent = String(evaluation.result.stickCount);
  document.querySelector('#load-progress-fill').style.width = `${Math.round(frame.progress * 100)}%`;

  const isTested = state.selectedIndex < state.testedCount;
  let description = `Bridge ${state.selectedIndex + 1} has ${evaluation.result.stickCount} toothpicks.`;
  if (isTested) description += ` It held ${evaluation.result.maxStableLoadKg.toFixed(1)} kg-equivalent before failure.`;
  else if (state.phase === 'running' && state.selectedIndex === state.activeIndex) description += ' Its center load is rising.';
  else description += ' Its load test is queued.';
  document.querySelector('#bridge-description').textContent = description;

  let status = 'Ready for the first load test';
  if (state.phase === 'preparing') status = 'Calculating structural responses…';
  else if (state.phase === 'running') status = `Loading bridge ${state.activeIndex + 1} · ${state.testedCount + 1}/${state.population.length}`;
  else if (state.phase === 'replay') status = `Replaying recorded failure · ${Math.round(frame.progress * 100)}%`;
  else if (isTested) status = `Failed at ${evaluation.result.maxStableLoadKg.toFixed(1)} kg-equivalent`;
  else if (state.phase === 'generation-complete') status = 'Generation tested · ready to evolve';
  else if (state.phase === 'paused') status = 'Paused · choose a bridge or resume';
  document.querySelector('#test-status').textContent = status;
  bridgeCanvas.setAttribute('aria-label', `Bridge ${state.selectedIndex + 1}. Applied load ${frame.currentLoadKg.toFixed(1)} kg-equivalent. ${description}`);
}

function render() {
  const stats = generationStats();
  const completedCount = state.testedCount;
  const stateText = phaseText();
  updateSummary({
    generation: state.generation,
    bestKg: stats.bestKg,
    averageKg: stats.averageKg,
    testedCount: completedCount,
    populationSize: state.population.length,
    runState: stateText,
  });
  document.querySelector('#best-load-caption').textContent = completedCount
    ? `Generation ${state.generation} · best result so far`
    : 'Waiting for first test';
  document.querySelector('#population-note').textContent =
    `${completedCount} of ${state.population.length} bridges tested`;
  updateGenerationHistory(historyCanvas, historyDescription, state.history);
  renderPopulation(populationGrid, leaderboard, state.evaluations, topology, {
    selectedIndex: state.selectedIndex,
    activeIndex: state.phase === 'running' ? state.activeIndex : -1,
    testedCount: state.testedCount,
    eliteCount: ELITE_COUNT,
  });
  renderStage();

  const runButton = document.querySelector('#run-toggle');
  const running = state.phase === 'running';
  const preparing = state.phase === 'preparing';
  runButton.innerHTML = preparing
    ? '<span aria-hidden="true">…</span> Calculating bridges'
    : running || (state.phase === 'generation-complete' && state.autoRun)
      ? '<span aria-hidden="true">Ⅱ</span> Pause evolution'
      : state.phase === 'generation-complete'
        ? '<span aria-hidden="true">▶</span> Next generation'
        : '<span aria-hidden="true">▶</span> Start evolving';
  runButton.disabled = preparing;
  runButton.setAttribute('aria-pressed', String(running || (state.phase === 'generation-complete' && state.autoRun)));
  document.querySelector('#status-light').classList.toggle('is-running', running || state.phase === 'replay');
  document.querySelector('#status-light').classList.toggle('is-preparing', preparing);
  document.querySelector('#step-button').disabled = preparing || state.phase === 'replay';
  document.querySelector('#replay-test').disabled = preparing || state.selectedIndex >= state.testedCount || state.phase === 'running';
  document.querySelector('#fast-forward').disabled = preparing || state.phase === 'generation-complete';
  document.querySelector('#save-run').disabled = preparing;
  if (preparing) {
    document.querySelector('#restore-run').disabled = true;
    document.querySelector('#delete-saved-run').disabled = true;
  } else updateRestoreAvailability();
}

function drawAnimationFrame() {
  const evaluation = selectedEvaluation();
  if (!evaluation) return;
  const frame = visibleFrame(evaluation);
  drawBridge(bridgeCanvas, topology, evaluation.genome, frame);
  document.querySelector('#load-value').textContent = frame.currentLoadKg.toFixed(1);
  document.querySelector('#load-progress-fill').style.width = `${Math.round(frame.progress * 100)}%`;
}

function requestNextFrame() {
  if (animationId === null) animationId = requestAnimationFrame(advanceAnimation);
}

function advanceAnimation(timestamp) {
  animationId = null;
  if (state.phase !== 'running' && state.phase !== 'replay') return;
  if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
  const elapsed = Math.max(0, timestamp - state.lastTimestamp);
  state.lastTimestamp = timestamp;
  const duration = loadTestDurationMs(Number(speedControl.value), reducedMotion);

  if (state.phase === 'running') {
    state.progress = Math.min(1, state.progress + elapsed / duration);
    drawAnimationFrame();
    if (state.progress >= 1) {
      completeCurrentCandidate(true);
      return;
    }
  } else {
    state.replayProgress = Math.min(1, state.replayProgress + elapsed / duration);
    drawAnimationFrame();
    if (state.replayProgress >= 1) {
      state.phase = state.testedCount >= state.population.length ? 'generation-complete' : 'paused';
      state.lastTimestamp = null;
      render();
      return;
    }
  }
  requestNextFrame();
}

function startAnimation() {
  state.phase = 'running';
  state.autoRun = true;
  state.selectedIndex = state.activeIndex;
  state.lastTimestamp = null;
  render();
  requestNextFrame();
}

function pauseAnimation() {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
  state.autoRun = false;
  state.phase = 'paused';
  state.lastTimestamp = null;
  render();
}

function recordGeneration() {
  if (state.history.at(-1)?.generation === state.generation) return;
  const ranked = rankEvaluations(state.evaluations);
  const averageKg = state.evaluations.reduce((sum, item) => sum + item.result.maxStableLoadKg, 0) / state.evaluations.length;
  state.history.push({
    generation: state.generation,
    bestKg: ranked[0]?.result.maxStableLoadKg ?? 0,
    averageKg,
  });
}

function finishGeneration() {
  cancelAnimationFrame(animationId);
  animationId = null;
  state.testedCount = state.population.length;
  state.activeIndex = -1;
  state.progress = 1;
  state.phase = 'generation-complete';
  recordGeneration();
  const champion = rankEvaluations(state.evaluations)[0];
  if (champion) state.selectedIndex = champion.index;
  state.lastTimestamp = null;
  render();

  if (state.autoRun) {
    generationTimer = setTimeout(() => {
      generationTimer = null;
      if (state.autoRun && state.phase === 'generation-complete') advanceGenerationAndRun();
    }, 900);
  }
}

function completeCurrentCandidate(fromAnimation = false) {
  if (state.phase === 'replay' || state.phase === 'generation-complete') return;
  if (state.activeIndex < 0) state.activeIndex = state.testedCount;
  state.testedCount = Math.max(state.testedCount, state.activeIndex + 1);
  state.progress = 1;
  if (state.testedCount >= state.population.length) {
    state.autoRun = fromAnimation && state.autoRun;
    finishGeneration();
    return;
  }
  state.activeIndex = state.testedCount;
  state.selectedIndex = state.activeIndex;
  state.progress = 0;
  state.lastTimestamp = null;
  if (fromAnimation && state.autoRun) {
    state.phase = 'running';
    render();
    requestNextFrame();
  } else {
    state.autoRun = false;
    state.phase = 'paused';
    render();
  }
}

function advanceGenerationAndRun(autoRun = state.autoRun) {
  if (generationTimer !== null) clearTimeout(generationTimer);
  generationTimer = null;
  const mutationRate = Number(mutationControl.value) / 100;
  const population = createNextGeneration(state.evaluations, topology, {
    populationSize: state.population.length,
    eliteCount: ELITE_COUNT,
    tournamentSize: 3,
    mutationRate,
    seed: state.seed,
    generation: state.generation,
  });
  const next = makeGeneration(state.seed, state.generation + 1, population);
  next.history = state.history;
  state = next;
  void prepareGeneration(next, 'ready', autoRun);
}

function handleRunToggle() {
  if (state.phase === 'running') {
    pauseAnimation();
  } else if (state.phase === 'replay') {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    state.phase = state.testedCount >= state.population.length ? 'generation-complete' : 'paused';
    state.lastTimestamp = null;
    render();
  } else if (state.phase === 'generation-complete') {
    if (state.autoRun) {
      state.autoRun = false;
      if (generationTimer !== null) clearTimeout(generationTimer);
      generationTimer = null;
      render();
    } else {
      state.autoRun = true;
      advanceGenerationAndRun();
    }
  } else {
    startAnimation();
  }
}

function handleStep() {
  if (state.phase === 'running') {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    state.autoRun = false;
    state.phase = 'paused';
  } else if (state.phase === 'generation-complete') {
    advanceGenerationAndRun(false);
    return;
  }
  completeCurrentCandidate(false);
}

function handleFastForward() {
  if (state.phase === 'generation-complete') return;
  cancelAnimationFrame(animationId);
  animationId = null;
  state.autoRun = false;
  state.testedCount = state.population.length;
  state.progress = 1;
  finishGeneration();
}

function handleReplay() {
  if (state.selectedIndex >= state.testedCount) return;
  if (animationId !== null) cancelAnimationFrame(animationId);
  if (generationTimer !== null) clearTimeout(generationTimer);
  animationId = null;
  generationTimer = null;
  state.autoRun = false;
  state.replayProgress = 0;
  state.phase = 'replay';
  state.lastTimestamp = null;
  render();
  requestNextFrame();
}

function saveCurrentRun() {
  try {
    saveRun(window.localStorage, state, {
      speed: Number(speedControl.value),
      mutationPercent: Number(mutationControl.value),
    }, topology);
    updateRestoreAvailability();
    document.querySelector('#test-status').textContent = 'Run saved in this browser';
  } catch (error) {
    document.querySelector('#test-status').textContent = error.message || 'Could not save this run in the browser.';
  }
}

async function restoreSavedRun() {
  try {
    const restored = loadRun(window.localStorage, topology);
    cancelPendingWork();
    speedControl.value = String(restored.settings.speed);
    mutationControl.value = String(restored.settings.mutationPercent);
    document.querySelector('#speed-value').textContent = `${speedControl.value}×`;
    document.querySelector('#mutation-value').textContent = `${mutationControl.value}%`;
    seedInput.value = restored.seed;
    const restoredPhase = restored.phase;
    state = {
      ...restored,
      evaluations: placeholderEvaluations(restored.population),
      phase: 'preparing',
      replayProgress: 0,
      autoRun: false,
      lastTimestamp: null,
    };
    const targetState = state;
    render();
    targetState.evaluations = await evaluatePopulationOffThread(restored.population);
    if (state !== targetState) return;
    targetState.phase = restoredPhase;
    render();
    document.querySelector('#test-status').textContent = 'Saved run restored';
  } catch (error) {
    document.querySelector('#test-status').textContent = error.message || 'Could not restore the saved run.';
  }
}

function deleteCurrentSavedRun() {
  try {
    deleteSavedRun(window.localStorage);
    updateRestoreAvailability();
    document.querySelector('#test-status').textContent = 'Saved run deleted from this browser';
  } catch (error) {
    document.querySelector('#test-status').textContent = error.message || 'Could not delete the saved run.';
  }
}

function updateRestoreAvailability() {
  const isSaved = (() => {
    try { return hasSavedRun(window.localStorage); }
    catch { return false; }
  })();
  document.querySelector('#restore-run').disabled = !isSaved;
  document.querySelector('#delete-saved-run').disabled = !isSaved;
}

function selectCandidate(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.population.length) return;
  if (state.phase === 'generation-complete' && state.autoRun) {
    state.autoRun = false;
    if (generationTimer !== null) clearTimeout(generationTimer);
    generationTimer = null;
  }
  if (state.phase === 'running') {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    state.phase = 'paused';
    state.autoRun = false;
  }
  if (state.phase === 'replay') {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    state.phase = state.testedCount >= state.population.length ? 'generation-complete' : 'paused';
  }
  state.selectedIndex = index;
  render();
}

function bindControls() {
  document.querySelector('#run-toggle').addEventListener('click', handleRunToggle);
  document.querySelector('#step-button').addEventListener('click', handleStep);
  document.querySelector('#fast-forward').addEventListener('click', handleFastForward);
  document.querySelector('#replay-test').addEventListener('click', handleReplay);
  document.querySelector('#new-run').addEventListener('click', () => startNewRun(seedInput.value));
  document.querySelector('#save-run').addEventListener('click', saveCurrentRun);
  document.querySelector('#restore-run').addEventListener('click', restoreSavedRun);
  document.querySelector('#delete-saved-run').addEventListener('click', deleteCurrentSavedRun);
  for (const container of [populationGrid, leaderboard]) {
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-select-index]');
      if (button) selectCandidate(Number(button.dataset.selectIndex));
    });
  }
  speedControl.addEventListener('input', () => {
    document.querySelector('#speed-value').textContent = `${speedControl.value}×`;
  });
  mutationControl.addEventListener('input', () => {
    document.querySelector('#mutation-value').textContent = `${mutationControl.value}%`;
  });
}

export function bootApp() {
  bindControls();
  state = makeGeneration(seedInput.value, 1, createInitialPopulation(POPULATION_SIZE, seedInput.value, topology));
  state.history = [];
  updateRestoreAvailability();
  void prepareGeneration(state);
  const resizeObserver = new ResizeObserver(() => {
    const evaluation = selectedEvaluation();
    if (evaluation) drawBridge(bridgeCanvas, topology, evaluation.genome, visibleFrame(evaluation));
    updateGenerationHistory(historyCanvas, historyDescription, state.history);
  });
  resizeObserver.observe(bridgeCanvas);
  resizeObserver.observe(historyCanvas);
}
