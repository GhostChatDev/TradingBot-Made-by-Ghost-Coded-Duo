// test/mainnet-guard.test.js - the hard mainnet guard, and the pump.fun rules.
//
// These tests FAIL if the guard is removed: each one asserts that the refusal
// happens, that it is logged, and that the build/sign call site still calls it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAINNET_LIVE_FLAG,
  assertMayTouchMainnet,
  mainnetLiveEnabled,
  mainnetTransaction,
  resolveMode,
} from '../server/mainnet-guard.js';
import { loadConfig } from '../server/config.js';
import {
  TAKE_PROFIT_CENTS,
  STOP_LOSS_PCT,
  GOAL_CENTS,
  decideExit,
  afterClose,
  nextToken,
  paperPosition,
  DEFAULT_WATCHLIST,
} from '../server/pumpfun.js';

/** Collect guard log lines instead of writing to stderr. */
function recorder() {
  /** @type {string[]} */
  const lines = [];
  return { lines, log: (/** @type {string} */ line) => lines.push(line) };
}

test('the flag is off unless it is exactly the string true', () => {
  assert.equal(mainnetLiveEnabled({}), false);
  assert.equal(mainnetLiveEnabled({ [MAINNET_FLAG]: 'false' }), false);
  assert.equal(mainnetLiveEnabled({ [MAINNET_FLAG]: '1' }), false);
  assert.equal(mainnetLiveEnabled({ [MAINNET_FLAG]: 'yes' }), false);
  assert.equal(mainnetLiveEnabled({ [MAINNET_FLAG]: 'true' }), true);
});

