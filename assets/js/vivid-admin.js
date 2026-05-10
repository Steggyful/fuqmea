(function () {
  'use strict';

  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  let sb = null;

  // ── Supabase client ───────────────────────────────────────────────────────

  function getClient() {
    if (!sb && window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
      sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    }
    return sb;
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function $id(id) { return document.getElementById(id); }

  function showFlash(msg, isErr) {
    const bar = $id('va-status-bar');
    bar.textContent = msg;
    bar.className = isErr ? 'show err' : 'show';
    clearTimeout(bar._t);
    bar._t = setTimeout(() => { bar.className = ''; }, 3000);
  }

  function showView(which) {
    $id('va-login').style.display  = which === 'login'  ? 'flex' : 'none';
    $id('va-panel').hidden          = which !== 'panel';
    $id('va-denied').style.display = which === 'denied' ? 'flex' : 'none';
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const ALLOWED_ROLES = ['vivid', 'admin'];

  // Tracks which user the panel is currently rendered for, so we can skip
  // redundant reloads from token refreshes / duplicate initial events
  // without dropping legitimate sign-in events.
  let lastLoadedUserId = null;

  async function handleSession(session) {
    if (!session) {
      showView('login');
      lastLoadedUserId = null;
      return;
    }
    if (lastLoadedUserId === session.user.id) return;
    lastLoadedUserId = session.user.id;
    await onSession(session);
  }

  async function init() {
    const client = getClient();
    if (!client) { alert('Supabase client failed to load.'); return; }

    // Fast initial paint from cached localStorage session, if any.
    const { data: { session } } = await client.auth.getSession();
    await handleSession(session);

    // INITIAL_SESSION + SIGNED_IN are deduped by lastLoadedUserId above.
    // Token refresh / user update keep the same user — skip entirely so
    // the FiFi form isn't repainted mid-edit on tab return.
    client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      await handleSession(session);
    });
  }

  async function onSession(session) {
    const role = session?.user?.app_metadata?.role;
    if (!ALLOWED_ROLES.includes(role)) {
      showView('denied');
      return;
    }
    $id('va-user-label').textContent = session.user.email || '';
    showView('panel');
    await Promise.all([loadLiveStatus(), loadFifiSettings()]);
  }

  // ── OAuth (preferred — bypasses the captcha flow) ────────────────────────
  async function signInWithProvider(provider) {
    const errEl = $id('va-login-error');
    errEl.textContent = '';
    const { error } = await getClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href }
    });
    if (error) errEl.textContent = error.message;
  }

  const googleBtn = $id('va-google-btn');
  const discordBtn = $id('va-discord-btn');
  if (googleBtn) googleBtn.addEventListener('click', () => signInWithProvider('google'));
  if (discordBtn) discordBtn.addEventListener('click', () => signInWithProvider('discord'));

  let pendingEmail = '';

  $id('va-login-step1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $id('va-send-btn');
    const errEl = $id('va-login-error');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'SENDING...';

    pendingEmail = $id('va-email').value.trim();

    let captchaToken = '';
    try {
      captchaToken = await new Promise((resolve, reject) => {
        hcaptcha.execute('va-captcha', { async: true }).then(r => resolve(r.response)).catch(reject);
      });
    } catch (err) {
      errEl.textContent = 'Captcha failed. Please try again.';
      btn.disabled = false;
      btn.textContent = 'SEND CODE';
      return;
    }

    const { error } = await getClient().auth.signInWithOtp({
      email: pendingEmail,
      options: { shouldCreateUser: false, captchaToken }
    });

    btn.disabled = false;
    btn.textContent = 'SEND CODE';
    if (error) {
      errEl.textContent = error.message;
    } else {
      $id('va-login-step1').style.display = 'none';
      $id('va-email-shown').textContent = pendingEmail;
      $id('va-login-step2').style.display = 'block';
      $id('va-code').focus();
    }
  });

  $id('va-login-step2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $id('va-verify-btn');
    const errEl = $id('va-login-error');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'VERIFYING...';

    const { error } = await getClient().auth.verifyOtp({
      email: pendingEmail,
      token: $id('va-code').value.trim(),
      type: 'email'
    });

    btn.disabled = false;
    btn.textContent = 'VERIFY';
    if (error) errEl.textContent = error.message;
  });

  $id('va-back-btn').addEventListener('click', () => {
    $id('va-login-step2').style.display = 'none';
    $id('va-login-step1').style.display = 'block';
    $id('va-code').value = '';
    $id('va-login-error').textContent = '';
  });

  async function vaLogout() { await getClient().auth.signOut(); }
  $id('va-logout-btn').addEventListener('click', vaLogout);
  const deniedLogout = $id('va-denied-logout');
  if (deniedLogout) deniedLogout.addEventListener('click', vaLogout);

  // ── Live status ───────────────────────────────────────────────────────────

  async function loadLiveStatus() {
    const { data } = await getClient()
      .from('streamer_live_status')
      .select('username, tiktok_live')
      .eq('username', 'ssgvivid')
      .maybeSingle();

    renderLiveToggle(data?.tiktok_live ?? false);
  }

  function renderLiveToggle(isLive) {
    $id('va-live-toggle').innerHTML = `
      <div class="live-toggle-item${isLive ? ' is-live' : ''}">
        <span class="live-badge ${isLive ? 'on' : 'off'}">${isLive ? 'LIVE' : 'OFF'}</span>
        <span class="live-toggle-name">SSGVivid — TikTok</span>
        <button class="btn ${isLive ? 'btn-red' : ''}"
          data-action="toggle-live"
          data-target-live="${!isLive}">
          ${isLive ? 'END LIVE' : 'GO LIVE'}
        </button>
      </div>`;
  }

  async function toggleLive(live) {
    const btn = $id('va-live-toggle').querySelector('button');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;

    let error = null;
    try {
      const result = await Promise.race([
        getClient().rpc('admin_set_tiktok_live', { p_username: 'ssgvivid', p_live: live }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('toggle timed out')), 10000))
      ]);
      error = result.error;
    } catch (err) {
      error = { message: (err && err.message) ? err.message : String(err) };
    }

    if (error) {
      showFlash('Error: ' + error.message, true);
      await loadLiveStatus(); // resyncs the button to actual DB state
      return;
    }
    showFlash(live ? 'You are now LIVE on TikTok 🔴' : 'Live ended.');
    renderLiveToggle(live);
  }

  // Delegated handler — CSP blocks inline onclick.
  $id('va-live-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="toggle-live"]');
    if (!btn) return;
    toggleLive(btn.dataset.targetLive === 'true');
  });

  // ── FiFi Zone editor ──────────────────────────────────────────────────────

  async function loadFifiSettings() {
    const { data } = await getClient()
      .from('fifi_zone_settings')
      .select('image_url, caption, tagline_text, tagline_url')
      .eq('id', 1)
      .maybeSingle();

    if (!data) return;
    $id('fifi-img-url').value      = data.image_url    || '';
    $id('fifi-caption-input').value = data.caption     || '';
    $id('fifi-tagline-text').value  = data.tagline_text || '';
    $id('fifi-tagline-url').value   = data.tagline_url  || '';
    updatePreview(data.image_url, data.caption, data.tagline_text, data.tagline_url);
    updateCharCounts();
  }

  function escapeHtml(str) {
    return (str || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  function updatePreview(imgUrl, caption, taglineText, taglineUrl) {
    const previewImg = $id('fifi-preview-img');
    const previewCap = $id('fifi-preview-caption');
    const previewTag = $id('fifi-preview-tagline');

    if (imgUrl !== undefined) {
      previewImg.src = imgUrl || '';
      previewImg.className = '';
      previewImg.onload  = () => { previewImg.className = 'preview-ok'; };
      previewImg.onerror = () => { previewImg.className = 'preview-err'; };
    }
    if (caption !== undefined) previewCap.textContent = caption || '';

    if (taglineText !== undefined || taglineUrl !== undefined) {
      const text = taglineText !== undefined ? taglineText : ($id('fifi-tagline-text').value || '');
      const url  = taglineUrl  !== undefined ? taglineUrl  : ($id('fifi-tagline-url').value  || '');
      if (url) {
        previewTag.className = 'fifi-preview-tagline';
        previewTag.innerHTML = `<a href="${escapeHtml(url)}" class="social-link" tabindex="-1">${escapeHtml(text)}</a>`;
      } else {
        previewTag.className = 'fifi-preview-tagline plain-text';
        previewTag.textContent = text;
      }
    }
  }

  function updateCharCounts() {
    const imgLen = ($id('fifi-img-url').value     || '').length;
    const capLen = ($id('fifi-caption-input').value || '').length;
    const tagLen = ($id('fifi-tagline-text').value || '').length;

    const imgEl = $id('fifi-img-chars');
    imgEl.textContent = `${imgLen} / 500`;
    imgEl.className = 'char-count' + (imgLen > 450 ? ' warn' : '');

    const capEl = $id('fifi-cap-chars');
    capEl.textContent = `${capLen} / 200`;
    capEl.className = 'char-count' + (capLen > 170 ? ' warn' : '');

    const tagEl = $id('fifi-tag-chars');
    tagEl.textContent = `${tagLen} / 120`;
    tagEl.className = 'char-count' + (tagLen > 100 ? ' warn' : '');
  }

  // Live preview as user types
  let previewDebounce;
  $id('fifi-img-url').addEventListener('input', () => {
    updateCharCounts();
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
      updatePreview($id('fifi-img-url').value.trim(), undefined, undefined, undefined);
    }, 600);
  });

  $id('fifi-caption-input').addEventListener('input', () => {
    updateCharCounts();
    updatePreview(undefined, $id('fifi-caption-input').value, undefined, undefined);
  });

  $id('fifi-tagline-text').addEventListener('input', () => {
    updateCharCounts();
    updatePreview(undefined, undefined, $id('fifi-tagline-text').value, undefined);
  });

  $id('fifi-tagline-url').addEventListener('input', () => {
    updatePreview(undefined, undefined, undefined, $id('fifi-tagline-url').value.trim());
  });

  $id('fifi-save-btn').addEventListener('click', async () => {
    const imgUrl       = $id('fifi-img-url').value.trim();
    const caption      = $id('fifi-caption-input').value.trim();
    const taglineText  = $id('fifi-tagline-text').value.trim();
    const taglineUrl   = $id('fifi-tagline-url').value.trim();
    const statusEl     = $id('va-fifi-status');
    const btn          = $id('fifi-save-btn');

    if (!imgUrl && !caption && !taglineText && !taglineUrl) {
      statusEl.textContent = 'Nothing to save.';
      statusEl.className = 'err';
      return;
    }

    if (btn.disabled) return; // guard against duplicate fires while one is in-flight

    btn.disabled = true;
    btn.textContent = 'SAVING...';
    statusEl.textContent = '';

    // Race the RPC against a hard timeout so the UI never gets stuck if the
    // Supabase client's promise stalls (mid-flight JWT refresh, dropped socket, etc.).
    let data = null;
    let error = null;
    try {
      const rpcPromise = getClient().rpc('set_fifi_zone_settings', {
        p_image_url:    imgUrl      || null,
        p_caption:      caption     || null,
        p_tagline_text: taglineText || null,
        p_tagline_url:  taglineUrl  || null
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('save timed out (15s)')), 15000)
      );
      const result = await Promise.race([rpcPromise, timeoutPromise]);
      data = result.data;
      error = result.error;
    } catch (err) {
      error = { message: (err && err.message) ? err.message : String(err) };
    } finally {
      btn.disabled = false;
      btn.textContent = 'SAVE CHANGES';
    }

    if (error) {
      statusEl.textContent = error.message;
      statusEl.className = 'err';
      return;
    }

    statusEl.textContent = 'Saved!';
    statusEl.className = 'ok';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
    showFlash('FiFi Zone updated.');

    // Sync inputs to whatever the DB stored
    if (data && data[0]) {
      const s = data[0];
      $id('fifi-img-url').value       = s.image_url    || '';
      $id('fifi-caption-input').value  = s.caption     || '';
      $id('fifi-tagline-text').value   = s.tagline_text || '';
      $id('fifi-tagline-url').value    = s.tagline_url  || '';
      updatePreview(s.image_url, s.caption, s.tagline_text, s.tagline_url);
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
