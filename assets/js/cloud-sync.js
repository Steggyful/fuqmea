(function () {
  'use strict';

  /** Same key as games.js — must stay in sync for offline→cloud one-time merge. */
  const FUN_WALLET_KEY = 'fuqmea_fun_wallet_v1';

  /** Migrate once from legacy hand-rolled session storage (implicit / old boot). */
  const LEGACY_SESSION_KEY = 'fuqmea_cloud_session_v1';

  /** Implicit-grant redirects use URL fragments; stash before stripping so async init can setSession(). */
  const IMPLICIT_FRAG_PENDING_KEY = 'fuqmea_auth_implicit_frag_pending_v1';

  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  /** Defer singleton until bootstrap (vendor script runs before this file). */
  let supabaseClient = null;

  let leaderboardScope = 'alltime';

  captureImplicitFragmentIfNeeded();

  function captureImplicitFragmentIfNeeded() {
    try {
      if (!isEnabledBasics()) return;
      const h = typeof window !== 'undefined' ? window.location.hash || '' : '';
      if (!h.includes('access_token=')) return;
      const params = new URLSearchParams(h.replace(/^#/, ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) return;
      localStorage.setItem(
        IMPLICIT_FRAG_PENDING_KEY,
        JSON.stringify({
          access_token,
          refresh_token,
          expires_in: Number(params.get('expires_in') || '3600')
        })
      );
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    } catch (_) {
      /**/
    }
  }

  function isEnabledBasics() {
    return Boolean(CONFIG.enabled && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  }

  function wantGoogle() {
    return Boolean(CONFIG.loginGoogle);
  }

  function wantDiscord() {
    return Boolean(CONFIG.loginDiscord);
  }

  function wantEmail() {
    return CONFIG.loginEmail !== false;
  }

  function gamesAuthRedirectPath() {
    return `${window.location.origin}${window.location.pathname}`;
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
    return Boolean(
      CONFIG.enabled &&
        CONFIG.supabaseUrl &&
        CONFIG.supabaseAnonKey &&
        typeof window.supabase !== 'undefined' &&
        typeof window.supabase.createClient === 'function'
    );
  }

  function getSupabase() {
    if (!supabaseClient && typeof window.supabase !== 'undefined' && isEnabledBasics()) {
      try {
        supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            flowType: 'pkce',
            storage: window.localStorage
          }
        });
      } catch (_) {
        supabaseClient = null;
      }
    }
    return supabaseClient;
  }

  function hasOAuthCallbackCode() {
    try {
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) return true;
    } catch (_) {
      /**/
    }
    const h = window.location.hash || '';
    return h.includes('code=');
  }

  /** PKCE/code + legacy implicit + migrated fuqmea_cloud_session → Supabase persisted session. */
  async function bootstrapAuthSession(sb) {
    if (!sb) return;
    try {
      const pend = localStorage.getItem(IMPLICIT_FRAG_PENDING_KEY);
      if (pend) {
        localStorage.removeItem(IMPLICIT_FRAG_PENDING_KEY);
        const p = JSON.parse(pend);
        if (p?.access_token && p?.refresh_token) {
          const { error } = await sb.auth.setSession({
            access_token: p.access_token,
            refresh_token: p.refresh_token
          });
          if (error) {
            /** fall through — user may PKCE-exchange instead */
          }
        }
      }

      const leg = localStorage.getItem(LEGACY_SESSION_KEY);
      if (leg) {
        localStorage.removeItem(LEGACY_SESSION_KEY);
        try {
          const p = JSON.parse(leg);
          if (p?.accessToken && p?.refreshToken) {
            await sb.auth.setSession({
              access_token: p.accessToken,
              refresh_token: p.refreshToken
            });
          }
        } catch (_) {
          /**/
        }
      }

      if (hasOAuthCallbackCode()) {
        await sb.auth.exchangeCodeForSession(window.location.href);
      }

      await sb.auth.getSession();
    } catch (_) {
      /**/
    }
  }

  /** Prefer supabase.auth.refreshSession (no stray Bearer on the token endpoint). */
  async function maybeRefreshToken() {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      const sess = data.session;
      if (!sess || !sess.refresh_token) return;
      const expiresAtMs = sess.expires_at ? Number(sess.expires_at) * 1000 : 0;
      if (expiresAtMs > Date.now() + 120000) return;
      await sb.auth.refreshSession();
    } catch (_) {
      /**/
    }
  }

  async function authFetch(path, options) {
    await maybeRefreshToken();
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data } = await sb.auth.getSession();
    const sess = data.session;
    const headers = {
      apikey: CONFIG.supabaseAnonKey,
      ...(options?.headers || {})
    };
    if (sess?.access_token) headers.Authorization = `Bearer ${sess.access_token}`;
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

  async function getAccessToken() {
    await maybeRefreshToken();
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || null;
  }

  async function clearAuthSessionEverywhere() {
    try {
      const sb = getSupabase();
      if (sb) await sb.auth.signOut();
    } catch (_) {
      /**/
    }
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (_) {
      /**/
    }
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
    const headers = { apikey: CONFIG.supabaseAnonKey };
    const sb = getSupabase();
    if (sb) {
      try {
        await maybeRefreshToken();
        const { data } = await sb.auth.getSession();
        if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
      } catch (_) {
        /**/
      }
    }
    const path = `/rest/v1/${view}?select=${selectCols}&order=${metric}&limit=${limit}`;
    const res = await fetch(`${CONFIG.supabaseUrl}${path}`, { method: 'GET', headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed: ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
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
        /* REST fallback */
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

  async function getMe() {
    return authFetch('/auth/v1/user', { method: 'GET' });
  }

  async function ensureProfile(me) {
    const u = me && me.id ? me : await getMe();
    const uid = u?.id;
    if (!uid) return null;
    const existing = await authFetch(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,handle,display_name&limit=1`,
      {
        method: 'GET'
      }
    );
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

  async function startOAuth(provider) {
    if (!isEnabled()) return;
    const sb = getSupabase();
    if (!sb) return;
    const redirectTo = gamesAuthRedirectPath();
    await sb.auth.signInWithOAuth({ provider, options: { redirectTo } });
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

  function mergeLastDaily(localD, remoteD) {
    const l = normalizeLastDailyForStorage(localD);
    const r = normalizeLastDailyForStorage(remoteD);
    if (!l) return r;
    if (!r) return l;
    return l >= r ? l : r;
  }

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

  async function hydrateWalletAfterLogin() {
    if (!isEnabled()) return;
    try {
      const token = await getAccessToken();
      if (!token) return;

      let row = null;
      try {
        row = await ensureWallet();
      } catch (_) {
        return;
      }
      if (!row) return;

      let cloudLike = row;
      try {
        const snap = readFunWalletSnapshot();
        const ep = deriveImportDeviceWalletEndpoint();
        if (!ep) {
          writeFunWalletLocal(reconcileLocalWithCloudRow(readFunWalletSnapshot(), row));
          return;
        }

        const ir = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
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
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase client unavailable');
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: gamesAuthRedirectPath(),
        shouldCreateUser: true
      }
    });
    if (error) throw error;
  }

  async function recordSettlement(evt) {
    if (!isEnabled() || !CONFIG.settleEndpoint) return null;
    await maybeRefreshToken();
    const accessToken = await getAccessToken();
    if (!accessToken) return null;
    let res;
    try {
      res = await fetch(CONFIG.settleEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: CONFIG.supabaseAnonKey
        },
        body: JSON.stringify({
          game: evt.game,
          detail: evt.detail,
          delta: evt.delta
        })
      });
    } catch (_) {
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.wallet || null;
  }

  async function loadLeaderboard() {
    if (!isEnabledBasics()) return;
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
          const score =
            leaderboardScope === 'weekly'
              ? Number(row.weekly_net_delta || 0)
              : Number(row.current_balance || 0);
          const rounds =
            leaderboardScope === 'weekly' ? Number(row.weekly_rounds || 0) : Number(row.total_rounds || 0);
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
        '<tr><td colspan="4">Leaderboard unavailable. Deploy Edge <code>leaderboard</code> or run latest <code>schema.sql</code> (RPC); load <code>assets/js/vendor/supabase.umd.min.js</code>.</td></tr>';
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
    const token = await getAccessToken();
    if (!token) {
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

    byId('games-oauth-google')?.addEventListener('click', () => {
      void startOAuth('google');
    });
    byId('games-oauth-discord')?.addEventListener('click', () => {
      void startOAuth('discord');
    });
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
      await clearAuthSessionEverywhere();
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

  function isAuthRevokedError(txt) {
    return (
      /\b401\b/.test(txt) ||
      /JWT expired/i.test(txt) ||
      /invalid_grant/i.test(txt) ||
      /invalid refresh token/i.test(txt) ||
      /refresh_token_not_found/i.test(txt) ||
      /invalid jwt/i.test(txt) ||
      /session (?:expired|missing|not found)/i.test(txt)
    );
  }

  async function refreshSignedInChrome() {
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
      if (isAuthRevokedError(txt)) {
        await clearAuthSessionEverywhere();
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        updateCloudBadge('Cloud OFF', false);
      }
    }
    await loadLeaderboard().catch(() => {});
  }

  async function init() {
    const signalInitDone = () => {
      window.dispatchEvent(new CustomEvent('fuqmea-cloud-init-complete'));
    };

    try {
      if (!isEnabledBasics()) {
        updateCloudBadge('Cloud OFF', false);
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        return;
      }

      await initAuthUi();

      if (!isEnabled()) {
        updateCloudBadge('OFF — vendor supabase.umd.min.js missing', false);
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        await loadLeaderboard().catch(() => {});
        return;
      }

      const sb = getSupabase();
      if (!sb) {
        signalInitDone();
        return;
      }

      await bootstrapAuthSession(sb);

      const { data: sessWrap } = await sb.auth.getSession();

      if (!sessWrap.session?.access_token) {
        updateCloudBadge('Cloud ready (login needed)', false);
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        const m = byId('games-cloud-msg');
        if (m)
          m.textContent =
            'Sign in to save progress on this device. While signed in, each round settles to the cloud automatically.';
        await loadLeaderboard().catch(() => {});
        return;
      }

      await refreshSignedInChrome();
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
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
})();
