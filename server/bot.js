// server/bot.js - the engine: price -> signal -> risk checks -> paper fill or devnet draft.
// It NEVER holds a key. In paper mode it cannot build a transaction at all.
import crypto from 'node:crypto';
import { HARD_MAX_DAILY_LOSS_USD, HARD_MAX_TRADE_USD } from './config.js';
import { crossoverSignal } from './strategy.js';
import { Db } from './db.js';
import { history, paperFee } from './prices.js';
import { toMicros, fromMicros } from './money.js';

export const STRATEGIES = ['sma_crossover'];

/**
 * @param {Db} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.market
 * @param {string} input.strategy
 * @param {{fast:number,slow:number}} input.params
 * @param {'paper'|'devnet'} input.mode
 * @param {number} input.seed
 */
export function evaluate(db, input) {
  const { userId, market, strategy, params, mode, seed } = input;
  const hist = history(market, Math.max(params.slow + 1, 30), seed);
  const sig = crossoverSignal(hist.prices, params);
  const price = hist.last;
  return {
    market,
    strategy,
    mode,
    price,
    priceSource: hist.source,
    signal: sig.signal,
    reason: sig.reason,
    fast: sig.fast,
    slow: sig.slow,
    at: new Date().toISOString(),
    userId,
  };
}

/**
 * Risk gate. Returns { allowed, blockedBy, message }.
 * @param {Db} db
 * @param {string} userId
 * @param {number} notionalUsd
 * @param {string} today
 */
