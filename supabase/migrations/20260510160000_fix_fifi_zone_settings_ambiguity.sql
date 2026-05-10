-- Fix: set_fifi_zone_settings was throwing 'column reference "image_url" is ambiguous'
-- on every save. The RETURNS TABLE column names collide with the target table's
-- columns inside the UPDATE body; aliasing the target table disambiguates.
--
-- Also corrects the seed image_url, which pointed at a non-existent file
-- (assets/images/01 Vivid.jpg) and 404'd on the FiFi page.

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

  update public.fifi_zone_settings as s
  set image_url    = coalesce(v_img, s.image_url),
      caption      = coalesce(v_cap, s.caption),
      tagline_text = coalesce(v_tt,  s.tagline_text),
      tagline_url  = coalesce(v_tu,  s.tagline_url),
      updated_at   = now()
  where s.id = 1;

  return query
    select s.image_url, s.caption, s.tagline_text, s.tagline_url
    from public.fifi_zone_settings s where s.id = 1;
end;
$$;

-- Repair the seed image so the public FiFi page stops 404ing while the admin
-- chooses something real. Only update if it's still pointing at the broken default.
update public.fifi_zone_settings
set image_url = 'assets/images/01 Vivid - Shocked.jpg'
where id = 1 and image_url = 'assets/images/01 Vivid.jpg';
