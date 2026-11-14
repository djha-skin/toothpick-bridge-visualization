import { decodeGenome, validateBridge } from './bridge.mjs';

// Illustrative tuning values, not measured toothpick or glue properties.
export const DEFAULT_MATERIAL = Object.freeze({
  axialRigidity: 1,
  tensileStrengthN: 120,
  compressiveStrengthN: 28,
  referenceLength: 1,
  gravity: 9.81,
});

const SINGULAR_RELATIVE_TOLERANCE = 1e-11;
const FAILURE_LOAD_TOLERANCE = 1e-8;

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  if (size === 0) return [];
  const a = matrix.map((row, index) => [...row, vector[index]]);
  let scale = 0;
  for (const row of matrix) {
    for (const value of row) scale = Math.max(scale, Math.abs(value));
  }
  const pivotTolerance = Math.max(1e-14, scale * SINGULAR_RELATIVE_TOLERANCE);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) <= pivotTolerance) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];

    const pivotValue = a[column][column];
    for (let entry = column; entry <= size; entry += 1) a[column][entry] /= pivotValue;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let entry = column; entry <= size; entry += 1) {
        a[row][entry] -= factor * a[column][entry];
      }
    }
  }
  return a.map(row => row[size]);
}

/**
 * Solve a pin-jointed 2D truss under a set of point loads.
 * Supports use { node, x, y }, where x/y indicate restrained translations.
 * Member force is positive in tension and negative in compression.
 */
