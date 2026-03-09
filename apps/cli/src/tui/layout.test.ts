import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTuiLayout } from './layout.js';

test('computeTuiLayout uses wide mode for large terminals', () => {
  const layout = computeTuiLayout(160, 40);
  assert.equal(layout.mode, 'wide');
  assert.equal(layout.clusters.top, 1);
  assert.equal(layout.footer.top, 35);
  assert.equal(layout.footer.height, 5);
});

test('computeTuiLayout switches to stacked mode for narrow terminals', () => {
  const layout = computeTuiLayout(100, 30);
  assert.equal(layout.mode, 'stacked');
  assert.equal(layout.members.top > layout.clusters.top, true);
  assert.equal(layout.detail.top > layout.members.top, true);
});
