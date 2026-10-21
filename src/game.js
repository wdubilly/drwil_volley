'use strict';

// Résolution logique (pixel art), mise à l'échelle sans lissage
const W = 320, H = 180;
const GROUND = 148;
const NET_X = W / 2, NET_W = 4, NET_H = 42;
const WIN_SCORE = 7;
const STEP = 1000 / 60;

const GRAVITY_P = 0.28, JUMP = -5.0, SPEED = 1.7;
const GRAVITY_B = 0.075, BALL_R = 5, BALL_MAX = 4.4;
const PW = 12, PH = 26;
const AI_SPEED = 0.6, AI_ERR = 16, AI_REACT = 18;

const screen = document.getElementById('screen');
const sctx = screen.getContext('2d');
const buf = document.createElement('canvas');
buf.width = W; buf.height = H;
const g = buf.getContext('2d');

// ---------- Entrées ----------
const keys = {}, pressed = {};
addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------- Sons (WebAudio) ----------
let actx = null;
function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), v = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, actx.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, actx.currentTime + dur);
    v.gain.setValueAtTime(vol, actx.currentTime);
    v.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(v).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (_) { /* audio indisponible */ }
}
const sfx = {
  hit: () => beep(220, 0.08, 'square', 0.07, 120),
  net: () => beep(110, 0.06, 'triangle', 0.08),
  wall: () => beep(160, 0.05, 'triangle', 0.05),
  jump: () => beep(300, 0.07, 'square', 0.03, 150),
  point: () => { beep(523, 0.12); setTimeout(() => beep(784, 0.18), 110); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.2), i * 140)),
  menu: () => beep(440, 0.04, 'square', 0.04),
};

// ---------- Décor pixel art (généré une fois) ----------
let seed = 1337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const bgCanvas = document.createElement('canvas');
bgCanvas.width = W; bgCanvas.height = H;
(function buildBackground() {
  const b = bgCanvas.getContext('2d');
  const bands = ['#5fa8e8', '#6cb2ee', '#79bbf2', '#88c4f5', '#98cdf8'];
  const bh = Math.ceil(GROUND / bands.length);
  bands.forEach((c, i) => { b.fillStyle = c; b.fillRect(0, i * bh, W, bh); });

  // soleil carré
  b.fillStyle = '#fff2a0'; b.fillRect(250, 18, 20, 20);
  b.fillStyle = '#ffffff'; b.fillRect(254, 22, 12, 12);

  // nuages en blocs
  b.fillStyle = '#ffffffcc';
  [[30, 22], [120, 40], [190, 16], [280, 56]].forEach(([x, y]) => {
    b.fillRect(x, y, 32, 6); b.fillRect(x + 6, y - 5, 18, 5); b.fillRect(x + 4, y + 6, 22, 3);
  });

  // collines en blocs de pierre / feuillage
  for (let x = 0; x < W; x += 8) {
    const h = 20 + Math.round(10 * Math.sin(x / 38) + 6 * Math.sin(x / 13));
    b.fillStyle = '#5b7f4a'; b.fillRect(x, GROUND - h, 8, h);
    b.fillStyle = '#6a9456'; b.fillRect(x, GROUND - h, 8, 3);
  }
  // arbres Minecraft
  [28, 86, 236, 296].forEach(x => {
    b.fillStyle = '#5a3d1e'; b.fillRect(x, GROUND - 34, 6, 34);
    b.fillStyle = '#2f7a2c'; b.fillRect(x - 10, GROUND - 52, 26, 20);
    b.fillStyle = '#3c9a38'; b.fillRect(x - 6, GROUND - 58, 18, 8);
    b.fillStyle = '#26661f'; b.fillRect(x - 10, GROUND - 36, 26, 4);
  });

  // sol : herbe + terre + pierre
  for (let y = GROUND; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      let base = y === GROUND ? '#6bb040' : y < GROUND + 24 ? '#8a5a35' : '#7d7d7d';
      b.fillStyle = base; b.fillRect(x, y, 8, 8);
      for (let i = 0; i < 6; i++) {
        const sh = rnd() < 0.5 ? '#00000022' : '#ffffff18';
        b.fillStyle = sh; b.fillRect(x + ((rnd() * 8) | 0), y + ((rnd() * 8) | 0), 2, 2);
      }
      b.fillStyle = '#00000030'; b.fillRect(x, y + 7, 8, 1); b.fillRect(x + 7, y, 1, 8);
    }
  }
  b.fillStyle = '#4e8c2c'; b.fillRect(0, GROUND, W, 2);
})();

