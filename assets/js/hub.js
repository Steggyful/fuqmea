// ==================== FUQMEA.COM - CENTRAL HUB SCRIPT ====================

// ====================== IMAGE LISTS (EDIT HERE ONLY) ======================
const rotatorMemes = [
  "assets/images/01 Vivid.jpg",
  "assets/images/Emoji - Butt.png",
  "assets/images/IMG_3743.jpg",
  "assets/images/The Fifi.jpg"
];

const galleryMemes = [
  "assets/images/01 Vivid.jpg",
  "assets/images/Emoji - Butt.png",
  "assets/images/The Fifi.jpg"
  // ← Fallback if gallery.json is missing or fails to load
];

// ====================== PERFORMANCE OPTIMIZATIONS ======================

// Preload critical images
function preloadCriticalImages() {
  const criticalImages = [
    "assets/images/01 Vivid.jpg",
    "assets/images/The Fifi.jpg"
    // Add whatever you want for the big rotating banner on the home page
  ];

  criticalImages.forEach(src => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
  });
}

// Optimize for mobile performance
function setupMobileOptimizations() {
  // Reduce motion for battery saving on mobile
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.style.setProperty('--animation-duration', '0s');
  }

  // Passive listeners for better scroll performance
  const gallery = document.getElementById('gallery');
  if (gallery) {
    gallery.addEventListener('touchstart', () => {}, { passive: true });
    gallery.addEventListener('touchmove', () => {}, { passive: true });
  }
}

// Debounce function for performance
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function for performance
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Validate image path to prevent directory traversal attacks
function validateImagePath(path) {
  if (typeof path !== 'string') return false;
  // Only allow paths starting with assets/images/
  if (!path.startsWith('assets/images/')) return false;
  // Prevent directory traversal with ..
  if (path.includes('..') || path.includes('//')) return false;
  return true;
}

function getExtensionFromPath(path) {
  const filename = path.split('/').pop() || '';
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function getRandomMemeFilename(extension = '', usedNames) {
  let candidate = '';
  do {
    const randomId = Math.floor(1000 + Math.random() * 9000); // 4 digits
    candidate = `meme_${randomId}${extension}`;
  } while (usedNames && usedNames.has(candidate));
  if (usedNames) usedNames.add(candidate);
  return candidate;
}

async function loadGalleryList() {
  try {
    const res = await fetch('assets/images/gallery.json');
    if (!res.ok) throw new Error('gallery.json not found');
    const list = await res.json();
    if (Array.isArray(list) && list.length > 0) {
      // Validate all paths before returning
      const validatedList = list.filter(validateImagePath);
      if (validatedList.length > 0) {
        return validatedList;
      }
    }
  } catch (err) {
    console.warn('gallery.json load failed, using fallback');
  }
  return galleryMemes;
}

function renderGallery(memes) {
  const container = document.getElementById('gallery');
  if (!container) return;

  // Clear container safely
  container.innerHTML = '';

  // Create elements without using innerHTML to prevent XSS
  memes.forEach((src, index) => {
    const card = document.createElement('div');
    card.className = 'meme-card';
    card.dataset.src = src;
    
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'FuqMeA Meme';
    img.loading = 'lazy';
    img.addEventListener('click', function() { toggleSelect(this); });

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'meme-view-btn';
    viewBtn.textContent = 'VIEW';
    viewBtn.setAttribute('aria-label', 'Open meme in lightbox');
    viewBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openLightboxAt(index, memes);
    });
    
    card.appendChild(img);
    card.appendChild(viewBtn);
    container.appendChild(card);
  });
}

async function initGallery() {
  const memes = await loadGalleryList();
  setupLightbox();
  setupSelectedPreviewModal();
  renderGallery(memes);

  const randomBtn = document.getElementById('random-meme-btn');
  if (randomBtn) {
    randomBtn.addEventListener('click', () => openRandomMeme(memes));
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('randomMeme') === '1') {
    openRandomMeme(memes);
    // Consume one-time random trigger so refresh doesn't reopen repeatedly.
    params.delete('randomMeme');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }
}

// ====================== ROTATOR (Home Page) ======================
let current = 0;
let rotatorStarted = false;

