import { humanKeyForValue } from '../cluster/human-key.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import type { DurableTuiClosure } from '../service-types.js';

export function clusterHumanName(repoId: number, representativeThreadId: number | null, clusterId: number): string {
  return humanKeyForValue(
    representativeThreadId === null
      ? `repo:${repoId}:cluster:${clusterId}`
      : `repo:${repoId}:cluster-representative:${representativeThreadId}`,
  ).slug;
}

export function getDurableClosuresByRepresentative(
  db: SqliteDatabase,
  repoId: number,
  representativeThreadIds: number[],
): Map<number, DurableTuiClosure> {
  const uniqueThreadIds = Array.from(new Set(representativeThreadIds));
  if (uniqueThreadIds.length === 0) {
    return new Map();
  }

  const identities = uniqueThreadIds.map((threadId) => ({
    threadId,
    stableKey: humanKeyForValue(`repo:${repoId}:cluster-representative:${threadId}`).hash,
  }));
  const placeholders = identities.map(() => '?').join(',');
  const rows = db
    .prepare(
      `select cg.id, cg.stable_key, cg.status, coalesce(cc.updated_at, cg.closed_at) as closed_at, cc.reason
       from cluster_groups cg
       left join cluster_closures cc on cc.cluster_id = cg.id
       where cg.repo_id = ?
         and cg.stable_key in (${placeholders})
         and (cc.cluster_id is not null or cg.status in ('merged', 'split'))`,
    )
    .all(repoId, ...identities.map((identity) => identity.stableKey)) as Array<{
    id: number;
    stable_key: string;
    status: 'active' | 'closed' | 'merged' | 'split';
    closed_at: string | null;
    reason: string | null;
  }>;
  const threadIdByStableKey = new Map(identities.map((identity) => [identity.stableKey, identity.threadId]));
  const closures = new Map<number, DurableTuiClosure>();
  for (const row of rows) {
    const threadId = threadIdByStableKey.get(row.stable_key);
    if (threadId === undefined) continue;
    closures.set(threadId, {
      clusterId: row.id,
      status: row.status,
      closedAt: row.closed_at,
      reason: row.reason,
    });
  }
  return closures;
}