test('there is exactly one switch: no other env name unlocks mainnet', () => {
  assert.equal(MAINNET_FLAG, 'MAINNET_ENABLED');
  for (const alias of ['MAINNET_LIVE', 'MAINNET', 'LIVE']) {
    assert.equal(
      mainnetLiveEnabled({ [alias]: 'true' }),
      false,
      `${alias} must not unlock mainnet; MAINNET_ENABLED is the only flag`,
    );
    assert.equal(resolveMode('mainnet', { [alias]: 'true' }), 'paper');
  }
  const guard = readFileSync(new URL('../server/mainnet-guard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guard, /ALIAS/, 'no alias export is kept in the guard');
});

test('with the flag unset, building a mainnet transaction throws and logs why', () => {
  const log = recorder();
  assert.throws(
    () => mainnetTransaction({ mode: 'mainnet', action: 'build', transaction: 'draft' }, {}, log),
    /Refused: live mainnet trading is off/,
  );
  assert.equal(log.lines.length, 1, 'the refusal is logged exactly once');
  assert.match(log.lines[0], /build: BLOCKED/);
  assert.match(log.lines[0], /MAINNET_LIVE/);
});

test('with the flag unset, signing a mainnet transaction throws and logs why', () => {
  const log = recorder();
  assert.throws(
    () => assertMayTouchMainnet('sign', {}, log),
    /Refused: live mainnet trading is off/,
  );
  assert.match(log.lines[0], /sign: BLOCKED/);
});

test('with the flag set, the guard allows the build and the sign', () => {
  const log = recorder();
  const env = { [MAINNET_LIVE_FLAG]: 'true' };
  assert.doesNotThrow(() => assertMayTouchMainnet('build', env, log));
  assert.doesNotThrow(() => assertMayTouchMainnet('sign', env, log));
  assert.match(log.lines[0], /allowed/);
});

test('requesting mainnet without the flag resolves to paper and says so', () => {
  const log = recorder();
  assert.equal(resolveMode('mainnet', {}, log), 'paper');
  assert.match(log.lines[0], /refused and this server runs paper/);
  assert.equal(resolveMode('mainnet', { [MAINNET_LIVE_FLAG]: 'true' }), 'mainnet');
  assert.equal(resolveMode('devnet', {}), 'devnet');
  assert.equal(resolveMode('paper', {}), 'paper');
});

test('loadConfig refuses a mainnet TRADING_MODE while the flag is unset', () => {
  const cfg = loadConfig({ TRADING_MODE: 'mainnet' });
  assert.equal(cfg.mode, 'paper', 'no mainnet without MAINNET_LIVE');
  assert.equal(cfg.mainnetEnabled, false);
  const live = loadConfig({ TRADING_MODE: 'mainnet', [MAINNET_LIVE_FLAG]: 'true' });
  assert.equal(live.mode, 'mainnet');
  assert.equal(live.mainnetEnabled, true);
});

test('the guard is called on the mainnet build path in bot.js (fails if removed)', () => {
  const src = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/mainnet-guard\.js'/, 'bot.js must import the guard');
  assert.match(src, /mainnetTransaction\(\{ mode: 'mainnet'/, 'the mainnet build must go through mainnetTransaction');
  assert.match(src, /mode === 'mainnet'/, 'the call must be conditional on mainnet mode');
});

test('no file builds a mainnet transaction without the guard', () => {
  const files = ['server/bot.js', 'server/index.js', 'server/config.js'];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const risky = /version:\s*'0'|sendTransaction|sendAndConfirmTransaction|partialSign/.exec(src);
    assert.equal(risky, null, `${f} must not contain a transaction builder (${risky && risky[0]})`);
  }
});

// ---- the pump.fun rules -----------------------------------------------------

test('take profit fires at 10.00 USD of profit, not below', () => {
  // Entry 2000 cents (20.00 USD). A 50% rise is 10.00 USD profit.
  const pos = paperPosition('mint-a', 2000, 1_000_000);
  const atNineNinetyNine = decideExit(pos, 1_499_500); // +9.99 USD
  assert.equal(atNineNinetyNine.action, 'hold');
  assert.equal(atNineNinetyNine.pnlCents, 999);
  const atTen = decideExit(pos, 1_500_000); // +10.00 USD exactly
  assert.equal(atTen.action, 'take_profit');
  assert.equal(atTen.pnlCents, 1000);
  assert.match(atTen.reason, /take profit hit/);
});

test('stop loss fires at 20% down', () => {
  const pos = paperPosition('mint-a', 5000, 2_000_000);
  assert.equal(decideExit(pos, 1_610_000).action, 'hold'); // -19.5%
  const hit = decideExit(pos, 1_600_000); // -20% exactly
  assert.equal(hit.action, 'stop_loss');
  assert.equal(hit.pnlCents, -1000);
  assert.match(hit.reason, /stop loss hit: -20\.0%/);
});

test('a win compounds into the next position, a loss shrinks it', () => {
  const win = afterClose({ sizeCents: 2000, realisedCents: 2000, pnlCents: 1000 });
  assert.equal(win.realisedCents, 3000);
  assert.equal(win.nextSizeCents, 3000, 'the whole position plus its profit is reused');
  assert.equal(win.goalReached, false);
  const loss = afterClose({ sizeCents: 3000, realisedCents: 3000, pnlCents: -600 });
  assert.equal(loss.nextSizeCents, 2400);
  assert.ok(loss.nextSizeCents >= 0);
});

test('the first stop loss shrinks the run instead of ending it', () => {
  // The run starts with a 5.00 USD stake: a -20% stop on a 5.00 position loses 1.00.
  const firstLoss = afterClose({
    sizeCents: START_BANKROLL_CENTS,
    realisedCents: 0,
    pnlCents: -100,
  });
  assert.equal(firstLoss.realisedCents, -100);
  assert.equal(firstLoss.bankrollCents, 400, 'the stake survives the loss: 500 - 100');
  assert.equal(firstLoss.nextSizeCents, 400, 'the run continues with the 4.00 left');
  assert.equal(firstLoss.goalReached, false);
  assert.match(firstLoss.note, /compounding/);

  // Three losses in a row still leave a runnable position (500 -> 400 -> 320 -> 256).
  let state = { realisedCents: 0, sizeCents: START_BANKROLL_CENTS };
  for (const expected of [400, 320, 256]) {
    const pnlCents = -Math.round(state.sizeCents * STOP_LOSS_PCT / 100);
    const step = afterClose({ sizeCents: state.sizeCents, realisedCents: state.realisedCents, pnlCents });
    assert.equal(step.nextSizeCents, expected);
    state = { realisedCents: step.realisedCents, sizeCents: step.nextSizeCents };
  }

  // Only when the bankroll falls under the smallest position does the run stop.
  const broke = afterClose({ sizeCents: 120, realisedCents: -460, pnlCents: -20 });
  assert.equal(broke.bankrollCents, 20);
  assert.equal(broke.nextSizeCents, 0);
  assert.match(broke.note, /the run stops/);
});

test('a full watchlist rotates instead of stopping after three tokens', () => {
  const mints = DEFAULT_WATCHLIST.map((t) => t.mint);
  const allDone = new Set(mints);
  const again = nextToken(DEFAULT_WATCHLIST, mints[1], allDone);
  assert.ok(again, 'a three-token watchlist keeps rotating');
  assert.notEqual(again.mint, mints[1], 'never re-enters the token just closed');
  assert.ok(mints.includes(again.mint));
  const solo = nextToken([DEFAULT_WATCHLIST[0]], DEFAULT_WATCHLIST[0].mint, new Set());
  assert.equal(solo, null, 'a one-token watchlist has nowhere to rotate to');
});

test('the run stops at the 5000 USD goal', () => {
  const end = afterClose({ sizeCents: 450000, realisedCents: 450000, pnlCents: 1000 });
  assert.equal(end.realisedCents, 451000);
  assert.equal(end.goalReached, false);
  const reached = afterClose({ sizeCents: 499500, realisedCents: 499500, pnlCents: 1000 });
  assert.equal(reached.goalReached, true);
  assert.equal(reached.nextSizeCents, 0);
  assert.match(reached.note, /goal reached/);
  assert.equal(GOAL_CENTS, 500000);
  assert.equal(TAKE_PROFIT_CENTS, 1000);
  assert.equal(STOP_LOSS_PCT, 20);
});

test('after a take profit the bot rotates to the next token', () => {
  const first = DEFAULT_WATCHLIST[0];
  const next = nextToken(DEFAULT_WATCHLIST, first.mint, new Set([first.mint]));
  assert.ok(next);
  assert.notEqual(next.mint, first.mint);
  const exhausted = nextToken([first], first.mint, new Set());
  assert.equal(exhausted, null, 'no token left means stop, not re-enter the same one');
});
