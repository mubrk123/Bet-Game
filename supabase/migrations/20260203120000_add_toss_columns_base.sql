-- Ensure base toss columns exist for all environments (older DBs may miss them)
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS toss_won_by TEXT,
  ADD COLUMN IF NOT EXISTS elected_to TEXT;

-- Light index for occasional filters / ordering
CREATE INDEX IF NOT EXISTS idx_matches_toss_winner ON matches (toss_won_by);
