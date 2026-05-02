-- Cross-device daily/weekly quest progress + claimed flags (wallets.quest_state) +
-- merge_quest_state RPC + apply_settlement_quest_claim for idempotent quest payouts.
-- Quest period keys match games.js: MT calendar day YYYY-MM-DD and ISO-ish week YYYY-Www.
-- Leaderboard weekly scope may still use UTC week in Postgres — documented in README.

alter table public.wallets
  add column if not exists quest_state jsonb not null default '{}'::jsonb;

-- Union two JSON arrays of quest id strings (distinct, sorted for stability).
create or replace function public._quest_claimed_union(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_agg(to_jsonb(elem) order by elem)
      from (
        select distinct jsonb_array_elements_text(coalesce(a, '[]'::jsonb)) as elem
        union
        select distinct jsonb_array_elements_text(coalesce(b, '[]'::jsonb)) as elem
      ) u
      where elem is not null and length(trim(elem)) > 0
    ),
    '[]'::jsonb
  );
$$;

-- Merge progress objects: numeric keys use greatest; playedSlugs merges per-key max.
create or replace function public._merge_quest_prog(vd jsonb, vp jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  k text;
  v numeric;
  ve numeric;
  vp_obj jsonb;
  vd_obj jsonb;
  out_obj jsonb := coalesce(vd, '{}'::jsonb);
  ks text;
  n1 int;
  n2 int;
begin
  if vp is null or jsonb_typeof(vp) <> 'object' then
    return out_obj;
  end if;

  for k in select jsonb_object_keys(vp)
  loop
    if k = 'playedSlugs' then
      vp_obj := vp -> 'playedSlugs';
      vd_obj := out_obj -> 'playedSlugs';
      if vp_obj is null or jsonb_typeof(vp_obj) <> 'object' then
        continue;
      end if;
      if vd_obj is null or jsonb_typeof(vd_obj) <> 'object' then
        vd_obj := '{}'::jsonb;
      end if;
      for ks in select jsonb_object_keys(vp_obj)
      loop
        n1 := coalesce((vd_obj ->> ks)::numeric, 0);
        n2 := coalesce((vp_obj ->> ks)::numeric, 0);
        vd_obj := jsonb_set(vd_obj, array[ks], to_jsonb(greatest(n1, n2)::integer), true);
      end loop;
      out_obj := jsonb_set(out_obj, '{playedSlugs}', vd_obj, true);
    else
      ve := coalesce((out_obj ->> k)::numeric, 0);
      v := coalesce((vp ->> k)::numeric, 0);
      if v <> 0 or ve <> 0 then
        out_obj := jsonb_set(out_obj, array[k], to_jsonb(greatest(ve, v)::integer), true);
      end if;
    end if;
  end loop;
  return out_obj;
end;
$$;

drop function if exists public.merge_quest_state(jsonb);

create or replace function public.merge_quest_state(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_base jsonb;
  v_out jsonb;
  pd jsonb;
  vd jsonb;
  pw jsonb;
  vw jsonb;
  d_day text;
  vd_day text;
  w_week text;
  vw_week text;
  merged jsonb;
  merged_ids jsonb;
  merged_claimed jsonb;
  merged_prog jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(w.quest_state, '{}'::jsonb)
  into v_base
  from public.wallets w
  where w.user_id = v_uid
  for update;

  v_out := v_base;

  pd := p_patch -> 'daily';
  if pd is not null and jsonb_typeof(pd) = 'object' and pd ? 'day' then
    d_day := pd ->> 'day';
    vd := coalesce(v_out -> 'daily', '{}'::jsonb);
    vd_day := vd ->> 'day';
    if vd_day is null or vd_day < d_day then
      v_out := jsonb_set(v_out, '{daily}', pd, true);
    elsif vd_day = d_day then
      merged_prog := public._merge_quest_prog(vd -> 'prog', pd -> 'prog');
      merged_claimed := public._quest_claimed_union(vd -> 'claimed', pd -> 'claimed');
      if jsonb_typeof(coalesce(pd -> 'ids', '[]'::jsonb)) = 'array'
         and jsonb_array_length(coalesce(pd -> 'ids', '[]'::jsonb)) = 4 then
        merged_ids := pd -> 'ids';
      else
        merged_ids := vd -> 'ids';
      end if;
      merged := jsonb_build_object(
        'day', to_jsonb(d_day),
        'ids', coalesce(merged_ids, '[]'::jsonb),
        'prog', coalesce(merged_prog, '{}'::jsonb),
        'claimed', coalesce(merged_claimed, '[]'::jsonb)
      );
      v_out := jsonb_set(v_out, '{daily}', merged, true);
    end if;
  end if;

  pw := p_patch -> 'weekly';
  if pw is not null and jsonb_typeof(pw) = 'object' and pw ? 'week' then
    w_week := pw ->> 'week';
    vw := coalesce(v_out -> 'weekly', '{}'::jsonb);
    vw_week := vw ->> 'week';
    if vw_week is null or vw_week < w_week then
      v_out := jsonb_set(v_out, '{weekly}', pw, true);
    elsif vw_week = w_week then
      merged_prog := vw -> 'prog';
      if merged_prog is null or jsonb_typeof(merged_prog) <> 'object' then
        merged_prog := '{}'::jsonb;
      end if;
      merged_prog := jsonb_build_object(
        'totalRounds', greatest(
          coalesce((merged_prog ->> 'totalRounds')::numeric, 0),
          coalesce((pw -> 'prog' ->> 'totalRounds')::numeric, 0)
        )::integer,
        'fuqEarned', greatest(
          coalesce((merged_prog ->> 'fuqEarned')::numeric, 0),
          coalesce((pw -> 'prog' ->> 'fuqEarned')::numeric, 0)
        )::integer
      );
      merged_claimed := public._quest_claimed_union(vw -> 'claimed', pw -> 'claimed');
      if jsonb_typeof(coalesce(pw -> 'ids', '[]'::jsonb)) = 'array'
         and jsonb_array_length(coalesce(pw -> 'ids', '[]'::jsonb)) = 2 then
        merged_ids := pw -> 'ids';
      else
        merged_ids := vw -> 'ids';
      end if;
      merged := jsonb_build_object(
        'week', to_jsonb(w_week),
        'ids', coalesce(merged_ids, '[]'::jsonb),
        'prog', merged_prog,
        'claimed', coalesce(merged_claimed, '[]'::jsonb)
      );
      v_out := jsonb_set(v_out, '{weekly}', merged, true);
    end if;
  end if;

  update public.wallets w
  set quest_state = v_out
  where w.user_id = v_uid;

  return v_out;
end;
$$;

grant execute on function public.merge_quest_state(jsonb) to authenticated;

drop function if exists public.apply_settlement_quest_claim(text, text, integer, text, text);

create or replace function public.apply_settlement_quest_claim(
  p_game text,
  p_detail text,
  p_delta integer,
  p_period_key text,
  p_quest_id text
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
  v_uid uuid := auth.uid();
  v_qs jsonb;
  jo jsonb;
  v_new_qs jsonb;
  v_claimed jsonb;
  v_tokens integer;
  v_coin_streak integer;
  v_last_daily date;
  v_rakeback_pool numeric(12,2);
  v_event_id bigint;
  g text := lower(trim(coalesce(p_game, '')));
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if g not in ('quest', 'quest_weekly') then
    raise exception 'invalid_quest_game';
  end if;
  if p_period_key is null or length(trim(p_period_key)) < 4 then
    raise exception 'invalid_period_key';
  end if;
  if p_quest_id is null or length(trim(p_quest_id)) < 2 then
    raise exception 'invalid_quest_id';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(w.quest_state, '{}'::jsonb)
  into v_qs
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if g = 'quest' then
    jo := coalesce(v_qs -> 'daily', '{}'::jsonb);
    if jo ->> 'day' is not null and jo ->> 'day' is distinct from trim(p_period_key) then
      raise exception 'daily_quest_period_mismatch';
    end if;
    if jo ->> 'day' is null then
      jo := jsonb_build_object(
        'day', to_jsonb(trim(p_period_key)),
        'ids', '[]'::jsonb,
        'prog', '{}'::jsonb,
        'claimed', '[]'::jsonb
      );
    end if;
    v_claimed := coalesce(jo -> 'claimed', '[]'::jsonb);
    if exists (
      select 1 from jsonb_array_elements_text(v_claimed) as e(val)
      where val = trim(p_quest_id)
    ) then
      raise exception 'quest_already_claimed';
    end if;
    v_claimed := v_claimed || jsonb_build_array(to_jsonb(trim(p_quest_id)));
    jo := jsonb_set(jo, '{claimed}', v_claimed, true);
    v_new_qs := jsonb_set(v_qs, '{daily}', jo, true);
  else
    jo := coalesce(v_qs -> 'weekly', '{}'::jsonb);
    if jo ->> 'week' is not null and jo ->> 'week' is distinct from trim(p_period_key) then
      raise exception 'weekly_quest_period_mismatch';
    end if;
    if jo ->> 'week' is null then
      jo := jsonb_build_object(
        'week', to_jsonb(trim(p_period_key)),
        'ids', '[]'::jsonb,
        'prog', jsonb_build_object('totalRounds', 0, 'fuqEarned', 0),
        'claimed', '[]'::jsonb
      );
    end if;
    v_claimed := coalesce(jo -> 'claimed', '[]'::jsonb);
    if exists (
      select 1 from jsonb_array_elements_text(v_claimed) as e(val)
      where val = trim(p_quest_id)
    ) then
      raise exception 'quest_already_claimed';
    end if;
    v_claimed := v_claimed || jsonb_build_array(to_jsonb(trim(p_quest_id)));
    jo := jsonb_set(jo, '{claimed}', v_claimed, true);
    v_new_qs := jsonb_set(v_qs, '{weekly}', jo, true);
  end if;

  update public.wallets w
  set
    tokens = greatest(w.tokens + p_delta, 0),
    quest_state = v_new_qs
  where w.user_id = v_uid
  returning w.tokens, w.coin_streak, w.last_daily, w.rakeback_pool
  into v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool;

  insert into public.game_events (user_id, game, detail, delta, balance_after)
  values (v_uid, p_game, left(coalesce(p_detail, ''), 160), p_delta, v_tokens)
  returning id into v_event_id;

  return query
  select v_tokens, v_coin_streak, v_last_daily, v_rakeback_pool, v_event_id;
end;
$$;

grant execute on function public.apply_settlement_quest_claim(text, text, integer, text, text) to authenticated;

-- import_initial_device_wallet: include quest_state in return shape (matches REST wallets row).
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
  aura_peak_multiplier double precision,
  quest_state jsonb
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
      w.aura_peak_multiplier,
      w.quest_state
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
      w.aura_peak_multiplier,
      w.quest_state
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
    w.aura_peak_multiplier,
    w.quest_state
  from public.wallets w
  where w.user_id = v_uid;
end;
$$;

grant execute on function public.import_initial_device_wallet(integer, integer, text) to authenticated;
