# Ghost Pump Bot (paper auto-trader for pump.fun)

`pumpbot.html` watches every new pump.fun launch, decides whether to buy with a fixed set of rules, and manages each position with a take-profit ladder and stop rules. **It trades paper SOL only.** No wallet is connected and nothing is sent on-chain.

Live site (after GitHub Pages is on): `https://ghostchatdev.github.io/TradingBot-Made-by-Ghost-Coded-Duo/pumpbot.html`

## How it trades

1. **Scan.** Subscribes to new launches on the PumpPortal WebSocket and to the trades of each launch it is watching.
2. **Instant rejects.** Dev bought too much supply, one wallet too big, too many buys in the first 2 seconds (bundle/snipers), dev already sold, cap too high, already pumped, blocked words.
3. **Buy signal**, after the watch window: enough unique buyers, enough SOL bought, buy/sell ratio, rise since launch within a range, cap within a range.
4. **Risk gate.** Size per trade, max open trades, max SOL in play, new trades per minute, loss-streak pause, daily loss limit (stops the bot).
5. **Fill model.** Latency, then a constant-product bonding-curve fill with the 1.25% fee and priority fee. The buy is cancelled if the price ran past the slippage cap.
6. **Take profit and exits.** Stop loss, then TP1 (sell part, move stop to entry), then TP2 (sell more), then a trailing stop on the runner. Safety exits: dev sells, max hold time, no trades, just before graduation.

Every number is editable on the **Strategy** tab, with Conservative, Balanced and Aggressive presets. The playbook text updates as you change them.

## Tools inside

| Tool | Status |
|---|---|
| PumpPortal live feed (launches and trades) | built |
| Bonding-curve math (x·y=k) for fills and price impact | built |
| Dev-wallet, unique-buyer, bundle and concentration tracking | built |
| Filter and score engine | built |
| Risk manager | built |
| Exit manager (stop, TP ladder, breakeven, trailing, time, dev-sell, pre-graduation) | built |
| Paper executor with fees, latency, slippage cap | built |
| Journal with exits-by-reason and filter funnel, CSV export | built |
| Feed recorder and replay backtester | built |
| Simulated launch generator for testing (rugs, hidden-wallet rugs, duds, bundles, fake volume, rare runners) | built |
| Wallet / private key, RPC node, transaction sending, Jito tips, 24/7 server | **not built**: needed for real money |

## Honest limits

- The simulator's mix of coins is invented. Use it to check that the rules behave, not to predict profit. On the simulator, Balanced ranges from about −12% to +10% per hour across seeds, and Aggressive mostly loses.
- Paper fills don't move the real curve, and real bots compete with faster snipers. Live results will usually be worse than paper.
- Read the research in README.md before trusting any result.

## Tests

`node tests/pumpbot.test.js` runs 31 browser checks: curve math, each filter, TP1 → breakeven, stop loss, dev-sell exit, exposure cap, daily loss stop, backtest determinism, UI, and mobile layout. CI runs it on every push.
