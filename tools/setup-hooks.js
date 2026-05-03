/**
 * One-time: `npm run setup-hooks` — points this repo at `.githooks` (per-machine).
 */
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('Set core.hooksPath to .githooks in this repo (pre-push will refresh the gallery manifest).');
} catch (e) {
  console.error('Failed: run this from the repo root with git available in PATH.');
  process.exit(1);
}
