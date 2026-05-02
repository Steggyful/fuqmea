-- Full leaderboard reset: wipe all game_events, reset aura peaks in wallets,
-- then rebuild leaderboard_aggregate from scratch (all stats start at zero).
-- Token balances are preserved. Run once alongside the wagered_tracking migration.

-- 1. Clear all round history so tg_refresh_leaderboard_aggregate computes zeros.
truncate public.game_events restart identity;

-- 2. Reset aura peak for all players (stored in wallets, fed into leaderboard by trigger).
update public.wallets set aura_peak_multiplier = 0;

-- 3. Rebuild leaderboard_aggregate from empty game_events — all stats become zero.
insert into public.leaderboard_aggregate (
  user_id, leaderboard_name, current_balance, total_rounds, net_delta,
  aura_peak_multiplier, weekly_week_start, weekly_net_delta, weekly_rounds,
  lifetime_wagered, weekly_wagered, avatar_url, updated_at
)
select
  p.id,
  coalesce(nullif(trim(p.display_name), ''), p.handle),
  w.tokens,
  0,
  0,
  0,
  date_trunc('week', now())::date,
  0,
  0,
  0,
  0,
  p.avatar_url,
  now()
from public.profiles p
join public.wallets w on w.user_id = p.id
on conflict (user_id) do update set
  current_balance = excluded.current_balance,
  total_rounds = 0,
  net_delta = 0,
  aura_peak_multiplier = 0,
  weekly_week_start = excluded.weekly_week_start,
  weekly_net_delta = 0,
  weekly_rounds = 0,
  lifetime_wagered = 0,
  weekly_wagered = 0,
  updated_at = now();
