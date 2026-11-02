-- Re-assert RLS + grants for fifi_bird_progress and fifi_bird_run_sessions.
--
-- start_fifi_bird_run() now fails with 42501 ("new row violates row-level
-- security policy for table fifi_bird_run_sessions") even though auth.uid()
-- resolves correctly (the function's own not_authenticated check passes).
-- The policy text in schema.sql/migrations is correct (with check (auth.uid()
-- = user_id), matching exactly what the function inserts), which points at
-- the policy itself not actually existing as written in production -- most
-- likely from an earlier partial/out-of-order run of 20260509120000. This
-- migration is a pure re-assertion: every statement is idempotent
-- (drop-if-exists + create, or a plain re-grant), safe to run regardless of
-- the table's current actual state.

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

grant select, insert, update on public.fifi_bird_progress to authenticated;

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

-- A session row also needs to be SELECTable by its owner so record_fifi_bird_run's
-- "select ... for update" against it can find it under RLS (the original
-- migration never added this -- only insert/update were granted/policied).
drop policy if exists fifi_bird_run_sessions_owner_select on public.fifi_bird_run_sessions;
create policy fifi_bird_run_sessions_owner_select
on public.fifi_bird_run_sessions for select
to authenticated
using (auth.uid() = user_id);

grant select on public.fifi_bird_run_sessions to authenticated;
