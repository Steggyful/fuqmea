-- site_config: singleton table for sitewide settings editable from the admin panel.
-- First use: discord_invite_url — Discord invites expire; this lets admins update
-- the link across every page without a code deploy.

create table if not exists public.site_config (
  id                 smallint   primary key default 1,
  discord_invite_url text       not null default 'https://discord.com/invite/ZsFuQMEA',
  updated_at         timestamptz not null default now(),
  constraint site_config_singleton check (id = 1)
);

insert into public.site_config (id, discord_invite_url)
values (1, 'https://discord.com/invite/ZsFuQMEA')
on conflict (id) do nothing;

alter table public.site_config enable row level security;

create policy "public read site_config" on public.site_config
  for select using (true);

-- Admin-only RPC to update the Discord invite URL.
create or replace function public.admin_set_discord_url(p_url text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '');
  v_url  text := trim(p_url);
begin
  if v_role != 'admin' then raise exception 'not authorized'; end if;
  if v_url is null or v_url = '' then raise exception 'url cannot be empty'; end if;
  if not (
    v_url like 'https://discord.com/invite/%' or
    v_url like 'https://discord.gg/%'
  ) then
    raise exception 'url must be a discord.com/invite or discord.gg link';
  end if;
  if char_length(v_url) > 200 then raise exception 'url too long'; end if;

  update public.site_config
  set discord_invite_url = v_url,
      updated_at          = now()
  where id = 1;

  return v_url;
end;
$$;

grant execute on function public.admin_set_discord_url(text) to authenticated;
grant select on public.site_config to anon, authenticated;
