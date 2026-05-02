-- Track wager (bet amount before outcome) per game event and aggregate to leaderboard.
-- Leaderboard now ranks by lifetime_wagered (all-time) and weekly_wagered (weekly).
-- Historical game_events get wager = abs(delta) as best approximation for arcade games; 0 otherwise.
-- Idempotent: safe to re-run.

-- 1. Add wager column to game_events (0 for all pre-existing rows; backfilled below).
alter table public.game_events
  add column if not exists wager integer not null default 0;

-- 2. Add wagered columns to leaderboard_aggregate.
alter table public.leaderboard_aggregate
  add column if not exists lifetime_wagered bigint not null default 0;
alter table public.leaderboard_aggregate
  add column if not exists weekly_wagered bigint not null default 0;

-- 3. New indexes for wagered-based leaderboard ordering.
create index if not exists leaderboard_aggregate_lifetime_wagered_idx
  on public.leaderboard_aggregate (lifetime_wagered desc);
create index if not exists leaderboard_aggregate_weekly_wagered_idx
  on public.leaderboard_aggregate (weekly_week_start, weekly_wagered desc);

-- 4. Update the refresh function to also compute wagered totals.
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
  v_avatar text;
  v_total_rounds integer;
  v_net_delta integer;
  v_lifetime_wagered bigint;
  v_week_start date := date_trunc('week', now())::date;
  v_weekly_net integer;
  v_weekly_rounds integer;
  v_weekly_wagered bigint;
