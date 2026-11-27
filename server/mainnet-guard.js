// server/mainnet-guard.js - ONE flag decides whether this server may touch real money.
//
// Rule: unless MAINNET_ENABLED=true is set in the server's environment, this module
// REFUSES to build or sign any mainnet transaction, writes down why, and throws.
// There is no other path to a mainnet build or signature in this codebase, and no alias.

/** The single environment flag that unlocks live mainnet trading. */
export const MAINNET_FLAG = 'MAINNET_ENABLED';

/** Why the guard refused. Written to the log and returned to the caller. */
export const REFUSAL_REASON =
  'Refused: live mainnet trading is off. Set MAINNET_ENABLED=true in the server environment to allow it. ' +
  'This app starts with it unset, so nothing real is built or signed.';

/**
 * Read the single flag. Anything other than the exact string "true" counts as off.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function mainnetLiveEnabled(env = process.env) {
  const reads = (/** @type {string} */ name) => String(env[name] ?? '').trim().toLowerCase() === 'true';
  // Either documented name switches it on; anything other than the exact string
  // "true" counts as off, and unset means off.
  return reads(MAINNET_FLAG);
}

/**
 * @typedef {{ log: (line: string) => void }} GuardLogger
 */

/** @type {GuardLogger} */
const defaultLogger = {
  log: (line) => {
    // One line, no key material, no stack. Goes to the server log only.
    process.stderr.write(`[mainnet-guard] ${line}\n`);
  },
};

/**
 * Throw unless live mainnet trading is switched on.
 * Call this immediately before building OR signing anything for mainnet.
 * @param {'build'|'sign'} action
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GuardLogger} [logger]
 * @returns {true} always true when it does not throw
 */
export function assertMayTouchMainnet(action, env = process.env, logger = defaultLogger) {
  if (mainnetLiveEnabled(env)) {
    logger.log(`${action}: allowed (${MAINNET_LIVE_FLAG}=true)`);
    return true;
  }
  logger.log(`${action}: BLOCKED - ${REFUSAL_REASON}`);
  throw new Error(REFUSAL_REASON);
}

/**
 * The mode this server may actually run in. Requesting mainnet without the flag
 * falls back to paper and logs why - it never silently runs live.
 * @param {string} requested
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GuardLogger} [logger]
 * @returns {'paper'|'devnet'|'mainnet'}
 */
export function resolveMode(requested, env = process.env, logger = defaultLogger) {
  const wanted = String(requested || 'paper').toLowerCase();
  if (wanted === 'devnet') return 'devnet';
  if (wanted !== 'mainnet') return 'paper';
  if (!mainnetLiveEnabled(env)) {
    logger.log(`${MAINNET_LIVE_FLAG} unset, so mainnet is refused and this server runs paper. ${REFUSAL_REASON}`);
    return 'paper';
  }
  return 'mainnet';
}

/**
 * A mainnet transaction may only be built by this server when the flag is set
 * AND the resolved mode is mainnet. Returns the object handed to the wallet.
 * @param {{mode: string, action: 'build'|'sign', transaction: string}} p
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GuardLogger} [logger]
 */
export function mainnetTransaction(p, env = process.env, logger = defaultLogger) {
  if (p.mode !== 'mainnet') throw new Error('mainnetTransaction called for a non-mainnet mode');
  assertMayTouchMainnet(p.action, env, logger);
  return { mode: 'mainnet', transaction: p.transaction, requiresWalletSignature: true };
}
