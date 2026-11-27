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
 * Round DOWN to `dp` places, exactly, in whatever precision the caller asks for.
 * roundDown(0.1 + 0.2, 2) === 0.3
 * roundDown(1.005, 2) === 1        (the float sits just under 1.005, then a
 *                                   tiny epsilon corrects for float noise)
 * A negative amount is cut away from zero, so a loss never grows by rounding.
 * @param {number} usd
 * @param {number} [dp]
 */
export function roundDown(usd, dp = 2) {
  if (!Number.isFinite(usd)) return 0;
  const scale = 10 ** dp;
  const eps = Math.abs(usd) * 1e-12 + 1e-9;
  const scaled = usd * scale + eps;
  return (usd < 0 ? Math.ceil(scaled) : Math.floor(scaled)) / scale;
}

/**
 * A price for display and for a transaction: 8 decimal places, never rounded up.
 * money(150.123456789) === 150.12345678
 * @param {number} usd
 */
export function money(usd) {
  return roundDown(usd, 8);
}
