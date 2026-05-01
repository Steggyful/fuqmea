-- FUQ Arcade cloud persistence schema (Supabase Postgres)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (char_length(handle) between 3 and 24),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;

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

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer
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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  update public.wallets
  set tokens = greatest(tokens + p_delta, 0)
  where user_id = v_uid
  returning wallets.tokens, wallets.coin_streak, wallets.last_daily
  into v_tokens, v_coin_streak, v_last_daily;

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_event_id;
end;
$$;

create or replace view public.leaderboard_all_time as
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

create or replace view public.leaderboard_weekly as
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
grant execute on function public.apply_settlement(text, text, integer) to authenticated;
grant execute on function public.ensure_wallet_exists(uuid) to authenticated;
