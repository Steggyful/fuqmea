/**
 * Supabase wiring for Fuq arcade (GitHub Pages — no `.env`; values live here).
 *
 * STEP-BY-STEP: follow supabase/README.md in this repo ("Part F" edits this file).
 *
 * SUPABASE DATA API (paste from dashboard: Project Settings → Data API):
 *   supabaseUrl     → Project URL (e.g. https://abcdefgh.supabase.co)
 *   supabaseAnonKey → anon / default publishable key (NOT service_role)
 *
 * EDGE FUNCTION (after deploying supabase/functions/settle-game — see README):
 *   settleEndpoint → https://YOUR_PROJECT_REF.functions.supabase.co/settle-game
 *
 * LOGIN: Enable after you turn on each provider in Supabase (Authentication → Providers):
 *   loginGoogle   → "Continue with Google" (configure Google OAuth + Supabase; see README)
 *   loginDiscord  → "Continue with Discord" (optional)
 *   loginEmail    → magic link by email (secondary / fallback; emails may show Supabase sender until custom SMTP)
 *
 * SECURITY: anon key is designed to be public; never commit service_role secrets.
 */

window.FUQ_CLOUD_CONFIG = {
  enabled: true,
  supabaseUrl: 'https://mxwrpjyiwcmdzlymmnmr.supabase.co',
  supabaseAnonKey: 'sb_publishable_s70S_HrNIZHzbjaiyXChsw_aE8CMQbE',
  settleEndpoint: 'https://mxwrpjyiwcmdzlymmnmr.functions.supabase.co/settle-game',
  leaderboardLimit: 25,
  /** Show primary OAuth buttons (configure provider in Supabase first). */
  loginGoogle: false,
  loginDiscord: false,
  /** Magic-link email — keep true if you want a fallback when OAuth is on. */
  loginEmail: true
};
