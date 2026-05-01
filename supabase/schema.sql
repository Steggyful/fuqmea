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

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer,
  p_coin_streak integer default null,
  p_last_daily text default null
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

-- security_invoker = false: leaderboard must aggregate everyone's game_events. With default invoker=true,
-- RLS on game_events (owner-only read) hides other users' rows, so net_delta / rounds columns are ~0 while
-- current_balance still shows (wallets_public_read). Same broken behavior for anon + authenticated.
create or replace view public.leaderboard_all_time
with (security_invoker = false)
as
select
  p.id as user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,
  w.tokens as current_balance,
  count(ge.id)::integer as total_rounds,
  coalesce(sum(ge.delta), 0)::integer as net_delta
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge on ge.user_id = p.id
group by p.id, p.handle, p.display_name, w.tokens;

-- Weekly bucket: Postgres week starts Monday (date_trunc semantics). Server TZ is typically UTC on Supabase.
create or replace view public.leaderboard_weekly
with (security_invoker = false)
as
select
  p.id as user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,
  coalesce(sum(ge.delta), 0)::integer as weekly_net_delta,
  count(ge.id)::integer as weekly_rounds
from public.profiles p
join public.wallets w on w.user_id = p.id
left join public.game_events ge
  on ge.user_id = p.id
 and ge.created_at >= date_trunc('week', now())
group by p.id, p.handle, p.display_name;

-- Public leaderboard reads from the browser used to break (RLS on game_events + view invoker quirks).
-- Edge Function calls these with anon from the server; SECURITY DEFINER aggregates all players.
create or replace function public.leaderboard_all_time_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  current_balance integer,
  total_rounds integer,
  net_delta integer
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
      (coalesce(sum(ge.delta), 0))::integer as net_delta
    from public.profiles p
    inner join public.wallets w on w.user_id = p.id
    left join public.game_events ge on ge.user_id = p.id
    group by p.id, p.handle, p.display_name, w.tokens
  )
  select r.leaderboard_name, r.current_balance, r.total_rounds, r.net_delta
  from ranked r
  order by r.current_balance desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.leaderboard_weekly_rows(p_limit integer default 50)
returns table (
  leaderboard_name text,
  weekly_net_delta integer,
  weekly_rounds integer
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
      (count(ge.id))::integer as weekly_rounds
    from public.profiles p
    inner join public.wallets w on w.user_id = p.id
    left join public.game_events ge
      on ge.user_id = p.id
     and ge.created_at >= date_trunc('week', now())
    group by p.id, p.handle, p.display_name
  )
  select r.leaderboard_name, r.weekly_net_delta, r.weekly_rounds
  from ranked r
  order by r.weekly_net_delta desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.game_events enable row level security;

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

-- Leaderboard views join wallets; without this, RLS hides other users' balances (only your row visible).
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
grant execute on function public.apply_settlement(text, text, integer, integer, text) to authenticated;
grant execute on function public.ensure_wallet_exists(uuid) to authenticated;
grant execute on function public.import_initial_device_wallet(integer, integer, text) to authenticated;
grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
