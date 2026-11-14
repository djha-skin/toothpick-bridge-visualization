import { createRandom, randomInt, shuffle } from './random.mjs';

export const DEFAULT_BRIDGE_CONFIG = Object.freeze({
  span: 8,
  rows: 2,
  maxSticks: 40,
});

const SQRT_3_OVER_2 = Math.sqrt(3) / 2;

function nodeKey(i, row) {
  return `${row}:${i}`;
}

export function createTopology(config = {}) {
  const span = config.span ?? DEFAULT_BRIDGE_CONFIG.span;
  const rows = config.rows ?? DEFAULT_BRIDGE_CONFIG.rows;
  const maxSticks = config.maxSticks ?? DEFAULT_BRIDGE_CONFIG.maxSticks;
  if (!Number.isInteger(span) || span < 4 || span % 2 !== 0) {
    throw new RangeError('Bridge span must be an even integer of at least 4 toothpick lengths');
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 2) {
    throw new RangeError('The first version supports one or two truss tiers');
  }
  if (!Number.isInteger(maxSticks) || maxSticks < span) {
    throw new RangeError('Stick budget must be an integer at least as large as the span');
  }

  const nodes = [];
  const nodeIndex = new Map();
  for (let row = 0; row <= rows; row += 1) {
    const minI = Math.ceil(-row / 2);
    const maxI = Math.floor(span - row / 2);
    for (let i = minI; i <= maxI; i += 1) {
      const node = {
        id: nodeKey(i, row),
        i,
        row,
        x: i + row / 2,
        y: row * SQRT_3_OVER_2,
      };
      nodeIndex.set(node.id, nodes.length);
      nodes.push(node);
    }
  }

  const edges = [];
  const addEdge = (a, b, type, band) => {
    const first = nodes[a];
    const second = nodes[b];
    const length = Math.hypot(second.x - first.x, second.y - first.y);
    if (Math.abs(length - 1) > 1e-9) {
      throw new Error(`Lattice member ${first.id}—${second.id} is not one toothpick long`);
    }
    edges.push({
      id: `m${edges.length}`,
      a,
      b,
      type,
      band,
      length,
      mandatory: false,
    });
  };

  // Horizontal sticks in every row.
  for (let row = 0; row <= rows; row += 1) {
    const minI = Math.ceil(-row / 2);
    const maxI = Math.floor(span - row / 2);
    for (let i = minI; i < maxI; i += 1) {
      const a = nodeIndex.get(nodeKey(i, row));
      const b = nodeIndex.get(nodeKey(i + 1, row));
      if (row === 2 && (nodes[a].x === 0 || nodes[a].x === span || nodes[b].x === 0 || nodes[b].x === span)) continue;
      addEdge(a, b, 'horizontal', row);
    }
  }

  // Diagonal sticks connect adjacent rows in the triangular lattice.
  for (let row = 0; row < rows; row += 1) {
    const minI = Math.ceil(-row / 2);
    const maxI = Math.floor(span - row / 2);
    for (let i = minI; i <= maxI; i += 1) {
      const a = nodeIndex.get(nodeKey(i, row));
      for (const upperI of [i - 1, i]) {
        const b = nodeIndex.get(nodeKey(upperI, row + 1));
        if (b !== undefined && !(row + 1 === 2 && (nodes[b].x === 0 || nodes[b].x === span))) {
          addEdge(a, b, 'diagonal', row);
        }
      }
    }
  }

  const deckEdges = edges.filter(edge => {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    return edge.type === 'horizontal' && a.row === 0 && b.row === 0;
  });
  for (const edge of deckEdges) edge.mandatory = true;
  const optionalEdges = edges.filter(edge => !edge.mandatory);
  const roofModules = [];
  const roofNodes = [];
  if (rows >= 2) {
    const findEdge = (firstNode, secondNode) => optionalEdges.findIndex(edge =>
      (edge.a === firstNode && edge.b === secondNode) || (edge.a === secondNode && edge.b === firstNode));
    const roofNodeCount = span - 1;
    for (let i = 0; i < roofNodeCount; i += 1) {
      const upper = nodeIndex.get(nodeKey(i, 2));
      const diagonalEdges = [
        findEdge(upper, nodeIndex.get(nodeKey(i, 1))),
        findEdge(upper, nodeIndex.get(nodeKey(i + 1, 1))),
      ];
      const horizontalEdges = [
        i > 0 ? findEdge(upper, nodeIndex.get(nodeKey(i - 1, 2))) : -1,
        i < roofNodeCount - 1 ? findEdge(upper, nodeIndex.get(nodeKey(i + 1, 2))) : -1,
      ].filter(index => index >= 0);
      roofNodes.push({ column: i, node: upper, diagonalEdges, horizontalEdges });
    }
    for (let length = 1; length <= roofNodeCount; length += 1) {
      for (let start = 0; start + length <= roofNodeCount; start += 1) {
        const moduleEdges = [];
        for (let offset = 0; offset < length; offset += 1) {
          moduleEdges.push(...roofNodes[start + offset].diagonalEdges);
          if (offset < length - 1) {
            const horizontal = findEdge(roofNodes[start + offset].node, roofNodes[start + offset + 1].node);
            moduleEdges.push(horizontal);
          }
        }
        if (moduleEdges.every(index => index >= 0)) roofModules.push({ start, length, edges: moduleEdges });
      }
    }
  }
  const baselineGenome = createBaselineGenome(nodes, optionalEdges);
  const baselineStickCount = deckEdges.length + baselineGenome.reduce((sum, gene) => sum + gene, 0);
  if (maxSticks < baselineStickCount) {
    throw new RangeError(`Stick budget must be at least ${baselineStickCount} for the baseline bridge`);
  }
  const leftSupport = nodeIndex.get(nodeKey(0, 0));
  const rightSupport = nodeIndex.get(nodeKey(span, 0));
  const loadNode = nodeIndex.get(nodeKey(span / 2, 0));

  return {
    span,
    rows,
    maxSticks,
    nodes,
    edges,
    optionalEdges,
    roofModules,
    roofNodes,
    deckEdges,
    supports: {
      left: { node: leftSupport, type: 'pin' },
      right: { node: rightSupport, type: 'roller' },
    },
    loadNode,
    baselineGenome,
  };
}

