-- FUQ Arcade cloud persistence schema (Supabase Postgres)
-- Run in Supabase SQL editor (canonical full install).
-- Incremental CLI patches that mirror this file: see supabase/migrations/*.sql (keep in sync when editing).

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (char_length(handle) between 3 and 24),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;

-- One-time merge of offline device wallet into cloud (see import_initial_device_wallet).
alter table public.profiles add column if not exists wallet_import_completed boolean not null default false;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or (char_length(display_name) between 2 and 32));

-- Case-insensitive unique display names (null/blank = use handle on leaderboard; many nulls allowed)
drop index if exists profiles_display_name_lower_unique;
create unique index profiles_display_name_lower_unique
  on public.profiles (lower(trim(display_name)))
  where display_name is not null and trim(display_name) <> '';

create or replace function public.profiles_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.display_name is not null then
    new.display_name := trim(new.display_name);
    if new.display_name = '' then
      new.display_name := null;
    end if;
    if char_length(new.display_name) < 2 then
      new.display_name := null;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    raise exception 'handle cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_before_insert_update on public.profiles;
create trigger profiles_before_insert_update
before insert or update on public.profiles
for each row execute function public.profiles_before_write();

create table if not exists public.wallets (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  tokens integer not null default 200 check (tokens >= 0),
  coin_streak integer not null default 0 check (coin_streak >= 0),
  last_daily date,
  updated_at timestamptz not null default now()
);

alter table public.wallets
  add column if not exists aura_peak_multiplier double precision not null default 0;

-- Rakeback (server-side): 10% of |delta| accrues automatically on arcade losses inside
-- apply_settlement. Claim flow is the dedicated claim_rakeback() RPC below.
alter table public.wallets
  add column if not exists rakeback_pool numeric(12,2) not null default 0
    check (rakeback_pool >= 0);

create table if not exists public.game_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (char_length(game) between 2 and 24),
  detail text not null default '',
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists game_events_user_created_idx
  on public.game_events (user_id, created_at desc);

create index if not exists game_events_created_idx
  on public.game_events (created_at desc);

create or replace function public.tg_set_wallet_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.tg_set_wallet_updated_at();

create or replace function public.ensure_wallet_exists(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

drop function if exists public.apply_settlement(text, text, integer);
drop function if exists public.apply_settlement(text, text, integer, integer, text);
drop function if exists public.apply_settlement(text, text, integer, integer, text, double precision);

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

  -- Server-side rakeback: 10% of net loss on arcade games, fractional cents preserved.
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

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool, v_event_id;
end;
$$;

-- Claim accrued rakeback: floors the pool to a whole-FUQ payout, keeps the fractional
-- remainder for the next claim, credits wallet tokens, and writes a 'rakeback_claim' game event.
drop function if exists public.claim_rakeback();

create or replace function public.claim_rakeback()
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  aura_peak_multiplier double precision,
  rakeback_pool numeric,
  paid integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pool numeric(12,2);
  v_pay integer;
  v_rem numeric(12,2);
  v_balance_after integer;
  v_streak integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(w.rakeback_pool, 0) into v_pool
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if v_pool is null then
    raise exception 'wallet_not_found';
  end if;

  v_pay := floor(v_pool)::integer;
  if v_pay <= 0 then
    raise exception 'no_rakeback_to_claim';
  end if;
  v_rem := v_pool - v_pay;

  update public.wallets w
  set
    tokens = w.tokens + v_pay,
    rakeback_pool = v_rem,
    updated_at = now()
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak into v_balance_after, v_streak;

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, 'rakeback_claim', concat('Claimed ', v_pay::text, ' FUQ'), v_pay, v_balance_after);

  return query
  select w.tokens, w.coin_streak, w.last_daily, w.aura_peak_multiplier, w.rakeback_pool, v_pay
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

-- First login only: copy device token balance into cloud if this account never played on-server.
-- Sets profiles.wallet_import_completed; skipped if already true or any game_events exist.
create or replace function public.import_initial_device_wallet(
  p_tokens integer,
  p_coin_streak integer,
  p_last_daily text
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_done boolean;
  v_cloud_played boolean;
  v_cap_tokens integer;
  v_cap_streak integer;
  v_daily date;
  v_existing_tokens integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(
    (select p.wallet_import_completed from public.profiles p where p.id = v_uid limit 1),
    false
  ) into v_done;

  select exists(select 1 from public.game_events where user_id = v_uid limit 1)
  into v_cloud_played;

  if v_cloud_played then
    update public.profiles
    set wallet_import_completed = true
    where id = v_uid
      and not coalesce(wallet_import_completed, false);
    return query
    select w.tokens, w.coin_streak, w.last_daily
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  if v_done then
    return query
    select w.tokens, w.coin_streak, w.last_daily
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  v_cap_tokens := least(greatest(coalesce(p_tokens, 200), 200), 999999999);
  v_cap_streak := least(greatest(coalesce(p_coin_streak, 0), 0), 500000);

  begin
    if p_last_daily is not null and length(trim(p_last_daily)) >= 8 then
      v_daily := trim(p_last_daily)::date;
    else
      v_daily := null;
    end if;
  exception when others then
    v_daily := null;
  end;

  select w.tokens into v_existing_tokens from public.wallets w where w.user_id = v_uid limit 1;

  update public.wallets w
  set
    tokens = greatest(v_cap_tokens, coalesce(v_existing_tokens, 200)),
    coin_streak = greatest(v_cap_streak, coalesce(w.coin_streak, 0)),
    last_daily = coalesce(v_daily, w.last_daily)
  where w.user_id = v_uid;

  update public.profiles
  set wallet_import_completed = true
  where id = v_uid;

  return query
  select w.tokens, w.coin_streak, w.last_daily from public.wallets w where w.user_id = v_uid;
end;
$$;

-- Leaderboard storage: a denormalized per-user aggregate table populated by triggers below.
-- Public-readable via RLS; the SECURITY DEFINER trigger function is the only writer.
-- Replaces older SECURITY DEFINER views that bypassed RLS on game_events.
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

-- One-shot backfill from existing rows (idempotent via ON CONFLICT). Safe to re-run.
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

-- Invoker views over the aggregate. RLS on leaderboard_aggregate handles the read; no SECURITY DEFINER bypass.
-- Same column shapes as the previous definer views so the client REST fallback continues to work unchanged.
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

-- Weekly view zeros out stale-week rows so users who haven't played this week show 0/0 in weekly columns.
-- Postgres week starts Monday (date_trunc semantics); server TZ is typically UTC on Supabase.
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

-- RPCs read the aggregate via SECURITY INVOKER (RLS on the aggregate is public-read).
-- OUT/return shape changes require DROP first (CREATE OR REPLACE cannot change row type).
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

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.game_events enable row level security;
alter table public.leaderboard_aggregate enable row level security;

-- Aggregate is leaderboard-safe by construction (no per-event detail), so public select is fine.
-- No insert/update/delete policies; only the SECURITY DEFINER trigger function writes.
drop policy if exists leaderboard_aggregate_public_read on public.leaderboard_aggregate;
create policy leaderboard_aggregate_public_read
on public.leaderboard_aggregate for select
to anon, authenticated
using (true);

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists profiles_owner_write on public.profiles;
create policy profiles_owner_write
on public.profiles for all
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists wallets_owner_all on public.wallets;
drop policy if exists wallets_owner_select on public.wallets;
create policy wallets_owner_select
on public.wallets for select
to authenticated
using (auth.uid() = user_id);

-- Public balance readability for things that look up other users' wallets directly.
-- Note: the leaderboard no longer relies on this policy (it reads from leaderboard_aggregate).
-- Kept to avoid breaking existing client paths; safe to tighten later if no direct wallet reads remain.
drop policy if exists wallets_public_read on public.wallets;
create policy wallets_public_read
on public.wallets for select
to anon, authenticated
using (true);

drop policy if exists wallets_owner_insert on public.wallets;
create policy wallets_owner_insert
on public.wallets for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists game_events_owner_read on public.game_events;
create policy game_events_owner_read
on public.game_events for select
to authenticated
using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.leaderboard_all_time to anon, authenticated;
grant select on public.leaderboard_weekly to anon, authenticated;
grant execute on function public.apply_settlement(text, text, integer, integer, text, double precision) to authenticated;
grant execute on function public.claim_rakeback() to authenticated;
grant execute on function public.ensure_wallet_exists(uuid) to authenticated;
grant execute on function public.import_initial_device_wallet(integer, integer, text) to authenticated;
grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
