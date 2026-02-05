-- Align ball_events with Roanuz live ingestion
-- Adds is_legal + outcome to avoid insert errors and support UI filters

ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS is_legal BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS outcome TEXT;

UPDATE ball_events
  SET is_legal = TRUE
  WHERE is_legal IS NULL;
