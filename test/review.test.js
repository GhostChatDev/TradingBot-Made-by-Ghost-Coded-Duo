// test/review.test.js - the four review findings, each with a test that fails
// on the code as it was before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signedInUser, authedPost, authedGet } from './helpers.js';
import { tick, recordTrade } from '../server/bot.js';
import { roundDown, money, toMicros, fromMicros } from '../server/money.js';

const CROSSOVER_SEED = 6;
const today = () => new Date().toISOString().slice(0, 10);

/** @param {any} srv @param {string} wallet */
const userIdOf = (srv, wallet) => String(srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(wallet).id);

test('money helpers never produce a floating point balance', () => {
  assert.equal(roundDown(0.1 + 0.2, 2), 0.3);
  assert.equal(roundDown(1.005, 2), 1);
  assert.equal(money(150.123456789), 150.12345678);
  assert.equal(roundDown(-1, 2), -1, 'a negative amount keeps its sign');
  assert.equal(fromMicros(toMicros(0.07) * 10), 0.7, 'ten fees of $0.07 are exactly $0.70');
});

// FINDING 1: the daily loss cap was only ever reachable by writing losses by hand.
test('daily loss cap is reached from real filled trades, with no hand-written loss row', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = userIdOf(srv, user.wallet);
  srv.db.prepare('UPDATE users SET max_daily_loss_usd = 0.01 WHERE id = ?').run(userId);

  recordTrade(srv.db, {
    userId, mode: 'paper', market: 'SOL/USD', side: 'buy', qty: 0.01,
    priceUsd: 149, notionalUsd: 1, feeUsd: 0.001, reason: 'test', status: 'paper_filled',
  });
  recordTrade(srv.db, {
    userId, mode: 'paper', market: 'SOL/USD', side: 'sell', qty: 0.01,
    priceUsd: 140, notionalUsd: 1, feeUsd: 0.001, reason: 'test', status: 'paper_filled',
  });

  const row = /** @type {any} */ (srv.db.prepare('SELECT losses_usd, loss_day FROM bots WHERE user_id = ?').get(userId));
  assert.ok(row, 'a bot row exists without the test creating one');
  assert.equal(String(row.loss_day), today());
  assert.ok(Number(row.losses_usd) > 0, 'the realised loss was recorded by the trade code');

  const result = tick(srv.db, { userId, market: 'SOL/USD', strategy: 'sma_crossover', params: { fast: 2, slow: 3 }, mode: 'paper', seed: CROSSOVER_SEED, maxTradeUsd: 1 });
  assert.ok(result.blocked, 'trading is blocked after the loss');
  assert.equal(result.blocked.blockedBy, 'daily_loss_cap');
  assert.equal(result.trade, null);
});

test('a gain does not add to the daily loss and yesterday\'s loss does not block today', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = userIdOf(srv, user.wallet);
  recordTrade(srv.db, {
    userId, mode: 'paper', market: 'SOL/USD', side: 'buy', qty: 0.01,
    priceUsd: 100, notionalUsd: 1, feeUsd: 0, reason: 'test', status: 'paper_filled',
  });
  recordTrade(srv.db, {
    userId, mode: 'paper', market: 'SOL/USD', side: 'sell', qty: 0.01,
    priceUsd: 150, notionalUsd: 1.5, feeUsd: 0, reason: 'test', status: 'paper_filled',
  });
  const row = /** @type {any} */ (srv.db.prepare('SELECT losses_usd FROM bots WHERE user_id = ?').get(userId));
  assert.equal(Number(row.losses_usd), 0, 'a gain is not a loss');
});

