import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('workshop has semantic landmarks and accessible canvas descriptions', () => {
  assert.match(html, /<header\b/);
  assert.match(html, /<main\b/);
  assert.match(html, /<footer\b/);
  assert.match(html, /id="bridge-canvas"[^>]*role="img"[^>]*aria-label=/);
  assert.match(html, /id="history-canvas"[^>]*role="img"[^>]*aria-label=/);
  assert.match(html, /id="test-status"[^>]*role="status"/);
});

test('inputs have labels and buttons have visible or programmatic names', () => {
  for (const id of ['speed-control', 'mutation-control', 'seed-input']) {
    assert.match(html, new RegExp(`<label[^>]+for="${id}"`));
  }
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  for (const [, attributes, contents] of buttons) {
    assert.ok(/aria-label=/.test(attributes) || contents.replace(/<[^>]+>/g, '').trim(), `unnamed button: ${attributes}`);
  }
});

test('layout includes mobile breakpoints, keyboard focus, and reduced-motion support', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
