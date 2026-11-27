// server/pump-run.js - the pump.fun rule set, running in PAPER mode only.
//
// Rules (from server/pumpfun.js, unit-tested there):
//   take profit at +10.00 USD, stop loss at -20%, rotate to the next token,
//   compound each win, stop at 5,000 USD realised.
//
// Every number here is SIMULATED. The price feed is a deterministic paper walk,
// not live pump.fun data, and no transaction is ever built: this module has no
// wallet, no key and no RPC. Paper marks are labelled "simulated" on screen.

import crypto from 'node:crypto';
import {
  DEFAULT_WATCHLIST,
  GOAL_CENTS,
  STOP_LOSS_PCT,
  TAKE_PROFIT_CENTS,
  afterClose,
  decideExit,
  nextToken,
  paperPosition,
  ruleSummary,
} from './pumpfun.js';

/** @typedef {import('./db.js').Db} Db */

export const DEFAULT_SIZE_CENTS = 500; // $5.00
const DEFAULT_MINT = DEFAULT_WATCHLIST[0]?.mint ?? 'paper-mint-1';

/**
 * A deterministic simulated price for one token at one step of the run.
 * Same mint + same step always gives the same micro-USD price, so a test and a
 * reload see the same numbers. A short hash keeps it from drifting to zero.
 * @param {string} mint
 * @param {number} step
 * @returns {number} price in micro-USD per token
 */
export function paperPriceMicros(mint, step) {
  const digest = crypto.createHash('sha256').update(`${mint}:${step}`).digest();
  const swing = (digest[0] / 255 - 0.45) * 0.35; // -0.1575 .. +0.1925 per step
  const base = 0.00002 + (digest[1] / 255) * 0.00005; // 20e-6 .. 70e-6 USD
  const decay = Math.max(0.35, 1 + swing * Math.min(step, 12) * 0.5);
  return Math.max(1, Math.round(base * decay * 1e6));
}

/**
 * The stored run for a user, created on first use.
 * @param {Db} db
 * @param {string} userId
 * @returns {any}
 */
export function ensureRun(db, userId) {
  const row = db.prepare('SELECT * FROM pump_runs WHERE user_id = ?').get(userId);
  if (row) return row;
  const watchlist = JSON.stringify(DEFAULT_WATCHLIST);
  db.prepare('INSERT INTO pump_runs (user_id, watchlist_json) VALUES (?, ?)').run(userId, watchlist);
  return db.prepare('SELECT * FROM pump_runs WHERE user_id = ?').get(userId);
}

/**
 * @param {Db} db
 * @param {string} userId
 * @param {any} run
 */
function save(db, userId, run) {
  db.prepare(
    `UPDATE pump_runs SET size_cents = ?, realised_cents = ?, open_mint = ?, open_symbol = ?,
       open_entry_cents = ?, open_entry_price_micros = ?, open_tokens = ?, last_price_micros = ?,
       last_mark_at = ?, closed_json = ?, goal_reached = ?, updated_at = datetime('now')
     WHERE user_id = ?`,
  ).run(
    run.size_cents,
    run.realised_cents,
    run.open_mint,
    run.open_symbol,
    run.open_entry_cents,
    run.open_entry_price_micros,
    run.open_tokens,
    run.last_price_micros,
    run.last_mark_at,
    run.closed_json,
    run.goal_reached,
    userId,
  );
}

/**
 * Step the paper run once: open a position, or mark the open one and close it
 * when a rule fires, then rotate to the next token.
 * @param {Db} db
 * @param {{userId: string, step: number, maxSizeCents?: number, log?: (kind: string, message: string) => void}} p
 * @returns {{action: string, pnlCents: number, reason: string, symbol: string|null, realisedCents: number, sizeCents: number, goalReached: boolean}}
 */
