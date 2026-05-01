-- Replace SECURITY DEFINER leaderboard views with a public-readable aggregate table.
-- Triggers on game_events / wallets / profiles keep the aggregate up to date per user.
-- Idempotent: safe to re-run.

create table if not exists public.leaderboard_aggregate (
  user_id uuid primary key references auth.users (id) on delete cascade,
  leaderboard_name text not null,
  current_balance integer not null default 0,
  total_rounds integer not null default 0,
  net_delta integer not null default 0,
  aura_peak_multiplier double precision not null default 0,
  weekly_week_start date not null default date_trunc('week', now())::date,
  weekly_net_delta integer not null default 0,
  weekly_rounds integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists leaderboard_aggregate_balance_idx
  on public.leaderboard_aggregate (current_balance desc);
create index if not exists leaderboard_aggregate_weekly_idx
  on public.leaderboard_aggregate (weekly_week_start, weekly_net_delta desc);

alter table public.leaderboard_aggregate enable row level security;

drop policy if exists leaderboard_aggregate_public_read on public.leaderboard_aggregate;
create policy leaderboard_aggregate_public_read
on public.leaderboard_aggregate for select
to anon, authenticated
using (true);
-- No insert/update/delete policies; only the SECURITY DEFINER trigger function writes.

-- Single source of truth: recompute one user's aggregate row from profiles + wallets + game_events.
-- Cheap because all lookups are indexed; weekly columns are gated by weekly_week_start at read time.
create or replace function public.tg_refresh_leaderboard_aggregate(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_balance integer;
  v_aura double precision;
  v_total_rounds integer;
  v_net_delta integer;
  v_week_start date := date_trunc('week', now())::date;
  v_weekly_net integer;
  v_weekly_rounds integer;
begin
  select coalesce(nullif(trim(p.display_name), ''), p.handle), w.tokens, w.aura_peak_multiplier
  into v_name, v_balance, v_aura
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = p_user_id;

  -- Profile or wallet not yet present; the wallet/profile insert trigger will fire again.
  if v_name is null then
    return;
  end if;

  select count(*)::integer, coalesce(sum(delta), 0)::integer
  into v_total_rounds, v_net_delta
  from public.game_events
  where user_id = p_user_id;

  select count(*)::integer, coalesce(sum(delta), 0)::integer
  into v_weekly_rounds, v_weekly_net
  from public.game_events
  where user_id = p_user_id and created_at >= v_week_start;

  insert into public.leaderboard_aggregate (
    user_id, leaderboard_name, current_balance, total_rounds, net_delta,
    aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds, updated_at
  ) values (
    p_user_id, v_name, v_balance, v_total_rounds, v_net_delta,
    coalesce(v_aura, 0), v_week_start, v_weekly_net, v_weekly_rounds, now()
  )
  on conflict (user_id) do update set
    leaderboard_name = excluded.leaderboard_name,
    current_balance = excluded.current_balance,
    total_rounds = excluded.total_rounds,
    net_delta = excluded.net_delta,
    aura_peak_multiplier = excluded.aura_peak_multiplier,
    weekly_week_start = excluded.weekly_week_start,
    weekly_net_delta = excluded.weekly_net_delta,
    weekly_rounds = excluded.weekly_rounds,
    updated_at = now();
end;
$$;

create or replace function public.tg_lb_after_game_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tg_refresh_leaderboard_aggregate(new.user_id);
  return new;
end;
$$;

create or replace function public.tg_lb_after_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tg_refresh_leaderboard_aggregate(new.user_id);
  return new;
end;
$$;

create or replace function public.tg_lb_after_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tg_refresh_leaderboard_aggregate(new.id);
  return new;
end;
$$;

drop trigger if exists game_events_lb_refresh on public.game_events;
create trigger game_events_lb_refresh
  after insert on public.game_events
  for each row execute function public.tg_lb_after_game_event();

drop trigger if exists wallets_lb_refresh on public.wallets;
create trigger wallets_lb_refresh
  after insert or update on public.wallets
  for each row execute function public.tg_lb_after_wallet();

drop trigger if exists profiles_lb_refresh on public.profiles;
create trigger profiles_lb_refresh
  after insert or update of handle, display_name on public.profiles
  for each row execute function public.tg_lb_after_profile();

-- One-shot backfill from existing rows (idempotent via ON CONFLICT).
insert into public.leaderboard_aggregate (
  user_id, leaderboard_name, current_balance, total_rounds, net_delta,
  aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds, updated_at
)
select
  p.id,
  coalesce(nullif(trim(p.display_name), ''), p.handle),
  w.tokens,
  count(ge.id)::integer,
  coalesce(sum(ge.delta), 0)::integer,
  coalesce(w.aura_peak_multiplier, 0),
  date_trunc('week', now())::date,
  coalesce(sum(ge.delta) filter (where ge.created_at >= date_trunc('week', now())), 0)::integer,
  count(ge.id) filter (where ge.created_at >= date_trunc('week', now()))::integer,
  now()
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge on ge.user_id = p.id
group by p.id, p.handle, p.display_name, w.tokens, w.aura_peak_multiplier
on conflict (user_id) do update set
  leaderboard_name = excluded.leaderboard_name,
  current_balance = excluded.current_balance,
  total_rounds = excluded.total_rounds,
  net_delta = excluded.net_delta,
  aura_peak_multiplier = excluded.aura_peak_multiplier,
  weekly_week_start = excluded.weekly_week_start,
  weekly_net_delta = excluded.weekly_net_delta,
  weekly_rounds = excluded.weekly_rounds,
  updated_at = now();

-- Replace the SECURITY DEFINER views with invoker views over the aggregate.
-- Same column shapes as before so the client (cloud-sync.js fetchLeaderboardViaRest) needs no edits.
drop view if exists public.leaderboard_all_time;
create view public.leaderboard_all_time
with (security_invoker = true)
as
select
  user_id,
  leaderboard_name,
  current_balance,
  total_rounds,
  net_delta,
  aura_peak_multiplier as aura_peak
from public.leaderboard_aggregate;

drop view if exists public.leaderboard_weekly;
create view public.leaderboard_weekly
with (security_invoker = true)
as
select
  user_id,
  leaderboard_name,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_net_delta else 0 end as weekly_net_delta,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_rounds else 0 end as weekly_rounds,
  aura_peak_multiplier as aura_peak
from public.leaderboard_aggregate;

grant select on public.leaderboard_all_time to anon, authenticated;
grant select on public.leaderboard_weekly to anon, authenticated;

-- Rewrite RPCs to read from the aggregate. Same return shape as before so the Edge function keeps working.
drop function if exists public.leaderboard_all_time_rows(integer);
drop function if exists public.leaderboard_weekly_rows(integer);

create or replace function public.leaderboard_all_time_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  current_balance integer,
  total_rounds integer,
  net_delta integer,
  aura_peak double precision
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    a.leaderboard_name,
    a.current_balance,
    a.total_rounds,
    a.net_delta,
    a.aura_peak_multiplier
  from public.leaderboard_aggregate a
  order by a.current_balance desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.leaderboard_weekly_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  weekly_net_delta integer,
  weekly_rounds integer,
  aura_peak double precision
)
language sql
security invoker
set search_path = public
stable
as $$
  with current as (
    select
      a.leaderboard_name,
      case when a.weekly_week_start = date_trunc('week', now())::date
        then a.weekly_net_delta else 0 end as weekly_net_delta,
      case when a.weekly_week_start = date_trunc('week', now())::date
        then a.weekly_rounds else 0 end as weekly_rounds,
      a.aura_peak_multiplier as aura_peak
    from public.leaderboard_aggregate a
  )
  select c.leaderboard_name, c.weekly_net_delta, c.weekly_rounds, c.aura_peak
  from current c
  order by c.weekly_net_delta desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
