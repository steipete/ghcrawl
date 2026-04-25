import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import type { RepositoryDto } from '@ghcrawl/api-contract';

import { checkpointWal, openDb, type SqliteDatabase } from '../db/sqlite.js';
import {
  DEFAULT_PORTABLE_BODY_CHARS,
  PORTABLE_SYNC_EXCLUDED_TABLES,
  PORTABLE_SYNC_SCHEMA_VERSION,
  PORTABLE_SYNC_TABLES,
  type PortableRepoSnapshot,
  type PortableSyncExportOptions,
  type PortableSyncExportResponse,
  type PortableSyncImportResponse,
  type PortableSyncManifest,
  type PortableSyncProfile,
  type PortableSyncSizeResponse,
  type PortableSyncStatusResponse,
  type PortableSyncValidationResponse,
} from './types.js';

export * from './types.js';

export function exportPortableSyncDatabase(params: PortableSyncExportOptions): PortableSyncExportResponse {
  const profile: PortableSyncProfile | 'default' = params.profile ?? 'default';
  const bodyChars = params.bodyChars ?? bodyCharsForProfile(params.profile);
  if (!Number.isSafeInteger(bodyChars) || bodyChars < 0) {
    throw new Error('bodyChars must be a non-negative integer');
  }

  const sourcePath = path.resolve(params.sourcePath);
  const outputPath = path.resolve(params.outputPath);
  if (outputPath === sourcePath) {
    throw new Error('Refusing to export portable sync database over the source database');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tmpPath, { force: true });
  fs.rmSync(`${tmpPath}-wal`, { force: true });
  fs.rmSync(`${tmpPath}-shm`, { force: true });

  checkpointWal(params.sourceDb);
  const out = openDb(tmpPath);
  try {
    out.pragma('journal_mode = DELETE');
    out.exec('pragma foreign_keys = OFF');
    createPortableSyncSchema(out);
    out.exec(`attach database ${sqlStringLiteral(sourcePath)} as source`);
    populatePortableSyncDb(out, {
      repoId: params.repository.id,
      sourcePath,
      bodyChars,
    });
    out.exec('detach database source');
    out.exec('pragma foreign_keys = ON');
    out.exec('analyze');
    out.exec('pragma optimize');
    out.exec('vacuum');
  } catch (error) {
    try {
      out.close();
    } catch {
      // Ignore cleanup close errors after an export failure.
    }
    fs.rmSync(tmpPath, { force: true });
    fs.rmSync(`${tmpPath}-wal`, { force: true });
    fs.rmSync(`${tmpPath}-shm`, { force: true });
    throw error;
  }
  out.close();

  fs.renameSync(tmpPath, outputPath);
  fs.rmSync(`${tmpPath}-wal`, { force: true });
  fs.rmSync(`${tmpPath}-shm`, { force: true });

  const outputBytes = fs.statSync(outputPath).size;
  const sourceBytes = fs.statSync(sourcePath).size + fileSize(`${sourcePath}-wal`) + fileSize(`${sourcePath}-shm`);
  const verify = openDb(outputPath);
  try {
    verify.pragma('journal_mode = DELETE');
    const tables = PORTABLE_SYNC_TABLES.map((name) => ({ name, rows: countRows(verify, name) }));
    const responseBase: Omit<PortableSyncExportResponse, 'manifest' | 'manifestPath'> = {
      ok: true,
      repository: {
        id: params.repository.id,
        owner: params.repository.owner,
        name: params.repository.name,
        fullName: params.repository.fullName,
      },
      outputPath,
      sourcePath,
      sourceBytes,
      outputBytes,
      compressionRatio: sourceBytes > 0 ? outputBytes / sourceBytes : 0,
      bodyChars,
      profile,
      tables,
      excluded: [...PORTABLE_SYNC_EXCLUDED_TABLES],
    };
    const validation = validatePortableSyncDatabase(outputPath);
    const manifest = buildPortableSyncManifest(responseBase, validation.ok);
    const manifestPath = params.writeManifest ? writePortableSyncManifest(outputPath, manifest) : null;

    return {
      ...responseBase,
      manifestPath,
      manifest,
    };
  } finally {
    verify.close();
  }
}

function bodyCharsForProfile(profile: PortableSyncProfile | undefined): number {
  if (profile === 'lean') return 256;
  if (profile === 'review') return 1024;
  return DEFAULT_PORTABLE_BODY_CHARS;
}

function buildPortableSyncManifest(
  response: Omit<PortableSyncExportResponse, 'manifest' | 'manifestPath'>,
  validationOk: boolean,
): PortableSyncManifest {
  return {
    schema: PORTABLE_SYNC_SCHEMA_VERSION,
    profile: response.profile,
    exportedAt: nowIso(),
    outputPath: response.outputPath,
    outputBytes: response.outputBytes,
    sha256: sha256File(response.outputPath),
    repository: response.repository,
    bodyChars: response.bodyChars,
    tables: response.tables,
    excluded: response.excluded,
    validationOk,
  };
}

