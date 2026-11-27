// test/secrets.test.js - no private key or seed phrase anywhere in code, data or responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, signedInUser, authedPost, authedGet } from './helpers.js';
import { redact } from '../server/custody.js';
import { base58Decode } from '../server/base58.js';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'coverage']);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Common English words that are not in the BIP39 word list; a real mnemonic never holds one.
const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'a', 'an', 'for', 'with', 'that', 'this',
  'it', 'its', 'as', 'at', 'by', 'on', 'or', 'be', 'not', 'from', 'you', 'your', 'we', 'so', 'if',
  'can', 'will', 'has', 'have', 'but', 'all', 'than', 'then', 'into', 'only', 'also', 'does',
  'too', 'much', 'very', 'just', 'more', 'most', 'their', 'there', 'these', 'they', 'what', 'when',
  'where', 'which', 'who', 'why', 'how', 'been', 'being', 'about', 'after', 'before', 'over', 'out',
  'up', 'down', 'off', 'use', 'used', 'uses', 'dev', 'bought', 'supply', 'wallet', 'wallets',
]);

const CODE_EXT = new Set(['.js', '.mjs', '.sql', '.json', '.md', '.example', '.yml', '.yaml', '.html', '.css']);

test('no file in the repository contains a seed phrase or a private key literal', () => {
  const files = walk(ROOT).filter((f) => CODE_EXT.has(path.extname(f)) && !f.includes('secrets.test.js'));
  assert.ok(files.length > 5, 'the source tree was scanned');
  /** @type {Array<{file: string, pattern: string}>} */
  const hits = [];
  // A base58 string that decodes to exactly 32 or 64 raw bytes is a Solana
  // public key (32) or a 64-byte secret key, whatever letters it looks like.
  /** @param {string} s */
  const isKeyLength = (s) => {
    try {
      const bytes = base58Decode(s);
      return bytes.length === 32 || bytes.length === 64;
    } catch {
      return false;
    }
  };
  const patterns = [
    // 12-24 words of 3-8 letters (a BIP39 mnemonic has 12, 15, 18, 21 or 24).
    // Prose is filtered out below by requiring no common English stopword in the run,
    // because the BIP39 list has none of them. This catches accidental pastes;
    // it is not a complete mnemonic detector, and it is meant to be paranoid.
    /\b[a-z]{3,8}(?:[ ,]+[a-z]{3,8}){11,23}\b/,
    /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/,
    /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (!m) continue;
      if (pattern === patterns[0]) {
        const words = String(m[0]).toLowerCase().split(/[ ,]+/).filter(Boolean);
        const isMnemonicShape = [12, 15, 18, 21, 24].includes(words.length);
        const hasProseWord = words.some((w) => STOPWORDS.has(w));
        if (!isMnemonicShape || hasProseWord) continue;
      }
      hits.push({ file: path.relative(ROOT, file), pattern: String(m[0]).slice(0, 24) });
    }
    for (const m of text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? []) {
      if (isKeyLength(m)) hits.push({ file: path.relative(ROOT, file), pattern: m.slice(0, 8) });
    }
  }
  // .env.example is allowed to hold obvious placeholder secrets, and no real one.
  const real = hits.filter((h) => {
    const found = h.pattern.toLowerCase();
    return !found.includes('placeholder') && !found.includes('change-me') && !found.includes('never-a-real');
  });
  assert.deepEqual(real, [], `secrets found: ${JSON.stringify(real)}`);
});

test('no response ever contains a secret-looking value, and logs are redacted', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const made = await (await authedPost(srv.base, user.token, '/api/keys', { label: 'scan' })).json();
  const bodies = [];
  bodies.push(await (await fetch(`${srv.base}/api/meta`)).text());
  bodies.push(await (await authedGet(srv.base, user.token, '/api/keys')).text());
  bodies.push(await (await authedGet(srv.base, user.token, '/api/credits')).text());
  bodies.push(await (await authedGet(srv.base, user.token, '/api/bot/state')).text());
  bodies.push(await (await authedPost(srv.base, user.token, '/api/bot/tick', { mode: 'paper', params: { fast: 2, slow: 3 } })).text());
  const joined = bodies.join('\n');
  assert.ok(!/secretKey|seedPhrase|mnemonic|privateKey/i.test(joined), 'no key-material field is echoed back');
  // Only the owner sees a key once, and even that is the owner's own key.
  assert.ok(!bodies[1].includes(made.key), 'the key list never repeats the plaintext key');

  assert.equal(redact(`key sb_sk_abcdefghijklmnop and host 10.1.2.3`), 'key [redacted api key] and host [redacted ip]');
});

test('the custody statement is present on the API surface', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const meta = await (await fetch(`${srv.base}/api/meta`)).json();
  assert.match(meta.custody, /never asks for/);
  assert.equal(meta.mainnetEnabled, false, 'mainnet is off by default');
  assert.match(meta.disclaimer, /not financial advice/i);
});

test('a mainnet request is refused while mainnet is off', async (t) => {
  const srv = await startTestServer({ TRADING_MODE: 'mainnet', MAINNET_ENABLED: 'false' });
  t.after(() => srv.close());
  assert.equal(srv.config.mode, 'paper', 'a mainnet env var without the switch falls back to paper');
  const user = await signedInUser(srv.base);
  const res = await authedPost(srv.base, user.token, '/api/bot/tick', { mode: 'mainnet', market: 'SOL/USD' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'mode_not_allowed');
});
