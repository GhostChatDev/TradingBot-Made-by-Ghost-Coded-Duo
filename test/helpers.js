// test/helpers.js - boot the real Express app on an in-memory database.
import nacl from 'tweetnacl';
import { createApp } from '../server/index.js';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';

/**
 * @returns {Promise<{base: string, app: import('express').Express, db: import('better-sqlite3').Database, close: () => Promise<void>, config: ReturnType<typeof loadConfig>}>}
 */
export async function startTestServer(env = {}) {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    TRADING_MODE: 'paper',
    PAYMENTS_MODE: 'test',
    MAINNET_ENABLED: 'false',
    API_KEY_PEPPER: 'test-pepper',
    ...env,
  });
  const db = openDb(':memory:');
  const app = createApp(config, db);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
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
          resolve();
        });
      }),
  };
}

/**
 * Create a wallet, sign the nonce with a real ed25519 keypair, return the session token.
 * The test keeps the keypair in memory only; the server never sees it.
 */
export async function signedInUser(base) {
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
export async function authedPost(base, token, urlPath, body = {}) {
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
export async function authedGet(base, token, urlPath) {
  return fetch(`${base}${urlPath}`, { headers: { authorization: `Bearer ${token}` } });
}
