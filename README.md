> **New:** [`pumpbot.html`](pumpbot.html) is a pump.fun paper auto-trading bot (launch scanner, entry filters, take-profit ladder, risk limits, backtester). See [PUMPBOT.md](PUMPBOT.md).
>
> [`terminal.html`](terminal.html) is a full paper-trading terminal (portfolio dashboard, charts, orders, bot, alerts, analytics). See [TERMINAL.md](TERMINAL.md) for the feature list. The pump.fun launch terminal is still at [`index.html`](index.html).

A risk-first bot can be built. It should not be expected to make money. On the numbers that exist, almost every new pump.fun coin dies, the people who get paid are mostly the launchers, and a small bot’s edge has to clear a few percent of costs on every round trip before it is even at zero.

This is research, not a trading system and not financial, legal, or tax advice. Nothing below is a promise of profit.

## 1. How pump.fun works today

A coin is free to create. Supply is 1 billion tokens. Trading starts on a constant-product bonding curve seeded with virtual reserves (about 30 virtual SOL and about 1.073 billion virtual tokens), so the first buy is not infinitely expensive. Real SOL starts at zero. Price is `x / y` and rises with every buy [11].

Graduation is a SOL threshold, not a fixed dollar price. Academic and current explainers put it at about **85 SOL of real reserves**, with about **793.1 million tokens** sold off the curve. The leftover ~206.9 million tokens are reserved for the post-graduation pool. During the Sep–Oct 2025 sample that was roughly a $69,000 market cap; the dollar figure moves with SOL [11][51].

When the curve completes, trading on the curve stops. Real SOL (minus a **0.015 SOL** migration fee) and the reserved tokens are moved into a **PumpSwap** pool, and the LP tokens are burned. That migration is the current path. Older guides that say “graduates to Raydium and pays 6 SOL” describe the pre-March 2025 design [51]. USDC-paired curves have existed since 21 May 2026 and graduate on their own USDC threshold [51].

Fees, as of the 2026 write-ups that quote the current schedule (the official fee page itself blocked a full read):

- Bonding curve: **1.25% per trade**. One breakdown splits that as 0.30% to the creator and 0.95% to the protocol [4][21].
- Graduation: **0.015 SOL**, paid once, not by the buyer [4][51].
- PumpSwap: total fee starts around **1.25%** on a fresh graduate and steps down toward **0.30%** at very high market cap. The moving part is the creator’s cut (it can peak near 0.95% in an early tier, then fall toward 0.05%). Protocol and LP pieces stay roughly flat above the first tier [4][52][55].
- Since 17 October 2026, trades placed in the pump.fun web or mobile app also carry an extra platform fee on top of protocol, creator, and LP fees [3]. A bot that swaps the pool directly may not pay that app fee. Confirm on the live fee page before you code a cost model.

Price in the first minutes is mechanical, not “sentiment.” Early buyers sit at the bottom of the curve. Later buyers pay more for the same coin. In the Sep–Oct 2025 sample, time-to-graduation had a **median of 4.4 minutes**, with a tail of tens of minutes [8][11]. After graduation, selling is no longer penalized by the curve, so early holders often dump into new buyers. Guides describe a spike, then a pullback, with the first 10 minutes the most bot-heavy window. That pattern is widely described; it is not a measured average return [51].

Burned LP blocks one rug: nobody can withdraw the pool. It does not stop the creator, bundle wallets, or snipers from selling their coins into that pool [51].

## 2. What the data says

| Finding | Number | Sample | Source |
|---|---|---|---|
| Graduation rate | **0.63%** (4,338 of 655,770) | Sep–Oct 2025 | Marino et al., arXiv Feb 2026 [11] |
| Fast graduation only | **0.198%** within about 6 minutes (1,651 of 832,941). This is a **lower bound** on the true 24-hour rate, not the 24-hour rate | 8 May–10 Jun 2026 | Kamat, corrected Aug 2026 [8] |
| Still on a major DEX | Under **2%** of pump.fun tokens | Q4 2024 | cited in [8] |
| Block-0 buyer other than the dev | **38%** of launches | 8.2 million coins, 30 Oct 2025–7 Oct 2026 | Bitquery, figures checked 10 Oct 2026 [14] |
| Dev’s own wallets in the launch bundle | **21%**; median bundle took **10%** of supply | same | [14] |
| Dev’s first sale within 1 minute | **65%**; within a day, **90%** | same | [14] |
| Repeat launchers | Wallets behind 100+ first buys made **49%** of launches | same | [14] |
| Who got paid | Devs + bundles **≥ $579 million** on what they sold, through June 2026. Sniper bots **$31.5 million** on sales, **$15.2 million** if unsold coins are worth zero. 54% of sniper wallets were net ahead on that second measure | launches through 30 Jun 2026 | [14] |

