Display name support is implemented in the repo. To re-apply the same transforms (e.g. after a bad merge), run from the project root:

```powershell
python tools/apply_display_name_patch.py
```

The script updates `supabase/schema.sql`, `games.html`, `assets/css/styles.css`, `assets/js/cloud-sync.js`, and `supabase/README.md`. It skips steps that already look patched.

After pulling code, run the **new SQL** in the Supabase SQL editor (the `display_name` column, trigger, and recreated leaderboard views) if your cloud database was created before this change.