export function mark(db, p) {
  const log = p.log ?? (() => {});
  const userId = p.userId;
  let run = ensureRun(db, userId);
  const watchlist = /** @type {{mint: string, symbol: string}[]} */ (JSON.parse(run.watchlist_json));
  const step = Math.max(0, Math.round(p.step));

  // The per-trade cap always wins over the run's own size.
  const capCents = Math.max(1, Math.round((p.maxSizeCents ?? DEFAULT_SIZE_CENTS) / 1));
  const sizeCents = Math.min(Math.max(1, Math.round(run.size_cents)), capCents);

  if (run.goal_reached) {
    return {
      action: 'done',
      pnlCents: 0,
      reason: `the run is over: realised $${(run.realised_cents / 100).toFixed(2)} reached the target`,
      symbol: null,
      realisedCents: run.realised_cents,
      sizeCents: 0,
      goalReached: true,
    };
  }

  // Nothing open: open the first token of the watchlist.
  if (!run.open_mint) {
    const first = { mint: DEFAULT_MINT, symbol: watchlist[0]?.symbol ?? 'PAPER' };
    const priceMicros = paperPriceMicros(first.mint, step);
    const pos = paperPosition(first.mint, sizeCents, priceMicros);
    run.open_mint = pos.mint;
    run.open_symbol = first.symbol;
    run.open_entry_cents = pos.entryCents;
    run.open_entry_price_micros = pos.entryPrice;
    run.open_tokens = pos.tokens;
    run.last_price_micros = priceMicros;
    run.last_mark_at = new Date().toISOString();
    save(db, userId, run);
    const reason = `simulated paper entry: ${first.symbol} $${(sizeCents / 100).toFixed(2)} at $${(priceMicros / 1e6).toFixed(8)} (paper price, not live)`;
    log('pump_open', reason);
    return { action: 'open', pnlCents: 0, reason, symbol: first.symbol, realisedCents: run.realised_cents, sizeCents, goalReached: false };
  }

  // Mark the open position at this step's simulated price.
  const priceMicros = paperPriceMicros(String(run.open_mint), step);
  const exit = decideExit(
    {
      mint: String(run.open_mint),
      entryCents: Number(run.open_entry_cents),
      entryPrice: Number(run.open_entry_price_micros),
      tokens: Number(run.open_tokens),
    },
    priceMicros,
  );
  run.last_price_micros = priceMicros;
  run.last_mark_at = new Date().toISOString();

  if (exit.action === 'hold') {
    save(db, userId, run);
    const reason = `${String(run.open_symbol)} marked at $${(priceMicros / 1e6).toFixed(8)} (paper), ${exit.reason}`;
    log('pump_mark', reason);
    return { action: 'hold', pnlCents: exit.pnlCents, reason, symbol: String(run.open_symbol), realisedCents: run.realised_cents, sizeCents, goalReached: false };
  }

  // A rule fired: close, compound, rotate.
  const closedMint = String(run.open_mint);
  const after = afterClose({
    sizeCents: Number(run.open_entry_cents),
    realisedCents: Number(run.realised_cents),
    pnlCents: exit.pnlCents,
  });
  const closed = /** @type {any[]} */ (JSON.parse(run.closed_json));
  closed.unshift({
    mint: closedMint,
    symbol: String(run.open_symbol),
    action: exit.action,
    pnlCents: exit.pnlCents,
    at: new Date().toISOString(),
  });

  run.realised_cents = after.realisedCents;
  run.closed_json = JSON.stringify(closed.slice(0, 40));
  run.goal_reached = after.goalReached ? 1 : 0;
  const doneMints = new Set(closed.filter((c) => c.pnlCents > 0).map((c) => String(c.mint)));
  const next = after.goalReached ? null : nextToken(watchlist, closedMint, doneMints);

  if (!next || after.nextSizeCents <= 0) {
    run.open_mint = null;
    run.open_symbol = null;
    run.open_entry_cents = null;
    run.open_entry_price_micros = null;
    run.open_tokens = null;
    run.size_cents = Math.max(0, after.nextSizeCents);
    if (!after.goalReached) run.goal_reached = 1;
    save(db, userId, run);
    const reason = `${exit.action === 'take_profit' ? 'take profit' : 'stop loss'} closed ${closed[0].symbol} for ${pnlText(exit.pnlCents)}; ${after.note}`;
    log('pump_close', reason);
    return { action: exit.action, pnlCents: exit.pnlCents, reason, symbol: null, realisedCents: run.realised_cents, sizeCents: 0, goalReached: true };
  }

  // Rotate into the next token at the same step's simulated price.
  const nextPrice = paperPriceMicros(next.mint, step);
  const pos = paperPosition(next.mint, after.nextSizeCents, nextPrice);
  run.open_mint = pos.mint;
  run.open_symbol = next.symbol;
  run.open_entry_cents = pos.entryCents;
  run.open_entry_price_micros = pos.entryPrice;
  run.open_tokens = pos.tokens;
  run.size_cents = after.nextSizeCents;
  save(db, userId, run);
  const reason = `${exit.action === 'take_profit' ? 'take profit' : 'stop loss'} closed ${closed[0].symbol} for ${pnlText(exit.pnlCents)}; rotated into ${next.symbol} at $${(nextPrice / 1e6).toFixed(8)} (paper); ${after.note}`;
  log('pump_rotate', reason);
  return { action: 'rotate', pnlCents: exit.pnlCents, reason, symbol: next.symbol, realisedCents: run.realised_cents, sizeCents: after.nextSizeCents, goalReached: false };
}

/**
 * @param {number} cents
 * @returns {string}
 */
function pnlText(cents) {
  const sign = cents >= 0 ? '+' : '-';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * What the pump.fun panel shows. Everything marked simulated comes from the paper walk.
 * @param {Db} db
 * @param {string} userId
 */
export function summary(db, userId) {
  const run = ensureRun(db, userId);
  const rules = ruleSummary();
  const realisedCents = Number(run.realised_cents);
  const openCents = run.open_entry_cents === null ? 0 : Number(run.open_entry_cents);
  const lastMicros = run.last_price_micros === null ? 0 : Number(run.last_price_micros);
  const entryMicros = run.open_entry_price_micros === null ? 0 : Number(run.open_entry_price_micros);
  const unrealisedCents = entryMicros > 0 && openCents > 0 ? Math.round(openCents * (lastMicros / entryMicros)) - openCents : 0;
  return {
    venue: 'pump.fun',
    simulated: true,
    rules,
    sizeCents: Number(run.size_cents),
    realisedCents,
    goalCents: GOAL_CENTS,
    goalReached: Boolean(run.goal_reached),
    takeProfitCents: TAKE_PROFIT_CENTS,
    stopLossPct: STOP_LOSS_PCT,
    open: run.open_mint
      ? {
          mint: String(run.open_mint),
          symbol: String(run.open_symbol ?? ''),
          entryCents: openCents,
          lastPriceMicros: lastMicros,
          unrealisedCents,
          lastMarkAt: run.last_mark_at,
        }
      : null,
    closed: /** @type {any[]} */ (JSON.parse(run.closed_json)),
  };
}
