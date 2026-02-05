-- Allow public/anon read access to markets and runners for frontend odds display
alter table public.markets enable row level security;
create policy "Public read markets" on public.markets
  for select using (true);

alter table public.runners enable row level security;
create policy "Public read runners" on public.runners
  for select using (true);
