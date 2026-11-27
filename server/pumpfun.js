// server/pumpfun.js - the rule set the person asked for, applied to pump.fun tokens.
//
// Rules (fixed, not editable upward by the user):
//   - Take profit: when a position is 10.00 USD or more in profit, close it and ROTATE
//     the whole realised amount into the next token on the watchlist.
//   - Stop loss: when a position is down 20% of what was put in, close it.
//   - Compounding: each closed win adds its profit to the size of the next position,
//     and the run stops when the realised balance reaches the goal (5000 USD).
//
// These are rules, not a promise. A token can fall faster than the stop can fill,
// and a pump.fun token can go to zero. Nothing here is financial advice.
//
// All money is whole US cents. Never a floating-point dollar amount.

/** Take profit in cents: 10.00 USD or more. */
export const TAKE_PROFIT_CENTS = 1000;

/** Stop loss as a fraction of the amount put in. */
export const STOP_LOSS_PCT = 20;

/** The stake the run starts with: 5.00 USD. */
export const START_BANKROLL_CENTS = 500;

/** The smallest position worth opening; below it the run stops. */
export const MIN_POSITION_CENTS = 100;

/** The bankroll at which the run stops. */
export const GOAL_CENTS = 500000;

/** A small default watchlist. The person can edit it; ids are pump.fun mints. */
export const DEFAULT_WATCHLIST = [
  { mint: 'paper-mint-a', symbol: 'TOKEN-A (paper)' },
  { mint: 'paper-mint-b', symbol: 'TOKEN-B (paper)' },
  { mint: 'paper-mint-c', symbol: 'TOKEN-C (paper)' },
];

/**
 * @typedef {object} Position
 * @property {string} mint
 * @property {number} entryCents the amount put in, in cents
 * @property {number} entryPrice price paid, in micro-USD per token
 * @property {number} tokens whole token units held (as a decimal string count scaled by 1e8)
 */

/**
 * Decide what to do with an open position at the current price.
 * @param {Position} pos
 * @param {number} priceMicros current price in micro-USD per token
 * @returns {{ action: 'take_profit'|'stop_loss'|'hold', pnlCents: number, reason: string, valueCents: number }}
 */
export function decideExit(pos, priceMicros) {
  const entryCents = Math.round(pos.entryCents);
  if (!Number.isFinite(priceMicros) || priceMicros <= 0 || entryCents <= 0) {
    return { action: 'hold', pnlCents: 0, reason: 'no usable price yet', valueCents: entryCents };
  }
  const ratio = priceMicros / pos.entryPrice;
  const valueCents = Math.round(entryCents * ratio);
  const pnlCents = valueCents - entryCents;

  if (pnlCents >= TAKE_PROFIT_CENTS) {
    return {
      action: 'take_profit',
      pnlCents,
      valueCents,
      reason: `take profit hit: +$${(pnlCents / 100).toFixed(2)} is at or above the $${(TAKE_PROFIT_CENTS / 100).toFixed(2)} rule - close and rotate to the next token`,
    };
  }
  const lossPct = entryCents > 0 ? (-pnlCents / entryCents) * 100 : 0;
  if (lossPct >= STOP_LOSS_PCT) {
    return {
      action: 'stop_loss',
      pnlCents,
      valueCents,
      reason: `stop loss hit: -${lossPct.toFixed(1)}% is at or past the ${STOP_LOSS_PCT}% rule - close the position`,
    };
  }
  return {
    action: 'hold',
    pnlCents,
    valueCents,
    reason: `within rules: ${pnlCents >= 0 ? '+' : '-'}$${(Math.abs(pnlCents) / 100).toFixed(2)} (${lossPct.toFixed(1)}% down, take profit at +$${(TAKE_PROFIT_CENTS / 100).toFixed(2)}, stop at ${STOP_LOSS_PCT}%)`,
  };
}

/**
 * After a closed trade, work out the size of the next position and whether the run is over.
 * A win compounds: the next position is the previous size plus the profit.
 * A loss shrinks it: the next position is what is left.
 * @param {{sizeCents: number, realisedCents: number, pnlCents: number}} p
 * @returns {{ nextSizeCents: number, realisedCents: number, bankrollCents: number, goalReached: boolean, sizeCents: number, note: string }}
 */
export function afterClose(p) {
  // realisedCents is the run's cumulative profit and loss (it starts at 0 and may be
  // negative). The bankroll is the starting stake plus that, so one stop loss shrinks
  // the next position instead of ending the run.
  const realisedCents = Math.round(p.realisedCents + p.pnlCents);
  const bankrollCents = Math.round(START_BANKROLL_CENTS + realisedCents);
  const goalReached = bankrollCents >= GOAL_CENTS;
  const rawSize = Math.round(p.sizeCents + p.pnlCents);
  // Never bet more than the bankroll holds, and never a negative size.
  const capped = Math.max(0, Math.min(rawSize, bankrollCents));
  // Below the smallest position worth a trade, there is nothing left to run with.
  const nextSizeCents = goalReached || capped < MIN_POSITION_CENTS ? 0 : capped;
  const note = goalReached
    ? `goal reached: bankroll $${(bankrollCents / 100).toFixed(2)} is at or above the $${(GOAL_CENTS / 100).toFixed(2)} target - the run stops here`
    : nextSizeCents === 0
      ? `bankroll $${(bankrollCents / 100).toFixed(2)} is under the $${(MIN_POSITION_CENTS / 100).toFixed(2)} smallest position - the run stops`
      : `compounding: next position $${(nextSizeCents / 100).toFixed(2)} from a bankroll of $${(bankrollCents / 100).toFixed(2)}`;
  return {
    nextSizeCents,
    realisedCents,
    bankrollCents,
    goalReached,
    sizeCents: Math.round(p.sizeCents),
    note,
  };
}

/**
 * Pick the next token to rotate into. Skips the one just closed and any token
 * that already took profit in this run.
 * @param {{mint: string, symbol: string}[]} watchlist
 * @param {string} justClosedMint
 * @param {Set<string>} doneMints
 * @returns {{mint: string, symbol: string}|null}
 */
export function nextToken(watchlist, justClosedMint, doneMints) {
  const fresh = watchlist.filter((t) => t.mint !== justClosedMint && !doneMints.has(t.mint));
  if (fresh.length > 0) return fresh[0];
  // Every token has been used at least once: rotate through the watchlist again
  // rather than stopping on a three-token list. Re-entry is not free money, and the
  // note on screen says the run is rotating.
  const rotate = watchlist.filter((t) => t.mint !== justClosedMint);
  return rotate.length > 0 ? rotate[0] : null;
}

/**
 * The rule set as shown on screen and in the API.
 * @returns {{takeProfitUsd: number, stopLossPct: number, goalUsd: number, compounds: boolean, venue: string}}
 */
export function ruleSummary() {
  return {
    takeProfitUsd: TAKE_PROFIT_CENTS / 100,
    stopLossPct: STOP_LOSS_PCT,
    goalUsd: GOAL_CENTS / 100,
    compounds: true,
    venue: 'pump.fun',
  };
}

/**
 * Paper entry: turn a dollar size into whole cents and the token amount at a price.
 * @param {string} mint
 * @param {number} sizeCents
 * @param {number} priceMicros
 * @returns {Position}
 */
export function paperPosition(mint, sizeCents, priceMicros) {
  return {
    mint,
    entryCents: Math.round(sizeCents),
    entryPrice: priceMicros,
    // Whole token units held, scaled by 1e8: (dollars / price) * 1e8.
    tokens: Math.round(((sizeCents / 100) / (priceMicros / 1e6)) * 1e8),
  };
}
