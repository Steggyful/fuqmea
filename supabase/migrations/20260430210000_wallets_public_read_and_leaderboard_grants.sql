-- Keep in sync with supabase/schema.sql (RLS + grants used by leaderboard REST fallback).
-- Earlier migrations added security_invoker=false views and SECURITY DEFINER RPCs; without
-- wallets_public_read, PostgREST only exposes the signed-in user's wallet row and balances look wrong.

drop policy if exists wallets_public_read on public.wallets;

create policy wallets_public_read
on public.wallets for select
to anon, authenticated
using (true);

grant select on public.leaderboard_all_time to anon, authenticated;
grant select on public.leaderboard_weekly to anon, authenticated;
