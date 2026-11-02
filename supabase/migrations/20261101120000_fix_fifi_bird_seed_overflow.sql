-- Fix start_fifi_bird_run(): the original seed math overflowed bigint on
-- essentially every call (worst case ~2.09e21 vs bigint's ~9.22e18 ceiling),
-- so every signed-in FiFi Bird round silently failed to open a verified
-- session. Runs then fell back to the unverified path and were never written
-- to fifi_bird_progress, which is why the FiFi Bird leaderboard stayed empty
-- even though personal on-device stats looked fine.

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

  -- Two independent draws combined into one bigint. Max is
  -- ~2.0e9 * 2.0e9 + 2.0e9 ≈ 4.0e18, safely under bigint's ~9.22e18 ceiling.
  v_seed :=
    (floor(random() * 2.0e9)::bigint * 2000000000)
    + floor(random() * 2.0e9)::bigint;

  return query
  insert into public.fifi_bird_run_sessions (user_id, seed)
  values (v_uid, v_seed)
  returning id, seed;
end;
$$;

grant execute on function public.start_fifi_bird_run() to authenticated;
