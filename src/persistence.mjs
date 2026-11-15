import { DEFAULT_BRIDGE_CONFIG, validateBridge } from './bridge.mjs';

export const RUN_STORAGE_KEY = 'toothpick-bridge-lab:run:v1';
export const RUN_SCHEMA_VERSION = 2;
export const RUN_MODEL_VERSION = 'variable-truss-v3';

function integerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function createRunSnapshot(run, settings = {}, topology) {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    modelVersion: RUN_MODEL_VERSION,
    topology: {
      span: topology.span,
      bays: topology.bays,
      maxSticks: topology.maxSticks,
    },
    seed: String(run.seed),
    generation: run.generation,
    populationSize: run.population.length,
    population: run.population.map(genome => Array.from(genome)),
    testedCount: run.testedCount,
    selectedIndex: run.selectedIndex,
    progress: run.progress,
    history: run.history.map(point => ({
      generation: point.generation,
      bestKg: point.bestKg,
      averageKg: point.averageKg,
    })),
    settings: {
      speed: Number(settings.speed ?? 2),
      mutationPercent: Number(settings.mutationPercent ?? 8),
      mutationStrengthPercent: Number(settings.mutationStrengthPercent ?? 18),
      selectionPressure: Number(settings.selectionPressure ?? 3),
      glueStrengthPercent: Number(settings.glueStrengthPercent ?? 44),
    },
  };
}

export function validateRunSnapshot(snapshot, topology) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Saved run is not a valid object.');
  }
  if (snapshot.schemaVersion !== RUN_SCHEMA_VERSION || snapshot.modelVersion !== RUN_MODEL_VERSION) {
    throw new Error('This saved run was created by an incompatible Bridge Lab version.');
  }
  const expectedTopology = {
    span: topology.span ?? DEFAULT_BRIDGE_CONFIG.span,
    bays: topology.bays ?? DEFAULT_BRIDGE_CONFIG.bays,
    maxSticks: topology.maxSticks ?? DEFAULT_BRIDGE_CONFIG.maxSticks,
  };
  if (!snapshot.topology || Object.keys(expectedTopology).some(key => snapshot.topology[key] !== expectedTopology[key])) {
    throw new Error('Saved run settings do not match this bridge model.');
  }
  if (typeof snapshot.seed !== 'string' || !snapshot.seed.trim() || snapshot.seed.length > 48) {
    throw new Error('Saved run has an invalid seed.');
  }
  if (!integerInRange(snapshot.generation, 1, 1_000_000)) {
    throw new Error('Saved run has an invalid generation number.');
  }
  if (!Array.isArray(snapshot.population) || snapshot.population.length < 1 || snapshot.population.length > 100
    || snapshot.populationSize !== snapshot.population.length) {
    throw new Error('Saved run has an invalid population.');
  }
  const population = snapshot.population.map((genes, index) => {
    if (!Array.isArray(genes) || genes.length !== topology.baselineGenome.length
      || genes.some(gene => !Number.isInteger(gene) || gene < 0 || gene > 0xffff)) {
      throw new Error(`Saved bridge ${index + 1} has an invalid genome.`);
    }
    const genome = new Uint16Array(genes);
    const validation = validateBridge(genome, topology);
    if (!validation.valid) throw new Error(`Saved bridge ${index + 1} is invalid: ${validation.issues.join(', ')}.`);
    return genome;
  });
  if (!integerInRange(snapshot.testedCount, 0, population.length)) {
    throw new Error('Saved run has an invalid test count.');
  }
  if (!integerInRange(snapshot.selectedIndex, 0, population.length - 1)) {
    throw new Error('Saved run has an invalid selected bridge.');
  }
  if (typeof snapshot.progress !== 'number' || !Number.isFinite(snapshot.progress)
    || snapshot.progress < 0 || snapshot.progress > 1) {
    throw new Error('Saved run has an invalid load-test position.');
  }
  if (!Array.isArray(snapshot.history) || snapshot.history.length > 1000) {
    throw new Error('Saved run has invalid generation history.');
  }
  const history = snapshot.history.map(point => {
    if (!point || !integerInRange(point.generation, 1, 1_000_000)
      || !Number.isFinite(point.bestKg) || point.bestKg < 0
      || !Number.isFinite(point.averageKg) || point.averageKg < 0) {
      throw new Error('Saved run contains an invalid history entry.');
    }
    return { generation: point.generation, bestKg: point.bestKg, averageKg: point.averageKg };
  });
  const settings = snapshot.settings;
  const mutationStrengthPercent = settings?.mutationStrengthPercent ?? 18;
  const selectionPressure = settings?.selectionPressure ?? 3;
  if (!settings || !integerInRange(settings.speed, 1, 8)
    || !integerInRange(settings.mutationPercent, 1, 30)
    || !integerInRange(mutationStrengthPercent, 5, 30)
    || !integerInRange(selectionPressure, 1, 8)
    || !integerInRange(settings.glueStrengthPercent, 44, 144)) {
    throw new Error('Saved run has invalid evolution settings.');
  }
  const activeIndex = snapshot.testedCount < population.length ? snapshot.testedCount : -1;
  return {
    seed: snapshot.seed,
    generation: snapshot.generation,
    population,
    testedCount: snapshot.testedCount,
    activeIndex,
    selectedIndex: snapshot.selectedIndex,
    progress: activeIndex < 0 ? 1 : snapshot.progress,
    history,
    settings: {
      speed: settings.speed,
      mutationPercent: settings.mutationPercent,
      mutationStrengthPercent,
      selectionPressure,
      glueStrengthPercent: settings.glueStrengthPercent,
    },
    phase: activeIndex < 0 ? 'generation-complete'
      : snapshot.testedCount > 0 || snapshot.progress > 0 ? 'paused' : 'ready',
  };
}

export function saveRun(storage, run, settings, topology) {
  const snapshot = createRunSnapshot(run, settings, topology);
  storage.setItem(RUN_STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadRun(storage, topology) {
  const serialized = storage.getItem(RUN_STORAGE_KEY);
  if (!serialized) throw new Error('There is no saved run in this browser yet.');
  let snapshot;
  try {
    snapshot = JSON.parse(serialized);
  } catch {
    throw new Error('The saved run is damaged and could not be read.');
  }
  return validateRunSnapshot(snapshot, topology);
}

export function deleteSavedRun(storage) {
  storage.removeItem(RUN_STORAGE_KEY);
}

export function hasSavedRun(storage) {
  try {
    return Boolean(storage.getItem(RUN_STORAGE_KEY));
  } catch {
    return false;
  }
}
