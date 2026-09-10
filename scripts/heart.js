/* Welcome screen — a stopped heart the visitor has to restart, which then runs
   away with itself and tears open into the site.

   One phase clock drives everything, so the EKG spike, the squeeze of the
   sprite, the glow and the beep are all the same heartbeat. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const root      = document.documentElement;
  const body      = document.body;
  const stage     = $('stage');
  const welcome   = $('welcome');
  const heartBtn  = $('heart');
  const heartWrap = $('heartStack');
  const heartImg  = $('heartImg');
  const bpmValue  = $('bpmValue');
  const bpmStatus = $('bpmStatus');
  const prompt    = $('prompt');
  const pips      = $('pips');
  const pipEls    = Array.from(pips.children);
  const cooldown  = $('cooldown');
  const soundBtn  = $('sound');
  const skipBtn   = $('skip');
  const replayBtn = $('replay');
  const fluid     = $('fluid');
  const statusVal = $('ekgStatusValue');
  const canvas    = $('ekg');
  const ctx       = canvas.getContext('2d');
  const crt       = $('crt');
  const cctx      = crt.getContext('2d');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── tuning ─────────────────────────────────────────────── */
  const W = canvas.width;
  const H = canvas.height;
  const MID = Math.round(H / 2);
  const SPAN = H * 0.33;
  const COLS_PER_SEC = 78;
  const R_PHASE = 0.285;

  const CLICKS_TO_REVIVE = 3;
  const COOLDOWN = 1.5;      // seconds; let it lapse and one click drains away
  const FILL_PER_CLICK = 0.15;   // how far the blood rises with each pump
  const SITE_STATUS_OK = 'Threshold reached, now loading site';
  const DOTS = ['.', '..', '...'];
  const DOT_MS = 420;

  const PIX = 'assets/heart.png';
  const T1  = 'assets/heart-t1.png';   // Fig. 37
  const T2  = 'assets/heart-t2.png';   // the labelled plate
  const ENG = [T1, T2];

  /* Each turn of the loop shows both drawings once in white and once in red,
     with the pixel sprite on every third frame — so no colour or drawing lands
     twice running. Three turns, then a pixel frame to close on. */
  const LOOP = [
    { src: PIX },
    { src: T1, white: true },
    { src: T2 },
    { src: PIX },
    { src: T2, white: true },
    { src: T1 },
  ];
  const SEQUENCE = [...LOOP, ...LOOP, ...LOOP, { src: PIX }];

  const SWAP_FIRST = reduceMotion ? 400 : 150;   // ms on the first frame
  const SWAP_LAST  = reduceMotion ? 400 : 45;    // ms on the last
  // reduced motion gets a short, slow taste of the flicker rather than all of it
  const TOTAL_SWAPS = reduceMotion ? 4 : SEQUENCE.length;

  const CATCH_DUR  = 1.6;
  const CATCH_BPM  = 96;
  const PEAK_BPM   = 215;
  const GLITCH_DUR = reduceMotion ? 0.5 : 0.9;

  const STEPS = [
    { amp: 0.45, shown: 18, status: 'AGONAL'      },
    { amp: 0.78, shown: 34, status: 'BRADYCARDIA' },
  ];

  /* ── state ──────────────────────────────────────────────── */
  const state = {
    clicks: 0,
    cool: 0,
    alive: false,
    mode: 'flat',
    stage: null,
    stageT: 0,
    swapIndex: 0,
    swapTimer: 0,
    glitchSwap: 0,
    t: 0,
    phase: 0,
    amp: 0,
    ampTarget: 0,
    bpm: 0,
    bpmTarget: 0,
    surge: 0,
    pulseEnd: 0,
    beat: 0,
    fill: 0,
    fillTarget: 0,
    chaos: 0,
    ease: 1.4,
    running: true,
  };

  /* ── waveform ───────────────────────────────────────────── */
  function wrapDist(p, c) {
    let d = p - c;
    if (d >  0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  }
  function bump(p, c, w) {
    const d = wrapDist(p, c);
    return Math.exp(-(d * d) / (2 * w * w));
  }

  /* Lead II, near enough: P, then the QRS complex, then T. */
  function ecg(p) {
    return  0.16 * bump(p, 0.140, 0.026)
          - 0.11 * bump(p, 0.255, 0.008)
          + 1.00 * bump(p, R_PHASE, 0.008)
          - 0.28 * bump(p, 0.318, 0.011)
          + 0.30 * bump(p, 0.460, 0.042);
  }

  /* The muscle itself: a hard squeeze on the R spike, a softer one after. */
  function squeeze(p) {
    return 0.085 * bump(p, 0.300, 0.036)
         + 0.042 * bump(p, 0.470, 0.048);
  }
  const SQUEEZE_MAX = 0.085;

  /* ── EKG canvas ─────────────────────────────────────────── */
  const samples = new Float32Array(W);
  let head = 0;
  let colAcc = 0;

  ctx.imageSmoothingEnabled = false;

  function pushColumn() {
    const noise = (Math.random() - 0.5) * 0.014;
    const junk  = state.chaos ? (Math.random() - 0.5) * 2 * state.chaos : 0;
    samples[head] = ecg(state.phase) * state.amp + noise + junk;
    head = (head + 1) % W;
  }

  function drawGrid() {
    ctx.fillStyle = '#1b1015';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#38141c';
    for (let x = 0; x < W; x += 8) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 8) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = '#5c1f2b';
    for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 40) ctx.fillRect(0, y, W, 1);
  }

  function yFor(v) {
    const y = Math.round(MID - v * SPAN);
    return y < 1 ? 1 : y > H - 2 ? H - 2 : y;
  }

  function drawTrace() {
    ctx.fillStyle = '#efe7e0';
    let prevY = yFor(samples[head]);
    for (let x = 0; x < W; x++) {
      const y = yFor(samples[(head + x) % W]);
      ctx.fillRect(x, Math.min(prevY, y), 1, Math.abs(y - prevY) + 1);
      prevY = y;
    }
    ctx.fillStyle = '#e0364b';
    ctx.fillRect(W - 3, prevY - 1, 3, 3);
  }

  /* ── the glitch: a low-res CRT buffer, blown up with hard edges ──────── */
  const CRT_SCALE = 4;                       // css pixels per canvas pixel
  const tintCanvas = document.createElement('canvas');
  const tctx = tintCanvas.getContext('2d');
  const MOSH = ['#ff2d2d', '#25ff85', '#2d6bff', '#00e5ff', '#ff2df0', '#ffe93d', '#ffffff'];

  function sizeCrt() {
    crt.width  = Math.max(1, Math.ceil(innerWidth  / CRT_SCALE));
    crt.height = Math.max(1, Math.ceil(innerHeight / CRT_SCALE));
    cctx.imageSmoothingEnabled = false;
  }

  /* The frames are flat-coloured art with all the tone in the alpha channel,
     so `source-in` repaints one cleanly into any single colour. */
  function tintedHeart(color, w, h) {
    tintCanvas.width = w;
    tintCanvas.height = h;
    tctx.imageSmoothingEnabled = false;
    tctx.clearRect(0, 0, w, h);
    tctx.drawImage(heartImg, 0, 0, w, h);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = 'source-over';
    return tintCanvas;
  }

  function drawGlitch(intensity) {
    const CW = crt.width, CH = crt.height;
    cctx.clearRect(0, 0, CW, CH);

    const r = heartImg.getBoundingClientRect();
    if (!r.width || !r.height) return;

    const w  = Math.max(1, Math.round(r.width  / CRT_SCALE));
    const h  = Math.max(1, Math.round(r.height / CRT_SCALE));
    const x0 = Math.round(r.left / CRT_SCALE);
    const y0 = Math.round(r.top  / CRT_SCALE);

    // pull the three colour channels apart
    const off = Math.round(1 + 5 * intensity);
    cctx.globalCompositeOperation = 'lighter';
    cctx.drawImage(tintedHeart('#ff0000', w, h), x0 - off, y0);
    cctx.drawImage(tintedHeart('#00ff00', w, h), x0, y0 + (Math.random() < 0.5 ? 0 : 1));
    cctx.drawImage(tintedHeart('#0000ff', w, h), x0 + off, y0);
    cctx.globalCompositeOperation = 'source-over';

    // shear what's there into displaced scanline bands
    const bands = 5 + Math.round(16 * intensity);
    for (let i = 0; i < bands; i++) {
      const by = Math.floor(Math.random() * CH);
      const bh = 1 + Math.floor(Math.random() * 4);
      const dx = Math.round((Math.random() - 0.5) * 26 * intensity);
      cctx.drawImage(crt, 0, by, CW, bh, dx, by, CW, bh);
    }

    // datamosh bars, clustered over the heart
    const cx = x0 + w / 2;
    const span = w * 2.4;
    const bars = 8 + Math.round(30 * intensity);
    for (let i = 0; i < bars; i++) {
      const bw = Math.round((0.06 + Math.random() * 0.45) * span);
      const bx = Math.round(cx - span / 2 + Math.random() * (span - bw));
      const by = Math.round(y0 - h * 0.12 + Math.random() * h * 1.24);
      const bh = 1 + Math.floor(Math.random() * 3);
      cctx.globalAlpha = 0.45 + Math.random() * 0.55;
      cctx.fillStyle = MOSH[(Math.random() * MOSH.length) | 0];
      cctx.fillRect(bx, by, bw, bh);
    }
    cctx.globalAlpha = 1;

    // RGB subpixel stripes, only over pixels that already have something in them
    cctx.globalCompositeOperation = 'source-atop';
    for (let x = 0; x < CW; x += 3) {
      cctx.fillStyle = 'rgba(255,0,0,0.30)'; cctx.fillRect(x,     0, 1, CH);
      cctx.fillStyle = 'rgba(0,255,0,0.30)'; cctx.fillRect(x + 1, 0, 1, CH);
      cctx.fillStyle = 'rgba(0,0,255,0.30)'; cctx.fillRect(x + 2, 0, 1, CH);
    }
    cctx.globalCompositeOperation = 'source-over';
  }

  /* ── sound ──────────────────────────────────────────────── */
  let audioCtx = null;
  let soundOn = true;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, gain, type, endFreq) {
    if (!soundOn || gain <= 0.0005) return;
    const ac = ensureAudio();
    if (!ac) return;

    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const amp = ac.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(amp).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function beatSound(strength) {
    tone(880, 0.09, 0.045 * strength);
    tone(56,  0.22, 0.130 * strength);
  }

  /* ── frames ─────────────────────────────────────────────── */
  ENG.forEach((src) => { new Image().src = src; });

  function setFrame(f) {
    heartImg.src = f.src;
    heartWrap.classList.toggle('is-pixel', f.src === PIX);
    heartWrap.classList.toggle('is-white', !!f.white);
  }

  function nextSwap() {
    if (state.swapIndex >= TOTAL_SWAPS) { enterStage('glitch'); return; }

    setFrame(SEQUENCE[state.swapIndex % SEQUENCE.length]);
    const p = state.swapIndex / Math.max(TOTAL_SWAPS - 1, 1);
    state.swapTimer = (SWAP_FIRST + (SWAP_LAST - SWAP_FIRST) * p) / 1000;
    state.swapIndex++;
  }

  /* ── stages ─────────────────────────────────────────────── */
  function enterStage(name) {
    state.stage = name;
    state.stageT = 0;

    if (name === 'swap') {
      state.swapIndex = 0;
      state.swapTimer = 0;
    }

    if (name === 'glitch') {
      state.chaos = 0.35;
      state.glitchSwap = 0;
      stage.dataset.glitch = '1';
      if (statusVal) statusVal.dataset.glitch = '1';   // in step with the heart
      bpmStatus.textContent = 'SIGNAL LOST';
      tone(1400, 0.5, 0.05, 'sawtooth', 120);
    }

    if (name === 'done') handOff();
  }

  let handedOver = false;

  function handOff() {
    if (handedOver) return;
    handedOver = true;

    stopLoadingDots();
    delete stage.dataset.glitch;
    root.style.setProperty('--glitch', '0');
    root.style.setProperty('--glitch-amt', '0');
    heartBtn.style.setProperty('--scale', '1');
    state.running = false;

    body.classList.remove('is-intro');
    body.classList.add('is-live');
    welcome.setAttribute('aria-hidden', 'true');
    setTimeout(() => { welcome.hidden = true; }, 900);

    const target = document.querySelector('.site-header__mark');
    if (target) target.focus({ preventScroll: true });
  }

  /* ── site status ────────────────────────────────────────── */
  let dotTimer = null;
  let dotStep = 0;

  function paintStatus() {
    // both the text and the copy the glitch layers read, so they stay in step
    const text = SITE_STATUS_OK + DOTS[dotStep % DOTS.length];
    statusVal.textContent = text;
    statusVal.dataset.text = text;
  }

  /* Silkscreen isn't monospaced, so a growing ellipsis changes the line's width
     and, since it is right-aligned, shunts the whole sentence sideways on every
     tick. Pin the box to its widest state and left-align inside it: the
     sentence stays put and the dots grow into space already reserved. */
  function pinStatusWidth() {
    statusVal.style.width = '';
    const held = statusVal.textContent;
    statusVal.textContent = SITE_STATUS_OK + DOTS[DOTS.length - 1];
    const w = statusVal.getBoundingClientRect().width;
    statusVal.textContent = held;
    if (w) statusVal.style.width = w.toFixed(2) + 'px';
  }

  function startLoadingDots() {
    if (!statusVal) return;
    pinStatusWidth();

    if (reduceMotion) { dotStep = DOTS.length - 1; paintStatus(); return; }

    clearInterval(dotTimer);
    dotStep = 0;
    paintStatus();
    dotTimer = setInterval(() => { dotStep++; paintStatus(); }, DOT_MS);
  }

  function stopLoadingDots() {
    clearInterval(dotTimer);
    dotTimer = null;
  }

  // the reserved width is measured in pixels, so it has to be retaken if the
  // type size changes under it
  addEventListener('resize', () => {
    if (statusVal && statusVal.style.width) pinStatusWidth();
  });

  /* ── readout ────────────────────────────────────────────── */
  let bpmTick = 0;

  function updateReadout(dt) {
    bpmTick -= dt;
    if (bpmTick > 0) return;
    bpmTick = state.stage === 'glitch' ? 0.06 : 0.2;

    if (state.stage === 'glitch' || state.stage === 'done') {
      bpmValue.textContent = (state.stage === 'done' || state.stageT > GLITCH_DUR * 0.6)
        ? '---'
        : String(Math.floor(Math.random() * 900) + 100);
      return;
    }

    if (state.alive) {
      bpmValue.textContent = String(Math.round(state.bpm) + (Math.random() < 0.3 ? 1 : 0));
    } else if (state.clicks > 0 && state.clicks <= STEPS.length) {
      bpmValue.textContent = String(STEPS[state.clicks - 1].shown);
    } else {
      bpmValue.textContent = '--';
    }
  }

  function updateStatus() {
    if (state.stage !== 'catch' && state.stage !== 'swap') return;
    const b = state.bpm;
    bpmStatus.textContent = b > 170 ? 'V-TACH' : b > 104 ? 'TACHYCARDIA' : 'SINUS RHYTHM';
  }

  /* ── clock ──────────────────────────────────────────────── */
  function onBeat() {
    if (state.amp > 0.05) beatSound(Math.min(state.amp, 1));
  }

  function advancePhase(d) {
    const before = state.t;
    state.t += d;
    state.phase = state.t % 1;

    if (Math.floor(state.t - R_PHASE) !== Math.floor(before - R_PHASE)) onBeat();

    if (state.mode === 'pulse' && state.t >= state.pulseEnd) {
      state.mode = 'flat';
      state.amp = state.ampTarget = 0;
      state.bpm = state.bpmTarget = 0;
    }
  }

  function runStages(dt) {
    if (!state.stage || state.stage === 'done') return;
    state.stageT += dt;

    if (state.stage === 'catch') {
      state.bpmTarget = CATCH_BPM;
      if (state.stageT >= CATCH_DUR) enterStage('swap');

    } else if (state.stage === 'swap') {
      const p = state.swapIndex / TOTAL_SWAPS;
      state.bpmTarget = CATCH_BPM + (PEAK_BPM - CATCH_BPM) * p;
      state.swapTimer -= dt;
      if (state.swapTimer <= 0) nextSwap();

    } else if (state.stage === 'glitch') {
      const p = Math.min(state.stageT / GLITCH_DUR, 1);
      // the canvas is up straight away, but the mangling escalates — the heart
      // should still be readable for a beat before it comes apart
      const opacity = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
      const distort = 0.22 + 0.78 * Math.min(p / 0.6, 1);

      root.style.setProperty('--glitch', opacity.toFixed(3));
      root.style.setProperty('--glitch-amt', distort.toFixed(3));
      if (!reduceMotion) {
        drawGlitch(distort);
        state.glitchSwap -= dt;
        if (state.glitchSwap <= 0) {
          setFrame(SEQUENCE[(Math.random() * SEQUENCE.length) | 0]);
          state.glitchSwap = 0.05;
        }
      }

      heartBtn.style.setProperty('--scale', (1 + p * 0.35).toFixed(3));
      state.chaos = 0.9 * distort;
      state.ampTarget = 0;
      state.bpmTarget = PEAK_BPM;

      if (p >= 1) { state.chaos = 0; enterStage('done'); }
    }
  }

  let last = performance.now();

  function frame(now) {
    // clamp both ends: a long pause must not fling the simulation forward, and a
    // clock that fails to advance must not hand it a zero or negative step
    const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
    last = now;

    // clicks decay if they aren't kept up
    if (!state.alive && state.clicks > 0) {
      state.cool -= dt;
      if (state.cool <= 0) {
        setClicks(state.clicks - 1);
        tone(150, 0.16, 0.05, 'triangle', 70);
      }
      cooldown.style.setProperty('--cool', Math.max(0, state.cool / COOLDOWN).toFixed(3));
    }

    // blood level: it surges with each pump, drains back if a click lapses, and
    // keeps rising on its own once the heart is away
    state.fill += (state.fillTarget - state.fill) *
      Math.min(1, dt * (state.alive ? 0.7 : 3));
    root.style.setProperty('--fill', state.fill.toFixed(4));
    if (fluid) {
      if (state.fill > 0.002) fluid.dataset.on = '1';
      else delete fluid.dataset.on;
    }

    state.amp += (state.ampTarget - state.amp) * Math.min(1, dt * 2.2);
    state.surge *= Math.exp(-dt * 0.6);
    state.bpm += (state.bpmTarget + state.surge - state.bpm) * Math.min(1, dt * state.ease);

    runStages(dt);

    colAcc += COLS_PER_SEC * dt;
    const cols = Math.floor(colAcc);
    colAcc -= cols;

    const dPhase = (state.bpm / 60) / COLS_PER_SEC;
    for (let i = 0; i < cols; i++) {
      advancePhase(dPhase);
      pushColumn();
    }

    drawGrid();
    drawTrace();

    if (state.stage !== 'glitch') {
      const sq = squeeze(state.phase) * state.amp;
      state.beat = Math.min(sq / SQUEEZE_MAX, 1);
      heartBtn.style.setProperty('--scale', (1 + sq * (reduceMotion ? 0.35 : 1)).toFixed(4));
      root.style.setProperty('--beat', state.beat.toFixed(3));
    }

    updateReadout(dt);
    updateStatus();

    if (state.running) requestAnimationFrame(frame);
  }

  /* ── interaction ────────────────────────────────────────── */
  const setVitality = (v) => root.style.setProperty('--vitality', String(v));

  function setClicks(n) {
    state.clicks = n;
    state.cool = n > 0 ? COOLDOWN : 0;
    bpmTick = 0;

    pipEls.forEach((pip, i) => {
      if (i < n) pip.dataset.on = '1';
      else delete pip.dataset.on;
    });
    setVitality(n / CLICKS_TO_REVIVE);
    state.fillTarget = n * FILL_PER_CLICK;
    cooldown.dataset.on = (n > 0 && n < CLICKS_TO_REVIVE) ? '1' : '0';

    if (n === 0) {
      bpmStatus.textContent = 'ASYSTOLE';
      prompt.textContent = 'CLICK THE HEART';
      heartImg.alt = 'A pixel-art human heart, still and grey.';
    } else if (n < CLICKS_TO_REVIVE) {
      bpmStatus.textContent = STEPS[n - 1].status;
      prompt.textContent = n === CLICKS_TO_REVIVE - 1 ? 'ONE MORE' : 'AGAIN';
      heartImg.alt = 'A pixel-art human heart, flickering back to life.';
    }
  }

  function revive() {
    state.alive = true;
    state.mode = 'alive';
    state.ampTarget = 1;
    state.fillTarget = 1;          // keeps filling once it is beating on its own
    state.bpm = 46;
    state.ease = 3;

    startLoadingDots();                    // threshold met: the site starts loading

    stage.dataset.alive = '1';
    prompt.dataset.done = '1';
    pips.dataset.done = '1';
    cooldown.dataset.on = '0';
    heartImg.alt = 'A pixel-art human heart, beating hard and speeding up.';

    enterStage('catch');
  }

  function onHeartClick() {
    ensureAudio();

    if (state.alive) {
      state.surge = Math.min(state.surge + 15, 40);
      tone(1200, 0.05, 0.03);
      return;
    }

    const n = state.clicks + 1;
    if (n >= CLICKS_TO_REVIVE) {
      setClicks(CLICKS_TO_REVIVE);
      revive();
      return;
    }

    setClicks(n);

    const step = STEPS[n - 1];
    state.mode = 'pulse';
    state.t = 0;
    state.phase = 0;
    state.pulseEnd = 1;
    state.amp = state.ampTarget = step.amp;
    state.bpm = state.bpmTarget = 75;
  }

  heartBtn.addEventListener('click', onHeartClick);
  skipBtn.addEventListener('click', handOff);
  if (replayBtn) replayBtn.addEventListener('click', () => location.reload());
  addEventListener('resize', sizeCrt);

  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) { ensureAudio(); tone(660, 0.06, 0.04); }
  });

  /* ── go ─────────────────────────────────────────────────── */
  const yearEl = $('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  sizeCrt();
  setVitality(0);
  for (let i = 0; i < W; i++) pushColumn();
  requestAnimationFrame(frame);
})();
