import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def patch_schema():
    p = ROOT / "supabase" / "schema.sql"
    t = p.read_text(encoding="utf-8")
    if "profiles_before_write" in t:
        print("schema.sql: skip (already has display_name)")
        return
    needle = (
        "create table if not exists public.profiles (\n"
        "  id uuid primary key references auth.users (id) on delete cascade,\n"
        "  handle text not null unique check (char_length(handle) between 3 and 24),\n"
        "  created_at timestamptz not null default now()\n"
        ");\n\n"
        "create table if not exists public.wallets ("
    )
    insert = (
        "create table if not exists public.profiles (\n"
        "  id uuid primary key references auth.users (id) on delete cascade,\n"
        "  handle text not null unique check (char_length(handle) between 3 and 24),\n"
        "  created_at timestamptz not null default now()\n"
        ");\n\n"
        "alter table public.profiles add column if not exists display_name text;\n\n"
        "alter table public.profiles drop constraint if exists profiles_display_name_len;\n"
        "alter table public.profiles add constraint profiles_display_name_len\n"
        "  check (display_name is null or (char_length(display_name) between 2 and 32));\n\n"
        "create or replace function public.profiles_before_write()\n"
        "returns trigger\n"
        "language plpgsql\n"
        "as $$\n"
        "begin\n"
        "  if new.display_name is not null then\n"
        "    new.display_name := trim(new.display_name);\n"
        "    if new.display_name = '' then\n"
        "      new.display_name := null;\n"
        "    end if;\n"
        "    if char_length(new.display_name) < 2 then\n"
        "      new.display_name := null;\n"
        "    end if;\n"
        "  end if;\n"
        "  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then\n"
        "    raise exception 'handle cannot be changed';\n"
        "  end if;\n"
        "  return new;\n"
        "end;\n"
        "$$;\n\n"
        "drop trigger if exists profiles_before_insert_update on public.profiles;\n"
        "create trigger profiles_before_insert_update\n"
        "before insert or update on public.profiles\n"
        "for each row execute function public.profiles_before_write();\n\n"
        "create table if not exists public.wallets ("
    )
    if needle not in t:
        sys.exit("schema.sql: anchor not found")
    t = t.replace(needle, insert)
    old_v = (
        "create or replace view public.leaderboard_all_time as\n"
        "select\n"
        "  p.id as user_id,\n"
        "  p.handle,\n"
        "  w.tokens as current_balance,\n"
        "  count(ge.id)::integer as total_rounds,\n"
        "  coalesce(sum(ge.delta), 0)::integer as net_delta\n"
        "from public.profiles p\n"
        "join public.wallets w on w.user_id = p.id\n"
        "left join public.game_events ge on ge.user_id = p.id\n"
        "group by p.id, p.handle, w.tokens;\n\n"
        "create or replace view public.leaderboard_weekly as\n"
        "select\n"
        "  p.id as user_id,\n"
        "  p.handle,\n"
        "  coalesce(sum(ge.delta), 0)::integer as weekly_net_delta,\n"
        "  count(ge.id)::integer as weekly_rounds\n"
        "from public.profiles p\n"
        "join public.wallets w on w.user_id = p.id\n"
        "left join public.game_events ge\n"
        "  on ge.user_id = p.id\n"
        " and ge.created_at >= date_trunc('week', now())\n"
        "group by p.id, p.handle;"
    )
    new_v = (
        "create or replace view public.leaderboard_all_time as\n"
        "select\n"
        "  p.id as user_id,\n"
        "  p.handle,\n"
        "  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,\n"
        "  w.tokens as current_balance,\n"
        "  count(ge.id)::integer as total_rounds,\n"
        "  coalesce(sum(ge.delta), 0)::integer as net_delta\n"
        "from public.profiles p\n"
        "join public.wallets w on w.user_id = p.id\n"
        "left join public.game_events ge on ge.user_id = p.id\n"
        "group by p.id, p.handle, p.display_name, w.tokens;\n\n"
        "create or replace view public.leaderboard_weekly as\n"
        "select\n"
        "  p.id as user_id,\n"
        "  p.handle,\n"
        "  coalesce(nullif(trim(p.display_name), ''), p.handle) as leaderboard_name,\n"
        "  coalesce(sum(ge.delta), 0)::integer as weekly_net_delta,\n"
        "  count(ge.id)::integer as weekly_rounds\n"
        "from public.profiles p\n"
        "join public.wallets w on w.user_id = p.id\n"
        "left join public.game_events ge\n"
        "  on ge.user_id = p.id\n"
        " and ge.created_at >= date_trunc('week', now())\n"
        "group by p.id, p.handle, p.display_name;"
    )
    if old_v not in t:
        sys.exit("schema.sql: old views not found")
    t = t.replace(old_v, new_v)
    p.write_text(t, encoding="utf-8")
    print("schema.sql: OK")


