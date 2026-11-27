// server/money.js - money is never carried as a raw float sum.
// Amounts are whole micro-dollars (1e-6 USD) while they are added or compared,
// and only turned back into a rounded USD number for storage and display.

/**
 * USD to whole micro-dollars. 1.005 -> 1005000.
 * @param {number} usd
 */
export function toMicros(usd) {
  if (!Number.isFinite(usd)) return 0;
  return Math.round(usd * 1e6);
}

/**
 * Whole micro-dollars to USD.
 * @param {number} micros
 */
export function fromMicros(micros) {
  return Number((micros / 1e6).toFixed(6));
}

/**
 * Round DOWN to `dp` places, exactly, by cutting in micro-dollar space.
 * roundDown(0.1 + 0.2, 2) === 0.3
 * @param {number} usd
 * @param {number} [dp]
 */
export function roundDown(usd, dp = 2) {
  if (!Number.isFinite(usd)) return 0;
  const sign = usd < 0 ? -1 : 1;
  const micros = toMicros(Math.abs(usd));
  const step = 10 ** (6 - dp);
  return (sign * Math.floor(micros / step) * step) / 1e6;
}

/**
 * A price for display and for a transaction: 8 decimal places.
 * @param {number} usd
 */
export function money(usd) {
  return roundDown(usd, 8);
}
