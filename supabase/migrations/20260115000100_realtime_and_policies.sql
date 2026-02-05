-- Enable realtime for additional tables used by the frontend (idempotent)
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'instance_markets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.instance_markets;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wallet_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
  END IF;
END $$;

-- Allow public read access for odds/scoreboard data used by the UI
alter table public.ball_events enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ball_events'
      AND policyname = 'Public read ball events'
  ) THEN
    CREATE POLICY "Public read ball events" ON public.ball_events
      FOR SELECT USING (true);
  END IF;
END $$;

alter table public.casino_games enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'casino_games'
      AND policyname = 'Public read casino games'
  ) THEN
    CREATE POLICY "Public read casino games" ON public.casino_games
      FOR SELECT USING (true);
  END IF;
END $$;