// ---------- Entités ----------
function makePlayer(side, skin) {
  return { side, skin, x: 0, y: 0, vx: 0, vy: 0, onGround: true, face: side === 0 ? 1 : -1, anim: 0 };
}
const SKINS = [
  { hair: '#3b2412', skin: '#c98e68', shirt: '#2fb5b5', pants: '#3a3fa8', shoe: '#6d6d6d' },
  { hair: '#d9822b', skin: '#f2c9a0', shirt: '#4caf3a', pants: '#6b4a2a', shoe: '#4a4a4a' },
];

const state = {
  mode: 'menu', // menu | play | point | over
  menuIndex: 0,
  vsAI: true,
  p: [makePlayer(0, SKINS[0]), makePlayer(1, SKINS[1])],
  ball: { x: 0, y: 0, vx: 0, vy: 0, spin: 0 },
  score: [0, 0],
  server: 0,
  timer: 0,
  msg: '',
  shake: 0,
  particles: [],
};

function resetRound() {
  aiTarget = null;
  const [a, b] = state.p;
  a.x = W * 0.25 - PW / 2; b.x = W * 0.75 - PW / 2;
  a.y = b.y = GROUND - PH;
  a.vx = a.vy = b.vx = b.vy = 0;
  const bl = state.ball;
  bl.x = state.server === 0 ? W * 0.25 : W * 0.75;
  bl.y = 60; bl.vx = 0; bl.vy = 0; bl.spin = 0;
}

function startMatch(vsAI) {
  state.vsAI = vsAI;
  state.score = [0, 0];
  state.server = 0;
  state.mode = 'play';
  resetRound();
}

// ---------- Physique ----------
function spawnParticles(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    state.particles.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2.5, life: 24 + Math.random() * 10, color });
  }
}

// Collision cercle (balle) / rectangle ; retourne la normale ou null
function circleRect(bl, rx, ry, rw, rh) {
  const cx = Math.max(rx, Math.min(bl.x, rx + rw));
  const cy = Math.max(ry, Math.min(bl.y, ry + rh));
  let dx = bl.x - cx, dy = bl.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= BALL_R * BALL_R) return null;
  let d = Math.sqrt(d2);
  if (d === 0) { // centre dans le rectangle
    dx = bl.x - (rx + rw / 2); dy = bl.y - (ry + rh / 2);
    d = Math.hypot(dx, dy) || 1;
  }
  return { nx: dx / d, ny: dy / d, pen: BALL_R - d };
}

function clampSpeed(bl) {
  const s = Math.hypot(bl.vx, bl.vy);
  if (s > BALL_MAX) { bl.vx *= BALL_MAX / s; bl.vy *= BALL_MAX / s; }
}

function updatePlayer(p, left, right, jump, speed = SPEED) {
  p.vx = (right ? speed : 0) - (left ? speed : 0);
  if (p.vx) p.face = Math.sign(p.vx);
  if (jump && p.onGround) { p.vy = JUMP; p.onGround = false; sfx.jump(); }
  p.vy += GRAVITY_P;
  p.x += p.vx; p.y += p.vy;
  if (p.y >= GROUND - PH) { p.y = GROUND - PH; p.vy = 0; p.onGround = true; }
  const min = p.side === 0 ? 0 : NET_X + NET_W / 2;
  const max = p.side === 0 ? NET_X - NET_W / 2 - PW : W - PW;
  p.x = Math.max(min, Math.min(max, p.x));
  p.anim += Math.abs(p.vx) > 0 ? 0.25 : 0;
}

// Prédiction de l'arrivée de la balle à hauteur de frappe
function predictBall(bl, targetY) {
  let x = bl.x, y = bl.y, vx = bl.vx, vy = bl.vy;
  for (let i = 0; i < 400; i++) {
    vy += GRAVITY_B; x += vx; y += vy;
    if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx); }
    if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx); }
    if (y >= targetY && vy > 0) return { x, t: i };
  }
  return { x, t: 400 };
}

let aiTarget = null, aiWait = 0;
function aiControl(p, bl) {
  const homeX = W * 0.75;
  const inMyHalf = bl.x > NET_X || (bl.vx > 0.3 && bl.x > W * 0.3);
  let left = false, right = false, jump = false;
  if (!inMyHalf) {
    const c = p.x + PW / 2;
    if (c < homeX - 4) right = true; else if (c > homeX + 4) left = true;
    return { left, right, jump };
  }
  if (aiTarget === null || --aiWait <= 0) {
    const pred = predictBall(bl, GROUND - PH - 4);
    aiTarget = pred.x + 6 + (Math.random() - 0.5) * 2 * AI_ERR;
    aiWait = AI_REACT;
  }
  const aim = Math.min(W - PW / 2, Math.max(NET_X + 10, aiTarget));
  const c = p.x + PW / 2;
  if (c < aim - 3) right = true; else if (c > aim + 3) left = true;
  const near = Math.abs(bl.x - c) < 22 && bl.y < p.y + 6 && bl.y > p.y - 50;
  if (near && p.onGround && bl.vy > -1 && Math.random() < 0.35) jump = true;
  return { left, right, jump };
}

