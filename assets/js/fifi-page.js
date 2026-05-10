// Loads the FiFi Zone customizable image / caption / tagline / song from Supabase.
// Lives in its own file because fifi.html's CSP forbids inline <script>.
//
// Also accepts live preview updates from the parent window when the page is
// embedded in vivid-admin's iframe (see vivid-admin.js postMessage), so Vivid
// sees an exact-pixel preview of his edits without saving.

(function () {
  'use strict';

  var IS_PREVIEW = (function () {
    try {
      return window.parent && window.parent !== window &&
             window.location.search.indexOf('preview=1') !== -1;
    } catch (_) { return false; }
  })();

  function escapeHTML(str) {
    return (str || '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  // Strict tagline sanitiser: keeps only text + <a href="https?://..."> with
  // target="_blank" rel="noopener noreferrer". Everything else becomes text.
  // Also forces .social-link styling on every anchor so legacy + new content
  // look identical on the public page.
  function sanitiseTaglineHTML(html) {
    if (!html) return '';
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html);
    function walk(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 3) continue; // text — keep
        if (child.nodeType !== 1) { node.removeChild(child); continue; }
        var tag = child.tagName.toLowerCase();
        if (tag === 'a') {
          var href = child.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) {
            node.replaceChild(document.createTextNode(child.textContent || ''), child);
            continue;
          }
          var safe = document.createElement('a');
          safe.setAttribute('href', href);
          safe.setAttribute('target', '_blank');
          safe.setAttribute('rel', 'noopener noreferrer');
          safe.setAttribute('class', 'social-link');
          safe.textContent = child.textContent || '';
          node.replaceChild(safe, child);
        } else {
          node.replaceChild(document.createTextNode(child.textContent || ''), child);
        }
      }
    }
    walk(tpl.content);
    return tpl.innerHTML;
  }

  function applyImage(url) {
    var img = document.getElementById('fifi-featured-img');
    if (img && url) img.src = url;
  }
  function applyCaption(text) {
    var cap = document.getElementById('fifi-caption');
    if (cap && text != null) cap.textContent = text;
  }
  function applyTagline(text, url) {
    var tagEl = document.getElementById('fifi-tagline');
    if (!tagEl) return;
    if (!text) { tagEl.textContent = ''; return; }

    // Detect rich-text payload: contains an <a tag → treat as HTML.
    if (/<a[\s>]/i.test(text)) {
      tagEl.innerHTML = sanitiseTaglineHTML(text);
      return;
    }
    // Legacy: plain text + optional whole-string link URL.
    if (url) {
      tagEl.innerHTML =
        '<a href="' + escapeHTML(url) +
        '" target="_blank" rel="noopener noreferrer" class="social-link">' +
        escapeHTML(text) +
        '</a>';
    } else {
      tagEl.textContent = text;
    }
  }

  function applySongCredit(html) {
    var el = document.getElementById('fifi-song-credit');
    if (!el) return;
    if (!html) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.innerHTML = sanitiseTaglineHTML(html);
    el.hidden = false;
  }

  // ── Background song ──────────────────────────────────────────────────────
  // Browsers block unmuted autoplay until the user interacts. We start the
  // audio muted so it begins immediately on page load, then unmute on the
  // first user gesture (click / keypress / touch / scroll).

  var audioEl = null;
  var toggleBtn = null;
  var currentSongUrl = '';
  var currentVolume = 0.7;
  var userMuted = false;          // true if the user explicitly muted via the toggle
  var firstGestureBound = false;

  function getAudioEl() {
    if (!audioEl) audioEl = document.getElementById('fifi-bg-audio');
    return audioEl;
  }
  function getToggleBtn() {
    if (!toggleBtn) toggleBtn = document.getElementById('fifi-bg-toggle');
    return toggleBtn;
  }

  function renderToggleIcon() {
    var btn = getToggleBtn();
    if (!btn) return;
    var a = getAudioEl();
    var muted = !a || a.muted || userMuted;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  }

  function attemptPlay() {
    var a = getAudioEl();
    if (!a || !a.src) return;
    var p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () { /* autoplay blocked; toggle button still works */ });
    }
  }

  function bindFirstGesture() {
    if (firstGestureBound || IS_PREVIEW) return;
    firstGestureBound = true;
    var events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    function onGesture() {
      var a = getAudioEl();
      if (a && !userMuted) {
        a.muted = false;
        attemptPlay();
        renderToggleIcon();
      }
      events.forEach(function (ev) { window.removeEventListener(ev, onGesture, true); });
    }
    events.forEach(function (ev) { window.addEventListener(ev, onGesture, { capture: true, once: false, passive: true }); });
  }

  function applySong(url, volume) {
    var a = getAudioEl();
    var btn = getToggleBtn();
    if (!a || !btn) return;

    if (typeof volume === 'number' && isFinite(volume)) {
      currentVolume = Math.max(0, Math.min(1, volume));
      a.volume = currentVolume;
    }

    var nextUrl = (url || '').trim();
    if (nextUrl !== currentSongUrl) {
      currentSongUrl = nextUrl;
      if (nextUrl) {
        a.src = nextUrl;
        a.load();
        // Start muted so autoplay is allowed; auto-unmute on first gesture
        // unless the user explicitly muted via the toggle button.
        a.muted = true;
        if (IS_PREVIEW) {
          // Don't compete with the admin's own audio control. Keep the toggle
          // visible so Vivid sees how the page looks, but never start playback.
          a.hidden = true;
          btn.hidden = false;
        } else {
          a.hidden = false;
          btn.hidden = false;
          attemptPlay();
          bindFirstGesture();
        }
      } else {
        a.pause();
        a.removeAttribute('src');
        a.load();
        a.hidden = true;
        btn.hidden = true;
      }
    }
    renderToggleIcon();
  }

  function applySettings(s) {
    if (!s) return;
    if (s.image_url) applyImage(s.image_url);
    if ('caption' in s) applyCaption(s.caption);
    if ('tagline_text' in s) applyTagline(s.tagline_text || '', s.tagline_url || '');
    if ('song_url' in s || 'song_volume' in s) {
      applySong(s.song_url || '', typeof s.song_volume === 'number' ? s.song_volume : currentVolume);
    }
    if ('song_credit_text' in s) applySongCredit(s.song_credit_text || '');
  }

  function loadFifiSettings() {
    var cfg = window.FUQ_CLOUD_CONFIG;
    if (!cfg || !cfg.supabaseUrl) return;
    var url = cfg.supabaseUrl +
      '/rest/v1/fifi_zone_settings?id=eq.1' +
      '&select=image_url,caption,tagline_text,tagline_url,song_url,song_volume,song_credit_text';
    fetch(url, { headers: { apikey: cfg.supabaseAnonKey } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (rows && rows[0]) applySettings(rows[0]);
      })
      .catch(function () { /* leave hardcoded fallback in place */ });
  }

  // Toggle button: manual mute/unmute. Also unmutes on first explicit click.
  function bindToggle() {
    var btn = getToggleBtn();
    if (!btn) return;
    btn.addEventListener('click', function () {
      var a = getAudioEl();
      if (!a) return;
      if (a.muted) {
        a.muted = false;
        userMuted = false;
        attemptPlay();
      } else {
        a.muted = true;
        userMuted = true;
      }
      renderToggleIcon();
    });
  }

  // Live preview: parent (vivid-admin) sends settings as the user types.
  // Only accept messages from the same origin to avoid spoofing.
  function bindPreviewListener() {
    window.addEventListener('message', function (e) {
      if (e.origin !== window.location.origin) return;
      var data = e.data;
      if (!data || data.type !== 'fifi-preview' || !data.settings) return;
      applySettings(data.settings);
    });
    // Tell the parent we're ready so it can push the initial state.
    if (IS_PREVIEW) {
      try { window.parent.postMessage({ type: 'fifi-preview-ready' }, window.location.origin); }
      catch (_) {}
    }
  }

  function init() {
    bindToggle();
    bindPreviewListener();
    loadFifiSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
