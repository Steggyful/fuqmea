-- Cross-device arcade best streaks (JSON on wallets) + merge_arcade_streaks RPC.
-- Idempotent: safe to re-run.

alter table public.wallets
  add column if not exists arcade_streaks jsonb not null default '{}'::jsonb;

drop function if exists public.merge_arcade_streaks(jsonb);

create or replace function public.merge_arcade_streaks(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
  v_e int;
  v_p int;
  v_eb int;
  v_pk_e double precision;
  v_pk_p double precision;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;

  perform public.ensure_wallet_exists(v_uid);

  select coalesce(w.arcade_streaks, '{}'::jsonb)
  into v_out
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if p_patch = '{}'::jsonb then
    return v_out;
  end if;

  if p_patch ? 'rps' and jsonb_typeof(p_patch -> 'rps') = 'object' and (p_patch -> 'rps') ? 'best' then
    v_e := coalesce((v_out -> 'rps' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'rps' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{rps}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'slots' and jsonb_typeof(p_patch -> 'slots') = 'object' and (p_patch -> 'slots') ? 'best' then
    v_e := coalesce((v_out -> 'slots' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'slots' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{slots}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'bj' and jsonb_typeof(p_patch -> 'bj') = 'object' and (p_patch -> 'bj') ? 'best' then
    v_e := coalesce((v_out -> 'bj' ->> 'best')::int, 0);
    v_p := least(greatest(coalesce((p_patch -> 'bj' ->> 'best')::int, 0), 0), 500000);
    v_out := jsonb_set(v_out, '{bj}', jsonb_build_object('best', greatest(v_e, v_p)), true);
  end if;

  if p_patch ? 'crash' and jsonb_typeof(p_patch -> 'crash') = 'object' then
    v_eb := coalesce((v_out -> 'crash' ->> 'best')::int, 0);
    v_pk_e := coalesce((v_out -> 'crash' ->> 'peakBankMult')::double precision, 0);
    if (p_patch -> 'crash') ? 'best' then
      v_eb := greatest(
        v_eb,
        least(greatest(coalesce((p_patch -> 'crash' ->> 'best')::int, 0), 0), 500000)
      );
    end if;
    if (p_patch -> 'crash') ? 'peakBankMult' then
      v_pk_p := (p_patch -> 'crash' ->> 'peakBankMult')::double precision;
      if v_pk_p is not null and v_pk_p > 0 then
        v_pk_p := least(greatest(v_pk_p, 1.0), 89.0);
        v_pk_e := greatest(v_pk_e, v_pk_p);
      end if;
    end if;
    v_out := jsonb_set(
      v_out,
      '{crash}',
      jsonb_build_object('best', v_eb, 'peakBankMult', v_pk_e),
      true
    );
  end if;

  update public.wallets w
  set arcade_streaks = v_out
  where w.user_id = v_uid;

  return v_out;
end;
$$;

grant execute on function public.merge_arcade_streaks(jsonb) to authenticated;
