// Scans assets/images and writes gallery.json — the only meme manifest for
// the site (vault, random meme, homepage rotator). First filename after sort
// is the rotator’s lead image.

const fs = require('fs');
const path = require('path');

const { tagSummaryFromPaths } = require('./tools/extract-categories.js');

const imagesDir = path.join(__dirname, 'assets', 'images');
const outFile = path.join(imagesDir, 'gallery.json');
const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const checkOnly = process.argv.includes('--check');

function buildManifest() {
  const files = fs
    .readdirSync(imagesDir)
    .filter((file) => allowed.includes(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const images = files.map((name) => `assets/images/${name}`);
  return {
    featured: images[0] || null,
    images,
  };
}

function formatTagSummary(images) {
  const counts = tagSummaryFromPaths(images);
  const entries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
  });
  if (!entries.length) return '(no tagged images)';
  return entries.map(([tag, n]) => `${tag} ${n}`).join(', ');
}

function stableStringify(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

function diffSets(prevArr, nextArr) {
  const prev = new Set(prevArr);
  const next = new Set(nextArr);
  const added = [...next].filter((p) => !prev.has(p)).sort();
  const removed = [...prev].filter((p) => !next.has(p)).sort();
  return { added, removed };
}

function main() {
  const payload = buildManifest();
  const images = payload.images;
  const nextJson = stableStringify(payload);

  let prevImages = [];
  let prevHadFile = false;
  try {
    const raw = fs.readFileSync(outFile, 'utf8');
    prevHadFile = true;
    const prev = JSON.parse(raw);
    if (prev && Array.isArray(prev.images)) prevImages = prev.images;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const { added, removed } = diffSets(prevImages, images);
  const tagLine = formatTagSummary(images);

  if (checkOnly) {
    let prevJson = '';
    try {
      prevJson = fs.readFileSync(outFile, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (prevJson === nextJson) {
      console.log(
        `OK: ${outFile} is up to date (${images.length} images).\nTags: ${tagLine}\n+0 new, -0 removed since last manifest`
      );
      process.exit(0);
    }
    console.error(`CHECK FAILED: ${outFile} would change.\n`);
    console.error(`Tags (would be): ${tagLine}`);
    if (added.length) console.error('\n+ Added paths:\n  ' + added.join('\n  '));
    else console.error('\n+ Added paths: (none)');
    if (removed.length) console.error('\n- Removed paths:\n  ' + removed.join('\n  '));
    else console.error('\n- Removed paths: (none)');
    console.error('\n--- diff (first ~80 lines) ---');
    const lines = nextJson.split('\n');
    console.error(lines.slice(0, 80).join('\n'));
    if (lines.length > 80) console.error(`... (${lines.length} lines total)`);
    process.exit(1);
  }

  fs.writeFileSync(outFile, nextJson);
  const delta =
    prevHadFile && (added.length || removed.length)
      ? `\n+${added.length} new, -${removed.length} removed since last manifest`
      : prevHadFile
        ? '\n+0 new, -0 removed since last manifest'
        : '';

  console.log(`Generated ${outFile} with ${images.length} images.\nTags: ${tagLine}${delta}`);
}

main();
