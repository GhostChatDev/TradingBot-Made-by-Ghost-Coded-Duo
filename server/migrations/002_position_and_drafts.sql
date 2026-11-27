-- 002_position_and_drafts.sql
-- Columns the engine needs beyond the first schema.
--   qty_usd / avg_cost_usd: the open paper position, so a buy can be closed by a
--   sell and the realised loss worked out from real fills (not a hand-written row).
--   draft_tx / draft_at: the devnet transaction the user's OWN wallet signs.
--   It is unsigned and contains no key; a key never enters this database.
ALTER TABLE bots ADD COLUMN qty_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN avg_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE trades ADD COLUMN draft_tx TEXT;
ALTER TABLE trades ADD COLUMN draft_at TEXT;
