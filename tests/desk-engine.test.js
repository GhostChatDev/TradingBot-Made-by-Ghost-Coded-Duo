const test = require('node:test');
const assert = require('node:assert/strict');
const desk = require('../desk-engine.js');
const now = Date.parse('2026-01-02T12:00:00Z');
const make = (price = 100000) => desk.setQuote(desk.createBook(), price, now);
const ticket = (book, overrides = {}) => desk.draft(book, { action: 'LONG', size: 25, scout: 'agree', bear: 'agree', ...overrides }, now, 'ticket-1');

test('entry and exit update paper cash, P&L and reject duplicate fills', () => {
  let b = make(); const t = ticket(b);
  assert.equal(desk.gate(b, t, now).ok, true);
  b = desk.fill(b, t, now);
  assert.equal(b.cash, 975); assert.equal(b.cost, 25);
  assert.equal(desk.gate(b, t, now).ok, false);
  b = desk.setQuote(b, 110000, now + 1000);
  const close = desk.draft(b, { action: 'FLAT', scout: 'agree', bear: 'agree' }, now + 1000, 'ticket-2');
  b = desk.fill(b, close, now + 1000);
  assert.equal(b.cash, 1002.5); assert.equal(b.journal[0].pnl, 2.5);
  assert.equal(b.quantity, 0);
});

test('rejects oversize, stale or future quote, price drift, disagreement and live mode', () => {
  const b = make(); const t = ticket(b);
  assert.equal(desk.gate(b, { ...t, size: 25.01 }, now).ok, false);
  assert.equal(desk.gate(b, t, now + 120001).ok, false);
  assert.equal(desk.gate(b, t, now - 1).ok, false);
  assert.equal(desk.gate(desk.setQuote(b, 100201, now), t, now).ok, false);
  assert.equal(desk.gate(b, ticket(b, { bear: 'disagree' }), now).ok, false);
  assert.equal(desk.gate(b, { ...t, mode: 'live' }, now).ok, false);
});

test('exposure and daily realized loss gate entries but allow closing', () => {
  const b = { ...make(), cost: 100, quantity: 0.001 };
  assert.equal(desk.gate(b, ticket(b), now).ok, false);
  const loss = { id: 'loss', action: 'FLAT', pnl: -50, time: new Date(now).toISOString() };
  const halted = { ...b, journal: [loss] };
  assert.match(desk.gate(halted, ticket(halted), now).reason, /loss limit/);
  const exit = desk.draft(halted, { action: 'FLAT', scout: 'agree', bear: 'agree' }, now, 'exit');
  assert.equal(desk.gate(halted, exit, now).ok, true);
});

test('invalid quotes, insufficient cash and closing without position are refused', () => {
  assert.throws(() => desk.setQuote(desk.createBook(), NaN, now));
  const b = { ...make(), cash: 2 };
  assert.match(desk.gate(b, ticket(b), now).reason, /cash/);
  const exit = desk.draft(b, { action: 'FLAT', scout: 'agree', bear: 'agree' }, now, 'exit');
  assert.equal(desk.gate(b, exit, now).ok, false);
});
