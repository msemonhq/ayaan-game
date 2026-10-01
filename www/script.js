/* Ayaan — Antigravity Memory Matrix
 * Vanilla JS, no dependencies.
 *
 * How a round works
 *   1. WATCH  – friendly shapes float in the chamber and light up one by one (with a note each).
 *   2. YOUR TURN – the shapes start to drift; Ayaan taps them in the same order.
 *   3. Every correct tap gets an instant pop, sparkle and note. A wrong tap is gentle:
 *      a soft wobble + soft sound, then the SAME sequence is shown again. No lives, no timer.
 *
 * Tune difficulty in LEVELS below.
 */
(() => {
  'use strict';

  /* ===================== Settings ===================== */

  const LEVELS = [
    // count = objects (and sequence length), speed = drift in px/s (at ~400px screen width),
    // edge  = 'none' | 'soft' (gentle turn-around near edges) | 'rebound' (bounce off edges),
    // rounds = how many rounds make a level (one star each)
    { count: 3, speed: 0,  edge: 'none',    rounds: 3 }, // Level 1: stationary
    { count: 4, speed: 36, edge: 'soft',    rounds: 3 }, // Level 2: slow drift
    { count: 5, speed: 72, edge: 'rebound', rounds: 3 }, // Level 3: moderate drift + rebounds
  ];

  const SHOW_HOLD_MS = 650;   // how long each shape stays lit while being shown
  const SHOW_GAP_MS = 300;    // pause between shapes while being shown
  const HIT_PADDING = 0.4;    // extra forgiving tap area (fraction of shape radius)
  const AMBIENT_COUNT = 5;    // floating shapes on the home screen
  const AMBIENT_SPEED = 40;

  // Okabe-Ito colour-blind-safe palette. Every colour has its own shape AND its own musical
  // note, so a shape can be recognised by colour, outline, or sound.
  const SHAPES = [
    { id: 'star',     color: '#F0E442', note: 261.63 }, // C4
    { id: 'circle',   color: '#56B4E9', note: 293.66 }, // D4
    { id: 'triangle', color: '#E69F00', note: 329.63 }, // E4
    { id: 'square',   color: '#009E73', note: 392.00 }, // G4
    { id: 'diamond',  color: '#CC79A7', note: 440.00 }, // A4
    { id: 'hexagon',  color: '#D55E00', note: 523.25 }, // C5
  ];
  const CONFETTI_COLORS = SHAPES.map(s => s.color);
  const NAVY = '#0B1026';

  /* ===================== Helpers ===================== */

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* storage unavailable: fine */ }
    },
  };

  /* ===================== DOM ===================== */

  const $ = id => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const el = {
    topbar: $('topbar'),
    levelLabel: $('level-label'),
    stars: $('stars'),
    prompt: $('prompt'),
    promptIcon: $('prompt-icon'),
    promptText: $('prompt-text'),
    dots: $('dots'),
    home: $('screen-home'),
    homeLevel: $('home-level'),
    level: $('screen-level'),
    levelTitle: $('level-title'),
    levelStars: $('level-stars'),
    done: $('screen-done'),
    btnPlay: $('btn-play'),
    btnNext: $('btn-next'),
    btnAgain: $('btn-again'),
    btnHome: $('btn-home'),
    btnSound: $('btn-sound'),
  };

  /* ===================== State ===================== */

  const world = { w: 0, h: 0, dpr: 1, unit: 1, r: 40, x0: 0, y0: 0, x1: 0, y1: 0 };

  const state = {
    screen: 'home',        // home | playing | levelDone | allDone
    phase: 'idle',         // idle | showing | input | retry | success
    level: 0,
    roundsWon: 0,
    objects: [],
    seq: [],
    idx: 0,
    fails: 0,
    drift: { speed: 0, edge: 'none' },
    motion: 0,             // 0..1, eased so drifting starts and stops smoothly
    motionTarget: 0,
  };

  let progress = clamp(parseInt(store.get('ayaan.level', '0'), 10) || 0, 0, LEVELS.length - 1);

  /* ===================== Timers ===================== */

  let timers = [];
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      fn();
    }, ms);
    timers.push(id);
    return id;
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* ===================== Audio (Web Audio, no files needed) ===================== */

  const audio = { ctx: null, muted: store.get('ayaan.muted', '0') === '1' };

  function ensureAudio() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { audio.ctx = new AC(); } catch (e) { audio.ctx = null; } }
    }
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  }

  function tone(freq, opts) {
    if (audio.muted || !audio.ctx) return;
    const o = Object.assign({ dur: 0.3, type: 'sine', vol: 0.14, delay: 0, glide: 1 }, opts);
    const c = audio.ctx;
    const t0 = c.currentTime + o.delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * o.glide, t0 + o.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(o.vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  const sfx = {
    show(shape)    { tone(shape.note, { dur: 0.55, vol: 0.16 }); },
    correct(shape) {
      tone(shape.note, { dur: 0.35, vol: 0.16 });
      tone(shape.note * 2, { dur: 0.22, vol: 0.06, type: 'triangle', delay: 0.05 });
    },
    // gentle, low, soft "bloop" – never a buzzer
    oops() {
      tone(246.94, { dur: 0.38, vol: 0.09, glide: 0.85 });
      tone(207.65, { dur: 0.45, vol: 0.08, glide: 0.9, delay: 0.18 });
    },
    star() {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, { dur: 0.3, vol: 0.12, delay: i * 0.11 }));
    },
    level() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { dur: 0.45, vol: 0.12, delay: i * 0.14 }));
      tone(1568, { dur: 0.7, vol: 0.05, type: 'triangle', delay: 0.5 });
    },
  };

  function setSoundIcon() {
    el.btnSound.textContent = audio.muted ? '🔇' : '🔊';
    el.btnSound.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
  }

  /* ===================== Layout ===================== */

  function computeArea() {
    const topbarBottom = el.topbar.getBoundingClientRect().bottom;
    const pad = 10;
    world.x0 = pad;
    world.x1 = world.w - pad;
    world.y0 = Math.max(110, topbarBottom + 8);
    world.y1 = world.h - pad;
    const areaMin = Math.min(world.x1 - world.x0, world.y1 - world.y0);
    world.r = clamp(Math.min(world.w, world.h) * 0.115, 36, 72);
    world.r = Math.min(world.r, areaMin / 3.4);
  }

  function resize() {
    const prev = { x0: world.x0, y0: world.y0, w: world.x1 - world.x0, h: world.y1 - world.y0 };
    world.w = window.innerWidth;
    world.h = window.innerHeight;
    world.dpr = Math.min(window.devicePixelRatio || 1, 2);
    world.unit = Math.min(world.w, world.h) / 400;
    canvas.width = Math.round(world.w * world.dpr);
    canvas.height = Math.round(world.h * world.dpr);
    computeArea();

    // keep shapes at the same relative place when the screen size/orientation changes
    if (prev.w > 0 && prev.h > 0) {
      for (const o of state.objects) {
        const nx = clamp((o.x - prev.x0) / prev.w, 0, 1);
        const ny = clamp((o.y - prev.y0) / prev.h, 0, 1);
        o.r = world.r;
        o.x = clamp(world.x0 + nx * (world.x1 - world.x0), world.x0 + o.r, world.x1 - o.r);
        o.y = clamp(world.y0 + ny * (world.y1 - world.y0), world.y0 + o.r, world.y1 - o.r);
      }
      relax(state.objects);
    }
  }

  // after a resize/rotation, nudge shapes apart so none sit on top of another
  function relax(objs) {
    for (let k = 0; k < 40; k++) {
      let moved = false;
      for (let i = 0; i < objs.length; i++) {
        for (let j = i + 1; j < objs.length; j++) {
          const a = objs[i], b = objs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minD = (a.r + b.r) * 1.02;
          if (dist < minD) {
            const nx = dx / dist, ny = dy / dist, push = (minD - dist) / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
            moved = true;
          }
        }
      }
      for (const o of objs) {
        o.x = clamp(o.x, world.x0 + o.r, world.x1 - o.r);
        o.y = clamp(o.y, world.y0 + o.r, world.y1 - o.r);
      }
      if (!moved) break;
    }
  }

  /* ===================== Objects ===================== */

  function placePoints(n) {
    const r = world.r;
    const minX = world.x0 + r, maxX = world.x1 - r;
    const minY = world.y0 + r, maxY = world.y1 - r;
    let gap = r * 2.5;
    for (let attempt = 0; attempt < 8; attempt++) {
      const pts = [];
      for (let tries = 0; pts.length < n && tries < 500; tries++) {
        const p = { x: rand(minX, maxX), y: rand(minY, maxY) };
        if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= gap)) pts.push(p);
      }
      if (pts.length === n) return pts;
      gap *= 0.88;
    }
    // fallback: a simple even grid
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, rr = Math.floor(i / cols);
      pts.push({
        x: minX + (cols === 1 ? 0.5 : c / (cols - 1)) * (maxX - minX),
        y: minY + (rows === 1 ? 0.5 : rr / (rows - 1)) * (maxY - minY),
      });
    }
    return pts;
  }

  function newObject(shape, x, y, speed) {
    const a = rand(0, TAU);
    const sp = speed * world.unit;
    return {
      shape, x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: world.r, by: 0, phase: rand(0, TAU),
      glow: 0, glowTarget: 0, pop: 0, wobble: 0, squash: 0,
      done: false, lastCorrectAt: -1e9,
    };
  }

  function buildObjects(count, speed) {
    const shapes = shuffle(SHAPES.slice()).slice(0, count);
    const pts = placePoints(count);
    return shapes.map((s, i) => newObject(s, pts[i].x, pts[i].y, speed));
  }

  function pickObject(px, py) {
    const pad = Math.max(12, world.r * HIT_PADDING);
    let best = null, bestD = Infinity;
    for (const o of state.objects) {
      const d = Math.hypot(px - o.x, py - (o.y + o.by));
      if (d <= o.r * 1.15 + pad && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /* ===================== Physics (zero gravity) ===================== */

  function stepObject(o, dt, drift) {
    const target = drift.speed * world.unit;
    const sp = Math.hypot(o.vx, o.vy);

    // zero-g: no gravity, no friction – just ease the speed back to the level's drift speed
    if (sp < 1e-3) {
      const a = rand(0, TAU);
      o.vx = Math.cos(a) * target;
      o.vy = Math.sin(a) * target;
    } else {
      const k = 1 + ((target - sp) / sp) * Math.min(1, dt * 1.5);
      o.vx *= k;
      o.vy *= k;
    }

    if (drift.edge === 'soft') {
      // a gentle "force field" that turns shapes around before they reach the edge
      const bandX = Math.min(o.r * 0.9, Math.max(0, (world.x1 - world.x0 - 2 * o.r) / 4));
      const bandY = Math.min(o.r * 0.9, Math.max(0, (world.y1 - world.y0 - 2 * o.r) / 4));
      const lx = world.x0 + o.r + bandX, rx = world.x1 - o.r - bandX;
      const ty = world.y0 + o.r + bandY, by = world.y1 - o.r - bandY;
      const k = 6;
      if (o.x < lx) o.vx += (lx - o.x) * k * dt; else if (o.x > rx) o.vx -= (o.x - rx) * k * dt;
      if (o.y < ty) o.vy += (ty - o.y) * k * dt; else if (o.y > by) o.vy -= (o.y - by) * k * dt;
    }

    o.x += o.vx * state.motion * dt;
    o.y += o.vy * state.motion * dt;

    const rebound = drift.edge === 'rebound';
    const keep = rebound ? 0.98 : 0.5;
    const minX = world.x0 + o.r, maxX = world.x1 - o.r;
    const minY = world.y0 + o.r, maxY = world.y1 - o.r;
    if (o.x < minX) { o.x = minX; if (o.vx < 0) { o.vx = -o.vx * keep; if (rebound) o.squash = 1; } }
    else if (o.x > maxX) { o.x = maxX; if (o.vx > 0) { o.vx = -o.vx * keep; if (rebound) o.squash = 1; } }
    if (o.y < minY) { o.y = minY; if (o.vy < 0) { o.vy = -o.vy * keep; if (rebound) o.squash = 1; } }
    else if (o.y > maxY) { o.y = maxY; if (o.vy > 0) { o.vy = -o.vy * keep; if (rebound) o.squash = 1; } }
  }

  // soft, equal-mass collisions so shapes never stack on top of each other
  function collide(objs) {
    for (let i = 0; i < objs.length; i++) {
      for (let j = i + 1; j < objs.length; j++) {
        const a = objs[i], b = objs[j];
        const dx = b.x - a.x, dy = (b.y + 0) - a.y;
        const dist = Math.hypot(dx, dy);
        const minD = (a.r + b.r) * 0.96;
        if (dist < minD && dist > 0.001) {
          const nx = dx / dist, ny = dy / dist;
          const push = (minD - dist) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            a.vx += rv * nx; a.vy += rv * ny;
            b.vx -= rv * nx; b.vy -= rv * ny;
          }
        }
      }
    }
  }

  /* ===================== Particles ===================== */

  const particles = [];

  function burst(x, y, color, n) {
    const count = reduced ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), sp = rand(70, 200) * world.unit;
      particles.push({
        kind: i % 3 === 0 ? 'spark' : 'dot', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30 * world.unit,
        life: 0, max: rand(0.5, 0.85), color, size: rand(3, 6) * world.unit, drag: 2.4,
      });
    }
  }

  // confetti that floats UP – it's an antigravity chamber
  function confetti(n) {
    const count = reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      particles.push({
        kind: i % 2 ? 'spark' : 'dot',
        x: rand(0, world.w), y: rand(world.h * 0.55, world.h + 20),
        vx: rand(-18, 18) * world.unit, vy: -rand(50, 130) * world.unit,
        life: 0, max: rand(2.0, 3.2),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: rand(5, 9) * world.unit, drag: 0.2,
      });
    }
  }

  function ripple(x, y, color) {
    particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.45, color, size: world.r * 0.5, drag: 0 });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
    }
  }

  /* ===================== Drawing ===================== */

  const bgStars = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(),
    size: rand(0.8, 2.4), v: rand(0.004, 0.02), phase: rand(0, TAU),
  }));

  function starPath(cx, cy, outer, inner, points, rot) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = rot + (i * Math.PI) / points;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function polyPath(sides, rad, rot, dy) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * TAU) / sides;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad + dy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // returns { faceScale, faceDy } so the face sits nicely inside each shape
  function shapePath(id, R) {
    switch (id) {
      case 'circle':
        ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); return { s: 1, dy: 0 };
      case 'square':
        roundRectPath(-R * 0.84, -R * 0.84, R * 1.68, R * 1.68, R * 0.26); return { s: 1, dy: 0 };
      case 'triangle':
        polyPath(3, R * 1.12, -Math.PI / 2, R * 0.2); return { s: 0.82, dy: R * 0.2 };
      case 'diamond':
        polyPath(4, R * 1.05, -Math.PI / 2, 0); return { s: 0.78, dy: 0 };
      case 'hexagon':
        polyPath(6, R, 0, 0); return { s: 1, dy: 0 };
      case 'star':
      default:
        starPath(0, 0, R * 1.1, R * 0.55, 5, -Math.PI / 2); return { s: 0.74, dy: R * 0.04 };
    }
  }

  function drawFace(u, dy, open) {
    ctx.fillStyle = NAVY;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * 0.34 * u, dy - 0.12 * u, 0.12 * u, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * 0.34 * u + 0.04 * u, dy - 0.16 * u, 0.04 * u, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = NAVY;
    ctx.strokeStyle = NAVY;
    ctx.lineCap = 'round';
    if (open) {
      ctx.beginPath();
      ctx.arc(0, dy + 0.1 * u, 0.3 * u, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.lineWidth = 0.09 * u;
      ctx.beginPath();
      ctx.arc(0, dy + 0.05 * u, 0.3 * u, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }

  function drawObject(o) {
    const R = o.r;
    let scale = 1 + o.glow * 0.3;
    if (o.pop > 0) scale += 0.38 * Math.sin((1 - o.pop) * Math.PI);
    const sx = scale * (1 + o.squash * 0.12);
    const sy = scale * (1 - o.squash * 0.12);
    const wob = Math.sin(o.wobble * 20) * 0.16 * o.wobble;
    const rock = reduced ? 0 : Math.sin(o.phase + performance.now() / 1000 * 0.8) * 0.07;

    ctx.save();
    ctx.translate(o.x, o.y + o.by);
    ctx.rotate(rock + wob);
    ctx.scale(sx, sy);

    // glow halo while a shape is being shown / popped
    if (o.glow > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.9 * o.glow;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.42, 0, TAU);
      ctx.stroke();
      ctx.restore();
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 30 * o.glow * world.dpr;
    }

    const face = shapePath(o.shape.id, R);
    ctx.fillStyle = o.shape.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, R * 0.08);
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    drawFace(R * face.s, face.dy, o.glow > 0.4 || o.pop > 0.2);

    // "already tapped" ring – shows progress without giving the answer away
    if (o.done) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.3, 0, TAU);
      ctx.stroke();
    }

    // gentle lavender ring for a not-quite tap (never red)
    if (o.wobble > 0.02) {
      ctx.globalAlpha = o.wobble * 0.85;
      ctx.strokeStyle = '#B8A9FF';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, R * (1.25 + (1 - o.wobble) * 0.35), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = clamp(k, 0, 1);
      if (p.kind === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + (1 - k) * 46 * world.unit, 0, TAU);
        ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color;
        starPath(p.x, p.y, p.size * 1.6, p.size * 0.6, 4, 0);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, world.h);
    g.addColorStop(0, '#0B1026');
    g.addColorStop(1, '#1B1B4B');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);

    const neb = (cx, cy, rad, rgba) => {
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      rg.addColorStop(0, rgba);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, world.w, world.h);
    };
    const wob = reduced ? 0 : 1;
    neb(world.w * 0.2 + Math.sin(t * 0.07) * 30 * wob, world.h * 0.3, world.w * 0.8, 'rgba(86,180,233,0.12)');
    neb(world.w * 0.85 + Math.cos(t * 0.05) * 30 * wob, world.h * 0.75, world.w * 0.8, 'rgba(204,121,167,0.10)');

    ctx.fillStyle = '#FFFFFF';
    for (const s of bgStars) {
      // slow twinkle (period ~7s, never a flash)
      ctx.globalAlpha = reduced ? 0.7 : 0.55 + 0.3 * Math.sin(t * 0.9 + s.phase);
      ctx.beginPath();
      ctx.arc(s.x * world.w, s.y * world.h, s.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    drawBackground(t);
    for (const o of state.objects) drawObject(o);
    drawParticles();
  }

  /* ===================== Update loop ===================== */

  function update(dt, t) {
    for (const s of bgStars) {
      s.y -= s.v * dt;              // the whole sky drifts upward, very slowly
      if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
    }

    state.motion += (state.motionTarget - state.motion) * Math.min(1, dt * 3);
    const moving = state.drift.speed > 0 && state.motion > 0.01;
    const bobAmp = reduced ? 0 : world.r * 0.07;

    for (const o of state.objects) {
      o.glow += (o.glowTarget - o.glow) * Math.min(1, dt * 9);
      if (o.pop > 0) o.pop = Math.max(0, o.pop - dt * 2.6);
      if (o.wobble > 0) o.wobble = Math.max(0, o.wobble - dt * 1.5);
      if (o.squash > 0) o.squash = Math.max(0, o.squash - dt * 5);
      o.by = Math.sin(t * 1.3 + o.phase) * bobAmp;   // gentle float in place
      if (moving) stepObject(o, dt, state.drift);
    }
    if (moving && state.motion > 0.05) collide(state.objects);
    updateParticles(dt);
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    update(dt, now / 1000);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  /* ===================== UI helpers ===================== */

  function setPrompt(icon, text, mood) {
    el.promptIcon.textContent = icon;
    el.promptText.textContent = text;
    el.prompt.className = 'mood-' + mood;
  }

  function buildDots(n) {
    el.dots.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      el.dots.appendChild(d);
    }
  }

  function fillDots(k) {
    Array.from(el.dots.children).forEach((d, i) => d.classList.toggle('on', i < k));
  }

  function buildStars(container, n, on) {
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'star' + (i < on ? ' on' : '');
      s.textContent = '★';
      container.appendChild(s);
    }
  }

  function updateHud(popLast) {
    const L = LEVELS[state.level];
    el.levelLabel.textContent = 'Level ' + (state.level + 1);
    buildStars(el.stars, L.rounds, state.roundsWon);
    if (popLast && state.roundsWon > 0) {
      el.stars.children[state.roundsWon - 1].classList.add('pop');
    }
  }

  function showScreen(name) {
    state.screen = name;
    el.home.classList.toggle('hidden', name !== 'home');
    el.level.classList.toggle('hidden', name !== 'levelDone');
    el.done.classList.toggle('hidden', name !== 'allDone');
    el.topbar.classList.toggle('off', name !== 'playing');
    el.homeLevel.textContent = 'Level ' + (progress + 1);
    computeArea();
  }

  /* ===================== Game flow ===================== */

  function spawnAmbient() {
    state.drift = { speed: AMBIENT_SPEED, edge: 'rebound' };
    state.objects = buildObjects(AMBIENT_COUNT, AMBIENT_SPEED);
    state.motion = 1;
    state.motionTarget = 1;
  }

  function goHome() {
    clearTimers();
    state.phase = 'idle';
    state.seq = [];
    showScreen('home');
    spawnAmbient();
  }

  function startLevel(i) {
    clearTimers();
    state.level = clamp(i, 0, LEVELS.length - 1);
    state.roundsWon = 0;
    particles.length = 0;
    showScreen('playing');
    updateHud(false);
    startRound();
  }

  function startRound() {
    clearTimers();
    const L = LEVELS[state.level];
    computeArea();
    state.drift = { speed: L.speed, edge: L.edge };
    state.objects = buildObjects(L.count, L.speed);
    state.seq = shuffle(state.objects.slice());
    state.idx = 0;
    state.fails = 0;
    state.motion = 0;
    state.motionTarget = 0;
    buildDots(L.count);
    beginShow(true);
  }

  // Show the sequence (again, after a retry). Shapes hold still so the order is easy to learn.
  function beginShow(first) {
    state.phase = 'showing';
    state.idx = 0;
    state.motionTarget = 0;
    state.objects.forEach(o => { o.done = false; o.glowTarget = 0; });
    fillDots(0);
    setPrompt('👀', 'Watch!', 'watch');

    const hold = SHOW_HOLD_MS + Math.min(state.fails, 3) * 150; // a little slower after misses
    const start = first ? 900 : 700;
    state.seq.forEach((o, i) => {
      later(() => {
        o.glowTarget = 1;
        sfx.show(o.shape);
        fillDots(i + 1);
        later(() => { o.glowTarget = 0; }, hold);
      }, start + i * (hold + SHOW_GAP_MS));
    });
    later(beginInput, start + state.seq.length * (hold + SHOW_GAP_MS) + 150);
  }

  function beginInput() {
    state.phase = 'input';
    state.idx = 0;
    fillDots(0);
    state.motionTarget = 1;   // now they start to drift
    setPrompt('👆', 'Your turn!', 'go');
  }

  function onCorrect(o) {
    o.pop = 1;
    o.done = true;
    o.lastCorrectAt = performance.now();
    burst(o.x, o.y + o.by, o.shape.color, 12);
    sfx.correct(o.shape);
    state.idx++;
    fillDots(state.idx);
    if (state.idx >= state.seq.length) roundSuccess();
  }

  function onWrong(o) {
    state.phase = 'retry';
    state.fails++;
    state.motionTarget = 0;
    o.wobble = 1;
    ripple(o.x, o.y + o.by, '#B8A9FF');
    sfx.oops();
    fillDots(0);
    setPrompt('💫', 'Almost! Watch again', 'soft');
    later(() => beginShow(false), 1300);
  }

  function roundSuccess() {
    state.phase = 'success';
    state.motionTarget = 0;
    state.roundsWon++;
    updateHud(true);
    setPrompt('🌟', 'Great job!', 'win');
    later(() => sfx.star(), 250);
    const cx = world.w / 2, cy = (world.y0 + world.y1) / 2;
    for (const o of state.objects) burst(o.x, o.y + o.by, o.shape.color, 6);
    burst(cx, cy, '#F0E442', 14);

    const L = LEVELS[state.level];
    if (state.roundsWon >= L.rounds) later(levelComplete, 1500);
    else later(startRound, 1700);
  }

  function levelComplete() {
    const L = LEVELS[state.level];
    const isLast = state.level >= LEVELS.length - 1;
    progress = isLast ? 0 : state.level + 1;
    store.set('ayaan.level', progress);
    state.phase = 'idle';
    state.motionTarget = 1;
    sfx.level();
    confetti(isLast ? 70 : 45);

    if (isLast) {
      showScreen('allDone');
    } else {
      el.levelTitle.textContent = 'Level ' + (state.level + 1) + ' done!';
      buildStars(el.levelStars, L.rounds, L.rounds);
      el.btnNext.textContent = 'Level ' + (state.level + 2) + ' ▶';
      showScreen('levelDone');
    }
  }

  /* ===================== Input ===================== */

  function handleTap(px, py) {
    if (state.screen === 'home') {
      // the floating shapes on the home screen are toys: tap for a note and sparkles
      const o = pickObject(px, py);
      if (o) {
        o.pop = 1;
        burst(o.x, o.y + o.by, o.shape.color, 10);
        sfx.show(o.shape);
      }
      return;
    }
    if (state.screen !== 'playing') return;

    const o = pickObject(px, py);
    if (state.phase !== 'input') {
      if (!o) ripple(px, py, '#56B4E9');   // taps while watching are harmless
      return;
    }
    if (!o) { ripple(px, py, '#56B4E9'); return; }   // tapping empty space is free
    if (performance.now() - o.lastCorrectAt < 350) return; // ignore an accidental double-tap

    if (o === state.seq[state.idx]) onCorrect(o);
    else onWrong(o);
  }

  canvas.addEventListener('pointerdown', e => {
    ensureAudio();
    const rect = canvas.getBoundingClientRect();
    handleTap(e.clientX - rect.left, e.clientY - rect.top);
  });

  // the very first touch anywhere unlocks audio on Android
  document.addEventListener('pointerdown', ensureAudio, { passive: true });

  el.btnPlay.addEventListener('click', () => { ensureAudio(); startLevel(progress); });
  el.btnNext.addEventListener('click', () => startLevel(state.level + 1));
  el.btnAgain.addEventListener('click', () => startLevel(0));
  el.btnHome.addEventListener('click', goHome);
  el.btnSound.addEventListener('click', () => {
    audio.muted = !audio.muted;
    store.set('ayaan.muted', audio.muted ? '1' : '0');
    setSoundIcon();
    ensureAudio();
    if (!audio.muted) tone(523.25, { dur: 0.2, vol: 0.1 });
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  /* ===================== Boot ===================== */

  setSoundIcon();
  resize();
  goHome();
  requestAnimationFrame(t => { lastFrame = t; frame(t); });

  // Optional shortcut for parents/testing: open index.html#level=2 to jump to a level.
  const m = /level=(\d+)/.exec(window.location.hash);
  if (m) startLevel(clamp(parseInt(m[1], 10) - 1, 0, LEVELS.length - 1));

  // small debug handle (used by the automated test, harmless in the app)
  window.__ayaan = { state, world, LEVELS, startLevel, goHome, centre: o => ({ x: o.x, y: o.y + o.by }) };
})();
