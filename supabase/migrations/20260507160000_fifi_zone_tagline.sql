-- Add tagline (top text + optional link) to FiFi Zone settings
alter table public.fifi_zone_settings
  add column if not exists tagline_text text not null default '@SSGVivid on TikTok'
    check (char_length(tagline_text) <= 120),
  add column if not exists tagline_url  text not null default 'https://www.tiktok.com/@SSGVivid'
    check (char_length(tagline_url) <= 500);

-- Replace 2-param version with 4-param version
drop function if exists public.set_fifi_zone_settings(text, text);

create or replace function public.set_fifi_zone_settings(
  p_image_url    text default null,
  p_caption      text default null,
  p_tagline_text text default null,
  p_tagline_url  text default null
)
returns table (image_url text, caption text, tagline_text text, tagline_url text)
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
  v_img  text := nullif(trim(coalesce(p_image_url,    '')), '');
  v_cap  text := nullif(trim(coalesce(p_caption,      '')), '');
  v_tt   text := nullif(trim(coalesce(p_tagline_text, '')), '');
  v_tu   text := nullif(trim(coalesce(p_tagline_url,  '')), '');
begin
  if v_role not in ('admin', 'vivid') then raise exception 'not authorized'; end if;
  if v_img is not null and char_length(v_img) > 500 then raise exception 'image_url too long'; end if;
  if v_cap is not null and char_length(v_cap) > 200 then raise exception 'caption too long'; end if;
  if v_tt  is not null and char_length(v_tt)  > 120 then raise exception 'tagline_text too long'; end if;
  if v_tu  is not null and char_length(v_tu)  > 500 then raise exception 'tagline_url too long'; end if;
  update public.fifi_zone_settings
  set image_url    = coalesce(v_img, image_url),
      caption      = coalesce(v_cap, caption),
      tagline_text = coalesce(v_tt,  tagline_text),
      tagline_url  = coalesce(v_tu,  tagline_url),
      updated_at   = now()
  where id = 1;
  return query
    select s.image_url, s.caption, s.tagline_text, s.tagline_url
    from public.fifi_zone_settings s where s.id = 1;
end;
$$;

grant execute on function public.set_fifi_zone_settings(text, text, text, text) to authenticated;
