-- Allow rich-text (sanitized HTML with <a> links) in fifi_zone_settings.tagline_text.
-- Bumps the length ceiling from 120 to 500 chars because the markup itself
-- consumes characters. The RPC and column-level CHECK both move to 500.
--
-- The client (vivid-admin.js) sanitises before save; only <a href> / target /
-- rel attributes survive. Server-side we just enforce the length ceiling.

alter table public.fifi_zone_settings
  drop constraint if exists fifi_zone_settings_tagline_text_check;

alter table public.fifi_zone_settings
  add constraint fifi_zone_settings_tagline_text_check
  check (char_length(tagline_text) <= 500);

create or replace function public.set_fifi_zone_settings(
  p_image_url    text    default null,
  p_caption      text    default null,
  p_tagline_text text    default null,
  p_tagline_url  text    default null,
  p_song_url     text    default null,
  p_song_volume  numeric default null
)
returns table (
  image_url    text,
  caption      text,
  tagline_text text,
  tagline_url  text,
  song_url     text,
  song_volume  numeric
)
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
  v_img  text := nullif(trim(coalesce(p_image_url,    '')), '');
  v_cap  text := nullif(trim(coalesce(p_caption,      '')), '');
  v_tt   text := nullif(trim(coalesce(p_tagline_text, '')), '');
  v_tu   text := nullif(trim(coalesce(p_tagline_url,  '')), '');
  v_su   text;
  v_sv   numeric := p_song_volume;
begin
  if v_role not in ('admin', 'vivid') then raise exception 'not authorized'; end if;
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

  update public.fifi_zone_settings as s
  set image_url    = coalesce(v_img, s.image_url),
      caption      = coalesce(v_cap, s.caption),
      tagline_text = coalesce(v_tt,  s.tagline_text),
      tagline_url  = coalesce(v_tu,  s.tagline_url),
      song_url     = coalesce(v_su,  s.song_url),
      song_volume  = coalesce(v_sv,  s.song_volume),
      updated_at   = now()
  where s.id = 1;

  return query
    select s.image_url, s.caption, s.tagline_text, s.tagline_url, s.song_url, s.song_volume
    from public.fifi_zone_settings s where s.id = 1;
end;
$$;

grant execute on function public.set_fifi_zone_settings(text, text, text, text, text, numeric)
  to authenticated;