function stepPlay() {
  const [a, b] = state.p, bl = state.ball;

  const p1Left = keys['KeyA'] || keys['KeyQ'] || (state.vsAI && keys['ArrowLeft']);
  const p1Right = keys['KeyD'] || (state.vsAI && keys['ArrowRight']);
  const p1Jump = keys['KeyW'] || keys['KeyZ'] || keys['Space'] || (state.vsAI && keys['ArrowUp']);
  updatePlayer(a, p1Left, p1Right, p1Jump);

  if (state.vsAI) {
    const c = aiControl(b, bl);
    updatePlayer(b, c.left, c.right, c.jump, SPEED * AI_SPEED);
  } else {
    updatePlayer(b, keys['ArrowLeft'], keys['ArrowRight'], keys['ArrowUp']);
  }

  // Balle
  bl.vy += GRAVITY_B;
  bl.x += bl.vx; bl.y += bl.vy;
  bl.spin += bl.vx * 0.1;

  if (bl.x < BALL_R) { bl.x = BALL_R; bl.vx = Math.abs(bl.vx) * 0.9; sfx.wall(); }
  if (bl.x > W - BALL_R) { bl.x = W - BALL_R; bl.vx = -Math.abs(bl.vx) * 0.9; sfx.wall(); }
  if (bl.y < BALL_R) { bl.y = BALL_R; bl.vy = Math.abs(bl.vy) * 0.8; }

  // Filet
  const netHit = circleRect(bl, NET_X - NET_W / 2, GROUND - NET_H, NET_W, NET_H);
  if (netHit) {
    bl.x += netHit.nx * netHit.pen; bl.y += netHit.ny * netHit.pen;
    const dot = bl.vx * netHit.nx + bl.vy * netHit.ny;
    if (dot < 0) { bl.vx -= 1.8 * dot * netHit.nx; bl.vy -= 1.8 * dot * netHit.ny; }
    sfx.net();
    spawnParticles(bl.x, bl.y, '#8b5a2b', 4);
  }

  // Joueurs
  for (const p of state.p) {
    const h = circleRect(bl, p.x, p.y, PW, PH);
    if (!h) continue;
    bl.x += h.nx * h.pen; bl.y += h.ny * h.pen;
    const rvx = bl.vx - p.vx, rvy = bl.vy - p.vy;
    const dot = rvx * h.nx + rvy * h.ny;
    if (dot < 0) {
      bl.vx = rvx - 1.6 * dot * h.nx + p.vx * 0.9;
      bl.vy = rvy - 1.6 * dot * h.ny + p.vy * 0.5;
    }
    // Garantit un renvoi vif et vers l'autre côté du filet
    const toward = p.side === 0 ? 1 : -1;
    if (Math.sign(bl.vx) !== toward && Math.abs(h.nx) < 0.3) bl.vx += toward * 0.8;
    if (bl.vy > -1.2 && h.ny < -0.3) bl.vy = -2.4;
    clampSpeed(bl);
    sfx.hit();
    state.shake = 2;
    spawnParticles(bl.x, bl.y, '#ffe07a', 6);
  }
  clampSpeed(bl);

  // Sol : point
  if (bl.y >= GROUND - BALL_R) {
    bl.y = GROUND - BALL_R;
    const winner = bl.x < NET_X ? 1 : 0;
    state.score[winner]++;
    state.server = winner;
    state.shake = 5;
    spawnParticles(bl.x, GROUND - 2, '#6bb040', 14);
    spawnParticles(bl.x, GROUND - 2, '#8a5a35', 10);
    if (state.score[winner] >= WIN_SCORE) {
      state.mode = 'over'; state.msg = winner; sfx.win();
    } else {
      state.mode = 'point'; state.msg = winner; sfx.point();
    }
    state.timer = 90;
  }
}

