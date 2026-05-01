-- Display name moderation (profiles.display_name). Mirrors schema.sql profiles_before_write.

create or replace function public.profiles_before_write()
returns trigger
language plpgsql
as $$
declare
  v_fold text;
  v_kw text;
  v_banned constant text[] := array[
    'nigger', 'nigga', 'chink', 'gook', 'spic', 'coon', 'beaner', 'wetback',
    'raghead', 'towelhead', 'honkey', 'kike', 'kyke',
    'faggot', 'fag', 'tranny',
    'hitler', 'nazi', '1488'
  ];
begin
  if new.display_name is not null then
    new.display_name := trim(new.display_name);
    if new.display_name = '' then
      new.display_name := null;
    end if;
    if char_length(new.display_name) < 2 then
      new.display_name := null;
    end if;
  end if;
  if new.display_name is not null then
    v_fold := regexp_replace(lower(new.display_name), '[^[:alnum:]]+', '', 'g');
    foreach v_kw in array v_banned
    loop
      if position(v_kw in v_fold) > 0 then
        raise exception 'DISPLAY_NAME DISALLOWED'
          using errcode = '23514';
      end if;
    end loop;
  end if;
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    raise exception 'handle cannot be changed';
  end if;
  return new;
end;
$$;
