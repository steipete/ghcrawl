import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from './config.js';

test('loadConfig applies defaults', () => {
  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITCRAWL_DB_PATH: 'data/test.db',
      GITCRAWL_API_PORT: '6123',
    },
  });

  assert.equal(config.apiPort, 6123);
  assert.equal(config.summaryModel, 'gpt-4.1-mini');
  assert.match(config.dbPath, /data\/test\.db$/);
});

test('loadConfig rejects invalid port', () => {
  assert.throws(() =>
    loadConfig({
      cwd: process.cwd(),
      env: { ...process.env, GITCRAWL_API_PORT: 'abc' },
    }),
  );
});
