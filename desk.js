/* Local paper state and an optional, read-only external wallet connection. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const storageKey = 'ghost-desk-paper-v1';
  const D = window.GhostDesk;
  const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  let book;
  let storageError = false;
  try {
    const saved = localStorage.getItem(storageKey);
    book = saved ? JSON.parse(saved) : D.createBook();
    if (!book || book.version !== 1 || !Number.isFinite(book.cash) || !Number.isFinite(book.quantity) || !Number.isFinite(book.cost) || !Array.isArray(book.journal)) throw new Error('Invalid paper data');
  } catch (_) {
    book = D.createBook();
    storageError = true;
  }
  function save(next) {
    if (storageError) throw new Error('Paper data could not be read. No changes will be saved; check browser storage.');
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch (_) { throw new Error('Could not save paper data. Check browser storage and try again.'); }
    book = next;
  }
  function render() {
    const value = book.quantity * (book.quote?.price || 0);
    $('cash').textContent = usd(book.cash);
    $('position').textContent = book.quote ? usd(value) : '—';
    $('quantity').textContent = book.quantity ? `${book.quantity.toFixed(8)} BTC` : 'No BTC held';
    $('equity').textContent = book.quote || !book.quantity ? usd(book.cash + value) : '—';
    $('pnl').textContent = usd(book.journal.reduce((s, trade) => s + (Number(trade.pnl) || 0), 0));
    $('trade-count').textContent = `${book.journal.length} FILLS`;
    $('quote-status').textContent = storageError ? 'Unable to read local paper data. Changes are disabled.' : book.quote ? `Manual quote: ${usd(book.quote.price)} · ${new Date(book.quote.at).toLocaleString()}. Expires after 120 seconds.` : 'No quote yet. The example is not a live price.';
    $('journal').replaceChildren();
    if (!book.journal.length) {
      const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No paper fills yet. Your confirmed fills will appear here.'; $('journal').append(p);
    } else book.journal.forEach((trade) => {
      const item = document.createElement('div'); item.className = 'journal-item';
      const title = document.createElement('strong'); title.textContent = trade.action === 'LONG' ? 'Paper long' : 'Position closed';
      const detail = document.createElement('span'); detail.textContent = `${usd(trade.amount)} at ${usd(trade.price)} · ${new Date(trade.time).toLocaleString()}${trade.action === 'FLAT' ? ` · P&L ${usd(trade.pnl)}` : ''}`;
      item.append(title, detail); $('journal').append(item);
    });
    const verdict = book.draft && D.gate(book, book.draft);
    $('gate').textContent = book.draft ? `${book.draft.action} · ${verdict.ok ? 'ACCEPT' : 'REJECT'}: ${verdict.reason}` : 'No ticket yet. Set a quote and create a ticket.';
    $('fill').disabled = storageError || !verdict?.ok;
  }
  $('quote-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try { save(D.setQuote(book, Number($('quote-price').value))); render(); }
    catch (err) { $('quote-status').textContent = err.message; }
  });
  $('bot-suggest').addEventListener('click', () => {
    const suggestion = D.signal(book);
    $('bot-signal').textContent = `${suggestion.action} · ${suggestion.reason}`;
    if (suggestion.action !== 'WATCH') {
      $('action').value = suggestion.action;
      $('size').disabled = suggestion.action === 'FLAT';
    }
  });
  $('ticket-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const ticket = D.draft(book, { action: $('action').value, size: Number($('size').value), scout: $('scout').value, bear: $('bear').value });
      save({ ...book, draft: ticket }); render();
    } catch (err) { $('gate').textContent = err.message; }
  });
  $('fill').addEventListener('click', () => {
    const verdict = D.gate(book, book.draft);
    if (!verdict.ok) { render(); return; }
    if (!window.confirm('Confirm this simulated paper fill? No real order will be placed.')) return;
    try { save(D.fill(book, book.draft)); render(); $('gate').textContent = 'Paper fill recorded locally. No real order was placed.'; }
    catch (err) { $('gate').textContent = err.message; render(); }
  });
  $('action').addEventListener('change', () => {
    $('size').disabled = $('action').value === 'FLAT';
  });
  // Re-evaluate stale tickets without requiring another user action.
  setInterval(() => { if (book.draft) render(); }, 5000);

  let address = null;
  let connected = false;
  const provider = window.ethereum;
  function forget(message = 'Wallet forgotten by this page. Disconnect it in your wallet too.') {
    connected = false; address = null;
    $('wallet-status').textContent = message;
    $('wallet-network').textContent = ''; $('wallet-address').textContent = ''; $('wallet-balance').textContent = '';
    $('copy').disabled = true; $('disconnect').disabled = true;
  }
  async function refreshWallet() {
    if (!provider || !connected) return;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (!Array.isArray(accounts) || !/^0x[a-fA-F0-9]{40}$/.test(accounts[0] || '')) { forget('No wallet account available.'); return; }
      const chain = await provider.request({ method: 'eth_chainId' });
      if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain)) throw new Error('Invalid chain');
      const balance = await provider.request({ method: 'eth_getBalance', params: [accounts[0], 'latest'] });
      if (typeof balance !== 'string' || !/^0x[0-9a-f]+$/i.test(balance)) throw new Error('Invalid balance');
      if (!connected) return;
      address = accounts[0];
      const wei = BigInt(balance), base = 10n ** 18n;
      const fraction = (wei % base).toString().padStart(18, '0').slice(0, 6);
      $('wallet-status').textContent = 'External wallet connected. Verify receiving details in your wallet.';
      $('wallet-network').textContent = `EVM chain ID: ${BigInt(chain).toString()}. Send only assets supported by this wallet and network.`;
      $('wallet-address').textContent = address;
      $('wallet-balance').textContent = `Native balance: ${wei / base}.${fraction} (18-decimal units, truncated). Check your wallet for the exact amount.`;
      $('copy').disabled = false; $('disconnect').disabled = false;
    } catch (_) { forget('Could not read wallet details. Check the wallet and try again.'); }
  }
  $('connect').addEventListener('click', async () => {
    if (!provider?.request) { $('wallet-status').textContent = 'No EVM wallet detected. Install a compatible wallet and reload this page.'; return; }
    $('wallet-status').textContent = 'Waiting for your wallet…';
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !accounts.length) throw new Error('No account');
      connected = true; await refreshWallet();
    } catch (_) { forget('Wallet connection cancelled or unavailable.'); }
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(address); $('wallet-status').textContent = 'Address copied. Verify it and the network in your wallet before sending.'; }
    catch (_) { $('wallet-status').textContent = 'Copy unavailable. Select the address manually and verify it in your wallet.'; }
  });
  $('disconnect').addEventListener('click', () => forget());
  provider?.on?.('accountsChanged', () => { if (connected) refreshWallet(); });
  provider?.on?.('chainChanged', () => { if (connected) refreshWallet(); });
  provider?.on?.('disconnect', () => forget('Wallet provider disconnected.'));
  render();
})();
