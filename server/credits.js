// server/credits.js - a prepaid integer-credit ledger. Never crypto held for anyone.
import crypto from 'node:crypto';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 */
export function ensureAccount(db, userId) {
  db.prepare('INSERT OR IGNORE INTO credits (user_id, balance) VALUES (?, 0)').run(userId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 */
export function getBalance(db, userId) {
  const row = db.prepare('SELECT balance FROM credits WHERE user_id = ?').get(userId);
  return row ? Number(row.balance) : 0;
}

/**
 * Take exactly `cost` credits, or nothing at all. The balance can never go negative
 * because the UPDATE is conditional: a second racing call sees the reduced balance
 * and is refused instead of pushing the number below zero.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {number} cost
 * @param {string} reason
 * @param {string|null} ref
 * @returns {{ok: boolean, balance: number}}
 */
export function spend(db, userId, cost, reason, ref = null) {
  if (!Number.isInteger(cost) || cost <= 0) throw new Error('cost must be a positive integer');
  const run = db.transaction(() => {
    ensureAccount(db, userId);
    const info = db
      .prepare(
        "UPDATE credits SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?",
      )
      .run(cost, userId, cost);
    if (info.changes === 0) return { ok: false, balance: getBalance(db, userId) };
    db.prepare('INSERT INTO credit_entries (id, user_id, delta, reason, ref) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(),
      userId,
      -cost,
      reason,
      ref,
    );
    return { ok: true, balance: getBalance(db, userId) };
  });
  return run();
}

/**
 * TEST MODE ONLY: fake money, no payment provider is contacted.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {number} amount
 * @param {string} ref
 */
export function grantTestCredits(db, userId, amount, ref) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer');
  const run = db.transaction(() => {
    ensureAccount(db, userId);
    db.prepare(
      "UPDATE credits SET balance = balance + ?, updated_at = datetime('now') WHERE user_id = ?",
    ).run(amount, userId);
    db.prepare('INSERT INTO credit_entries (id, user_id, delta, reason, ref) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(),
      userId,
      amount,
      'test_topup',
      ref,
    );
    return getBalance(db, userId);
  });
  return run();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {number} limit
 */
export function ledger(db, userId, limit = 25) {
  const rows = db
    .prepare(
      'SELECT id, delta, reason, ref, created_at FROM credit_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(userId, limit);
  return rows.map((r) => ({
    id: String(r.id),
    delta: Number(r.delta),
    reason: String(r.reason),
    ref: r.ref ? String(r.ref) : null,
    createdAt: String(r.created_at),
  }));
}
