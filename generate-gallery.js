// Scans assets/images and writes gallery.json — the only meme manifest for
// the site (vault, random meme, homepage rotator). First filename after sort
// is the rotator’s lead image.

const fs = require('fs');
const path = require('path');

const imagesDir = path.join(__dirname, 'assets', 'images');
const outFile = path.join(imagesDir, 'gallery.json');
const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const files = fs.readdirSync(imagesDir)
  .filter(file => allowed.includes(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const images = files.map((name) => `assets/images/${name}`);
const payload = {
  featured: images[0] || null,
  images
};
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');
console.log(`Generated ${outFile} with ${images.length} images.`);