A vendor guide claimed that of 18.67 million tokens to mid-2026, 68.7% had their last trade on launch day and 80.4% within 24 hours, with a 14-minute median life for tokens it flagged as rugs [9]. That page would not load, so treat those three figures as **unverified**.

The strongest academic statement on death speed is different and should not be mixed with the vendor numbers. Li et al. (Aug 2026) built a set of **6.4 million** Solana memecoins over 7 months (about 6.30 million on Pump.fun, Nov 2024–Jun 2025) and wrote that a vast majority showed rug-pull characteristics within one hour. Their “rug” is mostly a liquidity drop or the market going idle, not a classic LP withdrawal. They could forecast the 1-hour outcome from the first 5 minutes of trades [49].

Marino et al. also found that the same amount of SOL on the curve is not the same bet. Fast fills through few trades predicted graduation best. Heavy bot flow predicted worse graduation odds past the middle of the curve. Historically “smart” wallets had only a small, uneven effect, because those wallets also exit fast. Creators have a built-in reason to sell before or at graduation: that is when virtual demand turns into real SOL they can take [11].

**Weak evidence:** there is no clean, peer-reviewed “X% go to exactly zero in 24 hours” figure. Graduation is rare. A last trade is not the same as a rug. And Kamat’s 0.198% must not be quoted as the 24-hour graduation rate.

## 3. Red flags a bot can check

Checks with real evidence behind them:

- **Bundle / same-block cluster.** On 21% of launches the dev’s wallets bought in the launch block, median 10% of supply, and those groups were the ones who made the money [14]. A public Jito bundle record can confirm the package. A funding-graph link (dev paid the fee, or the wallet was funded by the dev) is stronger than “bought early.”
- **Dev sells immediately.** First dev sale inside 60 seconds on 65% of coins [14]. A bot that buys after that sale is the exit liquidity.
- **Repeat deployer.** Nearly half of launches came from wallets that had already paid for 100+ first buys [14]. A creator history of fast dumps is a usable filter. It will also reject some legitimate repeat launchers.
- **Bot-dominated flow.** In Marino et al., bot-heavy paths had lower graduation probability after the middle of the curve [11].
- **Holder concentration in the first minutes.** Li et al. and the MemeTrans dataset both treat concentration and early-trader clustering as risk features, and short-horizon models work without reading contract code [15][49]. I did not find a published cutoff like “top 10 over 40% means rug” that you should hard-code. Use it as a ranked feature, then measure the cutoff yourself.
- **Social presence, weakly.** In Kamat’s fast window, a Telegram link meant 1.485% graduation vs 0.166% without (about 9×). Twitter and a website were smaller lifts. Initial market cap above the 30 SOL default was the strongest single predictor in that model [8]. Socials are cheap to fake. Treat them as a prior, not a pass.

Checks that are weaker than people claim, specifically on pump.fun:

- **Mint and freeze authority.** Pump.fun coins share one program. Marino et al. treat that standardization as the reason honeypots and transfer-traps are not the main failure mode here, unlike Ethereum memecoins [11][49]. Still revoke-check them. A non-standard mint is a hard skip. A revoked mint is not a buy signal.
- **“Liquidity locked” after graduation.** LP burn is real and blocks a pool drain [51]. It does not block a holder dump. Do not score burned LP as safety.
- **“Smart money bought it.”** The academic effect is modest and two-sided, because those wallets sell into you [11].

## 4. Entry and exit rules people use

Separate the claims.

**Evidence, not a strategy:**

- Graduation is the only clean protocol “success” label, and it is rare [11].
- Paths with few trades and fast SOL accumulation graduate more often than bot-churned paths at the same curve level [11].
- The first 5 minutes of liquidity and trade flow predict the 1-hour rug/idle outcome well enough for a model [49].
- The profitable historical behavior is selling into later buyers, which is what devs and snipers do [14]. A bot that buys after them is on the wrong side of that trade.

**Social-media rules, with the known hole:**

- “Buy the graduation candle.” The open pool is exactly when curve holders can finally sell without the curve penalty. The first 10 minutes are the most crowded [51]. No public study shows a positive average return to buying that candle after costs.
- “Volume and holder growth.” Useful as a filter against a three-wallet curve. Wash bots can fake both. Bitquery had to drop same-transaction buy-and-sell volume from its own counts because of this [14].
- “Trail the breakout after graduation.” This is a momentum story. It fails when the breakout is the bundle unloading. I found no audited track record for it.

A risk-first bot should not try to win the first block. It should refuse most coins, and only consider a name after the launch bundle has had time to sell.

