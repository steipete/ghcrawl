import fs from 'node:fs';
import path from 'node:path';

import type { RepositoryDto } from '@ghcrawl/api-contract';

import { checkpointWal, openDb, type SqliteDatabase } from '../db/sqlite.js';

export const PORTABLE_SYNC_SCHEMA_VERSION = 'ghcrawl-portable-sync-v1';
export const DEFAULT_PORTABLE_BODY_CHARS = 512;

export const PORTABLE_SYNC_TABLES = [
  'repositories',
  'threads',
  'thread_revisions',
  'thread_fingerprints',
  'thread_key_summaries',
  'repo_sync_state',
  'repo_pipeline_state',
  'cluster_groups',
  'cluster_memberships',
  'cluster_overrides',
  'cluster_aliases',
  'cluster_closures',
] as const;

export const PORTABLE_SYNC_EXCLUDED_TABLES = [
  'blobs',
  'comments',
  'documents',
  'documents_fts',
  'document_embeddings',
  'thread_vectors',
  'thread_code_snapshots',
  'thread_changed_files',
  'thread_hunk_signatures',
  'cluster_events',
  'pipeline_runs',
  'sync_runs',
  'summary_runs',
  'embedding_runs',
  'cluster_runs',
  'similarity_edges',
  'similarity_edge_evidence',
] as const;

export type PortableSyncExportOptions = {
  repository: RepositoryDto;
  sourceDb: SqliteDatabase;
  sourcePath: string;
  outputPath: string;
  bodyChars?: number;
};

export type PortableSyncExportResponse = {
  ok: true;
  repository: {
    id: number;
    owner: string;
    name: string;
    fullName: string;
  };
  outputPath: string;
  sourcePath: string;
  sourceBytes: number;
  outputBytes: number;
  compressionRatio: number;
  bodyChars: number;
  tables: Array<{ name: string; rows: number }>;
  excluded: string[];
};

export function exportPortableSyncDatabase(params: PortableSyncExportOptions): PortableSyncExportResponse {
  const bodyChars = params.bodyChars ?? DEFAULT_PORTABLE_BODY_CHARS;
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
    return {
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
      tables,
      excluded: [...PORTABLE_SYNC_EXCLUDED_TABLES],
    };
  } finally {
    verify.close();
  }
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

function nowIso(): string {
  return new Date().toISOString();
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
