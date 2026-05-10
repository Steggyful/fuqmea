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

  const emailToggle = $id('va-email-toggle');
  const emailSection = $id('va-email-section');
  if (emailToggle && emailSection) {
    emailToggle.addEventListener('click', () => {
      const open = !emailSection.hidden;
      emailSection.hidden = open;
      emailToggle.setAttribute('aria-expanded', String(!open));
    });
  }

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
          ${isLive ? 'MARK OFFLINE' : 'MARK LIVE'}
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
    showFlash(live ? 'Marked LIVE on TikTok 🔴' : 'Marked as offline.');
    renderLiveToggle(live);
  }

  // Delegated handler — CSP blocks inline onclick.
  $id('va-live-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="toggle-live"]');
    if (!btn) return;
    toggleLive(btn.dataset.targetLive === 'true');
  });

  // ── FiFi Zone editor ──────────────────────────────────────────────────────

  // Local state mirrors the form so we can push it to the iframe live.
  const fifiState = {
    image_url: '',
    caption: '',
    tagline_text: '',
    tagline_url: '',
    song_url: '',
    song_volume: 0.7,
    song_credit_text: '',
  };
  let previewReady = false;
  let pendingPreviewPush = false;

  async function loadFifiSettings() {
    const { data } = await getClient()
      .from('fifi_zone_settings')
      .select('image_url, caption, tagline_text, tagline_url, song_url, song_volume, song_credit_text')
      .eq('id', 1)
      .maybeSingle();

    if (!data) return;

    fifiState.image_url        = data.image_url        || '';
    fifiState.caption          = data.caption          || '';
    fifiState.tagline_url      = data.tagline_url      || ''; // legacy; not edited going forward
    fifiState.song_url         = data.song_url         || '';
    fifiState.song_volume      = (typeof data.song_volume === 'number') ? data.song_volume : 0.7;
    fifiState.song_credit_text = data.song_credit_text || '';

    $id('fifi-img-url').value       = fifiState.image_url;
    $id('fifi-caption-input').value = fifiState.caption;

    // Tagline: load HTML if present, otherwise upgrade legacy plain-text + url
    // into a single anchor so the editor shows it as a link the user can edit.
    setTaglineEditor(data.tagline_text || '', fifiState.tagline_url);
    fifiState.tagline_text = sanitiseTaglineHTML($id('fifi-tagline-rt').innerHTML);

    setSongCreditEditor(fifiState.song_credit_text);

    setSongUI(fifiState.song_url);
    setVolumeUI(fifiState.song_volume);
    updateCharCounts();
    pushPreview();
  }

  function updateCharCounts() {
    const imgLen = ($id('fifi-img-url').value     || '').length;
    const capLen = ($id('fifi-caption-input').value || '').length;
    // Count the sanitised payload so the meter reflects what actually gets saved.
    const tagLen    = (fifiState.tagline_text    || '').length;
    const creditLen = (fifiState.song_credit_text || '').length;

    const imgEl = $id('fifi-img-chars');
    imgEl.textContent = `${imgLen} / 500`;
    imgEl.className = 'char-count' + (imgLen > 450 ? ' warn' : '');

    const capEl = $id('fifi-cap-chars');
    capEl.textContent = `${capLen} / 200`;
    capEl.className = 'char-count' + (capLen > 170 ? ' warn' : '');

    const tagEl = $id('fifi-tag-chars');
    tagEl.textContent = `${tagLen} / 500`;
    tagEl.className = 'char-count' + (tagLen > 450 ? ' warn' : '');

    const creditEl = $id('fifi-credit-chars');
    if (creditEl) {
      creditEl.textContent = `${creditLen} / 300`;
      creditEl.className = 'char-count' + (creditLen > 260 ? ' warn' : '');
    }
  }

  // ── Rich-text tagline ────────────────────────────────────────────────
  // Strict allowlist: only <a href="https?://..."> survives sanitisation.
  // Server enforces length only; HTML soundness is the client's job.

  function sanitiseTaglineHTML(html) {
    if (!html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html);
    walk(tpl.content);
    function walk(node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType !== Node.ELEMENT_NODE) {
          node.removeChild(child);
          continue;
        }
        const tag = child.tagName.toLowerCase();
        if (tag === 'a') {
          const href = child.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) {
            node.replaceChild(document.createTextNode(child.textContent || ''), child);
            continue;
          }
          const safe = document.createElement('a');
          safe.setAttribute('href', href);
          safe.setAttribute('target', '_blank');
          safe.setAttribute('rel', 'noopener noreferrer');
          safe.textContent = child.textContent || '';
          node.replaceChild(safe, child);
        } else if (tag === 'br') {
          // Single-line: drop line breaks entirely.
          node.removeChild(child);
        } else {
          node.replaceChild(document.createTextNode(child.textContent || ''), child);
        }
      }
    }
    return tpl.innerHTML;
  }

  function setTaglineEditor(textOrHtml, legacyUrl) {
    const editor = $id('fifi-tagline-rt');
    if (!editor) return;
    if (!textOrHtml) { editor.innerHTML = ''; return; }
    if (/<a[\s>]/i.test(textOrHtml)) {
      editor.innerHTML = sanitiseTaglineHTML(textOrHtml);
    } else if (legacyUrl) {
      // One-time auto-upgrade: wrap the whole legacy string in an anchor.
      const a = document.createElement('a');
      a.setAttribute('href', legacyUrl);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.textContent = textOrHtml;
      editor.innerHTML = '';
      editor.appendChild(a);
    } else {
      editor.textContent = textOrHtml;
    }
  }

  function bindRichEditor(opts) {
    const editor    = $id(opts.editorId);
    const linkBtn   = $id(opts.linkBtnId);
    const unlinkBtn = $id(opts.unlinkBtnId);
    const urlBar    = $id(opts.urlBarId);
    const urlInput  = $id(opts.urlInputId);
    const urlApply  = $id(opts.urlApplyId);
    const urlCancel = $id(opts.urlCancelId);
    if (!editor) return;

    let savedRange  = null;
    let editingLink = null;

    function saveSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    }

    function restoreSelection() {
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    function showUrlBar(prefill) {
      urlInput.value = prefill || '';
      urlBar.hidden  = false;
      urlInput.focus();
      if (prefill) urlInput.select();
    }

    function hideUrlBar() {
      urlBar.hidden  = true;
      urlInput.value = '';
      editingLink    = null;
    }

    function applyLink() {
      const url = urlInput.value.trim();
      if (!url) { hideUrlBar(); return; }
      if (!/^https?:\/\//i.test(url)) {
        showFlash('URL must start with http:// or https://', true);
        urlInput.focus();
        return;
      }
      if (editingLink) {
        editingLink.setAttribute('href', url);
      } else {
        editor.focus();
        restoreSelection();
        document.execCommand('createLink', false, url);
        editor.querySelectorAll('a').forEach(a => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });
      }
      hideUrlBar();
      opts.onUpdate(sanitiseTaglineHTML(editor.innerHTML));
    }

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
    });

    editor.addEventListener('input', () => opts.onUpdate(sanitiseTaglineHTML(editor.innerHTML)));

    ['mouseup', 'keyup', 'touchend'].forEach(ev => editor.addEventListener(ev, saveSelection));

    // Click an existing link to edit its URL inline.
    editor.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      editingLink = a;
      showUrlBar(a.getAttribute('href') || '');
    });

    if (linkBtn) {
      linkBtn.addEventListener('mousedown', e => e.preventDefault());
      linkBtn.addEventListener('click', () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.toString().trim()) {
          showFlash('Select some text first, then click LINK.', true);
          return;
        }
        saveSelection();
        const anchorEl = sel.anchorNode?.parentElement?.closest('a');
        showUrlBar(anchorEl ? anchorEl.getAttribute('href') : '');
      });
    }

    if (unlinkBtn) {
      unlinkBtn.addEventListener('mousedown', e => e.preventDefault());
      unlinkBtn.addEventListener('click', () => {
        hideUrlBar();
        restoreSelection();
        document.execCommand('unlink', false);
        opts.onUpdate(sanitiseTaglineHTML(editor.innerHTML));
      });
    }

    if (urlApply)  urlApply.addEventListener('click', applyLink);
    if (urlCancel) urlCancel.addEventListener('click', hideUrlBar);
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); applyLink(); }
        if (e.key === 'Escape') { e.preventDefault(); hideUrlBar(); }
      });
    }
  }

  bindRichEditor({
    editorId:    'fifi-tagline-rt',
    linkBtnId:   'fifi-rt-link',
    unlinkBtnId: 'fifi-rt-unlink',
    urlBarId:    'fifi-rt-url-bar',
    urlInputId:  'fifi-rt-url-input',
    urlApplyId:  'fifi-rt-url-apply',
    urlCancelId: 'fifi-rt-url-cancel',
    onUpdate(html) {
      fifiState.tagline_text = html;
      updateCharCounts();
      pushPreview();
    }
  });

  // ── Song credit rich-text editor ──────────────────────────────────────

  function setSongCreditEditor(html) {
    const editor = $id('fifi-credit-rt');
    if (!editor) return;
    if (!html) { editor.innerHTML = ''; return; }
    editor.innerHTML = sanitiseTaglineHTML(html);
  }

  bindRichEditor({
    editorId:    'fifi-credit-rt',
    linkBtnId:   'fifi-credit-rt-link',
    unlinkBtnId: 'fifi-credit-rt-unlink',
    urlBarId:    'fifi-credit-url-bar',
    urlInputId:  'fifi-credit-url-input',
    urlApplyId:  'fifi-credit-url-apply',
    urlCancelId: 'fifi-credit-url-cancel',
    onUpdate(html) {
      fifiState.song_credit_text = html;
      updateCharCounts();
      pushPreview();
    }
  });

  // ── Iframe preview ─────────────────────────────────────────────────────
  // The iframe loads fifi.html?preview=1, which signals 'fifi-preview-ready'
  // back to us via postMessage. We then push the full state on every change.

  function pushPreview() {
    const iframe = $id('fifi-preview-frame');
    if (!iframe || !iframe.contentWindow) return;
    if (!previewReady) { pendingPreviewPush = true; return; }
    iframe.contentWindow.postMessage(
      { type: 'fifi-preview', settings: { ...fifiState } },
      window.location.origin
    );
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === 'fifi-preview-ready') {
      previewReady = true;
      if (pendingPreviewPush) { pendingPreviewPush = false; pushPreview(); }
      else { pushPreview(); }
      const wrap = $id('fifi-preview-frame-wrap');
      if (wrap) wrap.classList.add('preview-ok');
    }
  });

  // Live preview as user types — debounce only the image (it triggers a
  // network fetch); other fields update instantly.
  let imgDebounce;
  $id('fifi-img-url').addEventListener('input', () => {
    fifiState.image_url = $id('fifi-img-url').value.trim();
    updateCharCounts();
    clearTimeout(imgDebounce);
    imgDebounce = setTimeout(pushPreview, 400);
  });

  $id('fifi-caption-input').addEventListener('input', () => {
    fifiState.caption = $id('fifi-caption-input').value;
    updateCharCounts();
    pushPreview();
  });
  // Tagline updates are handled inside bindRichText() (contenteditable input).

  // ── Volume ────────────────────────────────────────────────────────────

  function setVolumeUI(vol) {
    const slider = $id('fifi-volume');
    const label  = $id('fifi-volume-value');
    const pct = Math.round(vol * 100);
    slider.value = String(pct);
    label.textContent = pct + '%';
  }
  $id('fifi-volume').addEventListener('input', () => {
    const pct = parseInt($id('fifi-volume').value, 10);
    $id('fifi-volume-value').textContent = pct + '%';
    fifiState.song_volume = pct / 100;
    // Update the local <audio> in the admin too so Vivid hears the level.
    const a = $id('fifi-song-audio');
    if (a) a.volume = fifiState.song_volume;
    pushPreview();
  });

  // ── Song UI (local audio element + clear button) ───────────────────────

  function setSongUI(url) {
    const row    = $id('fifi-audio-row');
    const audio  = $id('fifi-song-audio');
    const name   = $id('fifi-song-name');
    const clear  = $id('fifi-song-clear');
    if (url) {
      audio.src = url;
      audio.volume = fifiState.song_volume;
      row.hidden = false;
      clear.hidden = false;
      // Display only the filename portion for readability.
      try {
        const u = new URL(url, window.location.href);
        name.textContent = decodeURIComponent(u.pathname.split('/').pop() || url);
      } catch { name.textContent = url; }
    } else {
      try { audio.pause(); } catch (_) {}
      audio.removeAttribute('src');
      row.hidden = true;
      clear.hidden = true;
      name.textContent = '';
    }
  }

  $id('fifi-song-clear').addEventListener('click', () => {
    fifiState.song_url = '';
    setSongUI('');
    pushPreview();
    showFlash('Song removed (press SAVE CHANGES to confirm)');
  });

  // ── Uploads (image + audio) ───────────────────────────────────────────

  async function uploadAsset(file, kind) {
    const session = (await getClient().auth.getSession()).data.session;
    if (!session) throw new Error('Not signed in');

    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('kind', kind);

    const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/upload-fifi-asset`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': CONFIG.supabaseAnonKey,
      },
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('upload failed: ' + res.status));
    if (!body.url) throw new Error('upload returned no URL');
    return body.url;
  }

  function wireUpload(triggerId, fileInputId, kind, onSuccess, busyText) {
    const trigger = $id(triggerId);
    const input   = $id(fileInputId);
    const original = trigger.textContent;
    trigger.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';  // allow re-uploading the same file
      if (!file) return;
      trigger.disabled = true;
      trigger.classList.add('uploading');
      trigger.textContent = busyText;
      try {
        const url = await uploadAsset(file, kind);
        onSuccess(url);
        showFlash('Uploaded — preview updated. Press SAVE CHANGES to publish.');
      } catch (err) {
        showFlash('Upload failed: ' + (err.message || err), true);
      } finally {
        trigger.disabled = false;
        trigger.classList.remove('uploading');
        trigger.textContent = original;
      }
    });
  }

  wireUpload('fifi-img-upload-btn', 'fifi-img-file', 'image', (url) => {
    fifiState.image_url = url;
    $id('fifi-img-url').value = url;
    updateCharCounts();
    pushPreview();
  }, 'UPLOADING...');

  wireUpload('fifi-song-upload-btn', 'fifi-song-file', 'audio', (url) => {
    fifiState.song_url = url;
    setSongUI(url);
    pushPreview();
  }, 'UPLOADING...');

  // ── Save ──────────────────────────────────────────────────────────────

  $id('fifi-save-btn').addEventListener('click', async () => {
    const statusEl = $id('va-fifi-status');
    const btn      = $id('fifi-save-btn');

    if (btn.disabled) return; // guard against duplicate fires while one is in-flight

    btn.disabled = true;
    btn.textContent = 'SAVING...';
    statusEl.textContent = '';

    // Pull the latest field values before saving.
    const imgUrl         = $id('fifi-img-url').value.trim();
    const caption        = $id('fifi-caption-input').value.trim();
    const taglineText    = sanitiseTaglineHTML($id('fifi-tagline-rt').innerHTML).trim();
    const songUrl        = fifiState.song_url;          // '' means clear
    const songVolume     = fifiState.song_volume;
    const songCreditText = sanitiseTaglineHTML($id('fifi-credit-rt')?.innerHTML || '').trim();

    // Race the RPC against a hard timeout so the UI never gets stuck if the
    // Supabase client's promise stalls (mid-flight JWT refresh, dropped socket, etc.).
    let data = null;
    let error = null;
    try {
      const rpcPromise = getClient().rpc('set_fifi_zone_settings', {
        p_image_url:        imgUrl         || null,
        p_caption:          caption        || null,
        p_tagline_text:     taglineText    || null,
        // tagline_url is legacy: rich-text content lives inside p_tagline_text now.
        p_tagline_url:      null,
        // song_url uses '' as sentinel for "clear", null for "leave alone".
        p_song_url:         songUrl,
        p_song_volume:      songVolume,
        // song_credit_text: '' clears, null leaves alone — always pass current value.
        p_song_credit_text: songCreditText,
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
      fifiState.image_url        = s.image_url        || '';
      fifiState.caption          = s.caption          || '';
      fifiState.tagline_url      = s.tagline_url      || '';
      fifiState.song_url         = s.song_url         || '';
      fifiState.song_volume      = (typeof s.song_volume === 'number') ? s.song_volume : 0.7;
      fifiState.song_credit_text = s.song_credit_text || '';

      $id('fifi-img-url').value       = fifiState.image_url;
      $id('fifi-caption-input').value = fifiState.caption;
      setTaglineEditor(s.tagline_text || '', fifiState.tagline_url);
      fifiState.tagline_text = sanitiseTaglineHTML($id('fifi-tagline-rt').innerHTML);
      setSongCreditEditor(fifiState.song_credit_text);
      setSongUI(fifiState.song_url);
      setVolumeUI(fifiState.song_volume);
      updateCharCounts();
      pushPreview();
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