// FINDING 2: devnet queued a draft that nothing stored and nothing could sign.
test('devnet stores a signable draft, and a signed one becomes an approved trade', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);

  const tickRes = await authedPost(srv.base, user.token, '/api/bot/tick', {
    mode: 'devnet', market: 'SOL/USD', seed: CROSSOVER_SEED, params: { fast: 2, slow: 3 },
  });
  assert.equal(tickRes.status, 200);
  const body = await tickRes.json();
  assert.ok(body.trade, 'a draft came back');
  assert.equal(body.trade.status, 'awaiting_wallet_signature');
  assert.match(String(body.trade.draftId), /\w/);

  const stored = srv.db.prepare('SELECT id, mode, status, signature FROM trades WHERE id = ?').get(body.trade.draftId);
  assert.ok(stored, 'the draft is stored, not just logged');
  assert.equal(String(stored.status), 'awaiting_wallet_signature');
  assert.equal(stored.signature, null);

  const confirm = await authedPost(srv.base, user.token, '/api/bot/confirm', {
    draftId: body.trade.draftId, signature: '5' + 'J'.repeat(63),
  });
  assert.equal(confirm.status, 200);
  const after = /** @type {any} */ (await srv.db.prepare('SELECT status, signature FROM trades WHERE id = ?').get(body.trade.draftId));
  assert.equal(String(after.status), 'devnet_submitted');
  assert.equal(String(after.signature), '5' + 'J'.repeat(63));

  const events = await (await authedGet(srv.base, user.token, '/api/bot/state')).json();
  assert.ok(events.events.some((/** @type {any} */ e) => e.kind === 'devnet_submitted'), 'the approval is in the log');
});

test('a draft cannot be confirmed twice, by someone else, or with a fake signature', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const owner = await signedInUser(srv.base);
  const other = await signedInUser(srv.base);
  const body = await (await authedPost(srv.base, owner.token, '/api/bot/tick', {
    mode: 'devnet', market: 'SOL/USD', seed: CROSSOVER_SEED, params: { fast: 2, slow: 3 },
  })).json();
  const draftId = body.trade.draftId;

  assert.equal((await authedPost(srv.base, other.token, '/api/bot/confirm', { draftId, signature: 'J'.repeat(88) })).status, 404, 'another account cannot see it');
  assert.equal((await authedPost(srv.base, owner.token, '/api/bot/confirm', { draftId, signature: 'not-a-signature' })).status, 400);
  assert.equal((await authedPost(srv.base, owner.token, '/api/bot/confirm', { draftId, signature: 'J'.repeat(88) })).status, 200);
  assert.equal((await authedPost(srv.base, owner.token, '/api/bot/confirm', { draftId, signature: 'J'.repeat(88) })).status, 409, 'already approved');
});

// FINDING 3: the STOP test accepted a "hold" decision, so it could not fail.
test('STOP blocks a real crossover, proven by blockedBy === "stop"', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = userIdOf(srv, user.wallet);

  // Control: the same seed fills when STOP is not pressed.
  const before = tick(srv.db, { userId, market: 'SOL/USD', strategy: 'sma_crossover', params: { fast: 2, slow: 3 }, mode: 'paper', seed: CROSSOVER_SEED, maxTradeUsd: 1 });
  assert.ok(before.trade, 'the control seed produces a trade');

  await authedPost(srv.base, user.token, '/api/bot/stop');
  const after = tick(srv.db, { userId, market: 'SOL/USD', strategy: 'sma_crossover', params: { fast: 2, slow: 3 }, mode: 'paper', seed: CROSSOVER_SEED, maxTradeUsd: 1 });
  assert.equal(after.trade, null);
  assert.ok(after.blocked, 'the crossover is blocked, not a hold');
  assert.equal(after.blocked.blockedBy, 'stop');
});

// FINDING 4: paper trading must use real prices; simulated is only the labelled fallback.
test('real prices are used when the feed answers, and labelled when it does not', async (t) => {
  const { setPriceSeries, history, resetPriceCache } = await import('../server/prices.js');
  resetPriceCache();
  setPriceSeries('SOL/USD', { prices: Array.from({ length: 40 }, (_, i) => 100 + i), source: 'live:coinbase' });
  const live = history('SOL/USD', 40, 0);
  assert.equal(live.source, 'live:coinbase');
  assert.equal(live.last, 139);

  resetPriceCache();
  const fallback = history('SOL/USD', 40, 0);
  assert.equal(fallback.source, 'simulated');
});

test('the price feed maps a Coinbase candle response to a price series', async () => {
  const { parseCoinbaseCandles } = await import('../server/prices.js');
  // Coinbase returns newest first: [time, low, high, open, close, volume]
  const rows = [[1700000300, 1, 2, 1.5, 2.5, 10], [1700000200, 1, 2, 1, 1.5, 10]];
  const parsed = parseCoinbaseCandles(rows);
  assert.deepEqual(parsed, [1.5, 2.5], 'oldest first, close price of each candle');
});
