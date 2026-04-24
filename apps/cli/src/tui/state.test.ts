import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyClusterFilters,
  buildMemberRows,
  cycleFocusPane,
  cycleMinSizeFilter,
  cycleSortMode,
  findSelectableIndex,
  formatMemberListHeader,
  formatRelativeTime,
  moveSelectableIndex,
  preserveSelectedId,
} from './state.js';
import type { TuiClusterDetail, TuiClusterSummary } from '@ghcrawl/api-core';

test('cycleSortMode toggles size and recent', () => {
  assert.equal(cycleSortMode('size'), 'recent');
  assert.equal(cycleSortMode('recent'), 'size');
});

test('cycleMinSizeFilter rotates through presets', () => {
  assert.equal(cycleMinSizeFilter(1), 2);
  assert.equal(cycleMinSizeFilter(2), 10);
  assert.equal(cycleMinSizeFilter(10), 20);
  assert.equal(cycleMinSizeFilter(20), 50);
  assert.equal(cycleMinSizeFilter(50), 0);
  assert.equal(cycleMinSizeFilter(0), 1);
});

test('cycleFocusPane moves forward and backward', () => {
  assert.equal(cycleFocusPane('clusters', 1), 'members');
  assert.equal(cycleFocusPane('clusters', -1), 'detail');
});

test('formatRelativeTime returns compact human readable ages', () => {
  const now = new Date('2026-04-24T12:00:00Z');
  assert.equal(formatRelativeTime('2026-04-24T11:58:00Z', now), '2m ago');
  assert.equal(formatRelativeTime('2026-04-24T06:00:00Z', now), '6h ago');
  assert.equal(formatRelativeTime('2026-04-18T12:00:00Z', now), '6d ago');
  assert.equal(formatRelativeTime('2026-03-12T12:00:00Z', now), '43d ago');
  assert.equal(formatRelativeTime('2026-01-12T12:00:00Z', now), '3mo ago');
});

test('applyClusterFilters sorts by recent and size and respects min size/search', () => {
  const clusters: TuiClusterSummary[] = [
    {
      clusterId: 1,
      displayTitle: 'Older larger',
      isClosed: false,
      closedAtLocal: null,
      closeReasonLocal: null,
      totalCount: 12,
      issueCount: 10,
      pullRequestCount: 2,
      latestUpdatedAt: '2026-03-09T10:00:00Z',
      representativeThreadId: 10,
      representativeNumber: 42,
      representativeKind: 'issue',
      searchText: 'older larger cluster',
    },
    {
      clusterId: 2,
      displayTitle: 'Newest smaller',
      isClosed: false,
      closedAtLocal: null,
      closeReasonLocal: null,
      totalCount: 11,
      issueCount: 8,
      pullRequestCount: 3,
      latestUpdatedAt: '2026-03-09T11:00:00Z',
      representativeThreadId: 11,
      representativeNumber: 43,
      representativeKind: 'pull_request',
      searchText: 'newest smaller cluster',
    },
  ];

  assert.deepEqual(
    applyClusterFilters(clusters, { sortMode: 'recent', minSize: 10, search: '' }).map((cluster) => cluster.clusterId),
    [2, 1],
  );
  assert.deepEqual(
    applyClusterFilters(clusters, { sortMode: 'size', minSize: 10, search: '' }).map((cluster) => cluster.clusterId),
    [1, 2],
  );
  assert.deepEqual(
    applyClusterFilters(clusters, { sortMode: 'recent', minSize: 20, search: '' }),
    [],
  );
  assert.deepEqual(
    applyClusterFilters(clusters, { sortMode: 'recent', minSize: 0, search: 'newest' }).map((cluster) => cluster.clusterId),
    [2],
  );
});

test('preserveSelectedId keeps existing selection and falls back to first', () => {
  assert.equal(preserveSelectedId([10, 11], 11), 11);
  assert.equal(preserveSelectedId([10, 11], 99), 10);
  assert.equal(preserveSelectedId([], 99), null);
});

test('buildMemberRows groups issues and pull requests and selection skips headers', () => {
  const detail: TuiClusterDetail = {
    clusterId: 1,
    displayTitle: 'Cluster 1',
    isClosed: false,
    closedAtLocal: null,
    closeReasonLocal: null,
    totalCount: 2,
    issueCount: 1,
    pullRequestCount: 1,
    latestUpdatedAt: '2026-03-09T11:00:00Z',
    representativeThreadId: 10,
    representativeNumber: 42,
    representativeKind: 'issue',
    members: [
      {
        id: 10,
        number: 42,
        kind: 'issue',
        isClosed: false,
        title: 'Issue one',
        updatedAtGh: '2026-03-09T11:00:00Z',
        htmlUrl: 'https://example.com/42',
        labels: ['bug'],
        clusterScore: null,
      },
      {
        id: 11,
        number: 43,
        kind: 'pull_request',
        isClosed: true,
        title: '[Bug]: PR one',
        updatedAtGh: '2026-03-09T10:00:00Z',
        htmlUrl: 'https://example.com/43',
        labels: ['bug'],
        clusterScore: 0.92,
      },
    ],
  };

  const rows = buildMemberRows(detail);
  assert.equal(rows[0]?.selectable, false);
  assert.match(rows[0]?.label ?? '', /number\s+state\s+updated\s+title/);
  assert.match(rows[2]?.label ?? '', /#42\s+open\s+\d+d ago\s+Issue one/);
  assert.match(rows[4]?.label ?? '', /closed\s+\d+d ago\s+Bug: PR one/);
  assert.equal(findSelectableIndex(rows, 10), 2);
  assert.equal(moveSelectableIndex(rows, 2, 1), 4);
});

test('formatMemberListHeader aligns the member table columns', () => {
  assert.equal(formatMemberListHeader(), 'number  state  updated title');
});
