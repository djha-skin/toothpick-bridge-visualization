import { createRandom, randomInt } from './random.mjs';

export const DEFAULT_BRIDGE_CONFIG = Object.freeze({
  span: 8,
  bays: 10,
  triangleLayers: 2,
  maxSticks: 500,
});

export const MAX_MEMBER_COUNT = 500;
export const MAX_MEMBER_LENGTH = 1;
export const GRID_ROW_COUNT = DEFAULT_BRIDGE_CONFIG.triangleLayers + 1;
export const HORIZONTAL_OFFSET_LIMIT = 0.04;
export const ROW_HEIGHT_VARIATION = 0.03;
export const ROW_SPACING = 0.4;
export const GENOME_LENGTH = DEFAULT_BRIDGE_CONFIG.triangleLayers
  * ((DEFAULT_BRIDGE_CONFIG.bays - 1) * 2 + DEFAULT_BRIDGE_CONFIG.bays);
const COORDINATE_GENE_COUNT = DEFAULT_BRIDGE_CONFIG.triangleLayers
  * (DEFAULT_BRIDGE_CONFIG.bays - 1) * 2;
const GENE_MAX = 0xffff;
const CENTER_GENE = 0x8000;
const GEOMETRY_EPSILON = 1e-9;

function makeNode(id, role, row, x, y, bay) {
  return { id, role, row, x, y, bay };
}

function coordinateGeneIndex(row, bay, axis, bays) {
  return ((row - 1) * (bays - 1) + bay - 1) * 2 + axis;
}

function diagonalGeneIndex(layer, bay, bays) {
  return COORDINATE_GENE_COUNT + layer * bays + bay;
}

function makeTopologyNodes(genome, span, bays) {
  const panelWidth = span / bays;
  const nodes = [];
  for (let row = 0; row < GRID_ROW_COUNT; row += 1) {
    for (let bay = 0; bay <= bays; bay += 1) {
      const baseX = panelWidth * bay;
      if (row === 0) {
        nodes.push(makeNode(`deck-${bay}`, 'deck', row, baseX, 0, bay));
        continue;
      }
      if (bay === 0 || bay === bays) {
        nodes.push(makeNode(`row-${row}-${bay}`, row === GRID_ROW_COUNT - 1 ? 'upper' : 'middle', row,
          baseX, row * ROW_SPACING, bay));
        continue;
      }
      const xGene = genome[coordinateGeneIndex(row, bay, 0, bays)];
      const yGene = genome[coordinateGeneIndex(row, bay, 1, bays)];
      const offset = ((xGene / GENE_MAX) * 2 - 1) * HORIZONTAL_OFFSET_LIMIT;
      const heightOffset = ((yGene / GENE_MAX) * 2 - 1) * ROW_HEIGHT_VARIATION;
      nodes.push(makeNode(`row-${row}-${bay}`, row === GRID_ROW_COUNT - 1 ? 'upper' : 'middle', row,
        baseX + offset, row * ROW_SPACING + heightOffset, bay));
    }
  }
  return nodes;
}

function makeMesh(genome, bays) {
  const rowWidth = bays + 1;
  const nodeIndex = (row, bay) => row * rowWidth + bay;
  const memberTemplates = [];
  const triangles = [];

  for (let row = 0; row < GRID_ROW_COUNT; row += 1) {
    for (let bay = 0; bay < bays; bay += 1) {
      memberTemplates.push({
        id: `chord-${row}-${bay}`,
        a: nodeIndex(row, bay),
        b: nodeIndex(row, bay + 1),
        type: 'chord',
        band: row,
      });
    }
  }

  for (let layer = 0; layer < GRID_ROW_COUNT - 1; layer += 1) {
    for (let bay = 0; bay <= bays; bay += 1) {
      memberTemplates.push({
        id: `post-${layer}-${bay}`,
        a: nodeIndex(layer, bay),
        b: nodeIndex(layer + 1, bay),
        type: 'post',
        band: layer + 1,
      });
    }
    for (let bay = 0; bay < bays; bay += 1) {
      const bottomLeft = nodeIndex(layer, bay);
      const bottomRight = nodeIndex(layer, bay + 1);
      const topLeft = nodeIndex(layer + 1, bay);
      const topRight = nodeIndex(layer + 1, bay + 1);
      const rising = genome[diagonalGeneIndex(layer, bay, bays)] >= CENTER_GENE;
      if (rising) {
        memberTemplates.push({
          id: `diagonal-${layer}-${bay}`,
          a: bottomLeft,
          b: topRight,
          type: 'diagonal',
          band: layer + 1,
        });
        triangles.push([bottomLeft, bottomRight, topRight], [bottomLeft, topRight, topLeft]);
      } else {
        memberTemplates.push({
          id: `diagonal-${layer}-${bay}`,
          a: bottomRight,
          b: topLeft,
          type: 'diagonal',
          band: layer + 1,
        });
        triangles.push([bottomLeft, bottomRight, topLeft], [bottomRight, topRight, topLeft]);
      }
    }
  }
  return { memberTemplates, triangles };
}

