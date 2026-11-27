// server/index.js - Express app: screens, wallet sign-in, bot routes, paid API.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import nacl from 'tweetnacl';
import { loadConfig, clampLimit, DISCLAIMER, HARD_MAX_TRADE_USD, HARD_MAX_DAILY_LOSS_USD } from './config.js';
import {openDb, rowToUser, Db} from './db.js';
import { createKey, listKeys, revokeKey, authenticate, checkRateLimit } from './keys.js';
import { getBalance, ledger, spend, grantTestCredits, ensureAccount } from './credits.js';
import { evaluate, tick, checkRisk, recentEvents, recentTrades, logEvent } from './bot.js';

import { markets, history } from './prices.js';
import { findKeyMaterial, redact, CUSTODY_STATEMENT } from './custody.js';
import { mark as markPump, summary as pumpSummary } from './pump-run.js';
import { getDelivery, setDelivery, sweepDrafts } from './delivery.js';
import { base58Decode } from './base58.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

/**
 * Build the app. Tests import this with their own in-memory database.
 * @param {ReturnType<typeof loadConfig>} [config]
 * @param {Db} [existingDb]
 */
export function createApp(config = loadConfig(), existingDb = undefined) {
  const db = existingDb ?? openDb(config.databasePath);
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  // Nonces are short-lived, in-memory, one use each. No secret leaves the server.
  /** @type {Map<string, {nonce: string, expires: number}>} */
  const nonces = new Map();
  /** @type {Map<string, string>} wallet -> session token */
  const sessions = new Map();
  /** @type {Map<string, string>} session token -> wallet */
  const sessionOwners = new Map();

  const now = () => Date.now();

  /** @param {import('express').Request} req */
  const sessionUser = (req) => {
    const header = String(req.get('authorization') || '');
    if (!header.startsWith('Bearer ')) return null;
    const wallet = sessionOwners.get(header.slice(7));
    if (!wallet) return null;
    const row = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    return row ? rowToUser(row) : null;
  };

  const refuseKeyMaterial = (/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res, /** @type {import('express').NextFunction} */ next) => {
    const hit = findKeyMaterial(req.body);
    if (hit) {
      res.status(400).json({
        error: 'key_material_refused',
        message: `This app never accepts "${hit}". Sign with your own wallet instead.`,
      });
      return;
    }
    next();
  };

  app.get('/api/meta', (_req, res) => {
    res.json({
      mode: config.mode,
      mainnetEnabled: config.mainnetEnabled,
      payments: config.payments,
      creditsPerSignal: config.creditsPerSignal,
      markets: markets(),
      disclaimer: DISCLAIMER,
      custody: CUSTODY_STATEMENT,
      hardMaxTradeUsd: HARD_MAX_TRADE_USD,
      hardMaxDailyLossUsd: HARD_MAX_DAILY_LOSS_USD,
    });
  });

  // ---- wallet sign-in: the server only verifies a signature -----------------
  app.post('/api/auth/nonce', refuseKeyMaterial, (req, res) => {
    const wallet = String(req.body?.wallet || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      res.status(400).json({ error: 'bad_wallet', message: 'That does not look like a Solana address.' });
      return;
    }
    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(wallet, { nonce, expires: now() + 5 * 60_000 });
    res.json({ nonce, message: `Sign in to Solana Bot Demo\nwallet: ${wallet}\nnonce: ${nonce}` });
  });

  app.post('/api/auth/verify', refuseKeyMaterial, (req, res) => {
    const wallet = String(req.body?.wallet || '');
    const signature = String(req.body?.signature || '');
    const entry = nonces.get(wallet);
    nonces.delete(wallet); // one use only
    if (!entry || entry.expires < now()) {
      res.status(400).json({ error: 'nonce_expired', message: 'Please sign in again.' });
      return;
    }
    let ok = false;
    try {
      const msg = new TextEncoder().encode(`Sign in to Solana Bot Demo\nwallet: ${wallet}\nnonce: ${entry.nonce}`);
      // The wallet string is base58; the ed25519 public key is its 32 raw bytes.
      ok = nacl.sign.detached.verify(msg, Buffer.from(signature, 'base64'), base58Decode(wallet));
    } catch {
      ok = false;
    }
    if (!ok) {
      res.status(401).json({ error: 'bad_signature', message: 'Signature did not verify.' });
      return;
    }
    db.prepare('INSERT OR IGNORE INTO users (id, wallet) VALUES (?, ?)').run(crypto.randomUUID(), wallet);
    const user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
    if (!user) {
      res.status(500).json({ error: 'server_error', message: 'Could not create the account.' });
      return;
    }
    ensureAccount(db, String(user.id));
    const token = crypto.randomBytes(24).toString('base64url');
    sessions.set(token, wallet);
    sessionOwners.set(token, wallet);
    res.json({ token, wallet, user: rowToUser(user) });
  });

  // ---- bot ------------------------------------------------------------------
  app.post('/api/limits', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const maxTradeUsd = clampLimit(req.body?.maxTradeUsd, 5, HARD_MAX_TRADE_USD);
    const maxDailyLossUsd = clampLimit(req.body?.maxDailyLossUsd, 10, HARD_MAX_DAILY_LOSS_USD);
    // A saved limit is bounded by the hard cap even when it is written into the
    // database by something other than this route (an old row, a migration, a
    // bug): checkRisk then treats an unreadable cap as blocking, never as "no cap".
    db.prepare('UPDATE users SET max_trade_usd = ?, max_daily_loss_usd = ? WHERE id = ?').run(maxTradeUsd, maxDailyLossUsd, user.id);
    logEvent(db, user.id, 'limits', `Limits set to $${maxTradeUsd.toFixed(2)} per trade, $${maxDailyLossUsd.toFixed(2)} per day`);
    res.json({ ok: true, maxTradeUsd, maxDailyLossUsd });
  });

  app.post('/api/bot/tick', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const mode = String(req.body?.mode || 'paper');
    if (mode !== 'paper' && mode !== 'devnet') {
      res.status(400).json({ error: 'mode_not_allowed', message: 'Only paper and devnet are available in this build.' });
      return;
    }
    if (mode === 'devnet' && config.mode === 'paper' && !config.mainnetEnabled) {
      // devnet is free test SOL and always allowed; the switch only gates mainnet
    }
    const market = String(req.body?.market || 'SOL/USD');
    const strategy = String(req.body?.strategy || 'sma_crossover');
    const params = {
      fast: Math.min(Math.max(Number(req.body?.params?.fast) || 5, 2), 50),
      slow: Math.min(Math.max(Number(req.body?.params?.slow) || 20, 3), 200),
    };
    if (params.slow <= params.fast) {
      res.status(400).json({ error: 'bad_params', message: 'The slow average must be larger than the fast average.' });
      return;
    }
    const seed = Number(req.body?.seed) || Math.floor(now() / 60_000) % 1000;
    const result = tick(db, { userId: user.id, market, strategy, params, mode, seed, maxTradeUsd: 1 });
    res.json({
      ...result,
      disclaimer: DISCLAIMER,
      bot: botState(db, user.id),
    });
  });

  app.post('/api/bot/confirm', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const draftId = String(req.body?.draftId || '');
    const signature = String(req.body?.signature || '');
    // The wallet returns a base58-encoded 64-byte signature (86-88 characters);
    // some wallets hand back the raw signature instead, so lengths from 43 up are taken.
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(signature)) {
      res.status(400).json({ error: 'bad_signature', message: 'That does not look like a wallet signature.' });
      return;
    }
    // Scoped to this account: another account's draft reads as missing, not as forbidden.
    const draft = db.prepare("SELECT id, status, mode, side, market FROM trades WHERE id = ? AND user_id = ? AND mode = 'devnet'").get(draftId, user.id);
    if (!draft) {
      res.status(404).json({ error: 'not_found', message: 'No such draft for this account.' });
      return;
    }
    if (String(draft.status) !== 'awaiting_wallet_signature') {
      res.status(409).json({ error: 'already_confirmed', message: 'That draft was already approved.' });
      return;
    }
    const changed = db.prepare(
      "UPDATE trades SET status = 'devnet_submitted', signature = ?, draft_at = ? WHERE id = ? AND user_id = ? AND status = 'awaiting_wallet_signature'",
    ).run(signature, new Date().toISOString(), draftId, user.id);
    if (!changed.changes) {
      res.status(409).json({ error: 'already_confirmed', message: 'That draft was already approved.' });
      return;
    }
    logEvent(db, user.id, 'devnet_submitted', `Devnet ${String(draft.side).toUpperCase()} approved in your wallet for ${String(draft.market)}`);
    res.json({ ok: true, draftId, status: 'devnet_submitted' });
  });

  // ---- pump.fun paper run (always paper: this route cannot build a transaction) ----
  app.get('/api/pump', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    res.json(pumpSummary(db, user.id));
  });

  app.post('/api/pump/step', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    if (String(req.body?.mode ?? 'paper') !== 'paper') {
      res.status(409).json({ error: 'paper_only', message: 'The pump.fun rule set runs in paper mode only in this build.' });
      return;
    }
    const step = Number.isFinite(Number(req.body?.step)) ? Number(req.body.step) : 0;
    // The per-trade cap comes from the same row every other trade is checked against.
    const result = markPump(db, {
      userId: user.id,
      step,
      maxSizeCents: Math.round(user.maxTradeUsd * 100),
      log: (kind, message) => logEvent(db, user.id, kind, message),
    });
    res.json({ ...result, simulated: true, summary: pumpSummary(db, user.id) });
  });

  app.get('/api/delivery', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    res.json({ delivery: getDelivery(db, user.id) });
  });

  app.post('/api/delivery', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const wanted = String(req.body?.delivery ?? '');
    if (wanted !== 'json' && wanted !== 'signer') {
      res.status(400).json({ error: 'bad_delivery', message: 'delivery must be "json" (draft only) or "signer" (ask a wallet to sign).' });
      return;
    }
    setDelivery(db, user.id, wanted);
    logEvent(db, user.id, 'delivery', `Devnet drafts handed over as: ${wanted === 'json' ? 'JSON for your own tooling' : 'a wallet signature request'}`);
    res.json({ ok: true, delivery: wanted });
  });

  app.get('/api/bot/state', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    res.json({
      bot: botState(db, user.id),
      events: recentEvents(db, user.id),
      trades: recentTrades(db, user.id),
      disclaimer: DISCLAIMER,
    });
  });

  app.post('/api/bot/stop', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    db.prepare("UPDATE bots SET running = 0, stop_reason = 'STOP', updated_at = datetime('now') WHERE user_id = ?").run(user.id);
    db.prepare(
      "INSERT INTO bots (id, user_id, market, strategy, params, running, stop_reason, losses_usd, loss_day) VALUES (?, ?, 'SOL/USD', 'sma_crossover', '{}', 0, 'STOP', 0, NULL) ON CONFLICT(id) DO NOTHING",
    ).run(`stop-${user.id}`, user.id);
    logEvent(db, user.id, 'stop', 'STOP pressed: the bot is halted and will not trade.');
    res.json({ ok: true, bot: botState(db, user.id) });
  });

  app.post('/api/bot/clear-stop', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    db.prepare("UPDATE bots SET stop_reason = NULL, updated_at = datetime('now') WHERE user_id = ? AND stop_reason = 'STOP'").run(user.id);
    logEvent(db, user.id, 'resume', 'STOP cleared. Trading inside your limits can continue.');
    res.json({ ok: true, bot: botState(db, user.id) });
  });

  // ---- API keys -------------------------------------------------------------
  app.get('/api/keys', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    res.json({ keys: listKeys(db, user.id) });
  });

  app.post('/api/keys', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const made = createKey(db, user.id, String(req.body?.label || 'API key'), config.keyPepper);
    res.status(201).json({ key: made.key, id: made.id, prefix: made.prefix, label: made.label, shownOnce: true });
  });

  app.delete('/api/keys/:id', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    const ok = revokeKey(db, user.id, req.params.id);
    res.json({ ok, keys: listKeys(db, user.id) });
  });

  // ---- credits --------------------------------------------------------------
  app.get('/api/credits', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    res.json({
      balance: getBalance(db, user.id),
      perCall: config.creditsPerSignal,
      payments: config.payments,
      entries: ledger(db, user.id),
    });
  });

  app.post('/api/credits/topup', refuseKeyMaterial, (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'sign_in', message: 'Sign in with your wallet first.' });
      return;
    }
    if (config.payments === 'off') {
      res.status(403).json({ error: 'payments_off', message: 'Payments are switched off.' });
      return;
    }
    const amount = Math.min(Math.max(Number(req.body?.amount) || 100, 1), 1000);
    const balance = grantTestCredits(db, user.id, Math.floor(amount), `test-${crypto.randomUUID()}`);
    res.json({ balance, testMode: true, message: 'TEST MODE: fake money, no payment was taken.' });
  });

  // ---- the paid public API -------------------------------------------------
  app.post('/api/v1/signal', refuseKeyMaterial, (req, res) => {
    const auth = authenticate(db, bearer(req), config.keyPepper);
    if (!auth) {
      res.status(401).json({ error: 'unauthorized', message: 'Send a valid key as "Authorization: Bearer <key>".' });
      return;
    }
    if (!checkRateLimit(db, auth.keyId, config.rateLimitPerMinute)) {
      res.status(429).json({ error: 'rate_limited', message: `Max ${config.rateLimitPerMinute} calls a minute per key.` });
      return;
    }
    const took = spend(db, auth.userId, config.creditsPerSignal, 'api_signal', auth.keyId);
    if (!took.ok) {
      db.prepare('INSERT INTO api_calls (id, user_id, key_id, endpoint, market, cost, status, created_at) VALUES (?, ?, ?, ?, ?, 0, 402, ?)').run(
        crypto.randomUUID(), auth.userId, auth.keyId, '/api/v1/signal', String(req.body?.market || ''), now(),
      );
      res.status(402).json({ error: 'no_credits', balance: took.balance, perCall: config.creditsPerSignal, message: 'No credits left. Top up in TEST mode to continue.' });
      return;
    }
    const market = String(req.body?.market || 'SOL/USD');
    if (!markets().includes(market)) {
      // Refund: the strategy never ran, so nothing was charged.
      grantTestCredits(db, auth.userId, config.creditsPerSignal, 'refund-unknown-market');
      res.status(400).json({ error: 'unknown_market', message: `Known markets: ${markets().join(', ')}` });
      return;
    }
    const params = {
      fast: Math.min(Math.max(Number(req.body?.fast) || 5, 2), 50),
      slow: Math.min(Math.max(Number(req.body?.slow) || 20, 3), 200),
    };
    if (params.slow <= params.fast) {
      grantTestCredits(db, auth.userId, config.creditsPerSignal, 'refund-bad-params');
      res.status(400).json({ error: 'bad_params', message: 'slow must be greater than fast' });
      return;
    }
    const decision = evaluate(db, { userId: auth.userId, market, strategy: 'sma_crossover', params, mode: 'paper', seed: Math.floor(now() / 60_000) % 1000 });
    db.prepare('INSERT INTO api_calls (id, user_id, key_id, endpoint, market, cost, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 200, ?)').run(
      crypto.randomUUID(), auth.userId, auth.keyId, '/api/v1/signal', market, config.creditsPerSignal, now(),
    );
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(auth.keyId);
    res.json({
      market,
      price: decision.price,
      priceSource: decision.priceSource,
      signal: decision.signal,
      reason: decision.reason,
      fast: decision.fast,
      slow: decision.slow,
      charged: config.creditsPerSignal,
      balance: took.balance,
      disclaimer: DISCLAIMER,
    });
  });

  app.get('/api/v1/usage', (req, res) => {
    const auth = authenticate(db, bearer(req), config.keyPepper);
    if (!auth) {
      res.status(401).json({ error: 'unauthorized', message: 'Send a valid key as "Authorization: Bearer <key>".' });
      return;
    }
    const row = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS spent FROM api_calls WHERE key_id = ? AND status = 200').get(auth.keyId);
    res.json({
      keyPrefix: auth.prefix,
      calls: Number(row?.n ?? 0),
      creditsSpent: Number(row?.spent ?? 0),
      balance: getBalance(db, auth.userId),
      perCall: config.creditsPerSignal,
      disclaimer: DISCLAIMER,
    });
  });

  app.use(express.static(PUBLIC_DIR));
  app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.use((/** @type {unknown} */ err, /** @type {import('express').Request} */ _req, /** @type {import('express').Response} */ res, /** @type {import('express').NextFunction} */ _next) => {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('request failed:', redact(message));
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was charged.' });
  });

  // A tiny middleware-free way to expose the db for tests.
  Object.defineProperty(app, 'locals_db', { value: db, enumerable: false });
  Object.defineProperty(app, 'locals_sweep', {
    value: (/** @type {number} */ hours = 24) => sweepDrafts(db, hours),
    enumerable: false,
  });
  return app;
}