begin
  select coalesce(nullif(trim(p.display_name), ''), p.handle), w.tokens, w.aura_peak_multiplier, p.avatar_url
  into v_name, v_balance, v_aura, v_avatar
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = p_user_id;

  if v_name is null then
    return;
  end if;

  select count(*)::integer, coalesce(sum(delta), 0)::integer, coalesce(sum(wager), 0)::bigint
  into v_total_rounds, v_net_delta, v_lifetime_wagered
  from public.game_events
  where user_id = p_user_id;

  select count(*)::integer, coalesce(sum(delta), 0)::integer, coalesce(sum(wager), 0)::bigint
  into v_weekly_rounds, v_weekly_net, v_weekly_wagered
  from public.game_events
  where user_id = p_user_id and created_at >= v_week_start;

  insert into public.leaderboard_aggregate (
    user_id, leaderboard_name, current_balance, total_rounds, net_delta,
    aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds,
    lifetime_wagered, weekly_wagered, avatar_url, updated_at
  ) values (
    p_user_id, v_name, v_balance, v_total_rounds, v_net_delta,
    coalesce(v_aura, 0), v_week_start, v_weekly_net, v_weekly_rounds,
    v_lifetime_wagered, v_weekly_wagered, v_avatar, now()
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
    lifetime_wagered = excluded.lifetime_wagered,
    weekly_wagered = excluded.weekly_wagered,
    avatar_url = excluded.avatar_url,
    updated_at = now();
end;
$$;

-- 5. Update apply_settlement to accept and store wager.
--    Drop previous signatures so Postgres allows the new one.
drop function if exists public.apply_settlement(text, text, integer);
drop function if exists public.apply_settlement(text, text, integer, integer, text);
drop function if exists public.apply_settlement(text, text, integer, integer, text, double precision);
drop function if exists public.apply_settlement(text, text, integer, integer, text, double precision, integer);

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer,
  p_coin_streak integer default null,
  p_last_daily text default null,
  p_crash_peak double precision default null,
  p_wager integer default 0
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  rakeback_pool numeric,
  event_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tokens integer;
  v_coin_streak integer;
  v_last_daily date;
  v_rakeback_pool numeric(12,2);
  v_event_id bigint;
  v_parsed_daily date;
  v_game text := lower(trim(coalesce(p_game, '')));
  v_streak_cap integer;
  v_crash_peak double precision;
  v_rb_accrue numeric(12,2) := 0;
  v_wager integer := greatest(coalesce(p_wager, 0), 0);
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  v_parsed_daily := null;
  if v_game = 'daily' and p_last_daily is not null and length(trim(p_last_daily)) >= 8 then
    begin
      v_parsed_daily := trim(p_last_daily)::date;
    exception when others then
      v_parsed_daily := null;
    end;
  end if;

  v_streak_cap := null;
  if v_game = 'coin' and p_coin_streak is not null then
    v_streak_cap := least(greatest(p_coin_streak, 0), 500000);
  end if;

  v_crash_peak := null;
  if v_game = 'crash' and p_crash_peak is not null then
    v_crash_peak := least(greatest(p_crash_peak::double precision, 1.0), 89.0);
  end if;

  -- Clamp wager to reasonable bounds (can't bet more than max allowed delta magnitude).
  if v_game in ('coin', 'rps', 'slots', 'bj', 'crash') then
    v_wager := least(v_wager, 250);
  else
    v_wager := 0;
  end if;

  -- Server-side rakeback: 10% of net loss on arcade games.
  if v_game in ('coin', 'rps', 'slots', 'bj', 'crash') and p_delta < 0 then
    v_rb_accrue := round(abs(p_delta::numeric) * 0.10, 2);
  end if;

  update public.wallets w
  set
    tokens = greatest(w.tokens + p_delta, 0),
    coin_streak = case
      when v_streak_cap is not null then greatest(coalesce(w.coin_streak, 0), v_streak_cap)
      else w.coin_streak
    end,
    last_daily = case
      when v_parsed_daily is not null then
        case
          when w.last_daily is null then v_parsed_daily
          when w.last_daily >= v_parsed_daily then w.last_daily
          else v_parsed_daily
        end
      else w.last_daily
    end,
    aura_peak_multiplier = case
      when v_crash_peak is not null then
        greatest(coalesce(w.aura_peak_multiplier, 0)::double precision, v_crash_peak)
      else coalesce(w.aura_peak_multiplier, 0)::double precision
    end,
    rakeback_pool = coalesce(w.rakeback_pool, 0) + v_rb_accrue
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak, w.last_daily, w.rakeback_pool
  into v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool;

  insert into public.game_events (user_id, game, detail, delta, balance_after, wager)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens, v_wager)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool, v_event_id;
end;
$$;

grant execute on function public.apply_settlement(text, text, integer, integer, text, double precision, integer) to authenticated;

-- 6. Update leaderboard views to expose wagered columns.
drop view if exists public.leaderboard_all_time;
create view public.leaderboard_all_time
with (security_invoker = true)
as
select
  user_id,
  leaderboard_name,
  lifetime_wagered,
  total_rounds,
  net_delta,
  aura_peak_multiplier as aura_peak,
  avatar_url
from public.leaderboard_aggregate;

drop view if exists public.leaderboard_weekly;
create view public.leaderboard_weekly
with (security_invoker = true)
as
select
  user_id,
  leaderboard_name,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_wagered else 0 end as weekly_wagered,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_rounds else 0 end as weekly_rounds,
  aura_peak_multiplier as aura_peak,
  avatar_url
from public.leaderboard_aggregate;

grant select on public.leaderboard_all_time to anon, authenticated;
grant select on public.leaderboard_weekly to anon, authenticated;

-- 7. Recreate RPCs with wagered columns and new sort order.
drop function if exists public.leaderboard_all_time_rows(integer);
drop function if exists public.leaderboard_weekly_rows(integer);

create or replace function public.leaderboard_all_time_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  lifetime_wagered bigint,
  total_rounds integer,
  net_delta integer,
  aura_peak double precision,
  avatar_url text
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    a.leaderboard_name,
    a.lifetime_wagered,
    a.total_rounds,
    a.net_delta,
    a.aura_peak_multiplier,
    a.avatar_url
  from public.leaderboard_aggregate a
  order by a.lifetime_wagered desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.leaderboard_weekly_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  weekly_wagered bigint,
  weekly_rounds integer,
  aura_peak double precision,
  avatar_url text
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
        then a.weekly_wagered else 0 end as weekly_wagered,
      case when a.weekly_week_start = date_trunc('week', now())::date
        then a.weekly_rounds else 0 end as weekly_rounds,
      a.aura_peak_multiplier as aura_peak,
      a.avatar_url
    from public.leaderboard_aggregate a
  )
  select c.leaderboard_name, c.weekly_wagered, c.weekly_rounds, c.aura_peak, c.avatar_url
  from current c
  order by c.weekly_wagered desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;

-- 8. Rebuild all leaderboard_aggregate rows (wagered columns start at 0 — clean slate).
insert into public.leaderboard_aggregate (
  user_id, leaderboard_name, current_balance, total_rounds, net_delta,
  aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds,
  lifetime_wagered, weekly_wagered, avatar_url, updated_at
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
  coalesce(sum(ge.wager), 0)::bigint,
  coalesce(sum(ge.wager) filter (where ge.created_at >= date_trunc('week', now())), 0)::bigint,
  p.avatar_url,
  now()
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge on ge.user_id = p.id
group by p.id, p.handle, p.display_name, p.avatar_url, w.tokens, w.aura_peak_multiplier
on conflict (user_id) do update set
  leaderboard_name = excluded.leaderboard_name,
  current_balance = excluded.current_balance,
  total_rounds = excluded.total_rounds,
  net_delta = excluded.net_delta,
  aura_peak_multiplier = excluded.aura_peak_multiplier,
  weekly_week_start = excluded.weekly_week_start,
  weekly_net_delta = excluded.weekly_net_delta,
  weekly_rounds = excluded.weekly_rounds,
  lifetime_wagered = excluded.lifetime_wagered,
  weekly_wagered = excluded.weekly_wagered,
  avatar_url = excluded.avatar_url,
  updated_at = now();
