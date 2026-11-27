// server/pump-run.js - runs the pump.fun rule set in PAPER mode, on purpose, on request.
//
// Every number here is simulated: the prices are the paper feed in server/prices.js,
// the balance is fake, and no transaction is built or signed. The rules themselves
// (take profit $10, stop loss 20%, rotate, compound, goal $5,000) live in
// server/pumpfun.js and are fixed: the person can lower the starting size but not
// raise a rule.
//
// All money is whole US cents. Never a floating-point dollar sum.
import crypto from 'node:crypto';
import {
  DEFAULT_WATCHLIST,
  decideExit,
  afterClose,
  nextToken,
  paperPosition,
  ruleSummary,
  GOAL_CENTS,
} from './pumpfun.js';
import { history } from './prices.js';
import { logEvent } from './bot.js';
import { Db } from './db.js';

/** Starting size in cents, and the ceiling the person may set. */
export const DEFAULT_SIZE_CENTS = 500;
export const MAX_SIZE_CENTS = 1000;

/** The four markets in the paper feed that the pump run trades. */
const PAPER_MINTS = ['pump-a', 'pump-b', 'pump-c', 'pump-d'];

/**
 * @typedef {object} PumpRun
 * @property {string} userId
 * @property {{mint: string, symbol: string}[]} watchlist
 * @property {number} sizeCents
 * @property {number} realisedCents
 * @property {{mint: string, symbol: string, entryCents: number, entryPrice: number, tokens: number, lastPrice: number}|null} open
 * @property {{mint: string, symbol: string, pnlCents: number, reason: string, at: string}[]} closed
 * @property {boolean} goalReached
 */

/**
 * Read the run for an account, creating the row (and the watchlist) the first time.
 * @param {Db} db
 * @param {string} userId
 * @returns {PumpRun}
 */
export function loadRun(db, userId) {
  const row = db.prepare('SELECT * FROM pump_runs WHERE user_id = ?').get(userId);
  if (!row) {
    saveRun(db, {
      userId,
      watchlist: DEFAULT_WATCHLIST,
      sizeCents: DEFAULT_SIZE_CENTS,
      realisedCents: 0,
      open: null,
      closed: [],
      goalReached: false,
    });
    return loadRun(db, userId);
  }
  return {
    userId: String(row.user_id),
    watchlist: JSON.parse(String(row.watchlist_json)),
    sizeCents: Number(row.size_cents),
    realisedCents: Number(row.realised_cents),
    open: row.open_mint
      ? {
          mint: String(row.open_mint),
          symbol: String(row.open_symbol),
          entryCents: Number(row.open_entry_cents),
          entryPrice: Number(row.open_entry_price_micros),
          tokens: Number(row.open_tokens),
          lastPrice: Number(row.last_price_micros),
        }
      : null,
    closed: JSON.parse(String(row.closed_json)),
    goalReached: Number(row.goal_reached) === 1,
  };
}

/**
 * @param {Db} db
 * @param {PumpRun} run
 */
export function saveRun(db, run) {
  const open = run.open;
  db.prepare(
    `INSERT INTO pump_runs (user_id, watchlist_json, size_cents, realised_cents, open_mint, open_symbol,
       open_entry_cents, open_entry_price_micros, open_tokens, last_price_micros, last_mark_at, closed_json,
       goal_reached, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       watchlist_json = excluded.watchlist_json, size_cents = excluded.size_cents,
       realised_cents = excluded.realised_cents, open_mint = excluded.open_mint,
       open_symbol = excluded.open_symbol, open_entry_cents = excluded.open_entry_cents,
       open_entry_price_micros = excluded.open_entry_price_micros, open_tokens = excluded.open_tokens,
       last_price_micros = excluded.last_price_micros, last_mark_at = excluded.last_mark_at,
       closed_json = excluded.closed_json, goal_reached = excluded.goal_reached,
       updated_at = datetime('now')`,
  ).run(
    run.userId,
    JSON.stringify(run.watchlist),
    run.sizeCents,
    run.realisedCents,
    open ? open.mint : null,
    open ? open.symbol : null,
    open ? open.entryCents : null,
    open ? open.entryPrice : null,
    open ? open.tokens : null,
    open ? open.lastPrice : null,
    open ? new Date().toISOString() : null,
    JSON.stringify(run.closed),
    run.goalReached ? 1 : 0,
  );
}

/**
 * Set the starting size in cents. Lowering is fine; going above the ceiling is not.
 * @param {Db} db
 * @param {string} userId
 * @param {number} sizeCents
 */
export function setSize(db, userId, sizeCents) {
  const run = loadRun(db, userId);
  const wanted = Math.round(Number(sizeCents));
  if (!Number.isFinite(wanted) || wanted <= 0) {
    throw new Error('the size must be a positive number of cents');
  }
  // The cap is a cap: clamping down is silent, going up is refused, not quietly capped.
  if (wanted > MAX_SIZE_CENTS) {
    throw new Error(`the starting size cannot go above $${(MAX_SIZE_CENTS / 100).toFixed(2)}`);
  }
  run.sizeCents = wanted;
  saveRun(db, run);
  return run;
}

/**
 * Pick the market to trade: the open one, else the next unused token, else the first.
 * @param {PumpRun} run
 * @returns {{mint: string, symbol: string}}
 */
