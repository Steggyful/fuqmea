-- Minimal migration: leaderboard views aggregate game_events; default security_invoker
-- causes RLS to hide other players' rows. Requires Postgres 15+ (Supabase standard).
CREATE OR REPLACE VIEW public.leaderboard_all_time WITH (security_invoker = false) AS
SELECT
  p.id AS user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) AS leaderboard_name,
  w.tokens AS current_balance,
  count(ge.id)::integer AS total_rounds,
  coalesce(sum(ge.delta), 0)::integer AS net_delta
FROM public.profiles p
JOIN public.wallets w ON w.user_id = p.id
LEFT JOIN public.game_events ge ON ge.user_id = p.id
GROUP BY p.id, p.handle, p.display_name, w.tokens;

CREATE OR REPLACE VIEW public.leaderboard_weekly WITH (security_invoker = false) AS
SELECT
  p.id AS user_id,
  p.handle,
  coalesce(nullif(trim(p.display_name), ''), p.handle) AS leaderboard_name,
  coalesce(sum(ge.delta), 0)::integer AS weekly_net_delta,
  count(ge.id)::integer AS weekly_rounds
FROM public.profiles p
JOIN public.wallets w ON w.user_id = p.id
LEFT JOIN public.game_events ge
  ON ge.user_id = p.id AND ge.created_at >= date_trunc('week', now())
GROUP BY p.id, p.handle, p.display_name;
