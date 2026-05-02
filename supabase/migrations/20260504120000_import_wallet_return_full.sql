-- import_initial_device_wallet: return rakeback_pool, arcade_streaks, aura_peak_multiplier
-- so import-device-wallet Edge JSON matches ensureWallet REST shape (client merges rely on this).

drop function if exists public.import_initial_device_wallet(integer, integer, text);

create or replace function public.import_initial_device_wallet(
  p_tokens integer,
  p_coin_streak integer,
  p_last_daily text
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  rakeback_pool numeric,
  arcade_streaks jsonb,
  aura_peak_multiplier double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_done boolean;
  v_cloud_played boolean;
  v_cap_tokens integer;
  v_cap_streak integer;
  v_daily date;
  v_existing_tokens integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(
    (select p.wallet_import_completed from public.profiles p where p.id = v_uid limit 1),
    false
  ) into v_done;

  select exists(select 1 from public.game_events where user_id = v_uid limit 1)
  into v_cloud_played;

  if v_cloud_played then
    update public.profiles
    set wallet_import_completed = true
    where id = v_uid
      and not coalesce(wallet_import_completed, false);
    return query
    select
      w.tokens,
      w.coin_streak,
      w.last_daily,
      w.rakeback_pool,
      w.arcade_streaks,
      w.aura_peak_multiplier
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  if v_done then
    return query
    select
      w.tokens,
      w.coin_streak,
      w.last_daily,
      w.rakeback_pool,
      w.arcade_streaks,
      w.aura_peak_multiplier
    from public.wallets w
    where w.user_id = v_uid;
    return;
  end if;

  v_cap_tokens := least(greatest(coalesce(p_tokens, 200), 200), 999999999);
  v_cap_streak := least(greatest(coalesce(p_coin_streak, 0), 0), 500000);

  begin
    if p_last_daily is not null and length(trim(p_last_daily)) >= 8 then
      v_daily := trim(p_last_daily)::date;
    else
      v_daily := null;
    end if;
  exception when others then
    v_daily := null;
  end;

  select w.tokens into v_existing_tokens from public.wallets w where w.user_id = v_uid limit 1;

  update public.wallets w
  set
    tokens = greatest(v_cap_tokens, coalesce(v_existing_tokens, 200)),
    coin_streak = greatest(v_cap_streak, coalesce(w.coin_streak, 0)),
    last_daily = coalesce(v_daily, w.last_daily)
  where w.user_id = v_uid;

  update public.profiles
  set wallet_import_completed = true
  where id = v_uid;

  return query
  select
    w.tokens,
    w.coin_streak,
    w.last_daily,
    w.rakeback_pool,
    w.arcade_streaks,
    w.aura_peak_multiplier
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

grant execute on function public.import_initial_device_wallet(integer, integer, text) to authenticated;
