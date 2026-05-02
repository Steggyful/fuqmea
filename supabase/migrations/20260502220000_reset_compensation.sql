-- Leaderboard reset compensation: credit 750 FUQ to all existing accounts.
-- Writes a game_events row per user so it appears in their history.
-- The leaderboard trigger fires automatically and updates each user's aggregate.

do $$
declare
  r record;
begin
  for r in
    select w.user_id, w.tokens
    from public.wallets w
    join public.profiles p on p.id = w.user_id
  loop
    update public.wallets
    set tokens = tokens + 750
    where user_id = r.user_id;

    insert into public.game_events (user_id, game, detail, delta, balance_after, wager)
    values (
      r.user_id,
      'compensation',
      'Leaderboard reset — sorry for the wipe, here''s 750 FUQ on us',
      750,
      r.tokens + 750,
      0
    );
  end loop;
end;
$$;
