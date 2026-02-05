-- Ensure ball_events are readable by anon/auth for UI pulse

-- 1) Enable RLS (idempotent)
ALTER TABLE public.ball_events ENABLE ROW LEVEL SECURITY;

-- 2) Allow SELECT for everyone
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ball_events'
      AND policyname = 'ball_events_select_all'
  ) THEN
    CREATE POLICY ball_events_select_all
      ON public.ball_events
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- 3) Make sure realtime publication includes ball_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ball_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ball_events;
  END IF;
END $$;
