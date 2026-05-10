-- Admin panel: streamer live status toggle + admin RPCs
-- All RPCs require app_metadata.role = 'admin' (set via Supabase Dashboard, never in code).

create table if not exists public.streamer_live_status (
  username text primary key check (char_length(username) between 1 and 32),
  tiktok_live boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.streamer_live_status (username, tiktok_live) values
  ('steggyful1', false),
  ('ssgvivid', false)
on conflict (username) do nothing;

alter table public.streamer_live_status enable row level security;

drop policy if exists streamer_live_status_public_read on public.streamer_live_status;
create policy streamer_live_status_public_read on public.streamer_live_status
  for select to anon, authenticated using (true);

grant select on public.streamer_live_status to anon, authenticated;

create or replace function public.admin_set_tiktok_live(p_username text, p_live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  insert into public.streamer_live_status (username, tiktok_live)
  values (lower(p_username), p_live)
  on conflict (username) do update set tiktok_live = p_live, updated_at = now();
end;
$$;

create or replace function public.admin_adjust_tokens(
  p_user_id uuid, p_delta integer, p_reason text default 'admin adjustment'
)
returns integer language plpgsql security definer set search_path = public as $$
declare v_new_tokens integer;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.wallets set tokens = greatest(tokens + p_delta, 0)
  where user_id = p_user_id returning tokens into v_new_tokens;
  if not found then raise exception 'user_not_found'; end if;
  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (p_user_id, 'admin', left(coalesce(p_reason, 'admin adjustment'), 160), p_delta, v_new_tokens);
  return v_new_tokens;
end;
$$;

create or replace function public.admin_reset_weekly(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.leaderboard_aggregate
  set weekly_net_delta = 0, weekly_rounds = 0, weekly_wagered = 0,
      weekly_week_start = date_trunc('week', now())::date, updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.admin_list_users()
returns table (
  user_id uuid, leaderboard_name text, handle text, tokens integer,
  net_delta integer, lifetime_wagered bigint, weekly_wagered bigint,
  weekly_rounds integer, rakeback_pool numeric, aura_peak double precision, created_at timestamptz
)
language plpgsql security definer set search_path = public stable as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  return query
  select p.id, coalesce(nullif(trim(p.display_name), ''), p.handle)::text,
    p.handle::text, w.tokens, coalesce(la.net_delta, 0)::integer,
    coalesce(la.lifetime_wagered, 0)::bigint,
    (case when la.weekly_week_start = date_trunc('week', now())::date then la.weekly_wagered else 0 end)::bigint,
    (case when la.weekly_week_start = date_trunc('week', now())::date then la.weekly_rounds else 0 end)::integer,
    coalesce(w.rakeback_pool, 0)::numeric, coalesce(w.aura_peak_multiplier, 0)::double precision, p.created_at
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  left join public.leaderboard_aggregate la on la.user_id = p.id
  order by w.tokens desc;
end;
$$;

grant execute on function public.admin_set_tiktok_live(text, boolean) to authenticated;
grant execute on function public.admin_adjust_tokens(uuid, integer, text) to authenticated;
grant execute on function public.admin_reset_weekly(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