def patch_games_html():
    path = ROOT / "games.html"
    t = path.read_text(encoding="utf-8")
    if "games-cloud-profile-block" in t:
        print("games.html: skip")
        return
    needle = (
        "          <div class=\"games-cloud-signout-wrap\">\n"
        "            <button type=\"button\" class=\"button games-wallet-btn\" id=\"games-cloud-logout-btn\">Sign out</button>\n"
        "          </div>\n"
        "          <div id=\"games-cloud-email-block\">"
    )
    block = (
        "          <div class=\"games-cloud-signout-wrap\">\n"
        "            <button type=\"button\" class=\"button games-wallet-btn\" id=\"games-cloud-logout-btn\">Sign out</button>\n"
        "          </div>\n"
        "          <div id=\"games-cloud-profile-block\" class=\"games-cloud-profile-block\" hidden>\n"
        "            <label for=\"games-display-name\" class=\"games-rakeback-label\">Display name (leaderboard)</label>\n"
        "            <div class=\"games-cloud-profile-row\">\n"
        "              <input id=\"games-display-name\" type=\"text\" class=\"games-cloud-email\" maxlength=\"32\" placeholder=\"2–32 characters\" autocomplete=\"nickname\">\n"
        "              <button type=\"button\" class=\"button games-wallet-btn\" id=\"games-display-name-save\">Save</button>\n"
        "            </div>\n"
        "            <p class=\"games-history-hint\" id=\"games-display-name-hint\">Shown on the leaderboard instead of your handle when set. Leave blank to use your handle.</p>\n"
        "          </div>\n"
        "          <div id=\"games-cloud-email-block\">"
    )
    if needle not in t:
        sys.exit("games.html: anchor not found")
    t = t.replace(needle, block)
    t = t.replace("cloud-sync.js?v=1.1.0", "cloud-sync.js?v=1.2.0")
    t = t.replace("<th>Handle</th>", "<th>Name</th>", 1)
    path.write_text(t, encoding="utf-8")
    print("games.html: OK")


def patch_css():
    path = ROOT / "assets" / "css" / "styles.css"
    t = path.read_text(encoding="utf-8")
    if "games-cloud-profile-block" in t:
        print("styles.css: skip")
        return
    needle = ".games-cloud-signout-wrap {\n  margin-bottom: 0.6rem;\n}\n\n.games-cloud-panel,"
    ins = (
        ".games-cloud-signout-wrap {\n  margin-bottom: 0.6rem;\n}\n\n"
        ".games-cloud-profile-block {\n  margin-bottom: 0.75rem;\n  padding-top: 0.35rem;\n"
        "  border-top: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n"
        ".games-cloud-profile-row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 0.5rem;\n"
        "  align-items: center;\n  margin-top: 0.35rem;\n}\n\n"
        ".games-cloud-profile-row .games-cloud-email {\n  flex: 1 1 12rem;\n  min-width: 0;\n}\n\n"
        ".games-cloud-panel,"
    )
    if needle not in t:
        sys.exit("styles.css: anchor not found")
    path.write_text(t.replace(needle, ins), encoding="utf-8")
    print("styles.css: OK")


