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

async function loadGalleryList() {
  try {
    const res = await fetch('assets/images/gallery.json');
    if (!res.ok) throw new Error('gallery.json not found');
    const list = await res.json();
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  } catch (err) {
    console.warn('gallery.json load failed, using fallback:', err);
  }
  return galleryMemes;
}

function renderGallery(memes) {
  const container = document.getElementById('gallery');
  if (!container) return;

  const html = memes.map(src => `
    <div class="meme-card" data-src="${src}">
      <img src="${src}" alt="FuqMeA Meme" loading="lazy" onclick="toggleSelect(this)">
    </div>
  `).join('');

  container.innerHTML = html;
}

async function initGallery() {
  const memes = await loadGalleryList();
  renderGallery(memes);
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

  const maxRandomSlides = 10;
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
};

window.deselectAll = function() {
  selected.clear();
  document.querySelectorAll('.meme-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
  updateSelectedUI();
};

function updateSelectedUI() {
  const countEl = document.getElementById('selected-count');
  const zipBtn = document.getElementById('download-zip-btn');
  const deselectBtn = document.getElementById('deselect-all-btn');
  
  if (countEl) countEl.textContent = `${selected.size} selected`;
  if (zipBtn) zipBtn.style.display = selected.size > 0 ? 'inline-block' : 'none';
  if (deselectBtn) deselectBtn.style.display = selected.size > 0 ? 'inline-block' : 'none';
}

// ZIP Download
document.addEventListener('DOMContentLoaded', () => {
  const zipBtn = document.getElementById('download-zip-btn');
  if (zipBtn) {
    zipBtn.addEventListener('click', async () => {
      if (selected.size === 0) return;
      
      try {
        // Check if JSZip is available
        if (!window.JSZip) {
          alert('Download library not loaded. Please refresh the page.');
          return;
        }
        
        zipBtn.disabled = true;
        zipBtn.textContent = 'DOWNLOADING...';
        
        const zip = new window.JSZip();
        const promises = Array.from(selected).map(async (src) => {
          try {
            const filename = src.split('/').pop();
            const response = await fetch(src);
            if (!response.ok) throw new Error(`Failed to fetch ${filename}`);
            const blob = await response.blob();
            zip.file(filename, blob);
          } catch (err) {
            console.error('Error fetching image:', err);
          }
        });

        await Promise.all(promises);
        const content = await zip.generateAsync({type: "blob"});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `fuqmea-memes-${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        
        zipBtn.disabled = false;
        zipBtn.textContent = 'DOWNLOAD SELECTED AS ZIP';
      } catch (err) {
        console.error('Download error:', err);
        alert('Download failed. Check browser console for details.');
        zipBtn.disabled = false;
        zipBtn.textContent = 'DOWNLOAD SELECTED AS ZIP';
      }
    });
  }
  
  const deselectBtn = document.getElementById('deselect-all-btn');
  if (deselectBtn) {
    deselectBtn.addEventListener('click', deselectAll);
  }
});

// ====================== LIVE STATUS (TIKTOK + TWITCH) ======================

// ---- TWITCH ----
async function checkTwitchLive(username) {
  try {
    const res = await fetch(`https://decapi.me/twitch/uptime/${username}`);
    const text = await res.text();

    if (text.includes("offline")) {
      return { live: false };
    }

    return {
      live: true
    };

  } catch (e) {
    return { live: false };
  }
}

// ---- TIKTOK ----
async function checkTikTokLive(username) {
  try {
    const res = await fetch(`https://www.tiktok.com/@${username}/live`);
    const text = await res.text();

    const isLive =
      text.includes('"isLiveBroadcast":true') ||
      text.includes('"liveRoomId"');

    if (!isLive) return { live: false };

    // Attempt to grab viewer count (can fail silently)
    let viewers = null;
    const match = text.match(/"user_count":(\d+)/);

    if (match) {
      viewers = parseInt(match[1]);
    }

    return { live: true, viewers };

  } catch (e) {
    return { live: false };
  }
}

// ---- COMBINED ----
async function updateStreamerLive(username, dotId, textId) {
  const [tiktok, twitch] = await Promise.all([
    checkTikTokLive(username),
    checkTwitchLive(username)
  ]);

  const dot = document.getElementById(dotId);
  const text = document.getElementById(textId);

  if (!dot || !text) return;

  const streamerBtn = dot.closest('.streamer-btn');
  const streamerSection = document.querySelector(`.streamer-section[data-streamer="${username}"]`);
  const isLive = tiktok.live || twitch.live;

  if (isLive) {
    if (streamerBtn) streamerBtn.classList.add('live');
    if (streamerSection) streamerSection.classList.add('live');

    const viewers = tiktok.viewers || twitch.viewers;

    text.textContent = viewers
      ? `LIVE NOW • ${viewers} watching`
      : `LIVE NOW`;
      
  } else {
    if (streamerBtn) streamerBtn.classList.remove('live');
    if (streamerSection) streamerSection.classList.remove('live');
    text.textContent = "OFFLINE";
  }
}

// ---- INIT ----
function initLiveStatus() {
  updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
  updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");

  setInterval(() => {
    updateStreamerLive("steggyful1", "live-steggyful1", "live-text-steggyful1");
    updateStreamerLive("ssgvivid", "live-ssgvivid", "live-text-ssgvivid");
  }, 45000);
}

// ====================== AUTO-INIT ON PAGE LOAD ======================
window.addEventListener('load', () => {
  // Performance optimizations first
  preloadCriticalImages();
  setupMobileOptimizations();

  // Use requestIdleCallback for non-critical initialization
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      startRotator();
      initGallery();
      initLiveStatus();
    });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      startRotator();
      initGallery();
      initLiveStatus();
    }, 100);
  }
});