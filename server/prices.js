// server/prices.js - price feed. REAL prices first, clearly labelled simulated
// fallback only when the live feed cannot be reached (offline dev, rate limits).
// `source` always says which one a number came from, so nothing is mislabelled.

/** @type {Record<string, number>} */
const SIMULATED_BASE = { 'SOL/USD': 150, 'BONK/USD': 0.0000245 };
const SIMULATED_STEP_PCT = 0.006;

/** Coinbase product ids for the markets this build trades. */
/** @type {Record<string, string>} */
const COINBASE_PRODUCT = { 'SOL/USD': 'SOL-USD' };

/** @type {Map<string, {prices: number[], source: string, at: number}>} */
const liveCache = new Map();
/** @type {Map<string, {prices: number[], source: string}>} */
const overrides = new Map();

const CACHE_MS = 15_000;
const GRANULARITY_SECONDS = 60;
const FEED_DEADLINE_MS = 4000;

/** @returns {string[]} the markets this build knows */
export function markets() {
  return Object.keys(SIMULATED_BASE);
}

/** Drop every cached series. Used by tests. */
export function resetPriceCache() {
  liveCache.clear();
  overrides.clear();
}

/**
 * Test/offline hook: use this series instead of going to the network.
 * @param {string} market
 * @param {{prices: number[], source: string}} series
 */
export function setPriceSeries(market, series) {
  overrides.set(market, series);
}

/**
 * Coinbase candles are newest first: [time, low, high, open, close, volume].
 * Return closes oldest first.
 * @param {unknown} rows
 * @returns {number[]}
 */
export function parseCoinbaseCandles(rows) {
  if (!Array.isArray(rows)) throw new Error('unexpected candle payload');
  return rows
    .map((r) => (Array.isArray(r) ? Number(r[4]) : NaN))
    .filter((n) => Number.isFinite(n) && n > 0)
    .reverse();
}

/**
 * Fetch the last `n` one-minute closes from Coinbase's public candles endpoint
 * (no key, no account). Throws on any problem so the caller can fall back.
 * @param {string} market
 * @param {number} n
 * @returns {Promise<number[]>}
 */
export async function fetchLiveSeries(market, n) {
  const product = COINBASE_PRODUCT[market];
  if (!product) throw new Error(`no live feed for ${market}`);
  const seconds = Math.min(Math.max(n, 30) * GRANULARITY_SECONDS, 300 * GRANULARITY_SECONDS);
  const end = new Date();
  const start = new Date(end.getTime() - seconds * 1000);
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${GRANULARITY_SECONDS}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FEED_DEADLINE_MS) });
  if (!res.ok) throw new Error(`price feed answered ${res.status}`);
  const series = parseCoinbaseCandles(await res.json());
  if (series.length < 4) throw new Error('price feed returned too few candles');
  return series.slice(-n);
}

/**
 * The last `n` prices, oldest first. Live when the feed answers; otherwise the
 * labelled simulated series, so paper mode still runs offline.
 * Never throws: a bot tick must not die because a price API hiccuped.
 * @param {string} market
 * @param {number} n
 * @param {number} [seed]
 * @returns {{prices: number[], source: string, last: number}}
 */
export function history(market, n, seed = 0) {
  const over = overrides.get(market);
  if (over && over.prices.length > 0) {
    const prices = over.prices.slice(-n);
    return { prices, source: over.source, last: prices[prices.length - 1] ?? 0 };
  }
  const cached = liveCache.get(market);
  if (cached && cached.prices.length >= 4 && Date.now() - cached.at < CACHE_MS) {
    const prices = cached.prices.slice(-n);
    return { prices, source: cached.source, last: prices[prices.length - 1] ?? 0 };
  }
  const simulated = [];
  for (let i = 0; i < n; i += 1) simulated.push(simulatedPrice(market, seed + i));
  return { prices: simulated, source: 'simulated', last: simulated[simulated.length - 1] ?? 0 };
}

/**
 * Refresh the live series for a market into the cache. Best effort: on any
 * failure the previous (or simulated) series stays and the source says so.
 * @param {string} market
 * @param {number} n
 * @returns {Promise<string>} the source that will be reported
 */
export async function refreshPrices(market, n) {
  try {
    const prices = await fetchLiveSeries(market, Math.max(n, 30));
    liveCache.set(market, { prices, source: 'live:coinbase', at: Date.now() });
  } catch {
    // Keep whatever we have; history() labels it honestly.
  }
  return history(market, n).source;
}

/**
 * Simulated price used only as a labelled fallback.
 * @param {string} market
 * @param {number} step
 */
export function simulatedPrice(market, step) {
  const base = SIMULATED_BASE[market] ?? 100;
  const wave = Math.sin(step / 3) * SIMULATED_STEP_PCT * 4 + Math.cos(step / 11) * SIMULATED_STEP_PCT;
  return Number((base * (1 + wave)).toFixed(8));
}

/**
 * Paper fills cost a fixed simulated fee so risk numbers stay honest.
 * @param {number} notionalUsd
 */
export function paperFee(notionalUsd) {
  return Number(Math.max(0.0005, notionalUsd * 0.001).toFixed(6));
}
