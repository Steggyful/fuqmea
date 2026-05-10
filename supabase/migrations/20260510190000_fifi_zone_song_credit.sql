-- Adds song_credit_text to fifi_zone_settings so Vivid can credit whoever
-- wrote the background song (e.g. "Music by @Brother"). The field stores the
-- sanitised rich-text HTML produced by the admin editor (only <a href> survives).
--
-- Sentinel rules (same as song_url):
--   p_song_credit_text IS NULL  → leave current value unchanged
--   p_song_credit_text = ''     → clear the field
--   any other string            → set the field

alter table public.fifi_zone_settings
  add column if not exists song_credit_text text not null default '';

alter table public.fifi_zone_settings
  drop constraint if exists fifi_zone_settings_song_credit_text_check;

alter table public.fifi_zone_settings
  add constraint fifi_zone_settings_song_credit_text_check
  check (char_length(song_credit_text) <= 300);

-- Drop old 6-param signature before replacing with 7-param version.
drop function if exists public.set_fifi_zone_settings(text, text, text, text, text, numeric);

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

grant execute on function public.set_fifi_zone_settings(text, text, text, text, text, numeric, text)
  to authenticated;
