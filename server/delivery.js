// server/delivery.js - what the bot does with a devnet draft when nobody is watching.
//
// Two choices, made by the person, never assumed:
//   'json'   (default) the draft is stored and handed back as JSON; the person
//            signs it with their own tooling. Nothing ever leaves the server.
//   'signer' the server asks the browser's wallet adapter to sign it, and the
//            person approves there (or an auto-approve that only runs while the
//            tab is open and still obeys every cap).
//
// This module holds no key and can build no transaction. It only stores a setting.

/** @typedef {import('./db.js').Db} Db */

/** @typedef {'json'|'signer'} Delivery */

export const DEFAULT_DELIVERY = /** @type {Delivery} */ ('json');

/**
 * @param {Db} db
 * @param {string} userId
 * @returns {Delivery}
 */
export function getDelivery(db, userId) {
  const row = db.prepare('SELECT delivery FROM delivery_settings WHERE user_id = ?').get(userId);
  const value = row ? String(row.delivery) : DEFAULT_DELIVERY;
  return value === 'signer' ? 'signer' : 'json';
}

/**
 * @param {Db} db
 * @param {string} userId
 * @param {Delivery} delivery
 */
export function setDelivery(db, userId, delivery) {
  if (delivery !== 'json' && delivery !== 'signer') {
    throw new Error('delivery must be json or signer');
  }
  db.prepare(
    `INSERT INTO delivery_settings (user_id, delivery, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET delivery = excluded.delivery, updated_at = datetime('now')`,
  ).run(userId, delivery);
}

/**
 * Remove trade drafts older than the retention window. A draft is unsigned and
 * holds no key, but it describes an order, so it is not kept for ever.
 * @param {Db} db
 * @param {number} hours
 * @returns {number} rows cleared
 */
export function sweepDrafts(db, hours = 24) {
  const info = db
    .prepare(
      `UPDATE trades SET draft_tx = NULL, draft_at = NULL
       WHERE draft_tx IS NOT NULL AND draft_at IS NOT NULL
         AND draft_at < datetime('now', ?)`,
    )
    .run(`-${Math.max(1, Math.round(hours))} hours`);
  return Number(info.changes ?? 0);
}