function createBaselineGenome(nodes, optionalEdges) {
  const genome = new Uint8Array(optionalEdges.length);
  for (let index = 0; index < optionalEdges.length; index += 1) {
    const edge = optionalEdges[index];
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const isFirstTrussRow = a.row <= 1 && b.row <= 1;
    if (isFirstTrussRow) genome[index] = 1;
  }
  return genome;
}

export function cloneGenome(genome) {
  return new Uint8Array(genome);
}

export function decodeGenome(genome, topology) {
  if (!(genome instanceof Uint8Array) && !Array.isArray(genome)) {
    throw new TypeError('A bridge genome must be an array of binary edge genes');
  }
  if (genome.length !== topology.optionalEdges.length) {
    throw new RangeError(`Expected ${topology.optionalEdges.length} genes, received ${genome.length}`);
  }
  const members = topology.deckEdges.slice();
  for (let index = 0; index < topology.optionalEdges.length; index += 1) {
    if (genome[index]) members.push(topology.optionalEdges[index]);
  }
  return members;
}

export function validateBridge(genome, topology) {
  const members = decodeGenome(genome, topology);
  const degrees = new Uint16Array(topology.nodes.length);
  const adjacency = Array.from({ length: topology.nodes.length }, () => []);
  for (const member of members) {
    degrees[member.a] += 1;
    degrees[member.b] += 1;
    adjacency[member.a].push(member.b);
    adjacency[member.b].push(member.a);
  }

  const start = topology.supports.left.node;
  const reached = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of adjacency[queue[cursor]]) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const usedNodes = degrees.reduce((count, degree) => count + (degree > 0 ? 1 : 0), 0);
  const allUsedNodesConnected = reached.size === usedNodes;
  const loadReachable = reached.has(topology.loadNode);
  const stickCount = members.length;
  const withinBudget = stickCount <= topology.maxSticks;
  const issues = [];
  if (!withinBudget) issues.push('over-budget');
  if (!loadReachable) issues.push('load-not-connected-to-support');
  if (!allUsedNodesConnected) issues.push('disconnected-members');

  return {
    valid: issues.length === 0,
    issues,
    members,
    stickCount,
    withinBudget,
    loadReachable,
    allUsedNodesConnected,
  };
}

export function createInitialPopulation(size, seed, topology = createTopology()) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Population size must be a positive integer');
  }
  const random = createRandom(seed);
  const baseline = topology.baselineGenome;
  const baselineCount = decodeGenome(baseline, topology).length;
  const extraCapacity = Math.max(0, topology.maxSticks - baselineCount);
  const modules = topology.roofModules.filter(module => module.edges.length <= extraCapacity);
  const population = [cloneGenome(baseline)];
  const seen = new Set([genomeKey(baseline)]);
  for (const module of shuffle(modules, random)) {
    if (population.length >= size) break;
    const genome = cloneGenome(baseline);
    for (const edgeIndex of module.edges) genome[edgeIndex] = 1;
    const key = genomeKey(genome);
    if (!seen.has(key)) {
      seen.add(key);
      population.push(genome);
    }
  }
  let attempts = 0;
  while (population.length < size && attempts < size * 100) {
    attempts += 1;
    const genome = cloneGenome(baseline);
    if (modules.length) {
      const moduleCount = randomInt(random, 1, Math.min(3, modules.length));
      const selectedModules = shuffle(modules, random).slice(0, moduleCount);
      for (const module of selectedModules) {
        for (const edgeIndex of module.edges) genome[edgeIndex] = 1;
      }
    }
    const withinBudget = decodeGenome(genome, topology).length <= topology.maxSticks;
    const key = genomeKey(genome);
    if (withinBudget && !seen.has(key)) {
      seen.add(key);
      population.push(genome);
    }
  }
  while (population.length < size) population.push(cloneGenome(baseline));
  return population;
}

export function genomeKey(genome) {
  return Array.from(genome, value => value ? '1' : '0').join('');
}