export function createTopology(config = {}) {
  const span = config.span ?? DEFAULT_BRIDGE_CONFIG.span;
  const bays = config.bays ?? DEFAULT_BRIDGE_CONFIG.bays;
  const triangleLayers = config.triangleLayers ?? DEFAULT_BRIDGE_CONFIG.triangleLayers;
  const maxSticks = config.maxSticks ?? DEFAULT_BRIDGE_CONFIG.maxSticks;
  if (!Number.isFinite(span) || span !== DEFAULT_BRIDGE_CONFIG.span) {
    throw new RangeError(`Bridge span is fixed at ${DEFAULT_BRIDGE_CONFIG.span} toothpick lengths`);
  }
  if (!Number.isInteger(bays) || bays !== DEFAULT_BRIDGE_CONFIG.bays) {
    throw new RangeError(`Bridge geometry uses exactly ${DEFAULT_BRIDGE_CONFIG.bays} deck bays`);
  }
  if (!Number.isInteger(triangleLayers) || triangleLayers !== DEFAULT_BRIDGE_CONFIG.triangleLayers) {
    throw new RangeError(`Bridge geometry uses exactly ${DEFAULT_BRIDGE_CONFIG.triangleLayers} triangle layers`);
  }
  const minimumMembers = (triangleLayers + 1) * bays + triangleLayers * (bays + 1) + triangleLayers * bays;
  if (!Number.isInteger(maxSticks) || maxSticks < minimumMembers || maxSticks > MAX_MEMBER_COUNT) {
    throw new RangeError(`The toothpick budget must be between ${minimumMembers} and ${MAX_MEMBER_COUNT} members`);
  }

  const baselineGenome = new Uint16Array(GENOME_LENGTH).fill(CENTER_GENE);
  for (let layer = 0; layer < triangleLayers; layer += 1) {
    for (let bay = 0; bay < bays; bay += 1) {
      baselineGenome[diagonalGeneIndex(layer, bay, bays)] = (layer + bay) % 2 === 0 ? GENE_MAX : 0;
    }
  }
  const { memberTemplates, triangles } = makeMesh(baselineGenome, bays);
  return {
    span,
    bays,
    triangleLayers,
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
}

export function cloneGenome(genome) {
  return Uint16Array.from(genome);
}

export function decodeGenome(genome, topology) {
  if (!(genome instanceof Uint16Array) && !Array.isArray(genome)) {
    throw new TypeError('Genome must be a Uint16Array or an array of integer genes');
  }
  const expectedLength = topology.baselineGenome.length;
  if (genome.length !== expectedLength) {
    throw new RangeError(`Expected ${expectedLength} genes, received ${genome.length}`);
  }
  for (const gene of genome) {
    if (!Number.isInteger(gene) || gene < 0 || gene > GENE_MAX) {
      throw new RangeError('Genome genes must be integers between 0 and 65535');
    }
  }

  const nodes = makeTopologyNodes(genome, topology.span, topology.bays);
  const { memberTemplates, triangles } = makeMesh(genome, topology.bays);
  const members = memberTemplates.map(template => {
    const a = nodes[template.a];
    const b = nodes[template.b];
    return {
      ...template,
      length: Math.hypot(b.x - a.x, b.y - a.y),
    };
  });
  return { nodes, members, triangles };
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

  const { nodes, members, triangles } = decoded;
  const issues = [];
  const stickCount = members.length;
  const adjacency = Array.from({ length: nodes.length }, () => []);
  const memberKeys = new Set();
  if (stickCount > topology.maxSticks || stickCount > MAX_MEMBER_COUNT) issues.push('over-budget');

  for (const member of members) {
    if (!Number.isInteger(member.a) || !Number.isInteger(member.b)
      || !nodes[member.a] || !nodes[member.b]) {
      issues.push('invalid-member-endpoint');
      continue;
    }
    adjacency[member.a].push(member.b);
    adjacency[member.b].push(member.a);
    const key = `${Math.min(member.a, member.b)}:${Math.max(member.a, member.b)}`;
    if (memberKeys.has(key)) issues.push('duplicate-member');
    memberKeys.add(key);
    if (!Number.isFinite(member.length) || member.length <= 0) issues.push('invalid-member-length');
    else if (member.length >= MAX_MEMBER_LENGTH - GEOMETRY_EPSILON) issues.push('member-too-long');
  }

  for (const triangle of triangles) {
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
    triangles,
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
    const genome = new Uint16Array(topology.baselineGenome.length);
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
