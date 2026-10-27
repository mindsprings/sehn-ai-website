// sehn.ai lab: a dive into the eye.
// Everything on screen is a flat plane at some depth, and only the camera moves,
// like Disney's multiplane camera: the depth you feel comes from parallax alone.
// The story: the eye; through the pupil into the dark of the vitreous; a fall straight down onto
// the retina, seen from above; then the camera turns to look ahead, and we are inside it.
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var q = new URLSearchParams(location.search);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // for screenshots and tuning: ?p=0.5 holds the camera there, ?px=&py= hold the pointer (-1..1), ?flat, ?debug, ?seed=
  var fixedP = q.has('p') ? clamp(parseFloat(q.get('p')) || 0, 0, 1) : null;
  var fixedPtr = q.has('px') || q.has('py') ? { x: parseFloat(q.get('px')) || 0, y: parseFloat(q.get('py')) || 0 } : null;
  var SEED = parseInt(q.get('seed'), 10) || 7;
  var TAU = Math.PI * 2;

  // the scroll, start to end: rest; fly at the eye until the pupil fills the screen; dark; the retina glows up
  // far below and we fall onto it; the camera turns to look ahead; we settle in the forest; then deeper in
  var P_DIVE = 0.04, P_PUPIL = 0.22, P_GLOW = 0.26, P_TURN = 0.58, P_SIDE = 0.64, P_REST = 0.82;
  var Z_EYE = 1, FLAT_D = 4.6;
  var FALL_TOP = 45, FALL_END = 0.06;   // the camera's height above the retina: where the fall starts, and where we turn
  var BLIND = { x: -0.62, y: 0.05 };    // the blind spot, where the nerve fibres leave and the vessels come in
  var CEIL = -0.9, FLOOR = 0.9;         // the retina edge on: nerve fibres along the ceiling, rods and cones on the floor
  var SLICES = [26, 14, 8, 4.6, 2.7, 1.6];
  var HAZE = '#E9C38C', DARK = '#0E1726';

  // ---------- small helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeInOut(t) { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1)); }
  function angDiff(a, b) { var d = (b - a) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; }
  function cm(a, b, c, d, t) { return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t); }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, t) {
    var A = rgb(a), B = rgb(b), c = '#';
    for (var i = 0; i < 3; i++) c += (256 | Math.round(A[i] + (B[i] - A[i]) * t)).toString(16).slice(1);
    return c;
  }
  function alpha(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // ---------- ink: filled outlines, with a bounding box for culling ----------
  // A stroke that thins out, as one filled outline. pts: [[x, y, halfWidth], ...]
  // Every outline winds the same way, so overlapping strokes merge instead of punching holes.
  function taper(path, pts) {
    var n = pts.length, L = [], R = [], i, a, b, dx, dy, d, nx, ny, w;
    if (n < 2) return;
    for (i = 0; i < n; i++) {
      a = pts[i > 0 ? i - 1 : 0]; b = pts[i < n - 1 ? i + 1 : n - 1];
      dx = b[0] - a[0]; dy = b[1] - a[1]; d = Math.hypot(dx, dy) || 1;
      nx = -dy / d; ny = dx / d; w = pts[i][2];
      L.push(pts[i][0] + nx * w, pts[i][1] + ny * w);
      R.push(pts[i][0] - nx * w, pts[i][1] - ny * w);
    }
    path.moveTo(L[0], L[1]);
    for (i = 2; i < L.length; i += 2) path.lineTo(L[i], L[i + 1]);
    for (i = R.length - 2; i >= 0; i -= 2) path.lineTo(R[i], R[i + 1]);
    path.closePath();
  }

  function Ink() { this.path = new Path2D(); this.box = [Infinity, Infinity, -Infinity, -Infinity]; }
  Ink.prototype.fit = function (x, y, r) {
    var b = this.box;
    if (x - r < b[0]) b[0] = x - r;
    if (y - r < b[1]) b[1] = y - r;
    if (x + r > b[2]) b[2] = x + r;
    if (y + r > b[3]) b[3] = y + r;
  };
  Ink.prototype.taper = function (pts) {
    taper(this.path, pts);
    for (var i = 0; i < pts.length; i++) this.fit(pts[i][0], pts[i][1], pts[i][2]);
  };
  // a rounded cell body, drawn out towards ang
  Ink.prototype.blob = function (x, y, r, ang, point) {
    var n = 28, i, t, rr, px, py;
    for (i = 0; i <= n; i++) {
      t = -i / n * TAU;
      rr = r * (1 + point * Math.pow(Math.max(0, Math.cos(t)), 5));
      px = x + Math.cos(ang + t) * rr; py = y + Math.sin(ang + t) * rr;
      if (i) this.path.lineTo(px, py); else this.path.moveTo(px, py);
    }
    this.path.closePath();
    this.fit(x, y, r * (1 + point));
  };
  // a rounded triangle, pointing up (the foot of a cone)
  Ink.prototype.tri = function (x, y, r) {
    var n = 30, i, t, rr, px, py;
    for (i = 0; i <= n; i++) {
      t = -i / n * TAU;
      rr = r * (1 + 0.32 * Math.cos(3 * t));
      px = x + Math.cos(t - Math.PI / 2) * rr; py = y - r * 0.2 + Math.sin(t - Math.PI / 2) * rr;
      if (i) this.path.lineTo(px, py); else this.path.moveTo(px, py);
    }
    this.path.closePath();
    this.fit(x, y, r * 1.4);
  };
  Ink.prototype.dot = function (x, y, r) {
    this.path.moveTo(x + r, y);
    this.path.arc(x, y, r, 0, TAU, true);
    this.fit(x, y, r);
  };
  Ink.prototype.hex = function (x, y, r, a) {
    for (var i = 0; i <= 6; i++) {
      var t = a - i / 6 * TAU, px = x + Math.cos(t) * r, py = y + Math.sin(t) * r;
      if (i) this.path.lineTo(px, py); else this.path.moveTo(px, py);
    }
    this.path.closePath();
    this.fit(x, y, r);
  };

  // ---------- dendrites, after Cajal ----------
  // The thinnest a stroke may get, in drawing units. Set per layer so that every twig stays
  // visible on screen: Cajal inked every last branch, and that is what makes his cells dense.
  var minInk = 0;

  // Grow a dendrite: a wandering stroke that thins out, sprouts spines and side branches, then forks.
  function grow(ink, o, rnd, x, y, ang, len, w, depth) {
    var n = Math.max(2, Math.round(len / o.step)), seg = len / n, pts = [[x, y, Math.max(minInk, w)]], wi = w, i, cut = false;
    for (i = 1; i <= n; i++) {
      ang += (rnd() - 0.5) * o.wiggle + (o.curl || 0);
      if (o.pull != null) ang += angDiff(ang, o.pull) * o.pullK;
      x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
      wi = Math.max(minInk, w * (1 - (1 - o.taper) * i / n));
      pts.push([x, y, wi]);
      if (o.inside && !o.inside(x, y)) { cut = true; break; }
      if (o.spine && rnd() < o.spine) {
        var sa = ang + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.8), sl = o.spineLen * (0.5 + rnd());
        ink.taper([[x, y, wi * 0.8], [x + Math.cos(sa) * sl, y + Math.sin(sa) * sl, 0]]);
      }
      if (o.side && i < n && depth + 2 <= o.depth && rnd() < o.side) {
        grow(ink, o, rnd, x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * o.sideK, wi * 0.65, depth + 2);
      }
    }
    var end = cut || depth >= o.depth;
    if (end) pts[pts.length - 1][2] = 0;
    ink.taper(pts);
    if (end) return;
    for (i = 0; i < 2; i++) {
      grow(ink, o, rnd, x, y, ang + (i - 0.5) * o.spread * (0.7 + rnd() * 0.6), len * o.lenK * (0.75 + rnd() * 0.5), wi * o.wK, depth + 1);
    }
  }

  // ---------- state ----------
  var W, H, dpr, A, F, C, halfDiag, eyePx, EYE_S, dMin, cam0;
  var fall, world, sparks, nightGrad, glowGrad, irisGrad, irisArt, tmp;
  var p = fixedP != null ? fixedP : 0, flatT = q.has('flat') ? 1 : 0, flatTarget = flatT;
  var rollC = 1, rollS = 0, shiftY = 0, buildMs = 0;
  var ptr = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, last: -1e9 };
  var iris = { x: 0, y: 0, tx: 0, ty: 0, wanderAt: 0 };
  var blink = { at: 2.2, start: -10, v: 0 };
  var CAM = { x: 0, y: 0, z: 0 }, FC = { x: 0, y: 0, c: FALL_TOP, roll: 0 }, SC = { x: 0, y: 0, z: 0 }, PT = { s: 1, tx: 0, ty: 0 };

  // ---------- projection ----------
  // local -> screen: (x * s + tx, y * s + ty), then the camera roll about the middle, then device pixels
  function setT(s, tx, ty) {
    var c = rollC * dpr, sn = rollS * dpr, px = tx - C.x, py = ty - C.y;
    ctx.setTransform(c * s, sn * s, -sn * s, c * s, dpr * C.x + c * px - sn * py, dpr * C.y + sn * px + c * py);
  }

  function drawItems(items, T, mult) {
    var pad = rollS ? halfDiag : 40;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], b = it.box;
      if (b && (b[2] * T.s + T.tx < -pad || b[0] * T.s + T.tx > W + pad || b[3] * T.s + T.ty < -pad || b[1] * T.s + T.ty > H + pad)) continue;
      ctx.globalAlpha = (it.a == null ? 1 : it.a) * mult;
      if (it.comp) ctx.globalCompositeOperation = it.comp;
      if (it.img) ctx.drawImage(it.img, b[0], b[1], b[2] - b[0], b[3] - b[1]);
      else {
        if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(it.path); }
        if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw; ctx.stroke(it.path); }
      }
      if (it.comp) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the eye (the logo, on the night sky) ----------
  var EYE = {
    lower: new Path2D('M118,152 Q200,196 282,152'),
    lashes: [new Path2D('M238,109 Q243,90 256,82'), new Path2D('M258,118 Q266,100 280,96'), new Path2D('M277,130 Q288,116 302,114')],
    lashT: [0.7, 0.8, 0.9],
    glint: new Path2D('M188,118 Q190,126 197,128 Q190,130 188,138 Q186,130 179,128 Q186,126 188,118 Z'),
    glint2: new Path2D(),
    irisRing: new Path2D()
  };
  EYE.glint2.arc(211, 148, 3, 0, TAU);
  EYE.irisRing.moveTo(234, 138); EYE.irisRing.arc(200, 138, 34, 0, TAU);
  EYE.irisRing.moveTo(213, 138); EYE.irisRing.arc(200, 138, 13, 0, TAU);
  var lidCache = { c: null, upper: null, opening: null };
  function lids(v) {
    var c = Math.round(lerp(58, 196, v) * 10) / 10;
    if (c !== lidCache.c) {
      lidCache.c = c;
      lidCache.upper = new Path2D('M104,146 Q200,' + c + ' 296,146');
      lidCache.opening = new Path2D('M104,146 Q200,' + c + ' 296,146 L282,152 Q200,196 118,152 Z');
    }
    return lidCache;
  }

  // fibres of the iris; up close, their ends fork like dendrites
  function buildIris(rnd) {
    var lite = new Ink(), dark = new Ink(), ruff = new Path2D(), collar = new Path2D(), i, k, a, r, x, y;
    var o = { step: 0.6, wiggle: 0.5, taper: 0.2, spread: 0.8, lenK: 0.6, wK: 0.6, depth: 1 };
    for (i = 0; i < 220; i++) {
      var th = (i + rnd() * 0.8) / 220 * TAU, r1 = 26 + rnd() * 7, ang = th, pts = [], ink = i % 3 ? lite : dark;
      for (k = 0; k <= 10; k++) {
        r = lerp(13.8, r1, k / 10); ang += (rnd() - 0.5) * 0.04;
        x = 200 + Math.cos(ang) * r; y = 138 + Math.sin(ang) * r;
        pts.push([x, y, 0.27 * (1 - k / 12)]);
      }
      ink.taper(pts);
      if (rnd() < 0.45) grow(ink, o, rnd, x, y, ang + (rnd() - 0.5) * 0.8, 1.8 + rnd() * 1.5, 0.06, 0);
    }
    // the pupil's dark frill
    var ph = rnd() * TAU;
    for (k = 0; k <= 90; k++) {
      a = -k / 90 * TAU; r = 13.75 + 0.28 * Math.sin(a * 17 + 2 * Math.sin(a * 3 + ph)) + 0.16 * Math.sin(a * 41);
      if (k) ruff.lineTo(200 + Math.cos(a) * r, 138 + Math.sin(a) * r); else ruff.moveTo(200 + Math.cos(a) * r, 138 + Math.sin(a) * r);
    }
    ruff.closePath(); ruff.moveTo(212.6, 138); ruff.arc(200, 138, 12.6, 0, TAU);
    // the collarette, a wavy ring part way out
    for (k = 0; k <= 140; k++) {
      a = k / 140 * TAU; r = 19 + 1.1 * Math.sin(a * 15) + 0.5 * Math.sin(a * 37);
      if (k) collar.lineTo(200 + Math.cos(a) * r, 138 + Math.sin(a) * r); else collar.moveTo(200 + Math.cos(a) * r, 138 + Math.sin(a) * r);
    }
    return { lite: lite.path, dark: dark.path, ruff: ruff, collar: collar };
  }

  // the logo's sparkles and its trail of dust, each at its own depth (the trail recedes left to right)
  var SPARKS = [
    [350, 168, 'star', 12, '#E7A1B6', -0.2], [330, 60, 'star', 20, '#E7A1B6', 0.22], [78, 84, 'star', 12, '#F5F2EA', -0.12],
    [112, 48, 'dot', 2.5, '#F5F2EA', 0.3], [296, 96, 'dot', 2, '#F7DDE5', 0.1],
    [50, 200, 'dot', 2.5, '#F7DDE5', -0.24], [80, 210.5, 'dot', 3, '#E7A1B6', -0.2], [110, 218, 'dot', 3.5, '#F7DDE5', -0.16],
    [140, 222.5, 'dot', 4.5, '#E7A1B6', -0.12], [170, 224, 'dot', 5, '#F7DDE5', -0.08], [200, 222.5, 'dot', 5.5, '#E7A1B6', -0.04],
    [230, 218, 'px', 10, '#E7A1B6', 0], [260, 210.5, 'px', 9, '#F7DDE5', 0.05], [289.5, 199.5, 'px', 8, '#E7A1B6', 0.1], [320, 186.5, 'px', 7, '#F7DDE5', 0.15]
  ];
  var SHAPES = { star: new Path2D('M0,-1 Q0.17,-0.17 1,0 Q0.17,0.17 0,1 Q-0.17,0.17 -1,0 Q-0.17,-0.17 0,-1 Z'), dot: new Path2D(), px: new Path2D() };
  SHAPES.dot.arc(0, 0, 1, 0, TAU);
  if (SHAPES.px.roundRect) SHAPES.px.roundRect(-0.5, -0.5, 1, 1, 0.15); else SHAPES.px.rect(-0.5, -0.5, 1, 1);

  // Place each one so that, seen from the rest position, it sits exactly where the logo has it.
  function buildSparks() {
    return SPARKS.map(function (s) {
      var k = 1 + s[5];
      return {
        x: cam0.x + ((s[0] - 200) * EYE_S - cam0.x) * k, y: cam0.y + ((s[1] - 138) * EYE_S - cam0.y) * k,
        z: Z_EYE + s[5], size: s[3] * EYE_S * k, shape: s[2], col: s[4], back: s[5] >= 0
      };
    });
  }

  function drawSparks(cam, now, back) {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i], d = s.z - cam.z;
      if (s.back !== back || d < 0.03) continue;
      var k = F / d, sx = C.x + (s.x - cam.x) * k, sy = C.y + (s.y - cam.y) * k;
      var size = s.size * k * (reduce ? 1 : 1 + 0.1 * Math.sin(now * 0.0021 + i * 1.7));
      if (sx < -size * 2 || sx > W + size * 2 || sy < -size * 2 || sy > H + size * 2) continue;
      setT(size, sx, sy);
      ctx.fillStyle = s.col;
      ctx.fill(SHAPES[s.shape]);
    }
  }

  function drawEye(cam, now) {
    var de = Z_EYE - cam.z, se = EYE_S * F / de, zoom = 1 / de, i;
    var ox = C.x + (-200 * EYE_S - cam.x) * F / de, oy = C.y + (-138 * EYE_S - cam.y) * F / de;
    var ix = iris.x, iy = iris.y, lid = lids(blink.v);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = nightGrad;
    ctx.fillRect(0, 0, W, H);
    drawSparks(cam, now, true);
    setT(se, ox, oy);
    ctx.save();
    ctx.translate(200, 140); ctx.scale(1, 86 / 140);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(-140, -140, 280, 280);
    ctx.restore();

    // the iris, under the lids, around a pupil that stays dark: there is nothing to see in there yet
    ctx.save();
    ctx.clip(lid.opening);
    ctx.translate(ix, iy);
    ctx.fillStyle = DARK;
    ctx.beginPath(); ctx.arc(200, 138, 13.2, 0, TAU); ctx.fill();
    ctx.fillStyle = irisGrad;
    ctx.fill(EYE.irisRing, 'evenodd');
    var fa = 0.5 + 0.5 * smooth(1.5, 6, zoom);
    ctx.globalAlpha = fa * 0.6; ctx.fillStyle = '#FBE2EA'; ctx.fill(irisArt.lite);
    ctx.globalAlpha = fa * 0.5; ctx.fillStyle = '#8E2F55'; ctx.fill(irisArt.dark);
    ctx.globalAlpha = fa * 0.55; ctx.strokeStyle = '#B4506F'; ctx.lineWidth = 0.5; ctx.stroke(irisArt.collar);
    ctx.globalAlpha = 1; ctx.fillStyle = '#4B1C33'; ctx.fill(irisArt.ruff, 'evenodd');
    // the glints reflect the light outside, so they fade as we come close
    var g = 1 - smooth(1.6, 3.5, zoom);
    if (g > 0) { ctx.globalAlpha = g; ctx.fillStyle = '#FFF8EC'; ctx.fill(EYE.glint); ctx.fill(EYE.glint2); ctx.globalAlpha = 1; }
    ctx.restore();

    // lids and lashes
    ctx.strokeStyle = '#F5F2EA';
    ctx.lineCap = 'round';
    ctx.lineWidth = 6; ctx.stroke(lid.upper);
    ctx.globalAlpha = 0.7; ctx.lineWidth = 3.5; ctx.stroke(EYE.lower); ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    for (i = 0; i < 3; i++) {
      var t = EYE.lashT[i];
      ctx.save(); ctx.translate(0, 2 * t * (1 - t) * (lid.c - 58)); ctx.stroke(EYE.lashes[i]); ctx.restore();
    }
    drawSparks(cam, now, false);
  }

  // ---------- the fall: the retina from above ----------
  // We fall straight down, like the camera of Disney's multiplane looking down through its stacked glass.
  // World units, centred on the spot we fall towards (the macula, which is yellow); layers by their height
  // above the floor of rods and cones.

  // Scatter things on a jittered hex grid inside a circle, thinning out towards its edge,
  // grouped in tiles so we only draw what is on screen.
  function scatter(rnd, R, step, jit, fn) {
    var tiles = {}, n = Math.ceil(R / step) + 1, ts = Math.max(R / 6, step * 4), i, j;
    for (j = -n; j <= n; j++) {
      for (i = -n; i <= n; i++) {
        var x = (i + (j & 1 ? 0.5 : 0)) * step + (rnd() - 0.5) * jit * step, y = j * step * 0.866 + (rnd() - 0.5) * jit * step;
        if (rnd() < smooth(R * 0.45, R, Math.hypot(x, y))) continue;
        var key = Math.floor(x / ts) + ':' + Math.floor(y / ts);
        fn(tiles[key] || (tiles[key] = new Ink()), x, y);
      }
    }
    return Object.keys(tiles).map(function (k) { return tiles[k]; });
  }

  function layer(h, size, near) { return { h: h, size: size, near: near || 0, items: [] }; }
  function circle(x, y, r) { var c = new Path2D(); c.arc(x, y, r, 0, TAU); return c; }

  function buildFall(rnd) {
    var list = [], L, g, i;

    // the floor: the orange disc of the fundus, yellow in the middle
    L = layer(0, 0);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.9);
    g.addColorStop(0, '#F6CB55'); g.addColorStop(0.12, '#EEAA42'); g.addColorStop(0.42, '#D9692E');
    g.addColorStop(0.76, '#A63623'); g.addColorStop(1, 'rgba(60,14,12,0)');
    L.items.push({ path: circle(0, 0, 1.9), fill: g, box: [-1.9, -1.9, 1.9, 1.9] });
    list.push(L);

    // up close, the floor turns out to be a mosaic of rods, with the odd cone among them
    L = layer(0.0005, 0.0046);
    L.items.push({ path: circle(0, 0, 0.43), fill: '#B5691F', box: [-0.43, -0.43, 0.43, 0.43] });
    scatter(rnd, 0.42, 0.0105, 0.15, function (ink, x, y) { ink.hex(x, y, 0.0046, rnd() * 0.3); })
      .forEach(function (t) { L.items.push({ path: t.path, fill: '#FADC80', box: t.box }); });
    scatter(rnd, 0.42, 0.04, 0.9, function (ink, x, y) { ink.dot(x, y, 0.006 + rnd() * 0.004); })
      .forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(150,78,26,.45)', box: t.box }); });
    list.push(L);

    // cell bodies seen from above, as rings, in two layers; the top one is the treetops we fall through
    [[0.1, 0.6, 0.021, 0.0045, 0.003, '#4A2226', 'rgba(120,52,40,.2)'], [0.05, 0.32, 0.0125, 0.0032, 0.0022, '#3A1B20', 'rgba(96,40,40,.28)']].forEach(function (d) {
      var R = d[1], step = d[2], r0 = d[3], dr = d[4];
      L = layer(d[0], r0 + dr / 2);
      scatter(rnd, R, step, 0.6, function (ink, x, y) { ink.dot(x, y, r0 + rnd() * dr); })
        .forEach(function (t) { L.items.push({ path: t.path, fill: d[6], stroke: d[5], lw: step * 0.12, box: t.box }); });
      list.push(L);
    });

    // ganglion cells, as dark dots
    L = layer(0.19, 0.007);
    scatter(rnd, 1.0, 0.034, 0.9, function (ink, x, y) { ink.dot(x, y, 0.003 + rnd() * 0.008); })
      .forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(52,22,26,.82)', box: t.box }); });
    list.push(L);

    // the vessels on top, red rivers coming out of the pale blind spot, curving around the middle
    L = layer(0.3, 0);
    g = ctx.createRadialGradient(BLIND.x, BLIND.y, 0, BLIND.x, BLIND.y, 0.16);
    g.addColorStop(0, '#FFF8E6'); g.addColorStop(0.25, '#FCEBB8'); g.addColorStop(0.6, '#F6D27E'); g.addColorStop(0.8, '#E9A548'); g.addColorStop(1, 'rgba(225,140,60,0)');
    L.items.push({ path: circle(BLIND.x, BLIND.y, 0.16), fill: g, box: [BLIND.x - 0.16, BLIND.y - 0.16, BLIND.x + 0.16, BLIND.y + 0.16] });
    var veins = new Ink(), arteries = new Ink();
    var o = { step: 0.02, wiggle: 0.14, taper: 0.82, spread: 0.55, lenK: 0.7, wK: 0.74, depth: 6, side: 0.07, sideK: 0.45,
      inside: function (x, y) { var r2 = x * x + y * y; return r2 > 0.02 && r2 < 3; } };   // they keep out of the very middle
    [[-0.42, 0.022, 0.015, veins], [-0.56, 0.024, 0.011, arteries], [0.42, -0.022, 0.015, veins], [0.56, -0.024, 0.011, arteries],
      [Math.PI + 0.5, 0, 0.012, veins], [Math.PI - 0.5, 0, 0.011, arteries], [Math.PI + 0.1, 0, 0.009, arteries], [Math.PI - 0.15, 0, 0.009, veins]].forEach(function (v) {
      o.curl = v[1];
      grow(v[3], o, rnd, BLIND.x + Math.cos(v[0]) * 0.03, BLIND.y + Math.sin(v[0]) * 0.03, v[0], 0.62, v[2], 0);
    });
    o.curl = 0;
    L.items.push({ path: veins.path, fill: '#8C1626', stroke: '#4A0A14', lw: 0.003, box: veins.box });
    L.items.push({ path: arteries.path, fill: '#C3343B', stroke: '#5E0E1C', lw: 0.0025, box: arteries.box });
    list.push(L);

    // floaters in the vitreous: faint threads and beads, the only things in the dark on the way down
    [16, 9, 4.6, 2.3, 1.1].forEach(function (h) {
      var fl = new Ink(), n = 2 + Math.floor(rnd() * 2), k, s;
      for (k = 0; k < n; k++) {
        var a = rnd() * TAU, r = rnd() * h * 0.3, x = Math.cos(a) * r, y = Math.sin(a) * r, ang = rnd() * TAU, pts = [];
        for (s = 0; s <= 24; s++) {
          ang += (rnd() - 0.5) * 0.4;
          x += Math.cos(ang) * h * 0.012; y += Math.sin(ang) * h * 0.012;
          pts.push([x, y, h * 0.0012]);
          if (rnd() < 0.12) fl.dot(x, y, h * (0.002 + rnd() * 0.003));
        }
        fl.taper(pts);
      }
      L = layer(h, h * 0.002, h);
      L.items.push({ path: fl.path, fill: 'rgba(70,30,28,.22)', box: fl.box });
      list.push(L);
    });

    list.sort(function (a, b) { return a.h - b.h; });   // farthest (lowest) first
    return list;
  }

  function fallCam(pp) {
    var c = FC, u = clamp((pp - P_PUPIL) / (P_TURN - P_PUPIL), 0, 1);
    c.c = Math.exp(lerp(Math.log(FALL_TOP), Math.log(FALL_END), u));   // a steady rate of zoom all the way down
    if (pp > P_TURN) c.c = FALL_END * (1 - 0.4 * smooth(P_TURN, P_SIDE, pp));
    c.x = ptr.x * 0.07 * c.c;
    c.y = ptr.y * 0.05 * c.c;
    c.roll = reduce ? 0 : 0.9 * u;   // a slow spin, like a falling leaf
    return c;
  }

  function drawFall(cam) {
    rollC = Math.cos(cam.roll); rollS = Math.sin(cam.roll);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0A0C14';
    ctx.fillRect(0, 0, W, H);
    var e = smooth(P_GLOW - 0.01, P_GLOW + 0.05, p), T = PT, i, L, d, s, a;
    if (e > 0) {
      for (i = 0; i < fall.length; i++) {
        L = fall[i]; d = cam.c - L.h;
        if (d < 0.003) continue;
        s = F / d;
        a = L.size ? smooth(0.8, 3, L.size * s) : 1;
        if (L.near) a *= smooth(L.near * 0.04, L.near * 0.25, d);   // floaters fade before they reach us
        if (a < 0.01) continue;
        T.s = s; T.tx = C.x - cam.x * s; T.ty = C.y - cam.y * s + shiftY;
        setT(T.s, T.tx, T.ty);
        drawItems(L.items, T, a);
      }
      // the light falls off towards the edges, as when you look through an ophthalmoscope
      var f = clamp((p - P_GLOW) / (P_TURN - P_GLOW), 0, 1), cy = C.y + shiftY;
      var v = ctx.createRadialGradient(C.x, cy, halfDiag * lerp(0.1, 0.55, f), C.x, cy, halfDiag * lerp(0.75, 1.5, f));
      v.addColorStop(0, 'rgba(10,12,20,0)'); v.addColorStop(1, 'rgba(10,12,20,.92)');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    if (e < 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = alpha(DARK, (1 - e).toFixed(3));
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- the forest: the retina, edge on ----------
  // Seen from the side the retina is a slab: nerve fibres along its ceiling, where the light comes in, rods and
  // cones standing on a yellow floor, and between them a forest of strange trees. Each plane is one slice of the
  // slab at some depth. Heights (Y) are world units, down is positive, divided by the slice's depth (k = 1 / D):
  // that is what makes floor and ceiling run together in the distance.
  function haze(D) { return 0.86 * (1 - Math.exp(-Math.max(0, D - 1.6) / 6)); }

  // Rod or cone: the outer segment stands on the floor, then the inner segment, a thin fibre up to the
  // nucleus, and on up to a small foot where it meets the next cells.
  function photoreceptor(ink, seg, discs, rnd, x, k, cone) {
    var fl = FLOOR * k, w = (cone ? 0.012 : 0.0065) * k, os = (cone ? 0.1 : 0.19) * k, is = (cone ? 0.1 : 0.08) * k;
    var top = fl - os, isTop = top - is, nuc = isTop - (0.04 + rnd() * 0.2) * k, foot = (0.27 + (rnd() - 0.5) * 0.03) * k, sw = (rnd() - 0.5) * 0.03 * k;
    seg.taper(cone ? [[x, fl, w * 0.3], [x, fl - os * 0.5, w * 0.7], [x, top, w]] : [[x, fl, w], [x, top, w]]);
    if (discs) for (var yy = fl - 0.012 * k; yy > top; yy -= 0.012 * k) { discs.moveTo(x - w, yy); discs.lineTo(x + w, yy); }
    ink.taper([[x, top, w * (cone ? 1.05 : 0.9)], [x, top - is * 0.5, w * (cone ? 1.55 : 1)], [x, isTop, w * 0.45]]);
    ink.taper([[x, isTop, w * 0.28], [x + sw, nuc, w * 0.28]]);
    ink.dot(x + sw, nuc, w * (cone ? 1.15 : 0.95));
    ink.taper([[x + sw, nuc, w * 0.24], [x + sw * 0.4, foot, w * 0.24]]);
    if (cone) ink.tri(x + sw * 0.4, foot + w * 0.3, w * 0.9); else ink.dot(x + sw * 0.4, foot, w * 0.5);
  }

  // One tree of the strange forest. Its trunk is a Müller glia cell, the scaffold that really does span the
  // retina from floor to ceiling. The retina's layers are stacked around it as tiers: flat branches of
  // horizontal cells low down, bipolar cells hanging like lanterns, a wide lacy tier of amacrine cells, and a
  // crown of ganglion cells whose axons bend away along the ceiling.
  function tree(ink, lamp, rnd, x, k, lod) {
    var lean = (rnd() - 0.5) * 0.5, ph = rnd() * TAU, ph2 = rnd() * TAU, girth = 0.7 + rnd() * 0.8, j, s, t, Y;
    function at(Y) { return x + (lean * (FLOOR - Y) * 0.25 + 0.035 * Math.sin(Y * 2.6 + ph) + 0.015 * Math.sin(Y * 7 + ph2)) * k; }
    var pts = [];
    for (j = 0; j <= 28; j++) {
      Y = lerp(FLOOR - 0.05, -0.6, j / 28);
      pts.push([at(Y), Y * k, (0.0075 * girth * (1 - 0.35 * j / 28) + 0.012 * smooth(FLOOR - 0.2, FLOOR - 0.05, Y)) * k]);
    }
    ink.taper(pts);
    // roots: the foot splits where it meets the floor
    for (j = 0; j < 2 + lod; j++) {
      var rx = at(FLOOR - 0.05) + (rnd() - 0.5) * 0.18 * k;
      ink.taper([[at(FLOOR - 0.1), (FLOOR - 0.1) * k, 0.005 * girth * k], [lerp(at(FLOOR - 0.1), rx, 0.6), (FLOOR - 0.03) * k, 0.004 * k], [rx, FLOOR * k, 0.0015 * k]]);
    }
    // the crown: the trunk fans out into branches that end in little feet on the ceiling,
    // as Müller cells really do where they meet the inner surface of the retina
    var nc = 3 + Math.floor(rnd() * (2 + lod)), top = at(-0.6), width = 0.3 + rnd() * 0.4, tips = [];
    for (j = 0; j < nc; j++) {
      var tip = top + ((j / (nc - 1) - 0.5) * width + (rnd() - 0.5) * 0.05) * k, cp = [];
      for (s = 0; s <= 10; s++) {
        t = s / 10;
        cp.push([lerp(top, tip, Math.pow(t, 0.55)), lerp(-0.6, CEIL, t) * k, 0.005 * girth * (1 - 0.55 * t) * k]);
      }
      ink.taper(cp);
      ink.blob(tip, (CEIL + 0.012) * k, 0.011 * k, -Math.PI / 2, 0.4);
      tips.push(tip);
    }
    ink.blob(at(0.02), 0.02 * k, 0.016 * girth * k, -Math.PI / 2, 1.2);   // the glia cell's own body, a knot in the trunk
    // tiers: every tree has its own, at its own heights, some reaching up, some drooping
    var o = { step: 0.024 * k, wiggle: 0.26, taper: 0.45, spread: 0.6, lenK: 0.58, wK: 0.66, depth: lod + 1, spine: lod > 1 ? 0.3 : 0, spineLen: 0.012 * k, pullK: 0.07 };
    var tiers = [[0.2, 0.14 + rnd() * 0.22], [-0.47, 0.2 + rnd() * 0.32]];
    if (rnd() < 0.6) tiers.push([-0.64, 0.1 + rnd() * 0.16]);
    tiers.forEach(function (t) {
      var ty = t[0] + (rnd() - 0.5) * 0.1, tilt = (rnd() - 0.5) * 0.5, n = lod ? 1 + Math.floor(rnd() * (lod + 1)) : 1;
      for (s = -1; s <= 1; s += 2) {
        for (j = 0; j < n; j++) {
          o.pull = s > 0 ? -tilt : Math.PI + tilt;
          grow(ink, o, rnd, at(ty), (ty + (rnd() - 0.5) * 0.03) * k, o.pull + (rnd() - 0.5) * 0.4, t[1] * k * (0.6 + rnd() * 0.4), 0.0055 * k, 0);
        }
      }
    });
    if (lod) {
      // little tufts dropping from the low tier to the feet of the rods and cones
      var TUFT = { step: 0.015 * k, wiggle: 0.4, taper: 0.3, spread: 0.7, lenK: 0.5, wK: 0.6, depth: 1, pull: Math.PI / 2, pullK: 0.1 };
      for (j = 0; j < 1 + lod; j++) grow(ink, TUFT, rnd, at(0.2) + (rnd() - 0.5) * 0.3 * k, 0.2 * k, Math.PI / 2, 0.06 * k, 0.003 * k, 0);
    }
    // bipolar cells hang between the tiers like lanterns
    var nb = 1 + Math.floor(rnd() * (2 + lod));
    for (j = 0; j < nb; j++) {
      var bx = at(0) + (rnd() < 0.5 ? -1 : 1) * (0.03 + rnd() * 0.06) * k, by = (-0.2 + rnd() * 0.32) * k;
      ink.taper([[bx, by, 0.0035 * k], [bx + (rnd() - 0.5) * 0.02 * k, 0.2 * k, 0.002 * k]]);
      ink.taper([[bx, by, 0.0035 * k], [bx + (rnd() - 0.5) * 0.03 * k, -0.47 * k, 0.002 * k]]);
      lamp.blob(bx, by, 0.019 * k, -Math.PI / 2, 0.5);
    }
    // the crown: ganglion cells; their axons go up into the canopy
    var DEN = { step: 0.02 * k, wiggle: 0.3, taper: 0.4, spread: 0.7, lenK: 0.6, wK: 0.65, depth: 1 + lod, pull: Math.PI / 2, pullK: 0.03 };
    for (j = 0; j < 1 + Math.floor(rnd() * 2); j++) {
      var gx = at(-0.74) + (rnd() - 0.5) * 0.14 * k, gy = (-0.74 + (rnd() - 0.5) * 0.06) * k;
      lamp.blob(gx, gy, 0.028 * k, -Math.PI / 2, 0.8);
      grow(ink, DEN, rnd, gx, gy, Math.PI / 2 + (rnd() - 0.5) * 0.9, 0.13 * k, 0.0055 * k, 0);
      var gt = tips[Math.floor(rnd() * tips.length)];
      ink.taper([[gx, gy, 0.005 * k], [lerp(gx, gt, 0.5), (CEIL + 0.07) * k, 0.004 * k], [gt, CEIL * k, 0.0035 * k]]);
    }
    return tips;
  }

  // The canopy: nerve fibres slung between the crowns, so the trees hold hands, and long bundles above.
  function canopy(ink, rnd, crowns, X, k, lod) {
    var i, j, s, t, pts;
    function swag(xa, xb, sagMax, wMax) {
      var ya = CEIL + 0.01 + rnd() * 0.06, yb = CEIL + 0.01 + rnd() * 0.06, sag = (0.3 + rnd() * 0.7) * sagMax, w = (0.4 + rnd() * 0.6) * wMax * k, ph = rnd() * TAU;
      pts = [];
      for (s = 0; s <= 18; s++) {
        t = s / 18;
        pts.push([lerp(xa, xb, t), (lerp(ya, yb, t) + Math.sin(Math.PI * t) * sag + 0.012 * Math.sin(t * 9 + ph) * Math.sin(Math.PI * t)) * k, w * (0.6 + 0.4 * Math.sin(Math.PI * t))]);
      }
      ink.taper(pts);
    }
    for (i = 0; i < crowns.length; i++) {
      var c = crowns[i];
      for (j = 0; j < c.length - 1; j++) if (rnd() < 0.7) swag(c[j], c[j + 1], 0.06, 0.004);   // within a crown
      if (i < crowns.length - 1) {
        var d = crowns[i + 1];
        for (j = 0; j < 1 + Math.floor(rnd() * (2 + lod)); j++) swag(c[c.length - 1 - Math.floor(rnd() * 2)], d[Math.floor(rnd() * 2)], 0.22, 0.006);   // to the next tree
      }
    }
    for (i = 0; i < 4 + lod * 3; i++) {
      var Y = CEIL - 0.06 - Math.pow(rnd(), 1.4) * 0.8, ph = rnd() * TAU, amp = 0.03 + rnd() * 0.06, f = 0.8 + rnd() * 1.2, w2 = (0.003 + rnd() * 0.007) * k;
      pts = [];
      for (s = 0; s <= 40; s++) {
        var x = lerp(-X, X, s / 40);
        pts.push([x, (Y + amp * Math.sin(x / k * f + ph)) * k, w2]);
      }
      ink.taper(pts);
    }
  }

  // far away the rods and cones are only a fringe of stripes along the floor
  function palisade(seg, rnd, X, k) {
    var fl = FLOOR * k, step = Math.max(0.006, 0.03 * k);
    for (var x = -X; x < X; x += step * (0.7 + rnd() * 0.6)) seg.taper([[x, fl, 0.006 * k + minInk], [x, fl - 0.3 * k * (0.6 + rnd() * 0.4), minInk]]);
  }

  function slice(D, rnd, view) {
    var pl = { D: D, items: [] }, k = 1 / D, hz = haze(D), X = (view + 0.35) * (D + 1.2) / D, lod = D < 3 ? 2 : D < 9 ? 1 : 0, x, i, g, r;
    var inkC = mix('#2A1317', HAZE, hz), fibC = mix('#3E1A25', HAZE, hz), segC = mix('#9A5A26', HAZE, hz), lampC = mix('#B04A6C', HAZE, hz);
    var ink = new Ink(), fib = new Ink(), seg = new Ink(), lamp = new Ink(), discs = lod > 1 ? new Path2D() : null;
    minInk = 0.4 / H;

    // the canopy: a half-see-through mass above the ceiling
    r = new Path2D(); r.rect(-X, (CEIL - 1.6) * k, 2 * X, 1.6 * k);
    g = ctx.createLinearGradient(0, (CEIL - 0.7) * k, 0, (CEIL + 0.05) * k);
    g.addColorStop(0, alpha(fibC, 0.08)); g.addColorStop(1, alpha(fibC, 0.38));
    pl.items.push({ path: r, fill: g });
    // the floor, lit from above
    r = new Path2D(); r.rect(-X, FLOOR * k, 2 * X, 3);
    g = ctx.createLinearGradient(0, FLOOR * k, 0, (FLOOR + 0.35) * k);
    g.addColorStop(0, mix('#F4C552', HAZE, hz * 0.5)); g.addColorStop(1, mix('#C1722A', HAZE, hz * 0.5));
    pl.items.push({ path: r, fill: g });

    // trees in an irregular row: a few big ones near, more and smaller ones further off
    var xs = [];
    for (x = -X + rnd() * 0.6 * k; x < X; x += Math.max(0.09, (0.75 + rnd() * 1.0) * k)) xs.push(x);
    var crowns = xs.map(function (tx) { return tree(ink, lamp, rnd, tx, k, lod); });
    canopy(fib, rnd, crowns, X, k, lod);
    if (D < 9) {
      var pstep = Math.max(0.008, (D < 3 ? 0.06 : 0.032) * k);
      for (x = -X; x < X; x += pstep * (0.7 + rnd() * 0.6)) photoreceptor(ink, seg, discs, rnd, x, k, rnd() < 0.22);
    } else palisade(seg, rnd, X, k);

    pl.items.push({ path: seg.path, fill: segC, box: seg.box });
    if (discs) pl.items.push({ path: discs, stroke: alpha('#F6D28A', 0.45), lw: 0.0015 * k });
    pl.items.push({ path: ink.path, fill: inkC, box: ink.box });
    pl.items.push({ path: lamp.path, fill: lampC, box: lamp.box });
    pl.items.push({ path: fib.path, fill: fibC, box: fib.box });
    minInk = 0;

    // light streaming down through the canopy at a slant
    if (D < 20) {
      for (i = 0; i < (D < 3 ? 1 : 2); i++) {
        var rx = lerp(-view, view, rnd()) * 1.3, top = (CEIL - 0.25) * k, bot = FLOOR * k, sl = 0.36, w0 = (0.06 + rnd() * 0.12) * k, w1 = w0 * 1.8;
        r = new Path2D();
        r.moveTo(rx - w0 / 2, top); r.lineTo(rx + w0 / 2, top);
        r.lineTo(rx + w1 / 2 + (bot - top) * sl, bot); r.lineTo(rx - w1 / 2 + (bot - top) * sl, bot); r.closePath();
        g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, 'rgba(255,244,214,.42)'); g.addColorStop(0.6, 'rgba(255,236,196,.16)'); g.addColorStop(1, 'rgba(255,230,180,.04)');
        pl.items.push({ path: r, fill: g, comp: 'screen' });
      }
    }
    return pl;
  }

  // A capillary: a tube through the slices. ctrl points are [x, Y (world), depth, samples to the next].
  function makeTube(ctrl, R, col, speed, rnd) {
    var W3 = ctrl.map(function (c) { return [c[0], c[1], c[2]]; }), pts = [], n = W3.length, i, k;
    for (i = 0; i < n - 1; i++) {
      var a = W3[Math.max(0, i - 1)], b = W3[i], c = W3[i + 1], d = W3[Math.min(n - 1, i + 2)], m = ctrl[i][3] || 18;
      for (k = 0; k < m; k++) {
        var t = k / m;
        pts.push([cm(a[0], b[0], c[0], d[0], t), cm(a[1], b[1], c[1], d[1], t), cm(a[2], b[2], c[2], d[2], t)]);
      }
    }
    pts.push(W3[n - 1].slice());
    // it narrows towards its far end, the way a capillary branches off into nothing
    pts.forEach(function (pt, j) { pt[3] = 1 - 0.85 * smooth(0.8, 1, j / (pts.length - 1)); });
    var beads = [];
    for (i = 0; i < 6; i++) beads.push((i + rnd() * 0.5) / 6);
    return { pts: pts, R: R, col: col, scr: new Float32Array(pts.length * 3), beads: beads, speed: speed };
  }

  // Split a tube where it passes a slice, so that nearer slices cover it and it covers the farther ones.
  function splitRuns(tb, Ds, runs) {
    var P = tb.pts, n = P.length, a = 0, i;
    function iv(D) { var c = 0; for (var j = 0; j < Ds.length; j++) if (Ds[j] > D) c++; return Math.max(0, c - 1); }
    var cur = iv(P[0][2]);
    for (i = 1; i < n; i++) {
      var j = iv(P[i][2]);
      if (j !== cur || i === n - 1) {
        var sum = 0;
        for (var k = a; k <= i; k++) sum += P[k][2];
        runs[cur].push({ tube: tb, a0: a, a: Math.max(0, a - 1), b: i, D: sum / (i - a + 1) });
        a = i; cur = j;
      }
    }
  }

  function buildWorld(rnd) {
    var planes = [], view = A / 2, g, r;
    // far off, the slab runs together into a warm haze; light from above
    var bg = { D: 60, items: [] }, X = (view + 0.5) * 1.1;
    r = new Path2D(); r.rect(-X, -2, 2 * X, 4);
    g = ctx.createLinearGradient(0, -0.5, 0, 0.5);
    g.addColorStop(0, '#FCEBC6'); g.addColorStop(0.45, '#EEC995'); g.addColorStop(0.55, '#EBC28A'); g.addColorStop(1, '#F0C45E');
    bg.items.push({ path: r, fill: g });
    planes.push(bg);
    SLICES.forEach(function (D) { planes.push(slice(D, rnd, view)); });

    // capillaries: a red river along the floor, and a thinner one winding through the middle layers
    var red = { fill: '#C1272D', line: '#5E0E1C', shade: '#8E1A22', hi: '#F7B3A8' };
    var tubes = [
      makeTube([[-3.6, 0.86, 1.3], [-1.0, 0.85, 2.0], [-0.2, 0.85, 3.2], [0.9, 0.84, 5], [0.3, 0.84, 8], [-0.8, 0.84, 12], [0.4, 0.84, 18], [0, 0.84, 30]], 0.045, red, 0.05, rnd),
      makeTube([[3.8, -0.25, 1.4], [1.2, -0.1, 2.2], [0.3, -0.02, 3.4], [-0.7, -0.12, 5.2], [-1.4, -0.4, 8], [-1.6, -0.72, 12], [-1.5, -0.86, 15]], 0.022, red, 0.07, rnd)
    ];
    var Ds = planes.map(function (pl) { return pl.D; }), runs = planes.map(function () { return []; });
    tubes.forEach(function (tb) { splitRuns(tb, Ds, runs); });
    runs.forEach(function (list) { list.sort(function (r1, r2) { return r2.D - r1.D; }); });
    return { planes: planes, tubes: tubes, runs: runs, sun: { x: 0, y: 0 } };
  }

  function ensureWorld() {
    if (world) return;
    var t0 = performance.now();
    world = buildWorld(rng(SEED + 1));
    buildMs += performance.now() - t0;
  }

  // A plane of the forest, D units in front of the camera's rest position. Its drawing is in units of the
  // screen height at rest. Flattening slides every plane to the same depth: at rest nothing changes,
  // but the planes stop moving against each other.
  function planeT(D, cam, out) {
    var De = lerp(D, FLAT_D, flatT), den = De - cam.z;
    out.s = H * De / den;
    out.tx = C.x - cam.x * F / den;
    out.ty = C.y - cam.y * F / den + shiftY;
    return den;
  }

  function projectTube(tb, cam) {
    var P = tb.scr, pts = tb.pts;
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i], D = pt[2], De = lerp(D, FLAT_D, flatT), den = Math.max(0.05, De - cam.z), k = De / den;
      P[i * 3] = C.x + pt[0] / D * H * k - cam.x * F / den;
      P[i * 3 + 1] = C.y + pt[1] / D * H * k - cam.y * F / den + shiftY;
      P[i * 3 + 2] = tb.R * pt[3] * F / D * k;
    }
  }

  function fillTaper(pts, style) {
    var path = new Path2D();
    taper(path, pts);
    ctx.fillStyle = style;
    ctx.fill(path);
  }

  // a capillary: solid red, a dark outline, a shaded side and a highlight on the side the light comes from
  function drawRun(r) {
    var tb = r.tube, P = tb.scr, n = tb.pts.length, sun = world.sun, i;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (i = r.a; i <= r.b; i++) {
      var w0 = P[i * 3 + 2];
      x0 = Math.min(x0, P[i * 3] - w0); x1 = Math.max(x1, P[i * 3] + w0);
      y0 = Math.min(y0, P[i * 3 + 1] - w0); y1 = Math.max(y1, P[i * 3 + 1] + w0);
    }
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return;
    var outl = [], body = [], sh = [], hi = [];
    for (i = r.a; i <= r.b; i++) {
      var i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), x = P[i * 3], y = P[i * 3 + 1], w = P[i * 3 + 2];
      var tx = P[i1 * 3] - P[i0 * 3], ty = P[i1 * 3 + 1] - P[i0 * 3 + 1], tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      var lx = sun.x - x, ly = sun.y - y, ll = Math.hypot(lx, ly) || 1;
      lx /= ll; ly /= ll;
      var dot = lx * tx + ly * ty, qx = lx - dot * tx, qy = ly - dot * ty;   // the light, across the tube
      outl.push([x, y, w + Math.max(0.6, w * 0.14)]);
      body.push([x, y, w]);
      sh.push([x - qx * w * 0.42, y - qy * w * 0.42, w * 0.5]);
      hi.push([x + qx * w * 0.48, y + qy * w * 0.48, w * 0.15]);
    }
    fillTaper(outl, tb.col.line);
    fillTaper(body, tb.col.fill);
    ctx.globalAlpha = 0.55; fillTaper(sh, tb.col.shade);
    ctx.globalAlpha = 0.9; fillTaper(hi, tb.col.hi);
    ctx.globalAlpha = 1;
    // red blood cells drifting along
    for (var k = 0; k < tb.beads.length; k++) {
      var fi = tb.beads[k] * (n - 1);
      if (fi < r.a0 || fi >= r.b) continue;
      var j = Math.floor(fi), f = fi - j, j2 = Math.min(n - 1, j + 1);
      var bx = lerp(P[j * 3], P[j2 * 3], f), by = lerp(P[j * 3 + 1], P[j2 * 3 + 1], f), bw = Math.max(0.8, lerp(P[j * 3 + 2], P[j2 * 3 + 2], f));
      ctx.fillStyle = 'rgba(255,214,204,.75)';
      ctx.beginPath(); ctx.ellipse(bx, by, bw * 0.7, bw * 0.45, 0, 0, TAU); ctx.fill();
    }
  }

  function sideCam(pp) {
    var c = SC, u, e;
    if (pp < P_REST) {
      // just under the canopy after the turn, then down into the forest
      u = clamp((pp - P_TURN) / (P_REST - P_TURN), 0, 1); e = 1 - Math.pow(1 - u, 2.2);
      c.y = lerp(-0.65, 0, e);
      c.z = -0.7 * (1 - e);
    } else {
      // deeper in, down among the rods and cones
      e = easeInOut((pp - P_REST) / (1 - P_REST));
      c.y = 0.4 * e;
      c.z = 1.05 * e;
    }
    var wf = smooth(P_TURN, P_SIDE + 0.04, pp);
    c.x = ptr.x * 0.12 * wf;
    c.y += ptr.y * 0.05 * wf;
    return c;
  }

  function drawSide(cam) {
    ensureWorld();
    rollC = 1; rollS = 0;
    var planes = world.planes, T = PT, j, i;
    world.sun.x = C.x + W * 0.15; world.sun.y = shiftY - H * 2;   // the light is high above
    for (i = 0; i < world.tubes.length; i++) projectTube(world.tubes[i], cam);
    for (j = 0; j < planes.length; j++) {
      var den = planeT(planes[j].D, cam, T), mult = j === 0 ? 1 : smooth(0.3, 0.7, den);   // slices fade before they reach us
      if (mult > 0.01) {
        setT(T.s, T.tx, T.ty);
        drawItems(planes[j].items, T, mult);
      }
      var runs = world.runs[j];
      if (runs.length) { setT(1, 0, 0); for (i = 0; i < runs.length; i++) drawRun(runs[i]); }
    }
  }

  // a quick vertical smear, for the turn: average the frame with copies of itself slid up and down
  function smear(len) {
    if (len < 2) return;
    if (!tmp) tmp = document.createElement('canvas');
    if (tmp.width !== canvas.width || tmp.height !== canvas.height) { tmp.width = canvas.width; tmp.height = canvas.height; }
    var t2 = tmp.getContext('2d'), n = 8, i;
    t2.setTransform(1, 0, 0, 1, 0, 0);
    t2.clearRect(0, 0, tmp.width, tmp.height);
    t2.drawImage(canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (i = 1; i < n; i++) {
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(tmp, 0, (i / (n - 1) - 0.5) * len * dpr);
    }
    ctx.globalAlpha = 1;
  }

  function region(y0, y1, draw) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(0, y0, W, y1 - y0);
    ctx.clip();
    draw();
    ctx.restore();
  }

  // ---------- camera at the eye ----------
  function eyeCam(pp) {
    var c = CAM, u = clamp((pp - P_DIVE) / (P_PUPIL - P_DIVE), 0, 1);
    var d = Math.exp(Math.log(dMin) * Math.pow(u, 1.6));   // a steady zoom rate, gently started
    var f = (d - dMin) / (1 - dMin);                          // 1 at rest, 0 at the pupil: drift to its middle
    c.z = Z_EYE - d;
    c.x = (cam0.x + ptr.x * 0.014) * f;
    c.y = (cam0.y + ptr.y * 0.009) * f;
    return c;
  }

  // ---------- render ----------
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    shiftY = 0; rollC = 1; rollS = 0;
    if (p < P_PUPIL) { drawEye(eyeCam(p), now); return; }
    // the turn: like a camera tilting up from the floor to look ahead, both views slide down,
    // with a dark frame line between them, and smear while they move fast
    var t = reduce ? (p < P_TURN ? 0 : 1) : smooth(P_TURN, P_SIDE, p), gap = 0.1 * H, sl = 1.1 * H;
    if (t < 1) {
      var fc = fallCam(p);
      shiftY = t * sl;
      region(shiftY, H, function () { drawFall(fc); });
    }
    if (t > 0) {
      var sc = sideCam(p);
      shiftY = -(1 - t) * sl;
      region(0, Math.min(H, H + shiftY), function () { drawSide(sc); });
    }
    if (t > 0 && t < 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#07060A';
      ctx.fillRect(0, H - (1 - t) * sl, W, gap);
      smear(Math.sin(Math.PI * t) * 0.18 * H);
    }
    shiftY = 0;
  }

  // ---------- update: scroll, pointer, the eye's own life ----------
  var heroCopy = document.getElementById('hero-copy'), worldCopy = document.getElementById('world-copy');
  var flatBtn = document.getElementById('flat');
  function fade(el, v) {
    v = Math.round(v * 100) / 100;
    if (el._o === v) return;
    el._o = v;
    el.style.opacity = v;
    el.style.visibility = v > 0 ? 'visible' : 'hidden';
  }
  function scrollP() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  }

  var shown = null, swapAt = 0;
  function update(dt, now) {
    var target = fixedP != null ? fixedP : scrollP();
    if (reduce) {
      // no flight: fade between the two ends
      target = target < 0.5 ? 0 : 1;
      if (shown === null) { shown = target; p = target; }
      if (target !== shown && !swapAt) { canvas.classList.add('is-fading'); swapAt = now + 300; }
      if (swapAt && now > swapAt) { shown = target; p = target; swapAt = 0; canvas.classList.remove('is-fading'); }
    } else {
      p = fixedP != null ? target : p + (target - p) * (1 - Math.exp(-dt * 6));
      if (Math.abs(target - p) < 1e-4) p = target;
    }

    // the pointer, or a slow drift when nobody moves it
    if (fixedPtr) { ptr.tx = fixedPtr.x; ptr.ty = fixedPtr.y; }
    else if (now - ptr.last > 2500) {
      var t = now / 1000;
      ptr.tx = reduce ? 0 : 0.6 * Math.sin(t * 0.27);
      ptr.ty = reduce ? 0 : 0.45 * Math.sin(t * 0.41 + 1.3);
    }
    var kp = fixedPtr ? 1 : 1 - Math.exp(-dt * 3.5);
    ptr.x += (ptr.tx - ptr.x) * kp;
    ptr.y += (ptr.ty - ptr.y) * kp;
    flatT += (flatTarget - flatT) * (fixedP != null ? 1 : 1 - Math.exp(-dt * 3));

    // the iris follows the pointer, and looks around by itself when nobody moves
    var MAX_X = 14, MAX_Y = 7;
    if (fixedPtr || now - ptr.last < 2500) {
      var px = fixedPtr ? (fixedPtr.x + 1) / 2 * W : ptr.cx, py = fixedPtr ? (fixedPtr.y + 1) / 2 * H : ptr.cy;
      var dx = px - C.x, dy = py - (C.y - cam0.y * F), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / (eyePx * 0.55));
      iris.tx = dx / d * MAX_X * k; iris.ty = dy / d * MAX_Y * k;
    } else if (now > iris.wanderAt && !reduce) {
      var a = Math.random() * TAU, kk = 0.4 + Math.random() * 0.6;
      iris.tx = Math.cos(a) * MAX_X * kk; iris.ty = Math.sin(a) * MAX_Y * kk;
      iris.wanderAt = now + 1600 + Math.random() * 1800;
    }
    var look = 1 - smooth(0.02, 0.1, p), ki = reduce || fixedPtr ? 1 : 1 - Math.exp(-dt * 7);   // diving in, it looks straight at us
    iris.x += (iris.tx * look - iris.x) * ki;
    iris.y += (iris.ty * look - iris.y) * ki;

    // a blink now and then, while we are still outside
    var ts = now / 1000;
    if (!reduce && fixedP == null && p < 0.03 && ts > blink.at) { blink.start = ts; blink.at = ts + 3.5 + Math.random() * 4; }
    var bt = (ts - blink.start) / 0.2;
    blink.v = bt >= 0 && bt <= 1 ? Math.sin(Math.PI * bt) : 0;

    if (!reduce && world) world.tubes.forEach(function (tb) {
      for (var i = 0; i < tb.beads.length; i++) tb.beads[i] = (tb.beads[i] + dt * tb.speed) % 1;
    });

    fade(heroCopy, 1 - smooth(0.012, 0.06, p));
    fade(worldCopy, smooth(0.93, 0.985, p));
  }

  // ---------- setup ----------
  function layout() {
    var t0 = performance.now();
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    A = W / H; F = H; C = { x: W / 2, y: H / 2 }; halfDiag = Math.hypot(W, H) / 2;
    var portrait = W < H;
    eyePx = Math.min(W * (portrait ? 0.6 : 0.5), H * 0.72);   // narrow screens: keep the logo's sparkles on screen
    EYE_S = eyePx / (192 * H);   // world units per logo unit, at the eye's distance (1) with F = H
    cam0 = { x: 0, y: portrait ? 0.13 : 0.1 };   // the eye sits above the middle, the headline below it
    dMin = 13 * EYE_S * F / (1.3 * halfDiag);   // this close, the pupil fills the screen
    fall = buildFall(rng(SEED));
    // the forest takes a moment to grow; the eye does not need it yet, so open on the eye first
    world = null;
    setTimeout(ensureWorld, 50);
    sparks = buildSparks();
    if (!irisArt) irisArt = buildIris(rng(SEED + 5));
    irisGrad = ctx.createRadialGradient(194.6, 129.8, 0, 194.6, 129.8, 34);
    irisGrad.addColorStop(0, '#F7D3DE'); irisGrad.addColorStop(0.65, '#E7A1B6'); irisGrad.addColorStop(1, '#8E2F55');
    glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 140);
    glowGrad.addColorStop(0, 'rgba(231,161,182,.16)'); glowGrad.addColorStop(0.6, 'rgba(231,161,182,.07)'); glowGrad.addColorStop(1, 'rgba(231,161,182,0)');
    nightGrad = ctx.createLinearGradient(0, 0, 0, H);
    nightGrad.addColorStop(0, '#18263F'); nightGrad.addColorStop(1, '#0A111D');
    buildMs = performance.now() - t0;
  }

  function makeGrain() {
    var c = document.createElement('canvas'), g = c.getContext('2d'), n = 128, img, i, v;
    c.width = c.height = n;
    img = g.createImageData(n, n);
    for (i = 0; i < n * n; i++) { v = Math.random() * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    document.querySelector('.grain').style.backgroundImage = 'url(' + c.toDataURL() + ')';
  }

  // ---------- input ----------
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || fixedPtr) return;
    ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.last = performance.now();
    ptr.tx = clamp(e.clientX / W * 2 - 1, -1, 1); ptr.ty = clamp(e.clientY / H * 2 - 1, -1, 1);
  }, { passive: true });
  // phones: tilt to look around (where the browser sends orientation without asking)
  window.addEventListener('deviceorientation', function (e) {
    if (e.gamma == null || fixedPtr) return;
    ptr.last = performance.now();
    ptr.tx = clamp(e.gamma / 25, -1, 1); ptr.ty = clamp((e.beta - 45) / 25, -1, 1);
    ptr.cx = (ptr.tx + 1) / 2 * W; ptr.cy = (ptr.ty + 1) / 2 * H;
  });
  flatBtn.setAttribute('aria-pressed', flatTarget ? 'true' : 'false');
  flatBtn.addEventListener('click', function () {
    flatTarget = flatTarget ? 0 : 1;
    flatBtn.setAttribute('aria-pressed', flatTarget ? 'true' : 'false');
  });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 150); });

  // ---------- go ----------
  var hud = q.has('debug') ? document.body.appendChild(document.createElement('pre')) : null, hudAt = 0, renderMs = 0, frameMs = 16, last = 0;
  if (hud) hud.className = 'hud';
  function frame(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    frameMs = lerp(frameMs, last ? now - last : 16, 0.1);
    last = now;
    update(dt, now);
    var t0 = performance.now();
    render(now);
    renderMs = lerp(renderMs, performance.now() - t0, 0.1);
    if (hud && now - hudAt > 250) {
      hudAt = now;
      hud.textContent = 'fps ' + (1000 / frameMs).toFixed(0) + '  draw ' + renderMs.toFixed(1) + 'ms  build ' + buildMs.toFixed(0) + 'ms\n' +
        'p ' + p.toFixed(3) + '  fall ' + FC.c.toFixed(3) + '  side ' + SC.y.toFixed(2) + ',' + SC.z.toFixed(2) + '  flat ' + flatT.toFixed(2);
    }
    requestAnimationFrame(frame);
  }

  // for tuning: time a frame at a given scroll position (forces the canvas to finish drawing)
  window.__dive = {
    bench: function (pp, n) {
      var keep = p, t0, i;
      n = n || 20; p = pp; t0 = performance.now();
      for (i = 0; i < n; i++) render(t0 + i * 16);
      ctx.getImageData(0, 0, 1, 1);
      var ms = (performance.now() - t0) / n;
      p = keep;
      return Math.round(ms * 100) / 100;
    },
    build: function () { return Math.round(buildMs); },
    world: function () { ensureWorld(); return world; }
  };

  makeGrain();
  layout();
  requestAnimationFrame(frame);
})();
