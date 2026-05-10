-- FiFi Bird: skill mini-game progress (no FUQ / no settle-game). Client-trusted stats for cross-device save.

create table if not exists public.fifi_bird_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  best_score integer not null default 0
    check (best_score >= 0 and best_score <= 999999),
  games_played integer not null default 0
    check (games_played >= 0),
  total_pipes bigint not null default 0
    check (total_pipes >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists fifi_bird_progress_updated_idx
  on public.fifi_bird_progress (updated_at desc);

alter table public.fifi_bird_progress enable row level security;

drop policy if exists fifi_bird_progress_owner_select on public.fifi_bird_progress;
create policy fifi_bird_progress_owner_select
on public.fifi_bird_progress for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists fifi_bird_progress_owner_insert on public.fifi_bird_progress;
create policy fifi_bird_progress_owner_insert
on public.fifi_bird_progress for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists fifi_bird_progress_owner_update on public.fifi_bird_progress;
create policy fifi_bird_progress_owner_update
on public.fifi_bird_progress for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- One run ended: increment counters, bump best. Clamped for sanity.
create or replace function public.record_fifi_bird_run(p_score integer, p_pipes integer)
returns table(best_score integer, games_played integer, total_pipes bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_score integer := least(greatest(coalesce(p_score, 0), 0), 999999);
  v_pipes integer := least(greatest(coalesce(p_pipes, 0), 0), 999999);
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.fifi_bird_progress (user_id, best_score, games_played, total_pipes)
  values (auth.uid(), v_score, 1, v_pipes::bigint)
  on conflict (user_id) do update set
    best_score = greatest(public.fifi_bird_progress.best_score, v_score),
    games_played = public.fifi_bird_progress.games_played + 1,
    total_pipes = public.fifi_bird_progress.total_pipes + v_pipes::bigint,
    updated_at = now();

  return query
  select p.best_score, p.games_played, p.total_pipes
  from public.fifi_bird_progress p
  where p.user_id = auth.uid();
end;
$$;

-- One-time guest stretch merge after sign-in (additive runs / pipes, max best).
create or replace function public.merge_fifi_bird_guest_local(
  p_best integer,
  p_extra_runs integer,
  p_extra_pipes bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_best integer := least(greatest(coalesce(p_best, 0), 0), 999999);
  v_runs integer := least(greatest(coalesce(p_extra_runs, 0), 0), 999999);
  v_pipes bigint := least(greatest(coalesce(p_extra_pipes, 0), 0), 9999999999);
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.fifi_bird_progress (user_id, best_score, games_played, total_pipes)
  values (auth.uid(), v_best, v_runs, v_pipes)
  on conflict (user_id) do update set
    best_score = greatest(public.fifi_bird_progress.best_score, v_best),
    games_played = public.fifi_bird_progress.games_played + v_runs,
    total_pipes = public.fifi_bird_progress.total_pipes + v_pipes,
    updated_at = now();
end;
$$;

grant select, insert, update on public.fifi_bird_progress to authenticated;

grant execute on function public.record_fifi_bird_run(integer, integer) to authenticated;
grant execute on function public.merge_fifi_bird_guest_local(integer, integer, bigint) to authenticated;
