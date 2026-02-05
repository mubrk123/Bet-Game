-- ============================================
-- BETTING EXCHANGE - COMPLETE DATABASE SCHEMA
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUM TYPES
-- ============================================

-- User roles
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN', 'AGENT', 'SUPER_ADMIN');

-- Bet types
CREATE TYPE bet_type AS ENUM ('BACK', 'LAY');

-- Bet status
CREATE TYPE bet_status AS ENUM ('OPEN', 'WON', 'LOST', 'VOID');

-- Match status
CREATE TYPE match_status AS ENUM ('UPCOMING', 'LIVE', 'FINISHED');

-- Market status
CREATE TYPE market_status AS ENUM ('OPEN', 'SUSPENDED', 'CLOSED');

-- Sports
CREATE TYPE sport_type AS ENUM ('cricket', 'football', 'tennis', 'basketball');

-- Casino game types
CREATE TYPE casino_game_type AS ENUM (
  'slots', 'crash', 'dice', 'roulette', 'blackjack', 
  'andar_bahar', 'teen_patti', 'lucky_7', 'hi_lo', 
  'dragon_tiger', 'plinko', 'wheel', 'mines'
);

-- Casino round status
CREATE TYPE casino_round_status AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');

-- Instance market types
CREATE TYPE instance_market_type AS ENUM (
  'NEXT_BALL', 'NEXT_OVER', 'SESSION', 
  'PLAYER_PERFORMANCE', 'NEXT_WICKET', 'BOUNDARY'
);

-- Instance bet status
CREATE TYPE instance_bet_status AS ENUM ('OPEN', 'WON', 'LOST', 'VOID');

-- Withdrawal/Deposit status
CREATE TYPE request_status AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- Transaction types
CREATE TYPE transaction_type AS ENUM (
  'DEPOSIT', 'WITHDRAWAL', 'BET_PLACED', 'BET_WON', 
  'BET_LOST', 'BET_VOID', 'CASINO_BET', 'CASINO_WIN',
  'INSTANCE_BET_PLACED', 'INSTANCE_BET_WON', 'INSTANCE_BET_LOST',
  'CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT',
  'ADMIN_CREDIT', 'ADMIN_DEBIT'
);

-- ============================================
-- MAIN TABLES
-- ============================================

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'USER' NOT NULL,
  balance DECIMAL(15, 2) DEFAULT 0.00 NOT NULL CHECK (balance >= 0),
  exposure DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Matches table (centralized source of truth)
CREATE TABLE matches (
  id VARCHAR(100) PRIMARY KEY,
  external_id VARCHAR(100), -- Sportsmonk/CricketData ID
  sport sport_type NOT NULL,
  league VARCHAR(100) NOT NULL,
  home_team VARCHAR(100) NOT NULL,
  away_team VARCHAR(100) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  status match_status DEFAULT 'UPCOMING' NOT NULL,
  score_details TEXT,
  current_over INTEGER DEFAULT 0,
  current_ball INTEGER DEFAULT 0,
  total_overs INTEGER DEFAULT 20,
  current_inning INTEGER DEFAULT 1,
  venue VARCHAR(200),
  match_type VARCHAR(50), -- T20, ODI, Test, etc.
  toss_won_by VARCHAR(100),
  elected_to VARCHAR(50),
  
  -- Odds API data
  odds_provider VARCHAR(50),
  odds_data JSONB DEFAULT '{}'::jsonb,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ball-by-ball events (for cricket)
CREATE TABLE ball_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) REFERENCES matches(id) ON DELETE CASCADE,
  inning INTEGER NOT NULL DEFAULT 1,
  over DECIMAL(5, 1) NOT NULL, -- e.g., 5.3
  ball INTEGER NOT NULL,
  
  -- Player info
  batsman_id VARCHAR(100),
  batsman_name VARCHAR(100),
  bowler_id VARCHAR(100),
  bowler_name VARCHAR(100),
  
  -- Ball result
  runs INTEGER DEFAULT 0,
  extras INTEGER DEFAULT 0,
  total_runs INTEGER DEFAULT 0,
  is_wicket BOOLEAN DEFAULT FALSE,
  wicket_type VARCHAR(50),
  is_boundary BOOLEAN DEFAULT FALSE,
  is_six BOOLEAN DEFAULT FALSE,
  is_extra BOOLEAN DEFAULT FALSE,
  extra_type VARCHAR(50),
  commentary TEXT,
  
  -- Betting reference
  market_settled BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(match_id, inning, over, ball)
);

