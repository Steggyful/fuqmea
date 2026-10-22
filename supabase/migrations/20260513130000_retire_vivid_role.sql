-- Retires the 'vivid' app_metadata role. The FiFi Zone page is disabled
-- (fifi.html now just redirects home), so there is nothing left for that
-- role to usefully do, and access for it is being revoked outright.
--
-- This only updates what these functions ACCEPT — it does not touch anyone's
-- auth.users.app_metadata. To fully cut off a user who still holds
-- {"role":"vivid"}, also remove/change that in Supabase Dashboard -> Auth ->
-- Users -> (user) -> edit app_metadata. After this migration that role value
-- is inert either way: every function here now requires 'admin'.

create or replace function public.admin_set_tiktok_live(p_username text, p_live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  insert into public.streamer_live_status (username, tiktok_live)
  values (lower(p_username), p_live)
  on conflict (username) do update set tiktok_live = p_live, updated_at = now();
end;
$$;

create or replace function public.set_fifi_zone_settings(
  p_image_url         text    default null,
  p_caption           text    default null,
  p_tagline_text      text    default null,
  p_tagline_url       text    default null,
  p_song_url          text    default null,
  p_song_volume       numeric default null,
  p_song_credit_text  text    default null
)
returns table (
  image_url         text,
  caption           text,
  tagline_text      text,
  tagline_url       text,
  song_url          text,
  song_volume       numeric,
  song_credit_text  text
)
language plpgsql security definer set search_path = public as $$
declare
  v_role text    := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
  v_img  text    := nullif(trim(coalesce(p_image_url,    '')), '');
  v_cap  text    := nullif(trim(coalesce(p_caption,      '')), '');
  v_tt   text    := nullif(trim(coalesce(p_tagline_text, '')), '');
  v_tu   text    := nullif(trim(coalesce(p_tagline_url,  '')), '');
  v_su   text;
  v_sv   numeric := p_song_volume;
  v_sc   text;
begin
  if v_role <> 'admin' then raise exception 'not authorized'; end if;

  if v_img is not null and char_length(v_img) > 500 then raise exception 'image_url too long'; end if;
  if v_cap is not null and char_length(v_cap) > 200 then raise exception 'caption too long'; end if;
  if v_tt  is not null and char_length(v_tt)  > 500 then raise exception 'tagline_text too long'; end if;
  if v_tu  is not null and char_length(v_tu)  > 500 then raise exception 'tagline_url too long'; end if;

  if p_song_url is null then
    v_su := null;
  else
    v_su := trim(p_song_url);
    if char_length(v_su) > 500 then raise exception 'song_url too long'; end if;
  end if;

  if v_sv is not null and (v_sv < 0 or v_sv > 1) then
    raise exception 'song_volume out of range';
  end if;

  if p_song_credit_text is null then
    v_sc := null;
  else
    v_sc := trim(p_song_credit_text);
    if char_length(v_sc) > 300 then raise exception 'song_credit_text too long'; end if;
  end if;

  update public.fifi_zone_settings as s
  set image_url        = coalesce(v_img, s.image_url),
      caption          = coalesce(v_cap, s.caption),
      tagline_text     = coalesce(v_tt,  s.tagline_text),
      tagline_url      = coalesce(v_tu,  s.tagline_url),
      song_url         = coalesce(v_su,  s.song_url),
      song_volume      = coalesce(v_sv,  s.song_volume),
      song_credit_text = coalesce(v_sc,  s.song_credit_text),
      updated_at       = now()
  where s.id = 1;

  return query
    select s.image_url, s.caption, s.tagline_text, s.tagline_url,
           s.song_url, s.song_volume, s.song_credit_text
    from public.fifi_zone_settings s where s.id = 1;
end;
$$;
