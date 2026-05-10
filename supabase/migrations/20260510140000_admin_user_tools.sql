-- Admin user tools: ban, leaderboard exclusion, force display-name reset, event viewer.
-- All RPCs require app_metadata.role = 'admin' (set via Supabase Dashboard).

-- ── Profile flags ─────────────────────────────────────────────────────────
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_reason text
  check (banned_reason is null or char_length(banned_reason) <= 200);
alter table public.profiles add column if not exists leaderboard_excluded boolean not null default false;

-- ── Filtered leaderboard RPCs ─────────────────────────────────────────────
-- Override the two public leaderboards so banned + excluded users disappear from results.
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
  join public.profiles p on p.id = a.user_id
  where p.banned_at is null
    and coalesce(p.leaderboard_excluded, false) = false
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
      a.user_id,
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
  join public.profiles p on p.id = c.user_id
  where p.banned_at is null
    and coalesce(p.leaderboard_excluded, false) = false
  order by c.weekly_wagered desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ── Updated admin_list_users (now returns ban + excluded flags) ───────────
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  leaderboard_name text,
  handle text,
  tokens integer,
  net_delta integer,
  lifetime_wagered bigint,
  weekly_wagered bigint,
  weekly_rounds integer,
  rakeback_pool numeric,
  aura_peak double precision,
  banned_at timestamptz,
  banned_reason text,
  leaderboard_excluded boolean,
  created_at timestamptz
)
language plpgsql security definer set search_path = public stable as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  return query
  select
    p.id,
    coalesce(nullif(trim(p.display_name), ''), p.handle)::text,
    p.handle::text,
    w.tokens,
    coalesce(la.net_delta, 0)::integer,
    coalesce(la.lifetime_wagered, 0)::bigint,
    (case when la.weekly_week_start = date_trunc('week', now())::date then la.weekly_wagered else 0 end)::bigint,
    (case when la.weekly_week_start = date_trunc('week', now())::date then la.weekly_rounds else 0 end)::integer,
    coalesce(w.rakeback_pool, 0)::numeric,
    coalesce(w.aura_peak_multiplier, 0)::double precision,
    p.banned_at,
    p.banned_reason,
    coalesce(p.leaderboard_excluded, false),
    p.created_at
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  left join public.leaderboard_aggregate la on la.user_id = p.id
  order by w.tokens desc;
end;
$$;

-- ── Ban / unban ───────────────────────────────────────────────────────────
create or replace function public.admin_set_user_banned(
  p_user_id uuid, p_banned boolean, p_reason text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  if p_banned then
    update public.profiles
    set banned_at = now(),
        banned_reason = case when v_clean_reason is null then null
                             else left(v_clean_reason, 200) end
    where id = p_user_id;
  else
    update public.profiles
    set banned_at = null, banned_reason = null
    where id = p_user_id;
  end if;
  if not found then raise exception 'user_not_found'; end if;
  -- Refresh the aggregate so the leaderboard view reflects the change immediately.
  perform public.tg_refresh_leaderboard_aggregate(p_user_id);
end;
$$;

-- ── Toggle leaderboard exclusion (test accounts etc.) ─────────────────────
create or replace function public.admin_set_leaderboard_excluded(
  p_user_id uuid, p_excluded boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles
  set leaderboard_excluded = coalesce(p_excluded, false)
  where id = p_user_id;
  if not found then raise exception 'user_not_found'; end if;
end;
$$;

-- ── Force-clear display name (user must pick a new one next visit) ────────
create or replace function public.admin_clear_display_name(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.profiles
  set display_name = null
  where id = p_user_id;
  if not found then raise exception 'user_not_found'; end if;
  perform public.tg_refresh_leaderboard_aggregate(p_user_id);
end;
$$;

-- ── Game events viewer (recent activity for a single user) ────────────────
create or replace function public.admin_list_game_events(
  p_user_id uuid, p_limit integer default 50
)
returns table (
  id bigint,
  user_id uuid,
  game text,
  detail text,
  delta integer,
  wager integer,
  balance_after integer,
  created_at timestamptz
)
language plpgsql security definer set search_path = public stable as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  return query
  select e.id, e.user_id, e.game, e.detail, e.delta,
         e.wager, e.balance_after, e.created_at
  from public.game_events e
  where e.user_id = p_user_id
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

grant execute on function public.admin_set_user_banned(uuid, boolean, text)        to authenticated;
grant execute on function public.admin_set_leaderboard_excluded(uuid, boolean)     to authenticated;
grant execute on function public.admin_clear_display_name(uuid)                    to authenticated;
grant execute on function public.admin_list_game_events(uuid, integer)             to authenticated;
