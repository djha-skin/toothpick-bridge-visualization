import { cloneGenome, createInitialPopulation, decodeGenome, genomeKey, validateBridge } from './bridge.mjs';
import { createRandom, randomInt, shuffle } from './random.mjs';
import { evaluateBridge } from './truss.mjs';

export const DEFAULT_GA_CONFIG = Object.freeze({
  populationSize: 24,
  eliteCount: 2,
  tournamentSize: 3,
  mutationRate: 0.08,
  mutationStrength: 0.18,
});

const GENE_MAX = 0xffff;

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

export function evaluatePopulation(population, topology, evaluate = evaluateBridge, options = {}) {
  return population.map((genome, index) => ({
    index,
    genome: cloneGenome(genome),
    result: evaluate(genome, topology, options),
  }));
}

export function rankEvaluations(evaluations) {
  return evaluations.slice().sort(compareEvaluations);
}

export function createFirstGeneration(seed, topology, config = {}) {
  const populationSize = config.populationSize ?? DEFAULT_GA_CONFIG.populationSize;
  return createInitialPopulation(populationSize, seed, topology);
}

export function normalizeGenome(genome, topology) {
  if (!(genome instanceof Uint16Array) && !Array.isArray(genome)) {
    throw new TypeError('Genome must be a Uint16Array or an array of integer genes');
  }
  if (genome.length !== topology.baselineGenome.length) {
    throw new RangeError(`Expected ${topology.baselineGenome.length} genes, received ${genome.length}`);
  }
  for (const gene of genome) {
    if (!Number.isInteger(gene) || gene < 0 || gene > GENE_MAX) {
      throw new RangeError('Genome genes must be integers between 0 and 65535');
    }
  }
  const normalized = cloneGenome(genome);
  const validation = validateBridge(normalized, topology);
  if (!validation.valid) throw new RangeError(`Invalid bridge geometry: ${validation.issues.join(', ')}`);
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
  const child = new Uint16Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    child[index] = random() < 0.5 ? first[index] : second[index];
  }
  return child;
}

function mutate(genome, mutationRate, mutationStrength, random) {
  const child = cloneGenome(genome);
  const maxDelta = Math.max(1, Math.round(GENE_MAX * mutationStrength));
  const minDelta = Math.max(1, Math.round(maxDelta * 0.25));
  for (let index = 0; index < child.length; index += 1) {
    if (random() >= mutationRate) continue;
    const direction = random() < 0.5 ? -1 : 1;
    const delta = randomInt(random, minDelta, maxDelta) * direction;
    const mutated = Math.max(0, Math.min(GENE_MAX, child[index] + delta));
    child[index] = mutated === child[index]
      ? Math.max(0, Math.min(GENE_MAX, child[index] - delta))
      : mutated;
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
  const mutationStrength = options.mutationStrength ?? DEFAULT_GA_CONFIG.mutationStrength;
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
  if (!Number.isFinite(mutationStrength) || mutationStrength <= 0 || mutationStrength > 1) {
    throw new RangeError('Mutation strength must be greater than zero and at most one');
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
    next.push(normalizeGenome(mutate(child, mutationRate, mutationStrength, random), topology));
  }
  return next;
}

export function measurePopulationDiversity(population) {
  if (!population.length) return { uniqueCount: 0, uniquePercent: 0, meanGeneDistancePercent: 0 };
  const uniqueCount = new Set(population.map(genomeKey)).size;
  let totalDistance = 0;
  let pairCount = 0;
  for (let first = 0; first < population.length; first += 1) {
    for (let second = first + 1; second < population.length; second += 1) {
      const left = population[first];
      const right = population[second];
      const length = Math.min(left.length, right.length);
      let distance = 0;
      for (let gene = 0; gene < length; gene += 1) {
        distance += Math.abs(left[gene] - right[gene]) / GENE_MAX;
      }
      totalDistance += length ? distance / length : 0;
      pairCount += 1;
    }
  }
  const meanGeneDistance = pairCount ? totalDistance / pairCount : 0;
  return {
    uniqueCount,
    uniquePercent: uniqueCount / population.length * 100,
    meanGeneDistancePercent: meanGeneDistance * 100,
  };
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
  return decodeGenome(genome, topology).members.length;
}

export function selectBest(evaluations) {
  return rankEvaluations(evaluations)[0] ?? null;
}
