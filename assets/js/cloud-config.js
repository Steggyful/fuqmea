/**
 * Supabase wiring for Fuq arcade (GitHub Pages — no `.env`; values live here).
 *
 * STEP-BY-STEP: follow supabase/README.md in this repo ("Part F" edits this file).
 *
 * SUPABASE DATA API (paste from dashboard: Project Settings → Data API):
 *   supabaseUrl     → Project URL (e.g. https://abcdefgh.supabase.co)
 *   supabaseAnonKey → anon / default publishable key (NOT service_role)
 *
 * EDGE FUNCTIONS (deploy both — see supabase/README.md Part E):
 *   settleEndpoint          → …/functions.supabase.co/settle-game
 *   importDeviceWalletEndpoint → optional override; if unset, derive …/import-device-wallet from settleEndpoint
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
  /** Leave empty to use same host as settle-game with path /import-device-wallet (avoids browser CORS on /rpc/). */
  importDeviceWalletEndpoint: '',
  leaderboardLimit: 25,
  /** Show primary OAuth buttons (configure provider in Supabase first). */
  loginGoogle: false,
  loginDiscord: false,
  /** Magic-link email — keep true if you want a fallback when OAuth is on. */
  loginEmail: true
};
