-- FiFi Bird: server-verified runs (one-time session + duration plausibility). Replaces blind trust RPC.

create table if not exists public.fifi_bird_run_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  duration_ms integer,
  score integer
);

create index if not exists fifi_bird_run_sessions_user_created_idx
  on public.fifi_bird_run_sessions (user_id, created_at desc);

alter table public.fifi_bird_run_sessions enable row level security;

drop policy if exists fifi_bird_run_sessions_owner_insert on public.fifi_bird_run_sessions;
create policy fifi_bird_run_sessions_owner_insert
on public.fifi_bird_run_sessions for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists fifi_bird_run_sessions_owner_update on public.fifi_bird_run_sessions;
create policy fifi_bird_run_sessions_owner_update
on public.fifi_bird_run_sessions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.fifi_bird_run_sessions to authenticated;

-- New verified run: drop any stale open session, issue fresh id + seed for client RNG.
create or replace function public.start_fifi_bird_run()
returns table(run_id uuid, seed bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_seed bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.fifi_bird_run_sessions
  where user_id = v_uid and consumed_at is null;

  v_seed :=
    (floor(random() * 1.0e15)::bigint * 1300021)
    + (floor(random() * 1.0e15)::bigint * 790007);

  return query
  insert into public.fifi_bird_run_sessions (user_id, seed)
  values (v_uid, v_seed)
  returning id, seed;
end;
$$;

-- Record a finished run: must match an open session; score vs duration plausibility (not full physics replay).
create or replace function public.record_fifi_bird_run(
  p_run_id uuid,
  p_score integer,
  p_pipes integer,
  p_duration_ms integer
)
returns table(best_score integer, games_played integer, total_pipes bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score integer := least(greatest(coalesce(p_score, 0), 0), 999999);
  v_pipes integer := least(greatest(coalesce(p_pipes, 0), 0), 999999);
  v_dur integer := greatest(0, coalesce(p_duration_ms, 0));
  v_max_score integer;
  s record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_run_id is null then
    raise exception 'fifi_missing_run_id';
  end if;

  if v_score <> v_pipes then
    raise exception 'fifi_score_pipes_mismatch';
  end if;

  select * into s
  from public.fifi_bird_run_sessions
  where id = p_run_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'fifi_invalid_run';
  end if;

  if s.consumed_at is not null then
    raise exception 'fifi_run_already_used';
  end if;

  if s.created_at < now() - interval '25 minutes' then
    raise exception 'fifi_run_expired';
  end if;

  if v_score > 0 and v_dur < 320 then
    raise exception 'fifi_run_too_short';
  end if;

  if v_dur > 18 * 60 * 1000 then
    raise exception 'fifi_run_too_long';
  end if;

  -- Upper bound: ~210ms per counted gap equivalent + startup slack (tunable).
  v_max_score := v_dur / 210 + 18;
  if v_score > v_max_score then
    raise exception 'fifi_implausible_score';
  end if;

  update public.fifi_bird_run_sessions
  set consumed_at = now(), duration_ms = v_dur, score = v_score
  where id = p_run_id;

  insert into public.fifi_bird_progress (user_id, best_score, games_played, total_pipes)
  values (v_uid, v_score, 1, v_pipes::bigint)
  on conflict (user_id) do update set
    best_score = greatest(public.fifi_bird_progress.best_score, v_score),
    games_played = public.fifi_bird_progress.games_played + 1,
    total_pipes = public.fifi_bird_progress.total_pipes + v_pipes::bigint,
    updated_at = now();

  return query
  select p.best_score, p.games_played, p.total_pipes
  from public.fifi_bird_progress p
  where p.user_id = v_uid;
end;
$$;

drop function if exists public.record_fifi_bird_run(integer, integer);

grant execute on function public.start_fifi_bird_run() to authenticated;
grant execute on function public.record_fifi_bird_run(uuid, integer, integer, integer) to authenticated;
