// server/db.js - SQLite connection (node:sqlite, built into Node 22) + a tiny
// forward-only migration runner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
// SQLite migrations live next to the server on purpose: the repository is also
// checked by a CI job that installs every migrations/*.sql into Postgres, and
// these files are SQLite dialect (PRAGMA, datetime('now')).
const MIGRATIONS_DIR = path.join(here, 'migrations');

/**
 * Small wrapper so call sites read like better-sqlite3: prepare().get/run/all
 * pluss a transaction() helper.
 */
/**
 * Thin wrapper over node:sqlite with the four calls the app uses.
 * Exported as a type so the rest of the code can point at it.
 */
export class Db {
  /**
   * @param {string} databasePath
   */
  constructor(databasePath) {
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.raw = new DatabaseSync(databasePath);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  /**
   * @param {string} sql
   */
  prepare(sql) {
    const stmt = this.raw.prepare(sql);
    return {
      /** @param {any[]} params */
      get: (...params) => stmt.get(...params),
      /** @param {any[]} params */
      all: (...params) => stmt.all(...params),
      /**
       * @param {any[]} params
       * @returns {{changes: number, lastInsertRowid: number}}
       */
      run: (...params) => {
        const info = stmt.run(...params);
        return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
      },
    };
  }

  /** @param {string} sql */
  exec(sql) {
    this.raw.exec(sql);
  }

  close() {
    this.raw.close();
  }

  /**
   * Run a function inside one transaction; roll back if it throws.
   * @template T
   * @param {() => T} fn
   * @returns {() => T}
   */
  transaction(fn) {
    return () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        this.raw.exec('COMMIT');
        return out;
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      }
    };
  }
}

/**
 * Open (and migrate) the database.
 * @param {string} databasePath
 */
export function openDb(databasePath) {
  const db = new Db(databasePath);
  migrate(db);
  return db;
}

/**
 * Apply every server/migrations/NNN_*.sql file once, in file-name order.
 * @param {Db} db
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => String(r.name)),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    apply();
  }
}

/**
 * @param {any} row
 */
export function rowToUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    wallet: String(row.wallet),
    maxTradeUsd: Number(row.max_trade_usd),
    maxDailyLossUsd: Number(row.max_daily_loss_usd),
    createdAt: String(row.created_at),
  };
}