function writePortableSyncManifest(outputPath: string, manifest: PortableSyncManifest): string {
  const manifestPath = `${outputPath}.manifest.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

export function createPortableSyncSchema(db: SqliteDatabase): void {
  db.exec(`
    create table portable_metadata (key text primary key, value text not null);
    create table repositories (
      id integer primary key,
      owner text not null,
      name text not null,
      full_name text not null unique,
      github_repo_id text,
      updated_at text not null
    );
    create table threads (
      id integer primary key,
      repo_id integer not null references repositories(id) on delete cascade,
      github_id text not null,
      number integer not null,
      kind text not null,
      state text not null,
      title text not null,
      body_excerpt text,
      body_length integer not null default 0,
      author_login text,
      author_type text,
      html_url text not null,
      labels_json text not null,
      assignees_json text not null,
      content_hash text not null,
      is_draft integer not null default 0,
      created_at_gh text,
      updated_at_gh text,
      closed_at_gh text,
      merged_at_gh text,
      first_pulled_at text,
      last_pulled_at text,
      updated_at text not null,
      closed_at_local text,
      close_reason_local text,
      unique(repo_id, kind, number)
    );
    create table thread_revisions (
      id integer primary key,
      thread_id integer not null references threads(id) on delete cascade,
      source_updated_at text,
      content_hash text not null,
      title_hash text not null,
      body_hash text not null,
      labels_hash text not null,
      created_at text not null,
      unique(thread_id, content_hash)
    );
    create table thread_fingerprints (
      id integer primary key,
      thread_revision_id integer not null references thread_revisions(id) on delete cascade,
      algorithm_version text not null,
      fingerprint_hash text not null,
      fingerprint_slug text not null,
      title_tokens_json text not null,
      body_token_hash text not null,
      linked_refs_json text not null,
      file_set_hash text not null,
      module_buckets_json text not null,
      simhash64 text not null,
      feature_json text not null,
      created_at text not null,
      unique(thread_revision_id, algorithm_version)
    );
    create table thread_key_summaries (
      id integer primary key,
      thread_revision_id integer not null references thread_revisions(id) on delete cascade,
      summary_kind text not null,
      prompt_version text not null,
      provider text not null,
      model text not null,
      input_hash text not null,
      output_hash text not null,
      key_text text not null,
      created_at text not null,
      unique(thread_revision_id, summary_kind, prompt_version, provider, model)
    );
    create table repo_sync_state (
      repo_id integer primary key references repositories(id) on delete cascade,
      last_full_open_scan_started_at text,
      last_overlapping_open_scan_completed_at text,
      last_non_overlapping_scan_completed_at text,
      last_open_close_reconciled_at text,
      updated_at text not null
    );
    create table repo_pipeline_state (
      repo_id integer primary key references repositories(id) on delete cascade,
      summary_model text not null,
      summary_prompt_version text not null,
      embedding_basis text not null,
      embed_model text not null,
      embed_dimensions integer not null,
      embed_pipeline_version text not null,
      vector_backend text not null,
      vectors_current_at text,
      clusters_current_at text,
      updated_at text not null
    );
    create table cluster_groups (
      id integer primary key,
      repo_id integer not null references repositories(id) on delete cascade,
      stable_key text not null,
      stable_slug text not null,
      status text not null,
      cluster_type text,
      representative_thread_id integer references threads(id) on delete set null,
      title text,
      created_at text not null,
      updated_at text not null,
      closed_at text,
      unique(repo_id, stable_key),
      unique(repo_id, stable_slug)
    );
    create table cluster_memberships (
      cluster_id integer not null references cluster_groups(id) on delete cascade,
      thread_id integer not null references threads(id) on delete cascade,
      role text not null,
      state text not null,
      score_to_representative real,
      first_seen_run_id integer,
      last_seen_run_id integer,
      added_by text not null,
      removed_by text,
      added_reason_json text not null,
      removed_reason_json text,
      created_at text not null,
      updated_at text not null,
      removed_at text,
      primary key (cluster_id, thread_id)
    );
    create table cluster_overrides (
      id integer primary key,
      repo_id integer not null references repositories(id) on delete cascade,
      cluster_id integer not null references cluster_groups(id) on delete cascade,
      thread_id integer not null references threads(id) on delete cascade,
      action text not null,
      actor_id integer,
      reason text,
      created_at text not null,
      expires_at text,
      unique(cluster_id, thread_id, action)
    );
    create table cluster_aliases (
      cluster_id integer not null references cluster_groups(id) on delete cascade,
      alias_slug text not null,
      reason text not null,
      created_at text not null,
      primary key (cluster_id, alias_slug)
    );
    create table cluster_closures (
      cluster_id integer primary key references cluster_groups(id) on delete cascade,
      reason text not null,
      actor_kind text not null,
      created_at text not null,
      updated_at text not null
    );
    create index idx_threads_repo_number on threads(repo_id, number);
    create index idx_threads_repo_state_closed on threads(repo_id, state, closed_at_local);
    create index idx_thread_fingerprints_hash on thread_fingerprints(fingerprint_hash);
    create index idx_thread_fingerprints_slug on thread_fingerprints(fingerprint_slug);
    create index idx_cluster_groups_repo_status on cluster_groups(repo_id, status);
    create index idx_cluster_memberships_thread_state on cluster_memberships(thread_id, state);
    create index idx_cluster_memberships_cluster_state on cluster_memberships(cluster_id, state);
  `);
}

export function validatePortableSyncDatabase(dbPath: string): PortableSyncValidationResponse {
  const resolvedPath = path.resolve(dbPath);
  const db = openReadonlyDb(resolvedPath);
  try {
    const tableNames = listTables(db);
    const missingTables = PORTABLE_SYNC_TABLES.filter((name) => !tableNames.has(name));
    const unexpectedExcludedTables = PORTABLE_SYNC_EXCLUDED_TABLES.filter((name) => tableNames.has(name));
    const metadata = tableNames.has('portable_metadata') ? readPortableMetadata(db) : {};
    const integrity = readIntegrityCheck(db);
    const foreignKeyViolations = readForeignKeyViolations(db);
    const schema = metadata.schema ?? null;
    const errors = [
      ...missingTables.map((name) => `missing required table: ${name}`),
      ...unexpectedExcludedTables.map((name) => `excluded cache table is present: ${name}`),
      ...(schema === PORTABLE_SYNC_SCHEMA_VERSION ? [] : [`unexpected schema: ${schema ?? 'missing'}`]),
      ...integrity.filter((message) => message !== 'ok').map((message) => `integrity_check: ${message}`),
      ...foreignKeyViolations.map((violation) => `foreign_key_check: ${JSON.stringify(violation)}`),
    ];

    return {
      ok: errors.length === 0,
      path: resolvedPath,
      schema,
      metadata,
      integrity,
      foreignKeyViolations,
      missingTables,
      unexpectedExcludedTables,
      tables: PORTABLE_SYNC_TABLES.filter((name) => tableNames.has(name)).map((name) => ({ name, rows: countRows(db, name) })),
      errors,
    };
  } finally {
    db.close();
  }
}

export function portableSyncSizeReport(dbPath: string): PortableSyncSizeResponse {
  const resolvedPath = path.resolve(dbPath);
  const db = openReadonlyDb(resolvedPath);
  try {
    const tables = readDbstatSizes(db);
    return {
      ok: true,
      path: resolvedPath,
      totalBytes: fileSize(resolvedPath),
      walBytes: fileSize(`${resolvedPath}-wal`),
      shmBytes: fileSize(`${resolvedPath}-shm`),
      tables,
    };
  } finally {
    db.close();
  }
}

export function portableSyncStatusReport(params: {
  liveDb: SqliteDatabase;
  repository: RepositoryDto;
  portablePath: string;
}): PortableSyncStatusResponse {
  const resolvedPath = path.resolve(params.portablePath);
  const portableDb = openReadonlyDb(resolvedPath);
  try {
    const portableRepo = portableDb
      .prepare('select id from repositories where full_name = ?')
      .get(params.repository.fullName) as { id: number } | undefined;
    const portableRepoId = portableRepo?.id ?? null;
    const liveSnapshot = readRepoSnapshot(params.liveDb, params.repository.id);
    const portableSnapshot = portableRepoId === null ? emptyRepoSnapshot() : readRepoSnapshot(portableDb, portableRepoId);

    const liveThreads = readThreadComparableRows(params.liveDb, params.repository.id);
    const portableThreads = portableRepoId === null ? [] : readThreadComparableRows(portableDb, portableRepoId);
    const liveClusters = readClusterComparableRows(params.liveDb, params.repository.id);
    const portableClusters = portableRepoId === null ? [] : readClusterComparableRows(portableDb, portableRepoId);
    const liveMemberships = readMembershipComparableRows(params.liveDb, params.repository.id);
    const portableMemberships = portableRepoId === null ? [] : readMembershipComparableRows(portableDb, portableRepoId);
    const threadDrift = compareComparableRows(liveThreads, portableThreads);
    const clusterDrift = compareComparableRows(liveClusters, portableClusters);
    const membershipDrift = compareComparableRows(liveMemberships, portableMemberships);

    return {
      ok: true,
      repository: {
        id: params.repository.id,
        owner: params.repository.owner,
        name: params.repository.name,
        fullName: params.repository.fullName,
      },
      portablePath: resolvedPath,
      portableRepositoryFound: portableRepoId !== null,
      live: liveSnapshot,
      portable: portableSnapshot,
      drift: {
        liveOnlyThreads: threadDrift.liveOnly,
        portableOnlyThreads: threadDrift.portableOnly,
        changedThreads: threadDrift.changed,
        liveOnlyClusters: clusterDrift.liveOnly,
        portableOnlyClusters: clusterDrift.portableOnly,
        changedClusters: clusterDrift.changed,
        liveOnlyMemberships: membershipDrift.liveOnly,
        portableOnlyMemberships: membershipDrift.portableOnly,
        changedMemberships: membershipDrift.changed,
      },
    };
  } finally {
    portableDb.close();
  }
}

export function importPortableSyncDatabase(params: { liveDb: SqliteDatabase; portablePath: string }): PortableSyncImportResponse {
  const resolvedPath = path.resolve(params.portablePath);
  const validation = validatePortableSyncDatabase(resolvedPath);
  if (!validation.ok) {
    throw new Error(`Portable sync validation failed: ${validation.errors.join('; ')}`);
  }

  const portableDb = openReadonlyDb(resolvedPath);
  try {
    const portableRepo = portableDb.prepare('select * from repositories order by id limit 1').get() as PortableRepositoryRow | undefined;
    if (!portableRepo) {
      throw new Error('Portable sync database has no repository row');
    }

    const imported = emptyImportCounts();
    const threadIdMap = new Map<number, number>();
    const revisionIdMap = new Map<number, number>();
    const clusterIdMap = new Map<number, number>();

    const runImport = params.liveDb.transaction(() => {
      const repoId = upsertImportedRepository(params.liveDb, portableRepo);
      imported.repositories = 1;

      for (const thread of readPortableThreads(portableDb, portableRepo.id)) {
        threadIdMap.set(thread.id, upsertImportedThread(params.liveDb, repoId, thread));
        imported.threads += 1;
      }

      for (const revision of readPortableThreadRevisions(portableDb)) {
        const liveThreadId = threadIdMap.get(revision.thread_id);
        if (!liveThreadId) continue;
        revisionIdMap.set(revision.id, upsertImportedThreadRevision(params.liveDb, liveThreadId, revision));
        imported.threadRevisions += 1;
      }

      for (const fingerprint of readPortableThreadFingerprints(portableDb)) {
        const liveRevisionId = revisionIdMap.get(fingerprint.thread_revision_id);
        if (!liveRevisionId) continue;
        upsertImportedThreadFingerprint(params.liveDb, liveRevisionId, fingerprint);
        imported.threadFingerprints += 1;
      }

      for (const summary of readPortableThreadKeySummaries(portableDb)) {
        const liveRevisionId = revisionIdMap.get(summary.thread_revision_id);
        if (!liveRevisionId) continue;
        upsertImportedThreadKeySummary(params.liveDb, liveRevisionId, summary);
        imported.threadKeySummaries += 1;
      }

      if (upsertImportedRepoSyncState(params.liveDb, repoId, portableDb, portableRepo.id)) imported.repoSyncState = 1;
      if (upsertImportedRepoPipelineState(params.liveDb, repoId, portableDb, portableRepo.id)) imported.repoPipelineState = 1;

      for (const cluster of readPortableClusterGroups(portableDb, portableRepo.id)) {
        const representativeThreadId = cluster.representative_thread_id ? (threadIdMap.get(cluster.representative_thread_id) ?? null) : null;
        clusterIdMap.set(cluster.id, upsertImportedClusterGroup(params.liveDb, repoId, representativeThreadId, cluster));
        imported.clusterGroups += 1;
      }

      for (const membership of readPortableClusterMemberships(portableDb)) {
        const liveClusterId = clusterIdMap.get(membership.cluster_id);
        const liveThreadId = threadIdMap.get(membership.thread_id);
        if (!liveClusterId || !liveThreadId) continue;
        upsertImportedClusterMembership(params.liveDb, liveClusterId, liveThreadId, membership);
        imported.clusterMemberships += 1;
      }

      for (const override of readPortableClusterOverrides(portableDb, portableRepo.id)) {
        const liveClusterId = clusterIdMap.get(override.cluster_id);
        const liveThreadId = threadIdMap.get(override.thread_id);
        if (!liveClusterId || !liveThreadId) continue;
        upsertImportedClusterOverride(params.liveDb, repoId, liveClusterId, liveThreadId, override);
        imported.clusterOverrides += 1;
      }

      for (const alias of readPortableClusterAliases(portableDb)) {
        const liveClusterId = clusterIdMap.get(alias.cluster_id);
        if (!liveClusterId) continue;
        upsertImportedClusterAlias(params.liveDb, liveClusterId, alias);
        imported.clusterAliases += 1;
      }

      for (const closure of readPortableClusterClosures(portableDb)) {
        const liveClusterId = clusterIdMap.get(closure.cluster_id);
        if (!liveClusterId) continue;
        upsertImportedClusterClosure(params.liveDb, liveClusterId, closure);
        imported.clusterClosures += 1;
      }

      return repoId;
    });

    const repoId = runImport();
    return {
      ok: true,
      path: resolvedPath,
      repository: {
        id: repoId,
        owner: portableRepo.owner,
        name: portableRepo.name,
        fullName: portableRepo.full_name,
      },
      validationOk: validation.ok,
      imported,
    };
  } finally {
    portableDb.close();
  }
}

export function populatePortableSyncDb(db: SqliteDatabase, params: { repoId: number; sourcePath: string; bodyChars: number }): void {
  const exportedAt = nowIso();
  const insertMetadata = db.prepare('insert into portable_metadata (key, value) values (?, ?)');
  insertMetadata.run('schema', PORTABLE_SYNC_SCHEMA_VERSION);
  insertMetadata.run('exported_at', exportedAt);
  insertMetadata.run('source_path', params.sourcePath);
  insertMetadata.run('body_chars', String(params.bodyChars));
  insertMetadata.run('excluded', 'raw_json,comments,documents,fts,vectors,code_snapshots,cluster_events,run_history,similarity_edges,blobs');

  db.prepare(
    `insert into repositories (id, owner, name, full_name, github_repo_id, updated_at)
     select id, owner, name, full_name, github_repo_id, updated_at
     from source.repositories
     where id = ?`,
  ).run(params.repoId);

  db.prepare(
    `insert into threads (
      id, repo_id, github_id, number, kind, state, title, body_excerpt, body_length, author_login, author_type, html_url,
      labels_json, assignees_json, content_hash, is_draft, created_at_gh, updated_at_gh, closed_at_gh,
      merged_at_gh, first_pulled_at, last_pulled_at, updated_at, closed_at_local, close_reason_local
    )
    select
      id, repo_id, github_id, number, kind, state, title,
      case
        when body is null then null
        when ? = 0 then ''
        when length(body) <= ? then body
        else substr(body, 1, ?)
      end,
      case when body is null then 0 else length(body) end,
      author_login, author_type, html_url, labels_json, assignees_json, content_hash, is_draft,
      created_at_gh, updated_at_gh, closed_at_gh, merged_at_gh, first_pulled_at, last_pulled_at,
      updated_at, closed_at_local, close_reason_local
    from source.threads
    where repo_id = ?`,
  ).run(params.bodyChars, params.bodyChars, params.bodyChars, params.repoId);

  db.prepare(
    `insert into thread_revisions (id, thread_id, source_updated_at, content_hash, title_hash, body_hash, labels_hash, created_at)
     select tr.id, tr.thread_id, tr.source_updated_at, tr.content_hash, tr.title_hash, tr.body_hash, tr.labels_hash, tr.created_at
     from source.thread_revisions tr
     join threads t on t.id = tr.thread_id`,
  ).run();

  db.prepare(
    `insert into thread_fingerprints (
      id, thread_revision_id, algorithm_version, fingerprint_hash, fingerprint_slug, title_tokens_json, body_token_hash,
      linked_refs_json, file_set_hash, module_buckets_json, simhash64, feature_json, created_at
    )
    select
      tf.id, tf.thread_revision_id, tf.algorithm_version, tf.fingerprint_hash, tf.fingerprint_slug, tf.title_tokens_json,
      tf.body_token_hash, tf.linked_refs_json, tf.file_set_hash, tf.module_buckets_json, tf.simhash64, tf.feature_json, tf.created_at
    from source.thread_fingerprints tf
    join thread_revisions tr on tr.id = tf.thread_revision_id`,
  ).run();

  db.prepare(
    `insert into thread_key_summaries (
      id, thread_revision_id, summary_kind, prompt_version, provider, model, input_hash, output_hash, key_text, created_at
    )
    select
      tks.id, tks.thread_revision_id, tks.summary_kind, tks.prompt_version, tks.provider, tks.model,
      tks.input_hash, tks.output_hash, tks.key_text, tks.created_at
    from source.thread_key_summaries tks
    join thread_revisions tr on tr.id = tks.thread_revision_id`,
  ).run();

  db.prepare('insert into repo_sync_state select * from source.repo_sync_state where repo_id = ?').run(params.repoId);
  db.prepare('insert into repo_pipeline_state select * from source.repo_pipeline_state where repo_id = ?').run(params.repoId);
  db.prepare('insert into cluster_groups select * from source.cluster_groups where repo_id = ?').run(params.repoId);
  db.prepare(
    `insert into cluster_memberships
     select cm.*
     from source.cluster_memberships cm
     join cluster_groups cg on cg.id = cm.cluster_id
     join threads t on t.id = cm.thread_id`,
  ).run();
  const overrideActorExpr = attachedTableHasColumn(db, 'source', 'cluster_overrides', 'actor_id') ? 'co.actor_id' : 'null';
  db.prepare(
    `insert into cluster_overrides (
      id, repo_id, cluster_id, thread_id, action, actor_id, reason, created_at, expires_at
    )
     select co.id, co.repo_id, co.cluster_id, co.thread_id, co.action, ${overrideActorExpr}, co.reason, co.created_at, co.expires_at
     from source.cluster_overrides co
     join cluster_groups cg on cg.id = co.cluster_id
     join threads t on t.id = co.thread_id
     where co.repo_id = ?`,
  ).run(params.repoId);
  db.prepare(
    `insert into cluster_aliases
     select ca.*
     from source.cluster_aliases ca
     join cluster_groups cg on cg.id = ca.cluster_id`,
  ).run();
  db.prepare(
    `insert into cluster_closures
     select cc.*
     from source.cluster_closures cc
     join cluster_groups cg on cg.id = cc.cluster_id`,
  ).run();
}

function countRows(db: SqliteDatabase, tableName: string): number {
  const row = db.prepare(`select count(*) as count from "${tableName}"`).get() as { count: number };
  return row.count;
}

function emptyRepoSnapshot(): PortableRepoSnapshot {
  return {
    threads: {
      total: 0,
      open: 0,
      closed: 0,
      issues: 0,
      pullRequests: 0,
      latestUpdatedAt: null,
    },
    clusters: {
      groups: 0,
      memberships: 0,
      overrides: 0,
      aliases: 0,
      closures: 0,
    },
  };
}

function readRepoSnapshot(db: SqliteDatabase, repoId: number): PortableRepoSnapshot {
  const threads = db
    .prepare(
      `select
         count(*) as total,
         sum(case when state = 'open' and closed_at_local is null then 1 else 0 end) as open,
         sum(case when state <> 'open' or closed_at_local is not null then 1 else 0 end) as closed,
         sum(case when kind = 'issue' then 1 else 0 end) as issues,
         sum(case when kind = 'pull_request' then 1 else 0 end) as pull_requests,
         max(coalesce(updated_at_gh, updated_at)) as latest_updated_at
       from threads
       where repo_id = ?`,
    )
    .get(repoId) as {
    total: number;
    open: number | null;
    closed: number | null;
    issues: number | null;
    pull_requests: number | null;
    latest_updated_at: string | null;
  };
  const clusters = db
    .prepare(
      `select
         (select count(*) from cluster_groups where repo_id = ?) as groups_count,
         (select count(*)
          from cluster_memberships cm
          join cluster_groups cg on cg.id = cm.cluster_id
          where cg.repo_id = ?) as memberships_count,
         (select count(*) from cluster_overrides where repo_id = ?) as overrides_count,
         (select count(*)
          from cluster_aliases ca
          join cluster_groups cg on cg.id = ca.cluster_id
          where cg.repo_id = ?) as aliases_count,
         (select count(*)
          from cluster_closures cc
          join cluster_groups cg on cg.id = cc.cluster_id
          where cg.repo_id = ?) as closures_count`,
    )
    .get(repoId, repoId, repoId, repoId, repoId) as {
    groups_count: number;
    memberships_count: number;
    overrides_count: number;
    aliases_count: number;
    closures_count: number;
  };

  return {
    threads: {
      total: threads.total,
      open: threads.open ?? 0,
      closed: threads.closed ?? 0,
      issues: threads.issues ?? 0,
      pullRequests: threads.pull_requests ?? 0,
      latestUpdatedAt: threads.latest_updated_at,
    },
    clusters: {
      groups: clusters.groups_count,
      memberships: clusters.memberships_count,
      overrides: clusters.overrides_count,
      aliases: clusters.aliases_count,
      closures: clusters.closures_count,
    },
  };
}

type ComparableRow = { key: string; value: string };

function readThreadComparableRows(db: SqliteDatabase, repoId: number): ComparableRow[] {
  const rows = db
    .prepare(
      `select kind, number, state, title, content_hash, updated_at_gh, closed_at_gh, closed_at_local
       from threads
       where repo_id = ?
       order by kind, number`,
    )
    .all(repoId) as Array<{
    kind: string;
    number: number;
    state: string;
    title: string;
    content_hash: string;
    updated_at_gh: string | null;
    closed_at_gh: string | null;
    closed_at_local: string | null;
  }>;
  return rows.map((row) => ({
    key: `${row.kind}:${row.number}`,
    value: JSON.stringify([row.state, row.title, row.content_hash, row.updated_at_gh, row.closed_at_gh, row.closed_at_local]),
  }));
}

function readClusterComparableRows(db: SqliteDatabase, repoId: number): ComparableRow[] {
  const rows = db
    .prepare(
      `select stable_key, stable_slug, status, cluster_type, title, closed_at
       from cluster_groups
       where repo_id = ?
       order by stable_key`,
    )
    .all(repoId) as Array<{
    stable_key: string;
    stable_slug: string;
    status: string;
    cluster_type: string | null;
    title: string | null;
    closed_at: string | null;
  }>;
  return rows.map((row) => ({
    key: row.stable_key,
    value: JSON.stringify([row.stable_slug, row.status, row.cluster_type, row.title, row.closed_at]),
  }));
}

function readMembershipComparableRows(db: SqliteDatabase, repoId: number): ComparableRow[] {
  const rows = db
    .prepare(
      `select cg.stable_key, t.kind, t.number, cm.role, cm.state, cm.score_to_representative, cm.added_by, cm.removed_by, cm.removed_at
       from cluster_memberships cm
       join cluster_groups cg on cg.id = cm.cluster_id
       join threads t on t.id = cm.thread_id
       where cg.repo_id = ?
       order by cg.stable_key, t.kind, t.number`,
    )
    .all(repoId) as Array<{
    stable_key: string;
    kind: string;
    number: number;
    role: string;
    state: string;
    score_to_representative: number | null;
    added_by: string;
    removed_by: string | null;
    removed_at: string | null;
  }>;
  return rows.map((row) => ({
    key: `${row.stable_key}:${row.kind}:${row.number}`,
    value: JSON.stringify([row.role, row.state, row.score_to_representative, row.added_by, row.removed_by, row.removed_at]),
  }));
}

function compareComparableRows(liveRows: ComparableRow[], portableRows: ComparableRow[]): { liveOnly: number; portableOnly: number; changed: number } {
  const live = new Map(liveRows.map((row) => [row.key, row.value]));
  const portable = new Map(portableRows.map((row) => [row.key, row.value]));
  let liveOnly = 0;
  let portableOnly = 0;
  let changed = 0;

  for (const [key, value] of live) {
    if (!portable.has(key)) {
      liveOnly += 1;
    } else if (portable.get(key) !== value) {
      changed += 1;
    }
  }
  for (const key of portable.keys()) {
    if (!live.has(key)) portableOnly += 1;
  }

  return { liveOnly, portableOnly, changed };
}

type PortableRepositoryRow = {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  github_repo_id: string | null;
  updated_at: string;
};

type PortableThreadRow = {
  id: number;
  github_id: string;
  number: number;
  kind: string;
  state: string;
  title: string;
  body_excerpt: string | null;
  author_login: string | null;
  author_type: string | null;
  html_url: string;
  labels_json: string;
  assignees_json: string;
  content_hash: string;
  is_draft: number;
  created_at_gh: string | null;
  updated_at_gh: string | null;
  closed_at_gh: string | null;
  merged_at_gh: string | null;
  first_pulled_at: string | null;
  last_pulled_at: string | null;
  updated_at: string;
  closed_at_local: string | null;
  close_reason_local: string | null;
};

type PortableThreadRevisionRow = {
  id: number;
  thread_id: number;
  source_updated_at: string | null;
  content_hash: string;
  title_hash: string;
  body_hash: string;
  labels_hash: string;
  created_at: string;
};

type PortableThreadFingerprintRow = Record<string, unknown> & {
  thread_revision_id: number;
};

type PortableThreadKeySummaryRow = Record<string, unknown> & {
  thread_revision_id: number;
};

type PortableClusterGroupRow = Record<string, unknown> & {
  id: number;
  representative_thread_id: number | null;
};

type PortableClusterMembershipRow = Record<string, unknown> & {
  cluster_id: number;
  thread_id: number;
};

type PortableClusterOverrideRow = Record<string, unknown> & {
  cluster_id: number;
  thread_id: number;
};

type PortableClusterAliasRow = Record<string, unknown> & {
  cluster_id: number;
};

type PortableClusterClosureRow = Record<string, unknown> & {
  cluster_id: number;
};

function emptyImportCounts(): PortableSyncImportResponse['imported'] {
  return {
    repositories: 0,
    threads: 0,
    threadRevisions: 0,
    threadFingerprints: 0,
    threadKeySummaries: 0,
    repoSyncState: 0,
    repoPipelineState: 0,
    clusterGroups: 0,
    clusterMemberships: 0,
    clusterOverrides: 0,
    clusterAliases: 0,
    clusterClosures: 0,
  };
}

function readPortableThreads(db: SqliteDatabase, repoId: number): PortableThreadRow[] {
  return db.prepare('select * from threads where repo_id = ? order by id').all(repoId) as PortableThreadRow[];
}

function readPortableThreadRevisions(db: SqliteDatabase): PortableThreadRevisionRow[] {
  return db.prepare('select * from thread_revisions order by id').all() as PortableThreadRevisionRow[];
}

function readPortableThreadFingerprints(db: SqliteDatabase): PortableThreadFingerprintRow[] {
  return db.prepare('select * from thread_fingerprints order by id').all() as PortableThreadFingerprintRow[];
}

function readPortableThreadKeySummaries(db: SqliteDatabase): PortableThreadKeySummaryRow[] {
  return db.prepare('select * from thread_key_summaries order by id').all() as PortableThreadKeySummaryRow[];
}

function readPortableClusterGroups(db: SqliteDatabase, repoId: number): PortableClusterGroupRow[] {
  return db.prepare('select * from cluster_groups where repo_id = ? order by id').all(repoId) as PortableClusterGroupRow[];
}

function readPortableClusterMemberships(db: SqliteDatabase): PortableClusterMembershipRow[] {
  return db.prepare('select * from cluster_memberships order by cluster_id, thread_id').all() as PortableClusterMembershipRow[];
}

function readPortableClusterOverrides(db: SqliteDatabase, repoId: number): PortableClusterOverrideRow[] {
  return db.prepare('select * from cluster_overrides where repo_id = ? order by id').all(repoId) as PortableClusterOverrideRow[];
}

function readPortableClusterAliases(db: SqliteDatabase): PortableClusterAliasRow[] {
  return db.prepare('select * from cluster_aliases order by cluster_id, alias_slug').all() as PortableClusterAliasRow[];
}

function readPortableClusterClosures(db: SqliteDatabase): PortableClusterClosureRow[] {
  return db.prepare('select * from cluster_closures order by cluster_id').all() as PortableClusterClosureRow[];
}

function upsertImportedRepository(db: SqliteDatabase, row: PortableRepositoryRow): number {
  db.prepare(
    `insert into repositories (owner, name, full_name, github_repo_id, raw_json, updated_at)
     values (?, ?, ?, ?, '{}', ?)
     on conflict(full_name) do update set
       owner = excluded.owner,
       name = excluded.name,
       github_repo_id = excluded.github_repo_id,
       updated_at = excluded.updated_at`,
  ).run(row.owner, row.name, row.full_name, row.github_repo_id, row.updated_at);
  const live = db.prepare('select id from repositories where full_name = ?').get(row.full_name) as { id: number };
  return live.id;
}

function upsertImportedThread(db: SqliteDatabase, repoId: number, row: PortableThreadRow): number {
  db.prepare(
    `insert into threads (
       repo_id, github_id, number, kind, state, title, body, author_login, author_type, html_url,
       labels_json, assignees_json, raw_json, content_hash, is_draft, created_at_gh, updated_at_gh,
       closed_at_gh, merged_at_gh, first_pulled_at, last_pulled_at, updated_at, closed_at_local, close_reason_local
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(repo_id, kind, number) do update set
       github_id = excluded.github_id,
       state = excluded.state,
       title = excluded.title,
       body = coalesce(threads.body, excluded.body),
       author_login = excluded.author_login,
       author_type = excluded.author_type,
       html_url = excluded.html_url,
       labels_json = excluded.labels_json,
       assignees_json = excluded.assignees_json,
       content_hash = excluded.content_hash,
       is_draft = excluded.is_draft,
       created_at_gh = excluded.created_at_gh,
       updated_at_gh = excluded.updated_at_gh,
       closed_at_gh = excluded.closed_at_gh,
       merged_at_gh = excluded.merged_at_gh,
       first_pulled_at = coalesce(threads.first_pulled_at, excluded.first_pulled_at),
       last_pulled_at = excluded.last_pulled_at,
       updated_at = excluded.updated_at,
       closed_at_local = excluded.closed_at_local,
       close_reason_local = excluded.close_reason_local`,
  ).run(
    repoId,
    row.github_id,
    row.number,
    row.kind,
    row.state,
    row.title,
    row.body_excerpt,
    row.author_login,
    row.author_type,
    row.html_url,
    row.labels_json,
    row.assignees_json,
    row.content_hash,
    row.is_draft,
    row.created_at_gh,
    row.updated_at_gh,
    row.closed_at_gh,
    row.merged_at_gh,
    row.first_pulled_at,
    row.last_pulled_at,
    row.updated_at,
    row.closed_at_local,
    row.close_reason_local,
  );
  const live = db.prepare('select id from threads where repo_id = ? and kind = ? and number = ?').get(repoId, row.kind, row.number) as { id: number };
  return live.id;
}

function upsertImportedThreadRevision(db: SqliteDatabase, liveThreadId: number, row: PortableThreadRevisionRow): number {
  db.prepare(
    `insert into thread_revisions (thread_id, source_updated_at, content_hash, title_hash, body_hash, labels_hash, created_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(thread_id, content_hash) do update set
       source_updated_at = excluded.source_updated_at,
       title_hash = excluded.title_hash,
       body_hash = excluded.body_hash,
       labels_hash = excluded.labels_hash`,
  ).run(liveThreadId, row.source_updated_at, row.content_hash, row.title_hash, row.body_hash, row.labels_hash, row.created_at);
  const live = db.prepare('select id from thread_revisions where thread_id = ? and content_hash = ?').get(liveThreadId, row.content_hash) as {
    id: number;
  };
  return live.id;
}

function upsertImportedThreadFingerprint(db: SqliteDatabase, liveRevisionId: number, row: PortableThreadFingerprintRow): void {
  db.prepare(
    `insert into thread_fingerprints (
       thread_revision_id, algorithm_version, fingerprint_hash, fingerprint_slug, title_tokens_json, body_token_hash,
       linked_refs_json, file_set_hash, module_buckets_json, simhash64, feature_json, created_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(thread_revision_id, algorithm_version) do update set
       fingerprint_hash = excluded.fingerprint_hash,
       fingerprint_slug = excluded.fingerprint_slug,
       title_tokens_json = excluded.title_tokens_json,
       body_token_hash = excluded.body_token_hash,
       linked_refs_json = excluded.linked_refs_json,
       file_set_hash = excluded.file_set_hash,
       module_buckets_json = excluded.module_buckets_json,
       simhash64 = excluded.simhash64,
       feature_json = excluded.feature_json`,
  ).run(
    liveRevisionId,
    row.algorithm_version,
    row.fingerprint_hash,
    row.fingerprint_slug,
    row.title_tokens_json,
    row.body_token_hash,
    row.linked_refs_json,
    row.file_set_hash,
    row.module_buckets_json,
    row.simhash64,
    row.feature_json,
    row.created_at,
  );
}

function upsertImportedThreadKeySummary(db: SqliteDatabase, liveRevisionId: number, row: PortableThreadKeySummaryRow): void {
  db.prepare(
    `insert into thread_key_summaries (
       thread_revision_id, summary_kind, prompt_version, provider, model, input_hash, output_hash, key_text, created_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(thread_revision_id, summary_kind, prompt_version, provider, model) do update set
       input_hash = excluded.input_hash,
       output_hash = excluded.output_hash,
       key_text = excluded.key_text,
       created_at = excluded.created_at`,
  ).run(
    liveRevisionId,
    row.summary_kind,
    row.prompt_version,
    row.provider,
    row.model,
    row.input_hash,
    row.output_hash,
    row.key_text,
    row.created_at,
  );
}

function upsertImportedRepoSyncState(db: SqliteDatabase, repoId: number, portableDb: SqliteDatabase, portableRepoId: number): boolean {
  const row = portableDb.prepare('select * from repo_sync_state where repo_id = ?').get(portableRepoId) as Record<string, unknown> | undefined;
  if (!row) return false;
  db.prepare(
    `insert into repo_sync_state (
       repo_id, last_full_open_scan_started_at, last_overlapping_open_scan_completed_at,
       last_non_overlapping_scan_completed_at, last_open_close_reconciled_at, updated_at
     )
     values (?, ?, ?, ?, ?, ?)
     on conflict(repo_id) do update set
       last_full_open_scan_started_at = excluded.last_full_open_scan_started_at,
       last_overlapping_open_scan_completed_at = excluded.last_overlapping_open_scan_completed_at,
       last_non_overlapping_scan_completed_at = excluded.last_non_overlapping_scan_completed_at,
       last_open_close_reconciled_at = excluded.last_open_close_reconciled_at,
       updated_at = excluded.updated_at`,
  ).run(
    repoId,
    row.last_full_open_scan_started_at,
    row.last_overlapping_open_scan_completed_at,
    row.last_non_overlapping_scan_completed_at,
    row.last_open_close_reconciled_at,
    row.updated_at,
  );
  return true;
}

function upsertImportedRepoPipelineState(db: SqliteDatabase, repoId: number, portableDb: SqliteDatabase, portableRepoId: number): boolean {
  const row = portableDb.prepare('select * from repo_pipeline_state where repo_id = ?').get(portableRepoId) as Record<string, unknown> | undefined;
  if (!row) return false;
  db.prepare(
    `insert into repo_pipeline_state (
       repo_id, summary_model, summary_prompt_version, embedding_basis, embed_model, embed_dimensions,
       embed_pipeline_version, vector_backend, vectors_current_at, clusters_current_at, updated_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(repo_id) do update set
       summary_model = excluded.summary_model,
       summary_prompt_version = excluded.summary_prompt_version,
       embedding_basis = excluded.embedding_basis,
       embed_model = excluded.embed_model,
       embed_dimensions = excluded.embed_dimensions,
       embed_pipeline_version = excluded.embed_pipeline_version,
       vector_backend = excluded.vector_backend,
       vectors_current_at = excluded.vectors_current_at,
       clusters_current_at = excluded.clusters_current_at,
       updated_at = excluded.updated_at`,
  ).run(
    repoId,
    row.summary_model,
    row.summary_prompt_version,
    row.embedding_basis,
    row.embed_model,
    row.embed_dimensions,
    row.embed_pipeline_version,
    row.vector_backend,
    row.vectors_current_at,
    row.clusters_current_at,
    row.updated_at,
  );
  return true;
}

function upsertImportedClusterGroup(
  db: SqliteDatabase,
  repoId: number,
  representativeThreadId: number | null,
  row: PortableClusterGroupRow,
): number {
  db.prepare(
    `insert into cluster_groups (
       repo_id, stable_key, stable_slug, status, cluster_type, representative_thread_id, title, created_at, updated_at, closed_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(repo_id, stable_key) do update set
       stable_slug = excluded.stable_slug,
       status = excluded.status,
       cluster_type = excluded.cluster_type,
       representative_thread_id = excluded.representative_thread_id,
       title = excluded.title,
       updated_at = excluded.updated_at,
       closed_at = excluded.closed_at`,
  ).run(
    repoId,
    row.stable_key,
    row.stable_slug,
    row.status,
    row.cluster_type,
    representativeThreadId,
    row.title,
    row.created_at,
    row.updated_at,
    row.closed_at,
  );
  const live = db.prepare('select id from cluster_groups where repo_id = ? and stable_key = ?').get(repoId, row.stable_key) as { id: number };
  return live.id;
}

function upsertImportedClusterMembership(
  db: SqliteDatabase,
  liveClusterId: number,
  liveThreadId: number,
  row: PortableClusterMembershipRow,
): void {
  db.prepare(
    `insert into cluster_memberships (
       cluster_id, thread_id, role, state, score_to_representative, first_seen_run_id, last_seen_run_id,
       added_by, removed_by, added_reason_json, removed_reason_json, created_at, updated_at, removed_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(cluster_id, thread_id) do update set
       role = excluded.role,
       state = excluded.state,
       score_to_representative = excluded.score_to_representative,
       last_seen_run_id = excluded.last_seen_run_id,
       added_by = excluded.added_by,
       removed_by = excluded.removed_by,
       added_reason_json = excluded.added_reason_json,
       removed_reason_json = excluded.removed_reason_json,
       updated_at = excluded.updated_at,
       removed_at = excluded.removed_at`,
  ).run(
    liveClusterId,
    liveThreadId,
    row.role,
    row.state,
    row.score_to_representative,
    row.first_seen_run_id,
    row.last_seen_run_id,
    row.added_by,
    row.removed_by,
    row.added_reason_json,
    row.removed_reason_json,
    row.created_at,
    row.updated_at,
    row.removed_at,
  );
}

function upsertImportedClusterOverride(
  db: SqliteDatabase,
  repoId: number,
  liveClusterId: number,
  liveThreadId: number,
  row: PortableClusterOverrideRow,
): void {
  db.prepare(
    `insert into cluster_overrides (repo_id, cluster_id, thread_id, action, actor_id, reason, created_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(cluster_id, thread_id, action) do update set
       reason = excluded.reason,
       actor_id = excluded.actor_id,
       expires_at = excluded.expires_at`,
  ).run(repoId, liveClusterId, liveThreadId, row.action, row.actor_id, row.reason, row.created_at, row.expires_at);
}

function upsertImportedClusterAlias(db: SqliteDatabase, liveClusterId: number, row: PortableClusterAliasRow): void {
  db.prepare(
    `insert into cluster_aliases (cluster_id, alias_slug, reason, created_at)
     values (?, ?, ?, ?)
     on conflict(cluster_id, alias_slug) do update set reason = excluded.reason`,
  ).run(liveClusterId, row.alias_slug, row.reason, row.created_at);
}

function upsertImportedClusterClosure(db: SqliteDatabase, liveClusterId: number, row: PortableClusterClosureRow): void {
  db.prepare(
    `insert into cluster_closures (cluster_id, reason, actor_kind, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(cluster_id) do update set
       reason = excluded.reason,
       actor_kind = excluded.actor_kind,
       updated_at = excluded.updated_at`,
  ).run(liveClusterId, row.reason, row.actor_kind, row.created_at, row.updated_at);
}

function openReadonlyDb(dbPath: string): SqliteDatabase {
  return new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
}

function listTables(db: SqliteDatabase): Set<string> {
  const rows = db
    .prepare("select name from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function readPortableMetadata(db: SqliteDatabase): Record<string, string> {
  const rows = db.prepare('select key, value from portable_metadata order by key').all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function readIntegrityCheck(db: SqliteDatabase): string[] {
  const rows = db.prepare('pragma integrity_check').all() as Array<{ integrity_check: string }>;
  return rows.map((row) => row.integrity_check);
}

function readForeignKeyViolations(db: SqliteDatabase): Array<Record<string, unknown>> {
  return db.prepare('pragma foreign_key_check').all() as Array<Record<string, unknown>>;
}

function readDbstatSizes(db: SqliteDatabase): Array<{ name: string; bytes: number | null; rows: number | null }> {
  try {
    const rows = db
      .prepare(
        `select
           s.name as name,
           s.bytes as bytes,
           coalesce(t.row_count, 0) as rows
         from (
           select name, sum(pgsize) as bytes
           from dbstat
           where name not like 'sqlite_%'
           group by name
         ) s
         left join (
           select name, null as row_count
           from sqlite_master
           where 0
         ) t on t.name = s.name
         order by s.bytes desc, s.name asc`,
      )
      .all() as Array<{ name: string; bytes: number; rows: number | null }>;
    return rows.map((row) => ({ name: row.name, bytes: row.bytes, rows: safeCountRows(db, row.name) }));
  } catch {
    const tableNames = [...listTables(db)].sort();
    return tableNames.map((name) => ({ name, bytes: null, rows: safeCountRows(db, name) }));
  }
}

function safeCountRows(db: SqliteDatabase, tableName: string): number | null {
  try {
    return countRows(db, tableName);
  } catch {
    return null;
  }
}

function attachedTableHasColumn(db: SqliteDatabase, schemaName: string, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`pragma ${schemaName}.table_info("${tableName}")`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