async function startRotator() {
  const container = document.getElementById('meme-rotator');
  if (!container || rotatorStarted) return;
  rotatorStarted = true;

  const firstImage = rotatorMemes[0];
  let sourceList = [];

  try {
    sourceList = await loadGalleryList();
  } catch (err) {
    sourceList = galleryMemes;
  }

  const uniqueSources = [...new Set([...(Array.isArray(sourceList) ? sourceList : galleryMemes)])];
  const randomPool = uniqueSources.filter(src => src !== firstImage);
  shuffleArray(randomPool);

  const maxRandomSlides = 24;
  const rotatorList = [firstImage, ...randomPool.slice(0, maxRandomSlides)];

  rotatorList.forEach(src => {
    const img = new Image();
    img.src = src;
  });

  rotatorList.forEach((src, i) => {
    const img = document.createElement('img');
    img.src = src;
    if (i === 0) img.classList.add('active');
    container.appendChild(img);
  });

  setInterval(() => {
    const imgs = container.querySelectorAll('img');
    if (imgs.length === 0) return;
    imgs[current].classList.remove('active');
    current = (current + 1) % rotatorList.length;
    imgs[current].classList.add('active');
  }, 3000);
}

let selected = new Set();
let lightboxMemes = [];
let lightboxIndex = 0;

