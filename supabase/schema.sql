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

-- Profile picture: unique claim per meme (UNIQUE constraint enforces one-meme-one-user).
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
declare
  v_fold text;
  v_kw text;
  -- Normalized substring check after stripping non-alphanumeric (see README). Expand via migrations.
  v_banned constant text[] := array[
    'nigger', 'nigga', 'chink', 'gook', 'spic', 'coon', 'beaner', 'wetback',
    'raghead', 'towelhead', 'honkey', 'kike', 'kyke',
    'faggot', 'fag', 'tranny',
    'hitler', 'nazi', '1488'
  ];
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
  if new.display_name is not null then
    v_fold := regexp_replace(lower(new.display_name), '[^[:alnum:]]+', '', 'g');
    foreach v_kw in array v_banned
    loop
      if position(v_kw in v_fold) > 0 then
        raise exception 'DISPLAY_NAME DISALLOWED'
          using errcode = '23514';
      end if;
    end loop;
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

-- Cross-device arcade bests (RPS / slots / BJ / Aura Farm peak). Current-run streaks stay client-only.
alter table public.wallets
  add column if not exists arcade_streaks jsonb not null default '{}'::jsonb;

-- Daily/weekly quest progress + claimed flags (MT day / ISO-ish week keys); sync via merge_quest_state RPC.
alter table public.wallets
  add column if not exists quest_state jsonb not null default '{}'::jsonb;

create table if not exists public.game_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (char_length(game) between 2 and 24),
  detail text not null default '',
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  wager integer not null default 0,
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

  -- Clamp wager to reasonable bounds; non-arcade games cannot wager.
  if v_game in ('coin', 'rps', 'slots', 'bj', 'crash') then
    v_wager := least(v_wager, 250);
  else
    v_wager := 0;
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

  insert into public.game_events (user_id, game, detail, delta, balance_after, wager)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens, v_wager)
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

-- Merge per-game best streaks + Aura peak from client; server stores greatest() per field (caps enforced).
drop function if exists public.merge_arcade_streaks(jsonb);

create or replace function public.merge_arcade_streaks(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
  v_e int;
  v_p int;
  v_eb int;
  v_pk_e double precision;
  v_pk_p double precision;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(w.arcade_streaks, '{}'::jsonb)
  into v_out
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if p_patch = '{}'::jsonb then
    return v_out;
  end if;

  if p_patch ? 'rps' and jsonb_typeof(p_patch -> 'rps') = 'object' and (p_patch -> 'rps') ? 'best' then
    v_e := coalesce((v_out -> 'rps' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'rps' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{rps}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'slots' and jsonb_typeof(p_patch -> 'slots') = 'object' and (p_patch -> 'slots') ? 'best' then
    v_e := coalesce((v_out -> 'slots' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'slots' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{slots}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'bj' and jsonb_typeof(p_patch -> 'bj') = 'object' and (p_patch -> 'bj') ? 'best' then
    v_e := coalesce((v_out -> 'bj' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'bj' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{bj}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'crash' and jsonb_typeof(p_patch -> 'crash') = 'object' then
    v_eb := coalesce((v_out -> 'crash' ->> 'best')::int, 0);
    v_pk_e := coalesce((v_out -> 'crash' ->> 'peakBankMult')::double precision, 0);
    if (p_patch -> 'crash') ? 'best' then
      v_eb := greatest(
        v_eb,
        least(greatest(coalesce((p_patch -> 'crash' ->> 'best')::int, 0), 0), 500000)
      );
    end if;
    if (p_patch -> 'crash') ? 'peakBankMult' then
      v_pk_p := (p_patch -> 'crash' ->> 'peakBankMult')::double precision;
      if v_pk_p is not null and v_pk_p > 0 then
        v_pk_p := least(greatest(v_pk_p, 1.0), 89.0);
        v_pk_e := greatest(v_pk_e, v_pk_p);
      end if;
    end if;
    v_out := jsonb_set(
      v_out,
      '{crash}',
      jsonb_build_object('best', v_eb, 'peakBankMult', v_pk_e),
      true
    );
  end if;

  update public.wallets w
  set arcade_streaks = v_out
  where w.user_id = v_uid;

  return v_out;
end;
$$;

-- First login only: copy device token balance into cloud if this account never played on-server.
-- Sets profiles.wallet_import_completed; skipped if already true or any game_events exist.
drop function if exists public.import_initial_device_wallet(integer, integer, text);

create or replace function public.import_initial_device_wallet(
  p_tokens integer,
  p_coin_streak integer,
  p_last_daily text
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  rakeback_pool numeric,
  arcade_streaks jsonb,
  aura_peak_multiplier double precision
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
    select
      w.tokens,
      w.coin_streak,
      w.last_daily,
      w.rakeback_pool,
      w.arcade_streaks,
      w.aura_peak_multiplier
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  if v_done then
    return query
    select
      w.tokens,
      w.coin_streak,
      w.last_daily,
      w.rakeback_pool,
      w.arcade_streaks,
      w.aura_peak_multiplier
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
  select
    w.tokens,
    w.coin_streak,
    w.last_daily,
    w.rakeback_pool,
    w.arcade_streaks,
    w.aura_peak_multiplier
  from public.wallets w
  where w.user_id = v_uid;
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
  lifetime_wagered bigint not null default 0,
  weekly_wagered bigint not null default 0,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard_aggregate
  add column if not exists avatar_url text;
alter table public.leaderboard_aggregate
  add column if not exists lifetime_wagered bigint not null default 0;
alter table public.leaderboard_aggregate
  add column if not exists weekly_wagered bigint not null default 0;

create index if not exists leaderboard_aggregate_balance_idx
  on public.leaderboard_aggregate (current_balance desc);
create index if not exists leaderboard_aggregate_weekly_idx
  on public.leaderboard_aggregate (weekly_week_start, weekly_net_delta desc);
create index if not exists leaderboard_aggregate_lifetime_wagered_idx
  on public.leaderboard_aggregate (lifetime_wagered desc);
create index if not exists leaderboard_aggregate_weekly_wagered_idx
  on public.leaderboard_aggregate (weekly_week_start, weekly_wagered desc);

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

  -- Profile or wallet not yet present; the wallet/profile insert trigger will fire again.
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
  after insert or update of handle, display_name, avatar_url on public.profiles
  for each row execute function public.tg_lb_after_profile();

-- One-shot backfill from existing rows (idempotent via ON CONFLICT). Safe to re-run.
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

-- Invoker views over the aggregate. RLS on leaderboard_aggregate handles the read; no SECURITY DEFINER bypass.
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
    then weekly_wagered else 0 end as weekly_wagered,
  case when weekly_week_start = date_trunc('week', now())::date
    then weekly_rounds else 0 end as weekly_rounds,
  aura_peak_multiplier as aura_peak,
  avatar_url
from public.leaderboard_aggregate;

-- RPCs read the aggregate via SECURITY INVOKER (RLS on the aggregate is public-read).
-- OUT/return shape changes require DROP first (CREATE OR REPLACE cannot change row type).
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
grant execute on function public.apply_settlement(text, text, integer, integer, text, double precision, integer) to authenticated;
grant execute on function public.claim_rakeback() to authenticated;
grant execute on function public.merge_arcade_streaks(jsonb) to authenticated;
grant execute on function public.ensure_wallet_exists(uuid) to authenticated;
grant execute on function public.import_initial_device_wallet(integer, integer, text) to authenticated;
grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
