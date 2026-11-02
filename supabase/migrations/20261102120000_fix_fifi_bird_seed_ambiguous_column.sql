-- Fix start_fifi_bird_run(): RETURNS TABLE(run_id uuid, seed bigint) makes
-- "seed" an output variable in scope for the whole function body, so the
-- unqualified `returning id, seed` was ambiguous between that variable and
-- fifi_bird_run_sessions.seed (error 42702). This was masked until now by
-- the bigint-overflow bug fixed in 20261101120000, which always raised
-- first -- execution never actually reached this RETURNING clause before.

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
    (floor(random() * 2.0e9)::bigint * 2000000000)
    + floor(random() * 2.0e9)::bigint;

  return query
  insert into public.fifi_bird_run_sessions (user_id, seed)
  values (v_uid, v_seed)
  returning id, fifi_bird_run_sessions.seed;
end;
$$;

grant execute on function public.start_fifi_bird_run() to authenticated;
