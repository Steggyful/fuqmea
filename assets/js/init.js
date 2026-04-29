// ====================== INITIALIZATION SCRIPT ======================

window.addEventListener('load', async () => {
  const memes = await loadGalleryList();
  preloadCriticalImages(memes);
  setupMobileOptimizations();

  // Use requestIdleCallback for non-critical initialization
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      startRotator();
      initGallery();
    });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      startRotator();
      initGallery();
    }, 100);
  }
});
