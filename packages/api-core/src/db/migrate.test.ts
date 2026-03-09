import test from 'node:test';
import assert from 'node:assert/strict';

import { migrate } from './migrate.js';
import { openDb } from './sqlite.js';

test('migrate creates core tables', () => {
  const db = openDb(':memory:');
  try {
    migrate(db);
    const rows = db
      .prepare("select name from sqlite_master where type in ('table', 'view') order by name asc")
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);

    assert.ok(names.includes('repositories'));
    assert.ok(names.includes('threads'));
    assert.ok(names.includes('documents'));
    assert.ok(names.includes('document_embeddings'));
    assert.ok(names.includes('cluster_runs'));
  } finally {
    db.close();
  }
});
