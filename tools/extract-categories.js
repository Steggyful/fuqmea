/**
 * Shared tag/category rules for meme filenames — used by Node (generate-gallery)
 * and the browser (script tag loads this UMD build; sets window.FuqmeaCategories).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FuqmeaCategories = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Strip alphabet-sort filename prefixes like "e " or "zz " before category labels.
   * Prefix letters must be lowercase so real tags like "Toy Story" are not mangled.
   */
  function normalizeCategoryLabel(label) {
    return label.replace(/^[a-z]{1,3}\s+(?=[A-Za-z0-9])/, '').trim();
  }

  /** Tags from `Tag - Title.ext` or `Tag - Subtag - Title.ext` (all segments before the final title) */
  function extractCategories(src) {
    const name = src.split('/').pop().replace(/\.[^.]+$/, '');
    const parts = name.split(' - ');
    if (parts.length < 2) return [];
    const rawTags = parts.slice(0, -1).map((p) => normalizeCategoryLabel(p.trim())).filter(Boolean);
    return [...new Set(rawTags)];
  }

  /** Count images per top-level tag (for generator console summary). */
  function tagSummaryFromPaths(imagePaths) {
    const counts = new Map();
    for (const src of imagePaths) {
      for (const tag of extractCategories(src)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return counts;
  }

  return {
    normalizeCategoryLabel,
    extractCategories,
    tagSummaryFromPaths,
  };
});
