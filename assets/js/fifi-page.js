// Loads the FiFi Zone customizable image / caption / tagline from Supabase.
// Lives in its own file because fifi.html's CSP forbids inline <script>.

(function () {
  'use strict';

  function escapeHTML(str) {
    return (str || '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  function applySettings(s) {
    if (!s) return;
    if (s.image_url) {
      var img = document.getElementById('fifi-featured-img');
      if (img) img.src = s.image_url;
    }
    if (s.caption) {
      var cap = document.getElementById('fifi-caption');
      if (cap) cap.textContent = s.caption;
    }
    var tagEl = document.getElementById('fifi-tagline');
    if (tagEl && s.tagline_text) {
      if (s.tagline_url) {
        tagEl.innerHTML =
          '<a href="' + escapeHTML(s.tagline_url) +
          '" target="_blank" rel="noopener noreferrer" class="social-link">' +
          escapeHTML(s.tagline_text) +
          '</a>';
      } else {
        tagEl.textContent = s.tagline_text;
      }
    }
  }

  function loadFifiSettings() {
    var cfg = window.FUQ_CLOUD_CONFIG;
    if (!cfg || !cfg.supabaseUrl) return;
    var url = cfg.supabaseUrl +
      '/rest/v1/fifi_zone_settings?id=eq.1' +
      '&select=image_url,caption,tagline_text,tagline_url';
    fetch(url, { headers: { apikey: cfg.supabaseAnonKey } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (rows && rows[0]) applySettings(rows[0]);
      })
      .catch(function () { /* leave hardcoded fallback in place */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFifiSettings);
  } else {
    loadFifiSettings();
  }
})();
