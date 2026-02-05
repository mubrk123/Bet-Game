-- Ensure player storage exists (Roanuz IDs -> human names)
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ro_player_key TEXT UNIQUE NOT NULL,
  ro_player_name TEXT,
  ro_team_key TEXT,
  ro_last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columns used by ball ingestion (safety: only add if missing)
ALTER TABLE ball_events
  ADD COLUMN IF NOT EXISTS ro_batsman_key TEXT,
  ADD COLUMN IF NOT EXISTS ro_non_striker_key TEXT,
  ADD COLUMN IF NOT EXISTS ro_bowler_key TEXT,
  ADD COLUMN IF NOT EXISTS ro_batsman_name TEXT,
  ADD COLUMN IF NOT EXISTS ro_non_striker_name TEXT,
  ADD COLUMN IF NOT EXISTS ro_bowler_name TEXT;

-- Backfill players from stored Roanuz snapshots (matches.ro_last_payload)
WITH pl AS (
  SELECT DISTINCT
    coalesce(p->>'key', p->>'player_key', p->>'id', p->>'player_id') AS key,
    coalesce(
      p->>'name',
      p->>'short_name',
      p->>'full_name',
      p#>>'{player,name}',
      p#>>'{player,short_name}',
      p#>>'{player,full_name}'
    ) AS name,
    p->>'team_key' AS team_key
  FROM matches m,
    LATERAL (
      SELECT * FROM jsonb_array_elements(coalesce(m.ro_last_payload->'players', '[]'::jsonb))
      UNION ALL
      SELECT * FROM jsonb_array_elements(coalesce(m.ro_last_payload->'team_players', '[]'::jsonb))
      UNION ALL
      SELECT * FROM jsonb_array_elements(coalesce(m.ro_last_payload->'squads'->'a', '[]'::jsonb))
      UNION ALL
      SELECT * FROM jsonb_array_elements(coalesce(m.ro_last_payload->'squads'->'b', '[]'::jsonb))
    ) AS p
  WHERE coalesce(p->>'key', p->>'player_key', p->>'id', p->>'player_id') IS NOT NULL
)
INSERT INTO players (ro_player_key, ro_player_name, ro_team_key, ro_last_seen_at, updated_at)
SELECT key, name, team_key, NOW(), NOW()
FROM pl
ON CONFLICT (ro_player_key) DO UPDATE
SET
  ro_player_name = COALESCE(EXCLUDED.ro_player_name, players.ro_player_name),
  ro_team_key = COALESCE(EXCLUDED.ro_team_key, players.ro_team_key),
  ro_last_seen_at = NOW(),
  updated_at = NOW();

-- Backfill ball_events name fields from players where missing
UPDATE ball_events b
SET ro_batsman_name = p.ro_player_name
FROM players p
WHERE b.ro_batsman_name IS NULL AND b.ro_batsman_key = p.ro_player_key;

UPDATE ball_events b
SET ro_non_striker_name = p.ro_player_name
FROM players p
WHERE b.ro_non_striker_name IS NULL AND b.ro_non_striker_key = p.ro_player_key;

UPDATE ball_events b
SET ro_bowler_name = p.ro_player_name
FROM players p
WHERE b.ro_bowler_name IS NULL AND b.ro_bowler_key = p.ro_player_key;
