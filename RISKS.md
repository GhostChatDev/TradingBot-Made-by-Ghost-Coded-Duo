# Risks — read this before you turn anything on

> **General information and software, not financial advice. You can lose everything you put in.**

This app is an experiment. It has never traded real money in this build. Paper results and
devnet results are not predictions of anything.

## What can go wrong with money

- **You can lose all of the money you put in.** Trading bots lose money regularly, and a bot
  keeps doing what it is told while the market does something else.
- **Paper and past results do not predict real ones.** Paper fills are simulated at the price
  the bot saw; the real order may fill worse or not at all.
- **Fees and slippage** take a bite out of every round trip. A strategy can look fine in paper
  and lose money once real costs are counted.
- **Outages and bugs.** The server can crash, the price feed can stall, the RPC can rate-limit
  you, a transaction can be dropped, retried or land twice. The bot may be wrong at the worst
  moment and nobody is watching.
- **Scam tokens.** Rug pulls, honeypot tokens you cannot sell, and fake markets exist in large
  numbers. Choosing a bad market loses the money without any bug in this app.
- **Keys can be stolen.** If you ever put a private key or seed phrase on a server, that server
  can be broken into and the wallet emptied. This app therefore never asks for one: your wallet
  signs in the browser, and the server only ever sees a public address.
- **Taxes and rules.** Trading may be taxed, or restricted, where you live. That is your
  responsibility, not this software's.

## What this build guarantees by design

- **Non-custodial.** No deposit address, no pooled wallet, no signing key on the server.
  Trades are signed by your own wallet (Phantom / Solflare).
- **Paper by default.** The first mode is paper: a fake balance and real prices.
- **Devnet next.** Free test SOL, no real value.
- **Mainnet off.** Real-funds trading needs `MAINNET_ENABLED=true` in the server environment
  **and** the switch inside the app. It ships off and stays off until you turn it on yourself.
- **Caps cannot be removed.** Per-trade size, daily loss and the STOP button are enforced on the
  server before every proposal. You can lower the caps, not delete them.
- **Everything is logged.** Time, mode, side, size, price, fee and the reason, for every decision.

## Turning real trading on later (you, not the app)

1. Read this file again, and get legal advice for your country.
2. Server environment: set `TRADING_MODE=devnet` first and prove the flow end to end.
3. Only then set `MAINNET_ENABLED=true` and pick mainnet in the app's mode switch.
4. Start with the smallest cap the app allows. Keep the STOP button in reach.

Real payments for credits are also off. `PAYMENTS_MODE=test` gives fake-money top-ups. Credits
are an internal balance for API calls — never crypto held for you.

## Risks specific to the pump.fun paper run

- **The pump.fun run is paper only.** It never builds or sends a transaction. Its prices are a
  simulated feed, so its results say nothing about what real trading would do.
- **A paper result is not a prediction.** A rule set that looks fine on a simulated feed can lose
  everything on a real market.
- **pump.fun coins are extremely risky.** Most new coins lose almost all their value quickly, and
  many are outright scams (rug pulls, honeypot tokens you cannot sell). Fees and slippage on every
  round trip eat any small edge before it is a profit.
- **Drafts are data, not orders.** A trade draft returns to your browser as JSON. Nothing is
  posted to a third party, and no address or key is collected to make the bot work.
