// server/prices.js - price feed with an explicit simulated fallback.
// PAPER mode works offline using clearly labelled simulated prices.
// Nothing here is a live market oracle.

const SIMULATED_BASE = { 'SOL/USD': 150, 'BONK/USD': 0.0000245 };
const SIMULATED_STEP_PCT = 0.006;

/**
 * @param {string} market
 * @returns {string} the market's base price
 */
export function markets() {
  return Object.keys(SIMULATED_BASE);
}

/**
 * @param {string} market
 * @param {number} step
 */
export function simulatedPrice(market, step) {
  const base = SIMULATED_BASE[market] ?? 100;
  const wave = Math.sin(step / 3) * SIMULATED_STEP_PCT * 4 + Math.cos(step / 11) * SIMULATED_STEP_PCT;
  return Number((base * (1 + wave)).toFixed(8));
}

/**
 * Build a price history of length `n`, oldest first, newest last.
 * `source` says where the numbers came from, so the UI can label them honestly.
 * @param {string} market
 * @param {number} n
 * @param {number} seed
 * @param {string} [source]
 */
export function history(market, n, seed = 0, source = 'simulated') {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(simulatedPrice(market, seed + i));
  return { prices: out, source, last: out[out.length - 1] ?? 0 };
}

/**
 * Paper fills cost a fixed simulated fee so risk numbers stay honest.
 * @param {number} notionalUsd
 */
export function paperFee(notionalUsd) {
  return Number(Math.max(0.0005, notionalUsd * 0.001).toFixed(6));
}
