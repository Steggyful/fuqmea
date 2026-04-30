// ====================== INITIALIZATION SCRIPT ======================
// Runs after DOM parse (defer). Gallery runs ASAP — requestIdleCallback was
// delaying meme vault paint by up to ~2s on busy/mobile main threads.

(async function initFuqmea() {
  const memes = await loadGalleryList();
  preloadCriticalImages(memes);
  setupMobileOptimizations();

  const galleryEl = document.getElementById('gallery');
  if (galleryEl) {
    await initGallery();
  }

  const rotatorEl = document.getElementById('meme-rotator');
  if (!rotatorEl) return;

  const startRotatorDeferred = () => startRotator();
  if ('requestIdleCallback' in window) {
    requestIdleCallback(startRotatorDeferred, { timeout: 2000 });
  } else {
    setTimeout(startRotatorDeferred, 0);
  }
})();
