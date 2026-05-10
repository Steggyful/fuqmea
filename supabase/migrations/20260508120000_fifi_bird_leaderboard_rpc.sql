-- FiFi Bird public leaderboard (client-reported best_score; honor system).
-- SECURITY DEFINER so anon can read rankings without broad select on fifi_bird_progress.

create or replace function public.fifi_bird_leaderboard_rows(p_limit integer default 50)
returns table(
  leaderboard_name text,
  best_score integer,
  games_played integer,
  total_pipes bigint,
  avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(nullif(trim(p.display_name), ''), p.handle)::text as leaderboard_name,
    f.best_score,
    f.games_played,
    f.total_pipes,
    p.avatar_url
  from public.fifi_bird_progress f
  inner join public.profiles p on p.id = f.user_id
  where f.games_played > 0 or f.best_score > 0 or f.total_pipes > 0
  order by f.best_score desc, f.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function public.fifi_bird_leaderboard_rows(integer) to anon, authenticated;
