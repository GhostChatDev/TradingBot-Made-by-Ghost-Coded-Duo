# Ghost Invest trading terminal

`terminal.html` is a full paper-trading terminal in one file. Open it in any browser (or GitHub Pages). It needs no install, build step or server.

**Paper money only.** Stocks, ETFs and indices come from a built-in market simulator, not real quotes. Crypto (BTC, ETH, SOL) uses real Coinbase prices and history when the live feed can connect, and falls back to simulation when it can't. No broker or wallet is connected.

## Features

| Area | What it does |
|---|---|
| Dashboard | Total value, total return, day change, cash and buying power. Portfolio growth chart (1D, 1W, 1M, 3M, 6M, 1Y, ALL) with hover values. Summary ring, asset-allocation donut, top holdings, 12-month performance bars, recent transactions, market indices, NYSE open/close countdown, feed status |
| Trade | Candlestick chart (1-minute and daily) with SMA 20/50 and lines for your average cost and open orders. Market, limit and stop orders by quantity or dollars, 25%/50%/Max buttons, slippage and commission. Position panel, open orders with cancel, key stats (day range, 52-week range, RSI, volatility, YTD) |
| Portfolio | Every holding with average cost, price, day change, market value, unrealized P&L and weight. Sell-all button, CSV export |
| Watchlist | Add or remove symbols. Live sparkline, RSI and 52-week range bar. One-click trade or alert |
| Analytics | Time-weighted 1-year return, annualized return, volatility, Sharpe, Sortino, max drawdown, beta vs SPY, best and worst day, win rate. Portfolio-vs-SPY chart, drawdown chart, contribution by holding, and a rebalancer (set target %, see the buys and sells needed) |
| Trading bot | SMA-crossover or RSI-reversion bot with trade size, stop loss and take profit. Trades the paper account on every closed 1-minute candle and keeps an activity log. Backtester on daily history compares the strategy to buy & hold |
| Alerts | "Rises above" and "falls below" price alerts. In-app toast, notification bell and optional browser notifications |
| Transactions | Full log of buys, sells, dividends, deposits and withdrawals, with type and symbol filters and CSV export |
| Reports | Monthly statement (start and end value, deposits, dividends, trades, return), printable. JSON backup and restore |
| Settings | Display name, commission, slippage, live-crypto toggle, 24/7 simulation toggle, deposit and withdraw, reset to the demo portfolio or an empty $100k account |
| Everywhere | ⌘K / Ctrl+K / `/` search for symbols and pages. Saved in the browser (localStorage). Works on phone, iPad and desktop |

## Try a virtual deposit and a trade

1. Open `terminal.html` (add `?offline=1` for a fully simulated feed). The demo account starts with paper cash and holdings.
2. On **Dashboard**, enter an amount in **Fund your paper account** and press **Deposit virtual USDC**. Deposits are instant, appear in **Transactions**, and increase paper cash and total portfolio value. They are not investment returns.
3. Open **Trade**, choose a symbol and quantity, then place a market buy. Sell from the same ticket or **Portfolio**. Orders use the configured simulated slippage and commission.
4. Open **Trading bot**, choose SMA crossover or RSI reversion, set the trade size and risk limits, and start the bot. It evaluates completed one-minute candles and logs its decisions.
5. Reload the page: deposits, holdings and transaction history are saved in this browser. Use **Settings → Reset to empty $100k account** for a clean paper account.

Deposits must be greater than zero and at most $10,000,000 per transfer. They are bookkeeping entries in localStorage: **no USDC, wallet, bank card, exchange, broker or real payment is involved**. Live crypto prices, when available, do not make executions real.

Add `?offline=1` to the URL to turn off all network calls.

## Tests

```
npm install --no-save playwright && npx playwright install chromium
node tests/terminal.test.js
```

CI runs these checks on every push (`.github/workflows/web.yml`).
