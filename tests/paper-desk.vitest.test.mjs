import { describe, it, expect } from 'vitest';
import desk from '../desk-engine.js';

describe('paper desk risk gates', () => {
  it('rejects live mode even with an otherwise valid quote', () => {
    const now = Date.now();
    const book = desk.setQuote(desk.createBook(), 100000, now);
    const ticket = desk.draft(book, { action: 'LONG', size: 25, scout: 'agree', bear: 'agree' }, now, 'test-ticket');
    expect(desk.gate(book, { ...ticket, mode: 'live' }, now).ok).toBe(false);
  });
});
