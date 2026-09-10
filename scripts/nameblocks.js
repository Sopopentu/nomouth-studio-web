/* Name blocks that fall around the logo in the hero.

   The logo is immovable terrain: its silhouette is read out of the PNG's alpha
   channel and rebuilt as a chain of static bodies, so the blocks pile up beside
   it and have to be dragged over it rather than through it.

   Dragging is handled with pointer events on the chips themselves rather than
   Matter's Mouse, which calls preventDefault on every touchmove over its
   element — that would stop the page scrolling past the hero on a phone. */
(() => {
  'use strict';

  const stage = document.getElementById('heroStage');
  const layer = document.getElementById('heroBlocks');
  const logo  = document.getElementById('heroLogo');
  if (!stage || !layer || !logo) return;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof Matter === 'undefined') return;          // CDN blocked: static row

  const { Engine, Composite, Bodies, Body, Vector, Sleeping } = Matter;

  const CHIPS = Array.from(layer.querySelectorAll('.chip'));
  if (!CHIPS.length) return;

  const say     = document.getElementById('heroSay');
  const sayText = document.getElementById('heroSayText');
  const sayRest = document.getElementById('heroSayRest');
  const TYPE_MS = 26;    // per character
  const HOLD_MS = 1100;  // how long the finished line lingers after letting go

  const SAMPLES = 120;   // collision columns across the logo
  const SKIN    = 26;    // thickness of the smooth surface strip along the top
  const MAX_STEP = 24;   // px a block may travel in one frame; stops it being
                         // rammed through the logo by a fast drag
  const FOLLOW  = 0.30;  // how hard a held block chases the pointer
  const WALL    = 400;
  const INSET   = 4;     // keep bodies off the very edge, so nothing clips
  const TILT    = 0.70;  // rad; names tumble, but never far enough to be unreadable
  const DROP    = [0.18, 0.5, 0.82];   // where they enter, across the stage

  let engine = null, entries = [], drag = null, raf = null, running = false;
  let wiring = null;   // AbortController for the current set of chip listeners

  /* Scan the logo column by column and return, for each column, the vertical
     runs of solid artwork as normalised [top, bottom] pairs.

     Runs rather than a single top-down heightmap: a heightmap fills the hole in
     the hair loop, fills the concave gap between the two figures, and squares
     off every overhang, which is what made the collision feel like a box.

     Solid means dark, not merely opaque. The logo is stroked with a white
     outline that is invisible on the white hero but fully opaque, so testing
     alpha alone grows the collision shape past the black edge all the way
     round. */
  function scanLogo() {
    const w = 320;
    const h = Math.max(1, Math.round(logo.naturalHeight * w / logo.naturalWidth));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(logo, 0, 0, w, h);

    let data;
    try { data = cx.getImageData(0, 0, w, h).data; }
    catch (err) { return null; }                      // tainted canvas

    const cols = [];
    for (let i = 0; i < SAMPLES; i++) {
      const px = Math.min(w - 1, Math.floor((i + 0.5) * w / SAMPLES));
      const runs = [];
      let start = -1;

      for (let y = 0; y <= h; y++) {
        let solid = false;
        if (y < h) {
          const o = (y * w + px) * 4;
          const lum = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
          solid = data[o + 3] > 100 && lum < 128;
        }
        if (solid && start < 0) start = y;
        else if (!solid && start >= 0) {
          if (y - start > 1) runs.push([start / h, y / h]);
          start = -1;
        }
      }
      cols.push(runs);
    }
    return cols;
  }

  /* ── build the world ──────────────────────────────────────────────── */
  function build() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return false;

    engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1.4;
    // narrow gaps beside the logo pinch the blocks; a stiffer solver stops
    // them being squeezed out through the walls
    engine.positionIterations = 12;
    engine.velocityIterations = 8;

    const statics = [
      Bodies.rectangle(W / 2, H + WALL / 2, W + WALL * 2, WALL, { isStatic: true }),
      Bodies.rectangle(INSET - WALL / 2, H / 2, WALL, H * 6, { isStatic: true }),
      Bodies.rectangle(W - INSET + WALL / 2, H / 2, WALL, H * 6, { isStatic: true }),
      Bodies.rectangle(W / 2, -H * 2 - WALL / 2, W + WALL * 2, WALL, { isStatic: true })
    ];

    const lr = logo.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const lx = lr.left - sr.left, ly = lr.top - sr.top, lw = lr.width, lh = lr.height;

    const cols = scanLogo();

    if (!cols) {
      // Couldn't read the logo's pixels — a page opened straight off disk taints
      // the canvas. Fall back to a plain block over the logo so it is still
      // solid, rather than letting everything drop through it.
      statics.push(Bodies.rectangle(
        lx + lw / 2, ly + lh * 0.62, lw * 0.82, lh * 0.76,
        { isStatic: true, friction: 0.25 }));
    }

    if (cols) {
      const step = lw / SAMPLES;
      // the outer surface of a column is the top of its first run
      const pt = (i) => cols[i] && cols[i].length
        ? { x: lx + (i + 0.5) * step, y: ly + cols[i][0][0] * lh }
        : null;

      // A box per solid run, so the shape matches the artwork — holes stay
      // holes and overhangs stay overhangs.
      for (let i = 0; i < SAMPLES; i++) {
        const x = lx + (i + 0.5) * step;
        for (const [t, b] of cols[i]) {
          const y0 = ly + t * lh;
          const hgt = (b - t) * lh;
          if (hgt < 2) continue;
          statics.push(Bodies.rectangle(
            x, y0 + hgt / 2, step + 1, hgt,
            { isStatic: true, friction: 0.25 }));
        }
      }

      // Then a smooth strip along the top edge, so blocks slide down the slopes
      // instead of catching on the column steps.
      for (let i = 0; i < SAMPLES - 1; i++) {
        const a = pt(i), b = pt(i + 1);
        if (!a || !b) continue;

        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;

        // Sink each slab along the surface normal, not straight down. On the
        // steep sides of the logo a downward offset ends up rotated sideways
        // and the slab juts out into the gap beside it.
        let nx = -dy / len, ny = dx / len;
        if (ny < 0) { nx = -nx; ny = -ny; }

        const seg = Bodies.rectangle(
          (a.x + b.x) / 2 + nx * SKIN / 2,
          (a.y + b.y) / 2 + ny * SKIN / 2,
          len + step, SKIN,
          { isStatic: true, friction: 0.25 }
        );
        Body.setAngle(seg, Math.atan2(dy, dx));
        statics.push(seg);
      }
    }
    Composite.add(engine.world, statics);

    entries = CHIPS.map((el, i) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(40, r.width), h = Math.max(24, r.height);
      const body = Bodies.rectangle(
        W * DROP[i % DROP.length], -90 - i * 150, w, h,
        { chamfer: { radius: Math.min(12, h / 2) },
          restitution: 0.16, friction: 0.25, frictionAir: 0.012, density: 0.0018 }
      );
      Body.setAngle(body, (Math.random() - 0.5) * 0.5);
      return { el, body, w, h };
    });
    Composite.add(engine.world, entries.map((e) => e.body));

    layer.dataset.live = '1';
    return true;
  }

  /* ── the line that types itself out while a name is held ──────────── */
  let typeTimer = null, hideTimer = null;

  function startTyping(text) {
    if (!say || !sayText || !text) return;
    clearInterval(typeTimer);
    clearTimeout(hideTimer);

    // Reserve the whole line up front — revealed text, the caret's one cell,
    // and the remainder held open but invisible — so characters appear in place
    // instead of the box growing and shoving them along.
    say.style.width = (text.length + 1) + 'ch';
    sayText.textContent = '';
    if (sayRest) sayRest.textContent = text;
    say.dataset.on = '1';
    delete say.dataset.done;

    let i = 0;
    typeTimer = setInterval(() => {
      sayText.textContent = text.slice(0, i);
      if (sayRest) sayRest.textContent = text.slice(i + 1);   // caret covers text[i]
      if (++i > text.length) {
        clearInterval(typeTimer);
        typeTimer = null;
        say.dataset.done = '1';
      }
    }, TYPE_MS);
  }

  function stopTyping() {
    if (!say) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      clearInterval(typeTimer);
      typeTimer = null;
      delete say.dataset.on;
    }, HOLD_MS);
  }

  function clearTyping() {
    clearInterval(typeTimer); clearTimeout(hideTimer);
    typeTimer = hideTimer = null;
    if (say) { delete say.dataset.on; delete say.dataset.done; say.style.width = ''; }
    if (sayText) sayText.textContent = '';
    if (sayRest) sayRest.textContent = '';
  }

  /* ── drag ─────────────────────────────────────────────────────────── */
  const local = (e) => {
    const r = layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onDown(entry, e) {
    if (drag || !engine || !e.isPrimary) return;
    e.preventDefault();

    const p = local(e);
    const b = entry.body;
    Sleeping.set(b, false);

    // Grab offset in the body's own frame, so it keeps hanging off the point
    // you picked it up by.
    const grab = Vector.rotate(
      { x: p.x - b.position.x, y: p.y - b.position.y }, -b.angle);

    drag = { entry, grab, pointer: p, id: e.pointerId };
    try { entry.el.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
    layer.dataset.dragging = '1';
    startTyping(entry.el.dataset.role);
    start();
  }

  function endDrag() {
    if (!drag) return;
    try { drag.entry.el.releasePointerCapture(drag.id); } catch (err) { /* ignore */ }
    delete layer.dataset.dragging;
    drag = null;
    stopTyping();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;

    // A mouse still "moving" with no button held means the release never
    // reached us — let go rather than keeping the block glued to the cursor.
    if (e.pointerType === 'mouse' && e.buttons === 0) { endDrag(); return; }

    e.preventDefault();
    drag.pointer = local(e);
    Sleeping.set(drag.entry.body, false);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    endDrag();
  }

  /* Rebuilding on resize makes a fresh set of bodies. The listeners have to go
     with them — leave the old ones attached and the first of them wins the
     pointerdown, handing the drag to a body that is no longer in the world. */
  function wire(entry) {
    entry.el.addEventListener('pointerdown', (e) => onDown(entry, e),
      { signal: wiring.signal });
  }

  /* Move and release listen on the window, not on the chip.
     Hanging them off the chip makes letting go depend on setPointerCapture
     having taken — and when it hasn't, a release anywhere off the block is
     never seen. Moves still arrive (the block is under the cursor, because it
     is chasing it), so the drag feeds itself and the block sticks to the
     pointer. The window sees the release wherever it happens. */
  function wireWindow() {
    const opts = { signal: wiring.signal };
    addEventListener('pointermove', onMove, opts);
    addEventListener('pointerup', onUp, opts);
    addEventListener('pointercancel', onUp, opts);
    addEventListener('blur', endDrag, opts);        // released outside the page
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) endDrag();
    }, opts);
  }

  /* ── loop ─────────────────────────────────────────────────────────── */
  function sync() {
    for (const e of entries) {
      e.el.style.transform =
        `translate(${(e.body.position.x - e.w / 2).toFixed(1)}px,` +
        `${(e.body.position.y - e.h / 2).toFixed(1)}px)` +
        ` rotate(${e.body.angle.toFixed(4)}rad)`;
    }
  }

  /* Steering a held block by velocity, rather than pinning it to a Matter
     Constraint. A constraint moves the body directly and will happily push it
     straight through the logo; a velocity goes through the collision solver, so
     the logo actually stops it. */
  function steer() {
    if (!drag) return;
    const b = drag.entry.body;
    const off = Vector.rotate(drag.grab, b.angle);
    let vx = (drag.pointer.x - off.x - b.position.x) * FOLLOW;
    let vy = (drag.pointer.y - off.y - b.position.y) * FOLLOW;

    const sp = Math.hypot(vx, vy);
    if (sp > MAX_STEP) { vx = vx / sp * MAX_STEP; vy = vy / sp * MAX_STEP; }

    Body.setVelocity(b, { x: vx, y: vy });
  }

  let last = 0;
  function frame(now) {
    // clamp both ends: a long pause must not fling the bodies, and a clock that
    // fails to advance must not feed Matter a zero or negative step
    const dt = last ? Math.max(1, Math.min(now - last, 32)) : 16.7;
    last = now;
    steer();
    Engine.update(engine, dt);

    // A block that lands on its end is just an unreadable name, so cap the tilt.
    // Wrapping first keeps a fast spin from snapping the long way round, and the
    // spin is damped rather than zeroed — killing it outright wedges blocks
    // against a slope instead of letting them slide off it.
    for (const e of entries) {
      // cap the per-frame step, or a hard throw skips straight over the terrain
      const v = e.body.velocity;
      const sp = Math.hypot(v.x, v.y);
      if (sp > MAX_STEP) {
        Body.setVelocity(e.body, { x: v.x / sp * MAX_STEP, y: v.y / sp * MAX_STEP });
      }

      const a = Math.atan2(Math.sin(e.body.angle), Math.cos(e.body.angle));
      if (a > TILT || a < -TILT) {
        Body.setAngle(e.body, a > 0 ? TILT : -TILT);
        Body.setAngularVelocity(e.body, e.body.angularVelocity * 0.3);
      }
    }

    sync();

    // everything settled and nobody holding one: stop burning frames
    if (!drag && entries.every((e) => e.body.isSleeping)) { stop(); return; }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || !engine) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* ── lifecycle ────────────────────────────────────────────────────── */
  function init() {
    stop();
    if (wiring) wiring.abort();
    wiring = new AbortController();
    if (engine) { Composite.clear(engine.world, false); Engine.clear(engine); }
    engine = null; entries = []; drag = null;
    delete layer.dataset.dragging;
    clearTyping();


    if (!build()) return;
    entries.forEach(wire);
    wireWindow();
    sync();
    start();
  }

  function whenReady(fn) {
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    if (logo.complete && logo.naturalWidth) fonts.then(fn);
    else logo.addEventListener('load', () => fonts.then(fn), { once: true });
  }

  whenReady(init);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      if (!engine) return;
      if (es[0].isIntersecting) start(); else stop();
    }, { threshold: 0 }).observe(stage);
  }

  let resizeT;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => whenReady(init), 250);
  });
})();
