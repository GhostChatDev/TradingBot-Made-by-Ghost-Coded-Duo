// test/api.test.js - key auth, 402 with no credits, exact charge, never below zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signedInUser, authedGet, authedPost } from './helpers.js';

/** @param {string} base @param {string} key */
const callSignal = (base, key) =>
  fetch(`${base}/api/v1/signal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ market: 'SOL/USD', fast: 5, slow: 20 }),
  });

test('API key rules', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const user = await signedInUser(srv.base);
  const created = await authedPost(srv.base, user.token, '/api/keys', { label: 'ci' });
  assert.equal(created.status, 201);
  const { key } = await created.json();
  assert.match(key, /^sb_sk_/);

  await t.test('a missing key is refused', async () => {
    const res = await callSignal(srv.base, '');
    assert.equal(res.status, 401);
  });

  await t.test('a wrong key is refused', async () => {
    const res = await callSignal(srv.base, 'sb_sk_totally-made-up-key-value');
    assert.equal(res.status, 401);
  });

  await t.test('the plaintext key is never stored, only a hash', () => {
    const rows = srv.db.prepare('SELECT * FROM api_keys').all();
    assert.equal(rows.length, 1);
    for (const row of rows) {
      const blob = JSON.stringify(row);
      assert.ok(!blob.includes(key), 'plaintext key must not be in the database');
      assert.equal(String(row.key_hash).length, 64, 'a sha-256 hex hash is stored');
    }
  });

  await t.test('a revoked key is refused', async () => {
    const keys = await (await authedGet(srv.base, user.token, '/api/keys')).json();
    const revoked = await fetch(`${srv.base}/api/keys/${keys.keys[0].id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${user.token}` },
    });
    assert.equal(revoked.status, 200);
    const res = await callSignal(srv.base, key);
    assert.equal(res.status, 401);
  });
});

test('credits: 402 with none, exact charge, never below zero', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const user = await signedInUser(srv.base);
  const { key } = await (await authedPost(srv.base, user.token, '/api/keys', { label: 'ci' })).json();

  await t.test('no credits returns 402 and the strategy does not run', async () => {
    const before = srv.db.prepare('SELECT COUNT(*) AS n FROM api_calls').get();
    const res = await callSignal(srv.base, key);
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error, 'no_credits');
    assert.equal(body.signal, undefined, 'no signal is returned when nothing was paid for');
    const after = srv.db.prepare('SELECT COUNT(*) AS n FROM api_calls WHERE status = 200').get();
    assert.equal(Number(after?.n), Number(before?.n), 'no successful call was recorded');

    // No credit was taken and no strategy result was written anywhere.
    const credits = await (await authedGet(srv.base, user.token, '/api/credits')).json();
    assert.equal(credits.balance, 0, 'the balance stays at zero');
    const entries = srv.db.prepare('SELECT COUNT(*) AS n FROM credit_entries').get();
    assert.equal(Number(entries?.n), 0, 'no ledger entry was written for a refused call');
    const runs = srv.db.prepare("SELECT COUNT(*) AS n FROM bot_events WHERE kind = 'signal'").get();
    assert.equal(Number(runs?.n), 0, 'the strategy produced no signal event');
  });

  await t.test('a key only ever spends its own owner credits', async () => {
    const rich = await signedInUser(srv.base);
    await authedPost(srv.base, rich.token, '/api/credits/topup', { amount: 10 });
    const richKey = (await (await authedPost(srv.base, rich.token, '/api/keys', { label: 'rich' })).json()).key;

    const poor = await signedInUser(srv.base);
    const poorKey = (await (await authedPost(srv.base, poor.token, '/api/keys', { label: 'poor' })).json()).key;

    const richCall = await callSignal(srv.base, richKey);
    assert.equal(richCall.status, 200);
    assert.equal((await richCall.json()).balance, 9, 'only the owner balance goes down');

    const poorCall = await callSignal(srv.base, poorKey);
    assert.equal(poorCall.status, 402, 'the other account is still at zero');
    const poorCredits = await (await authedGet(srv.base, poor.token, '/api/credits')).json();
    assert.equal(poorCredits.balance, 0);
    const richCredits = await (await authedGet(srv.base, rich.token, '/api/credits')).json();
    assert.equal(richCredits.balance, 9, 'one account never pays for another');
  });

  await t.test('one call costs exactly the price per call', async () => {
    await authedPost(srv.base, user.token, '/api/credits/topup', { amount: 5 });
    const res = await callSignal(srv.base, key);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.charged, 1);
    assert.equal(body.balance, 4);
    const usage = await (await fetch(`${srv.base}/api/v1/usage`, { headers: { authorization: `Bearer ${key}` } })).json();
    assert.equal(usage.calls, 1);
    assert.equal(usage.creditsSpent, 1);
    assert.equal(usage.balance, 4);
  });

  await t.test('two calls at once cannot push the balance below zero', async () => {
    const fresh = await signedInUser(srv.base);
    const newKey = (await (await authedPost(srv.base, fresh.token, '/api/keys', { label: 'race' })).json()).key;
    await authedPost(srv.base, fresh.token, '/api/credits/topup', { amount: 1 });
    const results = await Promise.all([callSignal(srv.base, newKey), callSignal(srv.base, newKey)]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 402], 'exactly one call is paid for, the other is refused');
    const credits = await (await authedGet(srv.base, fresh.token, '/api/credits')).json();
    assert.equal(credits.balance, 0);
    assert.ok(credits.balance >= 0);
  });

  await t.test('usage is refused without a valid key', async () => {
    const res = await fetch(`${srv.base}/api/v1/usage`);
    assert.equal(res.status, 401);
  });
});
