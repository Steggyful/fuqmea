-- Aura Farm peak multiplier on wallets + optional crash peak on settle; leaderboard column aura_peak.

drop function if exists public.apply_settlement(text, text, integer);
drop function if exists public.apply_settlement(text, text, integer, integer, text);

alter table public.wallets
  add column if not exists aura_peak_multiplier double precision not null default 0;

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer,
  p_coin_streak integer default null,
  p_last_daily text default null,
  p_crash_peak double precision default null
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
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
  v_event_id bigint;
  v_parsed_daily date;
  v_game text := lower(trim(coalesce(p_game, '')));
  v_streak_cap integer;
  v_crash_peak double precision;
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
    end
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak, w.last_daily
  into v_tokens, v_coin_streak, v_last_daily;

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_event_id;
end;
$$;

create or replace view public.leaderboard_all_time
with (security_invoker = false)
as
select
  p.id as user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,
  w.tokens as current_balance,
  count(ge.id)::integer as total_rounds,
  coalesce(sum(ge.delta), 0)::integer as net_delta,
  coalesce(w.aura_peak_multiplier, 0)::double precision as aura_peak
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge on ge.user_id = p.id
group by p.id, p.handle, p.display_name, w.tokens, w.aura_peak_multiplier;

create or replace view public.leaderboard_weekly
with (security_invoker = false)
as
select
  p.id as user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,
  coalesce(sum(ge.delta), 0)::integer as weekly_net_delta,
  count(ge.id)::integer as weekly_rounds,
  max(coalesce(w.aura_peak_multiplier, 0))::double precision as aura_peak
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge
  on ge.user_id = p.id
 and ge.created_at >= date_trunc('week', now())
group by p.id, p.handle, p.display_name;

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
security definer
set search_path = public
stable
as $$
  with ranked as (
    select
      coalesce(nullif(trim(p.display_name), ''), p.handle)::text as leaderboard_name,
      (w.tokens)::integer as current_balance,
      (count(ge.id))::integer as total_rounds,
      (coalesce(sum(ge.delta), 0))::integer as net_delta,
      coalesce(w.aura_peak_multiplier, 0)::double precision as aura_peak
    from public.profiles p
    inner join public.wallets w on w.user_id = p.id
    left join public.game_events ge on ge.user_id = p.id
    group by p.id, p.handle, p.display_name, w.tokens, w.aura_peak_multiplier
  )
  select r.leaderboard_name, r.current_balance, r.total_rounds, r.net_delta, r.aura_peak
  from ranked r
  order by r.current_balance desc nulls last
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
security definer
set search_path = public
stable
as $$
  with ranked as (
    select
      coalesce(nullif(trim(p.display_name), ''), p.handle)::text as leaderboard_name,
      (coalesce(sum(ge.delta), 0))::integer as weekly_net_delta,
      (count(ge.id))::integer as weekly_rounds,
      max(coalesce(w.aura_peak_multiplier, 0))::double precision as aura_peak
    from public.profiles p
    inner join public.wallets w on w.user_id = p.id
    left join public.game_events ge
      on ge.user_id = p.id
     and ge.created_at >= date_trunc('week', now())
    group by p.id, p.handle, p.display_name
  )
  select r.leaderboard_name, r.weekly_net_delta, r.weekly_rounds, r.aura_peak
  from ranked r
  order by r.weekly_net_delta desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function public.apply_settlement(text, text, integer, integer, text, double precision) to authenticated;
grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
