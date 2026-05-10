-- Vivid admin panel: FiFi Zone editable settings + vivid role support
-- Grant role via Supabase Dashboard → Auth → Users → Edit user → app_metadata: {"role":"vivid"}

-- FiFi Zone settings singleton row (image + caption)
create table if not exists public.fifi_zone_settings (
  id smallint primary key check (id = 1),
  image_url text not null default 'assets/images/01 Vivid.jpg'
    check (char_length(image_url) <= 500),
  caption text not null default 'When she finds your FiFi'
    check (char_length(caption) <= 200),
  updated_at timestamptz not null default now()
);

insert into public.fifi_zone_settings (id, image_url, caption)
values (1, 'assets/images/01 Vivid.jpg', 'When she finds your FiFi')
on conflict (id) do nothing;

alter table public.fifi_zone_settings enable row level security;

drop policy if exists fifi_zone_settings_public_read on public.fifi_zone_settings;
create policy fifi_zone_settings_public_read on public.fifi_zone_settings
  for select to anon, authenticated using (true);

grant select on public.fifi_zone_settings to anon, authenticated;

-- Update admin_set_tiktok_live: admin = any streamer, vivid = ssgvivid only
create or replace function public.admin_set_tiktok_live(p_username text, p_live boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
begin
  if v_role = 'admin' then
    null;
  elsif v_role = 'vivid' then
    if lower(p_username) <> 'ssgvivid' then
      raise exception 'not authorized for this streamer';
    end if;
  else
    raise exception 'not authorized';
  end if;
  insert into public.streamer_live_status (username, tiktok_live)
  values (lower(p_username), p_live)
  on conflict (username) do update set tiktok_live = p_live, updated_at = now();
end;
$$;

-- Set FiFi Zone image + caption (admin or vivid role)
create or replace function public.set_fifi_zone_settings(
  p_image_url text,
  p_caption text
)
returns table (image_url text, caption text)
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
  v_img text := nullif(trim(coalesce(p_image_url, '')), '');
  v_cap text := nullif(trim(coalesce(p_caption, '')), '');
begin
  if v_role not in ('admin', 'vivid') then
    raise exception 'not authorized';
  end if;
  if v_img is not null and char_length(v_img) > 500 then
    raise exception 'image_url too long';
  end if;
  if v_cap is not null and char_length(v_cap) > 200 then
    raise exception 'caption too long';
  end if;
  update public.fifi_zone_settings
  set image_url = coalesce(v_img, image_url),
      caption   = coalesce(v_cap, caption),
      updated_at = now()
  where id = 1;
  return query select s.image_url, s.caption from public.fifi_zone_settings s where s.id = 1;
end;
$$;

grant execute on function public.set_fifi_zone_settings(text, text) to authenticated;
