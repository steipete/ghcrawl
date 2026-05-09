import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type DatabaseOptions = {
  readonly?: boolean;
  fileMustExist?: boolean;
  allowExtension?: boolean;
};

type PragmaOptions = {
  simple?: boolean;
};

type RunResult = {
  changes: number;
  lastInsertRowid: number;
};

function bindArgs(parameters: unknown[]) {
  if (parameters.length === 1 && Array.isArray(parameters[0])) {
    return parameters[0];
  }
  return parameters;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

function normalizeRow(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row) || Buffer.isBuffer(row)) {
    return normalizeValue(row);
  }
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key,
      normalizeValue(value),
    ]),
  );
}

class SqliteStatement {
  readonly reader: boolean;

  constructor(private readonly statement: StatementSync) {
    this.reader = statement.columns().length > 0;
  }

  all(...parameters: unknown[]): unknown[] {
    return this.statement.all(...bindArgs(parameters)).map(normalizeRow);
  }

  get(...parameters: unknown[]): unknown {
    return normalizeRow(this.statement.get(...bindArgs(parameters)));
  }

  iterate(...parameters: unknown[]): IterableIterator<unknown> {
    const rows = this.statement.iterate(...bindArgs(parameters));
    return (function* () {
      for (const row of rows) {
        yield normalizeRow(row);
      }
    })();
  }

  run(...parameters: unknown[]): RunResult {
    const result = this.statement.run(...bindArgs(parameters));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }
}

export class SqliteDatabase {
  private transactionDepth = 0;
  private readonly db: DatabaseSync;

  constructor(dbPath: string, options: DatabaseOptions = {}) {
    this.db = new DatabaseSync(dbPath, {
      allowExtension: options.allowExtension,
      readOnly: options.readonly,
    });
  }

  close(): void {
    if (!this.db.isOpen) {
      return;
    }
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  loadExtension(extensionPath: string): void {
    this.db.loadExtension(extensionPath);
  }

  pragma(sql: string, options: PragmaOptions = {}): unknown {
    const rows = this.prepare(`pragma ${sql}`).all() as Array<Record<string, unknown>>;
    if (!options.simple) {
      return rows;
    }
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db.prepare(sql));
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs) => {
      const nested = this.db.isTransaction;
      const savepoint = `__ghcrawl_tx_${++this.transactionDepth}`;
      this.exec(nested ? `savepoint ${savepoint}` : "begin");
      try {
        const result = fn(...args);
        this.exec(nested ? `release ${savepoint}` : "commit");
        return result;
      } catch (error) {
        if (nested) {
          this.exec(`rollback to ${savepoint}`);
          this.exec(`release ${savepoint}`);
        } else {
          this.exec("rollback");
        }
        throw error;
      }
    };
  }
}

const BUSY_TIMEOUT_MS = 5_000;
const CACHE_SIZE_KIB = 64 * 1024;
const WAL_AUTOCHECKPOINT_PAGES = 1_000;
const JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;
const MMAP_SIZE_BYTES = 256 * 1024 * 1024;

export function openDb(dbPath: string): SqliteDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new SqliteDatabase(dbPath, { allowExtension: true });
  configureDb(db, { persistent: dbPath !== ":memory:" });
  return db;
}

export function configureDb(db: SqliteDatabase, options: { persistent: boolean }): void {
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  if (options.persistent) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);
    db.pragma(`journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
    db.pragma(`mmap_size = ${MMAP_SIZE_BYTES}`);
  }
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  db.pragma(`cache_size = -${CACHE_SIZE_KIB}`);
}

export function checkpointWal(db: SqliteDatabase): void {
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch {
    // Other processes may hold the WAL; SQLite will checkpoint on a later connection.
  }
}
