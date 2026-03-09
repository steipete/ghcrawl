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
  assert.equal(config.summaryModel, 'gpt-5-mini');
  assert.equal(config.embedModel, 'text-embedding-3-large');
  assert.equal(config.embedBatchSize, 8);
  assert.equal(config.embedConcurrency, 10);
  assert.equal(config.embedMaxUnread, 20);
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

test('loadConfig rejects invalid embed queue settings', () => {
  assert.throws(() =>
    loadConfig({
      cwd: process.cwd(),
      env: { ...process.env, GITCRAWL_EMBED_CONCURRENCY: '0' },
    }),
  );
});
