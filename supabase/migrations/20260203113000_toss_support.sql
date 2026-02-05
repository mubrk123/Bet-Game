-- Toss support: persist provider + human fields and timing
-- Adds provider-aligned toss columns and a timestamp for quick lookups.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ro_toss_won_by TEXT,
  ADD COLUMN IF NOT EXISTS ro_toss_decision TEXT,
  ADD COLUMN IF NOT EXISTS toss_recorded_at TIMESTAMPTZ;

-- Helpful index for recent toss lookups
CREATE INDEX IF NOT EXISTS idx_matches_toss_recorded
  ON matches (toss_recorded_at DESC);
