import { cloneGenome, createInitialPopulation, decodeGenome, genomeKey } from './bridge.mjs';
import { createRandom, randomInt, shuffle } from './random.mjs';
import { evaluateBridge } from './truss.mjs';

export const DEFAULT_GA_CONFIG = Object.freeze({
  populationSize: 24,
  eliteCount: 2,
  tournamentSize: 3,
  mutationRate: 0.08,
});

function loadFitness(result) {
  const value = result?.maxStableLoadN ?? 0;
  return Number.isFinite(value) ? Math.max(0, value) : Number.MAX_VALUE;
}

export function compareEvaluations(left, right) {
  const leftValid = left.result?.valid !== false;
  const rightValid = right.result?.valid !== false;
  if (leftValid !== rightValid) return leftValid ? -1 : 1;

  const fitnessDifference = loadFitness(right.result) - loadFitness(left.result);
  if (fitnessDifference !== 0) return fitnessDifference;

  const leftSticks = left.result?.stickCount ?? Number.MAX_SAFE_INTEGER;
  const rightSticks = right.result?.stickCount ?? Number.MAX_SAFE_INTEGER;
  if (leftSticks !== rightSticks) return leftSticks - rightSticks;
  return genomeKey(left.genome).localeCompare(genomeKey(right.genome));
}

export function evaluatePopulation(population, topology, evaluate = evaluateBridge) {
  return population.map((genome, index) => ({
    index,
    genome: cloneGenome(genome),
    result: evaluate(genome, topology),
  }));
}

export function rankEvaluations(evaluations) {
  return evaluations.slice().sort(compareEvaluations);
}

export function createFirstGeneration(seed, topology, config = {}) {
  const populationSize = config.populationSize ?? DEFAULT_GA_CONFIG.populationSize;
  return createInitialPopulation(populationSize, seed, topology);
}

export function normalizeGenome(genome, topology, random = createRandom('normalize')) {
  const expectedLength = topology.optionalEdges.length;
  if (genome.length !== expectedLength) {
    throw new RangeError(`Expected ${expectedLength} genes, received ${genome.length}`);
  }
  const selected = Uint8Array.from(genome, gene => gene ? 1 : 0);
  const activeColumns = new Set();
  for (const roofNode of topology.roofNodes) {
    const roofGenes = [...roofNode.diagonalEdges, ...roofNode.horizontalEdges];
    if (roofGenes.some(index => selected[index])) activeColumns.add(roofNode.column);
  }

  const buildValidGenome = () => {
    const normalized = new Uint8Array(expectedLength);
    for (let index = 0; index < topology.baselineGenome.length; index += 1) {
      if (topology.baselineGenome[index]) normalized[index] = 1;
    }
    for (const roofNode of topology.roofNodes) {
      if (!activeColumns.has(roofNode.column)) continue;
      for (const edgeIndex of roofNode.diagonalEdges) normalized[edgeIndex] = 1;
      for (const edgeIndex of roofNode.horizontalEdges) {
        const edge = topology.optionalEdges[edgeIndex];
        const otherNode = edge.a === roofNode.node ? edge.b : edge.a;
        const otherColumn = topology.nodes[otherNode].i;
        if (selected[edgeIndex] && activeColumns.has(otherColumn)) normalized[edgeIndex] = 1;
      }
    }
    return normalized;
  };

  let normalized = buildValidGenome();
  while (decodeGenome(normalized, topology).length > topology.maxSticks && activeColumns.size) {
    const [columnToRemove] = shuffle([...activeColumns], random);
    activeColumns.delete(columnToRemove);
    normalized = buildValidGenome();
  }
  return normalized;
}

function tournamentWinner(evaluations, random, tournamentSize, excludedIndex = -1) {
  const eligible = evaluations.filter(candidate => candidate.index !== excludedIndex);
  const pool = eligible.length ? eligible : evaluations;
  const draws = Math.min(pool.length, tournamentSize);
  const selected = shuffle(pool, random).slice(0, draws);
  return selected.sort(compareEvaluations)[0];
}

function crossover(first, second, random) {
  const child = new Uint8Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    child[index] = random() < 0.5 ? first[index] : second[index];
  }
  return child;
}

function mutate(genome, mutationRate, random) {
  const child = new Uint8Array(genome);
  for (let index = 0; index < child.length; index += 1) {
    if (random() < mutationRate) child[index] = child[index] ? 0 : 1;
  }
  return child;
}

/**
 * Produce the next population. The seed and generation number fully determine
 * parent selection, crossover, and mutation; rendering never consumes RNG.
 */
export function createNextGeneration(evaluations, topology, options = {}) {
  const populationSize = options.populationSize ?? evaluations.length;
  const eliteCount = options.eliteCount ?? DEFAULT_GA_CONFIG.eliteCount;
  const tournamentSize = options.tournamentSize ?? DEFAULT_GA_CONFIG.tournamentSize;
  const mutationRate = options.mutationRate ?? DEFAULT_GA_CONFIG.mutationRate;
  const seed = options.seed ?? 'bridge-lab';
  const generation = options.generation ?? 1;

  if (!Number.isInteger(populationSize) || populationSize < 1) {
    throw new RangeError('Population size must be a positive integer');
  }
  if (!Number.isInteger(eliteCount) || eliteCount < 0 || eliteCount > populationSize) {
    throw new RangeError('Elite count must be an integer between zero and the population size');
  }
  if (!Number.isInteger(tournamentSize) || tournamentSize < 1) {
    throw new RangeError('Tournament size must be a positive integer');
  }
  if (!Number.isFinite(mutationRate) || mutationRate < 0 || mutationRate > 1) {
    throw new RangeError('Mutation rate must be between zero and one');
  }
  if (evaluations.length === 0) throw new RangeError('Cannot evolve an empty population');

  const ranked = rankEvaluations(evaluations);
  const random = createRandom(`${seed}:generation:${generation}`);
  const next = ranked.slice(0, Math.min(eliteCount, populationSize)).map(item => cloneGenome(item.genome));
  const byIndex = new Map(evaluations.map(item => [item.index, item]));
  const rankedByIndex = ranked.map(item => byIndex.get(item.index) ?? item);

  while (next.length < populationSize) {
    const parentA = tournamentWinner(rankedByIndex, random, tournamentSize);
    const parentB = tournamentWinner(rankedByIndex, random, tournamentSize, parentA.index);
    const child = crossover(parentA.genome, parentB.genome, random);
    next.push(normalizeGenome(mutate(child, mutationRate, random), topology, random));
  }
  return next;
}

export function evolveOneGeneration(population, topology, options = {}) {
  const evaluations = evaluatePopulation(population, topology);
  return {
    evaluations,
    ranked: rankEvaluations(evaluations),
    nextPopulation: createNextGeneration(evaluations, topology, options),
  };
}

export function countSticks(genome, topology) {
  return decodeGenome(genome, topology).length;
}

export function selectBest(evaluations) {
  return rankEvaluations(evaluations)[0] ?? null;
}
