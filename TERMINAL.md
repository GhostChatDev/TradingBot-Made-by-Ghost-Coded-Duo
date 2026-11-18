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

Add `?offline=1` to the URL to turn off all network calls.

## Tests

```
npm install --no-save playwright && npx playwright install chromium
node tests/terminal.test.js
```

CI runs these checks on every push (`.github/workflows/web.yml`).
