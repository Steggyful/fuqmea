# FUQ Cloud Setup (Supabase)

Your site stays on **GitHub Pages** (static files only). Supabase is the backend: login, saved FUQ balance, game events for leaderboards.

You **do not** write backend code locally beyond what is already in this repo. Follow the steps below in order.

---

## Concepts (30 seconds)

| Term | Meaning |
|------|--------|
| **Project URL** | Your Supabase API base (`https://xxxxx.supabase.co`). |
| **anon key** | Public browser key — safe for the website; locked down by **Row Level Security** in the database. |
| **schema** | The SQL tables, views, and rules we install once. |
| **Edge Function** | A small server that runs settlement logic and talks to Postgres with your login token. |

**Never put the service role / secret keys in GitHub Pages or `cloud-config.js`.** Only the anon key belongs in the frontend.

---

## Part A — Sign up and create a project

1. Go to [supabase.com](https://supabase.com) and create an account.
2. Click **New project**.
3. Choose a database password (**save it somewhere** — you rarely need it for this setup, but you cannot recover it easily).
4. Pick a region close to most players (optional).
5. Wait until the project finishes provisioning (dashboard shows healthy status).

---

## Part B — Copy values for later

In the Supabase dashboard:

1. Open **Project Settings** (gear) → **Data API**.
2. Copy **Project URL** → this becomes `supabaseUrl` in `assets/js/cloud-config.js`.
3. Copy the **anon** / publishable **`default` key** (not the secret `service_role` key) → this becomes `supabaseAnonKey`.

Also note your **Project reference**: it appears in the URL as  
`https://app.supabase.com/project/<project-ref>/...`.

---

## Part C — Login methods and trust (you configure this in Supabase)

Players stay on your static site. **Supabase hosts the auth flows** (you pick which providers to turn on in the dashboard). The games page can show **Continue with Google**, **Continue with Discord**, and/or **magic link email** — all configured in your repo’s **`assets/js/cloud-config.js`** with `loginGoogle`, `loginDiscord`, and `loginEmail`.

**Recommended order for a trustworthy UX**

1. **Google** — people recognize Google’s sign-in; no password typed on your domain.
2. **Discord** (optional) — natural for gaming / stream communities.
3. **Email magic link** — fine as a fallback; the email may show a Supabase sender until you set up [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) (optional, later).

### C1 — URL configuration (do this for every sign-in method)

For OAuth and email links to return to your `games.html`, Supabase must allow your exact URL.

1. Go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to where users normally open your site:
   - Custom domain: `https://fuqmea.com` (or `https://www.fuqmea.com` if you use `www`)
   - GitHub Pages: `https://YOUR_USERNAME.github.io` (or your user/org pages root)
3. Under **Redirect URLs**, add every URL you use to open the games page, for example:
   - `https://YOUR_USERNAME.github.io/REPO_NAME/games.html`
   - `https://fuqmea.com/games.html`

These are compared **exactly** (scheme, host, path). Add `www` and non-`www` variants if you use both.

### C2 — Google (recommended)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. **APIs & Services** → **OAuth consent screen** — set app name and support email (what users see on the Google sign-in page).
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**.
4. Under **Authorized redirect URIs**, add **exactly**:

   `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

   Use your project ref from the Supabase dashboard (same as in your Project URL hostname).

5. In Supabase: **Authentication** → **Providers** → **Google** — turn ON, then paste the **Client ID** and **Client secret** from Google.
6. In your repo, set `loginGoogle: true` in `assets/js/cloud-config.js` (with `enabled: true` and Supabase URL/keys as in Part F).

### C3 — Discord (optional)

1. [Discord Developer Portal](https://discord.com/developers/applications) → create an application.
2. **OAuth2** section — add redirect:

   `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

3. Copy **Client ID** and **Client secret** into Supabase: **Authentication** → **Providers** → **Discord**.
4. In `assets/js/cloud-config.js`, set `loginDiscord: true`.

### C4 — Email (magic link)

1. **Authentication** → **Providers** → **Email** — turn ON.
2. Optional: disable “Confirm email” for faster testing; tighten for production later.
3. In `assets/js/cloud-config.js`, `loginEmail: true` (default) keeps the “Email me a link instead” flow.

Magic-link senders are often `noreply@...` or Supabase-branded until you configure custom SMTP.

---

**Display name (leaderboard):** If your Supabase project already existed before this feature, run the new `display_name` / trigger / view section from `supabase/schema.sql` once in the SQL editor (or re-run the full file).

**Display name moderation:** `profiles_before_write` rejects a curated list of hate slurs and similar strings by matching normalized substrings (alphanumeric fold; see `profiles_before_write` in [`schema.sql`](schema.sql)). It is heuristic—expand the list in a new migration, and use the **Table Editor** to clear a user’s `display_name` if something offensive slips through. The same token list is mirrored in [`assets/js/display-name-policy.js`](../assets/js/display-name-policy.js) for client-side preflight. Deploy [`supabase/migrations/20260503120000_display_name_blocklist.sql`](migrations/20260503120000_display_name_blocklist.sql) on existing databases.

## Part D — Install the database schema (one paste)

1. Open **SQL Editor** in Supabase.
2. Click **New query**.
3. Open this repo file locally: **`supabase/schema.sql`** — copy **all** text.
4. Paste into Supabase SQL Editor and click **Run**.

You should see no errors. This creates profiles, wallets, game events, leaderboard views, and security rules.

### Migrations vs `schema.sql` (keep server state aligned)

Canonical definitions live in **[`schema.sql`](schema.sql)** end-to-end. **[`supabase/migrations/`](migrations/)** holds **incremental** SQL meant to match that file when applied in order (e.g. `supabase db push`):

| Migration | Matches `schema.sql` section |
|-----------|----------------------------|
| [`20260430120000_leaderboard_views_security.sql`](migrations/20260430120000_leaderboard_views_security.sql) | (superseded) `leaderboard_all_time` / `leaderboard_weekly` definer views — replaced by the aggregate-table migration below |
| [`20260430153000_leaderboard_rpc.sql`](migrations/20260430153000_leaderboard_rpc.sql) | `leaderboard_all_time_rows` / `leaderboard_weekly_rows` + `EXECUTE` for `anon`, `authenticated` (rewritten by the aggregate-table migration below) |
| [`20260430210000_wallets_public_read_and_leaderboard_grants.sql`](migrations/20260430210000_wallets_public_read_and_leaderboard_grants.sql) | `wallets_public_read` policy + `SELECT` grants on both leaderboard views |
| [`20260502130000_wallet_aura_peak_leaderboard.sql`](migrations/20260502130000_wallet_aura_peak_leaderboard.sql) | `wallets.aura_peak_multiplier` column + `apply_settlement(..., p_crash_peak)` + `aura_peak` columns on the leaderboard views/RPCs |
| [`20260502160000_leaderboard_aggregate.sql`](migrations/20260502160000_leaderboard_aggregate.sql) | `public.leaderboard_aggregate` table + RLS + `tg_refresh_leaderboard_aggregate` triggers + backfill; replaces the SECURITY DEFINER leaderboard views with invoker views over the aggregate, and switches the leaderboard RPCs to SECURITY INVOKER |
| [`20260502170000_rakeback_pool.sql`](migrations/20260502170000_rakeback_pool.sql) | `wallets.rakeback_pool numeric(12,2)` column, in-server rakeback accrual inside `apply_settlement` (10% of \|delta\| on coin/rps/slots/bj/crash losses), and a new `claim_rakeback()` RPC. **Apply on existing projects** so signed-in clients can read/claim rakeback after deploying `cloud-sync.js@1.20.0`. |
| [`20260503120000_display_name_blocklist.sql`](migrations/20260503120000_display_name_blocklist.sql) | Replaces `profiles_before_write` with display-name substring moderation (`DISPLAY_NAME DISALLOWED`); pairs with `assets/js/display-name-policy.js` + `games.html` script order. |
| [`20260503130000_arcade_streaks.sql`](migrations/20260503130000_arcade_streaks.sql) | `wallets.arcade_streaks jsonb` (per-game **best** streaks + Aura Farm **peakBankMult** only; running **current** streaks stay device-local) and `merge_arcade_streaks(p_patch jsonb)` for authenticated clients. Coin continues to use `wallets.coin_streak` / settlements — not duplicated in this JSON. Deploy before relying on `FuqCloud.mergeArcadeStreaks` / `cloud-sync.js@1.22.0`. |
| [`20260504120000_import_wallet_return_full.sql`](migrations/20260504120000_import_wallet_return_full.sql) | `import_initial_device_wallet` now returns `rakeback_pool`, `arcade_streaks`, and `aura_peak_multiplier` with tokens/streak/daily so **import-device-wallet** does not strip server fields. Pairs with **`cloud-sync.js@1.23.0`** hydrate merge (`{ ...row, ...j.wallet }`). |

**SQL Editor workflow:** one full paste of **`schema.sql`** is sufficient. **CLI-only migrations** do not create the base tables/RPCs from scratch — run **`schema.sql`** once on a new project, then use migrations for small follow-ups, or keep re-pasting the full **`schema.sql`** when you change it.

**If you already ran an older schema** and something fails, screenshot the error in the SQL editor — you may need a small follow-up migration (ask in Cursor with the message text).

**Existing project — leaderboard balance wrong but names OK:** older RLS only allowed each user to read their own `wallets` row, so the leaderboard view could not see other players’ balances. Run the **`wallets_public_read`** policy block from the current [`schema.sql`](schema.sql) (search for `wallets_public_read`), or paste:

```sql
drop policy if exists wallets_public_read on public.wallets;
create policy wallets_public_read
on public.wallets for select
to anon, authenticated
using (true);
```

**Existing project — “Rounds” / weekly totals always zero (but balance looks OK):** historically the leaderboard views aggregated **`game_events`** directly, and owner-only RLS hid other players' rows from the caller. The current architecture (see **Leaderboard freshness** below) replaces those definer views with the **`leaderboard_aggregate`** table — fed by triggers — so the math is correct *without* any RLS bypass. Run [`supabase/migrations/20260502160000_leaderboard_aggregate.sql`](migrations/20260502160000_leaderboard_aggregate.sql) (or re-paste the full [`schema.sql`](schema.sql)) and the next settled round will populate aggregate rows. The migration also backfills existing users on first run.

Weekly scope uses **`date_trunc('week', now())`** — week starts Monday, in the database session timezone (**usually UTC** on Supabase), which may differ from “weekly quests” keyed off the browser’s local ISO week — see comments in **`games.js`** vs this SQL.

**Unique display names:** the current [`schema.sql`](schema.sql) adds index `profiles_display_name_lower_unique`. If the index fails to create, two accounts already share the same name (case-insensitive); change or clear one in **Table Editor → profiles** first, then re-run the index statement.

---

## Part E — Deploy the `settle-game` Edge Function

This must exist so authenticated players can persist balance changes securely.

Supabase CLI is the simplest path **from your project folder**.

### Install CLI (pick one)

- **Recommended:** from the repo folder, use `npx` (no global install):

```powershell
cd "C:\Users\stegg\Documents\Web Projects\In progress\Fuqmea"
npx supabase --version
```

If that fails, install [Node.js LTS](https://nodejs.org) first, then try again.

### Log in and link your project

```powershell
cd "C:\Users\stegg\Documents\Web Projects\In progress\Fuqmea"
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with the ref from Part B (`app.supabase.com/project/<project-ref>/...`).

### First-time CLI project file (only if prompted)

If the CLI asks to initialize Supabase locally, allow it (`supabase init`). That creates lightweight config beside this folder — local-only and safe to gitignore via `.supabase/` (already ignored).

### Deploy the functions

```powershell
npx supabase functions deploy settle-game
npx supabase functions deploy import-device-wallet
npx supabase functions deploy leaderboard
```

Use **`--no-verify-jwt`** on `leaderboard` if prompted (public POST with no Bearer token).

**Why `import-device-wallet`:** the browser must not call PostgREST **`/rpc/import_initial_device_wallet`** directly from your custom domain — the preflight often fails CORS. The Edge Function runs the same RPC **server-side** and returns `Access-Control-Allow-Origin: *` (same pattern as `settle-game`).

**Why `leaderboard`:** signed-in players hit the JWT-protected Edge function, which calls the **`leaderboard_*_rows`** RPCs server-side with the same anon/publishable env pattern as **`settle-game`**. Guests fall back to the public REST view (`leaderboard_all_time` / `leaderboard_weekly`) — both surfaces read the same **`leaderboard_aggregate`** table, so results are consistent.

### Secrets (usually automatic)

Deployed Edge Functions receive **`SUPABASE_URL`** automatically. Your API key may be exposed as **`SUPABASE_ANON_KEY`** (legacy) or inside **`SUPABASE_PUBLISHABLE_KEYS`** (JSON) after dashboard key migrations ([Secrets docs](https://supabase.com/docs/guides/functions/secrets)). Repo **`settle-game`**, **`import-device-wallet`**, and **`leaderboard`** read either pattern.

If logs still show **`Missing Supabase env vars`** after **`npx supabase functions deploy settle-game`**:

1. Dashboard → **Edge Functions** → **Secrets** (or project **Secrets**)
2. Add **`SUPABASE_URL`** — base URL only: **`https://<project-ref>.supabase.co`** (strip **`/rest/v1/`** if you copied Data API URL)
3. Add **`SUPABASE_ANON_KEY`** — **anon / default publishable** from **Project Settings → API Keys** (not **`service_role`**)

### Your function URLs (for cloud-config)

- Settle: `https://YOUR_PROJECT_REF.functions.supabase.co/settle-game`
- Device import: `…/import-device-wallet` — if you leave **`importDeviceWalletEndpoint`** empty in `cloud-config.js`, it is derived from **`settleEndpoint`** automatically.
- Leaderboard: `…/leaderboard` — **`leaderboardEndpoint`** empty → derived from **`settleEndpoint`** (path swap from `settle-game`).

You can confirm under **Edge Functions** → **settle-game** in the dashboard.

---

## Part F — Fill `assets/js/cloud-config.js`

Open **`assets/js/cloud-config.js`** in this repo:

1. Set **`enabled`** to **`true`**.
2. Paste **`supabaseUrl`** — same as Project URL (no trailing slash).
3. Paste **`supabaseAnonKey`** — the anon/public key only.
4. Paste **`settleEndpoint`** — the full **`settle-game`** function URL from Part E.
5. Optionally set **`importDeviceWalletEndpoint`**; if empty, **`…/import-device-wallet`** is derived from **`settleEndpoint`** (recommended).
6. Optionally set **`leaderboardEndpoint`**; typically leave empty so **`…/leaderboard`** is derived from **`settleEndpoint`** (deploy the **`leaderboard`** Edge Function + SQL RPCs in [`schema.sql`](schema.sql)).

7. After Part C, set which buttons appear: **`loginGoogle`**, **`loginDiscord`**, **`loginEmail`** (see comments in the file; only turn on providers you actually configured in the dashboard).

`leaderboardLimit` can stay **25** or increase if you like.

Commit and deploy to GitHub Pages as usual. After deploy, bump the `?v=` on scripts in **`games.html`** if you suspect cached old config.

---

## Leaderboard freshness

- **Deploy SQL first when upgrading:** run **`supabase/migrations/20260502130000_wallet_aura_peak_leaderboard.sql`** (Aura peak) **then** **`supabase/migrations/20260502160000_leaderboard_aggregate.sql`** (aggregate table replaces the SECURITY DEFINER views) — or rerun full [`schema.sql`](schema.sql) once. Then **`supabase functions deploy settle-game leaderboard import-device-wallet`**.
- Architecture: **`public.leaderboard_aggregate`** is a denormalized per-user table that holds only leaderboard-safe columns (no per-event detail). RLS allows public **`select`**; only the **SECURITY DEFINER** trigger function **`tg_refresh_leaderboard_aggregate`** writes. **`game_events`** insert / **`wallets`** update / **`profiles`** name change all fire that function for the affected user. Views and RPCs read straight from the aggregate as **SECURITY INVOKER**, so the Supabase Security Advisor no longer flags definer-view RLS bypass.
- Weekly columns gate by **`weekly_week_start = date_trunc('week', now())::date`**; users who haven't played this week show **0 / 0** in the weekly leaderboard automatically — no cron needed.
- Each **cloud** round triggers `settle-game` → Postgres updates **`wallets`** + **`game_events`** → trigger refreshes the aggregate row.
- Right after each local round, **`refreshLeaderboard()`** runs once for **your** browser, so **your** open games page usually pulls new rows automatically.
- **Other players** (or you after a reload) still need **Reload** / **leaderboard Refresh** unless you build polling—they read from Postgres at request time, not live websocket.

## Rakeback (server-side)

Rakeback was previously tracked in the browser's `localStorage` and could leak between users on a shared device. The 1.20.0 client moves the pool onto the server:

- **Storage:** `public.wallets.rakeback_pool numeric(12,2)` (default 0; check ≥ 0).
- **Accrual:** inside `apply_settlement`. Whenever the settled `p_game` is one of `coin / rps / slots / bj / crash` and the delta is negative, the pool grows by `round(abs(delta) * 0.10, 2)`. No client-driven accrual call exists; the server is the single source of truth.
- **Claim:** new RPC `claim_rakeback()` (SECURITY DEFINER, granted to `authenticated`). Floors the pool to a whole-FUQ payout, credits `wallets.tokens` atomically, keeps the fractional remainder for next time, and inserts a `rakeback_claim` row in `game_events` so it shows in history and feeds the leaderboard aggregate.
- **Migration:** [`supabase/migrations/20260502170000_rakeback_pool.sql`](migrations/20260502170000_rakeback_pool.sql) adds the column, drops + recreates `apply_settlement` with the new return shape (`tokens, coin_streak, last_daily, rakeback_pool, event_id`), and creates `claim_rakeback`. Idempotent — safe to re-apply.
- **Edge function:** the legacy `rakeback` game key is rejected by `settle-game`. Old clients will see one failed claim until they refresh; the cache-bust in `games.html` forces a reload.
- **Guests:** the panel shows "Sign in to earn 10% rakeback on losses." Nothing accrues without a session, which closes the abuse loop where a user signed in, drained tokens, signed out, and re-pulled the cloud balance into guest play.

## Arcade streak bests (cross-device)

- **Storage:** `public.wallets.arcade_streaks` (`jsonb`, default `{}`) holds per-game **best** win streaks and Aura Farm **peak bank multiplier** only. **Running “current” streak** values stay in `localStorage` on each browser.
- **RPC:** `merge_arcade_streaks(p_patch jsonb)` (`SECURITY DEFINER`, granted to `authenticated`) merges patches with **`greatest`** per numeric field and server-side caps (same spirit as local UI). Clients call it via `FuqCloud.mergeArcadeStreaks` in **`assets/js/cloud-sync.js`** (debounced from **`assets/js/games.js`** after local streak updates).
- **Coin flip:** continues to use **`wallets.coin_streak`** and settlement payloads — not duplicated inside `arcade_streaks`.
- **Migration:** [`supabase/migrations/20260503130000_arcade_streaks.sql`](migrations/20260503130000_arcade_streaks.sql). Apply on existing projects before expecting cross-device arcade bests to sync.

## First-login device balance (once per account)

The database function **`import_initial_device_wallet`** (in [`schema.sql`](schema.sql)) runs when you’re signed in: it copies your **offline** `localStorage` wallet into Supabase **only if** there are **no** `game_events` for that account yet (`wallet_import_completed` is also set so it never merges again).

**Existing databases:** run the new column + function + grant from [`schema.sql`](schema.sql):

- `profiles.wallet_import_completed`
- `import_initial_device_wallet`
- `grant execute ...`

## Part G — Quick test checklist

**Before you rely on a deploy:** confirm in the Supabase dashboard (same project as `supabaseUrl`): **SQL Editor** ran `schema.sql` without errors; **Authentication → URL Configuration** lists your real **`…/games.html`** URL(s); Google/Discord OAuth clients use **`https://<project-ref>.supabase.co/auth/v1/callback`**; **API keys** → anon/publishable still matches `cloud-config.js` if you rotated keys.

1. Open **`games.html`** on your deployed site.
2. If you enabled **Google** / **Discord**, use **Continue with Google/Discord** and complete the provider’s flow; you should land on `games.html` with a session. If you use **email** only, open **Email me a link instead** → **Send magic link** → finish from the email.
3. The account badge should show a signed-in / cloud state (see the games page **Account** row).
4. Play one round → balance should persist after reload (cloud path).
5. **Leaderboard** should list players once there is data → **Refresh** after a few settlements.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Google/Discord “redirect_uri mismatch” or loops | Google Cloud → OAuth client must include `https://<ref>.supabase.co/auth/v1/callback` — **and** **Authentication → URL Configuration** must list your real **`.../games.html`** URL (Part C) |
| Magic link opens but errors / loops | Redirect URLs + Site URL in **Authentication → URL Configuration** must include your exact **`.../games.html`** URL |
| Leaderboard stuck on “loading” | `enabled`/URL/key wrong; browser devtools → **Network** → failed calls to `<project>.supabase.co` |
| Leaderboard names OK but scores/balances wrong or missing | Run **`wallets_public_read`** policy (see Part D migration note above); redeploy not required |
| Balance does not persist | `settleEndpoint` missing/wrong; function logs show errors |
| CSP blocks fetch | **`games.html`** must allow `https://*.supabase.co` (already configured) |
| Auth works but settles never sync (session missing) | Use current games page scripts: **`assets/js/vendor/supabase.umd.min.js`** loads before **`assets/js/cloud-sync.js`** — PKCE `?code=` exchanges require **`@supabase/supabase-js`**; older hash-only parsers are removed. Bump `?v=` on scripts after deploy. |
| Leaderboard still wrong after client update | Paste full current **`supabase/schema.sql`** if **`wallets_public_read`** / RPCs missing; deploy **`leaderboard`** Edge (`…/leaderboard`). |

---

## What this repo intentionally does NOT do yet

Per-game RNG executed only on the server (full cheat-proof arcade) — that would be another phase. Right now settlements are guarded by auth + capped deltas via the Edge Function + database rules.

When you hit Supabase quotas or scale needs, revisit their **Pricing** page and whether you upgrade the project tier.
