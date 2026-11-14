import { DEFAULT_MATERIAL } from './truss.mjs';

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function bridgeLayout(width, height, topology) {
  const maxY = Math.max(1, ...topology.nodes.map(node => node.y));
  const scale = Math.min((width * 0.84) / topology.span, (height * 0.42) / maxY);
  const spanWidth = topology.span * scale;
  const left = (width - spanWidth) / 2;
  const deckY = height * 0.66;
  const points = topology.nodes.map(node => ({
    x: left + node.x * scale,
    y: deckY - node.y * scale,
  }));
  return { points, left, right: left + spanWidth, deckY, scale };
}

function drawGrid(ctx, width, height) {
  ctx.fillStyle = '#131b1b';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(151, 169, 153, .075)';
  ctx.lineWidth = 1;
  for (let x = 12; x < width; x += 28) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 12; y < height; y += 28) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

function drawBanks(ctx, layout, height) {
  const { left, right, deckY } = layout;
  ctx.fillStyle = '#28332e';
  ctx.fillRect(0, deckY + 18, left + 8, height - deckY - 18);
  ctx.fillRect(right - 8, deckY + 18, Math.max(0, ctx.canvas.clientWidth - right + 8), height - deckY - 18);
  ctx.fillStyle = '#425043';
  ctx.fillRect(left - 14, deckY + 9, 28, 13);
  ctx.fillRect(right - 14, deckY + 9, 28, 13);
  ctx.strokeStyle = '#536655';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, deckY + 18); ctx.lineTo(left + 8, deckY + 18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(right - 8, deckY + 18); ctx.lineTo(ctx.canvas.clientWidth, deckY + 18); ctx.stroke();
}

function memberUtilization(member, force, material) {
  if (!force) return 0;
  if (force.type === 'tension') return Math.abs(force.forceN) / material.tensileStrengthN;
  const length = member.length || 1;
  const capacity = material.compressiveStrengthN * (material.referenceLength / length) ** 2;
  return Math.abs(force.forceN) / capacity;
}