-- Traditional markets (for pre-match betting)
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) REFERENCES matches(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  status market_status DEFAULT 'OPEN' NOT NULL,
  odds_provider VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Market runners (selections)
CREATE TABLE runners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  back_odds DECIMAL(8, 2) NOT NULL,
  lay_odds DECIMAL(8, 2) NOT NULL,
  volume DECIMAL(15, 2) DEFAULT 0.00,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instance markets (ball-by-ball, over-by-over)
CREATE TABLE instance_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) REFERENCES matches(id) ON DELETE CASCADE,
  market_type instance_market_type NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- For cricket
  over_number INTEGER,
  ball_number INTEGER,
  inning_number INTEGER DEFAULT 1,
  
  -- Market details
  status market_status DEFAULT 'OPEN' NOT NULL,
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {id, name, odds}
  close_time TIMESTAMPTZ NOT NULL,
  settled_outcome VARCHAR(100),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(match_id, market_type, over_number, ball_number)
);

-- Traditional bets
CREATE TABLE bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  match_id VARCHAR(100) NOT NULL,
  market_id UUID,
  runner_id UUID,
  runner_name VARCHAR(100),
  
  -- Bet details
  type bet_type NOT NULL,
  odds DECIMAL(8, 2) NOT NULL,
  stake DECIMAL(15, 2) NOT NULL CHECK (stake > 0),
  potential_profit DECIMAL(15, 2) NOT NULL,
  liability DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  
  -- Status
  status bet_status DEFAULT 'OPEN' NOT NULL,
  winning_runner VARCHAR(100),
  settled_at TIMESTAMPTZ,
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instance bets (ball-by-ball betting)
CREATE TABLE instance_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  match_id VARCHAR(100) NOT NULL,
  market_id UUID REFERENCES instance_markets(id) ON DELETE CASCADE,
  
  -- Bet details
  outcome_id VARCHAR(100) NOT NULL,
  outcome_name VARCHAR(100) NOT NULL,
  odds DECIMAL(8, 2) NOT NULL,
  stake DECIMAL(15, 2) NOT NULL CHECK (stake > 0),
  potential_profit DECIMAL(15, 2) NOT NULL,
  
  -- Cricket context
  over_number INTEGER,
  ball_number INTEGER,
  inning_number INTEGER DEFAULT 1,
  
  -- Status
  status instance_bet_status DEFAULT 'OPEN' NOT NULL,
  winning_outcome VARCHAR(100),
  settled_at TIMESTAMPTZ,
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet transactions (audit trail)
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(15, 2) NOT NULL,
  type transaction_type NOT NULL,
  description TEXT,
  
  -- Reference fields
  reference_id UUID, -- bet_id, casino_round_id, etc.
  reference_type VARCHAR(50),
  source_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Balance tracking
  balance_before DECIMAL(15, 2) NOT NULL,
  balance_after DECIMAL(15, 2) NOT NULL,
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Casino games (metadata)
CREATE TABLE casino_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  type casino_game_type NOT NULL,
  description TEXT,
  
  -- Betting limits
  min_bet DECIMAL(15, 2) NOT NULL DEFAULT 10.00,
  max_bet DECIMAL(15, 2) NOT NULL DEFAULT 10000.00,
  house_edge DECIMAL(5, 4) NOT NULL DEFAULT 0.02,
  
  -- Game configuration
  config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Casino rounds
CREATE TABLE casino_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES casino_games(id) ON DELETE CASCADE,
  
  -- Provably fair
  server_seed TEXT NOT NULL,
  server_seed_hash VARCHAR(64) NOT NULL,
  client_seed TEXT,
  nonce BIGINT NOT NULL DEFAULT 0,
  
  -- Game result
  result JSONB NOT NULL,
  multiplier DECIMAL(10, 4),
  
  -- Status
  status casino_round_status DEFAULT 'PENDING' NOT NULL,
  completed_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Casino bets
