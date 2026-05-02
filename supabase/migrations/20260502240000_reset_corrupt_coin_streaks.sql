-- Reset all coin_streak values to 0.
-- The previous apply_settlement used greatest(old, client) which meant losses
-- never decremented the server value — it accumulated all-time wins.
-- This corrupted wallets.coin_streak and, via syncCoinBestFromWallet, inflated
-- the client-side s.coin.best in localStorage.
-- After running 20260502230000_fix_coin_streak_reset.sql the server now trusts
-- the client value directly, so streaks will track correctly going forward.
-- This one-time wipe removes the bad historical data.

update public.wallets
set coin_streak = 0;
