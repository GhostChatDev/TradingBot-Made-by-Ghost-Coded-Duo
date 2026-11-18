// Browser checks for pumpbot.html. Run: node tests/pumpbot.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\//, '');
    if (name !== 'pumpbot.html') { res.writeHead(404).end(); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/pumpbot.html?offline=1`;
  const browser = await chromium.launch({headless: true});
  const errors = [];
  let passed = 0;
  const check = (ok, message) => { if (!ok) throw new Error('FAIL: ' + message); passed++; console.log('PASS:', message); };
  try {
    const page = await browser.newPage({viewport: {width: 1400, height: 900}});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.PumpBot);
    check(errors.length === 0, 'bot page starts without errors');
    check(await page.evaluate(() => document.body.textContent.includes('Paper trading only')), 'page says it is paper trading only');

    const r = await page.evaluate(() => {
      const P = PumpBot, out = {};
      // curve math: a round trip loses only the two fees
      const c = {vS: 30, vT: 1073000000}, tok = P.buyTokens(c, 1 * 0.9875);
      const c2 = {vS: c.vS + 0.9875, vT: c.vT - tok};
      out.roundTrip = P.sellSol(c2, tok) * 0.9875;
      out.startCap = c.vS / c.vT * 1e9;
      out.grad = P.GRAD_MC;

      // scripted engine with a fake clock
      let clock = 1e12;
      const cfg = P.cleanCfg(Object.assign({}, P.DEFAULTS, {watchSec: 5, maxAgeSec: 30, minBuyers: 3, minBuyVol: 1, minRatio: 1.5, minMomentum: 5, maxDevPct: 8, maxTopPct: 12, maxEarly: 3,
        latencyMs: 1000, size: 0.5, maxOpen: 2, maxExposure: 1, staleSec: 0, maxPerMin: 10, prio: 0}));
      const subs = [];
      const e = P.createEngine(cfg, {now: () => clock, sub: m => subs.push(m)});
      e.start();
      const K = 30 * 1073000000;
      const at = mc => { const vS = Math.sqrt(K * mc / 1e9); return {vSolInBondingCurve: vS, vTokensInBondingCurve: K / vS, marketCapSol: mc}; };
      const create = (mint, extra = {}) => e.ingest(Object.assign({txType: 'create', mint, name: mint, symbol: mint, traderPublicKey: 'dev_' + mint, initialBuy: 10e6, solAmount: 0.3}, at(28), extra));
      const trade = (mint, type, w, sol, tok, mc) => e.ingest(Object.assign({txType: type, mint, traderPublicKey: w, solAmount: sol, tokenAmount: tok}, at(mc)));
      const step = ms => { clock += ms; e.tick(clock); };

      // 1) dev bought too much -> instant reject
      create('BIGDEV', {initialBuy: 150e6});
      out.bigdev = e.tokens.get('BIGDEV').reason;
      // 2) bundle: many buys in the first 2 seconds
      create('BUNDLE');
      for (let i = 0; i < 5; i++) { clock += 200; trade('BUNDLE', 'buy', 'b' + i, 0.5, 5e6, 30 + i); }
      out.bundle = e.tokens.get('BUNDLE').reason;
      // 3) good launch -> buy -> TP1 -> breakeven stop
      clock += 3000;
      create('GOOD');
      out.subscribed = subs.includes('GOOD');
      step(2500);
      for (let i = 0; i < 4; i++) { clock += 400; trade('GOOD', 'buy', 'g' + i, 0.6, 6e6, 30 + i * 2); }
      out.watchingEarly = e.tokens.get('GOOD').status;
      step(3000);
      trade('GOOD', 'buy', 'g9', 0.2, 2e6, 38);
      out.afterSignal = e.tokens.get('GOOD').status;
      step(1100);
      out.positions = e.positions.length;
      const p = e.positions[0];
      out.entryMc = p && p.entryMc;
      out.balanceAfterBuy = e.balance;
      trade('GOOD', 'buy', 'g10', 1, 1e6, p.entryMc * 1.45);   // +45% -> TP1 at +40%
      step(1100);
      out.leftAfterTp1 = p.left / p.tokens0;
      out.tp1Sales = p.sales.map(s => s.reason).join(',');
      trade('GOOD', 'sell', 'g1', 1, 1e6, p.entryMc * 0.99);   // back under entry -> breakeven stop
      step(1100);
      out.closedReason = e.closed[0] && e.closed[0].reason;
      out.closedPath = e.closed[0] && e.closed[0].path;
      out.openAfter = e.positions.length;

      // 4) stop loss and dev-sell exits
      const run = (mint, finish) => {
        clock += 60000; create(mint); step(1000);
        for (let i = 0; i < 4; i++) { clock += 400; trade(mint, 'buy', mint + i, 0.6, 6e6, 30 + i * 2); }
        step(5000); trade(mint, 'buy', mint + 'x', 0.2, 2e6, 38); step(1100);
        const pos = e.positions.find(x => x.mint === mint);
        finish(pos); step(1100);
        return e.closed[0];
      };
      out.sl = run('LOSER', pos => trade('LOSER', 'sell', 'LOSER1', 1, 1e6, pos.entryMc * 0.7)).reason;
      out.dev = run('RUGGED', () => trade('RUGGED', 'sell', 'dev_RUGGED', 3, 10e6, 36)).reason;
      out.slLoss = e.closed.find(x => x.reason === 'stop loss').pnl;

      // 5) risk: max exposure 1 SOL with 0.5 per trade -> third concurrent entry is refused
      const e2 = P.createEngine(Object.assign({}, cfg, {maxOpen: 5}), {now: () => clock}); e2.start();
      for (const m of ['R1', 'R2', 'R3']) e2.ingest(Object.assign({txType: 'create', mint: m, name: m, symbol: m, traderPublicKey: 'd' + m, initialBuy: 1e6, solAmount: 0.1}, at(28)));
      out.risk = ['R1', 'R2', 'R3'].map(m => e2.buyNow(m));

      // 6) daily loss limit stops the bot
      const e3 = P.createEngine(Object.assign({}, cfg, {dailyLoss: 0.05}), {now: () => clock}); e3.start();
      e3.ingest(Object.assign({txType: 'create', mint: 'D1', name: 'D1', symbol: 'D1', traderPublicKey: 'dd', initialBuy: 1e6, solAmount: 0.1}, at(40)));
      e3.buyNow('D1'); clock += 1100; e3.tick(clock);
      e3.ingest(Object.assign({txType: 'sell', mint: 'D1', traderPublicKey: 'x', solAmount: 1, tokenAmount: 1e6}, at(20))); clock += 1100; e3.tick(clock);
      out.dailyStopped = !e3.running && /Daily loss/.test(e3.stopReason);

      // 7) backtest on simulated launches is deterministic and finite
      const a = P.runBacktest(P.simEvents(20, 3), P.App.cfg), b = P.runBacktest(P.simEvents(20, 3), P.App.cfg);
      const sa = P.summary(a, 5), sb = P.summary(b, 5);
      out.bt = sa.trades === sb.trades && Math.abs(sa.pnl - sb.pnl) < 1e-12 && Number.isFinite(sa.pnl) && a.stats.seen > 50;
      out.btOpen = a.positions.length;
      return out;
    });
    check(r.roundTrip < 1 && r.roundTrip > 0.97, 'curve round trip loses only the fees (' + r.roundTrip.toFixed(4) + ' SOL back from 1)');
    check(Math.abs(r.startCap - 27.96) < 0.1, 'new coin starts near 28 SOL cap');
    check(r.grad > 400 && r.grad < 420, 'graduation cap is about 411 SOL');
    check(/dev buy too big/.test(r.bigdev), 'big dev buy is rejected');
    check(/bundle/.test(r.bundle), 'early bundle is rejected');
    check(r.subscribed, 'bot subscribes to trades of new launches');
    check(r.watchingEarly === 'watching', 'bot waits for the watch window');
    check(r.afterSignal === 'entering', 'good launch triggers a buy signal');
    check(r.positions === 1 && Math.abs(r.balanceAfterBuy - 4.5) < 1e-9, 'buy fills after latency and debits the size');
    check(Math.abs(r.leftAfterTp1 - 0.5) < 1e-9 && r.tp1Sales === 'TP1', 'TP1 sells half the bag');
    check(r.closedReason === 'breakeven stop' && r.closedPath === 'TP1 → breakeven stop' && r.openAfter === 0, 'stop moves to entry after TP1');
    check(r.sl === 'stop loss' && r.slLoss < 0, 'stop loss exits a loser');
    check(r.dev === 'dev sold', 'bot exits when the dev sells');
    check(r.risk[0] === null && r.risk[1] === null && r.risk[2] === 'max exposure', 'risk manager caps total exposure');
    check(r.dailyStopped, 'daily loss limit stops the bot');
    check(r.bt && r.btOpen === 0, 'backtest is deterministic and closes all positions');

    // UI: simulated feed + bot
    await page.selectOption('#src', 'sim');
    await page.click('#botBtn');
    await page.waitForFunction(() => PumpBot.App.eng.stats.seen >= 2, null, {timeout: 20000});
    await page.waitForFunction(() => document.querySelectorAll('#scanBody tr').length >= 2, null, {timeout: 5000});
    check(await page.locator('#scanBody tr').count() >= 2, 'scanner lists launches from the simulated feed');
    check((await page.textContent('#botText')) === 'Bot running', 'bot shows as running');
    await page.click('[data-tab=strategy]');
    await page.click('[data-preset=conservative]');
    check(await page.evaluate(() => PumpBot.App.cfg.size === 0.1 && PumpBot.App.eng.cfg.size === 0.1), 'preset changes the live bot settings');
    check((await page.textContent('#playbook')).includes('TP1 at +30%'), 'playbook shows the take-profit ladder');
    await page.fill('input[name=tp1]', '50'); await page.fill('input[name=tp2]', '40');
    await page.click('#cfgForm button[type=submit]');
    check(/higher than take profit 1/.test(await page.textContent('#cfgMsg')), 'invalid settings are refused');
    await page.click('[data-tab=backtest]');
    await page.fill('#btMin', '10');
    await page.click('#btSim');
    await page.waitForFunction(() => /launches/.test(document.getElementById('btSub').textContent), null, {timeout: 20000});
    check(true, 'backtest runs from the page');
    await page.click('[data-tab=journal]');
    check(await page.isVisible('#jStats'), 'journal opens');
    await page.evaluate(() => { PumpBot.App.eng.stop('test'); window.dispatchEvent(new Event('beforeunload')); });
    await page.reload(); await page.waitForFunction(() => window.PumpBot);
    check(await page.evaluate(() => PumpBot.App.cfg.size === 0.1 && PumpBot.App.src === 'sim'), 'settings survive a reload');

    const mob = await browser.newPage({viewport: {width: 375, height: 800}});
    mob.on('pageerror', e => errors.push(e.message));
    await mob.goto(url); await mob.waitForFunction(() => window.PumpBot);
    for (const tab of ['live', 'strategy', 'journal', 'backtest']) {
      await mob.click(`[data-tab=${tab}]`);
      check(await mob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile ${tab} tab does not scroll sideways`);
    }
    check(errors.length === 0, 'no uncaught errors: ' + errors.join(' | '));
    console.log(`ALL ${passed} PUMP BOT CHECKS PASSED`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e.message || e); process.exitCode = 1; });