export function checkRisk(db, userId, notionalUsd, today) {
  const user = db
    .prepare('SELECT max_trade_usd, max_daily_loss_usd FROM users WHERE id = ?')
    .get(userId);
  const maxTrade = Math.min(Number(user?.max_trade_usd ?? 5), HARD_MAX_TRADE_USD);
  const maxLoss = Math.min(Number(user?.max_daily_loss_usd ?? 10), HARD_MAX_DAILY_LOSS_USD);

  const stopped = db
    .prepare("SELECT stop_reason FROM bots WHERE user_id = ? AND stop_reason = 'STOP' ORDER BY updated_at DESC LIMIT 1")
    .get(userId);
  if (stopped) return { allowed: false, blockedBy: 'stop', message: 'STOP is pressed. Clear it before trading again.' };

  const lossRow = db
    .prepare('SELECT losses_usd, loss_day FROM bots WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId);
  const losses = lossRow && String(lossRow.loss_day) === today ? Number(lossRow.losses_usd) : 0;
  if (losses >= maxLoss) {
    return {
      allowed: false,
      blockedBy: 'daily_loss_cap',
      message: `Daily loss cap reached ($${losses.toFixed(2)} of $${maxLoss.toFixed(2)}). Trading is halted until tomorrow.`,
    };
  }
  if (notionalUsd > maxTrade) {
    return {
      allowed: false,
      blockedBy: 'per_trade_cap',
      message: `Trade of $${notionalUsd.toFixed(2)} is above your per-trade cap of $${maxTrade.toFixed(2)}.`,
    };
  }
  return { allowed: true, blockedBy: null, message: 'inside your limits' };
}

/**
 * @typedef {object} TradeRecord
 * @property {string} userId
 * @property {string} [botId]
 * @property {'paper'|'devnet'} mode
 * @property {string} market
 * @property {string} side
 * @property {number} qty
 * @property {number} priceUsd
 * @property {number} notionalUsd
 * @property {number} feeUsd
 * @property {string} reason
 * @property {string} status
 * @property {string|null} [signature]
 * @property {number} [avgCostUsd]
 * @property {string} [at] ISO time of the fill; defaults to now
 */

/** The bot row this account's risk numbers live on, created if missing.
 * @param {any} db @param {string} userId */
function ensureBotRow(db, userId) {
  const existing = db.prepare('SELECT id FROM bots WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId);
  if (existing) return String(existing.id);
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO bots (id, user_id, market, strategy, params, running, stop_reason, losses_usd, loss_day) VALUES (?, ?, 'SOL/USD', 'sma_crossover', '{}', 0, NULL, 0, NULL) ON CONFLICT(id) DO NOTHING",
  ).run(id, userId);
  return id;
}

/**
 * Realised result of a trade against the position it closes: profit or loss in
 * whole micro-dollars. A buy opens (or adds to) a position and has no result.
 * @param {TradeRecord} t
 * @param {{qty: number, avgCostUsd: number}} pos
 * @returns {number} micro-dollars; negative is a loss
 */
export function realisedMicros(t, pos) {
  if (t.side !== 'sell' || pos.qty <= 0) return 0;
  const closingQty = Math.min(t.qty, pos.qty);
  const proceeds = toMicros(t.priceUsd * closingQty) - toMicros(t.feeUsd);
  const cost = toMicros(pos.avgCostUsd * closingQty);
  return proceeds - cost;
}

/**
 * Write the position after a trade back onto the bot row, and add any realised
 * loss to today's running loss (a gain never subtracts from it).
 * @param {Db} db
 * @param {string} userId
 * @param {TradeRecord} t
 */
export function applyPosition(db, userId, t) {
  const botId = ensureBotRow(db, userId);
  const row = db.prepare('SELECT qty_usd, avg_cost_usd, losses_usd, loss_day FROM bots WHERE id = ?').get(botId);
  const day = String(t.at || new Date().toISOString()).slice(0, 10);
  const heldMicros = toMicros(Number(row?.qty_usd ?? 0));
  let costMicros = toMicros(Number(row?.avg_cost_usd ?? 0));
  let posQty = heldMicros > 0 && costMicros > 0 ? heldMicros / costMicros : 0;

  const micros = realisedMicros(t, { qty: posQty, avgCostUsd: fromMicros(costMicros) });
  const sameDay = String(row?.loss_day ?? '') === day;
  let lossesMicros = sameDay ? toMicros(Number(row?.losses_usd ?? 0)) : 0;
  if (micros < 0) lossesMicros += -micros;

  if (t.side === 'buy') {
    // Cost basis is what was paid: price x quantity plus the fee. The same
    // formula the sell side uses for proceeds, so a loss is never invented by
    // mixing a request's notional with a market price.
    costMicros += toMicros(t.priceUsd * t.qty) + toMicros(t.feeUsd);
    posQty += t.qty;
  } else {
    posQty = Math.max(0, posQty - Math.min(t.qty, posQty));
    if (posQty === 0) costMicros = 0;
  }

  db.prepare("UPDATE bots SET qty_usd = ?, avg_cost_usd = ?, losses_usd = ?, loss_day = ?, updated_at = datetime('now') WHERE id = ?").run(
    fromMicros(costMicros),
    fromMicros(posQty > 0 ? costMicros / posQty : 0),
    fromMicros(lossesMicros),
    day,
    botId,
  );
  return { botId, realisedUsd: fromMicros(micros), lossesUsd: fromMicros(lossesMicros) };
}

/**
 * Record a trade. Paper trades never carry a transaction or a signature.
 * @param {Db} db
 * @param {TradeRecord} t
 */
export function recordTrade(db, t) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO trades (id, user_id, bot_id, mode, market, side, qty, price_usd, notional_usd, fee_usd, reason, status, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.userId,
    t.botId ?? null,
    t.mode,
    t.market,
    t.side,
    t.qty,
    t.priceUsd,
    t.notionalUsd,
    t.feeUsd,
    t.reason,
    t.status,
    t.mode === 'paper' ? null : (t.signature ?? null),
  );
  // A filled trade moves the position and, when it closes at a lower price,
  // adds the realised loss to today's total. This is what the daily cap reads.
  if (t.status !== 'rejected') applyPosition(db, t.userId, t);
  return id;
}

/**
 * @param {Db} db
 * @param {string} userId
 * @param {string} kind
 * @param {string} message
 * @param {string|null} botId
 */
export function logEvent(db, userId, kind, message, botId = null) {
  db.prepare('INSERT INTO bot_events (id, user_id, bot_id, kind, message) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    userId,
    botId,
    kind,
    message.slice(0, 500),
  );
}

/**
 * @typedef {object} TickInput
 * @property {string} userId
 * @property {string} market
 * @property {string} strategy
 * @property {{fast: number, slow: number}} params
 * @property {'paper'|'devnet'} mode
 * @property {number} [seed]
 * @property {string} [botId]
 * @property {number} [maxTradeUsd]
 */

/**
 * Run one tick. Paper mode only records; devnet returns a draft for the wallet to sign.
 * @param {Db} db
 * @param {TickInput} p
 */
