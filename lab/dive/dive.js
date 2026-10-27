// sehn.ai lab: a dive into the eye.
// Everything on screen is a flat plane at some depth, and only the camera moves,
// like Disney's multiplane camera: the depth you feel comes from parallax alone.
// The story: the eye; through the pupil into the dark of the vitreous; a fall straight down onto the
// retina, its layers seen from above, into the roof of the forest; a cut hidden in the dark of that roof;
// and we come out inside the retina, looking along it, among its cells.
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
  var SKIP = (q.get('skip') || '').split(',');   // ?skip=planes,slices,veil,rays,river,trunks: leave things out, to see what costs what
  var TAU = Math.PI * 2;

  // the scroll, start to end: rest; fly at the eye until the pupil fills the screen; a moment of dark; the retina
  // glows up far below and we fall into it; the cut, in the dark of the roof; down into the forest; deeper in
  var P_DIVE = 0.03, P_PUPIL = 0.14, P_GLOW = 0.16, P_CUT = 0.4, P_REST = 0.66;
  var Z_EYE = 1, FLAT_D = 4.2;
  var FALL_TOP = 45, ROOF_H = 0.26;   // the fall: camera height above the floor of rods and cones, and the roof we fall into
  var BLIND = { x: -0.62, y: 0.05 };  // the blind spot, where the nerve fibres leave and the vessels come in
  // the retina edge on, in world units, down is positive: its inner surface, where the glia's roots stop, the floor
  var ILM = -0.9, OLM = 0.6, FLOOR = 0.9;
  var SLICES = [13, 7.5, 4.4, 2.7, 1.7];
  var CAM_Z0 = -0.6, CAM_Z1 = 1;      // the forest camera's depth just after the cut, and at the very end
  var HAZE = '#DDB57C', DARK = '#0E1726';

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
  function circle(x, y, r) { var c = new Path2D(); c.arc(x, y, r, 0, TAU); return c; }

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
  // While the forest is painted, strokes swell and thin along their length, like a brush.
  var wobble = 0, wob = Math.random;
  Ink.prototype.taper = function (pts) {
    if (wobble) {
      var ph = wob() * TAU, ph2 = wob() * TAU;
      pts = pts.map(function (pt, i) { return [pt[0], pt[1], pt[2] * (1 + wobble * (0.6 * Math.sin(i * 0.9 + ph) + 0.4 * Math.sin(i * 2.3 + ph2)))]; });
    }
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
  // a rounded triangle, pointing up (the broad foot of a cone)
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
  // The thinnest a stroke may get, in drawing units, set per layer so that every twig stays visible:
  // Cajal inked every last branch, and that is what makes his cells dense.
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
    if (o.joint) ink.dot(x, y, wi);   // a round joint where it forks, so the branches grow out of it smoothly
    for (i = 0; i < 2; i++) {
      grow(ink, o, rnd, x, y, ang + (i - 0.5) * o.spread * (0.7 + rnd() * 0.6), len * o.lenK * (0.75 + rnd() * 0.5), wi * o.wK, depth + 1);
    }
  }

  // ---------- textures ----------
  // tileable value noise, a few octaves, 0..1
  function noiseTile(n, cells, octaves, rnd) {
    var out = new Float32Array(n * n), amp = 1, total = 0, o, x, y;
    for (o = 0; o < octaves; o++) {
      var c = cells << o, g = new Float32Array(c * c);
      for (x = 0; x < c * c; x++) g[x] = rnd();
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          var fx = x / n * c, fy = y / n * c, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          var x1 = (ix + 1) % c, y1 = (iy + 1) % c;
          out[y * n + x] += amp * lerp(lerp(g[iy * c + ix], g[iy * c + x1], tx), lerp(g[y1 * c + ix], g[y1 * c + x1], tx), ty);
        }
      }
      total += amp; amp *= 0.5;
    }
    for (x = 0; x < n * n; x++) out[x] /= total;
    return out;
  }
  function texCanvas(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function pixels(n, fn) {
    return texCanvas(n, n, function (g) {
      var img = g.createImageData(n, n), i, px;
      for (i = 0; i < n * n; i++) { px = fn(i); img.data[i * 4] = px[0]; img.data[i * 4 + 1] = px[1]; img.data[i * 4 + 2] = px[2]; img.data[i * 4 + 3] = px[3]; }
      g.putImageData(img, 0, 0);
    });
  }

  var TEX = {};
  function makeTextures() {
    var rnd = rng(SEED + 9);
    // pigment settling unevenly in a wash: soft dark blotches
    var nz = noiseTile(256, 4, 4, rnd);
    TEX.mottle = pixels(256, function (i) { return [34, 12, 14, clamp((nz[i] - 0.38) * 2.2, 0, 1) * 255]; });
    var nw = noiseTile(256, 3, 3, rnd);
    TEX.warm = pixels(256, function (i) { return [176, 96, 34, clamp((nw[i] - 0.45) * 2.6, 0, 1) * 255]; });
    var ns = noiseTile(128, 16, 2, rnd);
    TEX.speckle = pixels(128, function (i) { return [0, 0, 0, smooth(0.56, 0.72, ns[i]) * 255]; });
    // the grain of the paper
    TEX.grain = pixels(128, function () { var v = rnd(); return [40, 20, 16, v < 0.5 ? v * 70 : 0]; });
    // rods seen end on: a fine honeycomb of pale discs
    TEX.rods = texCanvas(24, 42, function (g) {
      g.fillStyle = '#C9902F'; g.fillRect(0, 0, 24, 42);
      [[0, 0], [24, 0], [12, 21], [0, 42], [24, 42]].forEach(function (c) {
        var gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], 11);
        gr.addColorStop(0, '#FBE59A'); gr.addColorStop(0.7, '#F2CD6A'); gr.addColorStop(1, 'rgba(242,205,106,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(c[0], c[1], 11, 0, TAU); g.fill();
      });
    });
    // nuclei seen from above: a scatter of small dark dots
    TEX.dots = texCanvas(64, 64, function (g) {
      for (var i = 0; i < 40; i++) { g.fillStyle = 'rgba(80,36,30,' + (0.3 + rnd() * 0.4).toFixed(2) + ')'; g.beginPath(); g.arc(rnd() * 64, rnd() * 64, 1.2 + rnd() * 1.6, 0, TAU); g.fill(); }
    });
    // the floor seen in perspective: the pigment epithelium's cells, hexagons washed in yellow
    TEX.floor = texCanvas(60, 104, function (g) {
      g.fillStyle = 'rgba(140,72,20,.55)'; g.fillRect(0, 0, 60, 104);
      [[0, 0], [60, 0], [30, 52], [0, 104], [60, 104]].forEach(function (c) {
        g.fillStyle = 'rgba(255,228,140,.9)'; g.beginPath();
        for (var i = 0; i <= 6; i++) { var t = Math.PI / 6 + i / 6 * TAU; g[i ? 'lineTo' : 'moveTo'](c[0] + Math.cos(t) * 28, c[1] + Math.sin(t) * 28); }
        g.fill();
      });
    });
    // the roof seen from below: the bodies of ganglion cells, dark against the light coming through
    TEX.roof = texCanvas(96, 96, function (g) {
      for (var i = 0; i < 16; i++) {
        var x = rnd() * 96, y = rnd() * 96, r = 8 + rnd() * 9;
        [-96, 0, 96].forEach(function (ox) { [-96, 0, 96].forEach(function (oy) {
          g.fillStyle = 'rgba(70,24,36,' + (0.28 + rnd() * 0.25).toFixed(2) + ')'; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.8, 0, 0, TAU); g.fill();
        }); });
      }
    });
    // a shaft of light: soft across, fading as it goes down
    TEX.ray = texCanvas(64, 256, function (g) {
      var img = g.createImageData(64, 256), x, y;
      for (y = 0; y < 256; y++) {
        for (x = 0; x < 64; x++) {
          var u = (x - 31.5) / 32, a = Math.exp(-u * u * 4.5) * (1 - 0.7 * y / 255) * smooth(0, 20, y), i = (y * 64 + x) * 4;
          img.data[i] = 255; img.data[i + 1] = 240; img.data[i + 2] = 205; img.data[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
  }
  function pattern(g, tex, scale, ox, oy) {
    var pt = g === ctx ? tex.pat || (tex.pat = ctx.createPattern(tex, 'repeat')) : g.createPattern(tex, 'repeat');
    pt.setTransform(new DOMMatrix([scale, 0, 0, scale, ox || 0, oy || 0]));
    return pt;
  }

  // ---------- watercolour ----------
  // The forest is painted once, slice by slice, into bitmaps: cels for the multiplane's glass. Each colour goes
  // down as a wash: uneven pigment, a soft bleed past its edges, pigment pooling darker along them, then the paper.
  var scratch = [];
  function blank(i, w, h) {
    var c = scratch[i] || (scratch[i] = document.createElement('canvas')), g;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.clearRect(0, 0, w, h);
    return c;
  }
  function wash(out, path, colour, edge, qpx, box, soft, dry) {
    var w = out.width, h = out.height, o = out.getContext('2d'), r = Math.max(0.8, soft * qpx);
    var A = blank(0, w, h), B = blank(1, w, h), E = blank(2, w, h), a = A.getContext('2d'), b = B.getContext('2d'), e = E.getContext('2d');
    // the shape in its colour, the pigment settling unevenly
    a.setTransform(qpx, 0, 0, qpx, -box[0] * qpx, -box[1] * qpx);
    a.fillStyle = colour; a.fill(path);
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'source-atop'; a.globalAlpha = 0.55;
    a.fillStyle = pattern(a, TEX.mottle, 1.4); a.fillRect(0, 0, w, h);
    a.globalAlpha = 0.22;
    a.fillStyle = pattern(a, TEX.warm, 2.2, 37, 91); a.fillRect(0, 0, w, h);
    if (dry) {
      a.globalCompositeOperation = 'destination-out'; a.globalAlpha = dry;
      a.fillStyle = pattern(a, TEX.speckle, 1 + qpx / 1500, 13, 7); a.fillRect(0, 0, w, h);
    }
    a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
    // a soft copy: it bleeds past the edges, and tells us where the edges are
    b.filter = 'blur(' + r.toFixed(1) + 'px)'; b.drawImage(A, 0, 0); b.filter = 'none';
    // pigment pooling along the edges: the shape minus its soft copy, darker
    e.drawImage(A, 0, 0);
    e.globalCompositeOperation = 'destination-out'; e.drawImage(B, 0, 0);
    e.globalCompositeOperation = 'source-in'; e.fillStyle = edge; e.fillRect(0, 0, w, h);
    o.globalAlpha = 0.42; o.drawImage(B, 0, 0);
    o.globalAlpha = 0.88; o.drawImage(A, 0, 0);
    o.globalAlpha = 0.6; o.drawImage(E, 0, 0);
    o.globalAlpha = 1;
  }
  function paper(out, strength) {
    var o = out.getContext('2d');
    o.globalCompositeOperation = 'source-atop'; o.globalAlpha = strength;
    o.fillStyle = pattern(o, TEX.grain, 1); o.fillRect(0, 0, out.width, out.height);
    o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
  }

  // ---------- state ----------
  var W, H, dpr, A, F, C, halfDiag, eyePx, EYE_S, dMin, cam0;
  var fall, forest, sparks, nightGrad, glowGrad, irisGrad, irisArt;
  var p = fixedP != null ? fixedP : 0, flatT = q.has('flat') ? 1 : 0, flatTarget = flatT;
  var rollC = 1, rollS = 0, buildMs = 0;
  var ptr = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, last: -1e9 };
  var iris = { x: 0, y: 0, tx: 0, ty: 0, wanderAt: 0 };
  var blink = { at: 2.2, start: -10, v: 0 };
  var CAM = { x: 0, y: 0, z: 0 }, FC = { x: 0, y: 0, c: FALL_TOP, roll: 0 }, SC = { x: 0, y: 0, z: 0, deep: 0 }, PT = { s: 1, tx: 0, ty: 0 };

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

  function eyeCam(pp) {
    var c = CAM, u = clamp((pp - P_DIVE) / (P_PUPIL - P_DIVE), 0, 1);
    var d = Math.exp(Math.log(dMin) * Math.pow(u, 1.5));   // a steady zoom rate, gently started
    var f = (d - dMin) / (1 - dMin);                          // 1 at rest, 0 at the pupil: drift to its middle
    c.z = Z_EYE - d;
    c.x = (cam0.x + ptr.x * 0.014) * f;
    c.y = (cam0.y + ptr.y * 0.009) * f;
    return c;
  }

  // ---------- the fall: the retina from above ----------
  // We fall straight down, as Disney's multiplane camera looked down through its stacked glass. The retina's
  // layers lie one under the other, and we see down through them: the vessels and nerve fibres on top, the
  // honeycomb roof of ganglion cells, the lace of the amacrine cells, the cell bodies of the middle layer
  // like bubbles, the stars of the horizontal cells, and at the bottom the yellow floor of rods and cones.
  // World units, centred on the spot we fall towards; layers by their height above the floor.

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

  // An organic honeycomb: a hex lattice whose corners are nudged (each corner once, so neighbours still meet),
  // its cells drawn as soft pillows set a little apart, so you see down between them, each with its nucleus.
  function honeycomb(rnd, R, s, jit) {
    var tiles = {}, n = Math.ceil(R / s) + 2, ts = R / 6, cr = s / Math.sqrt(3), i, j, c;
    function nudge(x, y) {   // the same corner always moves the same way, whichever cell asks
      var h = Math.sin(Math.round(x * 1e4) * 12.9898 + Math.round(y * 1e4) * 78.233) * 43758.5453, f = h - Math.floor(h);
      var a = f * TAU, m = (0.5 + 0.5 * Math.sin(f * 91.7)) * jit * s;
      return [x + Math.cos(a) * m, y + Math.sin(a) * m];
    }
    for (j = -n; j <= n; j++) {
      for (i = -n; i <= n; i++) {
        var cx = (i + (j & 1 ? 0.5 : 0)) * s, cy = j * s * 0.866;
        if (rnd() < smooth(R * 0.45, R, Math.hypot(cx, cy))) continue;
        var key = Math.floor(cx / ts) + ':' + Math.floor(cy / ts);
        var t = tiles[key] || (tiles[key] = { cells: [new Ink(), new Ink(), new Ink()], nuc: new Ink() }), pts = [];
        for (c = 0; c < 6; c++) {
          var a = Math.PI / 6 + c / 6 * TAU, q = nudge(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr), inset = 0.84 + rnd() * 0.06;
          pts.push([lerp(cx, q[0], inset), lerp(cy, q[1], inset)]);
        }
        var ink = t.cells[Math.floor(rnd() * 3)], P = ink.path;
        P.moveTo((pts[5][0] + pts[0][0]) / 2, (pts[5][1] + pts[0][1]) / 2);
        for (c = 0; c < 6; c++) { var nx = pts[(c + 1) % 6]; P.quadraticCurveTo(pts[c][0], pts[c][1], (pts[c][0] + nx[0]) / 2, (pts[c][1] + nx[1]) / 2); }
        P.closePath();
        ink.fit(cx, cy, cr * 1.2);
        if (rnd() < 0.8) t.nuc.dot(cx + (rnd() - 0.5) * s * 0.25, cy + (rnd() - 0.5) * s * 0.25, s * (0.11 + rnd() * 0.06));
      }
    }
    return Object.keys(tiles).map(function (k) { return tiles[k]; });
  }
  function disc(R, colour) {
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, colour); g.addColorStop(0.55, colour); g.addColorStop(1, alpha(colour, 0));
    return { path: circle(0, 0, R), fill: g, box: [-R, -R, R, R] };
  }

  function buildFall(rnd) {
    var list = [], L, g, i;

    // the floor: the orange disc of the fundus, yellow in the middle
    L = layer(0, 0);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.9);
    g.addColorStop(0, '#F6CB55'); g.addColorStop(0.12, '#EEAA42'); g.addColorStop(0.42, '#D9692E');
    g.addColorStop(0.76, '#A63623'); g.addColorStop(1, 'rgba(60,14,12,0)');
    L.items.push({ path: circle(0, 0, 1.9), fill: g, box: [-1.9, -1.9, 1.9, 1.9] });
    list.push(L);

    // up close, the floor is a fine honeycomb of rods with the odd cone among them, darker
    L = layer(0.0005, 0.0012);
    var rods = pattern(ctx, TEX.rods, 0.0048 / 24);
    L.items.push({ path: circle(0, 0, 0.5), fill: rods, box: [-0.5, -0.5, 0.5, 0.5] });
    scatter(rnd, 0.48, 0.012, 0.8, function (ink, x, y) { ink.dot(x, y, 0.0028 + rnd() * 0.0012); })
      .forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(122,52,24,.82)', box: t.box }); });
    list.push(L);

    // the nuclei of the rods and cones, a little above
    L = layer(0.05, 0.0015);
    L.items.push(Object.assign(disc(0.45, '#FFFFFF'), { fill: pattern(ctx, TEX.dots, 0.03 / 64), a: 0.55 }));
    list.push(L);

    // horizontal cells: wide, flat stars
    L = layer(0.09, 0.004);
    var stars = new Ink(), so = { step: 0.004, wiggle: 0.5, taper: 0.4, spread: 0.8, lenK: 0.6, wK: 0.65, depth: 2 };
    scatter(rnd, 0.45, 0.055, 1, function (ink, x, y) {
      for (var j = 0; j < 6; j++) grow(ink, so, rnd, x, y, j / 6 * TAU + rnd(), 0.018 + rnd() * 0.012, 0.0008, 0);
      ink.dot(x, y, 0.0025);
    }).forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(70,30,26,.55)', box: t.box }); });
    list.push(L);

    // the middle layer's cell bodies, packed like bubbles, see-through
    L = layer(0.15, 0.005);
    scatter(rnd, 0.42, 0.0115, 0.5, function (ink, x, y) { ink.dot(x, y, 0.0042 + rnd() * 0.0016); })
      .forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(150,70,40,.16)', stroke: 'rgba(74,34,38,.6)', lw: 0.0011, box: t.box }); });
    list.push(L);

    // the amacrine cells' lace
    L = layer(0.205, 0.004);
    var lo = { step: 0.004, wiggle: 0.6, taper: 0.5, spread: 0.9, lenK: 0.62, wK: 0.66, depth: 3 };
    scatter(rnd, 0.42, 0.035, 1, function (ink, x, y) {
      for (var j = 0; j < 4; j++) grow(ink, lo, rnd, x, y, j / 4 * TAU + rnd() * 1.5, 0.012 + rnd() * 0.01, 0.0007, 0);
      ink.dot(x, y, 0.002);
    }).forEach(function (t) { L.items.push({ path: t.path, fill: 'rgba(58,24,30,.6)', box: t.box }); });
    list.push(L);

    // the roof: an organic honeycomb of ganglion cells, see-through, in three shades, each with its nucleus
    L = layer(ROOF_H, 0.009);
    var cells = [], nuclei = [], shades = ['rgba(110,40,58,.24)', 'rgba(88,30,48,.34)', 'rgba(132,54,72,.17)'];
    honeycomb(rnd, 0.5, 0.02, 0.22).forEach(function (t) {
      t.cells.forEach(function (ink, c) { if (isFinite(ink.box[0])) cells.push({ path: ink.path, fill: shades[c], stroke: 'rgba(62,20,34,.5)', lw: 0.0009, box: ink.box }); });
      if (isFinite(t.nuc.box[0])) nuclei.push({ path: t.nuc.path, fill: 'rgba(58,18,32,.5)', box: t.nuc.box });
    });
    L.items = cells.concat(nuclei);
    list.push(L);

    // on top: the nerve fibres, streaming to the blind spot, and the vessels, red rivers coming out of it
    L = layer(0.3, 0, 0.07);
    var nfl = new Ink(), fo = { step: 0.02, wiggle: 0.05, taper: 0.7, spread: 0.3, lenK: 0.8, wK: 0.8, depth: 0 };
    for (i = 0; i < 160; i++) {
      var a0 = rnd() * TAU, r0 = 0.15 + rnd() * 1.4, sx = Math.cos(a0) * r0, sy = Math.sin(a0) * r0;
      fo.pull = Math.atan2(BLIND.y - sy, BLIND.x - sx); fo.pullK = 0.12;
      grow(nfl, fo, rnd, sx, sy, fo.pull + (rnd() - 0.5) * 0.6, Math.hypot(BLIND.x - sx, BLIND.y - sy) * 0.9, 0.0012, 0);
    }
    L.items.push({ path: nfl.path, fill: 'rgba(255,236,200,.2)', box: nfl.box });
    g = ctx.createRadialGradient(BLIND.x, BLIND.y, 0, BLIND.x, BLIND.y, 0.16);
    g.addColorStop(0, '#FFF8E6'); g.addColorStop(0.25, '#FCEBB8'); g.addColorStop(0.6, '#F6D27E'); g.addColorStop(0.8, '#E9A548'); g.addColorStop(1, 'rgba(225,140,60,0)');
    L.items.push({ path: circle(BLIND.x, BLIND.y, 0.16), fill: g, box: [BLIND.x - 0.16, BLIND.y - 0.16, BLIND.x + 0.16, BLIND.y + 0.16] });
    var veins = new Ink(), arteries = new Ink();
    var o = { step: 0.008, wiggle: 0.06, taper: 0.82, spread: 0.55, lenK: 0.7, wK: 0.74, depth: 5, side: 0.03, sideK: 0.45, joint: true,
      inside: function (x, y) { var r2 = x * x + y * y; return r2 > 0.02 && r2 < 3; } };   // they keep out of the very middle
    [[-0.42, 0.022, 0.015, veins], [-0.56, 0.024, 0.011, arteries], [0.42, -0.022, 0.015, veins], [0.56, -0.024, 0.011, arteries],
      [Math.PI + 0.5, 0, 0.012, veins], [Math.PI - 0.5, 0, 0.011, arteries], [Math.PI + 0.1, 0, 0.009, arteries], [Math.PI - 0.15, 0, 0.009, veins]].forEach(function (v) {
      o.curl = v[1] * o.step / 0.02;   // the curl is per step: keep the same turning per unit of length
      grow(v[3], o, rnd, BLIND.x + Math.cos(v[0]) * 0.03, BLIND.y + Math.sin(v[0]) * 0.03, v[0], 0.62, v[2], 0);
    });
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
      L = layer(h, h * 0.002, h * 0.25);
      L.items.push({ path: fl.path, fill: 'rgba(70,30,28,.22)', box: fl.box });
      list.push(L);
    });

    list.sort(function (a, b) { return a.h - b.h; });   // farthest (lowest) first
    return list;
  }

  function fallCam(pp) {
    var c = FC, u = clamp((pp - P_PUPIL) / (P_CUT - P_PUPIL), 0, 1);
    c.c = ROOF_H + Math.exp(lerp(Math.log(FALL_TOP - ROOF_H), Math.log(0.0015), u));   // a steady zoom towards the roof
    c.x = ptr.x * 0.07 * (c.c - ROOF_H);   // in step with our height above the roof, so the layers below slide against it
    c.y = ptr.y * 0.05 * (c.c - ROOF_H);
    c.roll = reduce ? 0 : 0.6 * u;   // a slow spin, like a falling leaf
    return c;
  }

  function drawFall(cam) {
    rollC = Math.cos(cam.roll); rollS = Math.sin(cam.roll);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0A0C14';
    ctx.fillRect(0, 0, W, H);
    var e = smooth(P_GLOW - 0.005, P_GLOW + 0.04, p), T = PT, i, L, d, s, a;
    if (e > 0) {
      for (i = 0; i < fall.length; i++) {
        L = fall[i]; d = cam.c - L.h;
        if (d < 0.0012) continue;
        s = F / d;
        a = L.size ? smooth(0.6, 2.5, L.size * s) : 1;
        if (L.near) a *= smooth(L.near * 0.15, L.near, d);   // things above the roof fade before they reach us
        if (a < 0.01) continue;
        T.s = s; T.tx = C.x - cam.x * s; T.ty = C.y - cam.y * s;
        setT(T.s, T.tx, T.ty);
        drawItems(L.items, T, a);
      }
      // the light falls off towards the edges, as when you look through an ophthalmoscope
      var f = clamp((p - P_GLOW) / (P_CUT - P_GLOW), 0, 1);
      var v = ctx.createRadialGradient(C.x, C.y, halfDiag * lerp(0.1, 0.65, f), C.x, C.y, halfDiag * lerp(0.75, 1.6, f));
      v.addColorStop(0, 'rgba(10,12,20,0)'); v.addColorStop(1, 'rgba(10,12,20,.9)');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    // dark until the light comes up, and dark again as we sink into the roof
    var dark = Math.max(1 - e, smooth(0.006, 0.0018, cam.c - ROOF_H));
    if (dark > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = alpha(p < P_GLOW + 0.05 ? DARK : '#160A0E', dark.toFixed(3));
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- the forest: the retina, edge on ----------
  // The retina is a slab of layers, upside down: the light comes in through the top. The roof is the ganglion
  // cells, under it the lacy canopy of the amacrine cells, then the bipolar cells as upper trunks, the horizontal
  // cells as lower branches, and the trunks are the rods (slim columns) and cones (fat, like bottle palms),
  // standing on the yellow floor. The glia are the odd trees out: Müller cells, hanging from the roof, with lifted
  // roots like a mangrove's that stop short of the floor. Each plane is one slice of the slab at some depth;
  // heights (Y) are world units divided by the slice's depth (k = 1 / D), which makes floor and roof meet in the distance.
  function haze(D) { return 0.95 * (1 - Math.exp(-Math.max(0, D - 1.5) / 3.2)); }

  // Rod or cone. Returns its foot, where the bipolar and horizontal cells reach it.
  function rodOrCone(g, rnd, x, k, cone) {
    var fl = FLOOR * k, os = (cone ? 0.1 : 0.17) * k, is = (cone ? 0.18 : 0.1) * k, w = (cone ? 0.011 : 0.0065) * k;
    var osTop = fl - os, isTop = osTop - is, sw = (rnd() - 0.5) * 0.02 * k;
    // the outer segment: rods a straight column, cones a cone pointing down into the floor
    g.seg.taper(cone ? [[x, fl, w * 0.25], [x, osTop, w * 0.85]] : [[x, fl, w * 0.95], [x, osTop, w * 0.95]]);
    if (g.discs) for (var yy = fl - 0.012 * k; yy > osTop; yy -= 0.012 * k) { g.discs.moveTo(x - w, yy); g.discs.lineTo(x + w, yy); }
    // the inner segment: cones swell like a bottle palm
    var ink = cone || !g.rod ? g.pr : g.rod;   // rods in a lighter ink, so the cones stand out
    ink.taper(cone ? [[x, osTop, w * 0.9], [x, osTop - is * 0.4, w * 1.9], [x, isTop, w * 1.05]] : [[x, osTop, w], [x, isTop, w * 0.9]]);
    // the fibre up through the outer nuclear layer, with the nucleus somewhere along it, then the foot
    var ny = (cone ? OLM - 0.04 : lerp(0.33, OLM - 0.03, rnd())) * k, ft = (0.27 + (rnd() - 0.5) * 0.02) * k, fw = w * (cone ? 0.55 : 0.32);
    ink.taper([[x, isTop, fw * 1.4], [x + sw * 0.3, ny, fw], [x + sw, ft, fw * 0.9]]);
    ink.dot(x + sw * 0.3, ny, w * (cone ? 1.1 : 0.9));
    if (cone) ink.tri(x + sw, ft + w * 0.15, w * 0.7); else ink.dot(x + sw, ft, w * 0.4);
    return { x: x + sw, y: ft };
  }

  // A bipolar cell: an upper trunk from the feet of a few rods and cones up into the canopy.
  function bipolarCell(g, rnd, x, k, feet) {
    var sy = (-0.24 + rnd() * 0.28) * k, top = (-0.5 - rnd() * 0.16) * k, wob = (rnd() - 0.5) * 0.04 * k, i;
    for (i = 0; i < feet.length; i++) {
      var f = feet[i];
      g.ink.taper([[x, sy, 0.003 * k], [lerp(x, f.x, 0.55), lerp(sy, f.y, 0.75), 0.002 * k], [f.x, f.y, 0.0012 * k]]);
    }
    g.ink.taper([[x, sy, 0.0045 * k], [x + wob * 0.5, (sy + top) / 2, 0.0035 * k], [x + wob, top, 0.0026 * k]]);
    grow(g.ink, { step: 0.012 * k, wiggle: 0.6, taper: 0.3, spread: 0.9, lenK: 0.55, wK: 0.6, depth: 2 }, rnd, x + wob, top, -Math.PI / 2, 0.035 * k, 0.002 * k, 0);
    g.lamp.blob(x, sy, 0.018 * k, -Math.PI / 2, 0.6);
  }

  // A horizontal cell: long lower branches, drooping a little, with tufts down to the feet below.
  function horizontalCell(g, rnd, x, k, lod) {
    var y = (0.13 + rnd() * 0.03) * k, s, j;
    var o = { step: 0.02 * k, wiggle: 0.24, taper: 0.5, spread: 0.6, lenK: 0.55, wK: 0.65, depth: 1 + lod, pullK: 0.07 };
    for (s = -1; s <= 1; s += 2) { o.pull = s > 0 ? 0.3 : Math.PI - 0.3; grow(g.ink, o, rnd, x, y, s > 0 ? -0.15 : Math.PI + 0.15, (0.11 + rnd() * 0.1) * k, 0.005 * k, 0); }
    var drop = { step: 0.012 * k, wiggle: 0.4, taper: 0.3, spread: 0.7, lenK: 0.5, wK: 0.6, depth: 1, pull: Math.PI / 2, pullK: 0.1 };
    for (j = 0; j < 2 + lod; j++) grow(g.ink, drop, rnd, x + (rnd() - 0.5) * 0.3 * k, y + 0.01 * k, Math.PI / 2, 0.09 * k, 0.0025 * k, 0);
    g.gang.blob(x, y, 0.016 * k, 0, 0.3);
  }

  // An amacrine cell: its branches rise into the canopy and spread flat, a lacy layer.
  function amacrineCell(g, rnd, x, k, lod) {
    var y = (-0.38 - rnd() * 0.04) * k, j;
    var o = { step: 0.018 * k, wiggle: 0.35, taper: 0.5, spread: 0.7, lenK: 0.6, wK: 0.66, depth: 2 + lod, pullK: 0.1, spine: lod > 1 ? 0.2 : 0, spineLen: 0.008 * k };
    for (j = 0; j < 2 + lod; j++) {
      var side = j % 2 ? 1 : -1;
      o.pull = side > 0 ? -0.15 : Math.PI + 0.15;
      grow(g.ink, o, rnd, x, y, -Math.PI / 2 + side * (0.4 + rnd() * 0.6), (0.14 + rnd() * 0.16) * k, 0.004 * k, 0);
    }
    g.gang.blob(x, y, 0.017 * k, -Math.PI / 2, 0.5);
  }

  // A ganglion cell: a big body in the roof, dendrites down into the canopy, an axon up and away along the top.
  function ganglionCell(g, rnd, x, k, lod) {
    var y = (-0.78 + (rnd() - 0.5) * 0.05) * k, dir = rnd() < 0.5 ? -1 : 1, j;
    var o = { step: 0.02 * k, wiggle: 0.32, taper: 0.45, spread: 0.75, lenK: 0.6, wK: 0.65, depth: lod, pull: Math.PI / 2, pullK: 0.04 };
    for (j = 0; j < 1 + lod; j++) grow(g.ink, o, rnd, x, y, Math.PI / 2 + (rnd() - 0.5) * 1.4, (0.1 + rnd() * 0.12) * k, 0.0055 * k, 0);
    var ay = (ILM - 0.02 - rnd() * 0.06) * k;
    g.ink.taper([[x, y, 0.005 * k], [x + dir * 0.015 * k, ay + 0.03 * k, 0.004 * k], [x + dir * 0.06 * k, ay, 0.003 * k], [x + dir * 0.14 * k, ay - 0.015 * k, 0]]);
    g.gang.blob(x, y, (0.022 + rnd() * 0.012) * k, -Math.PI / 2, 0.7);
  }

  // The roof seen from inside: the ganglion cells' bodies packed along it like clumps of leaves, three rows deep,
  // darker and lower towards us, with gaps where the light comes through.
  function roof(g, rnd, X, k) {
    [[g.roofC, -0.9, 0.034, 0.1], [g.roofB, -0.85, 0.027, 0.15], [g.roofA, -0.8, 0.021, 0.24]].forEach(function (row) {
      var x = -X - rnd() * 0.05 * k;
      while (x < X) {
        if (rnd() < row[3]) { x += (0.06 + rnd() * 0.14) * k; continue; }
        var r = row[2] * (0.6 + rnd() * 0.8) * k, y = (row[1] + (rnd() - 0.5) * 0.06 + 0.03 * Math.sin(x / k * 2.1 + row[1] * 9)) * k;
        row[0].blob(x, y, r, -Math.PI / 2 + (rnd() - 0.5) * 0.8, 0.2 + rnd() * 0.5);
        // now and then a cluster hangs lower, a few smaller cells strung below
        if (rnd() < 0.16) for (var j = 1, hx = x, hy = y; j <= 1 + Math.floor(rnd() * 3); j++) {
          hx += (rnd() - 0.5) * r; hy += r * (1.2 + rnd() * 0.5);
          row[0].blob(hx, hy, r * (0.75 - j * 0.12), -Math.PI / 2, 0.3);
        }
        x += r * (1.1 + rnd() * 0.9);
      }
    });
  }

  // A Müller cell: the mangrove. End feet splayed against the roof, a feathery trunk hanging down through the
  // layers, then lifted roots arching out and down, stopping at the outer limiting membrane, short of the floor.
  function mullerCell(g, rnd, x, k, lod) {
    var top = ILM * k, soma = (-0.12 + (rnd() - 0.5) * 0.06) * k, split = (0.2 + rnd() * 0.1) * k, lean = (rnd() - 0.5) * 0.06 * k, i, s;
    for (i = 0; i < 3 + lod; i++) {
      var fx = x + (i / (2 + lod) - 0.5) * 0.1 * k;
      g.glia.taper([[x, top + 0.07 * k, 0.005 * k], [lerp(x, fx, 0.7), top + 0.02 * k, 0.004 * k], [fx, top, 0.007 * k]]);
    }
    var pts = [], n = 20;
    for (i = 0; i <= n; i++) {
      var y = lerp(top + 0.06 * k, split, i / n), tx = x + lean * i / n + Math.sin(i * 0.9) * 0.004 * k;
      pts.push([tx, y, (0.0065 + 0.0018 * Math.sin(i)) * k]);
      if (lod && i % 2 && i < n) {
        var sd = i % 4 === 1 ? 1 : -1;
        g.glia.taper([[tx, y, 0.0025 * k], [tx + sd * 0.025 * k, y + 0.012 * k, 0]]);
      }
    }
    g.glia.taper(pts);
    g.glia.blob(x + lean * 0.55, soma, 0.016 * k, -Math.PI / 2, 0.8);
    var nr = 3 + Math.floor(rnd() * 3), bx = x + lean;
    for (i = 0; i < nr; i++) {
      var ex = bx + (i / (nr - 1) - 0.5) * (0.22 + rnd() * 0.1) * k, cp = [];
      for (s = 0; s <= 12; s++) {
        var t = s / 12;
        cp.push([lerp(bx, ex, Math.pow(t, 0.6)), lerp(split, OLM * k, t), 0.005 * k * (1 - 0.5 * t)]);
      }
      g.glia.taper(cp);
      g.glia.dot(ex, OLM * k, 0.006 * k);
    }
  }

  function slice(D, rnd, view) {
    var k = 1 / D, hz = haze(D), X = (view + 0.42) * (D - CAM_Z0) / D, lod = D < 3 ? 2 : D < 8 ? 1 : 0, x, i;
    var g = { pr: new Ink(), rod: new Ink(), seg: new Ink(), glia: new Ink(), ink: new Ink(), lamp: new Ink(), gang: new Ink(), roofA: new Ink(), roofB: new Ink(), roofC: new Ink(), discs: lod > 1 ? new Path2D() : null };
    // keep an avenue open along the river, wide for the big cells, narrow for the rods and cones on its banks
    var rx = riverX(D) * k;
    function open(x, wide) { return Math.abs(x - rx) < (wide ? 0.34 : 0.1) * k * (0.8 + rnd() * 0.4); }
    var qpx = H * clamp(D / Math.max(0.5, D - CAM_Z1), 1, 1.3) * Math.min(dpr, 1.25);
    minInk = 0.7 / qpx;
    wob = rng(Math.round(D * 1000)); wobble = 0.35;
    var thin = lod > 1 ? 1.5 : 1;   // the foreground holds a few bold things, not a thicket

    // rods and cones along the floor
    var feet = [], step = Math.max(0.016, (lod > 1 ? 0.075 : 0.055) * k);
    for (x = -X; x < X; x += step * (0.7 + rnd() * 0.6) * (rnd() < 0.12 ? 3 + rnd() * 3 : 1)) if (!open(x, false)) feet.push(rodOrCone(g, rnd, x, k, rnd() < 0.2));
    // the lower branches, the upper trunks reaching down to the feet nearest them, the canopy, the roof
    for (x = -X + rnd() * 0.4 * k; x < X; x += Math.max(0.14, 0.6 * k * thin) * (0.7 + rnd() * 0.6)) if (!open(x, true)) horizontalCell(g, rnd, x, k, lod);
    for (x = -X + rnd() * 0.1 * k; x < X; x += Math.max(0.07, 0.24 * k * thin) * (0.7 + rnd() * 0.6)) {
      if (open(x, true)) continue;
      var near = feet.filter(function (f) { return Math.abs(f.x - x) < 0.06 * k; }).slice(0, 4);
      bipolarCell(g, rnd, x, k, near);
    }
    for (x = -X + rnd() * 0.3 * k; x < X; x += Math.max(0.1, 0.4 * k * thin) * (0.7 + rnd() * 0.6)) if (!open(x, true)) amacrineCell(g, rnd, x, k, lod);
    for (x = -X + rnd() * 0.3 * k; x < X; x += Math.max(0.12, 0.5 * k * thin) * (0.7 + rnd() * 0.6)) if (!open(x, true)) ganglionCell(g, rnd, x, k, lod);
    roof(g, rnd, X, k);
    // the glia, our mangroves
    for (x = -X + rnd() * 0.5 * k; x < X; x += Math.max(0.22, 1.2 * k * thin) * (0.7 + rnd() * 0.6)) if (!open(x, true)) mullerCell(g, rnd, x, k, lod);
    minInk = 0; wobble = 0;

    // paint it
    var box = [-X, (ILM - 0.24) * k, X, (FLOOR + 0.01) * k];
    var cv = document.createElement('canvas');
    cv.width = Math.min(4096, Math.ceil((box[2] - box[0]) * qpx)); cv.height = Math.min(4096, Math.ceil((box[3] - box[1]) * qpx));
    qpx = Math.min(cv.width / (box[2] - box[0]), cv.height / (box[3] - box[1]));
    var soft = 0.012 * k, col = function (c) { return mix(c, HAZE, hz); }, edge = function (c) { return mix(mix(c, '#14080B', 0.45), HAZE, hz * 0.8); };
    [[g.roofC, '#A56A7C', 0.2], [g.seg, '#C48A3A', 0.3], [g.rod, '#A0703E', 0.35], [g.pr, '#6B3A24', 0.3], [g.glia, '#7E86A8', 0.35], [g.ink, '#3E1C24', 0.45],
      [g.roofB, '#83405A', 0.2], [g.gang, '#7A2E4A', 0.25], [g.roofA, '#64263E', 0.2], [g.lamp, '#C9587C', 0.2]].forEach(function (w) {
      var roofy = w[0] === g.roofA || w[0] === g.roofB || w[0] === g.roofC, c = roofy ? mix(w[1], HAZE, Math.min(1, hz * 1.25)) : col(w[1]);
      if (isFinite(w[0].box[0])) wash(cv, w[0].path, c, roofy ? mix(edge(w[1]), HAZE, hz * 0.4) : edge(w[1]), qpx, box, soft, w[2]);
      if (w[0] === g.seg && g.discs) {
        var o = cv.getContext('2d');
        o.setTransform(qpx, 0, 0, qpx, -box[0] * qpx, -box[1] * qpx);
        o.strokeStyle = alpha('#5C3214', 0.4); o.lineWidth = 0.0016 * k; o.stroke(g.discs);
        o.setTransform(1, 0, 0, 1, 0, 0);
      }
    });
    paper(cv, 0.6);
    // far off, the air softens everything
    if (D > 6) {
      var bl = blank(1, cv.width, cv.height), b = bl.getContext('2d');
      b.filter = 'blur(' + (0.6 + D * 0.06).toFixed(1) + 'px)'; b.drawImage(cv, 0, 0); b.filter = 'none';
      var o2 = cv.getContext('2d'); o2.clearRect(0, 0, cv.width, cv.height); o2.drawImage(bl, 0, 0);
    }
    return { D: D, items: [settle({ img: cv, box: box })] };
  }

  // Hand a freshly painted bitmap to the browser to get ready for drawing, in the background, so that the first
  // frame that needs it does not stall while it is uploaded.
  function settle(item) {
    if (window.createImageBitmap) createImageBitmap(item.img).then(function (bm) { item.img = bm; }, function () {});
    return item;
  }

  // A rod or cone of the grove we end up in, close enough at the end to be as wide as a tree: painted once as a
  // tall, narrow cel, at about the size it will be when we get there.
  function paintTrunk(t) {
    var g = { pr: new Ink(), seg: new Ink(), discs: new Path2D() }, rnd = rng(Math.round(t.D * 9973 + t.x * 1013 + 7));
    var qpx = Math.min(F / Math.max(0.12, t.D - CAM_Z1) * Math.min(dpr, 1.5), 2400 / 0.7);
    wob = rnd; wobble = 0.25; minInk = 0.7 / qpx;
    rodOrCone(g, rnd, 0, 1, t.cone);
    wobble = 0; minInk = 0;
    var box = [-0.032, 0.235, 0.032, FLOOR + 0.004], cv = document.createElement('canvas');
    cv.width = Math.ceil((box[2] - box[0]) * qpx); cv.height = Math.ceil((box[3] - box[1]) * qpx);
    wash(cv, g.seg.path, '#C48A3A', mix('#C48A3A', '#14080B', 0.45), qpx, box, 0.0016, 0.25);
    var o = cv.getContext('2d');
    o.setTransform(qpx, 0, 0, qpx, -box[0] * qpx, -box[1] * qpx);
    o.strokeStyle = alpha('#5C3214', 0.42); o.lineWidth = 0.0016; o.stroke(g.discs);
    o.setTransform(1, 0, 0, 1, 0, 0);
    wash(cv, g.pr.path, '#6B3A24', mix('#6B3A24', '#14080B', 0.45), qpx, box, 0.0016, 0.25);
    paper(cv, 0.6);
    t.cel = settle({ img: cv, box: box });
  }

  // Until its cel is painted, a trunk is drawn live.
  function drawTrunk(t, cam, now) {
    if (t.cel) {
      var at = proj(t.x, 0, t.D, cam), T = PT;
      if (at.den < 0.05) return;
      T.s = at.s; T.tx = at.x; T.ty = at.y;
      setT(T.s, T.tx, T.ty);
      drawItems([t.cel], T, 1);
      return;
    }
    var pr = proj(t.x, FLOOR, t.D, cam), s = pr.s;
    if (pr.den < 0.05) return;
    var w = (t.cone ? 0.011 : 0.0065) * s, x = pr.x, fl = pr.y, os = (t.cone ? 0.1 : 0.17) * s, is = (t.cone ? 0.18 : 0.1) * s;
    if (x + w * 3 < 0 || x - w * 3 > W) return;
    var osTop = fl - os, isTop = osTop - is, foot = fl - (FLOOR - 0.27) * s, nuc = fl - (FLOOR - (t.cone ? OLM - 0.04 : t.nuc)) * s;
    var hz = haze(t.D), ink = mix('#6B3A24', HAZE, hz), lit = mix('#B98048', HAZE, hz), dk = mix('#33160F', HAZE, hz);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var body = new Path2D(), seg = new Path2D();
    taper(seg, t.cone ? [[x, fl, w * 0.25], [x, osTop, w * 0.85]] : [[x, fl, w * 0.95], [x, osTop, w * 0.95]]);
    // up from the inner segment as a fibre, with its nucleus, to the foot where the next cells meet it
    taper(body, t.cone ? [[x, osTop, w * 0.9], [x, osTop - is * 0.4, w * 1.9], [x, isTop, w * 1.05], [x, isTop - 0.03 * s, w * 0.6], [x, foot, w * 0.32]]
      : [[x, osTop, w], [x, isTop, w * 0.9], [x, isTop - 0.03 * s, w * 0.36], [x, foot, w * 0.16]]);
    body.moveTo(x + w * 1.1, nuc); body.ellipse(x, nuc, w * (t.cone ? 1.15 : 0.8), w * 1.6, 0, 0, TAU, true);
    // round, lit from above and the left: a wash that is lighter on one side
    var gr = ctx.createLinearGradient(x - w * 2, 0, x + w * 2, 0);
    gr.addColorStop(0, dk); gr.addColorStop(0.38, lit); gr.addColorStop(0.62, ink); gr.addColorStop(1, dk);
    ctx.fillStyle = gr; ctx.fill(body);
    var sg = ctx.createLinearGradient(x - w, 0, x + w, 0);
    sg.addColorStop(0, '#8A5A22'); sg.addColorStop(0.4, '#E3B25A'); sg.addColorStop(1, '#7A4A1A');
    ctx.fillStyle = sg; ctx.fill(seg);
    // the discs stacked in the outer segment
    ctx.strokeStyle = 'rgba(92,50,20,.45)'; ctx.lineWidth = Math.max(1, 0.0016 * s);
    ctx.beginPath();
    for (var yy = fl - 0.012 * s; yy > osTop; yy -= 0.012 * s) { ctx.moveTo(x - w, yy); ctx.lineTo(x + w, yy); }
    ctx.stroke();
    // pigment and paper over the whole trunk
    ctx.globalAlpha = 0.35; ctx.fillStyle = pattern(ctx, TEX.mottle, Math.max(0.5, s * 0.004)); ctx.fill(body); ctx.fill(seg);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = dk; ctx.lineWidth = 1.2; ctx.stroke(body);
    ctx.globalAlpha = 1;
  }

  // ---------- the forest's living things: light, blood, and a boat ----------
  // where a point of the forest lands on screen (with the flattening, like the slices)
  var PR = { x: 0, y: 0, s: 1, den: 1 };
  function proj(x, Y, D, cam) {
    var De = lerp(D, FLAT_D, flatT), den = Math.max(0.02, De - cam.z), k = De / den;
    PR.x = C.x + x / D * H * k - cam.x * F / den;
    PR.y = C.y + Y / D * H * k - cam.y * F / den;
    PR.s = F / D * k;
    PR.den = den;
    return PR;
  }

  // the river: a capillary running along the floor, plasma with dark red blood cells drifting in it
  function makeRiver(ctrl) {
    var pts = [], n = ctrl.length, i, k;
    for (i = 0; i < n - 1; i++) {
      var a = ctrl[Math.max(0, i - 1)], b = ctrl[i], c = ctrl[i + 1], d = ctrl[Math.min(n - 1, i + 2)];
      for (k = 0; k < 14; k++) { var t = k / 14; pts.push([cm(a[0], b[0], c[0], d[0], t), cm(a[1], b[1], c[1], d[1], t)]); }
    }
    pts.push(ctrl[n - 1].slice());
    return pts;
  }
  // where the river is across, at a depth
  function riverX(D) {
    var R = forest.river;
    for (var i = 0; i < R.length - 1; i++) if (D <= R[i + 1][1]) return lerp(R[i][0], R[i + 1][0], clamp((D - R[i][1]) / (R[i + 1][1] - R[i][1]), 0, 1));
    return R[R.length - 1][0];
  }
  function riverAt(river, t) {
    var f = clamp(t, 0, 1) * (river.length - 1), i = Math.min(river.length - 2, Math.floor(f)), u = f - i;
    return [lerp(river[i][0], river[i + 1][0], u), lerp(river[i][1], river[i + 1][1], u)];
  }

  function drawRiverRun(r, cam, now) {
    var R = forest.river, wid = 0.075, i, a, sc = [], left = [], right = [];
    for (i = r.a; i <= r.b; i++) {
      a = proj(R[i][0], FLOOR - 0.002, R[i][1], cam);
      sc.push([a.x, a.y, a.s]);
    }
    for (i = 0; i < sc.length; i++) { left.push(sc[i][0] - wid * sc[i][2], sc[i][1]); right.push(sc[i][0] + wid * sc[i][2], sc[i][1]); }
    var path = new Path2D(), bank = new Path2D();
    path.moveTo(left[0], left[1]);
    for (i = 2; i < left.length; i += 2) path.lineTo(left[i], left[i + 1]);
    for (i = right.length - 2; i >= 0; i -= 2) path.lineTo(right[i], right[i + 1]);
    path.closePath();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(214,92,84,.92)'; ctx.fill(path);
    ctx.globalAlpha = 0.3; ctx.fillStyle = pattern(ctx, TEX.mottle, 0.8); ctx.fill(path); ctx.globalAlpha = 1;
    // darker along the banks, a sheen of light down the middle
    for (i = 0; i < left.length; i += 2) { if (i) bank.lineTo(left[i], left[i + 1]); else bank.moveTo(left[i], left[i + 1]); }
    bank.moveTo(right[0], right[1]);
    for (i = 2; i < right.length; i += 2) bank.lineTo(right[i], right[i + 1]);
    ctx.strokeStyle = 'rgba(110,20,28,.6)'; ctx.lineWidth = 1.5; ctx.stroke(bank);
    // blood cells drifting with the flow
    for (var j = 0; j < forest.cells.length; j++) {
      var bc = forest.cells[j], t = (bc.t + now * 0.000012 * bc.v) % 1, fi = t * (R.length - 1);
      if (fi < r.a0 || fi >= r.b) continue;
      var at = riverAt(R, t), q2 = proj(at[0] + bc.off * wid, FLOOR - 0.003, at[1], cam), rr = 0.022 * q2.s, squash = clamp((FLOOR - cam.y) / q2.den, 0.15, 1);
      ctx.fillStyle = '#7A0E1A';
      ctx.beginPath(); ctx.ellipse(q2.x, q2.y, rr, rr * squash, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(160,36,46,.8)';
      ctx.beginPath(); ctx.ellipse(q2.x, q2.y, rr * 0.45, rr * 0.45 * squash, 0, 0, TAU); ctx.fill();
    }
  }

  // a slanting shaft of light, from the roof down to a pool on the floor
  function drawRay(ray, cam, now) {
    var tp = proj(ray.x, ILM, ray.D, cam), tx = tp.x, ty = tp.y, s = tp.s;
    var bt = proj(ray.x + (FLOOR - ILM) * ray.slant, FLOOR, ray.D, cam), w = ray.w * s;
    if (Math.max(tx, bt.x) + w < 0 || Math.min(tx, bt.x) - w > W) return;
    ctx.globalCompositeOperation = 'screen';
    // the pool where it lands
    var squash = clamp((FLOOR - cam.y) / bt.den, 0.12, 1), pr = w * 1.6, pg = ctx.createRadialGradient(bt.x, bt.y, 0, bt.x, bt.y, pr);
    pg.addColorStop(0, 'rgba(255,238,190,.5)'); pg.addColorStop(1, 'rgba(255,238,190,0)');
    ctx.setTransform(dpr, 0, 0, dpr * squash, 0, bt.y * dpr * (1 - squash));
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(bt.x, bt.y, pr, 0, TAU); ctx.fill();
    // the shaft: the soft sprite, skewed from the roof down to the pool
    ctx.setTransform(w * dpr, 0, (bt.x - tx) * dpr, (bt.y - ty) * dpr, (tx - w / 2) * dpr, ty * dpr);
    ctx.globalAlpha = ray.a;
    ctx.drawImage(TEX.ray, 0, 0, 1, 1);
    // motes drifting slowly down through the light
    if (s > 60 && !reduce) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#FFF6DC';
      for (var i = 0; i < 14; i++) {
        var v = ((ray.x * 7.3 + i * 0.137 + now * 0.000012 * (1 + i % 3)) % 1 + 1) % 1, u = 0.5 + 0.32 * Math.sin(i * 2.1 + now * 0.0004);
        var mx = tx - w / 2 + u * w + (bt.x - tx) * v, my = ty + (bt.y - ty) * v, mr = (0.6 + (i % 4) * 0.35) * Math.min(3, s / 250);
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(i * 1.3 + now * 0.002);
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // the capillary of the deep plexus, a tube winding among the lower branches: plasma, and dark cells in it
  function drawTube(r, cam, now) {
    var tb = forest.tube, pts = tb.pts, i, sc = [], n = pts.length;
    for (i = r.a; i <= r.b; i++) { var a = proj(pts[i][0], pts[i][1], pts[i][2], cam); sc.push([a.x, a.y, tb.R * a.s * pts[i][3]]); }
    var outl = sc.map(function (c) { return [c[0], c[1], c[2] + Math.max(0.6, c[2] * 0.14)]; }), hi = [];
    for (i = 0; i < sc.length; i++) {
      var i0 = Math.max(0, i - 1), i1 = Math.min(sc.length - 1, i + 1), tx = sc[i1][0] - sc[i0][0], ty = sc[i1][1] - sc[i0][1], tl = Math.hypot(tx, ty) || 1;
      hi.push([sc[i][0] + ty / tl * sc[i][2] * 0.45, sc[i][1] - tx / tl * sc[i][2] * 0.45, sc[i][2] * 0.15]);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var path = new Path2D(); taper(path, outl); ctx.fillStyle = '#7A1622'; ctx.fill(path);
    path = new Path2D(); taper(path, sc); ctx.fillStyle = '#D9675C'; ctx.fill(path);
    for (var j = 0; j < tb.cells.length; j++) {
      var fi = ((tb.cells[j] + now * 0.00005) % 1) * (n - 1);
      if (fi < r.a0 || fi >= r.b) continue;
      var k = Math.floor(fi) - r.a, c = sc[clamp(k, 0, sc.length - 1)];
      ctx.fillStyle = '#7A0E1A';
      ctx.beginPath(); ctx.ellipse(c[0], c[1], c[2] * 0.75, c[2] * 0.55, 0, 0, TAU); ctx.fill();
    }
    path = new Path2D(); taper(path, hi); ctx.fillStyle = 'rgba(255,214,200,.55)'; ctx.fill(path);
  }

  // The boat: a red blood cell, round and dished, riding the river, and sitting in it our eye, small, looking around.
  // Crisp, like a cel-animated character over the painted ground.
  function drawBoat(cam, now) {
    var b = forest.boat, at = riverAt(forest.river, b.t), pr = proj(at[0], FLOOR - 0.004, at[1], cam);
    var R = 0.062 * pr.s, x = pr.x, y = pr.y + Math.sin(now * 0.0016) * R * 0.05, tilt = Math.sin(now * 0.0012) * 0.06;
    if (x + R * 2 < 0 || x - R * 2 > W || pr.den < 0.06) return;
    var c = Math.cos(tilt) * R * dpr, s = Math.sin(tilt) * R * dpr;
    // its shadow on the plasma, and ripples
    ctx.setTransform(R * dpr, 0, 0, R * dpr, x * dpr, (pr.y + R * 0.1) * dpr);
    ctx.fillStyle = 'rgba(90,10,20,.35)'; ctx.beginPath(); ctx.ellipse(0, 0.12, 1.3, 0.24, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,200,.5)'; ctx.lineWidth = 0.035;
    var rp = (now * 0.0006) % 1;
    ctx.globalAlpha = 1 - rp; ctx.beginPath(); ctx.ellipse(0, 0.06, 1.15 + rp * 0.5, 0.2 + rp * 0.09, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setTransform(c, s, -s, c, x * dpr, y * dpr);   // boat units: half its width is 1
    // the hull, and the dished middle of the cell, behind the eye
    ctx.fillStyle = '#6E0C18'; ctx.beginPath(); ctx.ellipse(0, 0, 1, 0.42, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#B83A48'; ctx.beginPath(); ctx.ellipse(0, 0, 1, 0.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5A0A14'; ctx.beginPath(); ctx.ellipse(0, 0.01, 0.74, 0.12, 0, 0, TAU); ctx.fill();
    // the eye: an eyeball with the rose iris, looking where the pointer is, blinking now and then
    var ey = -0.36, er = 0.44, lx = clamp(ptr.x, -1, 1) * 0.11, ly = clamp(ptr.y, -1, 1) * 0.06;
    var eb = ctx.createRadialGradient(-0.14, ey - 0.2, 0.05, 0, ey, er);
    eb.addColorStop(0, '#FFFBF2'); eb.addColorStop(1, '#E6D2C2');
    ctx.fillStyle = eb; ctx.beginPath(); ctx.arc(0, ey, er, 0, TAU); ctx.fill();
    var ig = ctx.createRadialGradient(lx - 0.05, ey - 0.05 + ly, 0, lx, ey + ly, 0.23);
    ig.addColorStop(0, '#F7D3DE'); ig.addColorStop(0.65, '#E7A1B6'); ig.addColorStop(1, '#8E2F55');
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(lx, ey + ly, 0.23, 0, TAU); ctx.fill();
    ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(lx, ey + ly, 0.095, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FFF8EC'; ctx.beginPath(); ctx.arc(lx - 0.07, ey - 0.08 + ly, 0.034, 0, TAU); ctx.fill();
    var bk = (now / 1000 + b.t * 7) % 5.2, shut = bk < 0.18 ? Math.sin(bk / 0.18 * Math.PI) : 0;
    if (shut > 0) {
      ctx.save(); ctx.beginPath(); ctx.arc(0, ey, er, 0, TAU); ctx.clip();
      ctx.fillStyle = '#EAD6C6'; ctx.fillRect(-er, ey - er, er * 2, er * 2 * shut);
      ctx.restore();
    }
    // the logo's lid and lashes, for a brow
    ctx.strokeStyle = '#3A1820'; ctx.lineCap = 'round'; ctx.lineWidth = 0.065;
    var lid = ey - er + er * 2 * shut * 0.9;
    ctx.beginPath(); ctx.moveTo(-0.46, ey - 0.12 + shut * 0.5); ctx.quadraticCurveTo(0, lid - 0.12 * (1 - shut), 0.46, ey - 0.12 + shut * 0.5); ctx.stroke();
    ctx.lineWidth = 0.05;
    // three lashes, from points along the right of the brow (relative to the eye's middle)
    [[0.14, -0.32, 0.2, -0.5], [0.28, -0.26, 0.4, -0.42], [0.39, -0.185, 0.55, -0.28]].forEach(function (l) {
      var dy = ey + shut * 0.45;
      ctx.beginPath(); ctx.moveTo(l[0], l[1] + dy); ctx.lineTo(l[2], l[3] + dy); ctx.stroke();
    });
    // the near rim of the cell, in front of the eye: it sits in the boat, not on it
    ctx.fillStyle = '#B83A48'; ctx.beginPath(); ctx.ellipse(0, 0, 1, 0.2, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,190,.5)'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.ellipse(0, 0, 0.98, 0.18, 0, 0.15, Math.PI - 0.15); ctx.stroke();
    // little arms over the rim, with an oar
    var row = Math.sin(now * 0.0024) * 0.25;
    ctx.strokeStyle = '#3A1820'; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(-0.36, -0.22); ctx.quadraticCurveTo(-0.52, -0.08, -0.3 + row * 0.3, 0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.36, -0.22); ctx.quadraticCurveTo(0.5, -0.08, 0.26 + row * 0.3, -0.02); ctx.stroke();
    ctx.strokeStyle = '#E7A1B6'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(-0.5 + row, -0.12); ctx.lineTo(0.72 + row * 0.6, 0.3); ctx.stroke();
    ctx.fillStyle = '#E7A1B6'; ctx.beginPath(); ctx.ellipse(0.8 + row * 0.6, 0.34, 0.16, 0.07, 0.4, 0, TAU); ctx.fill();
  }

  function buildForest() {
    var view = A / 2, rnd = rng(SEED + 1), i;
    var river = makeRiver([[0.55, 1.02], [0.05, 1.28], [-0.1, 1.7], [0.25, 2.4], [0.45, 3.4], [-0.1, 5], [-0.55, 7.5], [0.15, 11], [0.6, 16], [0.1, 26]]);
    var cells = [];
    for (i = 0; i < 70; i++) cells.push({ t: rnd(), v: 0.6 + rnd() * 0.8, off: (rnd() - 0.5) * 1.4 });
    var tubeCtrl = [[3.2, 0.2, 1.5], [1.0, 0.17, 2.3], [0.2, 0.15, 3.6], [-0.7, 0.16, 5.4], [-1.2, 0.18, 8], [-0.6, 0.17, 12], [0.2, 0.16, 18]], tpts = [];
    for (i = 0; i < tubeCtrl.length - 1; i++) {
      var a = tubeCtrl[Math.max(0, i - 1)], b = tubeCtrl[i], c = tubeCtrl[i + 1], d = tubeCtrl[Math.min(tubeCtrl.length - 1, i + 2)];
      for (var k = 0; k < 18; k++) { var t = k / 18; tpts.push([cm(a[0], b[0], c[0], d[0], t), cm(a[1], b[1], c[1], d[1], t), cm(a[2], b[2], c[2], d[2], t)]); }
    }
    tpts.push(tubeCtrl[tubeCtrl.length - 1].slice());
    tpts.forEach(function (pt, j) { pt[3] = 1 - 0.85 * smooth(0.8, 1, j / (tpts.length - 1)); });
    var tcells = [];
    for (i = 0; i < 9; i++) tcells.push((i + rnd() * 0.6) / 9);
    // the grove at the end: rods and cones close enough to be trees, either side of the river
    var grove = [[-0.12, 1.14, 0], [0.16, 1.17, 1], [-0.24, 1.26, 1], [0.27, 1.3, 0], [-0.17, 1.47, 0], [0.36, 1.48, 1], [-0.36, 1.55, 0], [0.12, 1.62, 1], [-0.18, 1.66, 0], [0.24, 1.2, 0]]
      .map(function (g) { return { x: g[0] * Math.max(1, view / 0.75), D: g[1], cone: !!g[2], nuc: lerp(0.34, OLM - 0.04, rnd()) }; });
    var rays = [];
    [[13, 1], [7.5, 2], [4.4, 1], [2.7, 1], [1.9, 1]].forEach(function (r) {
      for (i = 0; i < r[1]; i++) rays.push({ D: r[0] * (0.82 + rnd() * 0.12), x: lerp(-view, view, rnd()) * r[0] * 0.9, w: (0.22 + rnd() * 0.3) * Math.sqrt(r[0] / 3), slant: 0.32, a: 0.5 + rnd() * 0.25 });
    });
    forest = { planes: [], todo: SLICES.slice(), trunks: grove.slice(), rnd: rnd, view: view, river: river, cells: cells, tube: { pts: tpts, R: 0.02, cells: tcells }, grove: grove, rays: rays, boat: { t: 0.5 } };
    // split the river and the tube where they pass a slice, so the slices can cover them and they the slices
    forest.riverRuns = split(river.map(function (r) { return r[1]; }));
    forest.tubeRuns = split(tpts.map(function (r) { return r[2]; }));
  }
  function split(depths) {
    var runs = [], a = 0, n = depths.length, i;
    function iv(D) { var c = 0; for (var j = 0; j < SLICES.length; j++) if (SLICES[j] > D) c++; return c; }
    var cur = iv(depths[0]);
    for (i = 1; i < n; i++) {
      var j = iv(depths[i]);
      if (j !== cur || i === n - 1) {
        var sum = 0;
        for (var k = a; k <= i; k++) sum += depths[k];
        runs.push({ a0: a, a: Math.max(0, a - 1), b: i, D: sum / (i - a + 1) });
        a = i; cur = j;
      }
    }
    return runs;
  }
  // The veil: the roof all around us just after the cut, seen from right inside it: the same leafy mass of cell
  // bodies as the forest's roof, dense above, thinning into hanging clusters below, with dendrites dangling from
  // them. It slides up and away as we drop out of it. Painted in world units at a fixed depth.
  function paintVeil(rnd) {
    var dark = new Ink(), mid = new Ink(), lite = new Ink(), ink = new Ink(), glia = new Ink(), x, y, i, j;
    wob = rnd; wobble = 0.3; minInk = 0.0012;
    // the mass: rows of cells, packed tight up top, more gaps further down
    for (y = -1.46; y < -0.9; y += 0.028) {
      var gap = smooth(-1.2, -0.9, y) * 0.45;
      for (x = -0.72 - rnd() * 0.04; x < 0.72;) {
        var r = (0.022 + rnd() * 0.026) * (1 - 0.3 * smooth(-1.3, -0.9, y));
        if (rnd() > gap) (y < -1.25 ? dark : rnd() < 0.55 ? mid : lite).blob(x, y + (rnd() - 0.5) * 0.03, r, -Math.PI / 2 + (rnd() - 0.5), 0.15 + rnd() * 0.4);
        x += r * (1.2 + rnd() * 0.8);
      }
    }
    // clusters hanging below it, each a few cells on a stalk, with dendrites dangling
    var DEN = { step: 0.008, wiggle: 0.35, taper: 0.4, spread: 0.7, lenK: 0.6, wK: 0.65, depth: 2, pull: Math.PI / 2, pullK: 0.05 };
    for (x = -0.68; x < 0.68; x += 0.05 + rnd() * 0.09) {
      var hy = -0.92 + (rnd() - 0.5) * 0.04, n = 1 + Math.floor(rnd() * 3), hx = x;
      for (j = 0; j < n; j++) {
        hx += (rnd() - 0.5) * 0.02; hy += 0.03 + rnd() * 0.02;
        (rnd() < 0.5 ? mid : lite).blob(hx, hy, 0.018 + rnd() * 0.012, -Math.PI / 2 + (rnd() - 0.5) * 0.6, 0.3 + rnd() * 0.4);
      }
      if (rnd() < 0.7) grow(ink, DEN, rnd, hx, hy + 0.01, Math.PI / 2 + (rnd() - 0.5) * 0.8, 0.06 + rnd() * 0.08, 0.0035, 0);
    }
    // a few Müller cells' end feet, pale stems coming down out of it
    for (x = -0.6; x < 0.6; x += 0.22 + rnd() * 0.16) glia.taper([[x, -1.2, 0.0035], [x + (rnd() - 0.5) * 0.03, -0.8, 0.0028], [x + (rnd() - 0.5) * 0.04, -0.6, 0]]);
    wobble = 0; minInk = 0;
    var box = [-0.72, -1.5, 0.72, -0.5], qpx = Math.min(1600, H * 1.6) / (box[3] - box[1]), cv = document.createElement('canvas');
    cv.width = Math.ceil((box[2] - box[0]) * qpx); cv.height = Math.ceil((box[3] - box[1]) * qpx);
    [[glia, '#5E6488', 0.3], [lite, '#7E3C56', 0.2], [mid, '#5C2440', 0.2], [ink, '#2A1218', 0.35], [dark, '#3A1424', 0.15]].forEach(function (w) {
      wash(cv, w[0].path, w[1], mix(w[1], '#0A0406', 0.5), qpx, box, 0.006, w[2]);
    });
    paper(cv, 0.6);
    forest.veil = settle({ z: -0.22, img: cv, box: box });
  }

  // paint the slices one at a time, so the page stays smooth while they grow
  function paintNext() {
    if (!forest || (!forest.todo.length && forest.veil && !forest.trunks.length)) return false;
    var t0 = performance.now();
    if (!forest.veil) { paintVeil(forest.rnd); buildMs += performance.now() - t0; return true; }
    if (!forest.todo.length) { paintTrunk(forest.trunks.shift()); buildMs += performance.now() - t0; return true; }
    var D = forest.todo.shift();
    forest.planes.push(slice(D, forest.rnd, forest.view));
    forest.planes.sort(function (a, b) { return b.D - a.D; });
    buildMs += performance.now() - t0;
    return true;
  }
  function paintLater() { if (paintNext()) setTimeout(paintLater, 30); }

  // where things are in the forest: the slices, and everything that lives between them
  var queue = [];
  function drawForest(cam, now) {
    while (!forest.veil || forest.todo.length) paintNext();   // we got here before the slices were painted: finish them now
    rollC = 1; rollS = 0;
    if (SKIP.indexOf('planes') < 0) drawBackdrop(cam);
    var T = PT, i;
    queue.length = 0;
    forest.planes.forEach(function (pl) { queue.push({ D: pl.D, k: 0, pl: pl }); });
    forest.riverRuns.forEach(function (r) { queue.push({ D: r.D, k: 1, r: r }); });
    forest.tubeRuns.forEach(function (r) { queue.push({ D: r.D, k: 2, r: r }); });
    forest.rays.forEach(function (r) { queue.push({ D: r.D, k: 3, r: r }); });
    forest.grove.forEach(function (t) { queue.push({ D: t.D, k: 4, t: t }); });
    queue.push({ D: riverAt(forest.river, forest.boat.t)[1] - 0.001, k: 5 });
    queue.push({ D: -10, k: 6 });
    queue.sort(function (a, b) { return b.D - a.D; });
    var names = ['slices', 'river', 'river', 'rays', 'trunks', 'boat', 'veil'];
    for (i = 0; i < queue.length; i++) {
      var it = queue[i];
      if (SKIP.indexOf(names[it.k]) >= 0) continue;
      if (it.k === 0) {
        var De = lerp(it.D, FLAT_D, flatT), den = De - cam.z;
        if (den < 0.25) continue;
        T.s = H * De / den; T.tx = C.x - cam.x * F / den; T.ty = C.y - cam.y * F / den;
        setT(T.s, T.tx, T.ty);
        drawItems(it.pl.items, T, smooth(0.25, 0.55, den));   // slices we reach just before the end slip away
      } else if (it.k === 1) drawRiverRun(it.r, cam, now);
      else if (it.k === 2) drawTube(it.r, cam, now);
      else if (it.k === 3) drawRay(it.r, cam, now);
      else if (it.k === 4) drawTrunk(it.t, cam, now);
      else if (it.k === 5) drawBoat(cam, now);
      else {
        var v = forest.veil, vd = v.z - cam.z;
        if (vd > 0.05) {
          T.s = F / vd; T.tx = C.x - cam.x * T.s; T.ty = C.y - cam.y * T.s;
          setT(T.s, T.tx, T.ty);
          drawItems([v], T, smooth(0.05, 0.12, vd));
        }
      }
    }
  }

  // the light from above, and the roof and the floor as two planes running off into the distance (in strips)
  function drawBackdrop(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var hy = C.y - cam.y * F / 200, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#F7E2B0'); g.addColorStop(clamp(hy / H - 0.12, 0, 1), '#E2B678'); g.addColorStop(clamp(hy / H, 0, 1), '#E9BC74'); g.addColorStop(1, '#D9993E');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    plane(cam, ILM, '#EFD3A0', '#DDB57C', TEX.roof, 0.12, 0.14);   // only a hint of cells: the leafy roof in the slices carries it
    plane(cam, FLOOR, '#F2BF45', '#DDB57C', TEX.floor, 0.035, 0.42);
  }
  function plane(cam, Y, nearCol, far, tex, cell, texA) {
    var dy = Y - cam.y, n = 30, i, prev = null, near = Math.max(0.05, Math.abs(dy) * F / (H * 0.62));
    for (i = 0; i <= n; i++) {
      var D = cam.z + Math.exp(lerp(Math.log(80), Math.log(near), i / n));
      if (Math.abs(D) < 1e-3) D = 1e-3;
      var pr = proj(0, Y, D, cam), y = pr.y;
      if (prev !== null) {
        var y0 = Math.min(prev.y, y), y1 = i === n ? (dy > 0 ? H : 0) : Math.max(prev.y, y);
        if (dy < 0) { y0 = i === n ? 0 : Math.min(prev.y, y); y1 = Math.max(prev.y, y); }
        var Dm = (prev.D + D) / 2 || 1e-3, pm = proj(0, Y, Dm, cam), sx = pm.s * cell / 60, sq = clamp(Math.abs(dy) / pm.den, 0.04, 1);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = mix(nearCol, far, Math.min(1, haze(Dm) * 1.1));
        ctx.fillRect(0, y0, W, y1 - y0 + 1);
        ctx.globalAlpha = texA * (1 - haze(Dm));
        ctx.fillStyle = pattern(ctx, tex, sx, pm.x, pm.y);
        ctx.setTransform(dpr, 0, 0, dpr * sq, 0, pm.y * dpr * (1 - sq));
        ctx.fillRect(0, pm.y + (y0 - pm.y) / sq, W, (y1 - y0 + 1) / sq);
        // an uneven wash over it, fixed to the ground so it does not swim as we move
        ctx.globalAlpha = 0.3 * (1 - haze(Dm) * 0.7);
        ctx.fillStyle = pattern(ctx, TEX.mottle, sx * 9, pm.x, pm.y);
        ctx.fillRect(0, pm.y + (y0 - pm.y) / sq, W, (y1 - y0 + 1) / sq);
        ctx.globalAlpha = 1;
      }
      prev = { y: y, D: D };
    }
  }

  function forestCam(pp) {
    var c = SC, u, e;
    if (pp < P_REST) {
      // out of the roof and down into the forest
      e = easeInOut(clamp((pp - P_CUT) / (P_REST - P_CUT), 0, 1));
      c.y = lerp(-0.84, 0, e);
      c.z = lerp(CAM_Z0, 0, e);
      c.deep = 0;
    } else {
      // down among the rods and cones, to the river
      e = easeInOut((pp - P_REST) / (1 - P_REST));
      c.y = lerp(0, 0.8, e);
      c.z = lerp(0, CAM_Z1, e);
      c.deep = e;
    }
    var wf = smooth(P_CUT, P_CUT + 0.06, pp);
    c.x = ptr.x * 0.1 * (1 - 0.6 * c.deep) * wf;
    c.y += ptr.y * 0.035 * (1 - 0.6 * c.deep) * wf;
    forest.boat.t = lerp(0.55, 0.27, smooth(P_REST - 0.1, 1, pp));
    return c;
  }

  // ---------- render ----------
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rollC = 1; rollS = 0;
    if (p < P_PUPIL) { drawEye(eyeCam(p), now); return; }
    if (p < P_CUT) { drawFall(fallCam(p)); return; }
    drawForest(forestCam(p), now);
    // the far side of the cut: still dark in the roof, until we drop out of it
    var dark = 1 - smooth(P_CUT, P_CUT + 0.035, p);
    if (dark > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = alpha('#160A0E', dark.toFixed(3));
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- update: scroll, pointer, the eye's own life ----------
  var heroCopy = document.getElementById('hero-copy'), worldCopy = document.getElementById('world-copy'), paperEl = document.querySelector('.paper');
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
    var look = 1 - smooth(0.02, 0.08, p), ki = reduce || fixedPtr ? 1 : 1 - Math.exp(-dt * 7);   // diving in, it looks straight at us
    iris.x += (iris.tx * look - iris.x) * ki;
    iris.y += (iris.ty * look - iris.y) * ki;

    // a blink now and then, while we are still outside
    var ts = now / 1000;
    if (!reduce && fixedP == null && p < 0.02 && ts > blink.at) { blink.start = ts; blink.at = ts + 3.5 + Math.random() * 4; }
    var bt = (ts - blink.start) / 0.2;
    blink.v = bt >= 0 && bt <= 1 ? Math.sin(Math.PI * bt) : 0;

    fade(heroCopy, 1 - smooth(0.008, 0.045, p));
    fade(paperEl, smooth(P_PUPIL, P_GLOW + 0.03, p));
    fade(worldCopy, smooth(0.94, 0.99, p));
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
    // the forest takes a while to paint; the eye and the fall do not need it, so paint it slice by slice meanwhile
    buildForest();
    setTimeout(paintLater, 60);
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
    // and a sheet of watercolour paper: warm, faintly fibrous, multiplied over the painting
    var rnd = rng(SEED + 3), nz = noiseTile(256, 8, 3, rnd);
    var sheet = pixels(256, function (i) { var v = nz[i] * 22 + rnd() * 10; return [255 - v * 0.6, 252 - v * 0.8, 244 - v * 1.2, 255]; });
    paperEl.style.backgroundImage = 'url(' + sheet.toDataURL() + ')';
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
  var paused = false;
  function frame(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    frameMs = lerp(frameMs, last ? now - last : 16, 0.1);
    last = now;
    if (paused) { requestAnimationFrame(frame); return; }
    update(dt, now);
    var t0 = performance.now();
    render(now);
    renderMs = lerp(renderMs, performance.now() - t0, 0.1);
    if (hud && now - hudAt > 250) {
      hudAt = now;
      hud.textContent = 'fps ' + (1000 / frameMs).toFixed(0) + '  draw ' + renderMs.toFixed(1) + 'ms  build ' + buildMs.toFixed(0) + 'ms  slices ' + (forest ? forest.planes.length : 0) + '/' + SLICES.length + '\n' +
        'p ' + p.toFixed(3) + '  fall ' + FC.c.toFixed(4) + '  forest ' + SC.y.toFixed(2) + ',' + SC.z.toFixed(2) + '  flat ' + flatT.toFixed(2);
    }
    requestAnimationFrame(frame);
  }

  // for tuning: time a frame at a given scroll position (forces the canvas to finish drawing)
  window.__dive = {
    bench: function (pp, n) {
      var keep = p, t0, i;
      n = n || 20; p = pp; t0 = performance.now();
      for (i = 0; i < n; i++) render(t0 + i * 16);
      // wait for the drawing to finish by copying a pixel into a tiny canvas and reading that: reading the stage
      // itself back would make the browser take it off the GPU, and every frame after would be slow
      var one = this.one || (this.one = document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
      one.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
      one.getImageData(0, 0, 1, 1);
      var ms = (performance.now() - t0) / n;
      p = keep;
      return Math.round(ms * 100) / 100;
    },
    build: function () { return Math.round(buildMs); },
    // hold the camera at a point of the scroll (and, optionally, the pointer), as ?p= and ?px=&py= do
    seek: function (pp, px, py) {
      fixedP = clamp(pp, 0, 1); p = fixedP;
      if (px != null) { fixedPtr = { x: px, y: py || 0 }; ptr.x = ptr.tx = px; ptr.y = ptr.ty = py || 0; }
    },
    ready: function () { return !!forest && !forest.todo.length && !!forest.veil && !forest.trunks.length; },
    // for recording: stop the clock, then draw frames at chosen moments (scroll point, pointer, time in ms, flattening)
    pause: function () { paused = true; },
    frameAt: function (pp, px, py, t, flat) {
      fixedP = clamp(pp, 0, 1); p = fixedP; fixedPtr = { x: px || 0, y: py || 0 };
      if (flat != null) { flatTarget = flat; flatT = flat; }
      update(1 / 30, t);
      render(t);
    }
  };

  makeTextures();
  makeGrain();
  layout();
  requestAnimationFrame(frame);
})();
