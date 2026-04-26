const fs = require('fs');
const path = require('path');

const imagesDir = path.join(__dirname, 'assets', 'images');
const outFile = path.join(imagesDir, 'gallery.json');
const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const files = fs.readdirSync(imagesDir)
  .filter(file => allowed.includes(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const gallery = files.map(name => `assets/images/${name}`);
fs.writeFileSync(outFile, JSON.stringify(gallery, null, 2) + '\n');
console.log(`Generated ${outFile} with ${gallery.length} images.`);
