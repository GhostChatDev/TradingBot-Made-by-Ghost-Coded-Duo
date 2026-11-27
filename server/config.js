// server/config.js - every safety switch lives here and is read once at boot.
// Secrets are read ONLY from environment variables and are never logged.
import { resolveMode, mainnetLiveEnabled } from './mainnet-guard.js';

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
export function loadConfig(env = process.env) {
  const rawMode = (env.TRADING_MODE || 'paper').toLowerCase();
  const payments = (env.PAYMENTS_MODE || 'test').toLowerCase();

  // Mainnet is gated by ONE flag (MAINNET_LIVE). The guard logs the refusal.
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
    keyPepper: env.API_KEY_PEPPER || 'dev-only-pepper-change-me',
    creditsPerSignal: CREDITS_PER_SIGNAL,
    rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
    maxTradeUsd: DEFAULT_MAX_TRADE_USD,
    maxDailyLossUsd: DEFAULT_MAX_DAILY_LOSS_USD,
  };
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

/** The sentence every trading screen must show. */
export const DISCLAIMER =
  'General information and software, not financial advice. You can lose everything you put in.';
