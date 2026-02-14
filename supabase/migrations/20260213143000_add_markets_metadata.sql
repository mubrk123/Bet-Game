-- Add metadata column to markets for player/special markets
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN markets.metadata IS 'Arbitrary market-level metadata (e.g., kind, inning, team)';
