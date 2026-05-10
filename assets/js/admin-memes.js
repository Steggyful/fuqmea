// Meme Vault admin section: upload to R2, list/rename/publish/hide entries.
// Depends on admin.js having created the Supabase client; we re-fetch via window.supabase.

(function () {
  'use strict';

  const CONFIG = window.FUQ_CLOUD_CONFIG || {};
  const R2_PUBLIC_BASE = 'https://memes.fuqmea.com';
  const GALLERY_JSON_URL = 'assets/images/gallery.json';
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const MAX_BYTES = 25 * 1024 * 1024;

  let sb = null;
  let entries = [];
  let staticSyncTried = false;

  function getClient() {
    if (!sb && window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
      sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    }
    return sb;
  }

  function $id(id) { return document.getElementById(id); }

  function flash(msg, isErr) {
    const bar = $id('status-bar');
    if (!bar) { console[isErr ? 'error' : 'log'](msg); return; }
    bar.textContent = msg;
    bar.className = isErr ? 'show err' : 'show';
    clearTimeout(bar._t);
    bar._t = setTimeout(() => { bar.className = ''; }, 3000);
  }

  function srcFor(entry) {
    if (entry.source === 'static') return entry.storage_key;
    return `${R2_PUBLIC_BASE}/${entry.storage_key}`;
  }

  function categoriesFor(displayName) {
    if (window.FuqmeaCategories && window.FuqmeaCategories.extractCategories) {
      return window.FuqmeaCategories.extractCategories(`x/${displayName}.x`);
    }
    const parts = (displayName || '').split(' - ');
    if (parts.length < 2) return [];
    return [...new Set(parts.slice(0, -1).map((p) => p.trim()).filter(Boolean))];
  }

  // ── Static sync ─────────────────────────────────────────────────────────
  // On first load, fetch gallery.json and tell the DB about any static memes
  // that don't yet have a meme_entries row. Idempotent server-side.
  async function syncStaticOnce() {
    if (staticSyncTried) return;
    staticSyncTried = true;
    try {
      const res = await fetch(GALLERY_JSON_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const raw = await res.json();
      let paths = [];
      if (Array.isArray(raw)) paths = raw;
      else if (raw && Array.isArray(raw.images)) paths = raw.images;
      paths = paths.filter(p => typeof p === 'string' && p.startsWith('assets/images/'));
      if (!paths.length) return;
      const { error } = await getClient().rpc('admin_sync_static_memes', { p_paths: paths });
      if (error) console.warn('sync static memes failed', error);
    } catch (e) {
      console.warn('static sync error', e);
    }
  }

  // ── Load + render ──────────────────────────────────────────────────────
  async function loadEntries() {
    await syncStaticOnce();
    const { data, error } = await getClient().rpc('admin_list_meme_entries');
    if (error) {
      $id('meme-list').innerHTML = `<div class="meme-empty" style="color:var(--red)">Error: ${error.message}</div>`;
      return;
    }
    entries = data || [];
    render();
  }

  function statusOf(entry) {
    if (entry.hidden) return { cls: 'hidden', label: 'HIDDEN' };
    if (!entry.published) return { cls: 'draft', label: 'DRAFT' };
    return { cls: 'live', label: 'LIVE' };
  }

  function passesFilter(entry, filter, q) {
    if (q && !entry.display_name.toLowerCase().includes(q)) return false;
    switch (filter) {
      case 'published': return entry.published && !entry.hidden;
      case 'draft':     return !entry.published;
      case 'hidden':    return entry.hidden;
      case 'upload':    return entry.source === 'upload';
      case 'static':    return entry.source === 'static';
      default:          return true;
    }
  }

  function render() {
    const list = $id('meme-list');
    const stats = $id('meme-stats');
    const filter = $id('meme-filter').value;
    const q = $id('meme-search').value.trim().toLowerCase();

    const total = entries.length;
    const visible = entries.filter(e => passesFilter(e, filter, q));
    if (stats) {
      const drafts = entries.filter(e => !e.published).length;
      const uploads = entries.filter(e => e.source === 'upload').length;
      stats.textContent = `· ${total} total · ${uploads} uploaded · ${drafts} drafts`;
    }

    if (!visible.length) {
      list.innerHTML = '<div class="meme-empty">No memes match.</div>';
      return;
    }

    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    visible.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'meme-row';
      row.dataset.id = entry.id;

      const img = document.createElement('img');
      img.className = 'meme-thumb';
      img.src = srcFor(entry);
      img.alt = entry.display_name;
      img.loading = 'lazy';
      img.decoding = 'async';

      const nameWrap = document.createElement('div');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'meme-name';
      nameDiv.textContent = entry.display_name;
      nameWrap.appendChild(nameDiv);

      const cats = categoriesFor(entry.display_name);
      const hint = document.createElement('div');
      hint.className = 'meme-cat-hint';
      if (cats.length) {
        hint.innerHTML = `Tags: <strong>${cats.map(escapeHTML).join('</strong>, <strong>')}</strong>`;
      } else {
        hint.textContent = 'No tags (rename to "Tag - Title" to categorize)';
      }
      nameWrap.appendChild(hint);

      const badges = document.createElement('div');
      badges.className = 'meme-badges';
      const status = statusOf(entry);
      badges.innerHTML =
        `<span class="meme-badge ${entry.source}">${entry.source.toUpperCase()}</span>` +
        `<span class="meme-badge ${status.cls}">${status.label}</span>`;

      const actions = document.createElement('div');
      actions.className = 'meme-actions';

      const renameBtn = btn('RENAME', 'btn-yellow', () => beginRename(entry, nameDiv));
      actions.appendChild(renameBtn);

      if (entry.source === 'upload') {
        const pubBtn = btn(entry.published ? 'UNPUBLISH' : 'PUBLISH',
          entry.published ? '' : 'btn-yellow',
          () => setPublished(entry, !entry.published));
        actions.appendChild(pubBtn);
      } else {
        const hideBtn = btn(entry.hidden ? 'UNHIDE' : 'HIDE',
          entry.hidden ? '' : 'btn-red',
          () => setHidden(entry, !entry.hidden));
        actions.appendChild(hideBtn);
      }

      if (entry.source === 'upload') {
        const delBtn = btn('DELETE', 'btn-red', () => confirmDelete(entry));
        actions.appendChild(delBtn);
      }

      row.appendChild(img);
      row.appendChild(nameWrap);
      row.appendChild(badges);
      row.appendChild(actions);
      frag.appendChild(row);
    });

    list.appendChild(frag);
  }

  function btn(label, extra, onClick) {
    const b = document.createElement('button');
    b.className = `btn btn-sm ${extra || ''}`.trim();
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Inline rename ──────────────────────────────────────────────────────
  function beginRename(entry, nameDiv) {
    if (nameDiv.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = entry.display_name;
    input.maxLength = 200;
    nameDiv.innerHTML = '';
    nameDiv.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (!next || next === entry.display_name) { render(); return; }
      const { data, error } = await getClient().rpc('admin_rename_meme', {
        p_id: entry.id, p_display_name: next
      });
      if (error) { flash('Rename failed: ' + error.message, true); render(); return; }
      Object.assign(entry, data);
      flash(`Renamed to "${data.display_name}"`);
      render();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { done = true; render(); }
    });
  }

  // ── Publish / hide / delete ────────────────────────────────────────────
  async function setPublished(entry, value) {
    const { data, error } = await getClient().rpc('admin_set_meme_published', {
      p_id: entry.id, p_published: value
    });
    if (error) { flash(error.message, true); return; }
    Object.assign(entry, data);
    flash(`${entry.display_name}: ${value ? 'published' : 'unpublished'}`);
    render();
  }

  async function setHidden(entry, value) {
    const { data, error } = await getClient().rpc('admin_set_meme_hidden', {
      p_id: entry.id, p_hidden: value
    });
    if (error) { flash(error.message, true); return; }
    Object.assign(entry, data);
    flash(`${entry.display_name}: ${value ? 'hidden' : 'unhidden'}`);
    render();
  }

  async function confirmDelete(entry) {
    if (!confirm(`Permanently delete "${entry.display_name}"?\n\nThis removes the file from R2 storage.`)) return;
    const session = (await getClient().auth.getSession()).data.session;
    if (!session) { flash('Not signed in', true); return; }

    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/delete-meme`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': CONFIG.supabaseAnonKey,
        },
        body: JSON.stringify({ id: entry.id })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { flash('Delete failed: ' + (body.error || res.status), true); return; }
      entries = entries.filter(e => e.id !== entry.id);
      flash(`Deleted "${entry.display_name}"`);
      render();
    } catch (e) {
      flash('Delete network error', true);
    }
  }

  // ── Upload ─────────────────────────────────────────────────────────────
  async function uploadFiles(fileList) {
    const files = Array.from(fileList).filter(f => f && f.size > 0);
    if (!files.length) return;

    const session = (await getClient().auth.getSession()).data.session;
    if (!session) { flash('Not signed in', true); return; }

    let okCount = 0;
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        flash(`Skipped ${file.name}: unsupported type`, true);
        continue;
      }
      if (file.size > MAX_BYTES) {
        flash(`Skipped ${file.name}: over 25 MB`, true);
        continue;
      }

      const baseName = (file.name || 'upload').replace(/\.[^.]+$/, '').trim() || 'upload';
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('display_name', baseName.slice(0, 200));

      try {
        const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/upload-meme`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': CONFIG.supabaseAnonKey,
          },
          body: fd
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          flash(`${file.name}: ${body.error || res.status}`, true);
          continue;
        }
        if (body.entry) entries.unshift(body.entry);
        okCount += 1;
      } catch (e) {
        flash(`${file.name}: network error`, true);
      }
    }

    if (okCount) {
      flash(`Uploaded ${okCount} meme${okCount === 1 ? '' : 's'} (drafts — publish them when ready)`);
      render();
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function init() {
    const zone = $id('meme-upload-zone');
    const input = $id('meme-upload-input');

    if (zone && input) {
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
        e.preventDefault(); zone.classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => {
        e.preventDefault(); zone.classList.remove('dragover');
      }));
      zone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
      });
      input.addEventListener('change', () => {
        if (input.files) uploadFiles(input.files);
        input.value = '';
      });
    }

    const refresh = $id('meme-refresh-btn');
    if (refresh) refresh.addEventListener('click', loadEntries);

    const search = $id('meme-search');
    const filter = $id('meme-filter');
    if (search) search.addEventListener('input', render);
    if (filter) filter.addEventListener('change', render);

    // Wait for the user's session to settle before listing memes (admin.js owns auth).
    waitForSession().then(loadEntries).catch(() => { /* not signed in */ });
  }

  async function waitForSession() {
    const client = getClient();
    if (!client) throw new Error('no client');
    for (let i = 0; i < 40; i++) {
      const { data: { session } } = await client.auth.getSession();
      if (session && session.user?.app_metadata?.role === 'admin') return session;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('no admin session');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
