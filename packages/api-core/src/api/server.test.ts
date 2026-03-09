import test from 'node:test';
import assert from 'node:assert/strict';

import { healthResponseSchema } from '@gitcrawl/api-contract';

import { createApiServer } from './server.js';
import { GitcrawlService } from '../service.js';

test('health endpoint returns contract payload', async () => {
  const service = new GitcrawlService({
    config: {
      workspaceRoot: process.cwd(),
      dbPath: ':memory:',
      apiPort: 5179,
      summaryModel: 'gpt-4.1-mini',
      embedModel: 'text-embedding-3-small',
      openSearchIndex: 'gitcrawl-threads',
    },
    github: {
      checkAuth: async () => undefined,
      getRepo: async () => ({}),
      listRepositoryIssues: async () => [],
      getPull: async () => ({}),
      listIssueComments: async () => [],
      listPullReviews: async () => [],
      listPullReviewComments: async () => [],
    },
  });

  const server = createApiServer(service);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    const payload = healthResponseSchema.parse((await response.json()) as unknown);

    assert.equal(payload.ok, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    service.close();
  }
});
