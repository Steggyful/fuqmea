// ====================== INITIALIZATION SCRIPT ======================

window.addEventListener('load', () => {
  // Performance optimizations first
  preloadCriticalImages();
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
