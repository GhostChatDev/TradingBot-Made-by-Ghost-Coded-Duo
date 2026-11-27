// test/helpers.js - boot the real Express app on an in-memory database.
import nacl from 'tweetnacl';
import { createApp } from '../server/index.js';
import { loadConfig } from '../server/config.js';
import { openDb, Db } from '../server/db.js';

/**
 * @returns {Promise<{base: string, app: import('express').Express, db: Db, close: () => Promise<void>, config: ReturnType<typeof loadConfig>}>}
 */
/**
 * @param {Record<string, string>} [env]
 */
export async function startTestServer(env = {}) {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    TRADING_MODE: 'paper',
    PAYMENTS_MODE: 'test',
    MAINNET_ENABLED: 'false',
    API_KEY_PEPPER: 'test-pepper-0123456789abcdef',
    ...env,
  });
  const db = openDb(':memory:');
  const app = createApp(config, db);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', () => resolve(undefined)));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    app,
    db,
    config,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve(undefined);
        });
      }),
  };
}

/**
 * Create a wallet, sign the nonce with a real ed25519 keypair, return the session token.
 * The test keeps the keypair in memory only; the server never sees it.
 */
export async function signedInUser(/** @type {string} */ base) {
  const pair = nacl.sign.keyPair();
  const wallet = bs58Encode(pair.publicKey);
  const nonceRes = await fetch(`${base}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
  });
  const { nonce } = await nonceRes.json();
  const message = `Sign in to Solana Bot Demo\nwallet: ${wallet}\nnonce: ${nonce}`;
  const signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey)).toString('base64');
  const verifyRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, signature }),
  });
  const body = await verifyRes.json();
  return { wallet, token: body.token, pair };
}

/** @param {Uint8Array} bytes */
function bs58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/**
 * @param {string} base
 * @param {string} token
 * @param {object} body
 */
export async function authedPost(/** @type {string} */ base, /** @type {string} */ token, /** @type {string} */ urlPath, body = {}) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/**
 * @param {string} base
 * @param {string} token
 * @param {string} urlPath
 */
export async function authedGet(/** @type {string} */ base, /** @type {string} */ token, /** @type {string} */ urlPath) {
  return fetch(`${base}${urlPath}`, { headers: { authorization: `Bearer ${token}` } });
}

/**
 * Narrow a value that may be `undefined` (node:sqlite's .get() type) to one row,
 * failing the test with a clear message instead of a TypeError.
 * @template T
 * @param {T | undefined} row
 * @returns {T}
 */
export function one(row) {
  if (row === undefined) throw new Error('expected one row, got none');
  return row;
}
