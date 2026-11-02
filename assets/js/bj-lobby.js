// Blackjack table lobby: presence + ephemeral chat + a live results feed,
// scoped to the Blackjack tab only. v1 on purpose — one Supabase Realtime
// channel (presence + broadcast), nothing persisted server-side. A refresh
// clears the room; there's no history to moderate because nothing is stored.
// Chat is filtered through the same slur list leaderboard names already use
// (window.FuqDisplayNamePolicy), plus a length cap and a basic send-rate
// limit. That's a client-side gate, not a hard security boundary — good
// enough to stop casual nonsense for a first test, not abuse-proof.

(function () {
  'use strict';

  const CFG = window.FUQ_CLOUD_CONFIG;
  if (!CFG || !CFG.enabled) return;

  const NAME_KEY = 'fuq_bj_lobby_name';
  const CHANNEL_NAME = 'bj-lobby';
  const MAX_FEED_ROWS = 40;
  const MIN_SEND_INTERVAL_MS = 1500;
  const MAX_MSG_LEN = 240;
  const MAX_NAME_LEN = 24;

  // Hashed per-name colors so the same person reads as the same color across the
  // who's-here pills, chat, and the results feed. Lime and red are left out on
  // purpose — lime already means "you" / a win, red already means a loss.
  const NAME_COLORS = ['#d4a5ff', '#4dd0ff', '#ff8fd1', '#ffb84d', '#ffe14d', '#7affc1', '#a0a8ff'];

  // Same allow-list as hub.js's validateImagePath, duplicated locally so this
  // module doesn't depend on hub.js's load order — never trust a src from a
  // broadcast (any client could send one) without checking it against this first.
  const R2_MEME_BASE = 'https://memes.fuqmea.com';
  function isAllowedMemeSrc(src) {
    if (typeof src !== 'string' || !src || src.includes('..')) return false;
    if (src.startsWith(R2_MEME_BASE + '/uploads/')) {
      try {
        const u = new URL(src);
        return u.hostname === 'memes.fuqmea.com' && u.pathname.startsWith('/uploads/');
      } catch (_) {
        return false;
      }
    }
    return src.startsWith('assets/images/') && !src.includes('//');
  }

  let client = null;
  let channel = null;
  let myName = '';
  let myId = '';
  let myVerified = false; // true = name came from a signed-in account, not typed by a guest
  let lastSendAt = 0;
  let presenceState = {};
  let prevPresenceIds = null; // null until the first sync establishes a baseline
  let knownNameById = {}; // id → last-known {name, verified}, so we can still say who left

  const els = {};
  function $(id) { return document.getElementById(id); }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function randomGuestName() {
    return 'Player' + Math.floor(1000 + Math.random() * 9000);
  }

  function loadName() {
    try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; }
  }

  function saveName(n) {
    try { window.localStorage.setItem(NAME_KEY, n); } catch (_) {}
  }

  function policyBlocks(text) {
    return !!(window.FuqDisplayNamePolicy &&
      typeof window.FuqDisplayNamePolicy.displayNameFailsPolicy === 'function' &&
      window.FuqDisplayNamePolicy.displayNameFailsPolicy(text));
  }

  function sanitizeName(raw) {
    const n = String(raw || '').trim().slice(0, MAX_NAME_LEN);
    if (!n || policyBlocks(n)) return '';
    return n;
  }

  // Returns '' for an empty/whitespace message, null for one the filter blocks,
  // otherwise the trimmed text.
  function sanitizeMessage(raw) {
    const t = String(raw || '').trim().slice(0, MAX_MSG_LEN);
    if (!t) return '';
    if (policyBlocks(t)) return null;
    return t;
  }

  function escapeHTML(str) {
    return String(str).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  function colorForName(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return NAME_COLORS[h % NAME_COLORS.length];
  }

  function nameSpan(name, isMe) {
    const color = isMe ? 'var(--lime)' : colorForName(name);
    return '<span class="games-bj-lobby-name' + (isMe ? ' games-bj-lobby-name--me' : '') +
      '" style="color:' + color + '">' + escapeHTML(name) + '</span>';
  }

  function appendFeed(html) {
    if (!els.feed) return;
    const atBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 40;
    const row = document.createElement('div');
    row.className = 'games-bj-lobby-row';
    row.innerHTML = html;
    els.feed.appendChild(row);
    while (els.feed.children.length > MAX_FEED_ROWS) els.feed.removeChild(els.feed.firstChild);
    if (atBottom) els.feed.scrollTop = els.feed.scrollHeight;
  }

  function guestTag(verified) {
    return verified ? '' : '<span class="games-bj-lobby-guest-tag" title="Not signed in — anyone could be using this name">GUEST</span> ';
  }

  function appendChatLine(name, text, isMe, verified) {
    appendFeed(
      guestTag(verified) + nameSpan(name, isMe) +
      '<span class="games-bj-lobby-text">' + escapeHTML(text) + '</span>'
    );
  }

  function appendResultLine(name, mood, delta, verified) {
    const kind = mood === 'jackpot' ? 'games-bj-lobby-result--jackpot'
      : mood === 'win' ? 'games-bj-lobby-result--win'
      : mood === 'tie' ? 'games-bj-lobby-result--tie'
      : 'games-bj-lobby-result--lose';
    const verb = delta > 0 ? 'won' : delta < 0 ? 'lost' : 'pushed';
    const amount = delta !== 0 ? ' ' + (delta > 0 ? '+' : '') + delta + ' FUQ' : '';
    appendFeed(
      guestTag(verified) +
      '<span class="games-bj-lobby-result ' + kind + '">' +
      escapeHTML(name) + ' ' + verb + amount + '</span>'
    );
  }

  function appendSystemLine(text) {
    appendFeed('<span class="games-bj-lobby-system">' + escapeHTML(text) + '</span>');
  }

  function appendMemeLine(name, src, isMe, verified) {
    appendFeed(
      guestTag(verified) + nameSpan(name, isMe) + '<br>' +
      '<img class="games-bj-lobby-meme-img" src="' + escapeHTML(src) + '" alt="meme" loading="lazy" decoding="async">'
    );
  }

  function appendPresenceLine(name, isMe, verb) {
    appendFeed(
      '<span class="games-bj-lobby-system">' + nameSpan(name, isMe) + ' ' + verb + '</span>'
    );
  }

  function renderWho() {
    const entries = Object.keys(presenceState)
      .map((key) => {
        const metas = presenceState[key];
        const meta = metas && metas[0];
        return meta && meta.name ? { id: key, name: meta.name, verified: !!meta.verified } : null;
      })
      .filter(Boolean);

    if (els.who) {
      els.who.textContent = '';
      entries.forEach((entry) => {
        const isMe = entry.id === myId;
        const pill = document.createElement('span');
        pill.className = 'games-bj-lobby-pill' + (isMe ? ' games-bj-lobby-pill--me' : '');
        pill.style.setProperty('--pill-color', isMe ? 'var(--lime)' : colorForName(entry.name));
        pill.innerHTML =
          '<i class="games-bj-lobby-pill-dot" aria-hidden="true"></i>' +
          escapeHTML(entry.name) +
          (entry.verified ? '' : '<span class="games-bj-lobby-pill-guest">guest</span>');
        els.who.appendChild(pill);
      });
    }

    // Compact echo, right on the felt table — everyone BUT you, since "You"
    // already has its own spot at the table below.
    if (els.tableSeats) {
      els.tableSeats.textContent = '';
      entries
        .filter((entry) => entry.id !== myId)
        .forEach((entry) => {
          const seat = document.createElement('span');
          seat.className = 'games-bj-table-seat';
          seat.style.setProperty('--seat-color', colorForName(entry.name));
          seat.innerHTML =
            '<i class="games-bj-table-seat-dot" aria-hidden="true"></i>' + escapeHTML(entry.name);
          els.tableSeats.appendChild(seat);
        });
    }
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function setLiveDot(on) {
    if (els.liveDot) els.liveDot.hidden = !on;
  }

  function showNameGate(show) {
    if (els.namegate) els.namegate.hidden = !show;
    if (els.form) els.form.hidden = show;
  }

  function connect() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      setStatus('unavailable');
      return;
    }
    try {
      client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: false }
      });
    } catch (_) {
      setStatus('unavailable');
      return;
    }

    myId = randomId();
    channel = client.channel(CHANNEL_NAME, { config: { presence: { key: myId } } });

    channel.on('presence', { event: 'sync' }, () => {
      presenceState = channel.presenceState();
      const currentIds = [];
      Object.keys(presenceState).forEach((key) => {
        const meta = presenceState[key] && presenceState[key][0];
        if (!meta || !meta.name) return;
        currentIds.push(key);
        knownNameById[key] = { name: meta.name, verified: !!meta.verified };
      });

      if (prevPresenceIds === null) {
        // First sync just establishes the baseline — everyone already in the
        // room shows up via the pill list, not a flood of "joined" lines.
        prevPresenceIds = new Set(currentIds);
      } else {
        const currentSet = new Set(currentIds);
        currentIds.forEach((id) => {
          if (id === myId || prevPresenceIds.has(id)) return;
          const info = knownNameById[id];
          if (info) appendPresenceLine(info.name, false, 'joined the table');
        });
        prevPresenceIds.forEach((id) => {
          if (id === myId || currentSet.has(id)) return;
          const info = knownNameById[id];
          if (info) appendPresenceLine(info.name, false, 'left the table');
        });
        prevPresenceIds = currentSet;
      }
      renderWho();
    });

    channel.on('broadcast', { event: 'chat' }, (msg) => {
      const p = msg && msg.payload;
      if (!p || !p.name || !p.text || p.id === myId) return;
      appendChatLine(p.name, p.text, false, !!p.verified);
    });

    channel.on('broadcast', { event: 'result' }, (msg) => {
      const p = msg && msg.payload;
      if (!p || !p.name || p.id === myId) return;
      appendResultLine(p.name, p.mood, Number(p.delta) || 0, !!p.verified);
    });

    channel.on('broadcast', { event: 'meme' }, (msg) => {
      const p = msg && msg.payload;
      if (!p || !p.name || !p.src || p.id === myId) return;
      if (!isAllowedMemeSrc(p.src)) return;
      appendMemeLine(p.name, p.src, false, !!p.verified);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setStatus('live');
        setLiveDot(true);
        channel.track({ name: myName, verified: myVerified });
        appendSystemLine('Connected as ' + myName + (myVerified ? ' (your account name).' : '.'));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setStatus('offline');
        setLiveDot(false);
      } else if (status === 'CLOSED') {
        setStatus('offline');
        setLiveDot(false);
      }
    });
  }

  function sendChat(text) {
    if (!channel) return;
    const now = Date.now();
    if (now - lastSendAt < MIN_SEND_INTERVAL_MS) return;
    const clean = sanitizeMessage(text);
    if (clean === '') return;
    if (clean === null) {
      appendSystemLine('Message blocked.');
      return;
    }
    lastSendAt = now;
    channel.send({ type: 'broadcast', event: 'chat', payload: { id: myId, name: myName, text: clean, verified: myVerified } });
    appendChatLine(myName, clean, true, myVerified);
  }

  // Meme vault list: gallery.json's merged static+admin-upload list (via hub.js's
  // loadGalleryList, if it loaded first) falling back to a plain gallery.json
  // fetch. Cached — the grid is only built once per page load.
  let memeListPromise = null;
  function fetchMemeList() {
    if (memeListPromise) return memeListPromise;
    memeListPromise = (async () => {
      try {
        if (typeof window.loadGalleryList === 'function') {
          const list = await window.loadGalleryList();
          if (Array.isArray(list) && list.length) return list.filter(isAllowedMemeSrc);
        }
      } catch (_) {}
      try {
        const res = await fetch('assets/images/gallery.json');
        if (res.ok) {
          const raw = await res.json();
          const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.images) ? raw.images : []);
          return list.filter(isAllowedMemeSrc);
        }
      } catch (_) {}
      return [];
    })();
    return memeListPromise;
  }

  function sendMeme(src) {
    if (!channel || !isAllowedMemeSrc(src)) return;
    const now = Date.now();
    if (now - lastSendAt < MIN_SEND_INTERVAL_MS) return;
    lastSendAt = now;
    channel.send({ type: 'broadcast', event: 'meme', payload: { id: myId, name: myName, src: src, verified: myVerified } });
    appendMemeLine(myName, src, true, myVerified);
  }

  function memeDisplayName(src) {
    return typeof window.filenameToDisplay === 'function'
      ? window.filenameToDisplay(src)
      : src.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
  }

  let memeListCache = [];
  let memeGridBuilt = false;

  function renderMemeGrid(list) {
    if (!els.memeGrid) return;
    els.memeGrid.textContent = '';
    if (!list.length) {
      const status = document.createElement('div');
      status.className = 'games-bj-meme-grid-status';
      status.textContent = memeListCache.length ? 'No memes match that search.' : 'No memes available.';
      els.memeGrid.appendChild(status);
      return;
    }
    list.forEach((src) => {
      const name = memeDisplayName(src);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'games-bj-meme-grid-btn';
      btn.title = name;
      const img = document.createElement('img');
      img.src = src;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = name;
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        sendMeme(src);
        closeMemePanel();
      });
      els.memeGrid.appendChild(btn);
    });
  }

  function applyMemeSearch() {
    const q = els.memeSearch ? els.memeSearch.value.trim().toLowerCase() : '';
    if (!q) {
      renderMemeGrid(memeListCache);
      return;
    }
    renderMemeGrid(memeListCache.filter((src) => memeDisplayName(src).toLowerCase().includes(q)));
  }

  function openMemePanel() {
    if (!els.memePanel) return;
    els.memePanel.hidden = false;
    if (!memeGridBuilt) {
      memeGridBuilt = true;
      if (els.memeGrid) {
        els.memeGrid.textContent = '';
        const status = document.createElement('div');
        status.className = 'games-bj-meme-grid-status';
        status.textContent = 'Loading memes…';
        els.memeGrid.appendChild(status);
      }
      fetchMemeList().then((list) => {
        memeListCache = list;
        applyMemeSearch();
      });
    }
  }

  function closeMemePanel() {
    if (els.memePanel) els.memePanel.hidden = true;
  }

  function wireMemeButton() {
    if (!els.memeBtn || !els.memePanel) return;
    els.memeBtn.addEventListener('click', () => {
      if (els.memePanel.hidden) openMemePanel(); else closeMemePanel();
    });
    if (els.memeClose) els.memeClose.addEventListener('click', closeMemePanel);
    if (els.memeSearch) els.memeSearch.addEventListener('input', applyMemeSearch);
  }

  // Mirrors the same display_name-else-handle precedence as the leaderboard-name
  // preview. Null if signed out, or if signed in but the profile hasn't loaded yet.
  function accountName() {
    if (!window.FuqCloud || typeof window.FuqCloud.isSignedIn !== 'function' || !window.FuqCloud.isSignedIn()) {
      return null;
    }
    const n = typeof window.FuqCloud.getDisplayName === 'function' ? window.FuqCloud.getDisplayName() : null;
    return n ? sanitizeName(n) || null : null;
  }

  // Signed-in players get their real account name automatically (no gate, and it
  // can't be typed/spoofed by a guest). The profile fetch that backs it is async,
  // so if we're signed in but the name isn't loaded yet, retry briefly before
  // falling back to the guest flow.
  function tryAutoNameFromAccount(retriesLeft) {
    if (channel) return; // already connected — don't yank an established identity
    const name = accountName();
    if (name) {
      myName = name;
      myVerified = true;
      showNameGate(false);
      connect();
      return;
    }
    const stillSignedIn = window.FuqCloud && typeof window.FuqCloud.isSignedIn === 'function' && window.FuqCloud.isSignedIn();
    if (stillSignedIn && retriesLeft > 0) {
      window.setTimeout(() => tryAutoNameFromAccount(retriesLeft - 1), 400);
      return;
    }
    initGuestFlow();
  }

  function initGuestFlow() {
    if (channel) return;
    const existing = sanitizeName(loadName());
    if (existing) {
      myName = existing;
      myVerified = false;
      showNameGate(false);
      connect();
      return;
    }
    showNameGate(true);
    setStatus('pick a name');
  }

  function wireNameGate() {
    if (!els.nameSave || !els.nameInput) return;
    const commit = () => {
      myName = sanitizeName(els.nameInput.value) || randomGuestName();
      myVerified = false;
      saveName(myName);
      showNameGate(false);
      connect();
    };
    els.nameSave.addEventListener('click', commit);
    els.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
  }

  function wireChatForm() {
    if (!els.form || !els.input) return;
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = els.input.value;
      els.input.value = '';
      sendChat(text);
    });
  }

  function init() {
    els.status = $('bj-lobby-status');
    els.liveDot = $('bj-lobby-live-dot');
    els.who = $('bj-lobby-who');
    els.tableSeats = $('bj-table-seats');
    els.feed = $('bj-lobby-feed');
    els.form = $('bj-lobby-form');
    els.input = $('bj-lobby-input');
    els.namegate = $('bj-lobby-namegate');
    els.nameInput = $('bj-lobby-name-input');
    els.nameSave = $('bj-lobby-name-save');
    els.memeBtn = $('bj-lobby-meme-btn');
    els.memePanel = $('bj-lobby-meme-panel');
    els.memeClose = $('bj-lobby-meme-close');
    els.memeSearch = $('bj-lobby-meme-search');
    els.memeGrid = $('bj-lobby-meme-grid');
    if (!els.feed) return; // markup not present on this page

    wireNameGate();
    wireChatForm();
    wireMemeButton();
    tryAutoNameFromAccount(5);

    // Covers signing in *while already on this page* (no reload) — if we're
    // still showing the name gate (or sat down as a guest) when auth resolves
    // or changes, re-check for an account name. Never overrides an
    // already-connected session (tryAutoNameFromAccount no-ops once channel is set).
    window.addEventListener('fuqmea-cloud-auth-state', () => {
      if (!channel) tryAutoNameFromAccount(5);
    });
  }

  // games.js calls this once a blackjack round resolves (see bjFinishRound).
  window.BjLobby = {
    broadcastResult: function (opts) {
      if (!channel || !myName) return;
      const mood = opts && opts.mood;
      const delta = Number(opts && opts.delta);
      if (!Number.isFinite(delta)) return;
      channel.send({ type: 'broadcast', event: 'result', payload: { id: myId, name: myName, mood: mood, delta: delta, verified: myVerified } });
      appendResultLine(myName, mood, delta, myVerified);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