/** @param {import('express').Request} req */
function bearer(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/**
 * @param {Db} db
 * @param {string} userId
 */
export function botState(db, userId) {
  const row = db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(userId);
  if (!row) return { running: false, stopReason: null, lossesUsd: 0 };
  return {
    running: Number(row.running) === 1,
    stopReason: row.stop_reason ? String(row.stop_reason) : null,
    lossesUsd: Number(row.losses_usd),
    market: String(row.market),
  };
}

export { checkRisk, history };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const config = loadConfig();
  const app = createApp(config);
  // Draft retention: sweep now, then once an hour while the server runs.
  const sweepHours = 24;
  const sweepTimer = setInterval(() => {
    try {
      const cleared = sweepDrafts(/** @type {any} */ (app).locals_db, sweepHours);
      if (cleared > 0) console.log(`draft sweep: cleared ${cleared} unsigned draft(s) older than ${sweepHours}h`);
    } catch (err) {
      console.error('draft sweep failed:', err instanceof Error ? err.message : err);
    }
  }, 3600_000);
  sweepTimer.unref();
  app.listen(config.port, () => {
    console.log(`Solana bot demo on http://localhost:${config.port}`);
    console.log(`mode=${config.mode} mainnetEnabled=${config.mainnetEnabled} payments=${config.payments}`);
  });
}