export function solveTruss({ nodes, members, supports, loads, axialRigidity = DEFAULT_MATERIAL.axialRigidity }) {
  const restrained = new Set();
  const supportByNode = new Map();
  for (const support of supports) {
    const flags = { x: Boolean(support.x), y: Boolean(support.y) };
    supportByNode.set(support.node, flags);
    if (flags.x) restrained.add(`${support.node}:x`);
    if (flags.y) restrained.add(`${support.node}:y`);
  }

  const relevantNodes = new Set();
  for (const member of members) {
    relevantNodes.add(member.a);
    relevantNodes.add(member.b);
  }
  for (const load of loads) relevantNodes.add(load.node);
  for (const support of supports) relevantNodes.add(support.node);

  const freeDofs = [];
  const freeIndex = new Map();
  for (let node = 0; node < nodes.length; node += 1) {
    if (!relevantNodes.has(node)) continue;
    for (const axis of ['x', 'y']) {
      const key = `${node}:${axis}`;
      if (restrained.has(key)) continue;
      freeIndex.set(key, freeDofs.length);
      freeDofs.push({ node, axis });
    }
  }

  const stiffness = Array.from({ length: freeDofs.length }, () => new Float64Array(freeDofs.length));
  const forceVector = new Float64Array(freeDofs.length);
  const appliedLoads = Array.from({ length: nodes.length }, () => ({ x: 0, y: 0 }));
  for (const load of loads) {
    appliedLoads[load.node].x += load.x ?? 0;
    appliedLoads[load.node].y += load.y ?? 0;
    for (const axis of ['x', 'y']) {
      const index = freeIndex.get(`${load.node}:${axis}`);
      if (index !== undefined) forceVector[index] += load[axis] ?? 0;
    }
  }

  for (const member of members) {
    const a = nodes[member.a];
    const b = nodes[member.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) {
      return { stable: false, reason: 'invalid-member-length', displacements: [], memberForces: [] };
    }
    const c = dx / length;
    const s = dy / length;
    const coefficient = (member.axialRigidity ?? axialRigidity) / length;
    const direction = [c, s, -c, -s];
    const dofs = [
      freeIndex.get(`${member.a}:x`), freeIndex.get(`${member.a}:y`),
      freeIndex.get(`${member.b}:x`), freeIndex.get(`${member.b}:y`),
    ];
    for (let row = 0; row < 4; row += 1) {
      const globalRow = dofs[row];
      if (globalRow === undefined) continue;
      for (let column = 0; column < 4; column += 1) {
        const globalColumn = dofs[column];
        if (globalColumn === undefined) continue;
        stiffness[globalRow][globalColumn] += coefficient * direction[row] * direction[column];
      }
    }
  }

  const solution = solveLinearSystem(stiffness, forceVector);
  if (solution === null) {
    return { stable: false, reason: 'unstable-or-singular-truss', displacements: [], memberForces: [] };
  }

  const displacements = Array.from({ length: nodes.length }, () => ({ x: 0, y: 0 }));
  for (const [key, index] of freeIndex) {
    const [node, axis] = key.split(':');
    displacements[Number(node)][axis] = solution[index];
  }

  const nodalMemberForces = Array.from({ length: nodes.length }, () => ({ x: 0, y: 0 }));
  const memberForces = members.map(member => {
    const a = nodes[member.a];
    const b = nodes[member.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const c = dx / length;
    const s = dy / length;
    const extension = (displacements[member.b].x - displacements[member.a].x) * c
      + (displacements[member.b].y - displacements[member.a].y) * s;
    const force = (member.axialRigidity ?? axialRigidity) / length * extension;
    nodalMemberForces[member.a].x += force * c;
    nodalMemberForces[member.a].y += force * s;
    nodalMemberForces[member.b].x -= force * c;
    nodalMemberForces[member.b].y -= force * s;
    return { id: member.id, force, type: force >= 0 ? 'tension' : 'compression' };
  });

  const reactions = [];
  for (const [node, flags] of supportByNode) {
    reactions.push({
      node,
      x: flags.x ? -(nodalMemberForces[node].x + appliedLoads[node].x) : 0,
      y: flags.y ? -(nodalMemberForces[node].y + appliedLoads[node].y) : 0,
    });
  }
  return { stable: true, displacements, memberForces, reactions };
}

function capacitiesFor(member, material, nodes) {
  const length = member.length ?? Math.hypot(
    nodes[member.b].x - nodes[member.a].x,
    nodes[member.b].y - nodes[member.a].y,
  );
  const lengthFactor = (material.referenceLength / length) ** 2;
  return {
    tension: material.tensileStrengthN,
    compression: material.compressiveStrengthN * lengthFactor,
  };
}

function kgEquivalent(forceN, gravity) {
  return forceN / gravity;
}

/**
 * Compute the deterministic event sequence for a bridge under a center load.
 * The unit-load solve finds the next failure threshold; rendering can animate
 * between those thresholds without solving on every animation frame.
 */
export function evaluateBridge(genome, topology, options = {}) {
  const material = { ...DEFAULT_MATERIAL, ...options.material };
  const validation = validateBridge(genome, topology);
  if (!validation.valid) {
    return {
      valid: false,
      collapsed: true,
      failureLoadN: 0,
      maxStableLoadN: 0,
      maxStableLoadKg: 0,
      events: [],
      invalidReasons: validation.issues,
      stickCount: validation.stickCount,
    };
  }

  const loadNode = topology.loadNode;
  const supportSpecs = [
    { node: topology.supports.left.node, x: true, y: true },
    { node: topology.supports.right.node, x: false, y: true },
  ];
  const allMembers = validation.members;
  let activeMembers = allMembers.slice();
  let currentLoadN = 0;
  let maxStableLoadN = 0;
  const events = [];

  for (let breakIndex = 0; breakIndex <= allMembers.length; breakIndex += 1) {
    const solution = solveTruss({
      nodes: topology.nodes,
      members: activeMembers,
      supports: supportSpecs,
      loads: [{ node: loadNode, x: 0, y: -1 }],
      axialRigidity: material.axialRigidity,
    });
    if (!solution.stable) {
      if (events.length) events[events.length - 1].collapse = true;
      return {
        valid: true,
        collapsed: true,
        collapseReason: solution.reason,
        failureLoadN: currentLoadN,
        maxStableLoadN,
        maxStableLoadKg: kgEquivalent(maxStableLoadN, material.gravity),
        events,
        stickCount: validation.stickCount,
      };
    }

    const byId = new Map(solution.memberForces.map(item => [item.id, item.force]));
    const thresholds = activeMembers.map(member => {
      const unitForce = byId.get(member.id) ?? 0;
      const capacities = capacitiesFor(member, material, topology.nodes);
      const capacity = unitForce >= 0 ? capacities.tension : capacities.compression;
      const threshold = Math.abs(unitForce) > 1e-12 ? capacity / Math.abs(unitForce) : Number.POSITIVE_INFINITY;
      return { member, unitForce, threshold };
    });
    const nextThreshold = Math.min(...thresholds.map(item => item.threshold));
    if (!Number.isFinite(nextThreshold)) {
      return {
        valid: true,
        collapsed: false,
        failureLoadN: Number.POSITIVE_INFINITY,
        maxStableLoadN: Number.POSITIVE_INFINITY,
        maxStableLoadKg: Number.POSITIVE_INFINITY,
        events,
        stickCount: validation.stickCount,
      };
    }

    currentLoadN = Math.max(currentLoadN, nextThreshold);
    maxStableLoadN = currentLoadN;
    const candidates = thresholds
      .filter(item => item.threshold <= currentLoadN + Math.max(FAILURE_LOAD_TOLERANCE, currentLoadN * FAILURE_LOAD_TOLERANCE))
      .sort((a, b) => a.threshold - b.threshold || allMembers.indexOf(a.member) - allMembers.indexOf(b.member));
    if (candidates.length === 0) {
      return {
        valid: true,
        collapsed: false,
        failureLoadN: currentLoadN,
        maxStableLoadN,
        maxStableLoadKg: kgEquivalent(maxStableLoadN, material.gravity),
        events,
        stickCount: validation.stickCount,
      };
    }

    const failed = candidates[0];
    const forceSnapshot = thresholds.map(item => ({
      id: item.member.id,
      forceN: item.unitForce * currentLoadN,
      type: item.unitForce >= 0 ? 'tension' : 'compression',
    }));
    const reactionSnapshot = solution.reactions.map(reaction => ({
      node: reaction.node,
      xN: reaction.x * currentLoadN,
      yN: reaction.y * currentLoadN,
    }));
    events.push({
      loadN: currentLoadN,
      loadKg: kgEquivalent(currentLoadN, material.gravity),
      brokenMemberIds: [failed.member.id],
      memberForces: forceSnapshot,
      reactions: reactionSnapshot,
      collapse: false,
    });
    activeMembers = activeMembers.filter(member => member.id !== failed.member.id);
  }

  if (events.length) events[events.length - 1].collapse = true;
  return {
    valid: true,
    collapsed: true,
    collapseReason: 'all-members-failed',
    failureLoadN: currentLoadN,
    maxStableLoadN,
    maxStableLoadKg: kgEquivalent(maxStableLoadN, material.gravity),
    events,
    stickCount: validation.stickCount,
  };
}
