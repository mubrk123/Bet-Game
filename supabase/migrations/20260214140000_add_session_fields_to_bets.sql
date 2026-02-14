-- Add bet-time snapshot fields for session (OVER_PROJECTION) instance bets

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS session_target_over integer,
  ADD COLUMN IF NOT EXISTS session_line numeric(8,1);

-- No defaults; values are populated at bet insert time for session markets.