function drawMember(ctx, edge, points, force, broken, material, scale) {
  const a = points[edge.a];
  const b = points[edge.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const width = Math.max(2.1, Math.min(5.2, scale * 0.045));

  ctx.lineCap = 'round';
  if (broken) {
    const gap = Math.max(6, scale * 0.12);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const halfGap = gap / 2;
    ctx.strokeStyle = 'rgba(239, 118, 104, .78)';
    ctx.lineWidth = width + 0.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(midpoint.x - ux * halfGap, midpoint.y - uy * halfGap);
    ctx.moveTo(midpoint.x + ux * halfGap, midpoint.y + uy * halfGap);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ef7668';
    ctx.beginPath(); ctx.arc(midpoint.x, midpoint.y, 2.8, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const utilization = memberUtilization(edge, force, material);
  let color = '#d9a667';
  if (force?.type === 'compression') color = '#78b6d8';
  else if (force?.type === 'tension') color = '#edbb72';
  if (utilization >= 0.82) color = '#ef7668';
  ctx.strokeStyle = 'rgba(8, 11, 11, .45)';
  ctx.lineWidth = width + 2;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width + Math.min(1.8, utilization * 1.4);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function drawSupport(ctx, point, type) {
  ctx.fillStyle = '#b4c1a8';
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + 8);
  ctx.lineTo(point.x - 11, point.y + 25);
  ctx.lineTo(point.x + 11, point.y + 25);
  ctx.closePath(); ctx.fill();
  if (type === 'roller') {
    ctx.fillStyle = '#81907b';
    ctx.beginPath(); ctx.arc(point.x, point.y + 30, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(point.x, point.y + 39, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLoad(ctx, point, loadKg, collapsed, scale, height) {
  const hangerLength = Math.max(16, Math.min(48, height * 0.092));
  const weightHeight = Math.max(17, Math.min(39, height * 0.075));
  const weightWidth = Math.max(32, Math.min(60, scale * 0.52));
  const top = point.y + hangerLength + (collapsed ? 12 : 0);
  ctx.strokeStyle = '#d6dccf';
  ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(point.x, point.y + 5); ctx.lineTo(point.x, top); ctx.stroke();
  ctx.fillStyle = collapsed ? '#b85b4f' : '#cf7852';
  ctx.beginPath();
  ctx.roundRect(point.x - weightWidth / 2, top, weightWidth, weightHeight, 4);
  ctx.fill();
  ctx.fillStyle = '#fff1df';
  ctx.font = `500 ${Math.max(8, scale * 0.105)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.max(0, loadKg).toFixed(1)} kg`, point.x, top + weightHeight / 2);
  ctx.textBaseline = 'alphabetic';
}

export function drawBridge(canvas, topology, genome, frame = {}, options = {}) {
  const { context: ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  const layout = bridgeLayout(width, height, topology);
  drawBanks(ctx, layout, height);

  const selectedEdges = options.members ?? topology.deckEdges.concat(
    topology.optionalEdges.filter((_, index) => genome[index]),
  );
  const forces = new Map((frame.memberForces ?? []).map(force => [force.id, force]));
  const broken = frame.brokenMemberIds ?? new Set();
  const material = { ...DEFAULT_MATERIAL, ...options.material };
  for (const edge of selectedEdges) {
    drawMember(ctx, edge, layout.points, forces.get(edge.id), broken.has(edge.id), material, layout.scale);
  }

  // Joints and supports.
  const leftSupport = layout.points[topology.supports.left.node];
  const rightSupport = layout.points[topology.supports.right.node];
  for (const edge of selectedEdges) {
    for (const index of [edge.a, edge.b]) {
      const point = layout.points[index];
      ctx.fillStyle = broken.has(edge.id) ? '#ef7668' : '#f1d09d';
      ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2.6, layout.scale * 0.055), 0, Math.PI * 2); ctx.fill();
    }
  }
  drawSupport(ctx, leftSupport, 'pin');
  drawSupport(ctx, rightSupport, 'roller');

  // Waterline, span, and stage annotations.
  ctx.strokeStyle = 'rgba(120, 183, 190, .35)';
  ctx.lineWidth = 1;
  const waterY = Math.min(height - 24, layout.deckY + 58);
  ctx.beginPath(); ctx.moveTo(0, waterY); ctx.lineTo(width, waterY); ctx.stroke();
  ctx.strokeStyle = 'rgba(237, 240, 231, .35)';
  ctx.setLineDash([4, 4]);
  const spanLineY = Math.min(height - 27, layout.deckY + 50);
  ctx.beginPath(); ctx.moveTo(leftSupport.x, spanLineY); ctx.lineTo(rightSupport.x, spanLineY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(237, 240, 231, .52)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${topology.span} TOOTHPICK SPAN`, (leftSupport.x + rightSupport.x) / 2, Math.min(height - 7, layout.deckY + 67));

  const loadPoint = layout.points[topology.loadNode];
  drawLoad(ctx, loadPoint, frame.currentLoadKg ?? 0, frame.collapsed, layout.scale, height);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(237, 240, 231, .48)';
  ctx.fillText(frame.collapsed ? 'STRUCTURE FAILED' : 'STATIC TRUSS · SIDE VIEW', 14, 20);
}

export function drawHistory(canvas, history = []) {
  const { context: ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#141a1b'; ctx.fillRect(0, 0, width, height);

  const margin = { top: 14, right: 14, bottom: 28, left: 35 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const values = history.flatMap(point => [point.bestKg, point.averageKg]).filter(Number.isFinite);
  const maxValue = Math.max(1, ...values) * 1.12;

  ctx.strokeStyle = 'rgba(150, 163, 154, .15)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#7f8b82';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  for (let line = 0; line <= 3; line += 1) {
    const ratio = line / 3;
    const y = margin.top + plotHeight * ratio;
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
    ctx.fillText((maxValue * (1 - ratio)).toFixed(1), margin.left - 5, y + 3);
  }
  ctx.textAlign = 'center';
  ctx.fillText('GENERATION', margin.left + plotWidth / 2, height - 7);
  if (!history.length) return;

  const xAt = index => history.length === 1
    ? margin.left + plotWidth / 2
    : margin.left + plotWidth * index / (history.length - 1);
  const yAt = value => margin.top + plotHeight * (1 - Math.max(0, value) / maxValue);
  for (const [key, color] of [['averageKg', '#a7c68b'], ['bestKg', '#e9ae68']]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((point, index) => {
      const x = xAt(index);
      const y = yAt(point[key]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    for (let index = 0; index < history.length; index += 1) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(xAt(index), yAt(history[index][key]), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
