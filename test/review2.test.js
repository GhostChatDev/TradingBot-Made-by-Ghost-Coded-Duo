// test/review2.test.js - the second review's findings that were real, each with a
// test that fails on the code as it was before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signedInUser, one } from './helpers.js';
import { tick } from '../server/bot.js';
import { loadConfig, readPepper } from '../server/config.js';

const CROSSOVER_SEED = 6;

/** @param {any} srv @param {string} wallet */
const userIdOf = (srv, wallet) => String(srv.db.prepare('SELECT id FROM users WHERE wallet = ?').get(wallet).id);

// FINDING 1: a mainnet tick used to fall into the devnet branch and store a trade
// labelled 'devnet'. With the flag on it must be labelled mainnet, never devnet.
test('a mainnet tick stores a mainnet draft, not a devnet one', async (t) => {
  const srv = await startTestServer({ MAINNET_ENABLED: 'true' });
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = userIdOf(srv, user.wallet);

  const result = tick(
    srv.db,
    {
      userId,
      market: 'SOL/USD',
      strategy: 'sma_crossover',
      params: { fast: 2, slow: 3 },
      mode: 'mainnet',
      seed: CROSSOVER_SEED,
    },
    { MAINNET_ENABLED: 'true' },
  );

  assert.ok(result.trade, 'a crossover with the flag on proposes a mainnet trade');
  assert.equal(result.trade.status, 'awaiting_wallet_signature');
  assert.match(String(result.trade.draftTx), /^Ghost Bot mainnet approval/, 'the draft says mainnet');
  assert.doesNotMatch(String(result.trade.draftTx), /devnet/, 'the draft never claims to be devnet');

  const row = one(srv.db.prepare('SELECT mode, draft_tx FROM trades WHERE user_id = ?').get(userId));
  assert.equal(String(row.mode), 'mainnet', 'the stored trade is labelled mainnet');
  assert.match(String(row.draft_tx), /^Ghost Bot mainnet approval/);

  const event = one(
    srv.db.prepare("SELECT message FROM bot_events WHERE user_id = ? AND kind = 'draft'").get(userId),
  );
  assert.match(String(event.message), /^Mainnet draft/, 'the log line says mainnet');
});

// FINDING 1 (other half): with the flag unset the same tick throws before any work.
test('a mainnet tick with the flag unset throws and writes nothing', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const userId = userIdOf(srv, user.wallet);

  assert.throws(() =>
    tick(
      srv.db,
      {
        userId,
        market: 'SOL/USD',
        strategy: 'sma_crossover',
        params: { fast: 2, slow: 3 },
        mode: 'mainnet',
        seed: CROSSOVER_SEED,
      },
      {},
    ),
  );
  const rows = one(srv.db.prepare('SELECT COUNT(*) AS n FROM trades WHERE user_id = ?').get(userId));
  assert.equal(Number(rows.n), 0, 'no trade row is written');
});

// FINDING 2: the pepper used to fall back to a string that is published in this
// repository, so a guessed key could be tested against a stolen database.
test('a real server refuses to start without API_KEY_PEPPER', () => {
  assert.throws(
    () => loadConfig({ TRADING_MODE: 'paper' }),
    /API_KEY_PEPPER is missing or shorter than 16 characters/,
  );
  assert.throws(
    () => loadConfig({ TRADING_MODE: 'paper', API_KEY_PEPPER: 'short' }),
    /API_KEY_PEPPER/,
    'a too-short pepper is refused too',
  );
  const published = readPepper({}, true);
  assert.notEqual(published, 'dev-only-pepper-change-me', 'the old published pepper is gone from the code paths');
});

test('a configured pepper is used as given, and tests still run without one', () => {
  const pepper = 'a'.repeat(32);
  assert.equal(loadConfig({ NODE_ENV: 'test', API_KEY_PEPPER: pepper }).keyPepper, pepper);
  assert.ok(loadConfig({ NODE_ENV: 'test' }).keyPepper.length >= 8, 'a test gets a working pepper');
});
