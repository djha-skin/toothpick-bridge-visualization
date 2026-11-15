import { decodeGenome } from './bridge.mjs';
import { drawHistory } from './renderer.mjs';
import { rankEvaluations } from './genetics.mjs';

export function formatLoad(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} kg` : '—';
}

function miniatureSvg(genome, topology) {
  const geometry = decodeGenome(genome, topology);
  const maxY = Math.max(0.1, ...geometry.nodes.map(node => node.y));
  const point = node => ({
    x: 5 + node.x / topology.span * 90,
    y: 32 - node.y / maxY * 20,
  });
  const lines = geometry.members.map(member => {
    const a = point(geometry.nodes[member.a]);
    const b = point(geometry.nodes[member.b]);
    const color = member.band === 2 ? '#b9c58f' : '#dca969';
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 40" aria-hidden="true" focusable="false"><path d="M2 34H98" stroke="#536655" stroke-width="1"/>${lines}</svg>`;
}

function makeCandidateCard(evaluation, topology, index, { selectedIndex, activeIndex, testedCount, eliteIndices }) {
  const tested = index < testedCount;
  const isActive = index === activeIndex;
  const isSelected = index === selectedIndex;
  const score = tested ? formatLoad(evaluation.result.maxStableLoadKg) : (isActive ? 'Testing…' : 'Queued');
  const status = tested ? 'tested' : (isActive ? 'testing' : 'waiting');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `candidate-card${isSelected ? ' is-selected' : ''}${eliteIndices.has(index) ? ' is-elite' : ''}${tested && evaluation.result.collapsed ? ' is-failed' : ''}${isActive ? ' is-testing' : ''}`;
  button.dataset.selectIndex = String(index);
  button.setAttribute('aria-pressed', String(isSelected));
  button.setAttribute('aria-label', `Bridge ${index + 1}, ${evaluation.result.stickCount} of ${topology.maxSticks} toothpicks, ${status}, ${score}. Select bridge.`);
  button.innerHTML = `${miniatureSvg(evaluation.genome, topology)}<span class="candidate-meta"><span>BR ${String(index + 1).padStart(2, '0')}</span><span>${evaluation.result.stickCount} / ${topology.maxSticks} sticks</span></span><span class="candidate-score">${score}</span>`;
  return button;
}

export function renderPopulation(container, leaderboard, evaluations, topology, options = {}) {
  const selectedIndex = options.selectedIndex ?? 0;
  const activeIndex = options.activeIndex ?? -1;
  const testedCount = options.testedCount ?? evaluations.length;
  const rankedTested = rankEvaluations(evaluations.filter(item => item.index < testedCount));
  const eliteCount = options.eliteCount ?? 2;
  const eliteIndices = new Set(rankedTested.slice(0, eliteCount).map(item => item.index));
  const fragment = document.createDocumentFragment();

  if (!evaluations.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-population';
    empty.textContent = 'Start the experiment to see the first bridge designs.';
    fragment.append(empty);
  } else {
    for (const evaluation of evaluations) {
      fragment.append(makeCandidateCard(evaluation, topology, evaluation.index, {
        selectedIndex,
        activeIndex,
        testedCount,
        eliteIndices,
      }));
    }
  }
  container.replaceChildren(fragment);
  renderLeaderboard(leaderboard, rankedTested, options.leaderboardSize ?? 5);
}

export function renderLeaderboard(container, ranked, limit = 5) {
  const fragment = document.createDocumentFragment();
  if (!ranked.length) {
    const empty = document.createElement('li');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'Scores appear after testing.';
    fragment.append(empty);
  } else {
    ranked.slice(0, limit).forEach((evaluation, rank) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'leaderboard-entry';
      button.dataset.selectIndex = String(evaluation.index);
      button.setAttribute('aria-label', `Rank ${rank + 1}, bridge ${evaluation.index + 1}, ${formatLoad(evaluation.result.maxStableLoadKg)}. Select bridge.`);
      button.innerHTML = `<span class="rank-number">${String(rank + 1).padStart(2, '0')}</span><span>Bridge ${String(evaluation.index + 1).padStart(2, '0')}</span><span class="rank-load">${evaluation.result.maxStableLoadKg.toFixed(2)}</span>`;
      item.append(button);
      fragment.append(item);
    });
  }
  container.replaceChildren(fragment);
}

export function updateGenerationHistory(canvas, description, history) {
  drawHistory(canvas, history);
  if (!history.length) {
    description.textContent = 'Best and average loads will be charted here.';
    canvas.setAttribute('aria-label', 'Load history chart. No generations completed yet.');
    return;
  }
  const latest = history.at(-1);
  description.textContent = `Generation ${latest.generation}: best ${formatLoad(latest.bestKg)}, average ${formatLoad(latest.averageKg)}.`;
  canvas.setAttribute('aria-label', `Load history through generation ${latest.generation}. Best load ${formatLoad(latest.bestKg)}; average load ${formatLoad(latest.averageKg)}.`);
}

export function updateSummary({ generation, bestKg, averageKg, testedCount, populationSize, runState }) {
  document.querySelector('#generation-value').textContent = String(generation).padStart(2, '0');
  document.querySelector('#best-load').textContent = Number.isFinite(bestKg) ? bestKg.toFixed(2) : '—';
  document.querySelector('#average-load').textContent = Number.isFinite(averageKg) ? averageKg.toFixed(2) : '—';
  document.querySelector('#tested-count').textContent = String(testedCount);
  document.querySelector('#population-count').textContent = `/ ${populationSize}`;
  document.querySelector('#run-state').textContent = runState;
}
