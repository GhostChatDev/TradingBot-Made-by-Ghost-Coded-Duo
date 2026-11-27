-- 002_pumpfun_run.sql - the pump.fun paper run: one row per account, all money in whole cents.
--
-- This is the rule set the person asked for:
--   take profit at +10.00 USD, stop loss at -20%, rotate to the next token,
--   compound each win into the next position, stop at 5,000 USD realised.
-- Updated by server/pump-run.js on every mark. Nothing here is a promise of profit.

CREATE TABLE IF NOT EXISTS pump_runs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
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

-- Delivery address (finding 5): what the bot does with a devnet transaction when
-- nobody is watching. Chosen by the person, never assumed. Default: JSON out only.
CREATE TABLE IF NOT EXISTS delivery_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery TEXT NOT NULL DEFAULT 'json' CHECK (delivery IN ('json', 'signer')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
