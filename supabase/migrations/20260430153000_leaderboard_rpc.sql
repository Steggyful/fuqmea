-- SECURITY DEFINER leaderboard RPC (called from Edge leaderboard function; Postgres ~15+)
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

grant execute on function public.leaderboard_all_time_rows(integer) to anon, authenticated;
grant execute on function public.leaderboard_weekly_rows(integer) to anon, authenticated;
