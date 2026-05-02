-- Fix: coin_streak was using greatest(old, new) which prevented resets on loss.
-- Client sends coinStreak=0 on a loss; server must trust that value directly.
-- Idempotent: safe to re-run.

drop function if exists public.apply_settlement(text, text, integer, integer, text, double precision, integer);

create or replace function public.apply_settlement(
  p_game text,
  p_detail text,
  p_delta integer,
  p_coin_streak integer default null,
  p_last_daily text default null,
  p_crash_peak double precision default null,
  p_wager integer default 0
)
returns table (
  tokens integer,
  coin_streak integer,
  last_daily date,
  rakeback_pool numeric,
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
  v_rakeback_pool numeric(12,2);
  v_event_id bigint;
  v_parsed_daily date;
  v_game text := lower(trim(coalesce(p_game, '')));
  v_streak_cap integer;
  v_crash_peak double precision;
  v_rb_accrue numeric(12,2) := 0;
  v_wager integer := greatest(coalesce(p_wager, 0), 0);
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

  v_crash_peak := null;
  if v_game = 'crash' and p_crash_peak is not null then
    v_crash_peak := least(greatest(p_crash_peak::double precision, 1.0), 89.0);
  end if;

  if v_game in ('coin', 'rps', 'slots', 'bj', 'crash') then
    v_wager := least(v_wager, 250);
  else
    v_wager := 0;
  end if;

  if v_game in ('coin', 'rps', 'slots', 'bj', 'crash') and p_delta < 0 then
    v_rb_accrue := round(abs(p_delta::numeric) * 0.10, 2);
  end if;

  update public.wallets w
  set
    tokens = greatest(w.tokens + p_delta, 0),
    -- Trust the client's streak value directly (not greatest) so losses correctly reset to 0.
    coin_streak = case
      when v_streak_cap is not null then v_streak_cap
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
    end,
    aura_peak_multiplier = case
      when v_crash_peak is not null then
        greatest(coalesce(w.aura_peak_multiplier, 0)::double precision, v_crash_peak)
      else coalesce(w.aura_peak_multiplier, 0)::double precision
    end,
    rakeback_pool = coalesce(w.rakeback_pool, 0) + v_rb_accrue
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak, w.last_daily, w.rakeback_pool
  into v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool;

  insert into public.game_events (user_id, game, detail, delta, balance_after, wager)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens, v_wager)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool, v_event_id;
end;
$$;

grant execute on function public.apply_settlement(text, text, integer, integer, text, double precision, integer) to authenticated;
