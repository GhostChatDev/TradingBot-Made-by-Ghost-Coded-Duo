// server/strategy.js - one simple, honest strategy: a moving-average crossover.

/**
 * @param {number[]} values
 * @param {number} n
 */
export function sma(values, n) {
  if (n <= 0 || values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i += 1) sum += values[i];
  return sum / n;
}

/**
 * @typedef {{ signal: 'buy'|'sell'|'hold', fast: number|null, slow: number|null, reason: string }} Signal
 */

/**
 * Compare the fast and slow average now with where they were one tick ago.
 * @param {number[]} prices oldest first, newest last
 * @param {{fast: number, slow: number}} params
 * @returns {Signal}
 */
export function crossoverSignal(prices, params) {
  const { fast, slow } = params;
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 2 || slow <= fast) {
    return { signal: 'hold', fast: null, slow: null, reason: 'invalid parameters: slow must be a whole number greater than fast (fast >= 2)' };
  }
  if (prices.length < slow + 1) {
    return { signal: 'hold', fast: null, slow: null, reason: `waiting for ${slow + 1} price points` };
  }
  const nowFast = sma(prices, fast);
  const nowSlow = sma(prices, slow);
  const prevFast = sma(prices.slice(0, -1), fast);
  const prevSlow = sma(prices.slice(0, -1), slow);
  if (nowFast === null || nowSlow === null || prevFast === null || prevSlow === null) {
    return { signal: 'hold', fast: null, slow: null, reason: 'not enough price history' };
  }
  const f = (n) => n.toFixed(4);
  if (prevFast <= prevSlow && nowFast > nowSlow) {
    return { signal: 'buy', fast: nowFast, slow: nowSlow, reason: `SMA${fast} ${f(nowFast)} crossed above SMA${slow} ${f(nowSlow)}` };
  }
  if (prevFast >= prevSlow && nowFast < nowSlow) {
    return { signal: 'sell', fast: nowFast, slow: nowSlow, reason: `SMA${fast} ${f(nowFast)} crossed below SMA${slow} ${f(nowSlow)}` };
  }
  return {
    signal: 'hold',
    fast: nowFast,
    slow: nowSlow,
    reason: `no crossover: SMA${fast} ${f(nowFast)} vs SMA${slow} ${f(nowSlow)}`,
  };
}
