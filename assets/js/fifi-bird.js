// FiFi Bird — polished arcade edition. No FUQ, just vibes.

(function () {
  'use strict';

  // ─── TUNING ──────────────────────────────────────────────────────────────────
  const W              = 360;
  const H              = 520;
  const GROUND_H       = 72;      // scrolling ground strip at the bottom
  const PLAY_H         = H - GROUND_H;
  // OG-style feel: short snappy hop (apex in ~0.28s), high terminal velocity so
  // an uncorrected fall is a fast, punishing plummet, and a tight gap with a
  // near-honest hitbox. Keep VY_MAX high — capping fall speed low makes rhythm
  // tapping trivially easy no matter how tight the gap is (playtested).
  // Note: OG constants scaled 1:1 play too easy on desktop (mouse + high-Hz
  // display vs 2013 touchscreen latency), so gap/pace are tuned tighter than
  // the paper math — iterated against real runs, not just the bot sim.
  const TUNING_TAG     = 'v2.4';  // bump when physics change; drawn on canvas
  const GRAVITY        = 0.35;
  const FLAP           = -5.7;
  const VY_MAX         = 9;
  const PIPE_W         = 64;
  const GAP            = 104;
  const PIPE_SPAWN     = 190;
  const SPEED_BASE     = 2.65;    // constant — OG never speeds up
  // Hitbox sized to the bird's visual body (drawn ~38px wide at sprite height
  // 72) — an undersized circle lets the sprite visibly clip pipes and live,
  // which plays way easier than it looks.
  const BIRD_R         = 18;
  const BIRD_X         = 96;
  const BIRD_SPRITE_FRAMES = 4;
  const BIRD_SPRITE_PATH   = 'assets/images/FiFi Bird/fifi_sprite.png';
  const BG_SPRITE_PATH     = 'assets/images/FiFi Bird/fifi_bg.jpg';
  const PIPE_SPRITE_PATH   = 'assets/images/FiFi Bird/fifi_pipe.png';
  const SKIN_DIR           = 'assets/images/FiFi Bird/skins/';
  const ARENA_DIR          = 'assets/images/FiFi Bird/arenas/';
  const COSMETIC_KEY       = 'fuq.fifiBird.cosmetics';
  const TARGET_SPRITE_HEIGHT = 72;
  // Source frame is 256x1024 but the bird (with wings extended) only fills the
  // middle ~48% of it — these crop the empty padding so TARGET_SPRITE_HEIGHT
  // means the actual visible bird height, not the frame box height.
  const SPRITE_CROP_Y_FRAC = 0.27;
  const SPRITE_CROP_H_FRAC = 0.48;
  // Wings play a short burst on each tap, then settle back to the glide frame.
  const WING_FRAME_MS  = 85;
  const FLAP_BURST_SEQUENCE = [1, 2, 3, 0];
  const BG_PARALLAX    = 0.25;
  const PIPE_COLLISION_INSET = 2;


  // ─── COSMETICS ──────────────────────────────────────────────────────────────
  // Unlock gate is lifetime best run (gaps). ?fifiUnlockAll=1 unlocks everything.
  const BIRD_SKINS = [
    { id: 'original_blue', label: 'OG Blue',   need: 0,   swatch: '#1860c0', bird: BIRD_SPRITE_PATH, pipe: PIPE_SPRITE_PATH },
    { id: 'fuqmea_lime',   label: 'Fuqmea',    need: 5,   swatch: '#39ff14', bird: SKIN_DIR + 'fifi_sprite_fuqmea_lime.png', pipe: SKIN_DIR + 'fifi_pipe_fuqmea_lime.png' },
    { id: 'crimson',       label: 'Crimson',   need: 10,  swatch: '#c41414' },
    { id: 'sunset_orange', label: 'Sunset',    need: 15,  swatch: '#e06010' },
    { id: 'gold',          label: 'Gold',      need: 20,  swatch: '#d4a017' },
    { id: 'fuqmea_hazard', label: 'Hazard',    need: 25,  swatch: '#ffff00', bird: SKIN_DIR + 'fifi_sprite_fuqmea_hazard.png', pipe: SKIN_DIR + 'fifi_pipe_fuqmea_hazard.png' },
    { id: 'teal',          label: 'Teal',      need: 30,  swatch: '#1aa8a8' },
    { id: 'hot_pink',      label: 'Hot Pink',  need: 35,  swatch: '#e02080' },
    { id: 'ice',           label: 'Ice',       need: 40,  swatch: '#7ec8e0' },
    { id: 'neon',          label: 'Neon',      need: 50,  swatch: '#00e8ff' },
    { id: 'midnight',      label: 'Midnight',  need: 60,  swatch: '#3a1a80' },
    { id: 'solar',         label: 'Solar',     need: 70,  swatch: '#f0c000' },
    { id: 'pearl',         label: 'Pearl',     need: 85,  swatch: '#d0d8e0' },
    { id: 'obsidian',      label: 'Obsidian',  need: 100, swatch: '#1a2430' },
    { id: 'lime',          label: 'Lime',      need: 12,  swatch: '#32c428' },
    { id: 'mint',          label: 'Mint',      need: 18,  swatch: '#3ecf9a' },
    { id: 'forest',        label: 'Forest',    need: 22,  swatch: '#1e7a28' },
    { id: 'royal_purple',  label: 'Purple',    need: 45,  swatch: '#7a28c8' },
    { id: 'magenta',       label: 'Magenta',   need: 48,  swatch: '#c02080' },
    { id: 'lavender',      label: 'Lavender',  need: 55,  swatch: '#b070d0' },
    { id: 'copper',        label: 'Copper',    need: 65,  swatch: '#b06020' },
    { id: 'slate',         label: 'Slate',     need: 80,  swatch: '#6a7380' }
  ];
  const ARENAS = [
    { id: 'meadow',         label: 'Meadow',    need: 0,   src: BG_SPRITE_PATH },
    { id: 'sunset_city',    label: 'Sunset',    need: 15,  src: ARENA_DIR + 'sunset_city.jpg' },
    { id: 'terminal_city',  label: 'Terminal',  need: 25,  src: ARENA_DIR + 'terminal_city.jpg' },
    { id: 'night_city',     label: 'Night',     need: 35,  src: ARENA_DIR + 'night_city.jpg' },
    { id: 'neon_rooftop',   label: 'Rooftop',   need: 50,  src: ARENA_DIR + 'neon_rooftop.jpg' },
    { id: 'toxic_meadow',   label: 'Toxic',     need: 65,  src: ARENA_DIR + 'toxic_meadow.jpg' },
    { id: 'starfield',      label: 'Starfield', need: 80,  src: ARENA_DIR + 'starfield_poster.jpg' },
    { id: 'spaceship',      label: 'Ship',      need: 100, src: ARENA_DIR + 'spaceship.jpg' },
    { id: 'spaceship_lime', label: 'Lime Ship', need: 120, src: ARENA_DIR + 'spaceship_lime.jpg' }
  ];

  let unlockAll = false;
  try { unlockAll = /(?:\?|&)fifiUnlockAll=1(?:&|$)/.test(window.location.search || ''); } catch (_) {}

  let selectedSkinId  = 'original_blue';
  let selectedArenaId = 'meadow';
  let birdLoadGen = 0, bgLoadGen = 0, pipeLoadGen = 0;

  function skinById(id) {
    for (let i = 0; i < BIRD_SKINS.length; i++) if (BIRD_SKINS[i].id === id) return BIRD_SKINS[i];
    return BIRD_SKINS[0];
  }
  function arenaById(id) {
    for (let i = 0; i < ARENAS.length; i++) if (ARENAS[i].id === id) return ARENAS[i];
    return ARENAS[0];
  }
  function skinPaths(skin) {
    return {
      bird: skin.bird || (SKIN_DIR + 'fifi_sprite_' + skin.id + '.png'),
      pipe: skin.pipe || (SKIN_DIR + 'fifi_pipe_' + skin.id + '.png')
    };
  }
  function cosmeticsUnlocked() {
    return unlockAll || bestScore;
  }
  function isUnlocked(need) {
    return unlockAll || bestScore >= need;
  }
  function loadCosmetics() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(COSMETIC_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.skin === 'string' && skinById(parsed.skin).id === parsed.skin) selectedSkinId = parsed.skin;
      if (parsed && typeof parsed.arena === 'string' && arenaById(parsed.arena).id === parsed.arena) selectedArenaId = parsed.arena;
    } catch (_) {}
  }
  function saveCosmetics() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(COSMETIC_KEY, JSON.stringify({ skin: selectedSkinId, arena: selectedArenaId }));
      }
    } catch (_) {}
  }
  function clampSelectionToUnlocks() {
    if (!isUnlocked(skinById(selectedSkinId).need)) selectedSkinId = 'original_blue';
    if (!isUnlocked(arenaById(selectedArenaId).need)) selectedArenaId = 'meadow';
  }

  // ─── STATES ──────────────────────────────────────────────────────────────────
  const S_IDLE    = 0;   // title screen
  const S_READY   = 1;   // "GET READY" — bird bobs at play position, first tap starts physics
  const S_PLAYING = 2;
  const S_DYING   = 3;
  const S_DEAD    = 4;

  // ─── PIPE SPRITE SLICES ───────────────────────────────────────────────────────
  const PIPE_SLICE = {
    topBase:   { sx: 447, sy: 973, sw: 367, sh: 269 },
    topMiddle: { sx: 498, sy: 0,   sw: 266, sh: 973 },
    botBase:   { sx: 16,  sy: 11,  sw: 370, sh: 269 },
    botMiddle: { sx: 69,  sy: 280, sw: 264, sh: 968 }
  };
  const PIPE_BODY_SCALE_TOP = PIPE_W / PIPE_SLICE.topMiddle.sw;
  const PIPE_BODY_SCALE_BOT = PIPE_W / PIPE_SLICE.botMiddle.sw;
  const TOP_BASE_DW = PIPE_SLICE.topBase.sw * PIPE_BODY_SCALE_TOP;
  const TOP_BASE_DH = PIPE_SLICE.topBase.sh * PIPE_BODY_SCALE_TOP;
  const TOP_BASE_DX = (PIPE_W - TOP_BASE_DW) / 2;
  const BOT_BASE_DW = PIPE_SLICE.botBase.sw * PIPE_BODY_SCALE_BOT;
  const BOT_BASE_DH = PIPE_SLICE.botBase.sh * PIPE_BODY_SCALE_BOT;
  const BOT_BASE_DX = (PIPE_W - BOT_BASE_DW) / 2;

  // ─── EXTERNAL API ─────────────────────────────────────────────────────────────
  let pushHistory     = null;
  let loadWallet      = null;
  let arcadeNoteRound = null;
  let wired           = false;

  // ─── CANVAS ───────────────────────────────────────────────────────────────────
  let canvas, ctx;
  let dpr = 1;
  let reduceMotion = false;
  let speedMul     = 1;

  // ─── ASSETS ───────────────────────────────────────────────────────────────────
  let birdImg = null, birdSpriteOk = false;
  let bgImg   = null, bgImgOk      = false;
  let pipeImg = null, pipeImgOk    = false;

  // ─── GAME STATE ───────────────────────────────────────────────────────────────
  let gameState  = S_IDLE;
  let birdY      = PLAY_H * 0.46;
  let birdVy     = 0;
  let birdAngle  = 0;
  let pipes      = [];
  let score      = 0;
  let bestScore  = 0;
  let bgScrollX  = 0;
  let groundScrollX = 0;
  let lastTs     = 0;
  let raf        = 0;
  let wingBurstStart = null;
  let shakeAmt   = 0;
  let flashAmt   = 0;
  let deadTs     = 0;    // RAF timestamp when S_DEAD was entered
  let deathWasNewBest = false;

  // ─── SERVER SESSION ───────────────────────────────────────────────────────────
  let runSessionId   = null;
  let runStartedPerf = null;
  let runRng         = null;
  let runStartBusy   = false;

  const els = {};
  function $(id) { return document.getElementById(id); }

  // ─── AUDIO ───────────────────────────────────────────────────────────────────
  let audioCtx = null;
  const SOUND_PREF_KEY  = 'fuq.fifiBird.sound';
  const FLAP_SOUND_PATH   = 'assets/audio/fifi_flap_sound.mp3';
  const IMPACT_SOUND_PATH = 'assets/audio/fifi_impact_sound.mp3';
  const FLAP_GAIN   = 0.55;
  const IMPACT_GAIN = 0.7;
  let soundOn = true;
  try {
    const stored = window.localStorage && window.localStorage.getItem(SOUND_PREF_KEY);
    if (stored === '0') soundOn = false;
  } catch (_) {}

  let flapBuffer = null,   flapBufferLoading   = false, flapBufferFailed   = false;
  let impactBuffer = null, impactBufferLoading = false, impactBufferFailed = false;

  function getAudio() {
    if (audioCtx) return audioCtx;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    return audioCtx;
  }

  function decodeArrayBuffer(ac, ab) {
    return new Promise((resolve, reject) => {
      try {
        const p = ac.decodeAudioData(ab, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  function loadSoundBuffer(ac, path) {
    return fetch(path)
      .then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error('fetch failed')))
      .then((ab) => decodeArrayBuffer(ac, ab));
  }

  function ensureFlapBuffer(ac) {
    if (flapBuffer || flapBufferLoading || flapBufferFailed) return;
    flapBufferLoading = true;
    loadSoundBuffer(ac, FLAP_SOUND_PATH)
      .then((buf) => { flapBuffer = buf; })
      .catch(() => { flapBufferFailed = true; })
      .then(() => { flapBufferLoading = false; });
  }

  function ensureImpactBuffer(ac) {
    if (impactBuffer || impactBufferLoading || impactBufferFailed) return;
    impactBufferLoading = true;
    loadSoundBuffer(ac, IMPACT_SOUND_PATH)
      .then((buf) => { impactBuffer = buf; })
      .catch(() => { impactBufferFailed = true; })
      .then(() => { impactBufferLoading = false; });
  }

  function playSampleBuffer(ac, buf, gainValue) {
    const src = ac.createBufferSource();
    const g = ac.createGain();
    src.buffer = buf;
    g.gain.value = gainValue;
    src.connect(g); g.connect(ac.destination);
    src.start(ac.currentTime);
  }

  function playFlap() {
    if (reduceMotion || !soundOn) return;
    const ac = getAudio(); if (!ac) return;
    try { if (ac.state === 'suspended') ac.resume().catch(() => {}); } catch (_) {}
    ensureFlapBuffer(ac);
    if (flapBuffer) {
      try { playSampleBuffer(ac, flapBuffer, FLAP_GAIN); return; } catch (_) {}
    }
    try {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(310, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(190, ac.currentTime + 0.09);
      g.gain.setValueAtTime(0.13, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
      osc.connect(g); g.connect(ac.destination);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.12);
    } catch (_) {}
  }

  function playScore() {
    if (reduceMotion || !soundOn) return;
    const ac = getAudio(); if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      [660, 880].forEach((freq, i) => {
        const osc = ac.createOscillator(), g = ac.createGain();
        const t0 = ac.currentTime + i * 0.08;
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.11, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.17);
        osc.connect(g); g.connect(ac.destination);
        osc.start(t0); osc.stop(t0 + 0.19);
      });
    } catch (_) {}
  }

  function playDeath() {
    if (reduceMotion || !soundOn) return;
    const ac = getAudio(); if (!ac) return;
    try { if (ac.state === 'suspended') ac.resume().catch(() => {}); } catch (_) {}
    ensureImpactBuffer(ac);
    if (impactBuffer) {
      try { playSampleBuffer(ac, impactBuffer, IMPACT_GAIN); return; } catch (_) {}
    }
    try {
      const dur = 0.3;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.75;
      }
      const src = ac.createBufferSource(), filt = ac.createBiquadFilter(), g = ac.createGain();
      filt.type = 'lowpass'; filt.frequency.value = 700;
      g.gain.setValueAtTime(0.45, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      src.buffer = buf;
      src.connect(filt); filt.connect(g); g.connect(ac.destination);
      src.start(ac.currentTime);
    } catch (_) {}
  }

  // ─── RNG ──────────────────────────────────────────────────────────────────────
  function mulberry32(a) {
    let state = a >>> 0;
    return function rnd() {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFromServerSeed(seed) {
    try {
      if (typeof seed === 'bigint') {
        const lo = Number(seed & 0xffffffffn);
        const hi = Number((seed >> 32n) & 0xffffffffn);
        return mulberry32((lo ^ hi) >>> 0);
      }
      if (typeof seed === 'string' && /^-?\d+$/.test(seed)) return rngFromServerSeed(BigInt(seed));
      const n = Number(seed);
      if (!Number.isFinite(n)) return null;
      return mulberry32(Math.floor(n) >>> 0);
    } catch (_) { return null; }
  }

  // ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
  function canvasDprCap() {
    try {
      if (window.matchMedia && window.matchMedia('(max-width: 520px)').matches) return 1.35;
    } catch (_) {}
    return 2;
  }

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(canvasDprCap(), window.devicePixelRatio || 1);
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (typeof ctx.imageSmoothingQuality === 'string') ctx.imageSmoothingQuality = 'high';
    const fsActive = pseudoFsActive || !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (fsActive) {
      // Let CSS drive sizing in fullscreen so the canvas fits the viewport height.
      canvas.style.height = '';
    } else {
      const cw = rect.width || canvas.clientWidth || W;
      canvas.style.height = `${(cw * H) / W}px`;
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────────
  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX, dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  function hitTest() {
    // OG rules: the ceiling never kills you (the bird just can't leave the top);
    // the ground and pipes do.
    if (birdY + BIRD_R >= PLAY_H) return true;
    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      const rx = p.x + PIPE_COLLISION_INSET;
      const rw = PIPE_W - 2 * PIPE_COLLISION_INSET;
      if (BIRD_X + BIRD_R <= rx || BIRD_X - BIRD_R >= rx + rw) continue;
      const topH = p.gapY - GAP / 2;
      const botY = p.gapY + GAP / 2;
      if (circleHitsRect(BIRD_X, birdY, BIRD_R, rx, 0, rw, topH)) return true;
      if (circleHitsRect(BIRD_X, birdY, BIRD_R, rx, botY, rw, PLAY_H - botY)) return true;
    }
    return false;
  }

  function spawnPipe() {
    const minGapY = 66 + GAP / 2;
    const maxGapY = PLAY_H - 46 - GAP / 2;
    const rnd = runRng ? runRng() : Math.random();
    const gapY = minGapY + rnd * (maxGapY - minGapY);
    let x = W + 60;
    if (pipes.length) x = pipes[pipes.length - 1].x + PIPE_SPAWN;
    pipes.push({ x, gapY, passed: false });
  }

  function triggerWingBurst() {
    wingBurstStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function wingFrameIndex() {
    if (wingBurstStart == null) return 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const idx = Math.floor((now - wingBurstStart) / WING_FRAME_MS);
    if (idx >= FLAP_BURST_SEQUENCE.length) { wingBurstStart = null; return 0; }
    return FLAP_BURST_SEQUENCE[idx];
  }

  // ─── DRAWING HELPERS ──────────────────────────────────────────────────────────
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawBackground() {
    if (bgImgOk && bgImg && bgImg.naturalWidth > 0) {
      const tileW  = W;
      const slot   = Math.floor(bgScrollX / tileW);
      const offset = bgScrollX - slot * tileW;
      let xPos = Math.floor(-offset), mirrored = (slot & 1) !== 0;
      while (xPos < W + 1) {
        if (mirrored) {
          ctx.save();
          ctx.translate(xPos + tileW, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(bgImg, 0, 0, tileW, H);
          ctx.restore();
        } else {
          ctx.drawImage(bgImg, xPos, 0, tileW, H);
        }
        xPos += tileW;
        mirrored = !mirrored;
      }
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0f1812'); g.addColorStop(1, '#050806');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function drawPipe(p) {
    if (!p) return;
    const topH    = Math.max(0, p.gapY - GAP / 2);
    const botY    = p.gapY + GAP / 2;
    const bottomH = Math.max(0, PLAY_H - botY);

    if (!pipeImgOk || !pipeImg) {
      ctx.fillStyle = '#1166ff';
      ctx.fillRect(p.x, 0, PIPE_W, topH);
      ctx.fillRect(p.x, botY, PIPE_W, bottomH);
      return;
    }

    const scaleT = PIPE_BODY_SCALE_TOP, scaleB = PIPE_BODY_SCALE_BOT;
    const TB = PIPE_SLICE.topBase, TM = PIPE_SLICE.topMiddle;
    const BB = PIPE_SLICE.botBase, BM = PIPE_SLICE.botMiddle;

    if (topH > 0) {
      const baseH = Math.min(TOP_BASE_DH, topH);
      const bodyH = topH - baseH;
      if (baseH > 0) {
        const srcH = Math.min(TB.sh, baseH / scaleT);
        const srcY = TB.sy + TB.sh - srcH;
        ctx.drawImage(pipeImg, TB.sx, srcY, TB.sw, srcH, p.x + TOP_BASE_DX, topH - baseH, TOP_BASE_DW, baseH);
      }
      let yBottom = topH - baseH, remain = bodyH;
      const tileHT = TM.sh * scaleT;
      let pngYBelow = TM.sy + TM.sh;
      while (remain > 0) {
        const dh = Math.min(tileHT, remain);
        const srcH = Math.min(TM.sh, dh / scaleT);
        pngYBelow -= srcH; yBottom -= dh;
        ctx.drawImage(pipeImg, TM.sx, pngYBelow, TM.sw, srcH, p.x, yBottom, PIPE_W, dh);
        remain -= dh;
      }
    }

    if (bottomH > 0) {
      const baseH = Math.min(BOT_BASE_DH, bottomH);
      const bodyH = bottomH - baseH;
      if (baseH > 0) {
        const srcH = Math.min(BB.sh, baseH / scaleB);
        ctx.drawImage(pipeImg, BB.sx, BB.sy, BB.sw, srcH, p.x + BOT_BASE_DX, botY, BOT_BASE_DW, baseH);
      }
      let y = botY + baseH, remain = bodyH;
      const tileHB = BM.sh * scaleB;
      let pngYTop = BM.sy;
      while (remain > 0) {
        const dh = Math.min(tileHB, remain);
        const srcH = Math.min(BM.sh, dh / scaleB);
        ctx.drawImage(pipeImg, BM.sx, pngYTop, BM.sw, srcH, p.x, y, PIPE_W, dh);
        pngYTop += srcH; y += dh; remain -= dh;
      }
    }
  }

  // Scrolling ground strip — the iconic Flappy Bird floor, restyled for the
  // site's neon theme: lime turf edge, hatched shadow band, dark dirt body.
  function drawGround() {
    const y = PLAY_H;
    ctx.fillStyle = '#0b1408';
    ctx.fillRect(0, y, W, GROUND_H);

    // Turf band
    ctx.fillStyle = '#173a10';
    ctx.fillRect(0, y, W, 22);
    ctx.fillStyle = '#39ff14';
    ctx.fillRect(0, y, W, 3);

    // Diagonal hatch that scrolls with world speed
    const stride = 24;
    const off = ((groundScrollX % stride) + stride) % stride;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y + 3, W, 19);
    ctx.clip();
    ctx.strokeStyle = 'rgba(57,255,20,0.4)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let x = -stride * 2 - off; x < W + stride; x += stride) {
      ctx.moveTo(x, y + 24);
      ctx.lineTo(x + 14, y + 1);
    }
    ctx.stroke();
    ctx.restore();

    // Dirt body speckle rows
    ctx.fillStyle = 'rgba(57,255,20,0.08)';
    ctx.fillRect(0, y + 26, W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + 22, W, 4);
  }

  function drawBirdAt(x, y, now) {
    // OG rotation: nose snaps up on a flap and holds through the top of the
    // arc, then the bird pitches down hard toward 90° as it dives.
    if (gameState === S_PLAYING) {
      if (birdVy < 1.8) {
        birdAngle += (-0.42 - birdAngle) * 0.38;
      } else {
        birdAngle = Math.min(Math.PI * 0.5, birdAngle + 0.055);
      }
    } else if (gameState === S_DYING) {
      birdAngle = Math.min(Math.PI * 0.5, birdAngle + 0.18);
    } else {
      birdAngle += (0 - birdAngle) * 0.1;
    }

    // Wings burst on each tap during play; on the title / ready / game-over
    // screens they slowly alternate, and they freeze during the death fall.
    let frameIdx = 0;
    if (gameState === S_PLAYING) {
      frameIdx = wingFrameIndex();
    } else if (gameState === S_IDLE || gameState === S_READY || gameState === S_DEAD) {
      frameIdx = Math.floor(now / 420) % 2 === 0 ? 0 : 2;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(birdAngle);

    if (birdSpriteOk && birdImg && birdImg.naturalWidth > 0) {
      const fw = birdImg.naturalWidth / BIRD_SPRITE_FRAMES;
      const fh = birdImg.naturalHeight;
      const sy = fh * SPRITE_CROP_Y_FRAC;
      const sh = fh * SPRITE_CROP_H_FRAC;
      const scale = TARGET_SPRITE_HEIGHT / sh;
      const dw = fw * scale, dh = sh * scale;
      ctx.drawImage(birdImg, frameIdx * fw, sy, fw, sh, -dw * 0.5, -dh * 0.5, dw, dh);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
      ctx.fillStyle = '#39ff14'; ctx.fill();
    }
    ctx.restore();
  }

  // Big plain counter at the top, exactly like the OG — no pops, no "+1".
  function drawScoreHud() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px system-ui, "Arial Black", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(String(score), W / 2, 68);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), W / 2, 68);
    ctx.restore();
  }

  function drawStartScreen(now) {
    // Overlay
    ctx.fillStyle = 'rgba(0,0,0,0.44)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.textAlign = 'center';

    // Title
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur  = 26;
    ctx.font = 'bold 58px system-ui, "Arial Black", sans-serif';
    ctx.fillStyle = '#39ff14';
    ctx.fillText('FiFi', W / 2, H * 0.14);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('BIRD', W / 2, H * 0.235);
    ctx.shadowBlur = 0;

    // Tagline
    ctx.font = 'italic 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText('no FUQ · just vibes', W / 2, H * 0.305);

    // Best score chip
    if (bestScore > 0) {
      const chipW = 126, chipH = 38, cx = W / 2, cy = H * 0.625;
      roundRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH, 10);
      ctx.fillStyle = 'rgba(57,255,20,0.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(57,255,20,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('BEST', cx, cy - 5);
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = '#39ff14';
      ctx.fillText(String(bestScore), cx, cy + 13);
    }

    // Tap to start (pulsing)
    const pulse = 0.65 + 0.35 * Math.sin(now / 550);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 8;
    ctx.fillText('TAP TO START', W / 2, H * 0.79);
    ctx.shadowBlur = 0;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = `rgba(200,200,200,${pulse * 0.65})`;
    ctx.fillText('or press SPACE', W / 2, H * 0.845);

    ctx.restore();
  }

  // OG "GET READY" — bird bobs in place, world scrolls, first tap starts.
  function drawReadyScreen(now) {
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font = 'bold 34px system-ui, "Arial Black", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText('GET READY', W / 2, H * 0.2);
    ctx.fillStyle = '#39ff14';
    ctx.shadowColor = 'rgba(57,255,20,0.5)';
    ctx.shadowBlur = 14;
    ctx.fillText('GET READY', W / 2, H * 0.2);
    ctx.shadowBlur = 0;

    // Pulsing tap hint: hand-drawn tap circle with up chevrons
    const pulse = 0.55 + 0.45 * Math.sin(now / 420);
    const cx = W / 2, cy = H * 0.46;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 26); ctx.lineTo(cx, cy - 36); ctx.lineTo(cx + 9, cy - 26);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`;
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 6;
    ctx.fillText('TAP TO FLAP', W / 2, H * 0.56);
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  // OG medal tiers: bronze 10, silver 20, gold 30, platinum 40.
  function medalForScore(s) {
    if (s >= 40) return { label: 'PLAT',   main: '#d9f5ff', rim: '#8fd4e8' };
    if (s >= 30) return { label: 'GOLD',   main: '#ffd94d', rim: '#c9a227' };
    if (s >= 20) return { label: 'SILVER', main: '#d7d7d7', rim: '#9b9b9b' };
    if (s >= 10) return { label: 'BRONZE', main: '#e0a86c', rim: '#a5713d' };
    return null;
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function drawGameOverScreen(now) {
    const elapsed = now - deadTs;
    ctx.fillStyle = 'rgba(0,0,0,0.56)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.textAlign = 'center';

    // 1) GAME OVER drops in first
    const tTitle = Math.min(1, elapsed / 260);
    const titleY = H * 0.155 - (1 - easeOutBack(tTitle)) * 46;
    ctx.globalAlpha = Math.min(1, elapsed / 140);
    ctx.font = 'bold 36px system-ui, "Arial Black", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('GAME OVER', W / 2, titleY);
    ctx.fillStyle = '#ff4040';
    ctx.shadowColor = 'rgba(255,0,0,0.45)'; ctx.shadowBlur = 14;
    ctx.fillText('GAME OVER', W / 2, titleY);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // 2) Score panel swooshes up from below
    const panelW = 276, panelH = 150;
    const px = (W - panelW) / 2;
    const panelDelay = 320, panelDur = 340;
    const tPanel = Math.max(0, Math.min(1, (elapsed - panelDelay) / panelDur));
    if (tPanel > 0) {
      const pyFinal = H * 0.28;
      const py = pyFinal + (1 - easeOutBack(tPanel)) * (H - pyFinal);
      ctx.shadowColor = 'rgba(57,255,20,0.42)'; ctx.shadowBlur = 30;
      roundRect(px, py, panelW, panelH, 14);
      ctx.fillStyle = 'rgba(7,15,9,0.96)'; ctx.fill();
      ctx.strokeStyle = 'rgba(57,255,20,0.72)'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.shadowBlur = 0;

      // Medal slot (left)
      const mx = px + 58, my = py + panelH / 2;
      const medal = medalForScore(score);
      ctx.beginPath(); ctx.arc(mx, my, 33, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
      if (medal && tPanel >= 1) {
        ctx.beginPath(); ctx.arc(mx, my, 28, 0, Math.PI * 2);
        ctx.fillStyle = medal.main; ctx.fill();
        ctx.strokeStyle = medal.rim; ctx.lineWidth = 4; ctx.stroke();
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.fillStyle = medal.rim;
        ctx.fillText('★', mx, my + 9);
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(medal.label, mx, my + 48);
      } else {
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('MEDAL', mx, my + 48);
      }

      // Score column (right) — count-up like the OG tally
      const sx = px + panelW - 72;
      const countStart = panelDelay + panelDur;
      const shown = elapsed <= countStart
        ? 0
        : Math.min(score, Math.floor((elapsed - countStart) / 36));
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('SCORE', sx, py + 36);
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(shown), sx, py + 68);

      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('BEST', sx, py + 98);
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillStyle = '#39ff14';
      ctx.fillText(String(bestScore), sx, py + 126);

      if (deathWasNewBest && shown >= score) {
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillStyle = '#0a140a';
        const bw = 38, bh = 15;
        roundRect(sx + 22, py + 88, bw, bh, 4);
        ctx.fillStyle = '#39ff14'; ctx.fill();
        ctx.fillStyle = '#0a140a';
        ctx.fillText('NEW', sx + 22 + bw / 2, py + 99);
      }
    }

    // 3) Tap again — delay so an accidental death-tap doesn't skip
    if (elapsed > 900) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 490);
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = `rgba(57,255,20,${pulse})`;
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 7;
      ctx.fillText('TAP TO FLY AGAIN', W / 2, H * 0.79);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ─── MAIN RENDER ─────────────────────────────────────────────────────────────
  function drawFrame(now) {
    if (!ctx) return;
    now = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Screen shake
    let sx = 0, sy = 0;
    if (shakeAmt > 0.01) {
      sx = Math.round((Math.random() - 0.5) * shakeAmt * 10);
      sy = Math.round((Math.random() - 0.5) * shakeAmt * 6);
      shakeAmt *= 0.76;
    } else { shakeAmt = 0; }

    ctx.save();
    if (sx || sy) ctx.translate(sx, sy);

    drawBackground();

    // Pipes (not shown on start / ready screens)
    if (gameState === S_PLAYING || gameState === S_DYING || gameState === S_DEAD) {
      for (let i = 0; i < pipes.length; i++) drawPipe(pipes[i]);
    }

    drawGround();

    // Bird position — title screen centres it, ready screen bobs at play position
    let bx = BIRD_X, by = birdY;
    if (gameState === S_IDLE) {
      bx = W / 2;
      by = PLAY_H * 0.48 + Math.sin(now / 650) * 9;
    } else if (gameState === S_READY) {
      by = birdY + Math.sin(now / 320) * 6;
    }
    drawBirdAt(bx, by, now);

    // Score HUD — visible from GET READY through the death fall, like the OG
    if (gameState === S_READY || gameState === S_PLAYING || gameState === S_DYING) {
      drawScoreHud();
    }

    ctx.restore(); // end shake

    // Tuning tag — tiny corner stamp so it's obvious which physics build is live
    ctx.save();
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(TUNING_TAG, W - 5, H - 5);
    ctx.restore();

    // Flash (no shake)
    if (flashAmt > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${flashAmt * 0.62})`;
      ctx.fillRect(0, 0, W, H);
      flashAmt *= 0.7;
    } else { flashAmt = 0; }

    // Overlay screens
    if (gameState === S_IDLE) drawStartScreen(now);
    else if (gameState === S_READY) drawReadyScreen(now);
    else if (gameState === S_DEAD) drawGameOverScreen(now);
  }

  // ─── GAME LOOP ────────────────────────────────────────────────────────────────
  let smoothedDtScale = 1;
  const DT_SMOOTH_ALPHA = 0.22;

  function loop(ts) {
    raf = window.requestAnimationFrame(loop);

    if (!lastTs) lastTs = ts;
    const dt = Math.min(32, ts - lastTs);
    lastTs = ts;
    const rawScale = dt / 16.67;
    // EMA smoothing: a single delayed frame (e.g. just after a tap) doesn't
    // produce a one-frame leap in pipes/bird — extra dt is spread across the
    // next few frames. Total movement over time is preserved, just less jittery.
    smoothedDtScale += (rawScale - smoothedDtScale) * DT_SMOOTH_ALPHA;
    const dtScale = smoothedDtScale;

    if (gameState === S_IDLE) {
      // Slow parallax drift on start screen
      bgScrollX += 0.38 * dtScale;
      groundScrollX += 0.9 * dtScale;
    }

    if (gameState === S_READY) {
      // World scrolls at play speed while the bird bobs, just like OG Get Ready
      const speed = SPEED_BASE * speedMul * dtScale;
      bgScrollX += speed * BG_PARALLAX;
      groundScrollX += speed;
    }

    if (gameState === S_PLAYING) {
      const speed = SPEED_BASE * speedMul * dtScale;   // constant — OG never speeds up
      birdVy += GRAVITY * dtScale;
      if (birdVy > VY_MAX) birdVy = VY_MAX;
      birdY  += birdVy * dtScale;
      // Ceiling doesn't kill, it just stops you (OG behaviour)
      if (birdY < BIRD_R) { birdY = BIRD_R; if (birdVy < 0) birdVy = 0; }
      bgScrollX += speed * BG_PARALLAX;
      groundScrollX += speed;

      for (let i = pipes.length - 1; i >= 0; i--) {
        pipes[i].x -= speed;
        const p = pipes[i];
        // OG scores the moment the bird crosses the pipe's centre line
        if (!p.passed && p.x + PIPE_W / 2 < BIRD_X) {
          p.passed = true;
          score += 1;
          if (els.scoreHud) els.scoreHud.textContent = String(score);
          playScore();
        }
        if (p.x + PIPE_W < -20) pipes.splice(i, 1);
      }
      const last = pipes[pipes.length - 1];
      if (!last || last.x < W - PIPE_SPAWN) spawnPipe();

      if (hitTest()) {
        gameState = S_DYING;
        wingBurstStart = null;
        if (birdVy < 0) birdVy = 0;
        shakeAmt = 1.0;
        flashAmt = 1.0;
        playDeath();
      }
    }

    if (gameState === S_DYING) {
      birdVy += GRAVITY * dtScale;
      if (birdVy > VY_MAX) birdVy = VY_MAX;
      birdY  += birdVy * dtScale;
      if (birdY - BIRD_R < 0) { birdY = BIRD_R; if (birdVy < 0) birdVy = 0; }
      if (birdY + BIRD_R >= PLAY_H) {
        birdY = PLAY_H - BIRD_R;
        birdVy = 0;
        gameState = S_DEAD;
        deadTs = ts;
        deathWasNewBest = score > 0 && score > bestScore;
        void endRound();
      }
    }

    drawFrame(ts);
  }

  // ─── STATS ────────────────────────────────────────────────────────────────────
  async function refreshStats() {
    const fc = window.FuqCloud;
    if (!els.best) return;
    if (!fc || typeof fc.getFifiBirdProgress !== 'function') {
      els.best.textContent = String(bestScore);
      if (els.runs)   els.runs.textContent  = '—';
      if (els.pipes)  els.pipes.textContent = '—';
      if (els.cloud)  els.cloud.textContent = '';
      renderCosmeticPickers();
      return;
    }
    try {
      const p = await fc.getFifiBirdProgress();
      const b = p.best ?? 0;
      els.best.textContent = String(b);
      if (els.runs)   els.runs.textContent  = String(p.gamesPlayed ?? 0);
      if (els.pipes)  els.pipes.textContent = String(p.totalPipes ?? 0);
      if (els.cloud)  els.cloud.textContent = p.source === 'cloud' && fc.isSignedIn?.() ? 'Saved to account' : 'On this device';
      if (b > bestScore) bestScore = b;
      clampSelectionToUnlocks();
      renderCosmeticPickers();
    } catch (_) { els.best.textContent = '—'; }
  }

  // ─── END ROUND ────────────────────────────────────────────────────────────────
  async function endRound() {
    const runScore = score;
    if (score > bestScore) bestScore = score;

    const fc = window.FuqCloud;
    let saved = { ok: true };
    let durationMs = 800;
    if (runStartedPerf != null && typeof performance !== 'undefined') {
      durationMs = Math.max(200, Math.min(Math.round(performance.now() - runStartedPerf), 18 * 60 * 1000));
    }
    if (fc && typeof fc.recordFifiBirdRun === 'function') {
      if (fc.isSignedIn?.() && runSessionId) {
        saved = await fc.recordFifiBirdRun(runScore, runScore, { runId: runSessionId, durationMs });
      } else if (!fc.isSignedIn?.()) {
        saved = await fc.recordFifiBirdRun(runScore, runScore);
      } else {
        saved = { ok: false, error: 'fifi_missing_verified_session', source: 'local' };
      }
    }
    runSessionId = null; runStartedPerf = null; runRng = null;
    await refreshStats();
    if (saved.ok && fc && typeof fc.refreshFifiBirdLeaderboard === 'function') {
      void fc.refreshFifiBirdLeaderboard().catch(() => {});
    }
    const bal = loadWallet ? Math.max(0, Math.floor(loadWallet().tokens || 0)) : 0;
    if (typeof arcadeNoteRound === 'function') { try { arcadeNoteRound('fifi', 0); } catch (_) {} }
    if (pushHistory) {
      const detail = saved.ok
        ? (saved.source === 'cloud' ? `Best gap ${runScore} · verified` : `Best gap ${runScore} · local`)
        : `Best gap ${runScore} (${saved.error || 'save failed'})`;
      pushHistory('fifi', detail, 0, bal, { _localOnly: true });
    }
    if (els.scoreHud) els.scoreHud.textContent = String(runScore);
  }

  // ─── START RUN ────────────────────────────────────────────────────────────────
  // Reset the world and show the OG "GET READY" screen. The verified server
  // session is fetched here so the first real flap starts play instantly.
  async function enterReady() {
    if (runStartBusy) return;
    runStartBusy = true;
    try {
      score = 0; pipes = [];
      birdY = PLAY_H * 0.46; birdVy = 0; birdAngle = 0;
      smoothedDtScale = 1;
      deathWasNewBest = false;
      runSessionId = null; runStartedPerf = null; runRng = null;
      if (els.scoreHud) els.scoreHud.textContent = '0';

      const fc = window.FuqCloud;
      if (fc && fc.isSignedIn?.() && typeof fc.startFifiBirdRun === 'function') {
        const started = await fc.startFifiBirdRun();
        if (started && started.runId != null && started.seed != null) {
          runSessionId = started.runId;
          runRng = rngFromServerSeed(started.seed);
        }
      }
      gameState = S_READY;
    } finally {
      runStartBusy = false;
    }
  }

  // First tap out of GET READY — physics and the run timer start here.
  function beginPlaying() {
    gameState = S_PLAYING;
    if (typeof performance !== 'undefined') runStartedPerf = performance.now();
    birdVy = FLAP;
    triggerWingBurst();
    // Defer audio so AudioContext init / source scheduling doesn't delay the next paint.
    setTimeout(playFlap, 0);
    spawnPipe();
  }

  // ─── INPUT ────────────────────────────────────────────────────────────────────
  async function flap(e) {
    if (e && e.type === 'touchstart') e.preventDefault();

    if (gameState === S_DYING) return;

    if (gameState === S_DEAD) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - deadTs < 900) return; // prevent accidental skip
      await enterReady();
      return;
    }

    if (gameState === S_IDLE) {
      if (els.hint) els.hint.hidden = true;
      await enterReady();
      return;
    }

    if (gameState === S_READY) {
      beginPlaying();
      return;
    }

    // S_PLAYING
    birdVy = FLAP;
    triggerWingBurst();
    // Defer audio so creating BufferSource nodes doesn't push the next paint
    // past the upcoming vsync — that's what causes the "tap = pipes jump" feel.
    setTimeout(playFlap, 0);
  }

  function onKey(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    void flap();
  }

  // ─── ASSET LOADING ────────────────────────────────────────────────────────────
  function loadImage(src, onOk, onFail) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => onOk(img);
    img.onerror = onFail;
    img.src = src;
  }
  function loadBirdSprite(src) {
    const path = src || skinPaths(skinById(selectedSkinId)).bird;
    const gen = ++birdLoadGen;
    loadImage(path, (img) => {
      if (gen !== birdLoadGen) return;
      birdImg = img; birdSpriteOk = true;
    }, () => {
      if (gen !== birdLoadGen) return;
      if (path !== BIRD_SPRITE_PATH) { loadBirdSprite(BIRD_SPRITE_PATH); return; }
      birdSpriteOk = false; birdImg = null;
    });
  }
  function loadPipeSprite(src) {
    const path = src || skinPaths(skinById(selectedSkinId)).pipe;
    const gen = ++pipeLoadGen;
    loadImage(path, (img) => {
      if (gen !== pipeLoadGen) return;
      pipeImg = img; pipeImgOk = true;
    }, () => {
      if (gen !== pipeLoadGen) return;
      if (path !== PIPE_SPRITE_PATH) { loadPipeSprite(PIPE_SPRITE_PATH); return; }
      pipeImgOk = false; pipeImg = null;
    });
  }
  function loadBgSprite(src) {
    const path = src || arenaById(selectedArenaId).src;
    const gen = ++bgLoadGen;
    loadImage(path, (img) => {
      if (gen !== bgLoadGen) return;
      bgImg = img; bgImgOk = true;
    }, () => {
      if (gen !== bgLoadGen) return;
      if (path !== BG_SPRITE_PATH) { loadBgSprite(BG_SPRITE_PATH); return; }
      bgImgOk = false; bgImg = null;
    });
  }
  function applySelectedCosmetics() {
    clampSelectionToUnlocks();
    const paths = skinPaths(skinById(selectedSkinId));
    loadBirdSprite(paths.bird);
    loadPipeSprite(paths.pipe);
    loadBgSprite(arenaById(selectedArenaId).src);
  }
  function selectSkin(id) {
    const skin = skinById(id);
    if (!isUnlocked(skin.need)) return false;
    selectedSkinId = skin.id;
    saveCosmetics();
    const paths = skinPaths(skin);
    loadBirdSprite(paths.bird);
    loadPipeSprite(paths.pipe);
    renderCosmeticPickers();
    return true;
  }
  function selectArena(id) {
    const arena = arenaById(id);
    if (!isUnlocked(arena.need)) return false;
    selectedArenaId = arena.id;
    saveCosmetics();
    loadBgSprite(arena.src);
    renderCosmeticPickers();
    return true;
  }
  function renderChipRow(host, items, selectedId, onPick, kind) {
    if (!host) return;
    host.textContent = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const open = isUnlocked(item.need);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'games-fifi-chip' + (item.id === selectedId ? ' is-selected' : '') + (open ? '' : ' is-locked');
      btn.dataset.id = item.id;
      btn.disabled = !open;
      if (item.swatch) {
        btn.style.setProperty('--chip', item.swatch);
        btn.classList.add('games-fifi-chip--swatch');
      }
      btn.title = open ? item.label : (item.label + ' — best ' + item.need + ' to unlock');
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', item.id === selectedId ? 'true' : 'false');
      const name = document.createElement('span');
      name.className = 'games-fifi-chip-name';
      name.textContent = open ? item.label : (item.need + '+');
      btn.appendChild(name);
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!open) return;
        onPick(item.id);
      });
      host.appendChild(btn);
    }
  }
  function renderCosmeticPickers() {
    renderChipRow(els.skinPicker, BIRD_SKINS, selectedSkinId, selectSkin, 'skin');
    renderChipRow(els.arenaPicker, ARENAS, selectedArenaId, selectArena, 'arena');
    if (els.unlockHint) {
      els.unlockHint.textContent = unlockAll
        ? 'Dev unlock on — all cosmetics open.'
        : ('Best ' + bestScore + '. Locked chips show the score you need.');
    }
  }

  // ─── REDUCE MOTION ────────────────────────────────────────────────────────────
  function syncSpeedFromReduceMotion() {
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    speedMul = reduceMotion ? 0.62 : 1;
  }

  // ─── SOUND BUTTON ─────────────────────────────────────────────────────────────
  function applySoundButtonState() {
    if (!els.soundBtn) return;
    els.soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    els.soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    els.soundBtn.setAttribute('title', soundOn ? 'Mute sound' : 'Unmute sound');
  }

  function wireSoundButton() {
    if (!els.soundBtn) return;
    applySoundButtonState();
    els.soundBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      soundOn = !soundOn;
      try {
        if (window.localStorage) window.localStorage.setItem(SOUND_PREF_KEY, soundOn ? '1' : '0');
      } catch (_) {}
      applySoundButtonState();
    });
  }

  // ─── FULLSCREEN BUTTON ────────────────────────────────────────────────────────
  let pseudoFsActive = false;

  function nativeFsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function nativeFsSupported(el) {
    if (!el) return false;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
  }

  function requestNativeFs(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return Promise.reject(new Error('unsupported'));
    try { return Promise.resolve(fn.call(el)); } catch (e) { return Promise.reject(e); }
  }

  function exitNativeFs() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!fn) return Promise.reject(new Error('unsupported'));
    try { return Promise.resolve(fn.call(document)); } catch (e) { return Promise.reject(e); }
  }

  function isFsActive() {
    return pseudoFsActive || !!nativeFsElement();
  }

  function enterPseudoFs() {
    if (!els.wrap || pseudoFsActive) return;
    pseudoFsActive = true;
    els.wrap.classList.add('is-pseudo-fullscreen');
    document.body.classList.add('fifi-bird-fs-lock');
    applyFsButtonState();
    // Defer so layout updates before measuring
    requestAnimationFrame(resizeCanvas);
  }

  function exitPseudoFs() {
    if (!pseudoFsActive) return;
    pseudoFsActive = false;
    if (els.wrap) els.wrap.classList.remove('is-pseudo-fullscreen');
    document.body.classList.remove('fifi-bird-fs-lock');
    applyFsButtonState();
    requestAnimationFrame(resizeCanvas);
  }

  function applyFsButtonState() {
    if (!els.fsBtn) return;
    const active = isFsActive();
    els.fsBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.fsBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    els.fsBtn.setAttribute('title', active ? 'Exit fullscreen' : 'Fullscreen');
  }

  function wireFullscreenButton() {
    if (!els.fsBtn || !els.wrap) return;
    els.fsBtn.hidden = false;
    applyFsButtonState();

    els.fsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (pseudoFsActive) { exitPseudoFs(); return; }
      if (nativeFsElement()) { exitNativeFs().catch(() => {}); return; }
      if (nativeFsSupported(els.wrap)) {
        requestNativeFs(els.wrap).catch(() => { enterPseudoFs(); });
      } else {
        enterPseudoFs();
      }
    });

    const onNativeChange = () => {
      applyFsButtonState();
      resizeCanvas();
    };
    document.addEventListener('fullscreenchange', onNativeChange);
    document.addEventListener('webkitfullscreenchange', onNativeChange);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && pseudoFsActive) exitPseudoFs();
    });
  }

  // ─── WIRE GAME ────────────────────────────────────────────────────────────────
  function wireGame() {
    canvas = $('fifi-bird-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: false });

    els.best     = $('fifi-bird-stat-best');
    els.runs     = $('fifi-bird-stat-runs');
    els.pipes    = $('fifi-bird-stat-pipes');
    els.cloud    = $('fifi-bird-cloud-hint');
    els.scoreHud = $('fifi-bird-run-score');
    els.hint     = $('fifi-bird-hint');
    els.wrap     = $('fifi-bird-canvas-wrap');
    els.soundBtn    = $('fifi-bird-sound-btn');
    els.fsBtn       = $('fifi-bird-fullscreen-btn');
    els.skinPicker  = $('fifi-bird-skin-picker');
    els.arenaPicker = $('fifi-bird-arena-picker');
    els.unlockHint  = $('fifi-bird-unlock-hint');

    syncSpeedFromReduceMotion();
    const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      const onChange = () => syncSpeedFromReduceMotion();
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousedown', (ev) => void flap(ev));
    canvas.addEventListener('touchstart', (ev) => void flap(ev), { passive: false });
    document.addEventListener('keydown', onKey);
    wireSoundButton();
    wireFullscreenButton();

    // Preload squelch samples so the death impact isn't delayed on first hit.
    const ac = getAudio();
    if (ac) {
      ensureFlapBuffer(ac);
      ensureImpactBuffer(ac);
    }
    document.addEventListener('fuqmea-fifi-progress-sync', () => void refreshStats());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.querySelector('[data-tab-panel="fifi"]:not([hidden])')) {
        void refreshStats();
      }
    });

    loadCosmetics();
    clampSelectionToUnlocks();
    applySelectedCosmetics();
    renderCosmeticPickers();

    // Start screen is on-canvas; hide the HTML overlay hint
    if (els.hint) els.hint.hidden = true;

    // Kick off the continuous render loop
    raf = window.requestAnimationFrame(loop);

    void refreshStats();
  }

  window.initFifiBirdArcade = function (api) {
    if (wired) return;
    wired = true;
    pushHistory     = api.pushHistory;
    loadWallet      = api.loadWallet;
    arcadeNoteRound = api.arcadeNoteRound;
    wireGame();
  };
})();
