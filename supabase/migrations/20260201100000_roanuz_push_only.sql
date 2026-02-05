-- Roanuz-only push-based architecture bootstrap
-- Creates/aligns tables and indexes for webhook-driven ball-by-ball ingestion.

-- Ensure supporting extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================
-- matches (already exists in prior migrations)
-- Add Roanuz live fields if missing
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ro_status_raw TEXT,
  ADD COLUMN IF NOT EXISTS ro_play_status TEXT,
  ADD COLUMN IF NOT EXISTS ro_live JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ro_innings JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ro_last_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS target_runs INTEGER;

-- ========================
-- ball_events
ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS sub_ball INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_ball_id TEXT,
  ADD COLUMN IF NOT EXISTS ro_raw JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_legal BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Ensure over is stored as integer (Roanuz separates ball number)
ALTER TABLE ball_events
  ALTER COLUMN over TYPE INTEGER USING FLOOR(over);

-- Unique per match/over/ball/sub_ball already added in prior migration; ensure provider id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_ball_events_match_provider_unique'
      AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX idx_ball_events_match_provider_unique
      ON ball_events (match_id, provider_ball_id)
      WHERE provider_ball_id IS NOT NULL;
  END IF;
END $$;

-- Helpful ordering index
CREATE INDEX IF NOT EXISTS idx_ball_events_match_inning_over_ball
  ON ball_events (match_id, inning, over, ball, sub_ball);

-- ========================
-- webhook_events (audit / DLQ)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) REFERENCES matches(id) ON DELETE SET NULL,
  provider_ball_id TEXT,
  push_reason TEXT,
  match_push_kind TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_match ON webhook_events (match_id, received_at DESC);

-- ========================
-- roanuz_subscriptions (optional tracking for auto-subscribe job)
CREATE TABLE IF NOT EXISTS roanuz_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  status TEXT,
  response JSONB,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (match_id, endpoint)
);

-- ========================
-- markets / runners helper indexes for odds updates
CREATE INDEX IF NOT EXISTS idx_markets_match ON markets (match_id);
CREATE INDEX IF NOT EXISTS idx_runners_market ON runners (market_id);
