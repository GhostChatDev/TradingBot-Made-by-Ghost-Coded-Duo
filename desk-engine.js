/* Paper accounting only. No network, signing or exchange APIs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GhostDesk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const limits = Object.freeze({ ticket: 25, exposure: 100, dailyLoss: 50, quoteAge: 120000, drift: 0.002 });
  const money = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const validPrice = (x) => Number.isFinite(x) && x > 0 && x <= 100000000;
  function createBook() {
    return { version: 1, cash: 1000, quantity: 0, cost: 0, journal: [], quote: null, draft: null };
  }
  function setQuote(book, price, now = Date.now()) {
    if (!validPrice(price) || !Number.isFinite(now)) throw new Error('Enter a valid positive simulated BTC price.');
    return { ...book, previousQuote: book.quote, quote: { price, at: now } };
  }
  // A transparent demonstration signal from two manually entered prices, not market research.
  function signal(book, now = Date.now()) {
    const previous = book.previousQuote, current = book.quote;
    const fresh = (q) => q && validPrice(q.price) && Number.isFinite(q.at) && Number.isFinite(now) && q.at <= now && now - q.at <= limits.quoteAge;
    if (!fresh(previous) || !fresh(current) || previous.at > current.at) return { action: 'WATCH', reason: 'Enter two fresh simulated quotes within 120 seconds to generate a signal.' };
    const change = (current.price / previous.price - 1) * 100;
    if (change >= 0.5) return { action: 'LONG', reason: `Price rose ${change.toFixed(2)}% from the previous manual quote.` };
    if (change <= -0.5 && book.quantity > 0) return { action: 'FLAT', reason: `Price fell ${Math.abs(change).toFixed(2)}% from the previous manual quote.` };
    return { action: 'WATCH', reason: `Price changed ${change.toFixed(2)}%; no entry or close signal.` };
  }
  function draft(book, input, now = Date.now(), id = globalThis.crypto?.randomUUID?.()) {
    if (!book.quote) throw new Error('Set a simulated quote first.');
    if (!id || !['LONG', 'FLAT'].includes(input.action)) throw new Error('Invalid draft.');
    const agreed = input.scout === 'agree' && input.bear === 'agree';
    return { id, mode: 'paper', symbol: 'BTC-USD', action: agreed ? input.action : 'WATCH', size: Number(input.size), price: book.quote.price, quoteAt: book.quote.at, createdAt: now, scout: input.scout, bear: input.bear };
  }
  function gate(book, ticket, now = Date.now()) {
    const reject = (reason) => ({ ok: false, reason });
    if (!ticket || ticket.mode !== 'paper' || ticket.symbol !== 'BTC-USD') return reject('Only paper BTC-USD tickets are allowed.');
    if (!['LONG', 'FLAT'].includes(ticket.action)) return reject('Analysts disagree: watch only.');
    if (ticket.scout !== 'agree' || ticket.bear !== 'agree') return reject('Both analyst checks must agree.');
    if (typeof ticket.id !== 'string' || !ticket.id || book.journal.some((t) => t.id === ticket.id)) return reject('Ticket missing or already filled.');
    const q = book.quote;
    if (!q || !validPrice(q.price) || !validPrice(ticket.price) || !Number.isFinite(q.at) || !Number.isFinite(ticket.quoteAt) || !Number.isFinite(now) || now < q.at || now < ticket.quoteAt || now - q.at > limits.quoteAge || now - ticket.quoteAt > limits.quoteAge) return reject('Quote is missing, invalid or older than 120 seconds.');
    if (Math.abs(ticket.price / q.price - 1) > limits.drift) return reject('Price moved more than 0.2% since the draft.');
    if (ticket.action === 'LONG') {
      const today = new Date(now).toISOString().slice(0, 10);
      const pnl = book.journal.filter((t) => t.action === 'FLAT' && t.time.slice(0, 10) === today).reduce((sum, t) => sum + t.pnl, 0);
      if (pnl <= -limits.dailyLoss) return reject('Daily realized loss limit reached; new entries halted.');
      if (!Number.isFinite(ticket.size) || ticket.size <= 0 || ticket.size > limits.ticket || money(ticket.size) !== ticket.size) return reject('Entry size must be $0.01–$25 in cents.');
      if (money(book.cost + ticket.size) > limits.exposure) return reject('Open paper exposure would exceed $100.');
      if (ticket.size > book.cash) return reject('Insufficient paper cash.');
    } else if (book.quantity <= 0) return reject('There is no paper position to close.');
    return { ok: true, reason: 'Paper gate accepted. A person must confirm the fill.' };
  }
  function fill(book, ticket, now = Date.now()) {
    const verdict = gate(book, ticket, now);
    if (!verdict.ok) throw new Error(verdict.reason);
    const price = book.quote.price;
    let cash = book.cash, quantity = book.quantity, cost = book.cost, pnl = 0, amount;
    if (ticket.action === 'LONG') {
      amount = ticket.size;
      cash = money(cash - amount); quantity += amount / price; cost = money(cost + amount);
    } else {
      amount = money(quantity * price); pnl = money(amount - cost);
      cash = money(cash + amount); quantity = 0; cost = 0;
    }
    const trade = { id: ticket.id, action: ticket.action, amount, price, pnl, time: new Date(now).toISOString() };
    return { ...book, cash, quantity, cost, draft: null, journal: [trade, ...book.journal] };
  }
  return { limits, createBook, setQuote, signal, draft, gate, fill };
});
