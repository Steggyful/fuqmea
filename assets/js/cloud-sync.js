(function () {
  'use strict';

  /** Bumped on each material cloud-sync change; surfaced as a tiny chip in the account panel. */
  const BUILD = '1.25.0';

  /** Latest profile row from server — used to restore the display-name field on Cancel and keep preview in sync. */
  let lastLoadedProfileRow = null;

  function safeAvatarSrc(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    if (!raw.startsWith('assets/images/') || raw.includes('..') || raw.includes('//')) return '';
    return raw;
  }

  /** Same key as games.js — must stay in sync for offline→cloud one-time merge. */
  const FUN_WALLET_KEY = 'fuqmea_fun_wallet_v1';

  /** Pre-sign-in guest wallet snapshot. Restored on sign-out so the cloud balance
   *  never leaks into guest play (anti-abuse: kills sign-in -> sign-out -> drain ->
   *  repeat farming). */
  const GUEST_WALLET_BACKUP_KEY = 'fuqmea_guest_wallet_v1';

  /** Migrate once from legacy hand-rolled session storage (implicit / old boot). */
  const LEGACY_SESSION_KEY = 'fuqmea_cloud_session_v1';

  /** Implicit-grant redirects use URL fragments; stash before stripping so async init can setSession(). */
  const IMPLICIT_FRAG_PENDING_KEY = 'fuqmea_auth_implicit_frag_pending_v1';

  /** Snapshot the auth-callback intent BEFORE supabase-js touches the URL so we can surface failures. */
  const incomingAuthCallbackKind = (() => {
    try {
      const s = new URLSearchParams(window.location.search || '');
      if (s.get('code')) return 'pkce';
      if (s.get('token_hash')) return 'token_hash';
      const h = window.location.hash || '';
      if (h.includes('code=')) return 'pkce';
      if (h.includes('access_token=')) return 'implicit';
    } catch (_) {
      /**/
    }
    return null;
  })();

  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  /** Defer singleton until bootstrap (vendor script runs before this file). */
  let supabaseClient = null;

  let leaderboardScope = 'alltime';
  /** Set by bootstrap so init() can show a precise reason without re-reading the URL. */
  let lastAuthCallbackError = null;
  /** True after a successful PKCE/token-hash exchange so `init` skips the duplicate refresh. */
  let authCallbackJustSignedIn = false;
  /** Guard against onAuthStateChange + post-bootstrap double-running refreshSignedInChrome. */
  let chromeRefreshInFlight = false;

  function authDebugEnabled() {
    try {
      return localStorage.getItem('fuq_auth_debug') === '1';
    } catch (_) {
      return false;
    }
  }

  function authLog() {
    if (!authDebugEnabled()) return;
    try {
      // eslint-disable-next-line no-console
      console.log.apply(console, ['[FuqCloud]'].concat(Array.from(arguments)));
    } catch (_) {
      /**/
    }
  }

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
            // Required for flowType: 'pkce'. With this true, supabase-js wires the PKCE state
            // machine on signInWithOAuth, parses ?code= on return, exchanges for a session, and
            // strips the URL itself. Manual exchangeCodeForSession was racing that machine and
            // producing "invalid flow state" 404s on /auth/v1/token?grant_type=pkce.
            detectSessionInUrl: true,
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

  function stripAuthParamsFromUrl() {
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (_) {
      /**/
    }
  }

  /**
   * Migrate any legacy/implicit storage into a real supabase-js session BEFORE the singleton is used.
   * PKCE `?code=` and `?token_hash=` are handled automatically by supabase-js once
   * `detectSessionInUrl: true` is set; we do NOT call exchangeCodeForSession / verifyOtp here.
   * Post-init failure surfacing lives in init() against `incomingAuthCallbackKind`.
   */
  async function bootstrapAuthSession(sb) {
    if (!sb) return;
    lastAuthCallbackError = null;
    authCallbackJustSignedIn = false;
    authLog('bootstrap start, incoming callback?', incomingAuthCallbackKind);

    try {
      const pend = localStorage.getItem(IMPLICIT_FRAG_PENDING_KEY);
      if (pend) {
        localStorage.removeItem(IMPLICIT_FRAG_PENDING_KEY);
        try {
          const p = JSON.parse(pend);
          if (p?.access_token && p?.refresh_token) {
            const { error } = await sb.auth.setSession({
              access_token: p.access_token,
              refresh_token: p.refresh_token
            });
            if (!error) {
              authCallbackJustSignedIn = true;
              authLog('implicit session restored');
            } else {
              authLog('implicit setSession error', error);
            }
          }
        } catch (e) {
          authLog('implicit JSON parse error', e);
        }
      }
    } catch (e) {
      authLog('implicit pending read error', e);
    }

    try {
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
            authLog('legacy session restored');
          }
        } catch (e) {
          authLog('legacy session parse error', e);
        }
      }
    } catch (e) {
      authLog('legacy session read error', e);
    }

    // Touch getSession so supabase-js finishes its `detectSessionInUrl` work
    // (parses ?code=, exchanges, sets session, and strips the URL itself).
    try {
      await sb.auth.getSession();
    } catch (e) {
      authLog('getSession after bootstrap error', e);
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

  /** Cached auth state so other modules (games.js) can react via fuqmea-cloud-auth-state. */
  let signedInCached = false;

  function isSignedIn() {
    return signedInCached;
  }

  /** Guest blurb vs signed-in line + optional status strip (games-cloud-msg + games-cloud-auth-inline-msg). */
  function setCloudAccountPanelMode(opts) {
    if (!opts || typeof opts !== 'object') return;
    const signedIn = Boolean(opts.signedIn);
    const me = opts.me;
    const guestLead = byId('games-cloud-lead-guest');
    const signedLine = byId('games-cloud-signed-line');
    const msgEl = byId('games-cloud-msg');
    const inlineMsgEl = byId('games-cloud-auth-inline-msg');
    if (guestLead) guestLead.hidden = signedIn;
    if (signedLine) {
      signedLine.hidden = !signedIn;
      if (signedIn) {
        const em =
          me && typeof me.email === 'string' && me.email.includes('@') ? me.email : '';
        signedLine.textContent = em ? `Signed in as ${em}` : 'Signed in.';
      } else {
        signedLine.textContent = '';
      }
    }
    if (Object.prototype.hasOwnProperty.call(opts, 'statusNote')) {
      const note = opts.statusNote == null ? '' : String(opts.statusNote);
      if (msgEl) msgEl.textContent = note;
      if (inlineMsgEl) inlineMsgEl.textContent = signedIn ? '' : note;
    }
    if (signedInCached !== signedIn) {
      signedInCached = signedIn;
      window.dispatchEvent(
        new CustomEvent('fuqmea-cloud-auth-state', { detail: { signedIn } })
      );
    }
  }

  function collapseProfileEditor() {
    const ed = byId('games-display-name-editor');
    const inp = byId('games-display-name');
    const toggleBtn = byId('games-display-name-toggle');
    if (ed) ed.hidden = true;
    if (inp && lastLoadedProfileRow) {
      const dn = lastLoadedProfileRow.display_name;
      inp.value = dn != null && String(dn).trim() !== '' ? String(dn).trim() : '';
    }
    if (toggleBtn) toggleBtn.textContent = 'Change';
  }

  function setProfileBlockVisible(show) {
    const block = byId('games-cloud-profile-block');
    const inp = byId('games-display-name');
    if (block) block.hidden = !show;
    if (!show) {
      lastLoadedProfileRow = null;
      if (inp) inp.value = '';
      const ed = byId('games-display-name-editor');
      if (ed) ed.hidden = true;
      const toggleBtn = byId('games-display-name-toggle');
      if (toggleBtn) toggleBtn.textContent = 'Change';
      const pfpEd = byId('games-pfp-editor');
      if (pfpEd) pfpEd.hidden = true;
      const pfpToggle = byId('games-pfp-toggle');
      if (pfpToggle) pfpToggle.textContent = 'Choose';
      syncAvatarPreview(null);
    }
  }

  function setAccountToolbarVisible(show) {
    const t = byId('games-account-toolbar');
    if (t) t.hidden = !show;
  }

  function setGuestLoginAreaVisible(show) {
    const el = byId('games-account-login-actions');
    if (el) el.hidden = !show;
  }

  /** Reset every signed-in surface back to the guest layout. Avoids the chip-says-Not-signed-in
   *  but Sign-out-button-still-showing half-state we hit when an auth callback fails.
   *  Also collapses the email <details> and clears email/code inputs so a returning logged-out
   *  user starts from a closed "Sign in with email code" summary, not an already-expanded form. */
  function applyGuestChrome(statusNote) {
    setProfileBlockVisible(false);
    setGuestLoginAreaVisible(true);
    setAccountToolbarVisible(false);
    setOtpBlockVisible(false);
    pendingOtpEmail = '';
    try {
      const details = byId('games-cloud-email-details');
      if (details) details.open = false;
      const emailInput = byId('games-cloud-email');
      if (emailInput) emailInput.value = '';
      const codeInput = byId('games-cloud-otp-code');
      if (codeInput) codeInput.value = '';
    } catch (_) {
      /**/
    }
    updateCloudBadge('Not signed in', false);
    setCloudAccountPanelMode({ signedIn: false, statusNote: statusNote || '' });
  }

  /** Light wrapper: also paints the version chip if it is in the DOM. */
  function paintBuildChip() {
    try {
      const el = byId('games-cloud-build');
      if (el) el.textContent = `v${BUILD}`;
    } catch (_) {
      /**/
    }
  }

  async function fetchLeaderboardViaRest(limit) {
    const view = leaderboardScope === 'weekly' ? 'leaderboard_weekly' : 'leaderboard_all_time';
    const metric = leaderboardScope === 'weekly' ? 'weekly_wagered.desc' : 'lifetime_wagered.desc';
    const withAura =
      leaderboardScope === 'weekly'
        ? 'leaderboard_name,weekly_wagered,weekly_rounds,aura_peak,avatar_url'
        : 'leaderboard_name,lifetime_wagered,total_rounds,net_delta,aura_peak,avatar_url';
    const legacy =
      leaderboardScope === 'weekly'
        ? 'leaderboard_name,weekly_wagered,weekly_rounds'
        : 'leaderboard_name,lifetime_wagered,total_rounds,net_delta';
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
    async function reqOne(selectCols) {
      const path = `/rest/v1/${view}?select=${selectCols}&order=${metric}&limit=${limit}`;
      const res = await fetch(`${CONFIG.supabaseUrl}${path}`, { method: 'GET', headers });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed: ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    }
    try {
      return await reqOne(withAura);
    } catch (_) {
      return reqOne(legacy);
    }
  }

  async function fetchLeaderboardRows(limit) {
    // Only call the JWT-protected Edge function when we have a bearer; guests would 401, which clutters
    // the console even though we silently fall through. Public RLS on leaderboard_aggregate covers guests.
    let bearer = null;
    const sb = getSupabase();
    if (sb) {
      try {
        await maybeRefreshToken();
        const { data } = await sb.auth.getSession();
        bearer = data.session?.access_token || null;
      } catch (_) {
        /**/
      }
    }
    if (bearer) {
      const ep = deriveLeaderboardEndpoint();
      if (ep) {
        try {
          const res = await fetch(ep, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: CONFIG.supabaseAnonKey,
              Authorization: `Bearer ${bearer}`
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
    }
    return fetchLeaderboardViaRest(limit);
  }

  function updateLeaderboardTableHeadLabels() {
    const scoreCol = byId('games-lb-head-score');
    if (scoreCol) {
      scoreCol.textContent = leaderboardScope === 'weekly' ? 'Week wagered' : 'Lifetime wagered';
    }
    const rndCol = byId('games-lb-head-rounds');
    if (rndCol) {
      rndCol.textContent = leaderboardScope === 'weekly' ? 'Week rounds' : 'Rounds';
    }
    const auraHead = byId('games-lb-head-aura');
    if (auraHead) {
      auraHead.textContent =
        leaderboardScope === 'weekly' ? 'Aura peak (all-time)' : 'Aura peak';
    }
  }

  function syncLeaderboardScopeButtons() {
    const allt = byId('games-leaderboard-scope-alltime');
    const wk = byId('games-leaderboard-scope-weekly');
    if (allt) allt.classList.toggle('games-quest-toggle--active', leaderboardScope === 'alltime');
    if (wk) wk.classList.toggle('games-quest-toggle--active', leaderboardScope === 'weekly');
  }

  function syncAvatarPreview(url) {
    const img = byId('games-pfp-img');
    const placeholder = byId('games-pfp-placeholder');
    const clearBtn = byId('games-pfp-clear');
    const safe = safeAvatarSrc(url);
    if (img) {
      if (safe) {
        img.src = safe;
        img.hidden = false;
      } else {
        img.src = '';
        img.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = !!safe;
    if (clearBtn) clearBtn.hidden = !safe;
  }

  function syncProfileForm(profile) {
    const inp = byId('games-display-name');
    const preview = byId('games-leaderboard-name-preview');
    const sub = byId('games-display-name-sub');
    if (!inp) return;
    lastLoadedProfileRow = profile && typeof profile === 'object' ? { ...profile } : null;
    const dnRaw = profile?.display_name != null ? String(profile.display_name).trim() : '';
    const handleRaw = profile?.handle != null ? String(profile.handle).trim() : '';
    const shown = dnRaw.length >= 2 ? dnRaw : handleRaw || '—';
    if (preview) preview.textContent = shown;
    if (sub) {
      sub.textContent =
        dnRaw.length >= 2
          ? 'Custom name shown on the leaderboard.'
          : 'Using your automatic handle until you set a custom name.';
    }
    inp.value = dnRaw.length >= 2 ? dnRaw : '';
    collapseProfileEditor();
    syncAvatarPreview(profile?.avatar_url || null);
    setProfileBlockVisible(true);
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
    const pol = typeof window !== 'undefined' ? window.FuqDisplayNamePolicy : null;
    if (pol && typeof pol.displayNameFailsPolicy === 'function' && raw.length > 0 && pol.displayNameFailsPolicy(raw)) {
      if (hint) hint.textContent = 'That name isn’t allowed — pick something else.';
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
      const prof = await ensureProfile(me);
      syncProfileForm(prof);
      await loadLeaderboard();
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '';
      const dup =
        /23505|duplicate key|unique constraint|profiles_display_name_lower_unique/i.test(msg);
      const blocked =
        /DISPLAY_NAME DISALLOWED|23514/i.test(msg) ||
        /display_name.*check/i.test(msg);
      if (hint) {
        if (blocked) {
          hint.textContent = 'That name isn’t allowed — pick something else.';
        } else if (dup) {
          hint.textContent = 'That display name is already taken — pick another.';
        } else {
          hint.textContent = 'Could not save — try again.';
        }
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
      `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,handle,display_name,avatar_url&limit=1`,
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
    const selFull =
      'tokens,coin_streak,last_daily,aura_peak_multiplier,rakeback_pool,arcade_streaks,quest_state';
    const selBase = 'tokens,coin_streak,last_daily';
    async function selectRow(sel) {
      return authFetch(`/rest/v1/wallets?select=${encodeURIComponent(sel)}&user_id=eq.${q}&limit=1`, {
        method: 'GET'
      });
    }
    let rows;
    try {
      rows = await selectRow(selFull);
    } catch (_) {
      rows = await selectRow(selBase);
    }
    if (rows?.length) return rows[0];
    await authFetch('/rest/v1/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{}])
    });
    try {
      rows = await selectRow(selFull);
    } catch (_) {
      rows = await selectRow(selBase);
    }
    return rows?.[0] || null;
  }

  function readFunWalletSnapshot() {
    try {
      const raw = localStorage.getItem(FUN_WALLET_KEY);
      if (!raw) return { tokens: 200, coinStreak: 0, lastDaily: '', rakebackPool: 0 };
      const w = JSON.parse(raw);
      return {
        tokens: Math.max(0, Math.floor(Number(w.tokens) || 0)),
        coinStreak: Math.max(0, Math.floor(Number(w.coinStreak) || 0)),
        lastDaily: typeof w.lastDaily === 'string' ? w.lastDaily : '',
        rakebackPool: Math.max(0, Math.round(Number(w.rakebackPool) * 100) / 100) || 0
      };
    } catch {
      return { tokens: 200, coinStreak: 0, lastDaily: '', rakebackPool: 0 };
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
      lastDaily: normalizeLastDailyForStorage(w.lastDaily),
      rakebackPool: Math.max(0, Math.round(Number(w.rakebackPool) * 100) / 100) || 0
    };
    localStorage.setItem(FUN_WALLET_KEY, JSON.stringify(out));
    window.dispatchEvent(new CustomEvent('fuqmea-wallet-hydrated'));
  }

  function readGuestBackup() {
    try {
      const raw = localStorage.getItem(GUEST_WALLET_BACKUP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeGuestBackup(snap) {
    try {
      localStorage.setItem(GUEST_WALLET_BACKUP_KEY, JSON.stringify(snap));
    } catch (_) {
      /**/
    }
  }

  function clearGuestBackup() {
    try {
      localStorage.removeItem(GUEST_WALLET_BACKUP_KEY);
    } catch (_) {
      /**/
    }
  }

  /** Idempotent: only the FIRST SIGNED_IN after a guest stretch saves the backup;
   *  subsequent SIGNED_IN events (e.g. token-refresh re-emits) are no-ops. */
  function snapshotGuestIfFirstSignIn() {
    if (readGuestBackup()) return;
    writeGuestBackup(readFunWalletSnapshot());
    window.dispatchEvent(new CustomEvent('fuqmea-guest-quest-backup'));
  }

  /** Restore the pre-sign-in guest wallet on sign-out, then drop the backup so the
   *  next sign-in captures a fresh snapshot. Falls back to a fresh-guest 200 if no
   *  backup exists (e.g. user cleared storage). */
  function restoreGuestOrReset() {
    const backup = readGuestBackup();
    const target = backup || { tokens: 200, coinStreak: 0, lastDaily: '', rakebackPool: 0 };
    // Guest mode never has rakeback (server-side feature for signed-in users only).
    target.rakebackPool = 0;
    writeFunWalletLocal(target);
    clearGuestBackup();
    window.dispatchEvent(new CustomEvent('fuqmea-restore-guest-quests'));
  }

  function mergeLastDaily(localD, remoteD) {
    const l = normalizeLastDailyForStorage(localD);
    const r = normalizeLastDailyForStorage(remoteD);
    if (!l) return r;
    if (!r) return l;
    return l >= r ? l : r;
  }

  function emitAuraCloudPeak(walletRow) {
    if (!walletRow || typeof walletRow !== 'object') return;
    const ap = walletRow.aura_peak_multiplier ?? walletRow.auraPeakMultiplier;
    const pk = typeof ap === 'number' ? ap : parseFloat(ap);
    if (!Number.isFinite(pk) || pk <= 0) return;
    window.dispatchEvent(new CustomEvent('fuqmea-aura-cloud-peak', { detail: { peak: pk } }));
  }

  /** Dispatched after wallet hydrate so games.js can merge server arcade bests into WIN_STREAK_KEY. */
  function emitArcadeStreaksFromWalletRow(walletRow) {
    if (!walletRow || typeof walletRow !== 'object') return;
    const raw = walletRow.arcade_streaks ?? walletRow.arcadeStreaks;
    if (raw == null || raw === '') return;
    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return;
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    window.dispatchEvent(new CustomEvent('fuqmea-arcade-streaks-cloud', { detail: parsed }));
  }

  /** Dispatched after wallet hydrate / refresh so games.js can merge quest progress + claimed flags. */
  function emitQuestStateFromWalletRow(walletRow) {
    if (!walletRow || typeof walletRow !== 'object') return;
    const raw = walletRow.quest_state ?? walletRow.questState;
    if (raw == null || raw === '') return;
    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return;
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    window.dispatchEvent(new CustomEvent('fuqmea-quest-state-cloud', { detail: parsed }));
  }

  async function refreshQuestStateFromWallet() {
    const row = await ensureWallet();
    if (row) emitQuestStateFromWalletRow(row);
  }

  async function mergeQuestState(patch) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'no_client' };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, error: 'invalid_patch' };
    }
    const { data, error } = await sb.rpc('merge_quest_state', { p_patch: patch });
    if (error) {
      return { ok: false, error: shortErrText(error) };
    }
    if (data && typeof data === 'object') {
      window.dispatchEvent(new CustomEvent('fuqmea-quest-state-cloud', { detail: data }));
    }
    return { ok: true, quest_state: data };
  }

  /** Cloud `tokens` are authoritative once we have a server row — server applies deltas; max(local,cloud) caused UI desync. */
  function reconcileLocalWithCloudRow(localSnap, cloudRow) {
    if (!cloudRow || typeof cloudRow !== 'object') {
      return {
        tokens: localSnap.tokens,
        coinStreak: localSnap.coinStreak,
        lastDaily: localSnap.lastDaily,
        rakebackPool: localSnap.rakebackPool || 0
      };
    }
    const cTok = Math.max(0, Math.floor(Number(cloudRow.tokens) || 0));
    const streakSrc = cloudRow.coin_streak ?? cloudRow.coinStreak;
    const cStreak = Math.max(0, Math.floor(Number(streakSrc) || 0));
    const ldRemote = cloudRow.last_daily ?? cloudRow.lastDaily;
    const rbSrc = cloudRow.rakeback_pool ?? cloudRow.rakebackPool;
    const cRake = Math.max(0, Math.round(Number(rbSrc) * 100) / 100) || 0;
    return {
      tokens: cTok,
      coinStreak: Math.max(cStreak, localSnap.coinStreak),
      lastDaily: mergeLastDaily(localSnap.lastDaily, ldRemote),
      rakebackPool: cRake
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
          emitAuraCloudPeak(row);
          emitArcadeStreaksFromWalletRow(row);
          emitQuestStateFromWalletRow(row);
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
        /** RPC returns tokens/coin_streak/last_daily; merge onto REST row so rakeback_pool,
         *  arcade_streaks, aura_peak_multiplier are not wiped to missing/undefined. */
        if (j && typeof j === 'object' && j.wallet) cloudLike = { ...row, ...j.wallet };
      } catch (_) {
        cloudLike = row;
      }

      writeFunWalletLocal(reconcileLocalWithCloudRow(readFunWalletSnapshot(), cloudLike));
      emitAuraCloudPeak(cloudLike);
      emitArcadeStreaksFromWalletRow(cloudLike);
      emitQuestStateFromWalletRow(cloudLike);
    } catch (_) {
      writeFunWalletLocal(readFunWalletSnapshot());
    }
  }

  /** Tracks the email a code was just sent to so the verify/resend buttons know who to talk to. */
  let pendingOtpEmail = '';

  async function requestEmailCode(email) {
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
    pendingOtpEmail = email;
  }

  async function verifyEmailCode(email, token) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase client unavailable');
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  }

  function setOtpBlockVisible(show) {
    const block = byId('games-cloud-otp-block');
    if (block) block.hidden = !show;
    if (!show) {
      const codeInput = byId('games-cloud-otp-code');
      if (codeInput) codeInput.value = '';
    }
  }

  /** Serialized so settlement responses apply in order (no balance races). */
  let settlementChain = Promise.resolve();
  let settlementInFlight = 0;
  let lastSettlementResult = null;

  function emitSettlementPending() {
    try {
      window.dispatchEvent(
        new CustomEvent('fuqmea-settlement-pending', {
          detail: { count: settlementInFlight }
        })
      );
    } catch (_) {
      /**/
    }
  }

  function bumpSettlementInFlight(d) {
    settlementInFlight = Math.max(0, settlementInFlight + d);
    emitSettlementPending();
  }

  /**
   * @returns {Promise<{ ok: boolean, wallet?: object, error?: string, status?: number, detail?: string, eventId?: * }>}
   */
  async function settleOneRequest(evt) {
    if (!isEnabled() || !CONFIG.settleEndpoint) {
      return { ok: false, error: 'cloud_disabled' };
    }
    await maybeRefreshToken();
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, error: 'not_signed_in' };

    const body = {
      game: evt.game,
      detail: evt.detail,
      delta: evt.delta
    };
    const cs = evt.coin_streak != null ? evt.coin_streak : evt.coinStreak;
    if (typeof cs === 'number' && Number.isFinite(cs)) body.coin_streak = Math.trunc(cs);
    const ld = evt.last_daily != null ? evt.last_daily : evt.lastDaily;
    if (typeof ld === 'string' && ld.trim()) body.last_daily = ld.trim().slice(0, 10);
    const wa = evt.wager_amount != null ? Number(evt.wager_amount) : null;
    if (wa != null && Number.isFinite(wa) && wa >= 0) body.wager_amount = Math.trunc(wa);

    const qpk = evt.quest_period_key != null ? String(evt.quest_period_key).trim().slice(0, 32) : '';
    const qid = evt.quest_id != null ? String(evt.quest_id).trim().slice(0, 48) : '';
    if (qpk) body.quest_period_key = qpk;
    if (qid) body.quest_id = qid;

    const gKey = typeof evt.game === 'string' ? evt.game.trim().toLowerCase() : '';
    if (
      gKey === 'crash' &&
      evt.crash_peak_mult != null &&
      Number.isFinite(Number(evt.crash_peak_mult))
    ) {
      const pm = Number(evt.crash_peak_mult);
      body.crash_peak_mult = Math.round(Math.min(Math.max(pm, 1), 89) * 100) / 100;
    }

    let res;
    try {
      res = await fetch(CONFIG.settleEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: CONFIG.supabaseAnonKey
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return { ok: false, error: 'network', detail: String(err && err.message ? err.message : err) };
    }

    const rawText = await res.text().catch(() => '');
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      const errMsg =
        (data && typeof data === 'object' && data.error != null ? String(data.error) : '') ||
        rawText ||
        `http_${res.status}`;
      const out = { ok: false, status: res.status, error: errMsg };
      return out;
    }

    const wallet = data && typeof data === 'object' ? data.wallet : null;
    if (!wallet || typeof wallet !== 'object') {
      return { ok: false, error: 'no_wallet_in_response' };
    }
    return {
      ok: true,
      wallet,
      status: res.status,
      eventId: data && data.eventId != null ? data.eventId : null
    };
  }

  /**
   * FIFO: one settlement HTTP request at a time.
   * @returns {Promise<{ ok: boolean, wallet?: object, error?: string, status?: number }>}
   */
  function recordSettlement(evt) {
    const run = async () => {
      bumpSettlementInFlight(1);
      try {
        const out = await settleOneRequest(evt);
        lastSettlementResult = out;
        return out;
      } finally {
        bumpSettlementInFlight(-1);
      }
    };
    const p = settlementChain.then(run, run);
    settlementChain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  }

  function getLastSettlementResult() {
    return lastSettlementResult;
  }

  function getSettlementInFlightCount() {
    return settlementInFlight;
  }

  async function loadLeaderboard() {
    if (!isEnabledBasics()) return;
    const tbody = byId('games-leaderboard-body');
    if (!tbody) return;
    updateLeaderboardTableHeadLabels();
    syncLeaderboardScopeButtons();
    const skeletonNameWidths = ['5rem', '4rem', '6rem', '3.5rem', '5.5rem', '4.5rem'];
    tbody.innerHTML = skeletonNameWidths.map(() => `<tr class="lb-skeleton-row">
      <td><span class="lb-skeleton-cell" style="width:0.8rem"></span></td>
      <td><div class="lb-name-cell">
        <span class="lb-pfp lb-pfp--empty"></span>
        <span class="lb-skeleton-cell" style="width:${skeletonNameWidths[Math.floor(Math.random()*skeletonNameWidths.length)]}"></span>
      </div></td>
      <td><span class="lb-skeleton-cell" style="width:2.2rem"></span></td>
      <td><span class="lb-skeleton-cell" style="width:1.4rem"></span></td>
      <td><span class="lb-skeleton-cell" style="width:1.8rem"></span></td>
    </tr>`).join('');
    try {
      const lim = Number(CONFIG.leaderboardLimit || 25);
      const rows = await fetchLeaderboardRows(lim);
      if (!rows?.length) {
        tbody.innerHTML = '<tr><td colspan="5">No players yet.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map((row, idx) => {
          const score =
            leaderboardScope === 'weekly'
              ? Number(row.weekly_wagered || 0)
              : Number(row.lifetime_wagered || 0);
          const rounds =
            leaderboardScope === 'weekly' ? Number(row.weekly_rounds || 0) : Number(row.total_rounds || 0);
          const apRaw = Number(row.aura_peak ?? row.aura_peak_multiplier ?? 0);
          const apCell = Number.isFinite(apRaw) && apRaw > 0 ? `${apRaw.toFixed(2)}×` : '—';
          const name = String(row.leaderboard_name || row.handle || 'player')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const avatarSrc = safeAvatarSrc(row.avatar_url);
          const pfpHtml = avatarSrc
            ? `<img class="lb-pfp" src="${avatarSrc}" alt="" loading="lazy">`
            : `<span class="lb-pfp lb-pfp--empty" aria-hidden="true"></span>`;
          return `<tr>
            <td>${idx + 1}</td>
            <td><div class="lb-name-cell">${pfpHtml}<span>${name}</span></div></td>
            <td>${score.toLocaleString()}</td>
            <td>${rounds.toLocaleString()}</td>
            <td>${apCell}</td>
          </tr>`;
        })
        .join('');
    } catch {
      tbody.innerHTML =
        '<tr><td colspan="5">Leaderboard unavailable. Deploy Edge <code>leaderboard</code> or run latest <code>schema.sql</code> (RPC); load <code>assets/js/vendor/supabase.umd.min.js</code>.</td></tr>';
    }
  }

  /** Floor between auto-hydrates so rapid Alt-Tab / focus toggles don't hammer Supabase. */
  const AUTO_HYDRATE_MIN_MS = 30_000;
  let lastAutoHydrateAt = 0;

  /** Cross-device pull: when the user returns to the tab while signed in, refresh the
   *  authoritative cloud wallet + leaderboard. Replaces the old manual "Sync now" button. */
  async function autoHydrateOnFocus() {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastAutoHydrateAt < AUTO_HYDRATE_MIN_MS) return;
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    lastAutoHydrateAt = now;
    await hydrateWalletAfterLogin().catch(() => {});
    await loadLeaderboard().catch(() => {});
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
      sum.textContent = wantGoogle() || wantDiscord() ? 'Or sign in with email code' : 'Sign in with email code';
    }
  }

  async function initAuthUi() {
    setupLoginLayout();
    const loginForm = byId('games-cloud-login-form');

    byId('games-oauth-google')?.addEventListener('click', () => {
      void startOAuth('google');
    });
    byId('games-oauth-discord')?.addEventListener('click', () => {
      void startOAuth('discord');
    });
    byId('games-display-name-save')?.addEventListener('click', () => {
      saveDisplayName();
    });

    byId('games-pfp-toggle')?.addEventListener('click', async () => {
      const ed = byId('games-pfp-editor');
      const tb = byId('games-pfp-toggle');
      if (!ed) return;
      if (!ed.hidden) {
        ed.hidden = true;
        if (tb) tb.textContent = 'Choose';
        return;
      }
      ed.hidden = false;
      if (tb) tb.textContent = 'Close';
      await openAvatarPicker();
    });

    byId('games-pfp-clear')?.addEventListener('click', async () => {
      const hint = byId('games-pfp-hint');
      const res = await clearAvatar();
      if (res.ok) {
        if (hint) hint.textContent = 'Picture removed.';
        await loadLeaderboard().catch(() => {});
      } else {
        if (hint) hint.textContent = 'Could not remove — try again.';
      }
    });
    byId('games-display-name-toggle')?.addEventListener('click', () => {
      const ed = byId('games-display-name-editor');
      const tb = byId('games-display-name-toggle');
      if (!ed) return;
      ed.hidden = !ed.hidden;
      if (tb) tb.textContent = ed.hidden ? 'Change' : 'Close';
      if (!ed.hidden) byId('games-display-name')?.focus();
    });
    byId('games-display-name-cancel')?.addEventListener('click', () => {
      collapseProfileEditor();
      const hint = byId('games-display-name-hint');
      if (hint) hint.textContent = 'Leave blank to use your handle.';
    });

    if (loginForm) {
      loginForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const emailInput = byId('games-cloud-email');
        const email = String(emailInput?.value || '').trim();
        if (!email || !email.includes('@')) {
          setCloudAccountPanelMode({ signedIn: false, statusNote: 'Enter a valid email.' });
          return;
        }
        try {
          await requestEmailCode(email);
          setOtpBlockVisible(true);
          const det = byId('games-cloud-email-details');
          if (det) det.open = true;
          setCloudAccountPanelMode({
            signedIn: false,
            statusNote: 'Code sent. Enter the 6 digits from your email below.'
          });
          byId('games-cloud-otp-code')?.focus();
        } catch (err) {
          setCloudAccountPanelMode({
            signedIn: false,
            statusNote: `Could not send code (${shortErrText(err)}).`
          });
        }
      });
    }

    byId('games-cloud-otp-verify')?.addEventListener('click', async () => {
      const codeInput = byId('games-cloud-otp-code');
      const code = String(codeInput?.value || '').replace(/\D/g, '').slice(0, 6);
      if (!pendingOtpEmail) {
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: 'Enter your email above first, then request a code.'
        });
        return;
      }
      if (code.length !== 6) {
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: 'Enter the 6-digit code from the email.'
        });
        return;
      }
      try {
        await verifyEmailCode(pendingOtpEmail, code);
        setOtpBlockVisible(false);
        pendingOtpEmail = '';
        // onAuthStateChange('SIGNED_IN') drives refreshSignedInChrome.
      } catch (err) {
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: `Code did not work (${shortErrText(err)}). Try again or resend.`
        });
      }
    });

    byId('games-cloud-otp-code')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        byId('games-cloud-otp-verify')?.click();
      }
    });

    byId('games-cloud-otp-resend')?.addEventListener('click', async () => {
      const targetEmail = pendingOtpEmail || String(byId('games-cloud-email')?.value || '').trim();
      if (!targetEmail || !targetEmail.includes('@')) {
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: 'Enter your email and request a code first.'
        });
        return;
      }
      try {
        await requestEmailCode(targetEmail);
        const det = byId('games-cloud-email-details');
        if (det) det.open = true;
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: 'New code sent. Check your email.'
        });
      } catch (err) {
        setCloudAccountPanelMode({
          signedIn: false,
          statusNote: `Could not resend (${shortErrText(err)}).`
        });
      }
    });

    byId('games-cloud-logout-btn')?.addEventListener('click', async () => {
      await clearAuthSessionEverywhere();
      applyGuestChrome('Signed out.');
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
    if (chromeRefreshInFlight) {
      authLog('refreshSignedInChrome skipped (already in flight)');
      return;
    }
    chromeRefreshInFlight = true;
    setGuestLoginAreaVisible(false);
    setAccountToolbarVisible(true);
    try {
      await maybeRefreshToken().catch(() => {});
      const me = await getMe();
      const prof = await ensureProfile(me);
      // Must run before hydrateWalletAfterLogin: games.js applyQuestCloudPayload gates on isSignedIn()
      // (signedInCached), and hydrate dispatches fuqmea-quest-state-cloud synchronously.
      setCloudAccountPanelMode({
        signedIn: true,
        me,
        statusNote: 'Rounds save automatically while you are signed in.'
      });
      updateCloudBadge('Signed in', true);
      syncProfileForm(prof);
      await hydrateWalletAfterLogin().catch(() => {});
    } catch (err) {
      const txt = String(err?.message || err || '');
      if (isAuthRevokedError(txt)) {
        await clearAuthSessionEverywhere();
        setProfileBlockVisible(false);
        setGuestLoginAreaVisible(true);
        setAccountToolbarVisible(false);
        updateCloudBadge('Not signed in', false);
        setCloudAccountPanelMode({ signedIn: false, statusNote: '' });
      }
    } finally {
      chromeRefreshInFlight = false;
    }
    await loadLeaderboard().catch(() => {});
  }

  async function init() {
    const signalInitDone = () => {
      window.dispatchEvent(new CustomEvent('fuqmea-cloud-init-complete'));
    };

    try {
      paintBuildChip();
      authLog('init', `build=${BUILD}`, 'incomingAuthCallback=', incomingAuthCallbackKind);

      if (!isEnabledBasics()) {
        applyGuestChrome('Cloud save is off in settings.');
        updateCloudBadge('Cloud OFF', false);
        return;
      }

      await initAuthUi();

      if (!isEnabled()) {
        applyGuestChrome('Missing Supabase script — see games.html script includes.');
        updateCloudBadge('Unavailable', false);
        await loadLeaderboard().catch(() => {});
        return;
      }

      const sb = getSupabase();
      if (!sb) {
        signalInitDone();
        return;
      }

      sb.auth.onAuthStateChange((event, session) => {
        authLog('onAuthStateChange', event, !!session?.access_token);
        if (event === 'SIGNED_IN' && session?.access_token) {
          snapshotGuestIfFirstSignIn();
          setOtpBlockVisible(false);
          pendingOtpEmail = '';
          void refreshSignedInChrome();
        } else if (event === 'SIGNED_OUT') {
          restoreGuestOrReset();
          applyGuestChrome('');
          void loadLeaderboard().catch(() => {});
        }
      });

      document.addEventListener('visibilitychange', () => void autoHydrateOnFocus());
      window.addEventListener('focus', () => void autoHydrateOnFocus());

      await bootstrapAuthSession(sb);

      // Belt-and-suspenders: supabase-js usually stripped the URL itself when detectSessionInUrl: true.
      if (incomingAuthCallbackKind) stripAuthParamsFromUrl();

      const { data: sessWrap } = await sb.auth.getSession();
      const haveSession = Boolean(sessWrap.session?.access_token);
      authLog('init session?', haveSession, 'callbackOk?', authCallbackJustSignedIn, 'callbackErr?', !!lastAuthCallbackError);

      if (!haveSession) {
        if (incomingAuthCallbackKind) {
          // Came back from OAuth / magic link but supabase-js did not seat a session.
          // eslint-disable-next-line no-console
          console.error('[FuqCloud] auth callback failed (no session after detection)', {
            kind: incomingAuthCallbackKind
          });
          const guidance =
            incomingAuthCallbackKind === 'pkce'
              ? 'Sign-in didn\u2019t complete. Clear site data and retry in one tab, or use the email code.'
              : 'Sign-in link could not be completed. Request a fresh email code.';
          applyGuestChrome(guidance);
        } else {
          applyGuestChrome('');
        }
        await loadLeaderboard().catch(() => {});
        return;
      }

      // If onAuthStateChange already fired SIGNED_IN inside bootstrap, it kicked off refresh; do not duplicate here.
      if (!authCallbackJustSignedIn && !chromeRefreshInFlight) {
        await refreshSignedInChrome();
      } else {
        authLog('skipping post-bootstrap refresh (callback or in-flight)');
      }
    } finally {
      signalInitDone();
    }
  }

  function shortErrText(err) {
    const raw = err && (err.message || err.error_description || err.error || err.msg) ? String(err.message || err.error_description || err.error || err.msg) : String(err || 'auth error');
    return raw.length > 90 ? `${raw.slice(0, 87)}…` : raw;
  }

  /** Claim accrued server-side rakeback (signed-in only). The RPC pays floor(pool) into
   *  tokens, keeps the fractional remainder, and inserts a 'rakeback_claim' game event
   *  for the history log. Local wallet snapshot is rewritten from the response. */
  async function claimRakeback() {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'no_client' };
    const { data, error } = await sb.rpc('claim_rakeback');
    if (error) {
      return { ok: false, error: shortErrText(error) };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: 'empty_response' };
    const merged = reconcileLocalWithCloudRow(readFunWalletSnapshot(), row);
    writeFunWalletLocal(merged);
    emitAuraCloudPeak(row);
    emitArcadeStreaksFromWalletRow(row);
    emitQuestStateFromWalletRow(row);
    return {
      ok: true,
      paid: Math.max(0, Math.floor(Number(row.paid) || 0)),
      wallet: merged
    };
  }

  /** Merges arcade best streaks server-side (greatest per field). Dispatches `fuqmea-arcade-streaks-cloud` with merged JSON. */
  async function mergeArcadeStreaks(patch) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'no_client' };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, error: 'invalid_patch' };
    }
    const { data, error } = await sb.rpc('merge_arcade_streaks', { p_patch: patch });
    if (error) {
      return { ok: false, error: shortErrText(error) };
    }
    const merged = data;
    if (merged && typeof merged === 'object') {
      window.dispatchEvent(new CustomEvent('fuqmea-arcade-streaks-cloud', { detail: merged }));
    }
    return { ok: true, arcade_streaks: merged };
  }

  async function loadClaimedAvatars() {
    if (!isEnabledBasics()) return new Set();
    try {
      const res = await fetch(
        `${CONFIG.supabaseUrl}/rest/v1/profiles?select=avatar_url&avatar_url=not.is.null`,
        { headers: { apikey: CONFIG.supabaseAnonKey } }
      );
      if (!res.ok) return new Set();
      const rows = await res.json();
      return new Set(Array.isArray(rows) ? rows.map(r => r.avatar_url).filter(Boolean) : []);
    } catch (_) {
      return new Set();
    }
  }

  async function claimAvatar(url) {
    if (!isEnabledBasics()) return { ok: false, error: 'disabled' };
    const safe = safeAvatarSrc(url);
    if (!safe) return { ok: false, error: 'invalid_url' };
    try {
      const me = await getMe();
      if (!me?.id) return { ok: false, error: 'not_signed_in' };
      await authFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(me.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ avatar_url: safe })
      });
      if (lastLoadedProfileRow) lastLoadedProfileRow.avatar_url = safe;
      syncAvatarPreview(safe);
      window.dispatchEvent(new CustomEvent('fuqmea-avatar-changed', { detail: { avatar_url: safe } }));
      return { ok: true };
    } catch (err) {
      const msg = String(err?.message || err || '');
      const dup = /23505|duplicate key|unique constraint/i.test(msg);
      return { ok: false, error: dup ? 'already_claimed' : 'save_failed' };
    }
  }

  async function clearAvatar() {
    if (!isEnabledBasics()) return { ok: false, error: 'disabled' };
    try {
      const me = await getMe();
      if (!me?.id) return { ok: false, error: 'not_signed_in' };
      await authFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(me.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ avatar_url: null })
      });
      if (lastLoadedProfileRow) lastLoadedProfileRow.avatar_url = null;
      syncAvatarPreview(null);
      window.dispatchEvent(new CustomEvent('fuqmea-avatar-changed', { detail: { avatar_url: null } }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'save_failed' };
    }
  }

  async function openAvatarPicker() {
    const grid = byId('games-pfp-grid');
    const hint = byId('games-pfp-hint');
    if (!grid) return;
    grid.innerHTML = '<span class="games-history-hint">Loading gallery…</span>';
    try {
      const [galleryResp, claimedSet] = await Promise.all([
        fetch('assets/images/gallery.json').then(r => r.json()),
        loadClaimedAvatars()
      ]);
      const images = Array.isArray(galleryResp?.images) ? galleryResp.images : [];
      const myUrl = lastLoadedProfileRow?.avatar_url || null;
      grid.innerHTML = '';
      images.forEach(imgPath => {
        if (!safeAvatarSrc(imgPath)) return;
        const isClaimed = claimedSet.has(imgPath);
        const isMine = imgPath === myUrl;
        const btn = document.createElement('button');
        btn.type = 'button';
        let cls = 'games-pfp-thumb';
        if (isClaimed) cls += ' games-pfp-thumb--claimed';
        if (isMine) cls += ' games-pfp-thumb--mine';
        btn.className = cls;
        if (isClaimed && !isMine) btn.disabled = true;
        btn.title = isMine
          ? 'Your current picture'
          : isClaimed
          ? 'Claimed by another player'
          : imgPath.split('/').pop().replace(/\.[^.]+$/, '');
        const img = document.createElement('img');
        img.src = imgPath;
        img.alt = '';
        img.loading = 'lazy';
        btn.appendChild(img);
        if (!isClaimed || isMine) {
          btn.addEventListener('click', async () => {
            if (isMine) return;
            if (hint) hint.textContent = 'Claiming…';
            const res = await claimAvatar(imgPath);
            if (res.ok) {
              const ed = byId('games-pfp-editor');
              const tb = byId('games-pfp-toggle');
              if (ed) ed.hidden = true;
              if (tb) tb.textContent = 'Choose';
              if (hint) hint.textContent = 'Pick a meme — each one can only be claimed once.';
              await loadLeaderboard().catch(() => {});
            } else if (res.error === 'already_claimed') {
              if (hint) hint.textContent = 'Someone just grabbed that one! Pick another.';
              await openAvatarPicker();
            } else {
              if (hint) hint.textContent = 'Could not save — try again.';
            }
          });
        }
        grid.appendChild(btn);
      });
    } catch (_) {
      grid.innerHTML = '<span class="games-history-hint">Could not load gallery.</span>';
    }
  }

  window.FuqCloud = {
    enabled: isEnabled,
    isSignedIn,
    recordSettlement,
    getLastSettlementResult,
    getSettlementInFlightCount,
    refreshLeaderboard: loadLeaderboard,
    claimRakeback,
    mergeArcadeStreaks,
    mergeQuestState,
    refreshQuestStateFromWallet,
    startOAuth,
    claimAvatar,
    clearAvatar,
    loadClaimedAvatars
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
})();
