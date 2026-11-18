// Browser checks for terminal.html. Run: node tests/terminal.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\//, '');
    if (!['terminal.html', 'index.html'].includes(name)) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/terminal.html?offline=1`;
  const browser = await chromium.launch({headless: true});
  const errors = [];
  let passed = 0;
  const check = (ok, message) => { if (!ok) throw new Error('FAIL: ' + message); passed++; console.log('PASS:', message); };
  try {
    const page = await browser.newPage({viewport: {width: 1400, height: 900}});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.GhostInvest && document.getElementById('kValue').textContent !== '--');
    check(errors.length === 0, 'terminal starts without errors');
    check(await page.evaluate(() => GhostInvest.state.txs.length > 20), 'demo portfolio is loaded');
    check(await page.evaluate(() => { const T = GhostInvest.totals(); return Math.abs(T.value - (GhostInvest.state.cash + T.mv)) < 1e-6 && T.value > 0; }), 'portfolio value = cash + market value');

    for (const v of ['dashboard', 'portfolio', 'trade', 'watchlist', 'analytics', 'bot', 'reports', 'transactions', 'alerts', 'settings']) {
      await page.evaluate(v => GhostInvest.go(v), v);
      check(await page.isVisible('#v-' + v), `view "${v}" opens`);
    }
    check(errors.length === 0, 'every view renders without errors');

    // engine checks on a clean $100k account
    const r = await page.evaluate(() => {
      const G = GhostInvest, out = {};
      G.state.txs = []; G.state.holdings = {}; G.state.orders = []; G.state.alerts = []; G.state.cash = 0;
      G.state.settings.commission = 1; G.state.settings.slip = 0;
      G.cashFlow('Deposit', 100000, Date.now(), 'test');
      const a = G.A.AAPL;
      G.setPrice(a, 200, Date.now());
      const buy = G.execTrade({sym: 'AAPL', side: 'buy', qty: 10, price: a.price});
      out.cashAfterBuy = G.state.cash;
      out.cost = G.state.holdings.AAPL.cost;
      try { G.execTrade({sym: 'AAPL', side: 'buy', qty: 1e6, price: 200}); out.overBuy = 'allowed'; } catch (e) { out.overBuy = e.message; }
      try { G.execTrade({sym: 'AAPL', side: 'sell', qty: 11, price: 200}); out.overSell = 'allowed'; } catch (e) { out.overSell = e.message; }
      G.setPrice(a, 250, Date.now());
      const sell = G.execTrade({sym: 'AAPL', side: 'sell', qty: 5, price: a.price});
      out.pnl = sell.pnl;
      // limit buy fills only when price falls to the limit
      G.placeOrder({sym: 'AAPL', side: 'buy', type: 'limit', qty: 2, price: 240});
      G.checkOrders(a); out.openAfterNoHit = G.state.orders.length;
      G.setPrice(a, 239, Date.now()); G.checkOrders(a); out.openAfterHit = G.state.orders.length;
      out.qty = G.state.holdings.AAPL.qty;
      // stop sell
      G.placeOrder({sym: 'AAPL', side: 'sell', type: 'stop', qty: 7, price: 230});
      try { G.execTrade({sym: 'AAPL', side: 'sell', qty: 1, price: 239}); out.reservedSell = 'allowed'; } catch (e) { out.reservedSell = e.message; }
      G.setPrice(a, 229, Date.now()); G.checkOrders(a); out.qtyAfterStop = G.state.holdings.AAPL ? G.state.holdings.AAPL.qty : 0;
      // alerts
      G.state.alerts.push({id: 999, sym: 'AAPL', op: 'above', price: 300, t: Date.now(), done: 0});
      G.checkAlerts(a); out.alertEarly = G.state.alerts[0].done;
      G.setPrice(a, 301, Date.now()); G.checkAlerts(a); out.alertFired = !!G.state.alerts[0].done;
      // withdrawals cannot exceed cash
      try { G.cashFlow('Withdrawal', 1e9); out.overWithdraw = 'allowed'; } catch (e) { out.overWithdraw = e.message; }
      // indicators and backtest
      out.rsiUp = G.rsi(Array.from({length: 30}, (_, i) => 100 + i));
      out.sma = G.sma([1, 2, 3, 4], 2);
      const bt = G.backtest(Object.assign({}, G.state.bot, {strategy: 'sma', fast: 5, slow: 20}), G.A.SPY.daily);
      out.bt = bt.eq.length === G.A.SPY.daily.length && Number.isFinite(bt.ret) && Number.isFinite(bt.bhRet);
      const m = G.metrics(365); out.metrics = [m.vol, m.sharpe, m.mdd].every(Number.isFinite) && m.mdd <= 0;
      out.nyse = typeof G.nyClock().open === 'boolean' && G.nyClock().secs > 0;
      G.render();
      return out;
    });
    check(Math.abs(r.cashAfterBuy - (100000 - 2001)) < 1e-6, 'market buy debits cost plus $1 commission');
    check(Math.abs(r.cost - 2001) < 1e-6, 'cost basis includes commission');
    check(/buying power/i.test(r.overBuy), 'buying more than cash is rejected');
    check(/sell at most/i.test(r.overSell), 'selling more than you hold is rejected');
    check(Math.abs(r.pnl - (5 * 250 - 1 - 5 * 200.1)) < 1e-6, 'realized P&L uses average cost and fees');
    check(r.openAfterNoHit === 1 && r.openAfterHit === 0 && Math.abs(r.qty - 7) < 1e-9, 'limit buy waits, then fills at the limit');
    check(/sell at most/i.test(r.reservedSell), 'shares reserved by an open sell order cannot be sold twice');
    check(r.qtyAfterStop === 0, 'stop sell fills when price drops through the stop');
    check(!r.alertEarly && r.alertFired, 'price alert fires only when crossed');
    check(/only have/i.test(r.overWithdraw), 'withdrawals cannot exceed cash');
    check(r.rsiUp === 100 && r.sma === 3.5, 'RSI and SMA are correct');
    check(r.bt, 'backtest runs over the full history');
    check(r.metrics, 'risk metrics are finite');
    check(r.nyse, 'NYSE clock works');

    // UI order ticket
    await page.evaluate(() => GhostInvest.go('trade'));
    await page.fill('#trSym', 'MSFT'); await page.dispatchEvent('#trSym', 'change');
    await page.fill('#oQty', '3');
    await page.click('#oSubmit');
    check(/Filled: Buy 3 MSFT/.test(await page.textContent('#oMsg')), 'order ticket places a market buy');
    await page.selectOption('#oType', 'limit');
    check(await page.isVisible('#oPrice'), 'limit order shows the price field');
    await page.selectOption('#oType', 'market');
    check(!(await page.isVisible('#oPrice')), 'market order hides the price field');

    // persistence
    await page.evaluate(() => { GhostInvest.state.name = 'Tester'; window.dispatchEvent(new Event('beforeunload')); });
    await page.reload();
    await page.waitForFunction(() => window.GhostInvest && GhostInvest.state);
    check(await page.evaluate(() => GhostInvest.state.name === 'Tester' && GhostInvest.state.holdings.MSFT && GhostInvest.state.holdings.MSFT.qty === 3), 'account survives a reload');

    // command palette
    await page.keyboard.press('Control+k');
    check(await page.isVisible('#palette'), 'Ctrl+K opens search');
    await page.fill('#palInput', 'nvda'); await page.keyboard.press('Enter');
    check(await page.inputValue('#trSym') === 'NVDA' && await page.isVisible('#v-trade'), 'search opens a symbol in Trade');

    // mobile
    const mob = await browser.newPage({viewport: {width: 375, height: 800}});
    mob.on('pageerror', e => errors.push(e.message));
    await mob.goto(url);
    await mob.waitForFunction(() => window.GhostInvest);
    for (const v of ['dashboard', 'trade', 'analytics']) {
      await mob.evaluate(v => GhostInvest.go(v), v);
      check(await mob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile ${v} does not scroll sideways`);
    }
    await mob.click('#menuBtn');
    check(await mob.evaluate(() => document.getElementById('side').classList.contains('open')), 'mobile menu opens');
    check(errors.length === 0, 'no uncaught errors: ' + errors.join(' | '));
    console.log(`ALL ${passed} TERMINAL CHECKS PASSED`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e.message || e); process.exitCode = 1; });
