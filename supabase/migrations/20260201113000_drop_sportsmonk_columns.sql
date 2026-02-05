-- Drop legacy Sportmonks-era score columns; Roanuz push architecture does not use them.
ALTER TABLE matches
  DROP COLUMN IF EXISTS score_home,
  DROP COLUMN IF EXISTS score_away,
  DROP COLUMN IF EXISTS last_ball_runs,
  DROP COLUMN IF EXISTS last_ball_wicket,
  DROP COLUMN IF EXISTS last_ball_boundary,
  DROP COLUMN IF EXISTS last_ball_six,
  DROP COLUMN IF EXISTS last_ball_extra;
