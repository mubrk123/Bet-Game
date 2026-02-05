-- Optional legacy column so filters never fail if referenced
ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Keep values aligned
UPDATE ball_events
SET is_deleted = COALESCE(is_deleted, ro_is_deleted, FALSE),
    ro_is_deleted = COALESCE(ro_is_deleted, is_deleted, FALSE);