function update() {
  const { mode } = state;

  if (mode === 'menu') {
    const items = 3;
    if (pressed['ArrowUp'] || pressed['KeyW']) { state.menuIndex = (state.menuIndex + items - 1) % items; sfx.menu(); }
    if (pressed['ArrowDown'] || pressed['KeyS']) { state.menuIndex = (state.menuIndex + 1) % items; sfx.menu(); }
    if (pressed['Digit1']) state.menuIndex = 0;
    if (pressed['Digit2']) state.menuIndex = 1;
    if (pressed['Enter'] || pressed['Space'] || pressed['Digit1'] || pressed['Digit2']) {
      sfx.menu();
      if (state.menuIndex === 0) startMatch(true);
      else if (state.menuIndex === 1) startMatch(false);
      else window.close();
    }
  } else if (mode === 'play') {
    if (pressed['Escape']) state.mode = 'menu';
    else stepPlay();
  } else if (mode === 'point') {
    state.timer--;
    if (pressed['Escape']) state.mode = 'menu';
    else if (state.timer <= 0) { state.mode = 'play'; resetRound(); }
  } else if (mode === 'over') {
    state.timer--;
    if (pressed['Escape'] || (state.timer < 60 && (pressed['Enter'] || pressed['Space']))) state.mode = 'menu';
  }

  for (const pt of state.particles) { pt.vy += 0.12; pt.x += pt.vx; pt.y += pt.vy; pt.life--; }
  state.particles = state.particles.filter(p => p.life > 0);
  if (state.shake > 0) state.shake -= 0.4;
  for (const k in pressed) delete pressed[k];
}

// ---------- Rendu ----------
const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };

function drawPlayer(p) {
  const s = p.skin, x = Math.round(p.x), y = Math.round(p.y), f = p.face;
  const swing = p.onGround ? Math.round(Math.sin(p.anim) * 2) : 2;
  const armUp = !p.onGround;
  // ombre
  px(x, GROUND - 1, PW, 2, '#00000040');
  // jambes
  px(x + 2, y + 18, 3, 8 - Math.max(0, swing), s.pants);
  px(x + 7, y + 18, 3, 8 - Math.max(0, -swing), s.pants);
  px(x + 2, y + 24, 3, 2, s.shoe); px(x + 7, y + 24, 3, 2, s.shoe);
  // torse
  px(x + 1, y + 9, 10, 9, s.shirt);
  px(x + 1, y + 16, 10, 2, '#00000022');
  // bras (celui de devant lève pour frapper)
  const ay = armUp ? y + 3 : y + 10 + swing;
  px(f > 0 ? x + 10 : x - 1, ay, 3, armUp ? 8 : 7, s.skin);
  px(f > 0 ? x - 1 : x + 10, y + 10 - swing, 3, 7, s.skin);
  // tête
  px(x + 1, y, 10, 9, s.skin);
  px(x + 1, y, 10, 3, s.hair);
  px(x + 1, y + 3, 2, 2, s.hair); px(x + 9, y + 3, 2, 2, s.hair);
  // yeux
  const ex = f > 0 ? 6 : 3;
  px(x + ex, y + 4, 2, 2, '#ffffff'); px(x + ex + (f > 0 ? 1 : 0), y + 4, 1, 2, '#2a3cc0');
  px(x + ex + (f > 0 ? -3 : 3), y + 4, 2, 2, '#ffffff'); px(x + ex + (f > 0 ? -3 : 3) + (f > 0 ? 1 : 0), y + 4, 1, 2, '#2a3cc0');
  px(x + 4, y + 7, 4, 1, '#7a4a30');
}

function drawBall(bl) {
  const x = Math.round(bl.x), y = Math.round(bl.y);
  // ombre au sol
  const sh = Math.max(2, 8 - (GROUND - bl.y) / 15);
  px(x - sh / 2, GROUND - 1, sh, 2, '#00000050');
  // sphère pixelisée
  px(x - 3, y - 5, 6, 1, '#d9d9d9'); px(x - 5, y - 3, 10, 6, '#f2f2f2');
  px(x - 4, y - 4, 8, 8, '#f2f2f2'); px(x - 3, y + 4, 6, 1, '#bdbdbd');
  px(x - 5, y + 1, 10, 2, '#e2e2e2');
  // motif qui tourne (bande jaune/bleue)
  const o = Math.round(Math.sin(bl.spin) * 3);
  px(x - 4 + 1, y - 1 + o * 0, 8, 2, '#f4c430');
  px(x + o - 1, y - 4, 2, 8, '#3b6fd8');
  px(x - 5, y - 1, 1, 2, '#bdbdbd'); px(x + 4, y - 1, 1, 2, '#bdbdbd');
}

