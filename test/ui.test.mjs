import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLoad } from '../src/ui.mjs';

test('completed load formatting exposes hundredths without changing fitness precision', () => {
  assert.equal(formatLoad(1.41), '1.41 kg');
  assert.equal(formatLoad(1.44), '1.44 kg');
  assert.equal(formatLoad(Number.NaN), '—');
});
