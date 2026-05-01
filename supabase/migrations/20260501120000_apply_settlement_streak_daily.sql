-- apply_settlement: optional coin streak + last_daily for cross-device wallet parity
drop function if exists public.apply_settlement(text, text, integer);

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer,
  p_coin_streak integer default null,
  p_last_daily text default null
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  event_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tokens integer;
  v_coin_streak integer;
  v_last_daily date;
  v_event_id bigint;
  v_parsed_daily date;
  v_game text := lower(trim(coalesce(p_game, '')));
  v_streak_cap integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  v_parsed_daily := null;
  if v_game = 'daily' and p_last_daily is not null and length(trim(p_last_daily)) >= 8 then
    begin
      v_parsed_daily := trim(p_last_daily)::date;
    exception when others then
      v_parsed_daily := null;
    end;
  end if;

  v_streak_cap := null;
  if v_game = 'coin' and p_coin_streak is not null then
    v_streak_cap := least(greatest(p_coin_streak, 0), 500000);
  end if;

  update public.wallets w
  set
    tokens = greatest(w.tokens + p_delta, 0),
    coin_streak = case
      when v_streak_cap is not null then greatest(coalesce(w.coin_streak, 0), v_streak_cap)
      else w.coin_streak
    end,
    last_daily = case
      when v_parsed_daily is not null then
        case
          when w.last_daily is null then v_parsed_daily
          when w.last_daily >= v_parsed_daily then w.last_daily
          else v_parsed_daily
        end
      else w.last_daily
    end
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak, w.last_daily
  into v_tokens, v_coin_streak, v_last_daily;

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_event_id;
end;
$$;

grant execute on function public.apply_settlement(text, text, integer, integer, text) to authenticated;
