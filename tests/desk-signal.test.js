const test = require('node:test');
const assert = require('node:assert/strict');
const desk = require('../desk-engine.js');
const now = Date.parse('2026-01-02T12:00:00Z');

test('bot signal requires two fresh manually entered quotes', () => {
  let book = desk.setQuote(desk.createBook(), 100, now);
  assert.equal(desk.signal(book, now).action, 'WATCH');
  book = desk.setQuote(book, 101, now + 1);
  assert.equal(desk.signal(book, now + 1).action, 'LONG');
  assert.equal(desk.signal(book, now + 120001).action, 'WATCH');
  assert.equal(desk.signal(book, now).action, 'WATCH');
});

test('decline proposes close only for an existing paper position', () => {
  let book = desk.setQuote(desk.createBook(), 100, now);
  book = desk.setQuote(book, 99, now + 1);
  assert.equal(desk.signal(book, now + 1).action, 'WATCH');
  assert.equal(desk.signal({ ...book, quantity: 0.1 }, now + 1).action, 'FLAT');
});
