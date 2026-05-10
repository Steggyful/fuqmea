(function () {
  'use strict';

  var CONSENT_KEY = 'fuqmea_consent';
  var GA_ID = 'G-MNCNNCQ7XX';
  var gaLoaded = false;

  function loadGA() {
    if (gaLoaded) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  // If already accepted, load GA immediately — script is in <head> so the
  // GTM tag goes in before first paint, matching the old direct-embed behavior.
  var stored = localStorage.getItem(CONSENT_KEY);
  if (stored === 'accepted') {
    loadGA();
    // Still need to wire manage-cookies buttons after DOM is ready.
  }

  function showBanner() {
    if (document.getElementById('fuqmea-consent-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'fuqmea-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<p class="consent-msg">We use <strong>Google Analytics</strong> to understand site traffic — no personal info is sold or shared.' +
      ' <a href="legal.html#privacy" class="consent-link">Learn more</a></p>' +
      '<div class="consent-btns">' +
      '<button type="button" id="fuqmea-consent-accept" class="consent-btn consent-btn-accept">Accept</button>' +
      '<button type="button" id="fuqmea-consent-decline" class="consent-btn consent-btn-decline">Decline</button>' +
      '</div>';
    document.body.appendChild(banner);

    document.getElementById('fuqmea-consent-accept').addEventListener('click', function () {
      localStorage.setItem(CONSENT_KEY, 'accepted');
      banner.remove();
      loadGA();
    });
    document.getElementById('fuqmea-consent-decline').addEventListener('click', function () {
      localStorage.setItem(CONSENT_KEY, 'declined');
      banner.remove();
    });
  }

  function init() {
    // Show banner if no decision yet.
    if (!localStorage.getItem(CONSENT_KEY)) {
      showBanner();
    }
    // Wire any "manage cookies" buttons (e.g. on the legal page).
    document.querySelectorAll('[data-action="manage-cookies"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        localStorage.removeItem(CONSENT_KEY);
        showBanner();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
