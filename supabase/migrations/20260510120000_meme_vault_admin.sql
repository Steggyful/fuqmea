-- Meme vault admin: catalog of all memes (static + uploaded), with display name overrides
-- and a draft/publish flow. Uploads live in Cloudflare R2; the storage_key stored here is
-- the R2 object key (rendered via memes.fuqmea.com). Static rows reference repo paths.

create table if not exists public.meme_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('static', 'upload')),
  -- static: gallery.json path (e.g. "assets/images/Cat - Smoke.PNG")
  -- upload: R2 object key (e.g. "uploads/<uuid>.png")
  storage_key text not null unique,
  -- Display name without extension; drives category extraction via " - " split.
  display_name text not null check (char_length(display_name) between 1 and 200),
  extension text not null check (char_length(extension) <= 10),
  published boolean not null default true,
  hidden boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meme_entries_visible_idx
  on public.meme_entries (published, hidden) where published = true and hidden = false;
create index if not exists meme_entries_source_idx on public.meme_entries (source);

alter table public.meme_entries enable row level security;

-- Public read: published rows are visible. Static rows are exposed even when
-- hidden=true so the client can filter them out of gallery.json (the public
-- meme list is static, so without this the hidden flag couldn't take effect).
drop policy if exists meme_entries_public_read on public.meme_entries;
create policy meme_entries_public_read on public.meme_entries
  for select to anon, authenticated
  using (
    published = true
    and (source = 'static' or hidden = false)
  );

grant select on public.meme_entries to anon, authenticated;

-- ── Admin RPCs ────────────────────────────────────────────────────────────

create or replace function public.admin_list_meme_entries()
returns setof public.meme_entries
language plpgsql security definer set search_path = public stable as $$
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  return query select * from public.meme_entries order by created_at desc;
end;
$$;

-- Idempotently register static memes from gallery.json. Admin UI calls this on load.
create or replace function public.admin_sync_static_memes(p_paths text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_path text;
  v_filename text;
  v_display_name text;
  v_extension text;
  v_count integer := 0;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;

  foreach v_path in array coalesce(p_paths, array[]::text[]) loop
    if v_path is null or length(v_path) = 0 then continue; end if;
    if exists (select 1 from public.meme_entries where storage_key = v_path) then continue; end if;

    v_filename := split_part(v_path, '/', array_length(string_to_array(v_path, '/'), 1));
    v_display_name := regexp_replace(v_filename, '\.[^.]+$', '');
    v_extension := lower(coalesce(substring(v_filename from '\.([^.]+)$'), ''));

    if v_display_name = '' or length(v_display_name) > 200 then continue; end if;
    if length(v_extension) > 10 then continue; end if;

    insert into public.meme_entries (source, storage_key, display_name, extension, published, hidden)
    values ('static', v_path, v_display_name, v_extension, true, false);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.admin_rename_meme(p_id uuid, p_display_name text)
returns public.meme_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.meme_entries;
  v_clean text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  if v_clean is null or char_length(v_clean) > 200 then
    raise exception 'invalid display name';
  end if;
  update public.meme_entries
  set display_name = v_clean, updated_at = now()
  where id = p_id
  returning * into v_entry;
  if not found then raise exception 'meme not found'; end if;
  return v_entry;
end;
$$;

create or replace function public.admin_set_meme_published(p_id uuid, p_published boolean)
returns public.meme_entries
language plpgsql security definer set search_path = public as $$
declare v_entry public.meme_entries;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.meme_entries
  set published = coalesce(p_published, false), updated_at = now()
  where id = p_id
  returning * into v_entry;
  if not found then raise exception 'meme not found'; end if;
  return v_entry;
end;
$$;

create or replace function public.admin_set_meme_hidden(p_id uuid, p_hidden boolean)
returns public.meme_entries
language plpgsql security definer set search_path = public as $$
declare v_entry public.meme_entries;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  update public.meme_entries
  set hidden = coalesce(p_hidden, false), updated_at = now()
  where id = p_id
  returning * into v_entry;
  if not found then raise exception 'meme not found'; end if;
  return v_entry;
end;
$$;

-- Called by upload-meme edge function after R2 PUT succeeds.
create or replace function public.admin_insert_uploaded_meme(
  p_storage_key text, p_display_name text, p_extension text
) returns public.meme_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.meme_entries;
  v_clean text := nullif(trim(coalesce(p_display_name, '')), '');
  v_ext text := lower(nullif(trim(coalesce(p_extension, '')), ''));
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  if v_clean is null or char_length(v_clean) > 200 then
    raise exception 'invalid display name';
  end if;
  if v_ext is null or char_length(v_ext) > 10 then
    raise exception 'invalid extension';
  end if;
  insert into public.meme_entries
    (source, storage_key, display_name, extension, published, hidden, uploaded_by)
  values
    ('upload', p_storage_key, v_clean, v_ext, false, false, auth.uid())
  returning * into v_entry;
  return v_entry;
end;
$$;

-- Returns the storage_key so the edge function can also delete from R2.
create or replace function public.admin_delete_uploaded_meme(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_storage_key text;
  v_source text;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'not authorized';
  end if;
  select storage_key, source into v_storage_key, v_source
  from public.meme_entries where id = p_id;
  if v_storage_key is null then raise exception 'meme not found'; end if;
  if v_source <> 'upload' then
    raise exception 'cannot delete static memes; use hide instead';
  end if;
  delete from public.meme_entries where id = p_id;
  return v_storage_key;
end;
$$;

grant execute on function public.admin_list_meme_entries()                     to authenticated;
grant execute on function public.admin_sync_static_memes(text[])               to authenticated;
grant execute on function public.admin_rename_meme(uuid, text)                 to authenticated;
grant execute on function public.admin_set_meme_published(uuid, boolean)       to authenticated;
grant execute on function public.admin_set_meme_hidden(uuid, boolean)          to authenticated;
grant execute on function public.admin_insert_uploaded_meme(text, text, text)  to authenticated;
grant execute on function public.admin_delete_uploaded_meme(uuid)              to authenticated;
