// server/keys.js - API keys are stored only as a salted SHA-256 hash.
// The plaintext key is returned once, at creation, and never stored or logged.
import crypto from 'node:crypto';

const KEY_PREFIX = 'sb_sk_';

/** Create a fresh secret API key string. */
export function generateApiKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/**
 * @param {string} key
 * @param {string} pepper
 */
export function hashKey(key, pepper) {
  return crypto.createHash('sha256').update(pepper).update(key, 'utf8').digest('hex');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} label
 * @param {string} pepper
 */
export function createKey(db, userId, label, pepper) {
  const key = generateApiKey();
  const id = crypto.randomUUID();
  const prefix = key.slice(0, 12);
  db.prepare(
    `INSERT INTO api_keys (id, user_id, label, prefix, key_hash) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, label.slice(0, 60) || 'API key', prefix, hashKey(key, pepper));
  return { id, key, prefix, label, createdAt: new Date().toISOString() };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 */
export function listKeys(db, userId) {
  const rows = db
    .prepare(
      `SELECT id, label, prefix, created_at, last_used_at, revoked_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    prefix: String(r.prefix),
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
  }));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} id
 */
export function revokeKey(db, userId, id) {
  const info = db
    .prepare(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(id, userId);
  return info.changes > 0;
}

/**
 * Look up a presented Bearer token. Returns null for unknown, malformed or revoked keys.
 * @param {import('better-sqlite3').Database} db
 * @param {string|undefined} token
 * @param {string} pepper
 */
export function authenticate(db, token, pepper) {
  if (!token || typeof token !== 'string' || !token.startsWith(KEY_PREFIX)) return null;
  const row = db
    .prepare(`SELECT id, user_id, prefix, revoked_at FROM api_keys WHERE key_hash = ?`)
    .get(hashKey(token, pepper));
  if (!row || row.revoked_at) return null;
  return { keyId: String(row.id), userId: String(row.user_id), prefix: String(row.prefix) };
}

/**
 * Sliding one-minute window counter kept in api_calls (no extra table needed).
 * @param {import('better-sqlite3').Database} db
 * @param {string} keyId
 * @param {number} perMinute
 * @param {number} now
 */
export function checkRateLimit(db, keyId, perMinute, now = Date.now()) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM api_calls WHERE key_id = ? AND created_at > ?')
    .get(keyId, now - 60_000);
  return Number(row ? row.n : 0) < perMinute;
}
