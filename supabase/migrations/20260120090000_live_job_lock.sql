-- Lightweight job lock to prevent overlapping cron runs.

create table if not exists public.job_locks (
  name text primary key,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists job_locks_expires_at_idx on public.job_locks (expires_at);

create or replace function public.acquire_job_lock(
  p_name text,
  p_ttl_seconds integer default 20
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired boolean;
begin
  with upsert as (
    insert into public.job_locks as jl (name, expires_at, updated_at)
    values (p_name, now() + make_interval(secs => greatest(p_ttl_seconds, 1)), now())
    on conflict (name) do update
      set expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 1)),
          updated_at = now()
      where jl.expires_at <= now()
    returning 1
  )
  select true into acquired from upsert;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_job_lock(p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.job_locks where name = p_name;
$$;

comment on table public.job_locks is 'Simple expiring lock rows for cron/worker mutual exclusion.';
comment on function public.acquire_job_lock is 'Acquire an expiring lock row; returns true on success.';
comment on function public.release_job_lock is 'Release a lock row immediately.';