## 5. Risk rules

These are survival rules, not alpha. They match how a small account dies: one oversized loser, then revenge size.

- Risk **0.5–1% of the trading balance** per trade. 2% is the top of what is defensible, not the default.
- One position at a time until paper results exist.
- Hard stop. Do not average down. Do not move the stop wider.
- Take profit in steps, and keep a runner only if the stop is already at breakeven.
- Cap trades per day. Costs punish high frequency.
- A **daily loss limit of 3% of balance** flattens the bot for the day. A **weekly limit of 8%** flattens it until you review.
- A kill switch if the wallet signer, RPC, or price feed fails. A bot that cannot get a quote must not “retry market.”
- Keep failed-tx SOL out of the trading balance in your own accounting. It is a real loss.

## 6. Costs that eat the edge

Protocol fees alone are about **2.5% round trip** on the curve (1.25% each side) [4][21]. On PumpSwap the round trip is about **2.5%** near graduation and can fall toward **0.6%** only at very high market cap [4][52]. A fresh graduate is the expensive end.

Fixed chain costs, from bot docs checked around Sep–Oct 2026 [19][21]:

- Base fee: 0.000005 SOL per signature. Negligible.
- Priority fee: often 0.001–0.005 SOL. You pay it **even if the transaction fails** [21].
- Jito tip: often 0.001–0.01 SOL in normal competition, higher on a hot launch. Also paid on attempts, and Bitquery’s sniper profits **excluded** tips [14][21].

On a **0.1 SOL** trade, 0.004 SOL of tips and priority fees round trip is already **4%**, before protocol fees and slippage. On 0.05 SOL it is 8%. On 0.5 SOL it is 0.8%. Tiny size looks safe and is mostly a fee donation.

Slippage on a thin graduate pool is the largest variable cost. One 2026 fee guide’s own examples put a 0.5 SOL buy near 2–4% all-in and warned that 3–6% round trip is normal once slippage is included [19]. Those slippage tables are the site’s estimates, not an audit. Failed buys during congestion can turn a “cheap” snipe into several paid failures and no position.

**Working estimate for a small bot that does not snipe block 0:** **3–6% round trip** if both fills are clean, more if you chase or if sells fail while the price is falling. Any backtest that ignores this will look profitable and be wrong.

## 7. Competition

Snipers are in block 0 on 28% of coins. Someone other than the dev is there on 38% [14]. They are not a side show. They are the market microstructure.

Even so, snipers as a group did not capture the money. Devs and bundles made on the order of 18× what snipers made on sales, and a large share of sniper wallets were not ahead once dead coins were marked at zero [14]. The top of the sniper list is a volume business: one wallet in that table sniped 128,408 launches. A small bot cannot outbid that for the opening slot, and should not try.

What a small bot can actually do differently:

- Skip block 0. The data says that slot is owned.
- Trade less. Ten round trips a day at 4% friction is 40% of capital turned into costs, even with a coin-flip hit rate.
- Demand to see the dev and the bundle sell, or a large part of it, before any buy.
- Use small size so your own order is not the exit liquidity.
- Measure a boring post-graduation slice (for example minutes 15–90) instead of the candle everyone else is sniping.

That is a different bet. It is not a proven edge.

## 8. How to test before real money

**Data.** Bitquery sells Pump.fun history back to about June 2024: creations, bonding-curve trades, migrations, and OHLCV, including a free sample [26][27][28]. Dune is fine for retrospective SQL, not for live decisions [25]. Helius or another RPC can rebuild holder and mint state, but paging old signatures is slow [30]. Kamat’s RED-PUMP-2026 launch table is on Zenodo (concept DOI 10.5281/zenodo.20633486) if you only need launch metadata and the fast-graduation label [8]. It is not a price path.

A useful backtest needs, for each mint: creation time, every trade with wallet and size, graduation time if any, and the dev wallet. Then apply filters using only data available at the decision time. If you use the full holder list from 30 minutes later to decide a buy at minute 2, the test is lying.

**Paper trade for at least 2 weeks, and do not skip the backtest.** Two weeks on pump.fun is a lot of coins and still a small number of trades if the filters are strict. Judge the bot on **at least 100 closed paper trades**, or it is noise.

**What “viable” means after costs.** With a 25% average win, a 15% average loss, and 4% round-trip cost, you need about a **48% win rate** just to break even. A 40% win / 25% loss profile needs about a **45% win rate** at that cost. A strategy that sometimes wins 80% and loses 25% can break even nearer a 29% win rate, but only if the big wins are real and not one lucky tail. Those are my calculations from the cost range above, not published trading results.

Also require:

