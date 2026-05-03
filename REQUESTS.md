# Request log

Short record of **who asked for what** (placement, behavior, priorities).  
This is not a full changelog—see git history for code changes.

Add a row when someone requests a user-facing change worth remembering.

## How to add memes

1. Drop image files into `assets/images/`.
2. `git push` (opt-in: run `npm run setup-hooks` once so a pre-push hook stages images and refreshes `gallery.json`). Or run `npm run gallery && git add assets/images && git commit && git push` if you skip hooks.
3. Tags on the site come from the filename: `Tag - Title.ext` or `Tag - Subtag - Title.ext` (every segment before the last ` - ` is a tag).
4. Alphabetic filename prefixes like `e ` or `zz ` are stripped from tag labels for display.

| Date | By | Summary |
|------|-----|---------|
| 2026-04-26 | Sealofvile Blood | Homepage **Random meme** button (quick jump to random meme). |
| 2026-04-27 | Vivid | Add homepage **FOLLOW US** (Steggyful1 + SSGVivid) under the main title; **Join Discord** between socials and **Random Meme**; keep existing **Socials** page; desktop + mobile layout; TikTok above Twitch in that block. |
