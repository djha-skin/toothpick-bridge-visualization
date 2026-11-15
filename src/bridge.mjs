import { createRandom, randomInt } from './random.mjs';

export const DEFAULT_BRIDGE_CONFIG = Object.freeze({
  span: 8,
  bays: 10,
  maxSticks: 40,
});

export const MAX_MEMBER_LENGTH = 1;
export const APEX_OFFSET_LIMIT = 0.04;
export const MIN_APEX_HEIGHT = 0.18;
export const MAX_APEX_HEIGHT = 0.55;
// Reuse the center pair for a raised cap; adding a planar joint would exceed the stick budget.
export const RIDGE_APEX_HEIGHT_RANGE = Object.freeze({ min: 0.56, max: 0.64 });
export const RIDGE_APEX_INDEXES = Object.freeze([4, 5]);
export const GENOME_LENGTH = DEFAULT_BRIDGE_CONFIG.bays * 2;
const GENE_MAX = 0xffff;
const CENTER_GENE = 0x8000;
const GEOMETRY_EPSILON = 1e-9;

function makeNode(id, role, x, y, bay) {
  return { id, role, x, y, bay };
}

function makeTopologyNodes(genome, span, bays) {
  const panelWidth = span / bays;
  const genes = genome ?? new Uint16Array(GENOME_LENGTH).fill(CENTER_GENE);
  const nodes = [];
  for (let index = 0; index <= bays; index += 1) {
    nodes.push(makeNode(`deck-${index}`, 'deck', panelWidth * index, 0, index));
  }
  for (let index = 0; index < bays; index += 1) {
    const offsetGene = genes[index * 2];
    const heightGene = genes[index * 2 + 1];
    const offset = ((offsetGene / GENE_MAX) * 2 - 1) * APEX_OFFSET_LIMIT;
    const isRidgeApex = RIDGE_APEX_INDEXES.includes(index);
    const minHeight = isRidgeApex ? RIDGE_APEX_HEIGHT_RANGE.min : MIN_APEX_HEIGHT;
    const maxHeight = isRidgeApex ? RIDGE_APEX_HEIGHT_RANGE.max : MAX_APEX_HEIGHT;
    const height = minHeight + (heightGene / GENE_MAX) * (maxHeight - minHeight);
    nodes.push(makeNode(`apex-${index}`, 'apex', panelWidth * (index + 0.5) + offset, height, index));
  }
  return nodes;
}

export function createTopology(config = {}) {
  const span = config.span ?? DEFAULT_BRIDGE_CONFIG.span;
  const bays = config.bays ?? DEFAULT_BRIDGE_CONFIG.bays;
  const maxSticks = config.maxSticks ?? DEFAULT_BRIDGE_CONFIG.maxSticks;
  if (!Number.isFinite(span) || span !== DEFAULT_BRIDGE_CONFIG.span) {
    throw new RangeError(`Bridge span is fixed at ${DEFAULT_BRIDGE_CONFIG.span} toothpick lengths`);
  }
  if (!Number.isInteger(bays) || bays !== DEFAULT_BRIDGE_CONFIG.bays) {
    throw new RangeError(`Bridge geometry uses exactly ${DEFAULT_BRIDGE_CONFIG.bays} deck bays`);
  }
  if (!Number.isInteger(maxSticks) || maxSticks < 39 || maxSticks > 40) {
    throw new RangeError('The toothpick budget must be 39 or 40 members for this geometry');
  }

  const deckNodes = bays + 1;
  const apexIndex = bay => deckNodes + bay;
  const memberTemplates = [];
  for (let bay = 0; bay < bays; bay += 1) {
    memberTemplates.push({ id: `deck-${bay}`, a: bay, b: bay + 1, type: 'deck', band: 0 });
  }
  for (let bay = 0; bay < bays; bay += 1) {
    memberTemplates.push({ id: `leg-left-${bay}`, a: bay, b: apexIndex(bay), type: 'leg', band: 1 });
    memberTemplates.push({ id: `leg-right-${bay}`, a: bay + 1, b: apexIndex(bay), type: 'leg', band: 1 });
  }
  for (let bay = 0; bay < bays - 1; bay += 1) {
    memberTemplates.push({ id: `top-${bay}`, a: apexIndex(bay), b: apexIndex(bay + 1), type: 'top', band: 2 });
  }

  const triangles = [];
  for (let bay = 0; bay < bays; bay += 1) {
    triangles.push([bay, bay + 1, apexIndex(bay)]);
  }
  for (let bay = 0; bay < bays - 1; bay += 1) {
    triangles.push([apexIndex(bay), bay + 1, apexIndex(bay + 1)]);
  }

  const baselineGenome = new Uint16Array(GENOME_LENGTH).fill(CENTER_GENE);
  const topology = {
    span,
    bays,
    maxSticks,
    supports: {
      left: { node: 0, type: 'pin' },
      right: { node: bays, type: 'roller' },
    },
    loadNode: bays / 2,
    memberTemplates,
    triangles,
    baselineGenome,
  };
  return topology;
}

