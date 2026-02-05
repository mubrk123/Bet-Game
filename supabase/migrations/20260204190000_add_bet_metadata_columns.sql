-- Ensure metadata columns exist for bet inserts that capture client info
alter table bets
  add column if not exists ip_address inet,
  add column if not exists user_agent text;

alter table instance_bets
  add column if not exists ip_address inet,
  add column if not exists user_agent text;

alter table wallet_transactions
  add column if not exists ip_address inet,
  add column if not exists user_agent text;

-- Refresh PostgREST schema cache so new columns are immediately visible
notify pgrst, 'reload schema';