function pickMarket(run) {
  if (run.open) return { mint: run.open.mint, symbol: run.open.symbol };
  const done = new Set(run.closed.map((c) => c.mint));
  const fresh = nextToken(run.watchlist, '', done);
  if (fresh) return fresh;
  // Every token has taken a profit in this run: start again from the first.
  return run.watchlist[0];
}

/**
 * One step of the pump.fun run. Opens, marks or closes a paper position by the rules.
 *
 * @param {Db} db
 * @param {string} userId
 * @param {number} [seed]
 * @returns {{action: string, reason: string, run: PumpRun, closedNow: object|null}}
 */
export function markPumpRun(db, userId, seed = 0) {
  const run = loadRun(db, userId);
  const rules = ruleSummary();

  if (run.goalReached) {
    return {
      action: 'stopped',
      reason: `${rules.goalUsd === GOAL_CENTS / 100 ? 'goal reached' : ''}: realised $${(run.realisedCents / 100).toFixed(2)} is at or above the $${(GOAL_CENTS / 100).toFixed(2)} target - the paper run is over`,
      run,
      closedNow: null,
    };
  }

  // Open a position when there is none.
  if (!run.open) {
    const market = pickMarket(run);
    const price = history(market.mint, 30, seed).last;
    const priceMicros = Math.max(1, Math.round(price * 1e6));
    const pos = paperPosition(market.mint, run.sizeCents, priceMicros);
    run.open = {
      mint: pos.mint,
      symbol: market.symbol,
      entryCents: pos.entryCents,
      entryPrice: pos.entryPrice,
      tokens: pos.tokens,
      lastPrice: pos.entryPrice,
    };
    saveRun(db, run);
    const reason = `paper entry: $${(pos.entryCents / 100).toFixed(2)} into ${market.symbol} at a simulated price - no transaction is built or signed`;
    logEvent(db, userId, 'pump_open', reason);
    return { action: 'open', reason, run, closedNow: null };
  }

  // Mark the open position at the current simulated price.
  const priceMicros = Math.max(1, Math.round(history(run.open.mint, 30, seed).last * 1e6));
  run.open.lastPrice = priceMicros;
  const exit = decideExit(
    { mint: run.open.mint, entryCents: run.open.entryCents, entryPrice: run.open.entryPrice, tokens: run.open.tokens },
    priceMicros,
  );

  if (exit.action === 'hold') {
    saveRun(db, run);
    logEvent(db, userId, 'pump_mark', `${run.open.symbol} (paper): ${exit.reason}`);
    return { action: 'hold', reason: exit.reason, run, closedNow: null };
  }

  // Close: take profit or stop loss, then compound by the rules.
  const closed = {
    mint: run.open.mint,
    symbol: run.open.symbol,
    pnlCents: exit.pnlCents,
    reason: exit.reason,
    at: new Date().toISOString(),
  };
  const after = afterClose({ sizeCents: run.sizeCents, realisedCents: run.realisedCents, pnlCents: exit.pnlCents });
  run.closed = [closed, ...run.closed].slice(0, 50);
  run.realisedCents = after.realisedCents;
  run.sizeCents = after.nextSizeCents > 0 ? after.nextSizeCents : run.sizeCents;
  run.goalReached = after.goalReached;
  run.open = null;
  saveRun(db, run);
  logEvent(db, userId, 'pump_close', `${closed.symbol} (paper) closed: ${exit.reason}; ${after.note}`);
  return { action: exit.action, reason: exit.reason, run, closedNow: closed };
}

/**
 * The run as the screen shows it. Marked as simulated on every number.
 * @param {Db} db
 * @param {string} userId
 */
export function pumpSummary(db, userId, seed = 0) {
  const run = loadRun(db, userId);
  const rules = ruleSummary();
  let openView = null;
  if (run.open) {
    const exit = decideExit(
      { mint: run.open.mint, entryCents: run.open.entryCents, entryPrice: run.open.entryPrice, tokens: run.open.tokens },
      run.open.lastPrice,
    );
    openView = {
      symbol: run.open.symbol,
      mint: run.open.mint,
      sizeUsd: run.open.entryCents / 100,
      valueUsd: exit.valueCents / 100,
      pnlUsd: exit.pnlCents / 100,
      reason: exit.reason,
      simulated: true,
    };
  }
  return {
    rules,
    simulated: true,
    balanceNote: 'Paper balance. Simulated prices. Nothing here is real money or a forecast.',
    sizeUsd: run.sizeCents / 100,
    maxSizeUsd: MAX_SIZE_CENTS / 100,
    realisedUsd: run.realisedCents / 100,
    goalUsd: GOAL_CENTS / 100,
    goalReached: run.goalReached,
    open: openView,
    watchlist: run.watchlist,
    closed: run.closed.slice(0, 10).map((c) => ({
      symbol: c.symbol,
      pnlUsd: c.pnlCents / 100,
      reason: c.reason,
      at: c.at,
    })),
    markets: history(list => list, 0, seed) && undefined,
    paperMarkets: PAPER_MINTS,
  };
}

/**
 * A stable per-account seed for the simulated feed, so two accounts do not see
 * identical runs and one account sees the same run on every reload.
 * @param {string} userId
 */
export function seedFor(userId) {
  const h = crypto.createHash('sha256').update(`pump:${userId}`).digest();
  return h.readUInt32BE(0) % 1000;
}