CREATE TABLE casino_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  round_id UUID REFERENCES casino_rounds(id) ON DELETE CASCADE,
  game_id UUID REFERENCES casino_games(id) ON DELETE CASCADE,
  
  -- Bet details
  bet_amount DECIMAL(15, 2) NOT NULL,
  bet_choice TEXT,
  payout DECIMAL(15, 2),
  profit DECIMAL(15, 2),
  is_win BOOLEAN,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Withdrawal requests
CREATE TABLE withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Request details
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  status request_status DEFAULT 'REQUESTED' NOT NULL,
  notes TEXT,
  
  -- Payment info
  payment_method VARCHAR(50),
  account_details JSONB DEFAULT '{}'::jsonb,
  
  -- Processing
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deposit requests
CREATE TABLE deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Request details
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  status request_status DEFAULT 'REQUESTED' NOT NULL,
  notes TEXT,
  
  -- Payment info
  payment_method VARCHAR(50),
  transaction_id VARCHAR(100),
  screenshot_url TEXT,
  
  -- Processing
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Users indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_by ON users(created_by);
CREATE INDEX idx_users_role ON users(role);

-- Matches indexes
CREATE INDEX idx_matches_sport ON matches(sport);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_start_time ON matches(start_time);
CREATE INDEX idx_matches_external_id ON matches(external_id);
CREATE INDEX idx_matches_league ON matches(league);

-- Ball events indexes
CREATE INDEX idx_ball_events_match_id ON ball_events(match_id);
CREATE INDEX idx_ball_events_timestamp ON ball_events(timestamp);
CREATE INDEX idx_ball_events_over_ball ON ball_events(over, ball);

-- Markets indexes
CREATE INDEX idx_markets_match_id ON markets(match_id);
CREATE INDEX idx_markets_status ON markets(status);

-- Runners indexes
CREATE INDEX idx_runners_market_id ON runners(market_id);

-- Instance markets indexes
CREATE INDEX idx_instance_markets_match_id ON instance_markets(match_id);
CREATE INDEX idx_instance_markets_status ON instance_markets(status);
CREATE INDEX idx_instance_markets_close_time ON instance_markets(close_time);
CREATE INDEX idx_instance_markets_over_ball ON instance_markets(over_number, ball_number);

-- Bets indexes
CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_match_id ON bets(match_id);
CREATE INDEX idx_bets_status ON bets(status);
CREATE INDEX idx_bets_created_at ON bets(created_at);

-- Instance bets indexes
CREATE INDEX idx_instance_bets_user_id ON instance_bets(user_id);
CREATE INDEX idx_instance_bets_match_id ON instance_bets(match_id);
CREATE INDEX idx_instance_bets_market_id ON instance_bets(market_id);
CREATE INDEX idx_instance_bets_status ON instance_bets(status);

-- Wallet transactions indexes
CREATE INDEX idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at);

-- Casino bets indexes
CREATE INDEX idx_casino_bets_user_id ON casino_bets(user_id);
CREATE INDEX idx_casino_bets_round_id ON casino_bets(round_id);
CREATE INDEX idx_casino_bets_created_at ON casino_bets(created_at);

-- Request indexes
CREATE INDEX idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);
CREATE INDEX idx_withdrawal_requests_status ON withdrawal_requests(status);
CREATE INDEX idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX idx_deposit_requests_status ON deposit_requests(status);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ball_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE instance_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE instance_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;

-- Users RLS policies
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (auth.uid() = id OR role IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY "Users can update their own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Matches RLS (public read, admin write)
CREATE POLICY "Anyone can view matches" ON matches
  FOR SELECT USING (true);

CREATE POLICY "Only admins can modify matches" ON matches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN'))
  );

-- Bets RLS
CREATE POLICY "Users can view their own bets" ON bets
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
  ));

CREATE POLICY "Users can place bets" ON bets
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Instance bets RLS
CREATE POLICY "Users can view their own instance bets" ON instance_bets
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
  ));

CREATE POLICY "Users can place instance bets" ON instance_bets
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Wallet transactions RLS
CREATE POLICY "Users can view their own transactions" ON wallet_transactions
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
  ));

