/**
 * Leaderboard display-name moderation — keep BANNED_FOLD_SUBSTRINGS in sync with
 * supabase/schema.sql profiles_before_write (fold + substring check).
 */
(function (global) {
  const BANNED_FOLD_SUBSTRINGS = [
    'nigger',
    'nigga',
    'chink',
    'gook',
    'spic',
    'coon',
    'beaner',
    'wetback',
    'raghead',
    'towelhead',
    'honkey',
    'kike',
    'kyke',
    'faggot',
    'fag',
    'tranny',
    'hitler',
    'nazi',
    '1488'
  ];

  function foldDisplayNameForModeration(raw) {
    return String(raw || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '');
  }

  function displayNameFailsPolicy(raw) {
    const folded = foldDisplayNameForModeration(raw);
    if (!folded) return false;
    for (let i = 0; i < BANNED_FOLD_SUBSTRINGS.length; i++) {
      if (folded.includes(BANNED_FOLD_SUBSTRINGS[i])) return true;
    }
    return false;
  }

  global.FuqDisplayNamePolicy = {
    foldDisplayNameForModeration,
    displayNameFailsPolicy,
    BANNED_FOLD_SUBSTRINGS
  };
})(typeof window !== 'undefined' ? window : globalThis);
