-- Profile pictures: each meme from gallery.json can be claimed by exactly one user.
-- The UNIQUE constraint is the full claim-once enforcement (race → constraint violation).

alter table public.profiles
  add column if not exists avatar_url text unique
    check (
      avatar_url is null
      or (
        avatar_url like 'assets/images/%'
        and avatar_url not like '%..%'
        and avatar_url not like '%//%'
      )
    );

alter table public.leaderboard_aggregate
  add column if not exists avatar_url text;

-- Rebuild leaderboard refresh function to copy avatar_url from profiles
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
  v_week_start date := date_trunc('week', now())::date;
  v_weekly_net integer;
  v_weekly_rounds integer;
begin
  select coalesce(nullif(trim(p.display_name), ''), p.handle), w.tokens, w.aura_peak_multiplier, p.avatar_url
  into v_name, v_balance, v_aura, v_avatar
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = p_user_id;

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
    aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds,
    avatar_url, updated_at
  ) values (
    p_user_id, v_name, v_balance, v_total_rounds, v_net_delta,
    coalesce(v_aura, 0), v_week_start, v_weekly_net, v_weekly_rounds,
    v_avatar, now()
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
    avatar_url = excluded.avatar_url,
    updated_at = now();
end;
$$;

-- Fire leaderboard refresh on avatar_url changes too
drop trigger if exists profiles_lb_refresh on public.profiles;
create trigger profiles_lb_refresh
  after insert or update of handle, display_name, avatar_url on public.profiles
  for each row execute function public.tg_lb_after_profile();

-- Rebuild views to expose avatar_url (column shape change requires DROP + recreate)
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
    then weekly_net_delta else 0 end as weekly_net_delta,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_rounds else 0 end as weekly_rounds,
  aura_peak_multiplier as aura_peak,
  avatar_url
from public.leaderboard_aggregate;

-- Rebuild RPCs (DROP required when return shape changes)
drop function if exists public.leaderboard_all_time_rows(integer);
drop function if exists public.leaderboard_weekly_rows(integer);

create or replace function public.leaderboard_all_time_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  current_balance integer,
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
    a.current_balance,
    a.total_rounds,
    a.net_delta,
    a.aura_peak_multiplier,
    a.avatar_url
  from public.leaderboard_aggregate a
  order by a.current_balance desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.leaderboard_weekly_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  weekly_net_delta integer,
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
        then a.weekly_net_delta else 0 end as weekly_net_delta,
      case when a.weekly_week_start = date_trunc('week', now())::date
        then a.weekly_rounds else 0 end as weekly_rounds,
      a.aura_peak_multiplier as aura_peak,
      a.avatar_url
    from public.leaderboard_aggregate a
  )
  select c.leaderboard_name, c.weekly_net_delta, c.weekly_rounds, c.aura_peak, c.avatar_url
  from current c
  order by c.weekly_net_delta desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
