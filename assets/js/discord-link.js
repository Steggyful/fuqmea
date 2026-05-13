(function () {
  'use strict';
  // Anon key is the public publishable key — safe to include here.
  var SUPABASE_URL = 'https://mxwrpjyiwcmdzlymmnmr.supabase.co';
  var ANON_KEY = 'sb_publishable_s70S_HrNIZHzbjaiyXChsw_aE8CMQbE';

  fetch(SUPABASE_URL + '/rest/v1/site_config?id=eq.1&select=discord_invite_url', {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + ANON_KEY
    }
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var url = Array.isArray(data) && data[0] && data[0].discord_invite_url;
      if (url) {
        document.querySelectorAll('a[data-discord-link]').forEach(function (el) {
          el.href = url;
        });
      }
    })
    .catch(function () {});
})();
