// Headless difficulty sim: OG Flappy Bird (288x512 @30fps decompiled constants)
// vs FiFi Bird (360x520 @60fps). Same imperfect reactive bot plays both; if the
// score distributions match, the difficulty matches.

function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// cfg: fps, gravity, flap, vyMax, speed, pipeW, gap, spawnDist, birdR, birdX,
//      playH, w, gapYMin, gapYMax, inset, startY
// bot: reactionMs (mean decision interval), aimSigmaPx (per-pipe aim error, in cfg's px space)
function playRun(cfg, bot, rng) {
  let birdY = cfg.startY, birdVy = cfg.flap; // run starts with a flap
  let pipes = [{ x: cfg.w + 60, gapY: gapY(), passed: false }];
  let score = 0;
  let frame = 0;
  let nextDecision = 0;
  let aimErr = gaussian(rng) * bot.aimSigmaPx;
  const reactFrames = Math.max(1, (bot.reactionMs / 1000) * cfg.fps);
  const maxFrames = cfg.fps * 60 * 5; // 5 min cap

  function gapY() {
    return cfg.gapYMin + rng() * (cfg.gapYMax - cfg.gapYMin);
  }

  while (frame < maxFrames) {
    frame++;

    // Bot: throttled reactive controller aiming for the next gap centre
    if (frame >= nextDecision) {
      nextDecision = frame + reactFrames * (0.7 + 0.6 * rng());
      let target = null;
      for (const p of pipes) {
        if (p.x + cfg.pipeW > cfg.birdX - cfg.birdR) { target = p; break; }
      }
      const ty = (target ? target.gapY : cfg.playH * 0.45) + aimErr;
      // Flap when sinking below the aim point (classic bang-bang control)
      if (birdY > ty && birdVy > 0) {
        birdVy = cfg.flap;
      }
    }

    // Physics (identical structure to the game loop, dtScale = 1)
    birdVy += cfg.gravity;
    if (birdVy > cfg.vyMax) birdVy = cfg.vyMax;
    birdY += birdVy;
    if (birdY < cfg.birdR) { birdY = cfg.birdR; if (birdVy < 0) birdVy = 0; }

    for (let i = pipes.length - 1; i >= 0; i--) {
      pipes[i].x -= cfg.speed;
      const p = pipes[i];
      if (!p.passed && p.x + cfg.pipeW / 2 < cfg.birdX) {
        p.passed = true;
        score++;
        aimErr = gaussian(rng) * bot.aimSigmaPx; // re-aim on each new pipe
      }
      if (p.x + cfg.pipeW < -20) pipes.splice(i, 1);
    }
    const last = pipes[pipes.length - 1];
    if (!last || last.x < cfg.w - cfg.spawnDist) pipes.push({ x: last ? last.x + cfg.spawnDist : cfg.w + 60, gapY: gapY(), passed: false });

    // Collision
    if (birdY + cfg.birdR >= cfg.playH) return score;
    for (const p of pipes) {
      const rx = p.x + cfg.inset;
      const rw = cfg.pipeW - cfg.inset * 2;
      if (rw <= 0) continue;
      const topH = p.gapY - cfg.gap / 2;
      const botY = p.gapY + cfg.gap / 2;
      if (circleHitsRect(cfg.birdX, birdY, cfg.birdR, rx, 0, rw, topH)) return score;
      if (circleHitsRect(cfg.birdX, birdY, cfg.birdR, rx, botY, rw, cfg.playH - botY)) return score;
    }
  }
  return score;
}

function stats(scores) {
  const s = [...scores].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean: +mean.toFixed(2), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1] };
}

function runBatch(name, cfg, bot, n = 3000, seed = 1234) {
  const rng = mulberry32(seed);
  const scores = [];
  for (let i = 0; i < n; i++) scores.push(playRun(cfg, bot, rng));
  console.log(name.padEnd(26), JSON.stringify(stats(scores)));
}

// ── OG Flappy Bird: decompiled constants, 288x512 @30fps ──
// gravity 1 px/f^2, flap -9 px/f, max fall 10 px/f, pipe speed 4 px/f,
// pipe width 52, gap 100, spacing ~172, play height ~404 (base at 0.79*512),
// bird hitbox ~24px tall -> r12, bird x ~57.
const OG = {
  fps: 30, gravity: 1, flap: -9, vyMax: 10, speed: 4,
  pipeW: 52, gap: 100, spawnDist: 172, birdR: 12, birdX: 57,
  playH: 404, w: 288, gapYMin: 131, gapYMax: 252, inset: 0,
  startY: 404 * 0.46,
};

// ── FiFi Bird: read whatever constants are passed via env or use defaults ──
function fifi(over = {}) {
  const GAP = over.gap ?? 124;
  const PLAY_H = 448;
  return {
    fps: 60, gravity: over.gravity ?? 0.28, flap: over.flap ?? -5.2,
    vyMax: over.vyMax ?? 10.5, speed: over.speed ?? 2.5,
    pipeW: 64, gap: GAP, spawnDist: over.spawnDist ?? 210,
    birdR: over.birdR ?? 15, birdX: 96, playH: PLAY_H, w: 360,
    gapYMin: (over.gapYMinPad ?? 66) + GAP / 2,
    gapYMax: PLAY_H - (over.gapYMaxPad ?? 46) - GAP / 2,
    inset: over.inset ?? 8,
    startY: PLAY_H * 0.46,
  };
}

// Bot skill levels — aim error scales with world width so it's fair across sizes.
const SKILLS = [
  { name: 'casual', reactionMs: 160, aimFrac: 0.055 },
  { name: 'decent', reactionMs: 120, aimFrac: 0.035 },
  { name: 'good  ', reactionMs: 90,  aimFrac: 0.020 },
];

// True OG scaling to 360x448@60fps: speed 2.5, gravity 0.28, flap -5.0,
// vyMax 5.6, gap 112, spawn 215 (see derivation in fifi-bird.js comments).
const V23 = { gravity: 0.35, flap: -5.7, vyMax: 9, gap: 104, spawnDist: 215, inset: 2 };
const variants = {
  'OG (benchmark)': null, // handled specially
  'v2.3 (still too easy)': fifi({ ...V23, speed: 2.65 }),
  'A r18': fifi({ ...V23, speed: 2.65, birdR: 18 }),
  'B r18 spawn190': fifi({ ...V23, speed: 2.65, birdR: 18, spawnDist: 190 }),
  'C r18 spawn180': fifi({ ...V23, speed: 2.65, birdR: 18, spawnDist: 180 }),
  'D r20 spawn190': fifi({ ...V23, speed: 2.65, birdR: 20, spawnDist: 190 }),
};

for (const skill of SKILLS) {
  console.log(`\n=== skill: ${skill.name} (reaction ${skill.reactionMs}ms, aim ±${skill.aimFrac * 100}% of width) ===`);
  for (const [name, cfg] of Object.entries(variants)) {
    const c = cfg ?? OG;
    const bot = { reactionMs: skill.reactionMs, aimSigmaPx: skill.aimFrac * c.w * (c.w === 288 ? 1 : 1) };
    runBatch(name, c, bot);
  }
}
