// test/bot.test.js - risk caps, STOP, and "paper never builds a transaction".
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signedInUser, authedPost, authedGet } from './helpers.js';
import { tick, recordTrade } from '../server/bot.js';

/** @param {import('better-sqlite3').Database} db @param {string} userId @param {number} notional */
const tickWith = (db, userId, notional) =>
  tick(db, { userId, market: 'SOL/USD', strategy: 'sma_crossover', params: { fast: 2, slow: 3 }, mode: 'paper', seed: 1, maxTradeUsd: notional });

test('per-trade cap stops a trade that is too big', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const row = srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(user.wallet);
  const userId = String(row.id);
  srv.db.prepare('UPDATE users SET max_trade_usd = 0.5 WHERE id = ?').run(userId);

  const result = tickWith(srv.db, userId, 1);
  assert.ok(result.blocked, 'the trade is blocked');
  assert.equal(result.blocked.blockedBy, 'per_trade_cap');
  assert.equal(result.trade, null, 'nothing is recorded as a trade');
});

test('daily loss cap halts trading for the day', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = String(srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(user.wallet).id);
  srv.db.prepare('UPDATE users SET max_daily_loss_usd = 2, max_trade_usd = 25 WHERE id = ?').run(userId);
  const today = new Date().toISOString().slice(0, 10);
  srv.db
    .prepare("INSERT INTO bots (id, user_id, market, strategy, params, running, losses_usd, loss_day) VALUES ('b1', ?, 'SOL/USD', 'sma_crossover', '{}', 1, 2, ?)")
    .run(userId, today);

  const result = tickWith(srv.db, userId, 1);
  assert.ok(result.blocked);
  assert.equal(result.blocked.blockedBy, 'daily_loss_cap');
});

test('STOP halts the bot at once', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const stop = await authedPost(srv.base, user.token, '/api/bot/stop');
  assert.equal(stop.status, 200);
  assert.equal((await stop.json()).bot.stopReason, 'STOP');

  const tickRes = await authedPost(srv.base, user.token, '/api/bot/tick', {
    mode: 'paper',
    market: 'SOL/USD',
    params: { fast: 2, slow: 3 },
  });
  assert.equal(tickRes.status, 200);
  const body = await tickRes.json();
  if (body.trade === null) {
    // Either no crossover happened, or it was blocked. It must never fill after STOP.
    assert.ok(body.blocked === null || body.blocked.blockedBy === 'stop');
  } else {
    assert.fail('a trade filled after STOP was pressed');
  }
});

test('paper mode never builds a transaction and never signs', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = String(srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(user.wallet).id);

  // Force many seeds so at least one tick produces a paper fill.
  let fills = 0;
  for (let seed = 0; seed < 40; seed += 1) {
    const res = tick(srv.db, { userId, market: 'SOL/USD', strategy: 'sma_crossover', params: { fast: 2, slow: 3 }, mode: 'paper', seed, maxTradeUsd: 1 });
    if (res.trade) fills += 1;
  }
  assert.ok(fills > 0, 'at least one paper fill happened across the seeds');

  const rows = srv.db.prepare('SELECT mode, status, signature FROM trades').all();
  for (const row of rows) {
    assert.equal(String(row.mode), 'paper');
    assert.equal(row.signature, null, 'a paper trade never carries a signature');
    assert.match(String(row.status), /^paper_/);
  }
  // The server module exposes no transaction builder at all.
  const botSource = await import('node:fs').then((fs) => fs.readFileSync('server/bot.js', 'utf8'));
  for (const banned of ['VersionedTransaction', 'TransactionInstruction', 'sendRawTransaction', 'sendTransaction', 'Keypair']) {
    assert.ok(!botSource.includes(banned), `server/bot.js must not reference ${banned}`);
  }
});

test('recordTrade ignores a stray signature in paper mode', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = String(srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(user.wallet).id);
  recordTrade(srv.db, {
    userId,
    mode: 'paper',
    market: 'SOL/USD',
    side: 'buy',
    qty: 1,
    priceUsd: 150,
    notionalUsd: 150,
    feeUsd: 0.15,
    reason: 'test',
    status: 'paper_filled',
    signature: 'should-be-ignored',
  });
  const row = srv.db.prepare("SELECT signature FROM trades WHERE reason = 'test'").get();
  assert.equal(row.signature, null);
});

test('limits can be lowered but never removed', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const res = await authedPost(srv.base, user.token, '/api/limits', { maxTradeUsd: 100000, maxDailyLossUsd: 100000 });
  const body = await res.json();
  assert.ok(body.maxTradeUsd <= 25, 'per-trade cap is clamped to the hard ceiling');
  assert.ok(body.maxDailyLossUsd <= 50, 'daily loss cap is clamped to the hard ceiling');
  const lowered = await (await authedPost(srv.base, user.token, '/api/limits', { maxTradeUsd: 2, maxDailyLossUsd: 3 })).json();
  assert.equal(lowered.maxTradeUsd, 2);
  const zero = await (await authedPost(srv.base, user.token, '/api/limits', { maxTradeUsd: 0, maxDailyLossUsd: -5 })).json();
  assert.ok(zero.maxTradeUsd > 0 && zero.maxDailyLossUsd > 0, 'a zero or negative limit falls back to the small default');
});

test('key material in a request body is refused before anything happens', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const res = await authedPost(srv.base, user.token, '/api/bot/tick', { mode: 'paper', secretKey: [1, 2, 3] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'key_material_refused');

  const nested = await fetch(`${srv.base}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: user.wallet, walletInfo: { seedPhrase: 'alpha beta gamma' } }),
  });
  assert.equal(nested.status, 400);
  const keys = await authedGet(srv.base, user.token, '/api/keys');
  assert.equal(keys.status, 200);
});