- Average win large enough that expectancy stays positive if you add 1–2% extra slippage.
- Profit factor above 1.3 after costs, not just above 1.0.
- Max drawdown you can actually sit through. If the backtest drawdown is 30%, a 3% daily stop will shut the live bot off inside that path.
- Results that survive a 30-day walk-forward slice, not one golden week.

If paper trading cannot show a positive expectancy after the cost haircut, do not fund it. The base rate is hostile enough that “it might work live” is not a reason.

## 9. Legal and tax, in general

Running a bot that trades your own coins on a public DEX is legal in the US, Canada, the UK, the EU, and similar places. It becomes a problem if the bot is part of market manipulation, or if you sell the bot or signals to other people without whatever licence your country requires [34][36]. I am not a lawyer. Check your own country before you run it, especially if you take other people’s money.

Every swap is a disposition. You owe tax on the gain even if you never cashed out to dollars.

Canada, from CRA’s own page (updated on the page details as 2025-12-02): disposing of crypto — including swapping one coin for another — is business income or a capital gain [56]. A bot that trades often, holds for minutes, and is run to profit looks like the CRA’s own example of business income, which is fully taxable, not a half-inclusion capital gain [56]. Wallet-to-wallet transfers you own are not dispositions. Keep a full trade log: time, mint, SOL in, SOL out, fees, and CAD value.

US: crypto disposals are taxable, and broker 1099-DA reporting is being phased in. A self-custody bot will not get a tidy broker form. You still report. If you have both US and Canadian exposure, the basis rules do not match [31].

## Rule set to backtest

Do not trade this live because it is written down. It is a testable hypothesis.

**Universe**

- SOL-paired pump.fun coins only.
- No buy in the first 15 minutes after the first trade.
- Only consider a coin if it has graduated, or if it is still on the curve above 60% and the next rule passes. Run these as two separate tests. Do not mix the results.

**Hard skips**

- Dev sold more than half of the dev’s bought tokens within 15 minutes, unless price has already round-tripped and holders are still increasing. Default is skip.
- Launch bundle, or wallets funded by the dev, still hold more than 8% combined.
- Top 10 holders, excluding the pool and the bonding curve, hold more than 35%.
- Mint authority or freeze authority still set.
- Fewer than 80 unique buyers.
- Same-transaction wash volume is a large share of reported volume.
- Deployer has 20+ prior launches and a high same-day dump rate. Tune the cutoff on old data only.

**Entry**

- One buy only.
- Price is not more than 15% above the low of the last 10 minutes.
- Unique holders are higher than 15 minutes ago.
- Size so that a total loss is **1% of balance**. On a 0.1 SOL balance that is a dust trade and fees will dominate. If the account is that small, paper trade only.

**Exit**

- Stop at **−18%** from fill, market sell, no widen.
- Sell 50% at **+30%**.
- Move the stop on the rest to breakeven.
- Sell the rest at **+70%**, or on a 20% drop from the high after the first target, whichever comes first.
- Time stop: if neither target nor stop has hit in **45 minutes**, exit.
- Never add.

**Daily limits**

- Max **4** entries per day.
- Stop for the day at **−3%** of starting-day balance, including failed-tx fees.
- Stop for the week at **−8%**.

**Metrics**

- Trade count, win rate, average win, average loss, expectancy after a 4% cost haircut.
- Profit factor, max drawdown, longest losing streak.
- Fees and failed transactions as a percent of gross profit.
- Results by week, so one viral day cannot carry the test.
- How many signals the filters rejected. If it barely trades, say so.

**Pass bar before any real SOL:** at least 100 paper trades, positive expectancy after 4% costs, profit factor above 1.3, and the same sign of expectancy on a later week the rules were not tuned on.

## What can still lose money

- The dev or a hidden funded wallet sells after your filters looked clean.
- You are early relative to retail and late relative to the bundle.
- Slippage on the stop is far worse than 18% because the pool is thin.
- The sell transaction fails, you pay the tip, and the price is gone.
- Wash volume and rented holders fake the “growth” filter.
- Social links are bought, not real.
- A strategy that worked in May fails in November. This market’s graduation rate already moved between published samples [8][11].
- Fees on a small account are larger than the edge.
- The backtest used future holder data.
- The bot has a bug and buys the skip list.
- You override the daily stop.

**Where the evidence is weak:** any claim about average profit after graduation, the exact top-10 cutoff, the 15-minute wait, and the +30/+70 targets. Those are risk constraints chosen so a test can fail cheaply. They are not results. The strong evidence is the base rate, the bundle profits, the dev sell speed, and the cost stack. That evidence says most bots here are exit liquidity.

If you want a next step inside Ghost Chat, the useful one is a one-page backtest spec (fields, filters, and the pass/fail table) before any bot code.