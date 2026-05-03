# Fuqmea

Static **HTML / CSS / JavaScript** site (e.g. GitHub Pages). No bundler required for the main pages.

## Layout

| Path | Role |
|------|------|
| `*.html` | Pages (home, games, meme vault, socials, giveaways, legal, etc.) |
| `assets/css/` | Styles |
| `assets/js/` | Shared UI (`hub.js`, games, cloud client) |
| `assets/images/` | Memes and other images; **`assets/images/gallery.json`** is the meme manifest |
| `tools/` | Small Node/Python helpers (categories helper, hooks setup, one-off patches) |
| `supabase/` | SQL schema, migrations, and **[`supabase/README.md`](supabase/README.md)** for cloud login, wallets, leaderboards |

## Meme vault (`memes.html`)

- **Manifest:** `assets/images/gallery.json` — lists every image under `assets/images/` (except ignored drafts—see below).
- **Regenerate locally:** `npm run gallery` (runs `node generate-gallery.js`).
- **Check without writing:** `npm run gallery:check` (exit code 1 if the manifest would change).
- **Optional Git hook:** `npm run setup-hooks` once — uses `.githooks/pre-push` to refresh the manifest before push.
- **CI:** [`.github/workflows/update-gallery.yml`](.github/workflows/update-gallery.yml) updates the manifest on push when needed.
- **Tags / filters:** Derived from filenames via [`tools/extract-categories.js`](tools/extract-categories.js). Convention: `Tag - Title.ext` or `Tag - Subtag - Title.ext` (segments separated by **` - `**). Details in [`REQUESTS.md`](REQUESTS.md).

## Cloud games & Supabase

Leaderboards, auth, and settlements use Supabase. Setup is documented only in **[`supabase/README.md`](supabase/README.md)** (not duplicated here).

## Requirements

- **Browser:** open the HTML files directly or serve the repo root with any static server.
- **Node.js:** optional, for gallery scripts and `npm run` helpers (`package.json` has no npm dependencies).

## What belongs in Git

- **Do commit:** site source, `assets/images/` media that should ship, `gallery.json`, workflows, `supabase/` SQL, `tools/` helpers, `.githooks/`.
- **Do not commit:** secrets (`*.env`), machine-only Supabase CLI state (see [`.gitignore`](.gitignore)), local scratch folders.

To keep drafts out of the vault without deleting them, add patterns to **`.gitignore`** under `assets/images/` (for example a folder or `_*` naming—whatever you agree on).
