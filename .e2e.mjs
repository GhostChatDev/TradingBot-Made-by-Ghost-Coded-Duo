import nacl from 'tweetnacl';

const base = 'http://localhost:4321';
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHA[digits[i]];
  return out;
}

let cookie = ''; let sessionToken = '';
async function call(path, opts = {}) {
  const r = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(sessionToken ? { authorization: 'Bearer ' + sessionToken } : {}), ...(opts.headers || {}) } });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const kp = nacl.sign.keyPair();
const wallet = b58(kp.publicKey);
const n = await call('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ wallet }) });
const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.body.message), kp.secretKey)).toString('base64');
const v = await call('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet, signature: sig }) });
sessionToken = v.body.token || '';
console.log('verify', v.status, JSON.stringify(v.body).slice(0, 120));

// create key
const k = await call('/api/keys', { method: 'POST', body: JSON.stringify({ label: 'e2e' }) });
console.log('key created', k.status, 'plaintext once:', String(k.body.key).slice(0, 8) + '…'); const key = k.body.key;


// usage + signal without credits
const u0 = await fetch(base + '/api/v1/usage', { headers: { authorization: 'Bearer ' + key } });
console.log('usage before credits', u0.status, await u0.text());

const s0 = await fetch(base + '/api/v1/signal', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ market: 'SOL/USD' }) });
const s0b = await s0.json();
console.log('signal no credits', s0.status, s0b.error, 'strategy ran?', JSON.stringify(s0b).includes('action'), 'balance', s0b.balance);

// top up in TEST mode
const t = await call('/api/credits/topup', { method: 'POST', body: JSON.stringify({ amount: 100 }) });
console.log('topup', t.status, t.body.testMode, 'balance', t.body.balance ?? t.body);

// two concurrent signals
const both = await Promise.all([1, 2].map(() => fetch(base + '/api/v1/signal', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ market: 'SOL/USD' }) }).then(async r => [r.status, await r.json()])));
console.log('two concurrent', both.map(([s, b]) => s + '/' + (b.action ?? b.error)).join(' '));
const u1 = await fetch(base + '/api/v1/usage', { headers: { authorization: 'Bearer ' + key } });
const u1b = await u1.json();
console.log('usage after', u1.status, JSON.stringify(u1b));

// revoke, then call
const list = await call('/api/keys');
const id = list.body.keys[0].id;
await call('/api/keys/' + id, { method: 'DELETE' });
const after = await fetch(base + '/api/v1/usage', { headers: { authorization: 'Bearer ' + key } });
console.log('revoked key', after.status, await after.text());

// bot: caps and stop
await call('/api/limits', { method: 'POST', body: JSON.stringify({ maxTradeUsd: 5, maxDailyLossUsd: 10 }) });
const lower = await call('/api/limits', { method: 'POST', body: JSON.stringify({ maxTradeUsd: 1e9, maxDailyLossUsd: 1e9 }) });
console.log('caps clamp', lower.status, JSON.stringify(lower.body).slice(0, 160));
const tick = await call('/api/bot/tick', { method: 'POST', body: JSON.stringify({ market: 'SOL/USD', strategy: 'sma_cross', fast: 3, slow: 8, paper: true }) });
console.log('tick', tick.status, JSON.stringify(tick.body).slice(0, 260));
const stop = await call('/api/bot/stop', { method: 'POST', body: JSON.stringify({ reason: 'e2e' }) });
const tick2 = await call('/api/bot/tick', { method: 'POST', body: JSON.stringify({ market: 'SOL/USD', strategy: 'sma_cross', fast: 3, slow: 8, paper: true }) });
console.log('after STOP', tick2.status, JSON.stringify(tick2.body).slice(0, 200));
const st = await call('/api/bot/state');
console.log('state', st.status, JSON.stringify(st.body).slice(0, 300));