export function tick(db, p) {
  const { userId, market, strategy, params, mode, seed = 0, botId } = p;
  if (mode !== 'paper' && mode !== 'devnet') {
    throw new Error('only paper and devnet are available in this build');
  }
  const decision = evaluate(db, { userId, market, strategy, params, mode, seed });
  logEvent(db, userId, 'decision', `${decision.signal.toUpperCase()} - ${decision.reason}`, botId ?? null);

  if (decision.signal === 'hold') {
    return { decision, trade: null, blocked: null };
  }

  // Paper: a fixed small notional, so paper results are honest and repeatable.
  const notionalUsd = Math.min(1, p.maxTradeUsd ?? 1);
  const risk = checkRisk(db, userId, notionalUsd, new Date().toISOString().slice(0, 10));
  if (!risk.allowed) {
    logEvent(db, userId, 'blocked', risk.message, botId ?? null);
    return { decision, trade: null, blocked: risk };
  }

  if (mode === 'paper') {
    const feeUsd = paperFee(notionalUsd);
    const id = recordTrade(db, {
      userId,
      botId,
      mode: 'paper',
      market,
      side: decision.signal,
      qty: Number((notionalUsd / decision.price).toFixed(8)),
      priceUsd: decision.price,
      notionalUsd,
      feeUsd,
      reason: decision.reason,
      status: 'paper_filled',
    });
    logEvent(db, userId, 'paper_fill', `PAPER ${decision.signal.toUpperCase()} $${notionalUsd.toFixed(2)} at $${decision.price}`, botId ?? null);
    return { decision, trade: { id, status: 'paper_filled', signature: null }, blocked: null };
  }

  // Devnet: the server never builds or signs a transaction. It stores the draft
  // the user's own wallet will approve, so the approval can be checked once.
  const draftId = crypto.randomUUID();
  const approvalMessage = `Ghost Bot devnet approval\n${decision.signal.toUpperCase()} ${(notionalUsd / decision.price).toFixed(8)} ${market}\nat $${decision.price}\nreason: ${decision.reason}\ndraft: ${draftId}`;
  db.prepare(
    `INSERT INTO trades (id, user_id, bot_id, mode, market, side, qty, price_usd, notional_usd, fee_usd, reason, status, signature, draft_tx, draft_at)
     VALUES (?, ?, ?, 'devnet', ?, ?, ?, ?, ?, ?, ?, 'awaiting_wallet_signature', NULL, ?, ?)`,
  ).run(
    draftId,
    userId,
    botId ?? null,
    market,
    decision.signal,
    Number((notionalUsd / decision.price).toFixed(8)),
    decision.price,
    notionalUsd,
    paperFee(notionalUsd),
    decision.reason,
    approvalMessage,
    new Date().toISOString(),
  );
  logEvent(db, userId, 'draft', `Devnet draft for your wallet to approve: ${decision.signal.toUpperCase()} $${notionalUsd.toFixed(2)}`, botId ?? null);
  return {
    decision,
    trade: { id: draftId, draftId, status: 'awaiting_wallet_signature', signature: null, draftTx: approvalMessage },
    blocked: null,
  };
}

/**
 * @param {Db} db
 * @param {string} userId
 * @param {number} limit
 */
export function recentEvents(db, userId, limit = 60) {
  const rows = db
    .prepare('SELECT id, kind, message, created_at FROM bot_events WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(userId, limit);
  return rows.map((r) => ({ id: String(r.id), kind: String(r.kind), message: String(r.message), at: String(r.created_at) }));
}

/**
 * @param {Db} db
 * @param {string} userId
 * @param {number} limit
 */
export function recentTrades(db, userId, limit = 40) {
  const rows = db
    .prepare(
      'SELECT id, mode, market, side, qty, price_usd, notional_usd, fee_usd, reason, status, signature, created_at FROM trades WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    )
    .all(userId, limit);
  return rows.map((r) => ({
    id: String(r.id),
    mode: String(r.mode),
    market: String(r.market),
    side: String(r.side),
    qty: Number(r.qty),
    priceUsd: Number(r.price_usd),
    notionalUsd: Number(r.notional_usd),
    feeUsd: Number(r.fee_usd),
    reason: String(r.reason),
    status: String(r.status),
    signature: r.signature ? String(r.signature) : null,
    at: String(r.created_at),
  }));
}
