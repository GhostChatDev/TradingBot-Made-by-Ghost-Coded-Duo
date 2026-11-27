// server/config.js - every safety switch lives here and is read once at boot.
// Secrets are read ONLY from environment variables and are never logged.
import { resolveMode, mainnetLiveEnabled, MAINNET_FLAG } from './mainnet-guard.js';

/** @typedef {'paper'|'devnet'|'mainnet'} TradingMode */

/** Hard ceilings. A user may lower their limits, never raise them above these. */
export const HARD_MAX_TRADE_USD = 25;
export const HARD_MAX_DAILY_LOSS_USD = 50;

/** Defaults are small on purpose. */
export const DEFAULT_MAX_TRADE_USD = 5;
export const DEFAULT_MAX_DAILY_LOSS_USD = 10;

/** Cost of one paid API call, in credits. One credit = one US cent of prepaid balance. */
export const CREDITS_PER_SIGNAL = 1;

/** Requests allowed per API key per minute. */
export const RATE_LIMIT_PER_MINUTE = 60;

/**
 * @param {NodeJS.ProcessEnv} env
 */
/** @typedef {NodeJS.ProcessEnv | Record<string, string | undefined>} Env */

/**
 * @param {Env} [env]
 */
export function loadConfig(env = process.env) {
  // `node --test` runs each test file in its own process, which sets NODE_TEST_CONTEXT.
  const isTest = env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT !== undefined;
  const rawMode = (env.TRADING_MODE || 'paper').toLowerCase();
  const payments = (env.PAYMENTS_MODE || 'test').toLowerCase();

  // Mainnet is gated by ONE flag (MAINNET_ENABLED). The guard logs the refusal.
  const mode = resolveMode(rawMode, env);
  const mainnetEnabled = mainnetLiveEnabled(env);

  return {
    port: Number(env.PORT || 3000),
    databasePath: env.DATABASE_PATH || './data/bot.sqlite',
    rpcUrl: env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    /** @type {TradingMode} */
    mode,
    /** True only when the operator explicitly switched mainnet on. */
    mainnetEnabled,
    /** 'test' = fake money top-ups. 'off' = no payments at all. */
    payments: payments === 'off' ? 'off' : 'test',
    /** The pepper for API key hashes, or null when none is configured (keys disabled). */
    keyPepper: readPepper(env, isTest, { fatal: false }),
    creditsPerSignal: CREDITS_PER_SIGNAL,
    rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
    maxTradeUsd: DEFAULT_MAX_TRADE_USD,
    maxDailyLossUsd: DEFAULT_MAX_DAILY_LOSS_USD,
  };
}

/**
 * The pepper that goes into every API key hash. It must come from the
 * environment: a public, hard-coded pepper in the repository would let anyone
 * holding the database test guessed keys against it. Tests get a fixed value so
 * they can run without one; a real server refuses to start without it.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {boolean} isTest
 * @param {{fatal?: boolean}} [opts] fatal:false returns null instead of throwing, so the
 *   server can still boot and show its screens (API key endpoints then refuse).
 * @returns {string | null}
 */
export function readPepper(env, isTest, opts = {}) {
  const pepper = String(env.API_KEY_PEPPER ?? '').trim();
  if (pepper.length >= 16) return pepper;
  if (isTest) return 'test-only-pepper';
  if (opts.fatal === false) return null;
  throw new Error(
    'API_KEY_PEPPER is missing or shorter than 16 characters. Generate one (for example `openssl rand -hex 32`) ' +
      'and set it in the server environment before starting. API keys are not usable without it.',
  );
}

/**
 * Clamp a user-supplied limit so it can be lowered but never removed.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} hardMax
 */
export function clampLimit(value, fallback, hardMax) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, hardMax);
}

/**
 * The pepper for API key hashes, or null when this server was started without one.
 * @param {{keyPepper?: string | null}} config
 * @returns {string | null}
 */
export function pepperFor(config) {
  return config.keyPepper ?? null;
}

/** The sentence every trading screen must show. */
export const DISCLAIMER =
  'General information and software, not financial advice. You can lose everything you put in.';