function drawNet() {
  const x = NET_X - NET_W / 2, top = GROUND - NET_H;
  px(x, top, NET_W, NET_H, '#9c6b3a');
  px(x, top, 1, NET_H, '#b98550'); px(x + NET_W - 1, top, 1, NET_H, '#6e4824');
  for (let y = top + 2; y < GROUND; y += 8) px(x - 1, y, NET_W + 2, 1, '#00000040');
  px(x - 1, top - 2, NET_W + 2, 3, '#e8e8e8');
  px(x - 1, top - 2, NET_W + 2, 1, '#ffffff');
}

function drawText(txt, x, y, size, color = '#fff', align = 'center') {
  sctx.font = `bold ${size}px "Courier New", monospace`;
  sctx.textAlign = align; sctx.textBaseline = 'middle';
  sctx.fillStyle = '#000000b0'; sctx.fillText(txt, x + size / 10 + 1, y + size / 10 + 1);
  sctx.fillStyle = color; sctx.fillText(txt, x, y);
}

function render() {
  const sh = state.shake > 0 ? Math.round((Math.random() - 0.5) * state.shake) : 0;
  g.drawImage(bgCanvas, sh, 0);
  drawNet();
  for (const p of state.p) drawPlayer(p);
  if (state.mode !== 'menu') drawBall(state.ball);
  for (const pt of state.particles) px(pt.x, pt.y, 2, 2, pt.color);

  // Redimensionnement entier si possible, sinon proportionnel
  const cw = screen.clientWidth * devicePixelRatio, ch = screen.clientHeight * devicePixelRatio;
  if (screen.width !== cw || screen.height !== ch) { screen.width = cw; screen.height = ch; }
  const scale = Math.min(cw / W, ch / H);
  const ox = (cw - W * scale) / 2, oy = (ch - H * scale) / 2;
  sctx.imageSmoothingEnabled = false;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, cw, ch);
  sctx.drawImage(buf, ox, oy, W * scale, H * scale);

  const u = scale; // 1 pixel logique en pixels écran
  const cx = ox + (W * u) / 2;
  const T = (v) => Math.round(v * u);

  if (state.mode === 'menu') {
    sctx.fillStyle = '#00000070'; sctx.fillRect(ox, oy, W * u, H * u);
    drawText('BLOCK VOLLEY', cx, oy + T(34), T(24), '#ffd84a');
    drawText('Le volley en mode cubique', cx, oy + T(54), T(8), '#ffffff');
    const items = ['Solo contre l\'IA', '2 joueurs (local)', 'Quitter'];
    items.forEach((t, i) => {
      const sel = i === state.menuIndex;
      const yy = oy + T(86 + i * 18);
      if (sel) { sctx.fillStyle = '#ffffff30'; sctx.fillRect(cx - T(70), yy - T(8), T(140), T(16)); }
      drawText((sel ? '> ' : '  ') + t, cx, yy, T(10), sel ? '#7dff7d' : '#ffffff');
    });
    drawText('J1 : A/D + W (ou Q/Z)   J2 : fleches', cx, oy + T(158), T(6.5), '#e0e0e0');
    drawText('Echap : menu   F11 : plein ecran   Premier a ' + WIN_SCORE, cx, oy + T(168), T(6.5), '#e0e0e0');
    return;
  }

  // HUD
  const name = (i) => i === 0 ? 'J1' : (state.vsAI ? 'IA' : 'J2');
  drawText(name(0), ox + T(30), oy + T(12), T(9), '#7de0e0');
  drawText(name(1), ox + T(W - 30), oy + T(12), T(9), '#a8f08a');
  drawText(String(state.score[0]), ox + T(30), oy + T(28), T(18), '#ffffff');
  drawText(String(state.score[1]), ox + T(W - 30), oy + T(28), T(18), '#ffffff');

  if (state.mode === 'point') {
    drawText(name(state.msg) + ' marque !', cx, oy + T(70), T(14), '#ffd84a');
  } else if (state.mode === 'over') {
    sctx.fillStyle = '#00000080'; sctx.fillRect(ox, oy, W * u, H * u);
    drawText(name(state.msg) + ' gagne la partie !', cx, oy + T(70), T(16), '#ffd84a');
    drawText(state.score[0] + ' - ' + state.score[1], cx, oy + T(92), T(14), '#ffffff');
    if (state.timer < 60) drawText('Entree : retour au menu', cx, oy + T(118), T(8), '#e0e0e0');
  }
}

// ---------- Boucle à pas fixe ----------
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  while (acc >= STEP) { update(); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}
resetRound();
requestAnimationFrame(frame);
