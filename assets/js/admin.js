(function () {
  'use strict';

  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  let sb = null;
  let currentUsers = [];
  let userSearchQuery = '';
  let pendingAdjust = null; // { userId, name }
  let pendingBan = null;    // { userId, name }

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
    const bar = $id('status-bar');
    bar.textContent = msg;
    bar.className = isErr ? 'show err' : 'show';
    clearTimeout(bar._t);
    bar._t = setTimeout(() => { bar.className = ''; }, 3000);
  }

  function showView(which) {
    $id('admin-login').style.display = which === 'login' ? 'flex' : 'none';
    $id('admin-panel').hidden = which !== 'panel';
    $id('access-denied').style.display = which === 'denied' ? 'flex' : 'none';
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function init() {
    const client = getClient();
    if (!client) {
      alert('Supabase client failed to load.');
      return;
    }

    const { data: { session } } = await client.auth.getSession();
    if (session) {
      await onSession(session);
    } else {
      showView('login');
    }

    client.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await onSession(session);
      } else {
        showView('login');
      }
    });
  }

  async function onSession(session) {
    const role = session?.user?.app_metadata?.role;
    if (role !== 'admin') {
      showView('denied');
      $id('logout-btn-denied').addEventListener('click', handleLogout, { once: true });
      return;
    }
    $id('admin-user-label').textContent = session.user.email || '';
    showView('panel');
    await Promise.all([loadLiveStatus(), loadUsers()]);
  }

  // ── OAuth (preferred — bypasses the captcha flow that's been flaky) ──────
  async function signInWithProvider(provider) {
    const errEl = $id('login-error');
    errEl.textContent = '';
    const { error } = await getClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href }
    });
    // signInWithOAuth navigates away on success; only get here on error.
    if (error) errEl.textContent = error.message;
  }

  $id('login-google-btn').addEventListener('click', () => signInWithProvider('google'));
  $id('login-discord-btn').addEventListener('click', () => signInWithProvider('discord'));

  let pendingEmail = '';

  $id('login-step1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $id('login-send-btn');
    const errEl = $id('login-error');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'SENDING...';

    pendingEmail = $id('login-email').value.trim();

    let captchaToken = '';
    try {
      captchaToken = await new Promise((resolve, reject) => {
        hcaptcha.execute('admin-captcha', { async: true }).then(r => resolve(r.response)).catch(reject);
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
      $id('login-step1').style.display = 'none';
      $id('login-email-shown').textContent = pendingEmail;
      $id('login-step2').style.display = 'block';
      $id('login-code').focus();
    }
  });

  $id('login-step2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $id('login-verify-btn');
    const errEl = $id('login-error');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'VERIFYING...';

    const { error } = await getClient().auth.verifyOtp({
      email: pendingEmail,
      token: $id('login-code').value.trim(),
      type: 'email'
    });

    btn.disabled = false;
    btn.textContent = 'VERIFY';
    if (error) errEl.textContent = error.message;
  });

  $id('login-back-btn').addEventListener('click', () => {
    $id('login-step2').style.display = 'none';
    $id('login-step1').style.display = 'block';
    $id('login-code').value = '';
    $id('login-error').textContent = '';
  });

  async function handleLogout() {
    await getClient().auth.signOut();
    showView('login');
  }

  $id('logout-btn').addEventListener('click', handleLogout);

  // ── Live Status ───────────────────────────────────────────────────────────

  async function loadLiveStatus() {
    const { data, error } = await getClient()
      .from('streamer_live_status')
      .select('username, tiktok_live')
      .order('username');

    if (error) { showFlash('Failed to load live status', true); return; }
    renderLiveToggles(data || []);
  }

  function renderLiveToggles(rows) {
    const container = $id('live-toggles');
    if (!rows.length) {
      container.innerHTML = '<span style="color:var(--muted);font-size:12px">No streamers found.</span>';
      return;
    }
    container.innerHTML = rows.map(row => {
      const live = row.tiktok_live;
      const name = row.username.charAt(0).toUpperCase() + row.username.slice(1);
      return `
        <div class="live-toggle-item${live ? ' is-live' : ''}" id="toggle-${row.username}">
          <span class="live-badge ${live ? 'on' : 'off'}">${live ? 'LIVE' : 'OFF'}</span>
          <span class="live-toggle-name">${name} — TikTok</span>
          <button class="btn btn-sm ${live ? 'btn-red' : ''}"
            data-action="toggle-live"
            data-username="${row.username}"
            data-target-live="${!live}">
            ${live ? 'END LIVE' : 'GO LIVE'}
          </button>
        </div>`;
    }).join('');
  }

  async function toggleLive(username, live) {
    let error = null;
    try {
      const result = await Promise.race([
        getClient().rpc('admin_set_tiktok_live', { p_username: username, p_live: live }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('toggle timed out')), 10000))
      ]);
      error = result.error;
    } catch (err) {
      error = { message: (err && err.message) ? err.message : String(err) };
    }
    if (error) { showFlash('Error: ' + error.message, true); await loadLiveStatus(); return; }
    showFlash(`${username} TikTok: ${live ? 'LIVE' : 'OFF'}`);
    await loadLiveStatus();
  }

  // Delegated click handler — CSP blocks inline onclick, so we attach once here.
  $id('live-toggles').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="toggle-live"]');
    if (!btn) return;
    const username = btn.dataset.username;
    const live = btn.dataset.targetLive === 'true';
    if (username) toggleLive(username, live);
  });

  $id('refresh-live-btn').addEventListener('click', loadLiveStatus);

  // ── Users ─────────────────────────────────────────────────────────────────

  async function loadUsers() {
    $id('users-tbody').innerHTML = '<tr class="loading-row"><td colspan="9">Loading...</td></tr>';
    const { data, error } = await getClient().rpc('admin_list_users');

    if (error) {
      $id('users-tbody').innerHTML = `<tr class="loading-row"><td colspan="9" style="color:var(--red)">Error: ${error.message}</td></tr>`;
      return;
    }

    currentUsers = data || [];
    $id('user-count').textContent = `(${currentUsers.length})`;
    renderUsersTable();
  }

  function fmt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString();
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function passesUserSearch(u, q) {
    if (!q) return true;
    return (u.leaderboard_name || '').toLowerCase().includes(q)
        || (u.handle || '').toLowerCase().includes(q);
  }

  function renderUsersTable() {
    const tbody = $id('users-tbody');
    const countEl = $id('users-search-count');
    const q = userSearchQuery.trim().toLowerCase();
    const visible = currentUsers.filter(u => passesUserSearch(u, q));

    if (countEl) {
      countEl.textContent = q
        ? `${visible.length} of ${currentUsers.length} match`
        : `${currentUsers.length} users`;
    }

    if (!visible.length) {
      tbody.innerHTML = `<tr class="loading-row"><td colspan="9">${
        currentUsers.length ? 'No users match.' : 'No users found.'
      }</td></tr>`;
      return;
    }

    tbody.innerHTML = visible.map(u => {
      const safeName = escAttr(u.leaderboard_name);
      const safeReason = escAttr(u.banned_reason || '');
      const banned = !!u.banned_at;
      const excluded = !!u.leaderboard_excluded;

      const flags = [
        banned ? `<span class="user-flag banned" title="${safeReason || 'banned'}">BANNED</span>` : '',
        excluded ? '<span class="user-flag excluded">HIDDEN LB</span>' : ''
      ].join('');

      const rowCls = [banned ? 'is-banned' : '', excluded ? 'is-excluded' : '']
        .filter(Boolean).join(' ');

      return `
      <tr${rowCls ? ` class="${rowCls}"` : ''}>
        <td class="col-name" title="${safeName}">${u.leaderboard_name}${flags}</td>
        <td class="col-handle">${u.handle}</td>
        <td class="col-num" id="bal-${u.user_id}">${fmt(u.tokens)}</td>
        <td class="col-num" style="color:${u.net_delta >= 0 ? 'var(--lime)' : 'var(--red)'}">
          ${u.net_delta >= 0 ? '+' : ''}${fmt(u.net_delta)}
        </td>
        <td class="col-num">${fmt(u.lifetime_wagered)}</td>
        <td class="col-num">${fmt(u.weekly_wagered)}</td>
        <td class="col-num">${fmt(u.weekly_rounds)}</td>
        <td class="col-num" style="color:var(--yellow)">${Number(u.rakeback_pool).toFixed(2)}</td>
        <td class="col-actions">
          <div class="actions-cell">
            <button class="btn btn-sm btn-yellow" data-action="adjust-tokens"
              data-user-id="${u.user_id}" data-name="${safeName}">TOKENS</button>
            <button class="btn btn-sm" data-action="events"
              data-user-id="${u.user_id}" data-name="${safeName}">EVENTS</button>
            <button class="btn btn-sm ${banned ? '' : 'btn-red'}" data-action="${banned ? 'unban' : 'ban'}"
              data-user-id="${u.user_id}" data-name="${safeName}">${banned ? 'UNBAN' : 'BAN'}</button>
            <button class="btn btn-sm" data-action="${excluded ? 'include-lb' : 'exclude-lb'}"
              data-user-id="${u.user_id}" data-name="${safeName}">${excluded ? 'SHOW LB' : 'HIDE LB'}</button>
            <button class="btn btn-sm" data-action="clear-name"
              data-user-id="${u.user_id}" data-name="${safeName}">CLR NAME</button>
            <button class="btn btn-sm btn-red" data-action="reset-weekly"
              data-user-id="${u.user_id}" data-name="${safeName}">RESET WK</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // Delegated click handler — CSP blocks inline onclick.
  $id('users-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const userId = btn.dataset.userId;
    const name = btn.dataset.name || '';
    if (!userId) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'adjust-tokens': openAdjustModal(userId, name); break;
      case 'reset-weekly':  resetWeekly(userId, name); break;
      case 'ban':           openBanModal(userId, name); break;
      case 'unban':         setBanned(userId, name, false); break;
      case 'exclude-lb':    setLeaderboardExcluded(userId, name, true); break;
      case 'include-lb':    setLeaderboardExcluded(userId, name, false); break;
      case 'clear-name':    clearDisplayName(userId, name); break;
      case 'events':        openEventsModal(userId, name); break;
    }
  });

  $id('refresh-users-btn').addEventListener('click', loadUsers);

  $id('users-search').addEventListener('input', (e) => {
    userSearchQuery = e.target.value;
    renderUsersTable();
  });

  // ── Token adjustment modal ────────────────────────────────────────────────

  function openAdjustModal(userId, name) {
    pendingAdjust = { userId, name };
    $id('modal-target-name').textContent = name;
    $id('modal-delta').value = '';
    $id('modal-reason').value = '';
    $id('modal-error').textContent = '';
    $id('token-modal').hidden = false;
    $id('modal-delta').focus();
  }

  $id('modal-cancel').addEventListener('click', closeModal);

  $id('token-modal').addEventListener('click', (e) => {
    if (e.target === $id('token-modal')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  function closeModal() {
    $id('token-modal').hidden = true;
    pendingAdjust = null;
  }

  $id('modal-confirm').addEventListener('click', async () => {
    if (!pendingAdjust) return;
    const delta = parseInt($id('modal-delta').value, 10);
    const reason = $id('modal-reason').value.trim() || 'admin adjustment';
    const errEl = $id('modal-error');

    if (!Number.isFinite(delta) || delta === 0) {
      errEl.textContent = 'Enter a non-zero amount.';
      return;
    }

    const btn = $id('modal-confirm');
    btn.disabled = true;
    errEl.textContent = '';

    const { data: newBalance, error } = await getClient().rpc('admin_adjust_tokens', {
      p_user_id: pendingAdjust.userId,
      p_delta: delta,
      p_reason: reason
    });

    btn.disabled = false;

    if (error) {
      errEl.textContent = error.message;
      return;
    }

    const user = currentUsers.find(u => u.user_id === pendingAdjust.userId);
    if (user) {
      user.tokens = newBalance;
      const cell = $id(`bal-${pendingAdjust.userId}`);
      if (cell) cell.textContent = fmt(newBalance);
    }

    showFlash(`${pendingAdjust.name}: ${delta > 0 ? '+' : ''}${fmt(delta)} tokens → ${fmt(newBalance)}`);
    closeModal();
  });

  // ── Weekly reset ──────────────────────────────────────────────────────────

  async function resetWeekly(userId, name) {
    if (!confirm(`Reset weekly stats for ${name}?\n\nThis will zero out weekly wagered and rounds on the leaderboard.`)) return;

    const { error } = await getClient().rpc('admin_reset_weekly', { p_user_id: userId });
    if (error) { showFlash('Error: ' + error.message, true); return; }

    const user = currentUsers.find(u => u.user_id === userId);
    if (user) { user.weekly_wagered = 0; user.weekly_rounds = 0; }
    renderUsersTable();
    showFlash(`Weekly stats reset for ${name}`);
  }

  // ── Ban / unban ───────────────────────────────────────────────────────────

  function openBanModal(userId, name) {
    pendingBan = { userId, name };
    $id('ban-target-name').textContent = name;
    $id('ban-reason').value = '';
    $id('ban-error').textContent = '';
    $id('ban-modal').hidden = false;
    $id('ban-reason').focus();
  }

  function closeBanModal() {
    $id('ban-modal').hidden = true;
    pendingBan = null;
  }

  $id('ban-cancel').addEventListener('click', closeBanModal);
  $id('ban-modal').addEventListener('click', (e) => {
    if (e.target === $id('ban-modal')) closeBanModal();
  });

  $id('ban-confirm').addEventListener('click', async () => {
    if (!pendingBan) return;
    const reason = $id('ban-reason').value.trim();
    const errEl = $id('ban-error');
    const btn = $id('ban-confirm');
    btn.disabled = true;
    errEl.textContent = '';

    const { error } = await getClient().rpc('admin_set_user_banned', {
      p_user_id: pendingBan.userId,
      p_banned: true,
      p_reason: reason || null
    });

    btn.disabled = false;
    if (error) { errEl.textContent = error.message; return; }

    const u = currentUsers.find(x => x.user_id === pendingBan.userId);
    if (u) { u.banned_at = new Date().toISOString(); u.banned_reason = reason || null; }
    showFlash(`${pendingBan.name} banned${reason ? `: ${reason}` : ''}`);
    closeBanModal();
    renderUsersTable();
  });

  async function setBanned(userId, name, banned) {
    if (!banned && !confirm(`Unban ${name}? They'll show up on the leaderboard again.`)) return;
    const { error } = await getClient().rpc('admin_set_user_banned', {
      p_user_id: userId, p_banned: banned, p_reason: null
    });
    if (error) { showFlash('Error: ' + error.message, true); return; }
    const u = currentUsers.find(x => x.user_id === userId);
    if (u) {
      u.banned_at = banned ? new Date().toISOString() : null;
      u.banned_reason = null;
    }
    showFlash(`${name} ${banned ? 'banned' : 'unbanned'}`);
    renderUsersTable();
  }

  // ── Leaderboard exclusion (test accounts) ─────────────────────────────────

  async function setLeaderboardExcluded(userId, name, excluded) {
    const { error } = await getClient().rpc('admin_set_leaderboard_excluded', {
      p_user_id: userId, p_excluded: excluded
    });
    if (error) { showFlash('Error: ' + error.message, true); return; }
    const u = currentUsers.find(x => x.user_id === userId);
    if (u) u.leaderboard_excluded = excluded;
    showFlash(`${name} ${excluded ? 'hidden from' : 'shown on'} leaderboard`);
    renderUsersTable();
  }

  // ── Force-clear display name ──────────────────────────────────────────────

  async function clearDisplayName(userId, name) {
    if (!confirm(`Clear display name for ${name}?\n\nThey'll be forced to pick a new one on their next visit.`)) return;
    const { error } = await getClient().rpc('admin_clear_display_name', { p_user_id: userId });
    if (error) { showFlash('Error: ' + error.message, true); return; }
    const u = currentUsers.find(x => x.user_id === userId);
    if (u) u.leaderboard_name = u.handle;
    showFlash(`Display name cleared for ${name}`);
    renderUsersTable();
  }

  // ── Game events viewer ────────────────────────────────────────────────────

  async function openEventsModal(userId, name) {
    $id('events-target-name').textContent = name;
    $id('events-tbody').innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';
    $id('events-modal').hidden = false;

    const { data, error } = await getClient().rpc('admin_list_game_events', {
      p_user_id: userId, p_limit: 100
    });

    if (error) {
      $id('events-tbody').innerHTML =
        `<tr class="loading-row"><td colspan="6" style="color:var(--red)">Error: ${error.message}</td></tr>`;
      return;
    }

    if (!data || !data.length) {
      $id('events-tbody').innerHTML = '<tr class="loading-row"><td colspan="6">No events.</td></tr>';
      return;
    }

    $id('events-tbody').innerHTML = data.map(ev => {
      const when = new Date(ev.created_at).toLocaleString();
      const deltaColor = ev.delta >= 0 ? 'var(--lime)' : 'var(--red)';
      const deltaSign = ev.delta >= 0 ? '+' : '';
      const detail = (ev.detail || '').replace(/[<>&]/g,
        c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]));
      return `
        <tr>
          <td style="color:var(--muted);font-size:11px">${when}</td>
          <td>${ev.game}</td>
          <td style="color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis">${detail}</td>
          <td class="col-num" style="color:${deltaColor}">${deltaSign}${fmt(ev.delta)}</td>
          <td class="col-num">${fmt(ev.wager)}</td>
          <td class="col-num">${fmt(ev.balance_after)}</td>
        </tr>`;
    }).join('');
  }

  function closeEventsModal() {
    $id('events-modal').hidden = true;
  }

  $id('events-close').addEventListener('click', closeEventsModal);
  $id('events-modal').addEventListener('click', (e) => {
    if (e.target === $id('events-modal')) closeEventsModal();
  });

  // Extend Escape handler to also close ban + events modals.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$id('ban-modal').hidden) closeBanModal();
      if (!$id('events-modal').hidden) closeEventsModal();
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