-- Casino bets RLS
CREATE POLICY "Users can view their own casino bets" ON casino_bets
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
  ));

CREATE POLICY "Users can place casino bets" ON casino_bets
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Withdrawal requests RLS
CREATE POLICY "Users can view their own withdrawal requests" ON withdrawal_requests
  FOR SELECT USING (user_id = auth.uid() OR admin_id = auth.uid());

CREATE POLICY "Users can create withdrawal requests" ON withdrawal_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Deposit requests RLS
CREATE POLICY "Users can view their own deposit requests" ON deposit_requests
  FOR SELECT USING (user_id = auth.uid() OR admin_id = auth.uid());

CREATE POLICY "Users can create deposit requests" ON deposit_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instance_markets_updated_at
  BEFORE UPDATE ON instance_markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to settle instance bet
CREATE OR REPLACE FUNCTION settle_instance_bet(
  p_bet_id UUID,
  p_status instance_bet_status,
  p_winning_outcome VARCHAR,
  p_payout DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_stake DECIMAL;
  v_result JSONB;
BEGIN
  -- Get bet details
  SELECT user_id, stake INTO v_user_id, v_stake
  FROM instance_bets WHERE id = p_bet_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bet not found');
  END IF;
  
  -- Update bet
  UPDATE instance_bets
  SET status = p_status,
      winning_outcome = p_winning_outcome,
      settled_at = NOW()
  WHERE id = p_bet_id;
  
  -- Update user balance if won
  IF p_status = 'WON' THEN
    UPDATE users
    SET balance = balance + p_payout
    WHERE id = v_user_id;
    
    -- Record transaction
    INSERT INTO wallet_transactions (
      user_id, amount, type, description,
      balance_before, balance_after
    )
    SELECT 
      v_user_id,
      p_payout,
      'INSTANCE_BET_WON',
      'Instance bet won: ' || p_winning_outcome,
      balance,
      balance + p_payout
    FROM users
    WHERE id = v_user_id;
  END IF;
  
  RETURN jsonb_build_object('success', true, 'bet_id', p_bet_id);
END;
$$ LANGUAGE plpgsql;

-- Function to place a bet with balance check
CREATE OR REPLACE FUNCTION place_bet_with_balance_check(
  p_user_id UUID,
  p_match_id VARCHAR,
  p_runner_name VARCHAR,
  p_type bet_type,
  p_odds DECIMAL,
  p_stake DECIMAL
)
RETURNS JSONB AS $$
DECLARE
  v_user_balance DECIMAL;
  v_potential_profit DECIMAL;
  v_liability DECIMAL;
  v_bet_id UUID;
BEGIN
  -- Get user balance
  SELECT balance INTO v_user_balance
  FROM users WHERE id = p_user_id;
  
  IF v_user_balance < p_stake THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;
  
  -- Calculate potential profit and liability
  IF p_type = 'BACK' THEN
    v_potential_profit := (p_odds - 1) * p_stake;
    v_liability := p_stake;
  ELSE
    v_potential_profit := p_stake;
    v_liability := (p_odds - 1) * p_stake;
  END IF;
  
  -- Check if user has enough for liability
  IF v_user_balance < v_liability THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance for liability');
  END IF;
  
  -- Insert bet
  INSERT INTO bets (
    user_id, match_id, runner_name,
    type, odds, stake, potential_profit, liability
  ) VALUES (
    p_user_id, p_match_id, p_runner_name,
    p_type, p_odds, p_stake, v_potential_profit, v_liability
  ) RETURNING id INTO v_bet_id;
  
  -- Deduct stake from balance
  UPDATE users
  SET balance = balance - p_stake,
      exposure = exposure + v_liability
  WHERE id = p_user_id;
  
  -- Record transaction
  INSERT INTO wallet_transactions (
    user_id, amount, type, description,
    balance_before, balance_after
  )
  SELECT 
    p_user_id,
    -p_stake,
    'BET_PLACED',
    'Bet placed: ' || p_runner_name || ' @ ' || p_odds,
    balance + p_stake,
    balance
  FROM users
  WHERE id = p_user_id;
  
  RETURN jsonb_build_object('success', true, 'bet_id', v_bet_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS FOR REPORTING
-- ============================================

-- User betting summary view
CREATE VIEW user_betting_summary AS
SELECT 
  u.id as user_id,
  u.username,
  u.balance,
  COUNT(DISTINCT b.id) as total_bets,
  COUNT(DISTINCT CASE WHEN b.status = 'WON' THEN b.id END) as bets_won,
  COUNT(DISTINCT CASE WHEN b.status = 'LOST' THEN b.id END) as bets_lost,
  COALESCE(SUM(CASE WHEN b.status = 'WON' THEN b.potential_profit ELSE 0 END), 0) as total_winnings,
  COALESCE(SUM(b.stake), 0) as total_staked
FROM users u
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.username, u.balance;

-- Daily revenue view
CREATE VIEW daily_revenue AS
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_bets,
  SUM(stake) as total_stake,
  SUM(CASE WHEN status = 'WON' THEN potential_profit ELSE 0 END) as total_payout,
  SUM(stake) - SUM(CASE WHEN status = 'WON' THEN potential_profit ELSE 0 END) as net_revenue
FROM bets
WHERE status IN ('WON', 'LOST')
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Insert casino games
INSERT INTO casino_games (name, slug, type, description, min_bet, max_bet, sort_order) VALUES
('Classic Slots', 'classic-slots', 'slots', 'Traditional 3-reel slot machine', 10.00, 10000.00, 1),
('Crash', 'crash', 'crash', 'Bet on a multiplier that crashes randomly', 10.00, 10000.00, 2),
('Dice', 'dice', 'dice', 'Predict if the roll will be high or low', 10.00, 10000.00, 3),
('Roulette', 'roulette', 'roulette', 'Classic roulette with various bets', 10.00, 10000.00, 4),
('Blackjack', 'blackjack', 'blackjack', 'Beat the dealer to 21', 10.00, 10000.00, 5),
('Andar Bahar', 'andar-bahar', 'andar_bahar', 'Traditional Indian card game', 10.00, 10000.00, 6),
('Teen Patti', 'teen-patti', 'teen_patti', 'Indian three-card poker', 10.00, 10000.00, 7),
('Lucky 7', 'lucky-7', 'lucky_7', 'Bet on card value being 7', 10.00, 10000.00, 8),
('Hi-Lo', 'hi-lo', 'hi_lo', 'Predict if next card is higher or lower', 10.00, 10000.00, 9),
('Dragon Tiger', 'dragon-tiger', 'dragon_tiger', 'Simple card comparison game', 10.00, 10000.00, 10),
('Plinko', 'plinko', 'plinko', 'Drop ball for multipliers', 10.00, 10000.00, 11),
('Wheel of Fortune', 'wheel-of-fortune', 'wheel', 'Spin the wheel for prizes', 10.00, 10000.00, 12),
('Mines', 'mines', 'mines', 'Find gems without hitting mines', 10.00, 10000.00, 13);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE users IS 'Platform users with different roles';
COMMENT ON TABLE matches IS 'Sports matches from various sources';
COMMENT ON TABLE ball_events IS 'Ball-by-ball data for cricket matches';
COMMENT ON TABLE instance_markets IS 'Live instance-based betting markets';
COMMENT ON TABLE instance_bets IS 'Bets placed on instance markets';
COMMENT ON TABLE casino_games IS 'Available casino games configuration';
COMMENT ON TABLE casino_rounds IS 'Casino game rounds with provably fair data';

COMMENT ON COLUMN matches.external_id IS 'ID from external API (Sportsmonk, CricketData)';
COMMENT ON COLUMN matches.odds_data IS 'JSON containing odds from various bookmakers';
COMMENT ON COLUMN instance_markets.outcomes IS 'JSON array of possible outcomes with odds';
COMMENT ON COLUMN casino_rounds.server_seed_hash IS 'SHA256 hash of server seed for provable fairness';

-- ============================================
-- ENABLE REALTIME
-- ============================================

-- Enable realtime for tables that need live updates
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table instance_markets;
alter publication supabase_realtime add table ball_events;
alter publication supabase_realtime add table bets;
alter publication supabase_realtime add table instance_bets;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
