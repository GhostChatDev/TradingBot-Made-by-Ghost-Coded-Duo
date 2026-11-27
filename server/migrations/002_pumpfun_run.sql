-- 002_pumpfun_run.sql - the pump.fun paper run: one row per account, all money in whole cents.
--
-- The rule set: take profit at +10.00 USD, stop loss at -20%, rotate to the next
-- token, compound each win into the next position, stop at 5,000 USD realised.
-- server/pump-run.js updates these rows on every mark. Nothing here is a promise.

CREATE TABLE IF NOT EXISTS pump_runs (
  user_id TEXT PRIMARY KEY,
  watchlist_json TEXT NOT NULL DEFAULT '[]',
  size_cents INTEGER NOT NULL DEFAULT 500,
  realised_cents INTEGER NOT NULL DEFAULT 0,
  open_mint TEXT,
  open_symbol TEXT,
  open_entry_cents INTEGER,
  open_entry_price_micros INTEGER,
  open_tokens INTEGER,
  last_price_micros INTEGER,
  last_mark_at TEXT,
  closed_json TEXT NOT NULL DEFAULT '[]',
  goal_reached INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the bot does with a devnet draft when nobody is watching. Chosen by the
-- person, never assumed: 'json' (default) or 'signer'.
CREATE TABLE IF NOT EXISTS delivery_settings (
  user_id TEXT PRIMARY KEY,
  delivery TEXT NOT NULL DEFAULT 'json',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