export function cloneGenome(genome) {
  return Uint16Array.from(genome);
}

export function decodeGenome(genome, topology) {
  if (!(genome instanceof Uint16Array) && !Array.isArray(genome)) {
    throw new TypeError('Genome must be a Uint16Array or an array of integer genes');
  }
  if (genome.length !== GENOME_LENGTH) {
    throw new RangeError(`Expected ${GENOME_LENGTH} genes, received ${genome.length}`);
  }
  for (const gene of genome) {
    if (!Number.isInteger(gene) || gene < 0 || gene > GENE_MAX) {
      throw new RangeError('Genome genes must be integers between 0 and 65535');
    }
  }

  const nodes = makeTopologyNodes(genome, topology.span, topology.bays);
  const members = topology.memberTemplates.map(template => {
    const a = nodes[template.a];
    const b = nodes[template.b];
    return {
      ...template,
      length: Math.hypot(b.x - a.x, b.y - a.y),
    };
  });
  return { nodes, members };
}

function pathReachable(start, adjacency) {
  const visited = new Set([start]);
  const pending = [start];
  while (pending.length) {
    const node = pending.pop();
    for (const neighbor of adjacency[node]) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return visited;
}

export function validateBridge(genome, topology) {
  let decoded;
  try {
    decoded = decodeGenome(genome, topology);
  } catch (error) {
    return {
      valid: false,
      issues: ['invalid-genome'],
      stickCount: 0,
      loadReachable: false,
      nodes: [],
      members: [],
      error: error.message,
    };
  }

  const { nodes, members } = decoded;
  const issues = [];
  const stickCount = members.length;
  const adjacency = Array.from({ length: nodes.length }, () => []);
  const memberKeys = new Set();
  if (stickCount > topology.maxSticks || stickCount > 40) issues.push('over-budget');

  for (const member of members) {
    if (!Number.isInteger(member.a) || !Number.isInteger(member.b)
      || !nodes[member.a] || !nodes[member.b]) {
      issues.push('invalid-member-endpoint');
      continue;
    }
    adjacency[member.a].push(member.b);
    adjacency[member.b].push(member.a);
    memberKeys.add(`${Math.min(member.a, member.b)}:${Math.max(member.a, member.b)}`);
    if (!Number.isFinite(member.length) || member.length <= 0) issues.push('invalid-member-length');
    else if (member.length >= MAX_MEMBER_LENGTH - GEOMETRY_EPSILON) issues.push('member-too-long');
  }

  for (const triangle of topology.triangles) {
    const [aIndex, bIndex, cIndex] = triangle;
    const a = nodes[aIndex];
    const b = nodes[bIndex];
    const c = nodes[cIndex];
    if (!a || !b || !c) {
      issues.push('invalid-triangle');
      continue;
    }
    const edgesExist = [
      [aIndex, bIndex], [bIndex, cIndex], [cIndex, aIndex],
    ].every(([first, second]) => memberKeys.has(`${Math.min(first, second)}:${Math.max(first, second)}`));
    const twiceArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (!edgesExist || !Number.isFinite(twiceArea) || twiceArea <= GEOMETRY_EPSILON) {
      issues.push('degenerate-triangle');
    }
  }

  const reachable = pathReachable(topology.supports.left.node, adjacency);
  const loadReachable = reachable.has(topology.loadNode);
  if (reachable.size !== nodes.length) issues.push('disconnected-members');
  if (!loadReachable) issues.push('unreachable-load');

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    stickCount,
    loadReachable,
    nodes,
    members,
  };
}

export function createInitialPopulation(size, seed, topology) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Population size must be a positive integer');
  const random = createRandom(seed);
  const population = [cloneGenome(topology.baselineGenome)];
  const seen = new Set([genomeKey(population[0])]);
  let attempts = size * 100;
  while (population.length < size && attempts > 0) {
    attempts -= 1;
    const genome = new Uint16Array(GENOME_LENGTH);
    for (let index = 0; index < genome.length; index += 1) genome[index] = randomInt(random, 0, GENE_MAX);
    const key = genomeKey(genome);
    if (seen.has(key)) continue;
    if (!validateBridge(genome, topology).valid) continue;
    seen.add(key);
    population.push(genome);
  }
  while (population.length < size) population.push(cloneGenome(topology.baselineGenome));
  return population;
}

export function genomeKey(genome) {
  return Array.from(genome, gene => gene.toString(16).padStart(4, '0')).join('');
}
