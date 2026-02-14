-- Create session_markets to store backend-driven projections (no frontend math)

CREATE TABLE IF NOT EXISTS public.session_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  inning integer NOT NULL DEFAULT 1,
  target_over integer NOT NULL,
  projected_line numeric(8,1),
  mode text, -- current-rate | baseline-10rpo | hybrid-6-then-10rpo
  runs integer,
  wickets integer,
  overs_decimal numeric(6,3),
  crr numeric(8,2),
  wicket_reduction numeric(8,2),
  status text NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | SETTLED
  close_time timestamptz,
  settle_time timestamptz,
  note jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_markets_unique_target UNIQUE (match_id, inning, target_over)
);

CREATE INDEX IF NOT EXISTS session_markets_match_idx ON public.session_markets (match_id);
CREATE INDEX IF NOT EXISTS session_markets_match_inning_idx ON public.session_markets (match_id, inning);
CREATE INDEX IF NOT EXISTS session_markets_status_idx ON public.session_markets (status);

-- Basic RLS: mirror ball_events openness for read; writes remain service-role only.
ALTER TABLE public.session_markets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_markets'
      AND policyname = 'session_markets_select_all'
  ) THEN
    CREATE POLICY session_markets_select_all
      ON public.session_markets
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Add to realtime publication for live UI updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'session_markets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_markets;
  END IF;
END $$;