function setupLightbox() {
  if (document.getElementById('meme-lightbox')) return;

  const overlay = document.createElement('div');
  overlay.id = 'meme-lightbox';
  overlay.className = 'meme-lightbox';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <button type="button" class="meme-lightbox-close" id="meme-lightbox-close" aria-label="Close lightbox">CLOSE</button>
    <button type="button" class="meme-lightbox-nav prev" id="meme-lightbox-prev" aria-label="Previous meme">PREV</button>
    <div class="meme-lightbox-frame">
      <img id="meme-lightbox-image" alt="Selected meme preview">
    </div>
    <button type="button" class="meme-lightbox-nav next" id="meme-lightbox-next" aria-label="Next meme">NEXT</button>
    <div class="meme-lightbox-actions">
      <button type="button" class="button meme-lightbox-action" id="meme-lightbox-download">DOWNLOAD THIS MEME</button>
      <button type="button" class="button meme-lightbox-action" id="meme-lightbox-toggle-select">ADD TO ZIP SELECTION</button>
      <button type="button" class="button meme-lightbox-action" id="meme-lightbox-selected-preview">VIEW SELECTED</button>
      <button type="button" class="button meme-lightbox-action" id="meme-lightbox-download-zip">DOWNLOAD SELECTED AS ZIP</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeLightbox();
  });

  document.getElementById('meme-lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('meme-lightbox-prev').addEventListener('click', () => shiftLightbox(-1));
  document.getElementById('meme-lightbox-next').addEventListener('click', () => shiftLightbox(1));
  document.getElementById('meme-lightbox-download').addEventListener('click', downloadCurrentLightboxMeme);
  document.getElementById('meme-lightbox-toggle-select').addEventListener('click', toggleCurrentLightboxSelection);
  document.getElementById('meme-lightbox-selected-preview').addEventListener('click', openSelectedPreviewModal);
  document.getElementById('meme-lightbox-download-zip').addEventListener('click', () => downloadSelectedAsZip());

  document.addEventListener('keydown', (event) => {
    if (!overlay.classList.contains('open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') shiftLightbox(-1);
    if (event.key === 'ArrowRight') shiftLightbox(1);
  });
}

function openLightboxAt(index, memes) {
  if (!Array.isArray(memes) || memes.length === 0) return;
  lightboxMemes = memes;
  lightboxIndex = index;
  const overlay = document.getElementById('meme-lightbox');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  syncLightbox();
}

function closeLightbox() {
  const overlay = document.getElementById('meme-lightbox');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function shiftLightbox(direction) {
  if (!lightboxMemes.length) return;
  lightboxIndex = (lightboxIndex + direction + lightboxMemes.length) % lightboxMemes.length;
  syncLightbox();
}

function syncLightbox() {
  const img = document.getElementById('meme-lightbox-image');
  const frame = document.querySelector('.meme-lightbox-frame');
  const toggleBtn = document.getElementById('meme-lightbox-toggle-select');
  const zipBtn = document.getElementById('meme-lightbox-download-zip');
  if (!img || !toggleBtn || !lightboxMemes.length) return;
  const src = lightboxMemes[lightboxIndex];
  const isSelected = selected.has(src);
  img.src = src;
  img.alt = `FuqMeA Meme ${lightboxIndex + 1}`;
  toggleBtn.textContent = isSelected ? 'REMOVE FROM ZIP SELECTION' : 'ADD TO ZIP SELECTION';
  if (frame) frame.classList.toggle('selected', isSelected);
  if (zipBtn) zipBtn.disabled = selected.size === 0;
}

function toggleCurrentLightboxSelection() {
  if (!lightboxMemes.length) return;
  const src = lightboxMemes[lightboxIndex];
  const safeSrc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(src) : src.replace(/"/g, '\\"');
  const card = document.querySelector(`.meme-card[data-src="${safeSrc}"]`);
  if (!card) return;
  const img = card.querySelector('img');
  if (!img) return;
  toggleSelect(img);
  syncLightbox();
}

async function downloadSingleMeme(src) {
  try {
    if (!validateImagePath(src)) return;
    const extension = getExtensionFromPath(src);
    const filename = getRandomMemeFilename(extension);
    const response = await fetch(src);
    if (!response.ok) throw new Error('Fetch failed');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (err) {
    console.error('Single meme download failed');
  }
}

async function downloadCurrentLightboxMeme() {
  if (!lightboxMemes.length) return;
  await downloadSingleMeme(lightboxMemes[lightboxIndex]);
}

function openRandomMeme(memes) {
  if (!Array.isArray(memes) || memes.length === 0) return;
  const randomIndex = Math.floor(Math.random() * memes.length);
  openLightboxAt(randomIndex, memes);
}

window.toggleSelect = function(img) {
  const card = img.parentElement;
  const src = card.dataset.src;
  
  if (selected.has(src)) {
    selected.delete(src);
    card.classList.remove('selected');
  } else {
    selected.add(src);
    card.classList.add('selected');
  }
  
  updateSelectedUI();
  const overlay = document.getElementById('meme-lightbox');
  if (overlay && overlay.classList.contains('open')) {
    syncLightbox();
  }
};

window.deselectAll = function() {
  selected.clear();
  document.querySelectorAll('.meme-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
  updateSelectedUI();
};

window.selectAll = function() {
  document.querySelectorAll('.meme-card').forEach(card => {
    const src = card.dataset.src;
    if (!src) return;
    selected.add(src);
    card.classList.add('selected');
  });
  updateSelectedUI();
};

function setupSelectedPreviewModal() {
  if (document.getElementById('selected-preview-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'selected-preview-modal';
  modal.className = 'selected-preview-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="selected-preview-panel" role="dialog" aria-modal="true" aria-labelledby="selected-preview-title">
      <div class="selected-preview-header">
        <h2 id="selected-preview-title">Selected Memes</h2>
        <button type="button" class="selected-preview-close" id="selected-preview-close" aria-label="Close selected preview">CLOSE</button>
      </div>
      <div class="selected-preview-table-wrap">
        <table class="selected-preview-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>File</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="selected-preview-body"></tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const topPreviewBtn = document.getElementById('selected-preview-btn');
  if (topPreviewBtn) {
    topPreviewBtn.addEventListener('click', openSelectedPreviewModal);
  }

  document.getElementById('selected-preview-close').addEventListener('click', closeSelectedPreviewModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeSelectedPreviewModal();
  });
}

function openSelectedPreviewModal() {
  renderSelectedPreviewModal();
  const modal = document.getElementById('selected-preview-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeSelectedPreviewModal() {
  const modal = document.getElementById('selected-preview-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function renderSelectedPreviewModal() {
  const body = document.getElementById('selected-preview-body');
  if (!body) return;
  body.innerHTML = '';

  if (selected.size === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No memes selected yet.';
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  Array.from(selected).forEach((src) => {
    const filename = src.split('/').pop() || 'meme-file';
    const row = document.createElement('tr');

    const previewCell = document.createElement('td');
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Selected meme thumbnail';
    img.className = 'selected-preview-thumb';
    previewCell.appendChild(img);

    const fileCell = document.createElement('td');
    fileCell.textContent = filename;

    const actionsCell = document.createElement('td');
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'selected-preview-action';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => {
      if (!lightboxMemes.length) return;
      const idx = lightboxMemes.indexOf(src);
      if (idx >= 0) {
        closeSelectedPreviewModal();
        openLightboxAt(idx, lightboxMemes);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'selected-preview-action remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      selected.delete(src);
      const safeSrc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(src) : src.replace(/"/g, '\\"');
      const card = document.querySelector(`.meme-card[data-src="${safeSrc}"]`);
      if (card) card.classList.remove('selected');
      updateSelectedUI();
      if (selected.size === 0) closeSelectedPreviewModal();
    });

    actionsCell.appendChild(viewBtn);
    actionsCell.appendChild(removeBtn);

    row.appendChild(previewCell);
    row.appendChild(fileCell);
    row.appendChild(actionsCell);
    body.appendChild(row);
  });
}

function updateSelectedUI() {
  const previewBtn = document.getElementById('selected-preview-btn');
  const zipBtn = document.getElementById('download-zip-btn');
  const deselectBtn = document.getElementById('deselect-all-btn');
  const lightboxPreviewBtn = document.getElementById('meme-lightbox-selected-preview');
  const lightboxZipBtn = document.getElementById('meme-lightbox-download-zip');
  const selectedCount = selected.size;
  const zipLabel = `DOWNLOAD SELECTED AS ZIP (${selectedCount})`;
  const previewLabel = `VIEW SELECTED (${selectedCount})`;
  
  if (previewBtn) {
    previewBtn.style.display = selectedCount > 0 ? 'inline-block' : 'none';
    previewBtn.textContent = previewLabel;
  }
  if (zipBtn) {
    zipBtn.style.display = selectedCount > 0 ? 'inline-block' : 'none';
    zipBtn.textContent = zipLabel;
  }
  if (deselectBtn) deselectBtn.style.display = selectedCount > 0 ? 'inline-block' : 'none';
  if (lightboxPreviewBtn) {
    lightboxPreviewBtn.disabled = selectedCount === 0;
    lightboxPreviewBtn.textContent = previewLabel;
  }
  if (lightboxZipBtn) {
    lightboxZipBtn.disabled = selectedCount === 0;
    lightboxZipBtn.textContent = zipLabel;
  }
  renderSelectedPreviewModal();
}

// ZIP Download
document.addEventListener('DOMContentLoaded', () => {
  const zipBtn = document.getElementById('download-zip-btn');
  if (zipBtn) {
    zipBtn.addEventListener('click', () => downloadSelectedAsZip(zipBtn));
  }
  
  const deselectBtn = document.getElementById('deselect-all-btn');
  if (deselectBtn) {
    deselectBtn.addEventListener('click', deselectAll);
  }

  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', selectAll);
  }

  // Delegated fallback so preview buttons still work
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const previewTrigger = target.closest('#selected-preview-btn, #meme-lightbox-selected-preview');
    if (previewTrigger) {
      openSelectedPreviewModal();
    }
  });
});

async function downloadSelectedAsZip(triggerButton) {
  if (selected.size === 0) return;

  try {
    if (!window.JSZip) {
      alert('Download library not loaded. Please refresh the page.');
      return;
    }

    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.textContent = 'DOWNLOADING...';
    }

    const zip = new window.JSZip();
    const usedNames = new Set();
    const promises = Array.from(selected).map(async (src) => {
      try {
        if (!validateImagePath(src)) return;
        const extension = getExtensionFromPath(src);
        const filename = getRandomMemeFilename(extension, usedNames);
        const response = await fetch(src);
        if (!response.ok) throw new Error('Fetch failed');
        const blob = await response.blob();
        zip.file(filename, blob);
      } catch (err) {
        console.error('Image fetch error (non-critical)');
      }
    });

    await Promise.all(promises);
    const content = await zip.generateAsync({ type: 'blob' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `meme_pack_${Math.floor(1000 + Math.random() * 9000)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (err) {
    console.error('Download error occurred');
    alert('Download failed. Please try again.');
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
    }
    updateSelectedUI();
  }
}

// ====================== LIVE STATUS (TIKTOK + TWITCH) ======================

// Master switch: when false, live checks stay disabled across all pages.
const LIVE_STATUS_ENABLED = false;
const LIVE_STATUS_INTERVAL_MS = 45000;

// Rate limiting and error tracking
const liveStatusCache = new Map();
const liveStatusErrors = new Map();
const MAX_ERRORS = 3;
const ERROR_RESET_TIME = 300000; // 5 minutes
let liveStatusIntervalId = null;
let liveStatusMockMap = new Map();

function parseMockLiveStatuses() {
  const params = new URLSearchParams(window.location.search);
  const mockLiveParam = params.get('mockLive');
  const result = new Map();
  if (!mockLiveParam) return result;

  // Format: ?mockLive=ssgvivid:tiktok:420,steggyful1:twitch:77
  mockLiveParam.split(',').map(x => x.trim()).filter(Boolean).forEach(entry => {
    const [usernameRaw, platformRaw, viewersRaw] = entry.split(':');
    const username = (usernameRaw || '').trim().toLowerCase();
    const platform = (platformRaw || '').trim().toLowerCase();
    const viewers = Number.parseInt((viewersRaw || '').trim(), 10);
    if (!username || (platform !== 'tiktok' && platform !== 'twitch' && platform !== 'both')) return;
    result.set(username, {
      platform,
      viewers: Number.isFinite(viewers) ? viewers : null
    });
  });

  return result;
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 8000) {
  if (!('AbortController' in window)) {
    return fetch(resource, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- TWITCH ----
async function checkTwitchLive(username) {
  try {
    const safeUsername = encodeURIComponent(username);
    const res = await fetchWithTimeout(`https://decapi.me/twitch/uptime/${safeUsername}`);
    if (!res.ok) return { live: false };
    const text = await res.text();
    return { live: !text.includes("offline"), viewers: null, platform: 'twitch' };
  } catch (e) {
    console.warn('Twitch check failed for', username);
    return { live: false };
  }
}

// ---- TIKTOK ----
async function checkTikTokLive(username) {
  try {
    const safeUsername = encodeURIComponent(username);
    const res = await fetchWithTimeout(`https://www.tiktok.com/@${safeUsername}/live`);
    if (!res.ok) return { live: false };
    const text = await res.text();
    const isLive = text.includes('"isLiveBroadcast":true') || text.includes('"liveRoomId"');
    if (!isLive) return { live: false };
    
    let viewers = null;
    const match = text.match(/"user_count":(\d+)/);
    if (match) viewers = parseInt(match[1]);
    return { live: true, viewers, platform: 'tiktok' };
  } catch (e) {
    console.warn('TikTok check failed for', username);
    return { live: false };
  }
}

function formatViewerCount(viewers) {
  if (!Number.isFinite(viewers) || viewers < 0) return '';
  if (viewers >= 1000000) return `${(viewers / 1000000).toFixed(1).replace('.0', '')}M`;
  if (viewers >= 1000) return `${(viewers / 1000).toFixed(1).replace('.0', '')}K`;
  return `${viewers}`;
}

function setStreamerStatus(dot, text, streamerBtn, streamerSection, status) {
  if (!dot || !text) return;
  text.setAttribute('aria-live', 'polite');
  text.setAttribute('role', 'status');

  const targets = [streamerBtn, streamerSection].filter(Boolean);
  targets.forEach(el => {
    el.classList.remove('live', 'offline', 'checking');
    el.classList.add(status.state);
  });

  if (status.state === 'live') {
    const viewersText = formatViewerCount(status.viewers);
    text.textContent = viewersText
      ? `LIVE • ${viewersText} viewers`
      : 'LIVE';
    return;
  }

  if (status.state === 'checking') {
    text.textContent = 'CHECKING...';
    return;
  }

  text.textContent = 'OFFLINE';
}

function setPlatformLiveButtons(streamerSection, tiktokLive, twitchLive) {
  if (!streamerSection) return;
  const links = streamerSection.querySelectorAll('a.button');
  links.forEach(link => {
    const href = link.getAttribute('href') || '';
    const isTikTokLink = href.includes('tiktok.com');
    const isTwitchLink = href.includes('twitch.tv');
    const shouldPulse = (isTikTokLink && tiktokLive) || (isTwitchLink && twitchLive);
    link.classList.toggle('platform-live', shouldPulse);
    link.setAttribute('aria-live', shouldPulse ? 'polite' : 'off');
  });
}

function setLiveStatusVisibility(enabled) {
  const streamers = document.querySelectorAll('.streamers');
  streamers.forEach(el => {
    el.style.display = enabled ? 'flex' : 'none';
  });
}

function setStreamerCardVisibility(username, isVisible) {
  const headerCards = document.querySelectorAll(`.streamer-btn[data-streamer="${username}"]`);
  headerCards.forEach(card => {
    card.style.display = isVisible ? 'flex' : 'none';
  });
}

function refreshHeaderLiveStripVisibility() {
  const wrappers = document.querySelectorAll('.streamers');
  wrappers.forEach(wrapper => {
    const visibleCards = wrapper.querySelectorAll('.streamer-btn.live');
    wrapper.style.display = visibleCards.length > 0 ? 'flex' : 'none';
  });
}

// ---- COMBINED with Rate Limiting ----
async function updateStreamerLive(username, dotId, textId) {
  const dot = document.getElementById(dotId);
  const text = document.getElementById(textId);
  if (!dot || !text) return;

  const streamerBtn = dot.closest('.streamer-btn');
  const streamerSection = document.querySelector(`.streamer-section[data-streamer="${username}"]`);
  const normalizedUsername = username.toLowerCase();

  if (!LIVE_STATUS_ENABLED) {
    setStreamerStatus(dot, text, streamerBtn, streamerSection, { state: 'offline' });
    setStreamerCardVisibility(username, false);
    refreshHeaderLiveStripVisibility();
    return;
  }

  const mockStatus = liveStatusMockMap.get(normalizedUsername);
  if (mockStatus) {
    const tiktokLive = mockStatus.platform === 'tiktok' || mockStatus.platform === 'both';
    const twitchLive = mockStatus.platform === 'twitch' || mockStatus.platform === 'both';
    const platform = tiktokLive ? 'tiktok' : 'twitch';

    setStreamerStatus(dot, text, streamerBtn, streamerSection, {
      state: 'live',
      viewers: mockStatus.viewers,
      platform
    });
    setPlatformLiveButtons(streamerSection, tiktokLive, twitchLive);
    setStreamerCardVisibility(username, true);
    refreshHeaderLiveStripVisibility();
    return;
  }

  // Check error count and apply backoff
  const errorCount = liveStatusErrors.get(username) || 0;
  if (errorCount >= MAX_ERRORS) {
    console.warn(`Too many errors for ${username}, skipping check`);
    return;
  }

  try {
    const [tiktok, twitch] = await Promise.all([
      checkTikTokLive(username),
      checkTwitchLive(username)
    ]);
    const isLive = tiktok.live || twitch.live;

    if (isLive) {
      const viewers = Number.isFinite(tiktok.viewers) ? tiktok.viewers : twitch.viewers;
      const platform = tiktok.live ? tiktok.platform : twitch.platform;
      setStreamerStatus(dot, text, streamerBtn, streamerSection, {
        state: 'live',
        viewers,
        platform
      });
      setPlatformLiveButtons(streamerSection, tiktok.live, twitch.live);
      setStreamerCardVisibility(username, true);
    } else {
      setStreamerStatus(dot, text, streamerBtn, streamerSection, { state: 'offline' });
      setPlatformLiveButtons(streamerSection, false, false);
      setStreamerCardVisibility(username, false);
    }
    refreshHeaderLiveStripVisibility();
    
    // Reset error count on success
    liveStatusErrors.delete(username);
    liveStatusCache.set(username, { isLive, checkedAt: Date.now() });
  } catch (err) {
    const newErrorCount = (liveStatusErrors.get(username) || 0) + 1;
    liveStatusErrors.set(username, newErrorCount);
    console.error(`Live status error for ${username} (attempt ${newErrorCount})`);
    // Keep last known UI state to avoid visual flicker during transient request failures.
    window.setTimeout(() => liveStatusErrors.delete(username), ERROR_RESET_TIME);
  }
}

// ---- INIT ----
function initLiveStatus() {
  liveStatusMockMap = parseMockLiveStatuses();
  // Avoid header-strip flash on load: keep hidden until we have confirmed live data.
  setLiveStatusVisibility(false);
  setStreamerCardVisibility('steggyful1', false);
  setStreamerCardVisibility('ssgvivid', false);

  if (!LIVE_STATUS_ENABLED) {
    updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
    updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");
    return;
  }

  updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
  updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");

  liveStatusIntervalId = window.setInterval(() => {
    if (document.hidden) return;
    updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
    updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");
  }, LIVE_STATUS_INTERVAL_MS);

  // Debounce visibility change to avoid flashing when switching tabs
  // Only re-check if cache is stale (older than 10 seconds)
  let visibilityTimeout;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clearTimeout(visibilityTimeout);
      // Wait 500ms before checking, and only if cache is stale
      visibilityTimeout = setTimeout(() => {
        const now = Date.now();
        const cache1 = liveStatusCache.get('steggyful1');
        const cache2 = liveStatusCache.get('ssgvivid');
        const cacheAge1 = cache1 ? now - cache1.checkedAt : Infinity;
        const cacheAge2 = cache2 ? now - cache2.checkedAt : Infinity;
        
        // Only update if cache is older than 10 seconds
        if (cacheAge1 > 10000 || cacheAge2 > 10000) {
          updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
          updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");
        }
      }, 500);
    }
  });
}