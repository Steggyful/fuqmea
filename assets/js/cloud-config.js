/**
 * Supabase wiring for Fuq arcade (GitHub Pages — no `.env`; values live here).
 *
 * STEP-BY-STEP: follow supabase/README.md in this repo ("Part F" edits this file).
 *
 * SUPABASE DATA API (paste from dashboard: Project Settings → Data API):
 *   supabaseUrl     → Project URL (e.g. https://abcdefgh.supabase.co)
 *   supabaseAnonKey → anon / default publishable key (NOT service_role)
 *
 * EDGE FUNCTIONS (deploy — see supabase/README.md Part E):
 *   settleEndpoint          → …/settle-game
 *   importDeviceWalletEndpoint → optional; unset → derive …/import-device-wallet from settleEndpoint
 *   leaderboardEndpoint     → optional; unset → derive …/leaderboard (server-side leaderboard; avoids flaky REST reads)
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
  /** Leave empty to derive …/leaderboard from settleEndpoint. */
  leaderboardEndpoint: '',
  leaderboardLimit: 25,
  /** Show primary OAuth buttons (configure provider in Supabase first). */
  loginGoogle: false,
  loginDiscord: false,
  /** Magic-link email — keep true if you want a fallback when OAuth is on. */
  loginEmail: true
};
