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

/** The balance at which the run stops. */
export const GOAL_CENTS = 500000;

/** A small default watchlist. The person can edit it; ids are pump.fun mints. */
export const DEFAULT_WATCHLIST = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL-PERP-PAPER' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC-PAPER' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK-PAPER' },
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
 * @returns {{ nextSizeCents: number, realisedCents: number, goalReached: boolean, sizeCents: number, note: string }}
 */
export function afterClose(p) {
  const realisedCents = Math.round(p.realisedCents + p.pnlCents);
  const goalReached = realisedCents >= GOAL_CENTS;
  const rawSize = Math.round(p.sizeCents + p.pnlCents);
  // Never bet more than what is realised so far, and never a negative size.
  const nextSizeCents = goalReached ? 0 : Math.max(0, Math.min(rawSize, realisedCents));
  const note = goalReached
    ? `goal reached: realised $${(realisedCents / 100).toFixed(2)} is at or above the $${(GOAL_CENTS / 100).toFixed(2)} target - the run stops here`
    : nextSizeCents === 0
      ? 'nothing left to compound: the realised balance is zero, the run stops'
      : `compounding: next position $${(nextSizeCents / 100).toFixed(2)} from realised $${(realisedCents / 100).toFixed(2)}`;
  return { nextSizeCents, realisedCents, goalReached, sizeCents: Math.round(p.sizeCents), note };
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
  const pool = watchlist.filter((t) => t.mint !== justClosedMint && !doneMints.has(t.mint));
  return pool.length > 0 ? pool[0] : null;
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
 * @param {number} sizeCents
 * @param {number} priceMicros
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
