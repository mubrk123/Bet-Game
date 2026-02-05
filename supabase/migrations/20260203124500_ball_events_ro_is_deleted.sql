-- Ensure backward-compatible deleted flag used by frontend filters

ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS ro_is_deleted BOOLEAN DEFAULT FALSE;

-- One-time backfill from is_deleted if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ball_events'
      AND column_name = 'is_deleted'
  ) THEN
    UPDATE ball_events
    SET ro_is_deleted = COALESCE(ro_is_deleted, is_deleted, FALSE)
    WHERE ro_is_deleted IS NULL;
  ELSE
    UPDATE ball_events
    SET ro_is_deleted = COALESCE(ro_is_deleted, FALSE)
    WHERE ro_is_deleted IS NULL;
  END IF;
END $$;

-- Keep a quick filter index
CREATE INDEX IF NOT EXISTS idx_ball_events_ro_is_deleted
  ON ball_events (match_id, ro_is_deleted, created_at DESC);
