-- 002_position_and_drafts.sql
-- Two columns the engine needs beyond the first schema:
--   qty_usd / avg_cost_usd: the position a paper trade closes, so a real daily
--   loss can be worked out from real fills instead of a hand-written number.
--   draft_tx: the devnet transaction the user's own wallet signs (never a key).
ALTER TABLE bots ADD COLUMN qty_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN avg_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE trades ADD COLUMN draft_tx TEXT;
ALTER TABLE trades ADD COLUMN draft_at TEXT;
