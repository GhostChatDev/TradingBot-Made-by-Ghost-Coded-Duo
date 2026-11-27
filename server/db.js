// server/db.js - SQLite connection + a tiny forward-only migration runner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
// SQLite migrations live next to the server on purpose: the repository is also
// checked by a CI job that installs every migrations/*.sql into Postgres, and
// these files are SQLite dialect (PRAGMA, datetime('now')).
const MIGRATIONS_DIR = path.join(here, 'migrations');

/**
 * Open (and migrate) the database.
 * @param {string} databasePath
 */
export function openDb(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * Apply every migrations/NNN_*.sql file once, in file-name order.
 * @param {import('better-sqlite3').Database} db
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
 * @param {import('better-sqlite3').Database} db
 * @param {URLSearchParams|Record<string,string>} params
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