def patch_cloud_sync():
    path = ROOT / "assets" / "js" / "cloud-sync.js"
    t = path.read_text(encoding="utf-8")
    if "setProfileBlockVisible" in t:
        print("cloud-sync.js: skip")
        return

    old_ensure_plain = """  async function ensureProfile(me) {
    const u = me && me.id ? me : await getMe();
    const uid = u?.id;
    if (!uid) return null;
    const existing = await authFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,handle&limit=1`, {
      method: 'GET'
    });
    if (existing?.length) return existing[0];
    const handleBase = (handlePrefixFromUser(u) || 'fuq_player').slice(0, 20);
    const handle = `${handleBase}_${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 24);
    await authFetch('/rest/v1/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify([{ id: uid, handle }])
    });
    return { id: uid, handle };
  }"""

    new_ensure = """  async function ensureProfile(me) {
    const u = me && me.id ? me : await getMe();
    const uid = u?.id;
    if (!uid) return null;
    const existing = await authFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,handle,display_name&limit=1`, {
      method: 'GET'
    });
    if (existing?.length) return existing[0];
    const handleBase = (handlePrefixFromUser(u) || 'fuq_player').slice(0, 20);
    const handle = `${handleBase}_${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 24);
    const created = await authFetch('/rest/v1/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify([{ id: uid, handle }])
    });
    if (Array.isArray(created) && created[0]) return created[0];
    return { id: uid, handle, display_name: null };
  }"""

    if old_ensure_plain in t:
        t = t.replace(old_ensure_plain, new_ensure)
    else:
        sys.exit("cloud-sync.js: ensureProfile block not found")

    helpers = """  function setProfileBlockVisible(show) {
    const block = byId('games-cloud-profile-block');
    const inp = byId('games-display-name');
    if (block) block.hidden = !show;
    if (!show && inp) inp.value = '';
  }

  function syncProfileForm(profile) {
    const inp = byId('games-display-name');
    if (!inp) return;
    setProfileBlockVisible(true);
    inp.value = profile && profile.display_name != null ? String(profile.display_name) : '';
  }

  async function saveDisplayName() {
    const hint = byId('games-display-name-hint');
    const inp = byId('games-display-name');
    if (!inp || !isEnabled()) return;
    const raw = String(inp.value || '').trim();
    if (raw.length > 0 && raw.length < 2) {
      if (hint) hint.textContent = 'Use 2–32 characters, or leave blank to use your handle.';
      return;
    }
    if (raw.length > 32) {
      if (hint) hint.textContent = 'Max 32 characters.';
      return;
    }
    try {
      await maybeRefreshToken();
      const me = await getMe();
      const body = raw.length === 0 ? { display_name: null } : { display_name: raw };
      await authFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(me.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      if (hint) hint.textContent = 'Saved. Leaderboard refreshes below.';
      await loadLeaderboard();
    } catch {
      if (hint) hint.textContent = 'Could not save — try again.';
    }
  }

"""

    t = t.replace(
        "  function parseHashTokens() {",
        helpers + "  function parseHashTokens() {",
        1,
    )

    t = t.replace(
        """      const selectCols = leaderboardScope === 'weekly'
        ? 'handle,weekly_net_delta,weekly_rounds'
        : 'handle,current_balance,total_rounds,net_delta';""",
        """      const selectCols =
        leaderboardScope === 'weekly'
          ? 'leaderboard_name,weekly_net_delta,weekly_rounds'
          : 'leaderboard_name,current_balance,total_rounds,net_delta';""",
    )

    t = t.replace(
        """          return `<tr>
            <td>${idx + 1}</td>
            <td>${String(row.handle || 'player')}</td>
            <td>${score}</td>
            <td>${rounds}</td>
          </tr>`;""",
        """          const name = String(row.leaderboard_name || row.handle || 'player');
          return `<tr>
            <td>${idx + 1}</td>
            <td>${name}</td>
            <td>${score}</td>
            <td>${rounds}</td>
          </tr>`;""",
    )

    t = t.replace(
        "    byId('games-oauth-discord')?.addEventListener('click', () => startOAuth('discord'));\n\n    if (loginForm) {",
        "    byId('games-oauth-discord')?.addEventListener('click', () => startOAuth('discord'));\n    byId('games-display-name-save')?.addEventListener('click', () => {\n      saveDisplayName();\n    });\n\n    if (loginForm) {",
    )

    t = t.replace(
        """    logoutBtn.addEventListener('click', async () => {
      clearSession();
      updateCloudBadge('Cloud OFF', false);""",
        """    logoutBtn.addEventListener('click', async () => {
      clearSession();
      setProfileBlockVisible(false);
      updateCloudBadge('Cloud OFF', false);""",
    )

    t = t.replace(
        """    if (!isEnabled()) {
      updateCloudBadge('Cloud OFF', false);
      return;
    }""",
        """    if (!isEnabled()) {
      updateCloudBadge('Cloud OFF', false);
      setProfileBlockVisible(false);
      return;
    }""",
    )

    t = t.replace(
        """    if (!session?.accessToken) {
      updateCloudBadge('Cloud ready (login needed)', false);
      const m = byId('games-cloud-msg');""",
        """    if (!session?.accessToken) {
      updateCloudBadge('Cloud ready (login needed)', false);
      setProfileBlockVisible(false);
      const m = byId('games-cloud-msg');""",
    )

    t = t.replace(
        """      const me = await getMe();
      await ensureProfile(me);
      updateCloudBadge('Cloud ON', true);""",
        """      const me = await getMe();
      const prof = await ensureProfile(me);
      syncProfileForm(prof);
      updateCloudBadge('Cloud ON', true);""",
    )

    t = t.replace(
        """    } catch {
      clearSession();
      updateCloudBadge('Cloud OFF', false);
    }""",
        """    } catch {
      clearSession();
      setProfileBlockVisible(false);
      updateCloudBadge('Cloud OFF', false);
    }""",
    )

    path.write_text(t, encoding="utf-8")
    print("cloud-sync.js: OK")


def patch_readme():
    path = ROOT / "supabase" / "README.md"
    t = path.read_text(encoding="utf-8")
    if "Display name (leaderboard)" in t:
        print("README: skip")
        return
    marker = "## Part D — Install the database schema"
    ins = (
        "**Display name (leaderboard):** If your Supabase project already existed before this feature, run the new `display_name` / trigger / view section from `supabase/schema.sql` once in the SQL editor (or re-run the full file).\n\n"
        + marker
    )
    if marker not in t:
        sys.exit("README: Part D not found")
    path.write_text(t.replace(marker, ins, 1), encoding="utf-8")
    print("README: OK")


def main():
    patch_schema()
    patch_games_html()
    patch_css()
    patch_cloud_sync()
    patch_readme()
    print("Done. Local files only — no git commit.")


if __name__ == "__main__":
    main()
