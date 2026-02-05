-- ============================================
-- Roanuz-aligned storage for scores & balls
-- ============================================

-- Matches: store raw/live payloads so frontend can render without lossy mapping
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ro_status_raw TEXT,
  ADD COLUMN IF NOT EXISTS ro_play_status TEXT,
  ADD COLUMN IF NOT EXISTS ro_live JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ro_innings JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ro_last_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS target_runs INTEGER;

-- Ball events: keep provider identifiers and raw ball payload
ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS sub_ball INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_ball_id TEXT,
  ADD COLUMN IF NOT EXISTS ro_raw JSONB DEFAULT '{}'::jsonb;

-- Align over to integer (Roanuz already separates ball number)
ALTER TABLE ball_events
  ALTER COLUMN over TYPE INTEGER USING FLOOR(over);

-- Replace old unique constraint to include sub_ball (legal + illegals per ball)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ball_events_match_id_inning_over_ball_key'
  ) THEN
    ALTER TABLE ball_events DROP CONSTRAINT ball_events_match_id_inning_over_ball_key;
  END IF;
END $$;

ALTER TABLE ball_events
  ADD CONSTRAINT ball_events_match_over_ball_unique UNIQUE (match_id, inning, over, ball, sub_ball);

-- Helpful index for live queries
CREATE INDEX IF NOT EXISTS idx_ball_events_match_created ON ball_events (match_id, created_at DESC);
