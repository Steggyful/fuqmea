// FiFi Bird — polished arcade edition. No FUQ, just vibes.

(function () {
  'use strict';

  // ─── TUNING ──────────────────────────────────────────────────────────────────
  const W              = 360;
  const H              = 520;
  const GRAVITY        = 0.44;
  const FLAP           = -9.0;
  const VY_MAX         = 12;
  const PIPE_W         = 54;
  const GAP            = 148;
  const PIPE_SPAWN     = 198;
  const SPEED_BASE     = 2.4;
  const SPEED_RAMP     = 0.024;   // per pipe cleared
  const SPEED_CAP      = 3.9;
  const BIRD_R         = 22;
  const BIRD_X         = 92;
  const BIRD_SPRITE_FRAMES = 4;
  const BIRD_SPRITE_PATH   = 'assets/images/FiFi Bird/fifi_sprite.png';
  const BG_SPRITE_PATH     = 'assets/images/FiFi Bird/fifi_bg.jpg';
  const PIPE_SPRITE_PATH   = 'assets/images/FiFi Bird/fifi_pipe.png';
  const TARGET_SPRITE_HEIGHT = 88;
  // Source frame is 256x1024 but the bird (with wings extended) only fills the
  // middle ~48% of it — these crop the empty padding so TARGET_SPRITE_HEIGHT
  // means the actual visible bird height, not the frame box height.
  const SPRITE_CROP_Y_FRAC = 0.27;
  const SPRITE_CROP_H_FRAC = 0.48;
  const WING_FRAME_MS  = 85;
  const FLAP_BURST_SEQUENCE = [1, 2, 3, 0];
  const BG_PARALLAX    = 0.25;
  const PIPE_COLLISION_INSET = 8;

  // ─── STATES ──────────────────────────────────────────────────────────────────
  const S_IDLE    = 0;
  const S_PLAYING = 1;
  const S_DYING   = 2;
  const S_DEAD    = 3;

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
  const PIPE_VIEW_EXT = Math.min(220, Math.ceil(PIPE_SLICE.topMiddle.sh * PIPE_BODY_SCALE_TOP * 0.35));

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
  let birdY      = H * 0.42;
  let birdVy     = 0;
  let birdAngle  = 0;
  let pipes      = [];
  let score      = 0;
  let bestScore  = 0;
  let bgScrollX  = 0;
  let lastTs     = 0;
  let raf        = 0;
  let wingBurstStart = null;
  let scorePops  = [];   // { y, startTs }
  let shakeAmt   = 0;
  let flashAmt   = 0;
  let deadTs     = 0;    // RAF timestamp when S_DEAD was entered

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
    if (birdY - BIRD_R < 8 || birdY + BIRD_R > H - 8) return true;
    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      const rx = p.x + PIPE_COLLISION_INSET;
      const rw = PIPE_W - 2 * PIPE_COLLISION_INSET;
      if (BIRD_X + BIRD_R <= rx || BIRD_X - BIRD_R >= rx + rw) continue;
      const topH = p.gapY - GAP / 2;
      const botY = p.gapY + GAP / 2;
      if (circleHitsRect(BIRD_X, birdY, BIRD_R, rx, 0, rw, topH)) return true;
      if (circleHitsRect(BIRD_X, birdY, BIRD_R, rx, botY, rw, H - botY)) return true;
    }
    return false;
  }

  function spawnPipe() {
    const minGapY = 110 + GAP / 2;
    const maxGapY = H - 110 - GAP / 2;
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
    const bottomH = Math.max(0, H - botY);

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
      let yBottom = topH - baseH, remain = bodyH + PIPE_VIEW_EXT;
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
      let yExt = H, remUg = PIPE_VIEW_EXT, pngUg = BM.sy;
      while (remUg > 0) {
        const dh = Math.min(tileHB, remUg);
        const srcH = Math.min(BM.sh, dh / scaleB);
        ctx.drawImage(pipeImg, BM.sx, pngUg, BM.sw, srcH, p.x, yExt, PIPE_W, dh);
        pngUg += srcH;
        if (pngUg >= BM.sy + BM.sh) pngUg -= BM.sh;
        yExt += dh; remUg -= dh;
      }
    }
  }

  function drawBirdAt(x, y, now) {
    // Update smooth rotation
    if (gameState === S_PLAYING) {
      const target = Math.max(-0.52, Math.min(1.1, birdVy * 0.075));
      birdAngle += (target - birdAngle) * 0.22;
    } else if (gameState === S_DYING) {
      birdAngle = Math.min(Math.PI * 0.55, birdAngle + 0.19);
    } else {
      birdAngle += (0 - birdAngle) * 0.1;
    }

    let frameIdx = 0;
    if (gameState === S_PLAYING) {
      frameIdx = wingFrameIndex();
    } else if (gameState === S_IDLE || gameState === S_DEAD) {
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

  function drawScoreHud(now) {
    // Pop scale: punchy on new score
    let popScale = 1;
    if (scorePops.length > 0) {
      const t = Math.min(1, (now - scorePops[scorePops.length - 1].startTs) / 220);
      popScale = 1 + 0.32 * Math.pow(1 - t, 2);
    }
    const fontSize = Math.round(30 * popScale);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(String(score), W / 2, 52);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), W / 2, 52);
    ctx.restore();
  }

  function drawScorePops(now) {
    ctx.save();
    ctx.textAlign = 'center';
    for (let i = scorePops.length - 1; i >= 0; i--) {
      const pop = scorePops[i];
      const t = (now - pop.startTs) / 560;
      if (t >= 1) { scorePops.splice(i, 1); continue; }
      ctx.globalAlpha = Math.pow(1 - t, 0.65);
      const y = pop.y - t * 48;
      ctx.font = `bold ${Math.round(22 + t * 3)}px system-ui, sans-serif`;
      ctx.fillStyle = '#39ff14';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur  = 5;
      ctx.fillText('+1', BIRD_X + 30, y);
    }
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
    const birdY = H * 0.235;
    const birdW = ctx.measureText('BIRD').width;
    ctx.shadowBlur = 0;
    ctx.font = 'bold 11px system-ui, sans-serif';
    const betaTextW = ctx.measureText('BETA').width;
    const betaChipW = betaTextW + 14;
    const betaChipH = 20;
    const gap = 10;
    const groupW = birdW + gap + betaChipW;
    const birdLeft = (W - groupW) / 2;
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur  = 26;
    ctx.font = 'bold 58px system-ui, "Arial Black", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('BIRD', birdLeft, birdY);
    ctx.shadowBlur = 0;

    // BETA chip — sits next to BIRD, matches the HTML title badge
    const chipX = birdLeft + birdW + gap;
    const chipY = birdY - 38;
    roundRect(chipX, chipY, betaChipW, betaChipH, 10);
    ctx.fillStyle = 'rgba(57,255,20,0.16)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(57,255,20,0.7)';
    ctx.stroke();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#39ff14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(57,255,20,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillText('BETA', chipX + betaChipW / 2, chipY + betaChipH / 2 + 0.5);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

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

  function drawGameOverScreen(now) {
    ctx.fillStyle = 'rgba(0,0,0,0.56)';
    ctx.fillRect(0, 0, W, H);

    const panelW = 272, panelH = 184;
    const px = (W - panelW) / 2, py = H * 0.26;

    ctx.save();
    ctx.shadowColor = 'rgba(57,255,20,0.42)'; ctx.shadowBlur = 30;
    roundRect(px, py, panelW, panelH, 14);
    ctx.fillStyle = 'rgba(7,15,9,0.96)'; ctx.fill();
    ctx.strokeStyle = 'rgba(57,255,20,0.72)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';

    ctx.font = 'bold 30px system-ui, "Arial Black", sans-serif';
    ctx.fillStyle = '#ff4040';
    ctx.shadowColor = 'rgba(255,0,0,0.45)'; ctx.shadowBlur = 14;
    ctx.fillText('GAME OVER', W / 2, py + 48);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), W / 2, py + 112);

    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.fillText('gaps cleared', W / 2, py + 130);

    const isNewBest = score > 0 && score >= bestScore;
    if (isNewBest) {
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = '#39ff14';
      ctx.shadowColor = 'rgba(57,255,20,0.55)'; ctx.shadowBlur = 12;
      ctx.fillText('★  NEW BEST  ★', W / 2, py + 163);
      ctx.shadowBlur = 0;
    } else if (bestScore > 0) {
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.46)';
      ctx.fillText(`Best: ${bestScore}`, W / 2, py + 163);
    }

    // Tap again — delay 650ms so an accidental death-tap doesn't skip
    if (now - deadTs > 650) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 490);
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = `rgba(57,255,20,${pulse})`;
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 7;
      ctx.fillText('TAP TO FLY AGAIN', W / 2, py + panelH + 42);
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

    // Pipes (not shown on start screen)
    if (gameState !== S_IDLE) {
      for (let i = 0; i < pipes.length; i++) drawPipe(pipes[i]);
    }

    // Bird position — idle has centred bob
    const bx = gameState === S_IDLE ? W / 2 : BIRD_X;
    const by = gameState === S_IDLE ? H * 0.465 + Math.sin(now / 650) * 9 : birdY;
    drawBirdAt(bx, by, now);

    // Score HUD during active play
    if (gameState === S_PLAYING || gameState === S_DYING) {
      drawScoreHud(now);
      if (scorePops.length) drawScorePops(now);
    }

    ctx.restore(); // end shake

    // Flash (no shake)
    if (flashAmt > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${flashAmt * 0.62})`;
      ctx.fillRect(0, 0, W, H);
      flashAmt *= 0.7;
    } else { flashAmt = 0; }

    // Overlay screens
    if (gameState === S_IDLE) drawStartScreen(now);
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
    }

    if (gameState === S_PLAYING) {
      const speed = Math.min(SPEED_CAP, SPEED_BASE + score * SPEED_RAMP) * speedMul * dtScale;
      birdVy += GRAVITY * dtScale;
      if (birdVy > VY_MAX) birdVy = VY_MAX;
      birdY  += birdVy * dtScale;
      bgScrollX += speed * BG_PARALLAX;

      for (let i = pipes.length - 1; i >= 0; i--) {
        pipes[i].x -= speed;
        const p = pipes[i];
        if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.passed = true;
          score += 1;
          if (els.scoreHud) els.scoreHud.textContent = String(score);
          scorePops.push({ y: birdY - 18, startTs: ts });
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
      const speed = Math.min(SPEED_CAP, SPEED_BASE + score * SPEED_RAMP) * speedMul * dtScale;
      birdVy += GRAVITY * dtScale;
      if (birdVy > VY_MAX) birdVy = VY_MAX;
      birdY  += birdVy * dtScale;
      if (birdY - BIRD_R < 0) { birdY = BIRD_R; if (birdVy < 0) birdVy = 0; }
      if (birdY + BIRD_R >= H - 8) {
        birdY = H - 8 - BIRD_R;
        birdVy = 0;
        gameState = S_DEAD;
        deadTs = ts;
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
      els.best.textContent = '—';
      if (els.runs)   els.runs.textContent  = '—';
      if (els.pipes)  els.pipes.textContent = '—';
      if (els.cloud)  els.cloud.textContent = '';
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
  async function startRun() {
    if (runStartBusy) return;
    runStartBusy = true;
    try {
      score = 0; pipes = []; scorePops = [];
      birdY = H * 0.42; birdVy = 0; birdAngle = 0;
      lastTs = 0; bgScrollX = 0;
      smoothedDtScale = 1;
      runSessionId = null; runStartedPerf = null; runRng = null;
      if (els.scoreHud) els.scoreHud.textContent = '0';

      const fc = window.FuqCloud;
      if (fc && fc.isSignedIn?.() && typeof fc.startFifiBirdRun === 'function') {
        const started = await fc.startFifiBirdRun();
        if (started && started.runId != null && started.seed != null) {
          runSessionId = started.runId;
          runRng = rngFromServerSeed(started.seed);
          if (typeof performance !== 'undefined') runStartedPerf = performance.now();
        }
      }
      gameState = S_PLAYING;
      birdVy = FLAP * 0.85;
      triggerWingBurst();
      // Defer audio so AudioContext init / source scheduling doesn't delay the next paint.
      setTimeout(playFlap, 0);
      spawnPipe();
    } finally {
      runStartBusy = false;
    }
  }

  // ─── INPUT ────────────────────────────────────────────────────────────────────
  async function flap(e) {
    if (e && e.type === 'touchstart') e.preventDefault();

    if (gameState === S_DYING) return;

    if (gameState === S_DEAD) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - deadTs < 650) return; // prevent accidental skip
      await startRun();
      return;
    }

    if (gameState === S_IDLE) {
      if (els.hint) els.hint.hidden = true;
      await startRun();
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
  function loadBirdSprite() {
    const img = new Image(); img.decoding = 'async';
    img.onload  = () => { birdImg = img; birdSpriteOk = true; };
    img.onerror = () => { birdSpriteOk = false; birdImg = null; };
    img.src = BIRD_SPRITE_PATH;
  }
  function loadBgSprite() {
    const img = new Image(); img.decoding = 'async';
    img.onload  = () => { bgImg = img; bgImgOk = true; };
    img.onerror = () => { bgImgOk = false; bgImg = null; };
    img.src = BG_SPRITE_PATH;
  }
  function loadPipeSprite() {
    const img = new Image(); img.decoding = 'async';
    img.onload  = () => { pipeImg = img; pipeImgOk = true; };
    img.onerror = () => { pipeImgOk = false; pipeImg = null; };
    img.src = PIPE_SPRITE_PATH;
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
    els.soundBtn = $('fifi-bird-sound-btn');
    els.fsBtn    = $('fifi-bird-fullscreen-btn');

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
    document.addEventListener('fuqmea-fifi-progress-sync', () => void refreshStats());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.querySelector('[data-tab-panel="fifi"]:not([hidden])')) {
        void refreshStats();
      }
    });

    loadBirdSprite();
    loadBgSprite();
    loadPipeSprite();

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
