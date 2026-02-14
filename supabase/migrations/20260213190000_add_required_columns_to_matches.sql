-- Add required runs/balls columns for live chase info
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ro_required_runs integer,
  ADD COLUMN IF NOT EXISTS ro_required_balls integer;

COMMENT ON COLUMN public.matches.ro_required_runs IS 'Provider-required runs remaining for current chase (second innings)';
COMMENT ON COLUMN public.matches.ro_required_balls IS 'Provider-required balls remaining for current chase (second innings)';
