import test from 'node:test';
import assert from 'node:assert/strict';

import {
  actionRequestSchema,
  clusterMergeResponseSchema,
  clusterOverrideResponseSchema,
  clusterSplitResponseSchema,
  durableClustersResponseSchema,
  excludeClusterMemberRequestSchema,
  healthResponseSchema,
  includeClusterMemberRequestSchema,
  mergeClustersRequestSchema,
  neighborsResponseSchema,
  searchResponseSchema,
  setClusterCanonicalRequestSchema,
  splitClusterRequestSchema,
} from './contracts.js';

test('health schema accepts configured status payload', () => {
  const parsed = healthResponseSchema.parse({
    ok: true,
    configPath: '/Users/example/.config/ghcrawl/config.json',
    configFileExists: true,
    dbPath: 'data/ghcrawl.db',
    apiPort: 5179,
    githubConfigured: true,
    openaiConfigured: false,
  });

  assert.equal(parsed.apiPort, 5179);
});

test('search schema rejects invalid mode', () => {
  assert.throws(() =>
    searchResponseSchema.parse({
      repository: {
        id: 1,
        owner: 'openclaw',
        name: 'openclaw',
        fullName: 'openclaw/openclaw',
        githubRepoId: null,
        updatedAt: new Date().toISOString(),
      },
      query: 'panic',
      mode: 'invalid',
      hits: [],
    }),
  );
});

test('action request accepts optional thread number', () => {
  const parsed = actionRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    action: 'summarize',
    threadNumber: 42,
  });

  assert.equal(parsed.threadNumber, 42);
});

test('exclude cluster member request trims optional reason', () => {
  const parsed = excludeClusterMemberRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    clusterId: 7,
    threadNumber: 42,
    reason: '  confirmed separate bug  ',
  });

  assert.equal(parsed.reason, 'confirmed separate bug');
});

test('set cluster canonical request trims optional reason', () => {
  const parsed = setClusterCanonicalRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    clusterId: 7,
    threadNumber: 42,
    reason: '  best root issue  ',
  });

  assert.equal(parsed.reason, 'best root issue');
});

test('include cluster member request trims optional reason', () => {
  const parsed = includeClusterMemberRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    clusterId: 7,
    threadNumber: 42,
    reason: '  same root cause  ',
  });

  assert.equal(parsed.reason, 'same root cause');
});

test('merge clusters request trims optional reason', () => {
  const parsed = mergeClustersRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    sourceClusterId: 7,
    targetClusterId: 8,
    reason: '  same root cause  ',
  });

  assert.equal(parsed.reason, 'same root cause');
});

test('split cluster request trims optional reason', () => {
  const parsed = splitClusterRequestSchema.parse({
    owner: 'openclaw',
    repo: 'openclaw',
    sourceClusterId: 7,
    threadNumbers: [42, 43],
    reason: '  separate root cause  ',
  });

  assert.equal(parsed.reason, 'separate root cause');
  assert.deepEqual(parsed.threadNumbers, [42, 43]);
});

test('cluster override response accepts durable removal state', () => {
  const parsed = clusterOverrideResponseSchema.parse({
    ok: true,
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    clusterId: 7,
    thread: {
      id: 10,
      repoId: 1,
      number: 42,
      kind: 'issue',
      state: 'open',
      isClosed: false,
      closedAtGh: null,
      closedAtLocal: null,
      closeReasonLocal: null,
      title: 'Downloader hangs',
      body: 'The transfer never finishes.',
      authorLogin: 'alice',
      htmlUrl: 'https://github.com/openclaw/openclaw/issues/42',
      labels: ['bug'],
      updatedAtGh: new Date().toISOString(),
      clusterId: null,
    },
    action: 'exclude',
    state: 'removed_by_user',
    message: 'Removed issue #42 from cluster 7.',
  });

  assert.equal(parsed.state, 'removed_by_user');
});

test('cluster override response accepts force canonical action', () => {
  const parsed = clusterOverrideResponseSchema.parse({
    ok: true,
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    clusterId: 7,
    thread: {
      id: 10,
      repoId: 1,
      number: 42,
      kind: 'issue',
      state: 'open',
      isClosed: false,
      closedAtGh: null,
      closedAtLocal: null,
      closeReasonLocal: null,
      title: 'Downloader hangs',
      body: 'The transfer never finishes.',
      authorLogin: 'alice',
      htmlUrl: 'https://github.com/openclaw/openclaw/issues/42',
      labels: ['bug'],
      updatedAtGh: new Date().toISOString(),
      clusterId: null,
    },
    action: 'force_canonical',
    state: 'active',
    message: 'Set issue #42 as canonical for cluster 7.',
  });

  assert.equal(parsed.action, 'force_canonical');
});

test('cluster merge response accepts source and target ids', () => {
  const parsed = clusterMergeResponseSchema.parse({
    ok: true,
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    sourceClusterId: 7,
    targetClusterId: 8,
    message: 'merged',
  });

  assert.equal(parsed.targetClusterId, 8);
});

test('cluster split response accepts source and new ids', () => {
  const parsed = clusterSplitResponseSchema.parse({
    ok: true,
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    sourceClusterId: 7,
    newClusterId: 8,
    movedCount: 2,
    message: 'split',
  });

  assert.equal(parsed.newClusterId, 8);
});

test('durable clusters response accepts stable slugs and governed member states', () => {
  const parsed = durableClustersResponseSchema.parse({
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    clusters: [
      {
        clusterId: 7,
        stableKey: 'abc123',
        stableSlug: 'trace-alpha-river',
        status: 'active',
        clusterType: 'duplicate_candidate',
        title: 'Cluster trace-alpha-river',
        representativeThreadId: 10,
        activeCount: 1,
        removedCount: 1,
        blockedCount: 0,
        members: [
          {
            thread: {
              id: 10,
              repoId: 1,
              number: 42,
              kind: 'issue',
              state: 'open',
              isClosed: false,
              closedAtGh: null,
              closedAtLocal: null,
              closeReasonLocal: null,
              title: 'Downloader hangs',
              body: 'The transfer never finishes.',
              authorLogin: 'alice',
              htmlUrl: 'https://github.com/openclaw/openclaw/issues/42',
              labels: ['bug'],
              updatedAtGh: new Date().toISOString(),
              clusterId: null,
            },
            role: 'canonical',
            state: 'active',
            scoreToRepresentative: 1,
          },
        ],
      },
    ],
  });

  assert.equal(parsed.clusters[0]?.stableSlug, 'trace-alpha-river');
});

test('neighbors schema accepts repository, source thread, and neighbor list', () => {
  const parsed = neighborsResponseSchema.parse({
    repository: {
      id: 1,
      owner: 'openclaw',
      name: 'openclaw',
      fullName: 'openclaw/openclaw',
      githubRepoId: null,
      updatedAt: new Date().toISOString(),
    },
    thread: {
      id: 10,
      repoId: 1,
      number: 42,
      kind: 'issue',
      state: 'open',
      isClosed: false,
      closedAtGh: null,
      closedAtLocal: null,
      closeReasonLocal: null,
      title: 'Downloader hangs',
      body: 'The transfer never finishes.',
      authorLogin: 'alice',
      htmlUrl: 'https://github.com/openclaw/openclaw/issues/42',
      labels: ['bug'],
      updatedAtGh: new Date().toISOString(),
      clusterId: null,
    },
    neighbors: [
      {
        threadId: 11,
        number: 43,
        kind: 'pull_request',
        title: 'Fix downloader hang',
        score: 0.93,
      },
    ],
  });

  assert.equal(parsed.neighbors[0].number, 43);
});
