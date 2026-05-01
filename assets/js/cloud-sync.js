(function () {
  'use strict';

  const SESSION_KEY = 'fuqmea_cloud_session_v1';
  /** Same key as games.js — must stay in sync for offline→cloud one-time merge. */
  const FUN_WALLET_KEY = 'fuqmea_fun_wallet_v1';
  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  let leaderboardScope = 'alltime';

  function wantGoogle() {
    return Boolean(CONFIG.loginGoogle);
  }

  function wantDiscord() {
    return Boolean(CONFIG.loginDiscord);
  }

  function wantEmail() {
    return CONFIG.loginEmail !== false;
  }

  function handlePrefixFromUser(me) {
    if (!me || typeof me !== 'object') return 'fuq_player';
    if (me.email && typeof me.email === 'string' && me.email.includes('@')) {
      const base = me.email.split('@')[0];
      const cleaned = base.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
      if (cleaned) return cleaned;
    }
    const meta = me.user_metadata || {};
    const fromName =
      meta.full_name || meta.name || meta.user_name || meta.preferred_username || meta.nickname;
    if (fromName) {
      const cleaned = String(fromName).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
      if (cleaned) return cleaned;
    }
    const ids = me.identities;
    if (Array.isArray(ids) && ids.length) {
      const idd = ids[0].identity_data || {};
      const un = idd.name || idd.preferred_username || idd.username || idd.user_name;
      if (un) {
        const cleaned = String(un).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
        if (cleaned) return cleaned;
      }
    }
    const prov = (me.app_metadata && me.app_metadata.provider) || 'player';
    return String(prov).replace(/[^a-zA-Z0-9_]/g, '') || 'player';
  }

  function isEnabled() {
    return Boolean(CONFIG.enabled && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  }

  /** Browser cannot reliably call PostgREST /rpc from fuqmea.com (CORS preflight); use Edge Function instead. */
  function deriveImportDeviceWalletEndpoint() {
    const explicit =
      typeof CONFIG.importDeviceWalletEndpoint === 'string' ? CONFIG.importDeviceWalletEndpoint.trim() : '';
    if (explicit) return explicit;
    const se = typeof CONFIG.settleEndpoint === 'string' ? CONFIG.settleEndpoint.trim() : '';
    if (se && /settle-game/i.test(se)) {
      return se.replace(/\/settle-game\/?$/i, '/import-device-wallet');
    }
    return '';
  }

  function deriveLeaderboardEndpoint() {
    const explicit =
      typeof CONFIG.leaderboardEndpoint === 'string' ? CONFIG.leaderboardEndpoint.trim() : '';
    if (explicit) return explicit;
    const se = typeof CONFIG.settleEndpoint === 'string' ? CONFIG.settleEndpoint.trim() : '';
    if (se && /settle-game/i.test(se)) {
      return se.replace(/\/settle-game\/?$/i, '/leaderboard');
    }
    return '';
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.accessToken) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  async function authFetch(path, options) {
    const session = readSession();
    const headers = {
      apikey: CONFIG.supabaseAnonKey,
      ...(options?.headers || {})
    };
    if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    const res = await fetch(`${CONFIG.supabaseUrl}${path}`, {
      ...options,
      headers
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed: ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  function updateCloudBadge(text, isOn) {
    const badge = byId('games-cloud-status');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle('games-cloud-status--on', Boolean(isOn));
  }

  function setProfileBlockVisible(show) {
    const block = byId('games-cloud-profile-block');
    const inp = byId('games-display-name');
    if (block) block.hidden = !show;
    if (!show && inp) inp.value = '';
  }

  function setAccountToolbarVisible(show) {
    const t = byId('games-account-toolbar');
    if (t) t.hidden = !show;
  }

  function setGuestLoginAreaVisible(show) {
    const el = byId('games-account-login-actions');
    if (el) el.hidden = !show;
  }

  async function fetchLeaderboardViaRest(limit) {
    const view = leaderboardScope === 'weekly' ? 'leaderboard_weekly' : 'leaderboard_all_time';
    const metric = leaderboardScope === 'weekly' ? 'weekly_net_delta.desc' : 'current_balance.desc';
    const selectCols =
      leaderboardScope === 'weekly'
        ? 'leaderboard_name,weekly_net_delta,weekly_rounds'
        : 'leaderboard_name,current_balance,total_rounds,net_delta';
    return authFetch(`/rest/v1/${view}?select=${selectCols}&order=${metric}&limit=${limit}`, { method: 'GET' });
  }

  async function fetchLeaderboardRows(limit) {
    const ep = deriveLeaderboardEndpoint();
    if (ep) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: CONFIG.supabaseAnonKey
          },
          body: JSON.stringify({
            scope: leaderboardScope === 'weekly' ? 'weekly' : 'alltime',
            limit
          })
        });
        const j = res.ok ? await res.json().catch(() => null) : null;
        if (j && typeof j === 'object' && Array.isArray(j.rows)) return j.rows;
      } catch (_) {
        /* try REST fallback */
      }
    }
    return fetchLeaderboardViaRest(limit);
  }

  function updateLeaderboardTableHeadLabels() {
    const scoreCol = byId('games-lb-head-score');
    if (scoreCol) {
      scoreCol.textContent = leaderboardScope === 'weekly' ? 'Week net ±' : 'Balance';
    }
    const rndCol = byId('games-lb-head-rounds');
    if (rndCol) {
      rndCol.textContent = leaderboardScope === 'weekly' ? 'Week rounds' : 'Rounds';
    }
  }

  function syncLeaderboardScopeButtons() {
    const allt = byId('games-leaderboard-scope-alltime');
    const wk = byId('games-leaderboard-scope-weekly');
    if (allt) allt.classList.toggle('games-quest-toggle--active', leaderboardScope === 'alltime');
    if (wk) wk.classList.toggle('games-quest-toggle--active', leaderboardScope === 'weekly');
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
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '';
      const dup =
        /23505|duplicate key|unique constraint|profiles_display_name_lower_unique/i.test(msg);
      if (hint) {
        hint.textContent = dup
          ? 'That display name is already taken — pick another.'
          : 'Could not save — try again.';
      }
    }
  }

  function parseHashTokens() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) return null;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresIn = Number(params.get('expires_in') || '3600');
    if (!accessToken) return null;
    const session = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
    history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return session;
  }

  /** Run before games.js bootstraps wallet: OAuth redirect uses #access_token in the URL. */
  if (isEnabled()) {
    const fromHash = parseHashTokens();
    if (fromHash) writeSession(fromHash);
  }

  async function maybeRefreshToken() {
    const session = readSession();
    if (!session?.refreshToken) return;
    if ((session.expiresAt || 0) > Date.now() + 120000) return;
    const res = await authFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    writeSession({
      accessToken: res.access_token,
      refreshToken: res.refresh_token || session.refreshToken,
      expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000
    });
  }

  async function getMe() {
    return authFetch('/auth/v1/user', { method: 'GET' });
  }

  async function ensureProfile(me) {
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
  }

  function startOAuth(provider) {
    if (!isEnabled() || !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return;
    const redirectTo = window.location.href.split('#')[0].split('?')[0];
    const base = String(CONFIG.supabaseUrl).replace(/\/$/, '');
    const u = new URL(`${base}/auth/v1/authorize`);
    u.searchParams.set('provider', provider);
    u.searchParams.set('redirect_to', redirectTo);
    u.searchParams.set('apikey', CONFIG.supabaseAnonKey);
    window.location.assign(u.toString());
  }

  async function ensureWallet() {
    const me = await getMe();
    const uid = me?.id;
    if (!uid) return null;
    const q = encodeURIComponent(uid);
    let rows = await authFetch(
      `/rest/v1/wallets?select=tokens,coin_streak,last_daily&user_id=eq.${q}&limit=1`,
      { method: 'GET' }
    );
    if (rows?.length) return rows[0];
    await authFetch('/rest/v1/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{}])
    });
    rows = await authFetch(
      `/rest/v1/wallets?select=tokens,coin_streak,last_daily&user_id=eq.${q}&limit=1`,
      { method: 'GET' }
    );
    return rows?.[0] || null;
  }

  function readFunWalletSnapshot() {
    try {
      const raw = localStorage.getItem(FUN_WALLET_KEY);
      if (!raw) return { tokens: 200, coinStreak: 0, lastDaily: '' };
      const w = JSON.parse(raw);
      return {
        tokens: Math.max(0, Math.floor(Number(w.tokens) || 0)),
        coinStreak: Math.max(0, Math.floor(Number(w.coinStreak) || 0)),
        lastDaily: typeof w.lastDaily === 'string' ? w.lastDaily : ''
      };
    } catch {
      return { tokens: 200, coinStreak: 0, lastDaily: '' };
    }
  }

  function normalizeLastDailyForStorage(d) {
    if (d == null || d === '') return '';
    const s = String(d);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function writeFunWalletLocal(w) {
    const out = {
      tokens: Math.max(0, Math.floor(Number(w.tokens) || 0)),
      coinStreak: Math.max(0, Math.floor(Number(w.coinStreak) || 0)),
      lastDaily: normalizeLastDailyForStorage(w.lastDaily)
    };
    localStorage.setItem(FUN_WALLET_KEY, JSON.stringify(out));
    window.dispatchEvent(new CustomEvent('fuqmea-wallet-hydrated'));
  }

  /** Prefer later ISO yyyy-mm-dd for daily claimed flag (lex compare works). */
  function mergeLastDaily(localD, remoteD) {
    const l = normalizeLastDailyForStorage(localD);
    const r = normalizeLastDailyForStorage(remoteD);
    if (!l) return r;
    if (!r) return l;
    return l >= r ? l : r;
  }

  /**
   * Never drop local totals below what the browser already had on reload.
   * Cloud can still be ahead (other device); stale cloud after a failed settle won't wipe progress.
   */
  function reconcileLocalWithCloudRow(localSnap, cloudRow) {
    if (!cloudRow || typeof cloudRow !== 'object') {
      return {
        tokens: localSnap.tokens,
        coinStreak: localSnap.coinStreak,
        lastDaily: localSnap.lastDaily
      };
    }
    const cTok = Math.max(0, Math.floor(Number(cloudRow.tokens) || 0));
    const streakSrc = cloudRow.coin_streak ?? cloudRow.coinStreak;
    const cStreak = Math.max(0, Math.floor(Number(streakSrc) || 0));
    const ldRemote = cloudRow.last_daily ?? cloudRow.lastDaily;
    return {
      tokens: Math.max(cTok, localSnap.tokens),
      coinStreak: Math.max(cStreak, localSnap.coinStreak),
      lastDaily: mergeLastDaily(localSnap.lastDaily, ldRemote)
    };
  }

  /**
   * After profile exists: pull cloud wallet, run one-time device import RPC if allowed, mirror into localStorage.
   * Dispatches fuqmea-wallet-hydrated so games.js refresh UI (runs after OAuth hash + session restore).
   */
  async function hydrateWalletAfterLogin() {
    if (!isEnabled()) return;
    try {
      await maybeRefreshToken().catch(() => {});
      if (!readSession()?.accessToken) return;

      let row = null;
      try {
        row = await ensureWallet();
      } catch (_) {
        return;
      }
      if (!row) return;

      let cloudLike = row;
      try {
        const sess = readSession();
        const snap = readFunWalletSnapshot();
        const ep = deriveImportDeviceWalletEndpoint();
        if (!sess?.accessToken || !ep) {
          writeFunWalletLocal(reconcileLocalWithCloudRow(readFunWalletSnapshot(), row));
          return;
        }

        const ir = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sess.accessToken}`,
            apikey: CONFIG.supabaseAnonKey
          },
          body: JSON.stringify({
            p_tokens: snap.tokens,
            p_coin_streak: snap.coinStreak,
            p_last_daily: snap.lastDaily
          })
        });
        const j = ir.ok ? await ir.json().catch(() => null) : null;
        if (j && typeof j === 'object' && j.wallet) cloudLike = j.wallet;
      } catch (_) {
        cloudLike = row;
      }

      writeFunWalletLocal(reconcileLocalWithCloudRow(readFunWalletSnapshot(), cloudLike));
    } catch (_) {
      writeFunWalletLocal(readFunWalletSnapshot());
    }
  }

  async function requestMagicLink(email) {
    await authFetch('/auth/v1/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        create_user: true,
        email_redirect_to: window.location.href.split('#')[0]
      })
    });
  }

  async function recordSettlement(evt) {
    if (!isEnabled() || !CONFIG.settleEndpoint) return null;
    await maybeRefreshToken();
    const session = readSession();
    if (!session?.accessToken) return null;
    const res = await fetch(CONFIG.settleEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        apikey: CONFIG.supabaseAnonKey
      },
      body: JSON.stringify({
        game: evt.game,
        detail: evt.detail,
        delta: evt.delta
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.wallet || null;
  }

  async function loadLeaderboard() {
    if (!isEnabled()) return;
    const tbody = byId('games-leaderboard-body');
    if (!tbody) return;
    updateLeaderboardTableHeadLabels();
    syncLeaderboardScopeButtons();
    tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    try {
      const lim = Number(CONFIG.leaderboardLimit || 25);
      const rows = await fetchLeaderboardRows(lim);
      if (!rows?.length) {
        tbody.innerHTML = '<tr><td colspan="4">No players yet.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map((row, idx) => {
          const score = leaderboardScope === 'weekly' ? Number(row.weekly_net_delta || 0) : Number(row.current_balance || 0);
          const rounds = leaderboardScope === 'weekly' ? Number(row.weekly_rounds || 0) : Number(row.total_rounds || 0);
          const name = String(row.leaderboard_name || row.handle || 'player');
          return `<tr>
            <td>${idx + 1}</td>
            <td>${name}</td>
            <td>${score}</td>
            <td>${rounds}</td>
          </tr>`;
        })
        .join('');
    } catch {
      tbody.innerHTML =
        '<tr><td colspan="4">Leaderboard unavailable. Deploy Edge <code>leaderboard</code> or run latest <code>schema.sql</code> (RPC).</td></tr>';
    }
  }

  function setupLoginLayout() {
    const oauthRow = byId('games-oauth-row');
    if (oauthRow) {
      const show = wantGoogle() || wantDiscord();
      oauthRow.hidden = !show;
      const gBtn = byId('games-oauth-google');
      const dBtn = byId('games-oauth-discord');
      if (gBtn) gBtn.hidden = !wantGoogle();
      if (dBtn) dBtn.hidden = !wantDiscord();
    }
    const emailWrap = byId('games-cloud-email-block');
    if (emailWrap) {
      emailWrap.hidden = !wantEmail();
    }
    const det = byId('games-cloud-email-details');
    const sum = byId('games-cloud-email-summary');
    if (det) {
      const hasOauth = wantGoogle() || wantDiscord();
      if (!hasOauth) det.setAttribute('open', '');
      else det.removeAttribute('open');
    }
    if (sum) {
      sum.textContent = wantGoogle() || wantDiscord() ? 'Email me a link instead' : 'Log in with email (magic link)';
    }
  }

  async function syncProgressNow() {
    const msg = byId('games-cloud-msg');
    if (!readSession()?.accessToken) {
      if (msg) msg.textContent = 'Sign in first — then Sync now pulls your cloud balance.';
      return false;
    }
    if (msg) msg.textContent = 'Syncing…';
    try {
      await maybeRefreshToken().catch(() => {});
      await hydrateWalletAfterLogin();
      await loadLeaderboard();
      if (msg) msg.textContent = 'Synced — balance refreshed.';
      return true;
    } catch {
      if (msg) msg.textContent = 'Could not sync right now.';
      return false;
    }
  }

  async function initAuthUi() {
    setupLoginLayout();
    const loginForm = byId('games-cloud-login-form');
    const logoutBtn = byId('games-cloud-logout-btn');
    if (!logoutBtn) return;

    byId('games-oauth-google')?.addEventListener('click', () => startOAuth('google'));
    byId('games-oauth-discord')?.addEventListener('click', () => startOAuth('discord'));
    byId('games-display-name-save')?.addEventListener('click', () => {
      saveDisplayName();
    });
    byId('games-cloud-sync-now')?.addEventListener('click', () => {
      void syncProgressNow();
    });

    if (loginForm) {
    loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const emailInput = byId('games-cloud-email');
      const msg = byId('games-cloud-msg');
      const email = String(emailInput?.value || '').trim();
      if (!email || !email.includes('@')) {
        if (msg) msg.textContent = 'Enter a valid email.';
        return;
      }
      try {
        await requestMagicLink(email);
        if (msg) msg.textContent = 'Magic link sent. Open your email to finish login.';
      } catch {
        if (msg) msg.textContent = 'Could not send magic link right now.';
      }
    });
    }

    logoutBtn.addEventListener('click', async () => {
      clearSession();
      setProfileBlockVisible(false);
      setGuestLoginAreaVisible(true);
      setAccountToolbarVisible(false);
      updateCloudBadge('Cloud OFF', false);
      const msg = byId('games-cloud-msg');
      if (msg) msg.textContent = 'Signed out.';
      await loadLeaderboard();
    });

    syncLeaderboardScopeButtons();
    byId('games-leaderboard-scope-alltime')?.addEventListener('click', async () => {
      leaderboardScope = 'alltime';
      await loadLeaderboard();
    });
    byId('games-leaderboard-scope-weekly')?.addEventListener('click', async () => {
      leaderboardScope = 'weekly';
      await loadLeaderboard();
    });
  }

  async function init() {
    const signalInitDone = () => {
      window.dispatchEvent(new CustomEvent('fuqmea-cloud-init-complete'));
    };

    try {
      if (!isEnabled()) {
        updateCloudBadge('Cloud OFF', false);
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        return;
      }

      await initAuthUi();

      const session = readSession();
      if (!session?.accessToken) {
        updateCloudBadge('Cloud ready (login needed)', false);
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        const m = byId('games-cloud-msg');
        if (m) m.textContent = 'Sign in to save progress on this device. While signed in, each round settles to the cloud automatically.';
        await loadLeaderboard().catch(() => {});
        return;
      }

      setGuestLoginAreaVisible(false);
      setAccountToolbarVisible(true);
      try {
        await maybeRefreshToken().catch(() => {});
        const me = await getMe();
        const prof = await ensureProfile(me);
        await hydrateWalletAfterLogin().catch(() => {});
        syncProfileForm(prof);
        updateCloudBadge('Cloud ON', true);
        const m2 = byId('games-cloud-msg');
        if (m2) {
          m2.textContent =
            'Signed in. Progress saves after each cloud round — use Sync now if you play on multiple devices.';
        }
      } catch (err) {
        const txt = String(err?.message || err || '');
        const revoke =
          /\b401\b/.test(txt) ||
          /JWT expired/i.test(txt) ||
          /invalid_grant/i.test(txt) ||
          /invalid refresh token/i.test(txt) ||
          /refresh_token_not_found/i.test(txt) ||
          /invalid jwt/i.test(txt);
        if (revoke) {
          clearSession();
          setProfileBlockVisible(false);
          setGuestLoginAreaVisible(true);
          setAccountToolbarVisible(false);
          updateCloudBadge('Cloud OFF', false);
        }
      }

      await loadLeaderboard().catch(() => {});
    } finally {
      signalInitDone();
    }
  }

  window.FuqCloud = {
    enabled: isEnabled,
    recordSettlement,
    refreshLeaderboard: loadLeaderboard,
    syncProgressNow,
    startOAuth
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
