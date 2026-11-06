// sehn.ai lab: a dive into the eye.
// Everything on screen is a flat plane at some depth, and only the camera moves,
// like Disney's multiplane camera: the depth you feel comes from parallax alone.
// The story: the eye; through the pupil into the dark of the vitreous; a fall straight down onto the
// retina, its layers seen from above, into the roof of the forest; a cut hidden in the dark of that roof;
// and we come out inside the retina, looking along it, among its cells. Then on, the way the picture goes: out
// through the blind spot, along the optic nerve, across the chiasm, up through the LGN, into the visual cortex.
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var q = new URLSearchParams(location.search);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // for screenshots and tuning: ?p=0.5 holds the camera there, ?px=&py= hold the pointer (-1..1), ?flat, ?debug, ?seed=
  var fixedP = q.has('p') ? clamp(parseFloat(q.get('p')) || 0, 0, 2) : null;
  var fixedPtr = q.has('px') || q.has('py') ? { x: parseFloat(q.get('px')) || 0, y: parseFloat(q.get('py')) || 0 } : null;
  var SEED = parseInt(q.get('seed'), 10) || 7;
  var SKIP = (q.get('skip') || '').split(',');   // ?skip=planes,slices,veil,rays,river,trunks: leave things out, to see what costs what
  var TAU = Math.PI * 2;

  // the scroll, start to end: rest; fly at the eye until the pupil fills the screen; a moment of dark; the retina
  // glows up far below and we fall into it; the cut, in the dark of the roof; down into the forest; deeper in
  var P_DIVE = 0.03, P_PUPIL = 0.14, P_GLOW = 0.16, P_CUT = 0.4, P_REST = 0.66;
  var Z_EYE = 1, FLAT_REF = 3;   // flattened, every plane sways with the pointer as one this far away would
  var FALL_TOP = 45, ROOF_H = 0.26;   // the fall: camera height above the floor of rods and cones, and the roof we fall into
  var BLIND = { x: -0.62, y: 0.05 };  // the blind spot, where the nerve fibres leave and the vessels come in
  // the retina edge on, in world units, down is positive: its inner surface, where the glia's roots stop, the floor
  var ILM = -0.9, OLM = 0.6, FLOOR = 0.9;
  var SLICES = [13, 7.5, 4.4, 2.7, 1.7, 1.25];   // the last one frames the view: trees at its edges, its middle open
  var CAM_Z0 = -0.6, CAM_Z1 = 1;      // the forest camera's depth just after the cut, and at the very end
  var HAZE = '#DDB57C', DARK = '#0E1726';
  // Past the river the dive goes on, p from 1 to 2 (u = p - 1): out of the retina through the blind spot, a tracking
  // shot along the optic nerve, the chiasm from above, up through the LGN and its radiation, and into the visual cortex,
  // where the page's second half lies over it: V1, V2, then V4, and at rest by a capillary. Cuts hide in the dark again,
  // and in the white of the myelin. The retina keeps its yellow; the cortex is grey, like Cajal's silver, with colour
  // only in the fibres (rose for this eye, teal for the other), in the blood, and in V4, where colour is seen.
  var U_DARK = 0.012, U_LAKE = 0.07, U_NERVE = 0.13, U_CHIASM = 0.19, U_RISE = 0.26, U_V1 = 0.31, U_V2 = 0.5, U_V4 = 0.72, U_REST = 0.9;
  var U_C0 = 0.53, U_C1 = 0.6;   // the pause in V2 where Plate III, Grossberg's circuit, is drawn
  var ROSE = '#B57A8E', TEAL = '#5E9090', CHAZE = '#D7D8D9', MYELIN = '#F4F1EA';

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

  // Chrome makes each step added to a Path2D slower the bigger the path already is, so an ink collects its
  // shapes in chunks of a few hundred and joins them into one path only when it is drawn.
  function Ink() { this.chunks = [new Path2D()]; this.n = 0; this.merged = null; this.box = [Infinity, Infinity, -Infinity, -Infinity]; }
  Ink.prototype.cur = function () {
    if (++this.n % 300 === 0) this.chunks.push(new Path2D());
    this.merged = null;
    return this.chunks[this.chunks.length - 1];
  };
  Object.defineProperty(Ink.prototype, 'path', { get: function () {
    if (this.chunks.length === 1) return this.chunks[0];
    if (!this.merged) { var m = new Path2D(); this.chunks.forEach(function (c) { m.addPath(c); }); this.merged = m; }
    return this.merged;
  } });
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
    taper(this.cur(), pts);
    for (var i = 0; i < pts.length; i++) this.fit(pts[i][0], pts[i][1], pts[i][2]);
  };
  // a rounded cell body, drawn out towards ang
  Ink.prototype.blob = function (x, y, r, ang, point) {
    var n = 28, i, t, rr, px, py, P = this.cur();
    for (i = 0; i <= n; i++) {
      t = -i / n * TAU;
      rr = r * (1 + point * Math.pow(Math.max(0, Math.cos(t)), 5));
      px = x + Math.cos(ang + t) * rr; py = y + Math.sin(ang + t) * rr;
      if (i) P.lineTo(px, py); else P.moveTo(px, py);
    }
    P.closePath();
    this.fit(x, y, r * (1 + point));
  };
  // a rounded triangle, pointing up (the broad foot of a cone)
  Ink.prototype.tri = function (x, y, r) {
    var n = 30, i, t, rr, px, py, P = this.cur();
    for (i = 0; i <= n; i++) {
      t = -i / n * TAU;
      rr = r * (1 + 0.32 * Math.cos(3 * t));
      px = x + Math.cos(t - Math.PI / 2) * rr; py = y - r * 0.2 + Math.sin(t - Math.PI / 2) * rr;
      if (i) P.lineTo(px, py); else P.moveTo(px, py);
    }
    P.closePath();
    this.fit(x, y, r * 1.4);
  };
  Ink.prototype.dot = function (x, y, r) {
    var P = this.cur();
    P.moveTo(x + r, y);
    P.arc(x, y, r, 0, TAU, true);
    this.fit(x, y, r);
  };
  Ink.prototype.hex = function (x, y, r, a) {
    var P = this.cur();
    for (var i = 0; i <= 6; i++) {
      var t = a - i / 6 * TAU, px = x + Math.cos(t) * r, py = y + Math.sin(t) * r;
      if (i) P.lineTo(px, py); else P.moveTo(px, py);
    }
    P.closePath();
    this.fit(x, y, r);
  };

  // ---------- dendrites, after Cajal ----------
  // The thinnest a stroke may get, in drawing units, set per layer so that every twig stays visible:
  // Cajal inked every last branch, and that is what makes his cells dense.
  var minInk = 0;
  // Where the cells are, for the plate's labels: while a slice paints, each cell marks its body (in the slice's units).
  var marks = null;
  function mark(k, x, y) { if (marks) marks.push({ k: k, x: x, y: y }); }

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
    if (end && o.leafInk && rnd() < o.leaf) o.leafInk.blob(x, y, o.leafR * (0.6 + rnd() * 0.8), ang, 0.2 + rnd() * 0.5);   // a tuft of foliage
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
    // pale streaks in the plasma, lying along the flow
    TEX.streak = texCanvas(256, 64, function (g) {
      for (var i = 0; i < 26; i++) {
        var y = rnd() * 64, x = rnd() * 256, l = 30 + rnd() * 90, w = 1 + rnd() * 2.5;
        g.strokeStyle = 'rgba(255,214,200,' + (0.18 + rnd() * 0.3).toFixed(2) + ')'; g.lineWidth = w; g.lineCap = 'round';
        [-256, 0, 256].forEach(function (ox) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y + (rnd() - 0.5) * 6, x + ox + l, y); g.stroke(); });
      }
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
    // the cortex's grey washes settle cooler than the retina's, their blotches blue-grey, like shadows on snow
    TEX.cool = pixels(256, function (i) { return [74, 80, 96, clamp((nw[i] - 0.45) * 2.6, 0, 1) * 255]; });
    TEX.mottleCool = pixels(256, function (i) { return [44, 50, 66, clamp((nz[i] - 0.4) * 1.6, 0, 1) * 200]; });
    // the white matter seen in perspective: bundles of myelinated fibres, and the small dark bodies between them
    TEX.wm = texCanvas(128, 64, function (g) {
      for (var i = 0; i < 30; i++) {
        var y = rnd() * 64, x = rnd() * 128, l = 20 + rnd() * 60;
        g.strokeStyle = 'rgba(150,146,140,' + (0.25 + rnd() * 0.3).toFixed(2) + ')'; g.lineWidth = 1 + rnd() * 2; g.lineCap = 'round';
        [-128, 0, 128].forEach(function (ox) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y + (rnd() - 0.5) * 5, x + ox + l, y); g.stroke(); });
      }
      for (i = 0; i < 18; i++) { g.fillStyle = 'rgba(90,86,84,.35)'; g.beginPath(); g.arc(rnd() * 128, rnd() * 64, 1.5 + rnd() * 1.5, 0, TAU); g.fill(); }
    });
    // the pia seen from below: a fine net of vessels and the feet of glia against it
    TEX.pia = texCanvas(96, 96, function (g) {
      for (var i = 0; i < 14; i++) {
        var x = rnd() * 96, y = rnd() * 96, a = rnd() * TAU, l = 20 + rnd() * 40;
        [-96, 0, 96].forEach(function (ox) { [-96, 0, 96].forEach(function (oy) {
          g.strokeStyle = i % 4 ? 'rgba(90,88,92,.3)' : 'rgba(140,50,56,.35)'; g.lineWidth = 1 + rnd() * 1.5;
          g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a + 0.6) * l / 2, y + oy + Math.sin(a + 0.6) * l / 2, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
        }); });
      }
    });
  }
  // Red blood cells, painted once: a biconcave disc, lit from the upper left, in tilts from face-on to edge-on.
  // Drawn in turn as a cell tumbles, they make it look round.
  var CELL_R = 50, CELL_S = 128;
  function paintCells() {
    var N = 12, R = CELL_R, S = CELL_S, T = 0.3 * R, frames = [];
    // half the cell's height at x (u = x / R): its rim seen at the tilt, plus its own thickness, thin in the middle
    function half(u, c, sn) {
      var r = Math.sqrt(Math.max(0, 1 - u * u));
      return R * c * r + T * 1.75 * r * (0.25 + 1.1 * u * u) * sn;
    }
    for (var f = 0; f < N; f++) {
      var th = f / (N - 1) * Math.PI / 2 * 0.97, c = Math.cos(th), sn = Math.sin(th);
      var dry = texCanvas(S, S, function (g) {
        g.translate(S / 2, S / 2);
        var body = new Path2D(), n = 48, i, x;
        for (i = 0; i <= n; i++) { x = -R + 2 * R * i / n; if (i) body.lineTo(x, -half(x / R, c, sn)); else body.moveTo(x, -half(x / R, c, sn)); }
        for (i = n; i >= 0; i--) { x = -R + 2 * R * i / n; body.lineTo(x, half(x / R, c, sn)); }
        body.closePath();
        var gr = g.createRadialGradient(-0.35 * R, -0.45 * R, 0.08 * R, 0, 0, 1.15 * R);
        gr.addColorStop(0, '#B42E3C'); gr.addColorStop(0.5, '#86132A'); gr.addColorStop(1, '#520812');
        g.fillStyle = gr; g.fill(body);
        // the dimple: a hollow, so lit on its far side; lighter than the rim, still darker than the plasma
        if (c > 0.12) {
          var dr = 0.55 * R, dg = g.createLinearGradient(-dr, -dr * c, dr, dr * c);
          dg.addColorStop(0, 'rgba(66,6,16,.85)'); dg.addColorStop(1, 'rgba(176,56,66,.8)');
          g.globalAlpha = smooth(0.12, 0.5, c);
          g.fillStyle = dg; g.beginPath(); g.ellipse(0, 0, dr, dr * c, 0, 0, TAU); g.fill();
          g.globalAlpha = 1;
        }
        // light catching the near rim, upper left
        g.strokeStyle = 'rgba(244,150,150,.55)'; g.lineWidth = 0.07 * R; g.lineCap = 'round';
        g.beginPath(); g.ellipse(0, -T * 0.4 * sn, 0.84 * R, 0.84 * R * c + 0.2 * T * sn + 0.5, 0, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
        // uneven pigment, pooled darker along the outline
        g.save(); g.clip(body);
        g.globalAlpha = 0.32; g.fillStyle = pattern(g, TEX.mottle, 0.5, 37 * f, 11 * f); g.fillRect(-S / 2, -S / 2, S, S);
        g.restore();
        g.strokeStyle = 'rgba(46,4,12,.55)'; g.lineWidth = 0.045 * R; g.stroke(body);
      });
      // a soft bleed under it, as wet paint spreads
      frames.push(texCanvas(S, S, function (g) {
        g.filter = 'blur(2.5px)'; g.globalAlpha = 0.4; g.drawImage(dry, 0, 0);
        g.filter = 'none'; g.globalAlpha = 1; g.drawImage(dry, 0, 0);
      }));
    }
    TEX.cells = frames;
    TEX.cellShadow = texCanvas(64, 32, function (g) {
      var gr = g.createRadialGradient(32, 16, 0, 32, 16, 32);
      gr.addColorStop(0, 'rgba(84,8,18,.6)'); gr.addColorStop(1, 'rgba(84,8,18,0)');
      g.setTransform(1, 0, 0, 0.5, 0, 8); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
  }

  // A blood cell at (x, y), rr across, tumbling (tilt 0 face-on .. 1 edge-on), turned by rot, fading by a,
  // flattened a little (sq) to sit in the plane of the river.
  function drawCell(x, y, rr, tilt, rot, a, sq) {
    var img = TEX.cells[Math.round(clamp(tilt, 0, 1) * (TEX.cells.length - 1))], k = rr / CELL_R;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.4 * a;
    ctx.drawImage(TEX.cellShadow, x - rr * 1.05, y + rr * (0.2 + 0.25 * sq), rr * 2.3, rr * 0.9 * sq);
    var cs = Math.cos(rot) * k * dpr, sn = Math.sin(rot) * k * dpr;
    ctx.setTransform(cs, sn * sq, -sn, cs * sq, x * dpr, y * dpr);
    ctx.globalAlpha = a;
    ctx.drawImage(img, -CELL_S / 2, -CELL_S / 2);
    ctx.globalAlpha = 1;
  }

  function pattern(g, tex, scale, ox, oy) {
    var key = g === backCtx ? 'patB' : g === ctx ? 'pat' : null;
    var pt = key ? tex[key] || (tex[key] = g.createPattern(tex, 'repeat')) : g.createPattern(tex, 'repeat');
    pt.setTransform(new DOMMatrix([scale, 0, 0, scale, ox || 0, oy || 0]));
    return pt;
  }

  // ---------- watercolour ----------
  // The forest is painted once, slice by slice, into bitmaps: cels for the multiplane's glass. Each colour goes
  // down as a wash: uneven pigment, a soft bleed past its edges, pigment pooling darker along them, then the paper.
  var scratch = [];
  // tint: the texture the pigment settles in (warm in the retina, cool in the cortex); org: where the textures are
  // pinned, in the canvas's pixels (a long plane is painted in chunks, and its textures must run on across them)
  var tint = null, org = [0, 0];
  function blank(i, w, h) {
    var c = scratch[i] || (scratch[i] = document.createElement('canvas')), g;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.clearRect(0, 0, w, h);
    return c;
  }
  // ibox: the shape's bounds in the same units as box; the wash only works on that part of the canvas.
  // strip: [x0, x1] in the same units: lay down only that strip of it (a big wash is laid down strip by strip,
  // each with a margin, so the bleed across a strip's edge is right, and only its own strip kept).
  function wash(out, path, colour, edge, qpx, box, soft, dry, ibox, strip) {
    var W0 = out.width, H0 = out.height, o = out.getContext('2d'), r = Math.max(0.8, soft * qpx), pad = Math.ceil(r * 2.5 + 2);
    var x0 = 0, y0 = 0, x1 = W0, y1 = H0, kx0 = 0, kx1 = W0;
    if (ibox) {
      x0 = clamp(Math.floor((ibox[0] - box[0]) * qpx) - pad, 0, W0); y0 = clamp(Math.floor((ibox[1] - box[1]) * qpx) - pad, 0, H0);
      x1 = clamp(Math.ceil((ibox[2] - box[0]) * qpx) + pad, 0, W0); y1 = clamp(Math.ceil((ibox[3] - box[1]) * qpx) + pad, 0, H0);
    }
    if (strip) {
      kx0 = clamp(Math.round((strip[0] - box[0]) * qpx), 0, W0); kx1 = clamp(Math.round((strip[1] - box[0]) * qpx), 0, W0);
      x0 = Math.max(x0, kx0 - pad); x1 = Math.min(x1, kx1 + pad);
    }
    var w = x1 - x0, h = y1 - y0, hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    if (w < 1 || h < 1) return;
    var A = blank(0, w, h), B = blank(1, hw, hh), E = blank(2, w, h), a = A.getContext('2d'), b = B.getContext('2d'), e = E.getContext('2d');
    // the shape in its colour, the pigment settling unevenly (textures stay put relative to the whole canvas)
    a.setTransform(qpx, 0, 0, qpx, -box[0] * qpx - x0, -box[1] * qpx - y0);
    a.fillStyle = colour; a.fill(path);
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'source-atop'; a.globalAlpha = 0.55;
    var ox = org[0] - x0, oy = org[1] - y0;
    a.fillStyle = pattern(a, tint === TEX.cool ? TEX.mottleCool : TEX.mottle, 1.4, ox, oy); a.fillRect(0, 0, w, h);
    a.globalAlpha = 0.22;
    a.fillStyle = pattern(a, tint || TEX.warm, 2.2, 37 + ox, 91 + oy); a.fillRect(0, 0, w, h);
    if (dry) {
      a.globalCompositeOperation = 'destination-out'; a.globalAlpha = dry;
      a.fillStyle = pattern(a, TEX.speckle, 1 + qpx / 1500, 13 + ox, 7 + oy); a.fillRect(0, 0, w, h);
    }
    a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
    // a soft copy, at half size: it bleeds past the edges, and tells us where the edges are
    b.filter = 'blur(' + (r / 2).toFixed(1) + 'px)'; b.drawImage(A, 0, 0, hw, hh); b.filter = 'none';
    // pigment pooling along the edges: the shape minus its soft copy, darker
    e.drawImage(A, 0, 0);
    e.globalCompositeOperation = 'destination-out'; e.drawImage(B, 0, 0, w, h);
    e.globalCompositeOperation = 'source-in'; e.fillStyle = edge; e.fillRect(0, 0, w, h);
    if (strip) { o.save(); o.beginPath(); o.rect(kx0, 0, kx1 - kx0, H0); o.clip(); }
    o.globalAlpha = 0.42; o.drawImage(B, x0, y0, w, h);
    o.globalAlpha = 0.88; o.drawImage(A, x0, y0);
    o.globalAlpha = 0.6; o.drawImage(E, x0, y0);
    o.globalAlpha = 1;
    if (strip) o.restore();
  }

  // Cut a wash into strips of at most about a quarter of a million pixels, so each is a short step of painting.
  // Returns the strips, in drawing units ([null] when it is small enough as it is).
  function strips(ibox, qpx) {
    var w = (ibox[2] - ibox[0]) * qpx, h = (ibox[3] - ibox[1]) * qpx, n = Math.ceil(w * h / 2.5e5);
    if (n <= 1) return [null];
    var out = [];
    for (var i = 0; i < n; i++) out.push([lerp(ibox[0], ibox[2], i / n), lerp(ibox[0], ibox[2], (i + 1) / n)]);
    out[0][0] = -1e9; out[n - 1][1] = 1e9;
    return out;
  }
  function paper(out, strength) {
    var o = out.getContext('2d');
    o.globalCompositeOperation = 'source-atop'; o.globalAlpha = strength;
    o.fillStyle = pattern(o, TEX.grain, 1, org[0], org[1]); o.fillRect(0, 0, out.width, out.height);
    o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
  }

  // ---------- state ----------
  var W, H, dpr, A, F, C, halfDiag, eyePx, EYE_S, dMin, cam0;
  // Resolution. The eye is drawn at the screen's full sharpness (dprEye). Inside it everything is soft paint, so it
  // is drawn within a budget of pixels (dprBase), and lower still if the device cannot keep up (dprIn, adapted in
  // frame()); the browser scales the canvas up, and the page's text, being HTML, stays sharp. The forest is painted
  // at paintScale (fixed when it is painted).
  var PIXEL_BUDGET = 1.6e6, dprEye = 1, dprBase = 1, dprIn = 0, paintScale = 1, forceScale = parseFloat(q.get('scale')) || 0;
  var cost = { n: 0, slow: 0, fast: 0, last: 0 };
  function useScale(sc) {
    var w = Math.round(W * sc), h = Math.round(H * sc);
    if (canvas.width === w && canvas.height === h && dpr === sc) return;
    dpr = sc; canvas.width = w; canvas.height = h;
  }
  // wait for the drawing to finish, by copying a pixel of it into a tiny canvas and reading that (reading the
  // stage itself back would make the browser take it off the GPU for good)
  var one = null;
  function flush() {
    one = one || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    one.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
    one.getImageData(0, 0, 1, 1);
  }
  var fall, forest, way, cortex, sparks, nightGrad, glowGrad, irisGrad, irisArt;
  var p = fixedP != null ? fixedP : 0, flatT = q.has('flat') ? 1 : 0, flatTarget = flatT;
  var rollC = 1, rollS = 0, buildMs = 0;
  var ptr = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, last: -1e9 };
  var iris = { x: 0, y: 0, tx: 0, ty: 0, wanderAt: 0 };
  var blink = { at: 2.2, start: -10, v: 0 };
  var CAM = { x: 0, y: 0, z: 0 }, FC = { x: 0, y: 0, c: FALL_TOP, roll: 0 }, SC = { x: 0, y: 0, by: 0, py: 0, z: 0, deep: 0 }, PT = { s: 1, tx: 0, ty: 0 };

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
      else if (it.under) {   // the outline under the fill: only the outside of the whole shape shows, not where its strokes overlap
        ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw * 2; ctx.stroke(it.path);
        ctx.fillStyle = it.fill; ctx.fill(it.path);
      } else {
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
        var ink = t.cells[Math.floor(rnd() * 3)], P = ink.cur();
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
    // and, seen on the way out, this eye's fibres in rose: from all over the retina to the blind spot, arching
    // around the fovea (the middle) rather than across it, thickening as they gather
    var lake = new Ink();
    for (i = 0; i < 260; i++) {
      var a1 = rnd() * TAU, r1 = 0.2 + rnd() * 1.3, x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1, way = [[x1, y1]];
      if (x1 > BLIND.x + 0.3 && Math.abs(y1) < 0.5) way.push([lerp(x1, 0, 0.5), (y1 < 0 ? -1 : 1) * (0.18 + Math.abs(y1) * 0.6 + rnd() * 0.06)]);   // around the fovea
      way.push([lerp(BLIND.x, way[way.length - 1][0], 0.35), lerp(BLIND.y, way[way.length - 1][1], 0.3)]);
      way.push([BLIND.x + (rnd() - 0.5) * 0.06, BLIND.y + (rnd() - 0.5) * 0.06]);
      var fp = makeRiver(way), n1 = fp.length;
      lake.taper(fp.map(function (q, j) { return [q[0], q[1], lerp(0.0018, 0.0042, j / (n1 - 1))]; }));
    }
    var lakeItem = { path: lake.path, fill: alpha('#C9849A', 0.85), box: lake.box, a: 0 };
    L.items.push(lakeItem);
    g = ctx.createRadialGradient(BLIND.x, BLIND.y, 0, BLIND.x, BLIND.y, 0.16);
    g.addColorStop(0, '#FFF8E6'); g.addColorStop(0.25, '#FCEBB8'); g.addColorStop(0.6, '#F6D27E'); g.addColorStop(0.8, '#E9A548'); g.addColorStop(1, 'rgba(225,140,60,0)');
    L.items.push({ path: circle(BLIND.x, BLIND.y, 0.16), fill: g, box: [BLIND.x - 0.16, BLIND.y - 0.16, BLIND.x + 0.16, BLIND.y + 0.16] });
    var veins = new Ink(), arteries = new Ink();
    var o = { step: 0.008, wiggle: 0.06, taper: 0.82, spread: 0.55, lenK: 0.7, wK: 0.74, depth: 5, side: 0.03, sideK: 0.45, joint: true,
      inside: function (x, y) { var r2 = x * x + y * y; return r2 > 0.02 && r2 < 3; } };   // they keep out of the very middle
    [[-0.42, 0.022, 0.015, veins], [-0.56, 0.024, 0.011, arteries], [0.42, -0.022, 0.015, veins], [0.56, -0.024, 0.011, arteries],
      [Math.PI + 0.5, 0, 0.012, veins], [Math.PI - 0.5, 0, 0.011, arteries], [Math.PI + 0.1, 0, 0.009, arteries], [Math.PI - 0.15, 0, 0.009, veins]].forEach(function (v) {
      o.curl = v[1] * o.step / 0.02;   // the curl is per step: keep the same turning per unit of length
      // out of the middle of the disc, swelling from nothing (no cut ends), then on as grown
      var sx = BLIND.x + Math.cos(v[0]) * 0.03, sy = BLIND.y + Math.sin(v[0]) * 0.03;
      v[3].taper([[BLIND.x + Math.cos(v[0]) * 0.004, BLIND.y + Math.sin(v[0]) * 0.004, v[2] * 0.6], [sx, sy, v[2]]]);
      grow(v[3], o, rnd, sx, sy, v[0], 0.62, v[2], 0);
    });
    veins.dot(BLIND.x, BLIND.y, 0.016);   // the cup they come out of
    L.items.push({ path: veins.path, fill: '#8C1626', stroke: '#4A0A14', lw: 0.003, box: veins.box, under: true });
    L.items.push({ path: arteries.path, fill: '#C3343B', stroke: '#5E0E1C', lw: 0.0025, box: arteries.box, under: true });
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
    list.lake = lakeItem;
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

  // look (on the way out, rising from the roof to the blind spot): how lit (e), how far the vignette opens (f),
  // how dark it still is, and the layers above the roof not fading as we near them
  function drawFall(cam, look) {
    rollC = Math.cos(cam.roll); rollS = Math.sin(cam.roll);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0A0C14';
    ctx.fillRect(0, 0, W, H);
    var e = look ? look.e : smooth(P_GLOW - 0.005, P_GLOW + 0.04, p), T = PT, i, L, d, s, a;
    fall.lake.a = look ? look.fibres : 0;
    if (e > 0) {
      for (i = 0; i < fall.length; i++) {
        L = fall[i]; d = cam.c - L.h;
        if (d < 0.0012) continue;
        s = F / d;
        a = L.size ? smooth(0.6, 2.5, L.size * s) : 1;
        if (L.near && !look) a *= smooth(L.near * 0.15, L.near, d);   // things above the roof fade before they reach us
        if (a < 0.01) continue;
        T.s = s; T.tx = C.x - cam.x * s; T.ty = C.y - cam.y * s;
        setT(T.s, T.tx, T.ty);
        drawItems(L.items, T, a);
      }
      // the light falls off towards the edges, as when you look through an ophthalmoscope
      var f = look ? look.f : clamp((p - P_GLOW) / (P_CUT - P_GLOW), 0, 1);
      var v = ctx.createRadialGradient(C.x, C.y, halfDiag * lerp(0.1, 0.65, f), C.x, C.y, halfDiag * lerp(0.75, 1.6, f));
      v.addColorStop(0, 'rgba(10,12,20,0)'); v.addColorStop(1, 'rgba(10,12,20,.9)');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    // dark until the light comes up, and dark again as we sink into the roof
    var dark = look ? look.dark : Math.max(1 - e, smooth(0.006, 0.0018, cam.c - ROOF_H));
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
  function rodOrCone(g, rnd, x, k, cone, fl, sc) {
    fl = fl == null ? FLOOR * k : fl; sc = sc || 1;
    var os = (cone ? 0.1 : 0.17) * k * sc, is = (cone ? 0.18 : 0.1) * k * sc, w = (cone ? 0.011 : 0.0065) * k * sc;
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
    mark(cone ? 'C' : 'R', x, cone ? osTop - is * 0.4 : (osTop + fl) / 2);   // a cone's swelling, a rod's stack of discs
    return { x: x + sw, y: ft };
  }

  // A bipolar cell: an upper trunk from the feet of a few rods and cones up into the canopy, its body hanging
  // on it like a lantern. A tree's own bipolar cell is thicker.
  function bipolarCell(g, rnd, x, k, feet, sc) {
    sc = sc || 1;
    var sy = (-0.2 + rnd() * 0.26) * k, top = (-0.48 - rnd() * 0.12) * k, wob = (rnd() - 0.5) * 0.04 * k, i;
    for (i = 0; i < feet.length; i++) {
      var f = feet[i];
      g.ink.taper([[x, sy, 0.003 * k * sc], [lerp(x, f.x, 0.55), lerp(sy, f.y, 0.75), 0.002 * k * sc], [f.x, f.y, 0.0012 * k]]);
    }
    g.ink.taper([[x, sy, 0.0045 * k * sc], [x + wob * 0.5, (sy + top) / 2, 0.0038 * k * sc], [x + wob, top, 0.003 * k * sc]]);
    grow(g.ink, { step: 0.012 * k, wiggle: 0.6, taper: 0.3, spread: 0.9, lenK: 0.55, wK: 0.6, depth: 2 }, rnd, x + wob, top, -Math.PI / 2, 0.04 * k * sc, 0.0022 * k * sc, 0);
    g.lamp.blob(x, sy, 0.018 * k * sc, -Math.PI / 2, 0.6);
    mark('Bc', x, sy);
  }

  // A horizontal cell: lower branches spreading wide from the foot of a tree, drooping, with tufts down to the
  // feet of the rods and cones around it.
  function horizontalCell(g, rnd, x, y, k, lod, sc) {
    var s, j, o = { step: 0.018 * k, wiggle: 0.26, taper: 0.5, spread: 0.6, lenK: 0.58, wK: 0.66, depth: 1 + lod, pullK: 0.06, leafInk: g.leafLow, leaf: lod ? 0.6 : 0.3, leafR: 0.011 * k * sc };
    for (s = -1; s <= 1; s += 2) {
      o.pull = s > 0 ? 0.35 : Math.PI - 0.35;
      for (j = 0; j < 1 + (lod >> 1); j++) grow(g.ink, o, rnd, x, y, s > 0 ? -0.25 - rnd() * 0.3 : Math.PI + 0.25 + rnd() * 0.3, (0.13 + rnd() * 0.12) * k * sc, 0.0055 * k * sc, 0);
    }
    var drop = { step: 0.012 * k, wiggle: 0.4, taper: 0.3, spread: 0.7, lenK: 0.5, wK: 0.6, depth: 1, pull: Math.PI / 2, pullK: 0.1 };
    for (j = 0; j < 2 + lod; j++) grow(g.ink, drop, rnd, x + (rnd() - 0.5) * 0.3 * k * sc, y + 0.01 * k, Math.PI / 2, 0.07 * k, 0.0025 * k, 0);
    g.gang.blob(x, y - 0.012 * k, 0.015 * k * sc, 0, 0.3);
    mark('Hc', x, y - 0.012 * k);
  }

  // An amacrine cell: branches rising into the canopy and spreading flat, a lacy crown with tufts of foliage.
  function amacrineCell(g, rnd, x, k, lod, sc) {
    sc = sc || 1;
    var y = (-0.36 - rnd() * 0.06) * k, j;
    var o = { step: 0.016 * k, wiggle: 0.38, taper: 0.5, spread: 0.75, lenK: 0.6, wK: 0.66, depth: 2 + lod, pullK: 0.1, spine: lod > 1 ? 0.15 : 0, spineLen: 0.008 * k,
      leafInk: g.leaf, leaf: lod ? 0.75 : 0.5, leafR: 0.016 * k * sc };
    for (j = 0; j < 3 + lod; j++) {
      var side = j % 2 ? 1 : -1;
      o.pull = side > 0 ? -0.2 : Math.PI + 0.2;
      grow(g.ink, o, rnd, x, y, -Math.PI / 2 + side * (0.3 + rnd() * 0.7), (0.12 + rnd() * 0.14) * k * sc, 0.004 * k * sc, 0);
    }
    g.gang.blob(x, y, 0.016 * k * sc, -Math.PI / 2, 0.5);
    mark('Ac', x, y);
  }

  // One tree of the strange forest, built the way the retina is: a cone for its trunk, horizontal cells for its
  // lower branches, a bipolar cell for its upper trunk, amacrine cells for its canopy, a ganglion cell in the roof.
  function tree(g, rnd, x, k, lod, ground, feet) {
    var sc = 0.8 + rnd() * 0.55, fl = ground(x);
    var foot = rodOrCone(g, rnd, x, k, true, fl, sc * 1.25);
    feet.push(foot);
    horizontalCell(g, rnd, foot.x + (rnd() - 0.5) * 0.02 * k, (0.15 + rnd() * 0.04) * k, k, lod, sc);
    var near = feet.filter(function (f) { return Math.abs(f.x - foot.x) < 0.07 * k; }).slice(0, 4);
    var bx = foot.x + (rnd() - 0.5) * 0.03 * k;
    bipolarCell(g, rnd, bx, k, near, sc * 1.35);
    var n = lod > 1 ? 3 : 2;
    for (var j = 0; j < n; j++) amacrineCell(g, rnd, bx + (j - (n - 1) / 2) * 0.09 * k * sc + (rnd() - 0.5) * 0.03 * k, k, lod, sc);
    if (rnd() < 0.8) ganglionCell(g, rnd, bx + (rnd() - 0.5) * 0.1 * k, k, lod);
  }

  // A ganglion cell: a big body in the roof, dendrites down into the canopy, an axon up and away along the top.
  function ganglionCell(g, rnd, x, k, lod) {
    var y = (-0.78 + (rnd() - 0.5) * 0.05) * k, dir = rnd() < 0.5 ? -1 : 1, j;
    var o = { step: 0.02 * k, wiggle: 0.32, taper: 0.45, spread: 0.75, lenK: 0.6, wK: 0.65, depth: lod, pull: Math.PI / 2, pullK: 0.04 };
    for (j = 0; j < 1 + lod; j++) grow(g.ink, o, rnd, x, y, Math.PI / 2 + (rnd() - 0.5) * 1.4, (0.1 + rnd() * 0.12) * k, 0.0055 * k, 0);
    var ay = (ILM - 0.02 - rnd() * 0.06) * k;
    g.ink.taper([[x, y, 0.005 * k], [x + dir * 0.015 * k, ay + 0.03 * k, 0.004 * k], [x + dir * 0.06 * k, ay, 0.003 * k], [x + dir * 0.14 * k, ay - 0.015 * k, 0]]);
    g.gang.blob(x, y, (0.022 + rnd() * 0.012) * k, -Math.PI / 2, 0.7);
    mark('Gc', x, y);
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
    mark('Mg', bx, lerp(split, OLM * k, 0.4));   // among its lifted roots
  }

  // A slice is painted in small steps, queued on forest.steps, so the page stays smooth while it grows:
  // lay out the ground and the rods, grow the trees a few at a time, the rest, then one wash at a time, then finish.
  function sliceSteps(D, view) {
    var S = {}, rnd = forest.rnd, k = 1 / D, hz = haze(D), lod = D < 3 ? 2 : D < 8 ? 1 : 0, frame = D < 1.5;
    var X = (view + 0.42) * (D - CAM_Z0) / D, x, i, g, feet = [];
    function open(x, wide) {
      if (frame && Math.abs(x) < view * (wide ? 0.62 : 0.45)) return true;
      return Math.abs(x - S.rx) < (wide ? 0.3 : 0.09) * k * (0.8 + rnd() * 0.4);
    }
    function ink(on) { minInk = on ? 0.7 / S.qpx : 0; wobble = on ? 0.35 : 0; if (on) wob = S.wob; marks = on ? S.marks : null; }
    return [
      function layout() {
        g = S.g = { pr: new Ink(), rod: new Ink(), seg: new Ink(), glia: new Ink(), ink: new Ink(), lamp: new Ink(), gang: new Ink(), leaf: new Ink(), leafLow: new Ink(),
          roofA: new Ink(), roofB: new Ink(), roofC: new Ink(), ground: new Ink(), lumps: new Ink(), discs: lod > 1 ? new Path2D() : null };
        S.marks = [];
        // keep an avenue open along the river, wide for the trees, narrow for the rods and cones on its banks
        S.rx = riverX(D) * k;
        // fine where we come close, coarser where it gets blurred anyway: far off, and right in front of us
        S.qpx = H * clamp(D / Math.max(0.5, D - CAM_Z1), 1, 1.3) * paintScale * (frame ? 0.55 : D > 6 ? 0.7 : 1);
        S.wob = rng(Math.round(D * 1000));
        ink(true);
        // the ground: rolling, lumpy with cells, low where the river runs
        var ph1 = rnd() * TAU, ph2 = rnd() * TAU, mounds = [];
        for (i = 0; i < Math.ceil(X / k * 1.5) + 3; i++) mounds.push({ c: lerp(-X, X, rnd()), w: (0.18 + rnd() * 0.4) * k, h: (0.03 + rnd() * 0.09) * k });
        S.ground = function (x) {
          var h = 0.03 * k * (1 + Math.sin(x / k * 1.7 + ph1)) + 0.016 * k * (1 + Math.sin(x / k * 4.3 + ph2));
          for (var j = 0; j < mounds.length; j++) { var t = (x - mounds[j].c) / mounds[j].w; h += mounds[j].h * Math.exp(-t * t * 2); }
          return FLOOR * k - h * smooth(0.08 * k, 0.4 * k, Math.abs(x - S.rx));
        };
        var gp = g.ground.cur(), steps = 160;
        S.bottom = (FLOOR + 0.4) * k;
        gp.moveTo(X, S.bottom);   // right to left along the top, so it winds the same way as the strokes
        for (i = 0; i <= steps; i++) { x = lerp(X, -X, i / steps); gp.lineTo(x, S.ground(x)); }
        gp.lineTo(-X, S.bottom); gp.closePath();
        g.ground.fit(-X, FLOOR * k - 0.3 * k, 0); g.ground.fit(X, S.bottom, 0);
        for (x = -X; x < X; x += (0.012 + rnd() * 0.014) * k) {   // the cell bodies that make its surface lumpy
          if (rnd() < 0.85) g.lumps.blob(x, S.ground(x) + (0.004 + rnd() * 0.012) * k, (0.007 + rnd() * 0.009) * k, -Math.PI / 2, 0.15);
        }
        // an understorey of rods, with the odd cone, in clumps
        for (x = -X + rnd() * 0.5 * k; x < X; x += Math.max(0.06, 0.03 * k) * (0.7 + rnd() * 0.6) * (rnd() < 0.15 ? 2.5 : 1)) {
          if (!open(x, false)) feet.push(rodOrCone(g, rnd, x, k, rnd() < 0.08, S.ground(x), 0.8 + rnd() * 0.4));
        }
        S.tstep = Math.max(0.05, (frame ? 0.22 : lod > 1 ? 0.3 : 0.34) * k);
        S.tx = -X + rnd() * S.tstep;
        ink(false);
      },
      function trees() {
        var t0 = performance.now();
        ink(true);
        while (S.tx < X && performance.now() - t0 < 14) {
          if (!open(S.tx, true)) tree(g, rnd, S.tx, k, lod, S.ground, feet);
          S.tx += S.tstep * (0.6 + rnd() * 0.8);
        }
        ink(false);
        return S.tx >= X;
      },
      function rest() {
        ink(true);
        // a few thin bipolar cells between the trees, more ganglion cells, the roof, and the occasional mangrove
        for (x = -X + rnd() * 0.1 * k; x < X; x += Math.max(0.08, 0.3 * k) * (0.7 + rnd() * 0.6)) {
          if (open(x, true)) continue;
          bipolarCell(g, rnd, x, k, feet.filter(function (f) { return Math.abs(f.x - x) < 0.05 * k; }).slice(0, 3), 0.8);
        }
        for (x = -X + rnd() * 0.3 * k; x < X; x += Math.max(0.12, 0.5 * k) * (0.7 + rnd() * 0.6)) if (!open(x, true)) ganglionCell(g, rnd, x, k, lod);
        roof(g, rnd, X, k);
        for (x = -X + rnd() * 0.5 * k; x < X; x += Math.max(0.22, 1.1 * k) * (0.7 + rnd() * 0.6)) if (!open(x, true)) mullerCell(g, rnd, x, k, lod);
        ink(false);
        // the canvas, and the washes to lay on it, back to front
        var box = S.box = [-X, (ILM - 0.24) * k, X, S.bottom], cv = S.cv = document.createElement('canvas');
        // at most 4096 pixels either way: on a wide screen the slice is painted a little coarser, the same both ways,
        // so the painting still fills its canvas exactly (or it would be stretched and the ground lifted)
        S.qpx = Math.min(S.qpx, 4096 / (box[2] - box[0]), 4096 / (box[3] - box[1]));
        cv.width = Math.ceil((box[2] - box[0]) * S.qpx); cv.height = Math.ceil((box[3] - box[1]) * S.qpx);
        var earth = ctx.createLinearGradient(0, (FLOOR - 0.15) * k, 0, S.bottom);
        earth.addColorStop(0, mix('#E9B54A', HAZE, hz)); earth.addColorStop(0.35, mix('#D99A36', HAZE, hz)); earth.addColorStop(1, mix('#B8742A', HAZE, hz));
        S.washes = [[g.roofC, '#A56A7C', 0.2, 1], [g.ground, earth, 0.15, 0, '#C98A2E'], [g.lumps, '#D7A03E', 0.2], [g.seg, '#C48A3A', 0.3], [g.rod, '#A0703E', 0.35], [g.pr, '#6B3A24', 0.3],
          [g.glia, '#7E86A8', 0.35], [g.leafLow, '#7A4A3A', 0.3], [g.ink, '#3E1C24', 0.45], [g.leaf, '#8E4E5E', 0.25],
          [g.roofB, '#83405A', 0.2, 1], [g.gang, '#7A2E4A', 0.25], [g.roofA, '#64263E', 0.2, 1], [g.lamp, '#C9587C', 0.2]];
      },
      function washes() {
        var t0 = performance.now(), soft = 0.012 * k;
        function edge(c) { return mix(mix(c, '#14080B', 0.45), HAZE, hz * 0.8); }
        do {
          var w = S.washes[0], base = w[4] || w[1];
          if (!isFinite(w[0].box[0])) { S.washes.shift(); continue; }
          w.strips = w.strips || strips(w[0].box, S.qpx);
          // the roofs fade into the light more than the rest of their slice
          var c = typeof w[1] !== 'string' ? w[1] : w[3] ? mix(w[1], HAZE, Math.min(1, hz * 1.25)) : mix(w[1], HAZE, hz);
          wash(S.cv, w[0].path, c, w[3] ? mix(edge(base), HAZE, hz * 0.4) : edge(base), S.qpx, S.box, soft, w[2], w[0].box, w.strips.shift());
          if (w.strips.length) continue;
          S.washes.shift();
          if (w[0] === g.seg && g.discs) {
            var o = S.cv.getContext('2d');
            o.setTransform(S.qpx, 0, 0, S.qpx, -S.box[0] * S.qpx, -S.box[1] * S.qpx);
            o.strokeStyle = alpha('#5C3214', 0.4); o.lineWidth = 0.0016 * k; o.stroke(g.discs);
            o.setTransform(1, 0, 0, 1, 0, 0);
          }
        } while (S.washes.length && performance.now() - t0 < 6);
        return !S.washes.length;
      },
      function finish() {
        var cv = S.cv;
        paper(cv, 0.6);
        // far off, the air softens everything; right in front of us, the lens does, focused further in
        if (D > 6 || frame) {
          var bl = blank(1, cv.width, cv.height), b = bl.getContext('2d');
          b.filter = 'blur(' + (frame ? 1.3 : 0.4 + D * 0.045).toFixed(1) + 'px)'; b.drawImage(cv, 0, 0); b.filter = 'none';
          var o2 = cv.getContext('2d'); o2.clearRect(0, 0, cv.width, cv.height); o2.drawImage(bl, 0, 0);
        }
        forest.planes.push({ D: D, items: [settle({ img: cv, box: S.box })] });
        forest.planes.sort(function (a, b) { return b.D - a.D; });
        // the cells the plate may name: not in the blurred frame right in front of us, nor so far off they are specks
        if (!frame && D < 5) S.marks.forEach(function (m) { addMark(m.k, { x: m.x * D, Y: m.y * D, D: D }); });
        S = null; g = null;
      }
    ];
  }

  // Hand a freshly painted bitmap to the browser to get ready for drawing, in the background, so that the first
  // frame that needs it does not stall while it is uploaded.
  // (and let the canvas go once the bitmap stands in for it; a cel let go meanwhile lets its bitmap go too)
  function settle(item) {
    var cv = item.img;
    if (window.createImageBitmap) createImageBitmap(cv).then(function (bm) {
      if (item.img === cv) { item.img = bm; cv.width = cv.height = 0; } else bm.close();
    }, function () {});
    return item;
  }

  // A rod or cone of the grove we end up in, close enough at the end to be as wide as a tree: painted once as a
  // tall, narrow cel, at about the size it will be when we get there.
  function paintTrunk(t) {
    var g = { pr: new Ink(), seg: new Ink(), discs: new Path2D() }, rnd = rng(Math.round(t.D * 9973 + t.x * 1013 + 7));
    var qpx = Math.min(F / Math.max(0.12, t.D - CAM_Z1) * paintScale, 2400 / 0.7);
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
  // Where a point of the forest lands on screen. The camera's own path (cam.by, cam.z) is seen with true depth;
  // the sway that follows the pointer (cam.x, cam.py) is the parallax, and flattening takes the depth out of just
  // that: every plane then sways alike, so the picture stays the same but no longer comes apart as you move.
  function sway(den) { return F / lerp(den, FLAT_REF, flatT); }
  var PR = { x: 0, y: 0, s: 1, den: 1 };
  // (cam.wx: a camera that tracks sideways, as it does along the cortex; the forest's never does)
  function proj(x, Y, D, cam) {
    var den = Math.max(0.02, D - cam.z), k = D / den, sw = sway(den);
    PR.x = C.x + x / D * H * k - (cam.wx || 0) * F / den - cam.x * sw;
    PR.y = C.y + Y / D * H * k - cam.by * F / den - cam.py * sw;
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

  // The river, painted in layers like a wash: a soft bleed into the banks, darker plasma along the edges and
  // lighter in the middle, uneven pigment that stays put on the river, pigment pooled along the banks, pale streaks
  // flowing downstream, and the cells, tumbling in it.
  function drawRiverRun(r, cam, now, st) {
    var R = st.pts, wid = st.wid, i, a, sc = [], n;
    // The river is a ribbon lying on the floor: at each point, its width runs across its course, in the floor's
    // plane, and is seen in perspective. sc: the middle on screen, and the vector to its right bank.
    // Only what is in front of us: the river's near end runs past the camera at the end of the scroll.
    for (i = r.a0; i <= r.b; i++) {   // runs meet exactly at a shared point, so nothing doubles up where they join
      if (R[i][1] - cam.z < 0.08) continue;
      var i0 = Math.max(0, i - 1), i1 = Math.min(R.length - 1, i + 1), dx = R[i1][0] - R[i0][0], dD = R[i1][1] - R[i0][1], dl = Math.hypot(dx, dD) || 1;
      var nx = dD / dl * wid, nD = -dx / dl * wid, mid = proj(R[i][0], st.Y - 0.002, R[i][1], cam), mx = mid.x, my = mid.y, ms = mid.s;
      var rb = proj(R[i][0] + nx, st.Y - 0.002, Math.max(cam.z + 0.04, R[i][1] + nD), cam);
      sc.push([mx, my, ms * wid, rb.x - mx, rb.y - my]);
    }
    n = sc.length;
    if (n < 2) return;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < n; i++) {
      var ex = Math.abs(sc[i][3]) * 1.3, ey = Math.abs(sc[i][4]) * 1.3;
      x0 = Math.min(x0, sc[i][0] - ex); x1 = Math.max(x1, sc[i][0] + ex); y0 = Math.min(y0, sc[i][1] - ey); y1 = Math.max(y1, sc[i][1] + ey);
    }
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return;
    // a band k half-widths wide, shifted by dx half-widths towards the right bank
    function band(k, dx) {
      var p = new Path2D(), c, f;
      dx = dx || 0;
      for (i = 0; i < n; i++) { c = sc[i]; f = dx - k; if (i) p.lineTo(c[0] + c[3] * f, c[1] + c[4] * f); else p.moveTo(c[0] + c[3] * f, c[1] + c[4] * f); }
      for (i = n - 1; i >= 0; i--) { c = sc[i]; f = dx + k; p.lineTo(c[0] + c[3] * f, c[1] + c[4] * f); }
      p.closePath();
      return p;
    }
    // the paint's texture is pinned to the river as a whole (st.rf, once a frame), so the runs match up
    var rf = st.rf, s0 = rf.s, body = band(1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(120,26,30,.1)'; ctx.fill(band(1.2));                                // bleed
    ctx.fillStyle = '#A8323A'; ctx.fill(body);                                                // plasma, darker at the edges
    ctx.fillStyle = '#D15A55'; ctx.fill(band(0.8, -0.06));
    ctx.fillStyle = '#E07B6C'; ctx.fill(band(0.46, -0.12));                                  // lighter in the middle, towards the light
    ctx.save(); ctx.clip(body);
    var ox = rf.x, oy = rf.y;
    ctx.globalAlpha = 0.34; ctx.fillStyle = pattern(ctx, TEX.mottle, s0 * 0.0022, ox, oy); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 0.1; ctx.fillStyle = pattern(ctx, TEX.speckle, s0 * 0.004, ox + 13, oy + 7); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // pale streaks, carried downstream along the river's course
    ctx.globalAlpha = 0.55; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,212,196,.5)';
    var flow = now * 0.00006;
    for (var lane = -0.55; lane <= 0.56; lane += 0.55) {
      ctx.setLineDash([s0 * 0.05, s0 * 0.11]); ctx.lineDashOffset = -(flow * s0 * 3 + lane * s0 * 0.4) + r.a0 * 7.3;
      ctx.lineWidth = Math.max(0.6, s0 * 0.004);
      ctx.beginPath();
      for (i = 0; i < n; i++) { var lx = sc[i][0] + lane * 0.8 * sc[i][3], ly = sc[i][1] + lane * 0.8 * sc[i][4]; if (i) ctx.lineTo(lx, ly); else ctx.moveTo(lx, ly); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.restore();
    // pigment pooled along the banks (just the banks: the ends of a run are where the next one joins)
    var banks = new Path2D();
    [-1, 1].forEach(function (side) {
      for (i = 0; i < n; i++) { var c = sc[i]; if (i) banks.lineTo(c[0] + c[3] * side, c[1] + c[4] * side); else banks.moveTo(c[0] + c[3] * side, c[1] + c[4] * side); }
    });
    ctx.strokeStyle = 'rgba(94,14,28,.5)'; ctx.lineWidth = Math.max(1, s0 * 0.003); ctx.stroke(banks);
    if (st.banks) drawBanks(sc, n);
    // blood cells drifting with the flow, far ones first; some deeper in the plasma than others
    var list = [];
    for (var j = 0; j < st.cells.length; j++) {
      var bc = st.cells[j], t = (bc.t + now * 0.000012 * bc.v) % 1, fi = t * (R.length - 1);
      if (fi >= r.a0 && fi < r.b && riverAt(R, t)[1] - cam.z > 0.1) list.push([fi, bc, t]);
    }
    list.sort(function (p1, p2) { return p2[0] - p1[0] || p2[1].d - p1[1].d; });
    for (j = 0; j < list.length; j++) {
      var c = list[j][1], at = riverAt(R, list[j][2]), q2 = proj(at[0] + c.off * wid, st.Y - 0.003, at[1], cam);
      var squash = clamp((st.Y - cam.y) / q2.den, 0.15, 1), ph = c.ph + now * 0.0007 * c.spin;
      drawCell(q2.x, q2.y, 0.024 * q2.s * c.size * (st.cellK || 1), Math.abs(Math.sin(ph)), c.rot + 0.4 * Math.sin(ph * 0.5), 1 - 0.45 * c.d, 0.55 + 0.45 * squash);
    }
    // the boat rides on the run it is on, over the cells in it (sorted on its own, the run could cover it)
    var bf = st.boat.t * (R.length - 1);
    if (bf >= r.a0 && bf < r.b && SKIP.indexOf('boat') < 0) drawBoat(cam, now, st);
  }

  // the capillary of the deep plexus, a tube winding among the lower branches, painted the same way, its cells
  // seen through its wall
  function drawTube(r, cam, now) {
    var tb = forest.tube, pts = tb.pts, i, sc = [], n = pts.length;
    for (i = r.a; i <= r.b; i++) { var a = proj(pts[i][0], pts[i][1], pts[i][2], cam); sc.push([a.x, a.y, tb.R * a.s * pts[i][3]]); }
    function off(k, side) {
      return sc.map(function (c, m) {
        var i0 = Math.max(0, m - 1), i1 = Math.min(sc.length - 1, m + 1), tx = sc[i1][0] - sc[i0][0], ty = sc[i1][1] - sc[i0][1], tl = Math.hypot(tx, ty) || 1;
        return [c[0] + ty / tl * c[2] * side, c[1] - tx / tl * c[2] * side, c[2] * k];
      });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var path = new Path2D(); taper(path, sc.map(function (c) { return [c[0], c[1], c[2] * 1.25]; })); ctx.fillStyle = 'rgba(120,26,30,.14)'; ctx.fill(path);
    path = new Path2D(); taper(path, sc.map(function (c) { return [c[0], c[1], c[2] + Math.max(0.6, c[2] * 0.12)]; })); ctx.fillStyle = '#7A1622'; ctx.fill(path);
    path = new Path2D(); taper(path, sc); ctx.fillStyle = '#C24A4C'; ctx.fill(path);
    path = new Path2D(); taper(path, off(0.55, 0.2)); ctx.fillStyle = 'rgba(226,116,104,.85)'; ctx.fill(path);
    var list = [];
    for (var j = 0; j < tb.cells.length; j++) {
      var fi = ((tb.cells[j].t + now * 0.00005) % 1) * (n - 1);
      if (fi >= r.a0 && fi < r.b) list.push([fi, tb.cells[j]]);
    }
    list.sort(function (p1, p2) { return p2[0] - p1[0]; });
    for (j = 0; j < list.length; j++) {
      var k = clamp(Math.floor(list[j][0]) - r.a, 0, sc.length - 1), c = sc[k], tc = list[j][1], ph = tc.ph + now * 0.0008;
      drawCell(c[0], c[1], c[2] * 0.75, Math.abs(Math.sin(ph)), tc.rot, 0.9, 1);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    path = new Path2D(); taper(path, off(0.14, 0.5)); ctx.fillStyle = 'rgba(255,214,200,.5)'; ctx.fill(path);   // the light on the wall, over the cells
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


  // The boat: a red blood cell, round and dished, riding the river, and sitting in it our eye, small, looking around.
  // Crisp, like a cel-animated character over the painted ground.
  function drawBoat(cam, now, st) {
    var b = st.boat, at = riverAt(st.pts, b.t), pr = proj(at[0], st.Y - 0.004, at[1], cam);
    var R = 0.062 * pr.s * (st.boatK || 1), x = pr.x, y = pr.y + Math.sin(now * 0.0016) * R * 0.05, tilt = Math.sin(now * 0.0012) * 0.06;
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
    var crnd = rng(SEED + 21);
    for (i = 0; i < 70; i++) cells.push({ t: rnd(), v: 0.6 + rnd() * 0.8, off: (rnd() - 0.5) * 1.1,
      d: crnd(), ph: crnd() * TAU, spin: 0.5 + crnd(), rot: (crnd() - 0.5) * 1.2, size: 0.85 + crnd() * 0.3 });
    var tubeCtrl = [[3.2, 0.2, 1.5], [1.0, 0.17, 2.3], [0.2, 0.15, 3.6], [-0.7, 0.16, 5.4], [-1.2, 0.18, 8], [-0.6, 0.17, 12], [0.2, 0.16, 18]], tpts = [];
    for (i = 0; i < tubeCtrl.length - 1; i++) {
      var a = tubeCtrl[Math.max(0, i - 1)], b = tubeCtrl[i], c = tubeCtrl[i + 1], d = tubeCtrl[Math.min(tubeCtrl.length - 1, i + 2)];
      for (var k = 0; k < 18; k++) { var t = k / 18; tpts.push([cm(a[0], b[0], c[0], d[0], t), cm(a[1], b[1], c[1], d[1], t), cm(a[2], b[2], c[2], d[2], t)]); }
    }
    tpts.push(tubeCtrl[tubeCtrl.length - 1].slice());
    tpts.forEach(function (pt, j) { pt[3] = 1 - 0.85 * smooth(0.8, 1, j / (tpts.length - 1)); });
    var tcells = [];
    for (i = 0; i < 9; i++) tcells.push({ t: (i + rnd() * 0.6) / 9, ph: crnd() * TAU, rot: (crnd() - 0.5) * 1.4 });
    // the grove at the end: rods and cones close enough to be trees, either side of the river
    var grove = [[-0.12, 1.14, 0], [0.16, 1.17, 1], [-0.24, 1.26, 1], [0.27, 1.3, 0], [-0.17, 1.47, 0], [0.36, 1.48, 1], [-0.36, 1.55, 0], [0.12, 1.62, 1], [-0.18, 1.66, 0], [0.24, 1.2, 0]]
      .map(function (g) { return { x: g[0] * Math.max(1, view / 0.75), D: g[1], cone: !!g[2], nuc: lerp(0.34, OLM - 0.04, rnd()) }; });
    var rays = [];
    [[13, 1], [7.5, 2], [4.4, 1], [2.7, 1], [1.9, 1]].forEach(function (r) {
      for (i = 0; i < r[1]; i++) rays.push({ D: r[0] * (0.82 + rnd() * 0.12), x: lerp(-view, view, rnd()) * r[0] * 0.9, w: (0.22 + rnd() * 0.3) * Math.sqrt(r[0] / 3), slant: 0.32, a: 0.5 + rnd() * 0.25 });
    });
    forest = { planes: [], steps: [], rnd: rnd, view: view, river: river, tube: { pts: tpts, R: 0.02, cells: tcells }, grove: grove, rays: rays, markBy: {},
      kinds: KINDS, layers: LAYERS, legend: legends[0],
      stream: { pts: river, Y: FLOOR, wid: 0.075, cells: cells, boat: { t: 0.5 }, rf: null } };
    // for the plate: what is not painted into the slices (the slices add their cells as they are painted)
    grove.forEach(function (t) { addMark(t.cone ? 'C' : 'R', { x: t.x, Y: t.cone ? 0.73 : 0.8, D: t.D }); });
    for (i = 0; i < tpts.length; i += 6) addMark('Cap', { x: tpts[i][0], Y: tpts[i][1], D: tpts[i][2] });
    for (i = 0; i < river.length; i += 4) addMark('Cap', { x: river[i][0], Y: FLOOR, D: river[i][1] });
    cells.forEach(function (c) { addMark('Rbc', { cell: c }); });
    addMark('S', { boat: true });
    // what there is to paint, in order: the veil we meet first, the slices far to near, then the grove's trunks
    forest.steps.push.apply(forest.steps, veilSteps(rnd));
    SLICES.forEach(function (D) { forest.steps.push.apply(forest.steps, sliceSteps(D, view)); });
    grove.forEach(function (t) { forest.steps.push(function trunk() { paintTrunk(t); }); });
    // split the river and the tube where they pass a slice, so the slices can cover them and they the slices
    forest.riverRuns = split(river.map(function (r) { return r[1]; }));
    forest.tubeRuns = split(tpts.map(function (r) { return r[2]; }));
  }
  function split(depths, slices) {
    var runs = [], a = 0, n = depths.length, i;
    slices = slices || SLICES;
    function iv(D) { var c = 0; for (var j = 0; j < slices.length; j++) if (slices[j] > D) c++; return c; }
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
  function veilSteps(rnd) {
    var dark, mid, lite, ink, glia, cv, box, qpx, washes;
    return [
      function veil() {
        dark = new Ink(); mid = new Ink(); lite = new Ink(); ink = new Ink(); glia = new Ink();
        var x, y, j;
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
        box = [-0.72, -1.5, 0.72, -0.5]; qpx = Math.min(1600, H * 1.6 * paintScale) / (box[3] - box[1]); cv = document.createElement('canvas');
        cv.width = Math.ceil((box[2] - box[0]) * qpx); cv.height = Math.ceil((box[3] - box[1]) * qpx);
        washes = [[glia, '#5E6488', 0.3], [lite, '#7E3C56', 0.2], [mid, '#5C2440', 0.2], [ink, '#2A1218', 0.35], [dark, '#3A1424', 0.15]];
      },
      function veilWash() {
        var w = washes[0];
        w.strips = w.strips || strips(w[0].box, qpx);
        wash(cv, w[0].path, w[1], mix(w[1], '#0A0406', 0.5), qpx, box, 0.006, w[2], w[0].box, w.strips.shift());
        if (!w.strips.length) washes.shift();
        return !washes.length;
      },
      function veilFinish() {
        paper(cv, 0.6);
        forest.veil = settle({ z: -0.22, img: cv, box: box });
      }
    ];
  }

  // paint the slices one at a time, so the page stays smooth while they grow
  var stepStats = { n: 0, max: 0, over30: 0, by: {} }, lastStep = null;
  // one small step of painting; a step that is not done yet says so, and is called again
  // (the forest, unless it is let go; then the parts of the way on that are wanted, nearest first; then the cortex's
  // chunks around the camera, nearest first: see keep())
  function paintNext() {
    var Q = forest && forest.steps.length ? forest.steps : wayNext() || cortexNext();
    if (!Q) return false;
    var t0 = performance.now();
    lastStep = Q[0];
    if (lastStep() !== false) Q.shift();
    var dt = performance.now() - t0;
    buildMs += dt; stepStats.n++; stepStats.max = Math.max(stepStats.max, dt); if (dt > 30) stepStats.over30++;
    var key = lastStep.name || 'anon';
    stepStats.by[key] = Math.max(stepStats.by[key] || 0, Math.round(dt));
    return true;
  }
  // Memory: the painted cels are the bulk of it, so only what is near is kept. The forest stays (it is the page's
  // first sight, and painting it again would stall a visitor coming back); each part of the way is painted a little
  // before we reach it and let go once we have left it; the cortex keeps its chunks around the camera and some way ahead.
  function free(it) {
    if (!it || !it.img) return;
    if (it.img.close) it.img.close(); else { it.img.width = 0; it.img.height = 0; }   // let the memory go now, not at the next collection
    it.img = null;
  }
  function keep(u) {
    var more = false;
    way.scenes.forEach(function (sc) {
      var want = u > sc.u0 - (sc.lead || 0.08) && u < sc.u1 + 0.015;   // (the nerve while we are still in the forest's pages)
      if (want && !sc.steps) { sc.steps = sc.make(); more = true; }
      else if (!want && sc.steps) { sc.steps = null; sc.clear(); }
    });
    // (started in the chiasm, just what we arrive into; once there, just behind us and a screen or so ahead)
    var on = u > U_CHIASM - 0.03, wx = cortex.wx = wxAt(clamp(u, U_V1, 1)), ahead = u < U_RISE ? 0.2 : 1.8;
    cortex.planes.forEach(function (pl) {
      var half = A * (pl.D - CZ) * 0.5 + 0.35, a = wx - half - 0.1, b = wx + half + ahead;
      pl.chunks.forEach(function (ch) {
        var want = on && ch.x1 > a && ch.x0 < b;
        if (want && !ch.want && ch.steps.length) more = true;
        ch.want = want;
        if (!want && !ch.fresh) dropChunk(ch);
      });
    });
    if (more) paintSoon();
  }

  paintNext.peek = function () { return !!(forest && forest.steps.length || wayNext() || cortexNext()); };

  // paint in the gaps between frames (one painter at a time, however often the forest is built again)
  var idle = window.requestIdleCallback ? function (f) { requestIdleCallback(f, { timeout: 200 }); } : function (f) { setTimeout(f, 16); };
  var painting = false;
  function paintLater() { if (paintNext()) idle(paintLater); else painting = false; }
  function paintSoon() { if (!painting) { painting = true; setTimeout(paintLater, 60); } }

  // where things are in the forest: the slices, and everything that lives between them
  var queue = [];
  function drawForest(cam, now) {
    // we got here before the slices were painted: paint for a moment each frame, and show them as they come
    if (!forest.veil || forest.planes.length < SLICES.length) for (var t0 = performance.now(); performance.now() - t0 < 12 && paintNext();) ;
    rollC = 1; rollS = 0;
    if (SKIP.indexOf('planes') < 0) drawBackdrop(cam);
    var ref = proj(0, FLOOR, cam.z + 2, cam);
    forest.stream.rf = { x: ref.x, y: ref.y, s: ref.s * 0.6 };
    var T = PT, i;
    queue.length = 0;
    forest.planes.forEach(function (pl) { queue.push({ D: pl.D, k: 0, pl: pl }); });
    forest.riverRuns.forEach(function (r) { queue.push({ D: r.D, k: 1, r: r }); });
    forest.tubeRuns.forEach(function (r) { queue.push({ D: r.D, k: 2, r: r }); });
    forest.rays.forEach(function (r) { queue.push({ D: r.D, k: 3, r: r }); });
    forest.grove.forEach(function (t) { queue.push({ D: t.D, k: 4, t: t }); });
    queue.push({ D: -10, k: 5 });
    queue.sort(function (a, b) { return b.D - a.D; });
    var names = ['slices', 'river', 'river', 'rays', 'trunks', 'veil'];   // the boat is drawn with the river
    for (i = 0; i < queue.length; i++) {
      var it = queue[i];
      if (SKIP.indexOf(names[it.k]) >= 0) continue;
      if (it.k === 0) {
        var den = it.D - cam.z, sw = sway(den);
        if (den < 0.25) continue;
        T.s = H * it.D / den; T.tx = C.x - cam.x * sw; T.ty = C.y - cam.by * F / den - cam.py * sw;
        setT(T.s, T.tx, T.ty);
        drawItems(it.pl.items, T, smooth(0.25, 0.55, den));   // slices we reach just before the end slip away
      } else if (it.k === 1) drawRiverRun(it.r, cam, now, forest.stream);
      else if (it.k === 2) drawTube(it.r, cam, now);
      else if (it.k === 3) drawRay(it.r, cam, now);
      else if (it.k === 4) drawTrunk(it.t, cam, now);
      else {
        var v = forest.veil, vd = v ? v.z - cam.z : 0;
        if (vd > 0.05) {
          var vs = sway(vd);
          T.s = F / vd; T.tx = C.x - cam.x * vs; T.ty = C.y - cam.by * T.s - cam.py * vs;
          setT(T.s, T.tx, T.ty);
          drawItems([v], T, smooth(0.05, 0.12, vd));
        }
      }
    }
  }

  // ---------- the plate ----------
  // Cajal labelled his plates: the layers numbered down a margin, the cells named by abbreviations in the margins,
  // each with a dotted leader to one or two of the cells it names. Here, over the forest: the layers down the left,
  // and down the right a few cells, picked among those in view and followed as we move, so the labels stay put on
  // the glass while the leaders reach into the depth. Drawn in SVG over the canvas, so the type stays sharp.
  var SVGNS = 'http://www.w3.org/2000/svg', plateEl = document.getElementById('plate'), plate = null;
  var KINDS = [['Gc', 'ganglion cell'], ['Ac', 'amacrine cell'], ['Bc', 'bipolar cell'], ['Hc', 'horizontal cell'], ['Mg', 'Müller glia'],
    ['C', 'cones', 2], ['R', 'rods', 2], ['Cap', 'capillary'], ['Rbc', 'red blood cell'], ['S', 'sehn']];
  var LAYERS = [['I', 'ganglion cells', ILM, -0.7], ['II', 'inner plexiform', -0.7, -0.38], ['III', 'inner nuclear', -0.38, 0.1],
    ['IV', 'outer plexiform', 0.1, 0.27], ['V', 'outer nuclear', 0.27, OLM], ['VI', 'rods and cones', OLM, FLOOR]];
  var PLATE_TOP = 84;   // below the site's header
  // Each world has its plate: the forest Plate I, the cortex Plate II. world: the one on show.
  var world = null;
  function addMark(k, m, w) { w = w || forest; (w.markBy[k] = w.markBy[k] || []).push(m); }
  function svgEl(name, cls, parent) {
    var e = document.createElementNS(SVGNS, name);
    if (cls) e.setAttribute('class', cls);
    parent.appendChild(e);
    return e;
  }
  function attr(e, k, v) { if (e['_' + k] !== v) { e['_' + k] = v; e.setAttribute(k, v); } }
  function buildPlate() {
    var narrow = W < 600;   // on a phone, the names alone: there is no room for a legend
    plateEl.textContent = '';
    plate = { kinds: [], layers: [], at: 0, shown: -1, narrow: narrow, world: world };
    world.layers.forEach(function (L) {
      var o = { brk: svgEl('path', 'brk', plateEl), rn: svgEl('text', 'rn', plateEl), nm: narrow ? null : svgEl('text', 'nm', plateEl) };
      o.rn.textContent = L[0] + '.';
      if (o.nm) o.nm.textContent = L[1];
      plate.layers.push(o);
    });
    world.kinds.forEach(function (K) {
      var g = svgEl('g', '', plateEl), o = { k: K[0], n: K[2] || 1, g: g, leads: [], picks: [], qs: [], a: 0, y: -1, w: 0, retry: 0 };
      for (var i = 0; i < o.n; i++) o.leads.push([svgEl('path', 'halo', g), svgEl('path', 'lead', g)]);
      o.text = svgEl('text', 'lab', g);
      if (!narrow) svgEl('tspan', 'ab', o.text).textContent = K[0] + ' ';
      svgEl('tspan', 'nm', o.text).textContent = K[1];
      attr(o.text, 'text-anchor', 'end');
      g.style.opacity = 0;
      plate.kinds.push(o);
    });
  }
  // where a mark is on screen now (cells and the boat move along the river)
  var MP = { x: 0, y: 0, den: 0 };
  function markAt(m, cam, now) {
    var q, at, st = world.stream;
    if ((m.cell || m.boat) && world === cortex && p < 1 + U_REST - 0.06) { MP.den = 0; return MP; }   // the capillary is not on show yet
    if (m.cell) { at = riverAt(st.pts, (m.cell.t + now * 0.000012 * m.cell.v) % 1); q = proj(at[0] + m.cell.off * st.wid, st.Y - 0.005, at[1], cam); }
    else if (m.boat) { at = riverAt(st.pts, st.boat.t); q = proj(at[0], st.Y - 0.03, at[1], cam); }
    else q = proj(m.x, m.Y, m.D, cam);
    MP.x = q.x; MP.y = q.y; MP.den = q.den;
    return MP;
  }
  function inView(q, cam) {
    if (!(q.den > 0.32 && q.x > W * 0.06 && q.x < plate.xMax && q.y > PLATE_TOP + 8 && q.y < plate.floor - 12)) return false;
    if (world !== forest) return !world.covers || !world.covers(q, cam);
    // not behind what is nearer: the blurred frame's trees (only at its sides), or a trunk of the grove
    var x = q.x, y = q.y, den = q.den, df = SLICES[SLICES.length - 1] - cam.z, i, t, dt;
    if (df > 0.3 && den > df && Math.abs(x - C.x) > 0.62 * forest.view * H * SLICES[SLICES.length - 1] / df) return false;
    for (i = 0; i < forest.grove.length; i++) {
      t = forest.grove[i]; dt = t.D - cam.z;
      if (dt < 0.12 || dt > den) continue;
      // a thin fibre from its top, the inner segment (a cone's swelling), then the slim outer segment
      var tp = proj(t.x, 0.235, t.D, cam), top = tp.y, tx = tp.x, is0 = proj(t.x, 0.63, t.D, cam).y, is1 = proj(t.x, 0.8, t.D, cam).y;
      if (y > top && Math.abs(x - tx) < (y > is0 && y < is1 && t.cone ? 0.024 : 0.009) * F / dt) return false;
    }
    return true;
  }
  var FIRST = { S: 0.35, Rbc: 0.6, Cap: 0.8 };   // the boat, its cells and its river are named first
  // the best of a kind in view: near but not too near, in the front slice where nothing else covers it, and
  // towards the right, so the leader stays short; for two, two well apart
  function pick(o, cam, now) {
    var list = world.markBy[o.k] || [], best = [], i, q;
    for (i = 0; i < list.length; i++) {
      q = markAt(list[i], cam, now);
      if (!inView(q, cam)) continue;
      best.push([-Math.abs(Math.log(q.den / 1.3)) + 0.6 * q.x / W + (list[i].D < 2 ? 0.4 : 0), list[i], q.x]);
    }
    best.sort(function (a, b) { return b[0] - a[0]; });
    o.picks = [];
    for (i = 0; i < best.length && o.picks.length < o.n; i++) {
      if (o.picks.length && Math.abs(best[i][2] - o.px) < W * 0.06) continue;
      o.picks.push(best[i][1]); o.px = best[i][2];
    }
    o.la = 0;
  }
  function drawPlate(cam, now) {
    if (!plate || plate.world !== world) buildPlate();
    var show = world === forest ? smooth(P_CUT + 0.07, P_CUT + 0.13, p) * (1 - smooth(1, 1 + U_DARK * 0.6, p)) : smooth(1 + U_V1 - 0.03, 1 + U_V1, p);
    var dt = plate.at ? clamp((now - plate.at) / 1000, 0, 0.1) : 0.016, legendEl = world.legend;
    if (SKIP.indexOf('plate') >= 0) show = 0;
    plate.at = now;
    show = Math.round(show * 100) / 100;
    if (show !== plate.shown) { plate.shown = show; plateEl.style.opacity = show; plateEl.style.visibility = show > 0 ? 'visible' : 'hidden'; }
    if (show <= 0) return;
    var xr = W - 16, maxW = 0, act = [], i, j, o, q, ease = fixedP != null ? 1 : 1 - Math.exp(-dt * 10);
    plate.kinds.forEach(function (o) { if (!o.w) o.w = o.text.getComputedTextLength(); maxW = Math.max(maxW, o.w); });
    plate.xMax = xr - maxW - 36;
    // at the very end the legend's paper comes up from below: the labels stay above it
    plate.floor = legendEl ? Math.min(H, legendEl.getBoundingClientRect().top + H * 0.1) : H;

    // the layers, read at a fixed distance in front of us: they slide up as we go down
    var Dl = cam.z + 2, LY = world.layers;
    plate.layers.forEach(function (o, i) {
      var a = proj(0, LY[i][2], Dl, cam).y + 3, b = proj(0, LY[i][3], Dl, cam).y - 3;
      a = Math.max(a, PLATE_TOP); b = Math.min(b, H - 10);
      var on = b - a > 22, mid = Math.round((a + b) / 2);
      attr(o.brk, 'd', on ? 'M52,' + a.toFixed(1) + 'H44V' + b.toFixed(1) + 'H52' : '');
      attr(o.rn, 'x', 14); attr(o.rn, 'y', mid + 6); attr(o.rn, 'opacity', on ? 1 : 0);
      if (o.nm) { attr(o.nm, 'x', 60); attr(o.nm, 'y', mid + 5); attr(o.nm, 'opacity', on ? 1 : 0); }
    });

    // the cells: keep what is picked while it stays in view, pick again when it leaves (not too often)
    var ready = [];
    plate.kinds.forEach(function (o) {
      var ok = o.picks.length > 0;
      for (j = 0; ok && j < o.picks.length; j++) if (!inView(markAt(o.picks[j], cam, now), cam)) ok = false;
      if (!ok && now >= o.retry) { pick(o, cam, now); o.retry = now + 400; ok = o.picks.length > 0; }
      o.on = false;
      if (!ok) return;
      o.qs.length = 0;
      var ty = 0, x0 = W;
      for (j = 0; j < o.picks.length; j++) { q = markAt(o.picks[j], cam, now); o.qs.push([q.x, q.y]); ty += q.y; x0 = Math.min(x0, q.x); }
      o.ty = ty / o.picks.length + 5;
      o.len = (xr - x0) * (o.a > 0.5 ? 0.7 : 1) * (FIRST[o.k] || 1);   // the ones showing hold on a little, so they do not flicker
      ready.push(o);
    });
    // a few at a time, those with the shortest leaders: a plate, not a tangle
    // (and the one named from the legend, whatever its leader)
    ready.sort(function (a, b) { return (b.k === focusK) - (a.k === focusK) || a.len - b.len; });
    act = world === cortex && p3show > 0.05 ? [] : ready.slice(0, plate.narrow ? 4 : 6);   // while Plate III is drawn, its cells unnamed
    act.forEach(function (o) { o.on = true; });
    plate.kinds.forEach(function (o) { var f = o.k === focusK; if (o.f !== f) { o.f = f; o.g.classList.toggle('is-focus', f); } });
    // down the margin in the order of their cells, never closer than a line apart
    act.sort(function (a, b) { return a.ty - b.ty; });
    var gap = 30, lo = PLATE_TOP + 14, hi = Math.min(H - 64, plate.floor - 14);   // above the flatten switch, and the legend
    for (i = 0; i < act.length; i++) act[i].ty = Math.max(act[i].ty, i ? act[i - 1].ty + gap : lo);
    for (i = act.length - 1; i >= 0; i--) act[i].ty = Math.min(act[i].ty, i < act.length - 1 ? act[i + 1].ty - gap : hi);
    plate.kinds.forEach(function (o) {
      o.a += ((o.on ? 1 : 0) - o.a) * ease;
      o.la = o.on ? o.la + (1 - o.la) * ease : o.la;
      var a = Math.round(o.a * o.la * 100) / 100;
      if (o.g._a !== a) { o.g._a = a; o.g.style.opacity = a; o.g.style.visibility = a > 0 ? 'visible' : 'hidden'; }   // not display: its width is measured
      if (!o.on) return;
      o.y = o.y < 0 ? o.ty : o.y + (o.ty - o.y) * ease;
      attr(o.text, 'x', xr); attr(o.text, 'y', o.y.toFixed(1));
      var sx = (xr - o.w - 8).toFixed(1), sy = (o.y - 5).toFixed(1);
      for (j = 0; j < o.n; j++) {
        var d = j < o.qs.length ? 'M' + sx + ',' + sy + 'L' + o.qs[j][0].toFixed(1) + ',' + o.qs[j][1].toFixed(1) : '';
        attr(o.leads[j][0], 'd', d); attr(o.leads[j][1], 'd', d);
      }
    });
  }
  function hidePlate() {
    if (plate && plate.shown !== 0) { plate.shown = 0; plateEl.style.opacity = 0; plateEl.style.visibility = 'hidden'; }
  }
  // The legends, each at the end of its part of the page: point at a line (tap it, on a phone) and its cell is named
  // in the scene, in plum, even if it was not among the few on show.
  var legends = document.querySelectorAll('.plate-legend'), focusK = null;
  document.querySelectorAll('.plate-legend [data-k]').forEach(function (el) {
    var k = el.getAttribute('data-k');
    function set(on) {
      focusK = on ? k : focusK === k ? null : focusK;
      document.querySelectorAll('.plate-legend [data-k]').forEach(function (e) { e.classList.toggle('is-on', e.getAttribute('data-k') === focusK); });
      if (plate && on) plate.kinds.forEach(function (o) { if (o.k === k) o.retry = 0; });
      poke();
    }
    el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') set(true); });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') set(false); });
    var by = '';   // what pressed it (a click does not say, in every browser)
    el.addEventListener('pointerdown', function (e) { by = e.pointerType; });
    el.addEventListener('click', function () { if (by !== 'mouse') set(focusK !== k); });
    el.addEventListener('focus', function () { set(true); });
    el.addEventListener('blur', function () { set(false); });
  });
  // the labels are measured in their own type, once it has arrived
  if (document.fonts) document.fonts.ready.then(function () { if (plate) plate.kinds.forEach(function (o) { o.w = 0; }); });

  // the light from above, and the roof and the floor as two planes running off into the distance (in strips)
  // The light, the roof and the floor are soft and fill the whole screen, so they are drawn at half resolution
  // into their own canvas, then scaled up onto the stage.
  var back = null, backCtx = null;
  function drawBackdrop(cam, paint) {
    var sc = dpr * 0.5, bw = Math.max(1, Math.round(W * sc)), bh = Math.max(1, Math.round(H * sc));
    if (!back) { back = document.createElement('canvas'); backCtx = back.getContext('2d'); }
    if (back.width !== bw || back.height !== bh) { back.width = bw; back.height = bh; }
    var stage = ctx, full = dpr;
    ctx = backCtx; dpr = sc;
    try { (paint || paintBackdrop)(cam); } finally { ctx = stage; dpr = full; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(back, 0, 0, canvas.width, canvas.height);
  }
  function paintBackdrop(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var hy = C.y - cam.by * F / 200 - cam.py * sway(200), g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#F7E2B0'); g.addColorStop(clamp(hy / H - 0.12, 0, 1), '#E2B678'); g.addColorStop(clamp(hy / H, 0, 1), '#E9BC74'); g.addColorStop(1, '#D9993E');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    plane(cam, ILM, '#EFD3A0', '#DDB57C', TEX.roof, 0.12, 0.14);   // only a hint of cells: the leafy roof in the slices carries it
    plane(cam, FLOOR, '#F2BF45', '#DDB57C', TEX.floor, 0.035, 0.42);
  }
  function plane(cam, Y, nearCol, far, tex, cell, texA) {
    var dy = Y - cam.y, n = 18, i, prev = null, near = Math.max(0.05, Math.abs(dy) * F / (H * 0.62));
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
        var ta = texA * (1 - haze(Dm)), ma = 0.3 * (1 - haze(Dm) * 0.7);   // far off, the haze all but hides them
        ctx.setTransform(dpr, 0, 0, dpr * sq, 0, pm.y * dpr * (1 - sq));
        if (ta > 0.03) {
          ctx.globalAlpha = ta;
          ctx.fillStyle = pattern(ctx, tex, sx, pm.x, pm.y);
          ctx.fillRect(0, pm.y + (y0 - pm.y) / sq, W, (y1 - y0 + 1) / sq);
        }
        // an uneven wash over it, fixed to the ground so it does not swim as we move
        if (ma > 0.12) {
          ctx.globalAlpha = ma;
          ctx.fillStyle = pattern(ctx, TEX.mottle, sx * 9, pm.x, pm.y);
          ctx.fillRect(0, pm.y + (y0 - pm.y) / sq, W, (y1 - y0 + 1) / sq);
        }
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
      c.by = lerp(-0.84, 0, e);
      c.z = lerp(CAM_Z0, 0, e);
      c.deep = 0;
    } else {
      // down among the rods and cones, to the river
      e = easeInOut((pp - P_REST) / (1 - P_REST));
      c.by = lerp(0, 0.8, e);
      c.z = lerp(0, CAM_Z1, e);
      c.deep = e;
    }
    var wf = smooth(P_CUT, P_CUT + 0.06, pp);
    c.x = ptr.x * 0.1 * (1 - 0.6 * c.deep) * wf;   // the sway: x is all sway, y is the path plus its sway
    c.py = ptr.y * 0.035 * (1 - 0.6 * c.deep) * wf;
    c.y = c.by + c.py;
    forest.stream.boat.t = lerp(0.55, 0.27, smooth(P_REST - 0.1, 1, pp));
    return c;
  }

  // ---------- the way on, from the retina to the cortex ----------
  // Planes again, each painted once as a cel, and a camera moving among them: wx and by, where it is across and up or
  // down; z, how far in; x and py, the sway after the pointer (which flattening takes the depth out of). A plane at
  // depth D lies den = D - z in front of it. Retina yellow is left behind with the lake; from the nerve on it is grey.
  var WC = { wx: 0, by: 0, z: 0, x: 0, py: 0, y: 0 };
  function wayCam(wx, by, z) {
    WC.wx = wx; WC.by = by; WC.z = z;
    WC.x = ptr.x * 0.07; WC.py = ptr.y * 0.03; WC.y = WC.by + WC.py;
    return WC;
  }
  // where a plane at depth D goes on screen (into T, for setT and drawItems); returns how far in front of us it is
  function view(D, cam, T) {
    var den = D - cam.z, sw = sway(den);
    T.s = F / den; T.tx = C.x - cam.wx * T.s - cam.x * sw; T.ty = C.y - cam.by * T.s - cam.py * sw;
    return den;
  }
  function cover(col, a) {
    if (!(a > 0)) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = Math.min(1, a); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }
  // we got somewhere before its cels were ready: paint for a moment each frame (they show as they come)
  function ensure(ok) { for (var t0 = performance.now(); !ok() && performance.now() - t0 < 12 && paintNext();) ; }

  // A cel: inks washed onto a canvas over box (world units) at qpx pixels a unit, as steps on a queue. make(qpx) gives
  // the washes, back to front: [ink, colour, dry, edge colour]; done(item) gets the cel.
  function celSteps(box, qpx, make, done, o) {
    o = o || {};
    var cv, list;
    function pin(on) { tint = on ? TEX.cool : null; org[0] = on ? -box[0] * qpx : 0; org[1] = on ? -box[1] * qpx : 0; }
    return [
      function celInk() {
        qpx = Math.min(qpx, 4096 / (box[2] - box[0]), 4096 / (box[3] - box[1]));
        wob = rng(Math.round(box[0] * 977 + box[3] * 131 + qpx)); wobble = 0.3; minInk = 0.7 / qpx;
        list = make(qpx).filter(function (w) { return isFinite(w[0].box[0]); });
        wobble = 0; minInk = 0;
        cv = document.createElement('canvas');
        cv.width = Math.ceil((box[2] - box[0]) * qpx); cv.height = Math.ceil((box[3] - box[1]) * qpx);
      },
      function celWash() {
        var t0 = performance.now();
        pin(true);
        while (list.length && performance.now() - t0 < 6) {
          var w = list[0];
          w.strips = w.strips || strips(w[0].box, qpx);
          wash(cv, w[0].path, w[1], w[3] || mix(w[1], '#16141A', 0.45), qpx, box, o.soft || 0.01, w[2] || 0, w[0].box, w.strips.shift());
          if (!w.strips.length) list.shift();
        }
        pin(false);
        return !list.length;
      },
      function celFinish() {
        pin(true); paper(cv, 0.5); pin(false);
        if (o.blur) {
          var bl = blank(1, cv.width, cv.height), b = bl.getContext('2d');
          b.filter = 'blur(' + o.blur + 'px)'; b.drawImage(cv, 0, 0); b.filter = 'none';
          var o2 = cv.getContext('2d'); o2.clearRect(0, 0, cv.width, cv.height); o2.drawImage(bl, 0, 0);
        }
        done(settle({ img: cv, box: box }));
      }
    ];
  }
  // a cel repeated every cel.per across, as a strip painted one period long is
  var TI = { img: null, box: [0, 0, 0, 0] };
  function drawTiled(cel, D, cam, mult) {
    var T = PT, den = view(D, cam, T);
    if (!cel || den < 0.05) return;
    setT(T.s, T.tx, T.ty);
    var pad = halfDiag, x0 = (-pad - T.tx) / T.s, x1 = (W + pad - T.tx) / T.s, k;
    TI.img = cel.img;
    for (k = Math.floor((x0 - cel.box[2]) / cel.per); k <= Math.ceil((x1 - cel.box[0]) / cel.per); k++) {
      TI.box[0] = cel.box[0] + k * cel.per; TI.box[2] = cel.box[2] + k * cel.per; TI.box[1] = cel.box[1]; TI.box[3] = cel.box[3];
      drawItems([TI], T, mult);
    }
  }

  // ---------- out through the blind spot ----------
  // Out of the roof (another cut in its dark), up over the retina seen from above as on the way down, across to the
  // blind spot, where every one of this eye's fibres goes (they show now, in rose), and down into its pale lake.
  var LC = { x: 0, y: 0, c: ROOF_H, roll: 0 }, LOOK = { e: 1, f: 0.6, dark: 0, fibres: 0 };
  function drawLake(u) {
    var t = clamp((u - U_DARK) / (U_LAKE - U_DARK), 0, 1), up = smooth(0, 0.45, t), go = smooth(0.12, 0.85, t), down = smooth(0.45, 1, t);
    var h = Math.exp(lerp(lerp(Math.log(ROOF_H + 0.004), Math.log(1.9), up), Math.log(0.326), down));
    LC.c = h;
    LC.x = BLIND.x * go + ptr.x * 0.05 * (h - ROOF_H);
    LC.y = BLIND.y * go + ptr.y * 0.04 * (h - ROOF_H);
    LC.roll = reduce ? 0 : lerp(0.6, 0, smooth(0, 0.7, t));   // the spin of the way down, unwinding
    LOOK.f = lerp(0.9, 0.55, up); LOOK.fibres = smooth(0.1, 0.45, t); LOOK.dark = 1 - smooth(0, 0.1, t);
    drawFall(LC, LOOK);
    rollC = 1; rollS = 0;
    cover(MYELIN, smooth(0.88, 1, t));   // into the white of the disc: the fibres put on their myelin behind it
  }

  // ---------- the optic nerve ----------
  // Not a tunnel: a tracking shot alongside it, a cable of fibres, each axon in beads of white myelin with bare gaps
  // between them, at several depths, the nearest big and soft as they rush past. Each depth is a strip, a period long.
  var NERVE = [9, 5.2, 3.1, 1.9, 1.15, 0.5];
  function nerveSteps() {
    var steps = [];
    NERVE.forEach(function (D, i) {
      var near = i === NERVE.length - 1, den = D + 0.12, r = near ? 0.04 : 0.008 + 0.0045 * D, hz = clamp((D - 1.2) / 12, 0, 0.6);
      var per = Math.ceil(A * den * 11) / 10 + 0.4, hh = den * 0.6 + 0.12, box = [0, -hh, per, hh];
      steps.push.apply(steps, celSteps(box, F / den * paintScale * (near ? 0.3 : 0.62), function () {
        var rnd = rng(SEED + 40 + i), sheath = new Ink(), axon = new Ink(), shine = new Ink(), y, k, j;
        for (y = -hh + rnd() * r * 2; y < hh; y += r * (near ? 16 + rnd() * 14 : 3.2 + rnd() * 2.6)) {
          var m = 1 + Math.floor(rnd() * 2), ph = rnd() * TAU, amp = r * (0.4 + rnd() * 1.6), y0 = y, pts = [];
          var at = function (x) { return y0 + amp * Math.sin(x / per * TAU * m + ph); };
          for (k = -6; k <= 66; k++) pts.push([k / 60 * per, at(k / 60 * per), r * 0.24]);
          axon.taper(pts);
          // beads a whole number to the period, so the strip joins up with itself
          var n = Math.max(3, Math.round(per / (r * (9 + rnd() * 5)))), seg = per / n, off = rnd() * seg, gap = Math.min(seg * 0.16, r * 1.3);
          for (j = -1; j <= n; j++) {
            var x0 = off + j * seg + gap / 2, x1 = x0 + seg - gap, bead = [], lit = [];
            for (k = 0; k <= 10; k++) {
              var xx = lerp(x0, x1, k / 10), sw = Math.pow(Math.sin(Math.PI * k / 10), 0.45);   // round at the ends
              bead.push([xx, at(xx), r * (0.08 + 0.92 * sw)]);
              if (k > 1 && k < 9) lit.push([xx, at(xx) - r * 0.38, r * 0.16 * sw]);   // the light along its top: a tube, not a ribbon
            }
            sheath.taper(bead); shine.taper(lit);
          }
        }
        return [[axon, mix(ROSE, CHAZE, hz), 0.2], [sheath, mix('#EFE8E7', CHAZE, hz), 0.15, mix('#6E5E64', CHAZE, hz)], [shine, mix('#FFFFFF', CHAZE, hz), 0.3, '#FFFFFF']];
      }, function (cel) { cel.per = per; way.nerve[i] = cel; }, { blur: near ? 7 : D > 6 ? 1 : 0 }));
    });
    return steps;
  }
  function drawNerve(u) {
    var e = clamp((u - U_LAKE) / (U_NERVE - U_LAKE), 0, 1), cam = wayCam(lerp(0, 4.2, e), 0.04 * Math.sin(e * 3.3), 0);
    ensure(function () { return way.nerve.filter(Boolean).length === NERVE.length; });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#B4AEA9'); g.addColorStop(0.5, '#CBC6C0'); g.addColorStop(1, '#B2ACA6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    NERVE.forEach(function (D, i) { drawTiled(way.nerve[i], D, cam, 1); });
    cover(MYELIN, 1 - smooth(U_LAKE, U_LAKE + 0.01, u));
    cover(CHAZE, smooth(U_NERVE - 0.01, U_NERVE, u));
  }

  // ---------- the chiasm, from above ----------
  // After Cajal's drawing of 1898: the other eye's nerve comes in, teal. The fibres from the inner half of each retina
  // cross to the other side and the outer half stays, so each tract behind it carries both eyes, side by side: each
  // half of the brain gets one half of the world, from both eyes. We ride with the crossing ones. Map units.
  var CHI = { c: [0, 0.2], L: [-3.9, -5], R: [3.9, -5], rose: [-4.9, 4.9], teal: [4.9, 4.9] };   // running on well past anything we see
  function chiasmSteps() {
    var steps = [];
    // the floor under it: the brain's underside, pale, with the ring of arteries around the stalk of the pituitary
    steps.push.apply(steps, celSteps([-6.6, -6, 6.6, 6], F / 3.9 * paintScale * 0.5, function () {
      var rnd = rng(SEED + 61), ground = new Ink(), marks2 = new Ink(), blood = new Ink(), i;
      ground.blob(0, 0, 7.5, 0, 0);   // wider than we ever see
      for (i = 0; i < 420; i++) marks2.dot((rnd() - 0.5) * 13, (rnd() - 0.5) * 12, 0.01 + rnd() * 0.02);
      marks2.blob(0, -0.75, 0.2, Math.PI / 2, 0.3); marks2.blob(-0.24, -1.55, 0.13, 0, 0.2); marks2.blob(0.24, -1.55, 0.13, 0, 0.2);
      var ring = [];
      for (i = 0; i <= 40; i++) { var a = i / 40 * TAU; ring.push([Math.cos(a) * 1.05 + 0.04 * Math.sin(a * 5), -0.7 + Math.sin(a) * 0.95, 0.022]); }
      blood.taper(ring);
      var o = { step: 0.03, wiggle: 0.3, taper: 0.7, spread: 0.6, lenK: 0.7, wK: 0.7, depth: 3, joint: true };
      [[-0.9, 0.0, Math.PI + 0.4], [0.9, 0.0, -0.4], [-0.6, -1.5, Math.PI + 1.2], [0.6, -1.5, -1.2], [0, 0.25, Math.PI / 2]].forEach(function (v) { grow(blood, o, rnd, v[0], v[1], v[2], 1.1, 0.02, 0); });
      return [[ground, '#D6D2CB', 0.15, '#C4BEB6'], [marks2, '#BDB7AF', 0.3], [blood, '#A44A4E', 0.2]];
    }, function (cel) { way.chiasm.ground = cel; }));
    // the nerves, the crossing and the tracts: painted twice, coarse where they are only seen from high up, fine around
    // the crossing and our way out of it, where we come close
    function tract() {
      var rnd = rng(SEED + 60), sheath = new Ink(), inks = { rose: [new Ink(), new Ink()], teal: [new Ink(), new Ink()] }, i;
      [[CHI.rose, CHI.c], [CHI.teal, CHI.c], [CHI.c, CHI.L], [CHI.c, CHI.R]].forEach(function (s) {
        sheath.taper(makeRiver([s[0], [lerp(s[0][0], s[1][0], 0.5) + 0.06, lerp(s[0][1], s[1][1], 0.5) + 0.05], s[1]]).map(function (q) { return [q[0], q[1], 0.16]; }));
      });
      sheath.dot(CHI.c[0], CHI.c[1], 0.27);
      ['rose', 'teal'].forEach(function (eye) {
        var s0 = CHI[eye], dx = CHI.c[0] - s0[0], dy = CHI.c[1] - s0[1], dl = Math.hypot(dx, dy), nx = -dy / dl, ny = dx / dl;
        for (i = 0; i < 46; i++) {
          var o = (i + rnd()) / 46 * 2 - 1, inner = eye === 'rose' ? o * nx > 0 : o * nx < 0;   // the half towards the midline crosses
          var end = (eye === 'rose') === inner ? CHI.R : CHI.L, tx = end[0] - CHI.c[0], ty = end[1] - CHI.c[1], tl = Math.hypot(tx, ty), lat = (rnd() - 0.5) * 0.26;
          var way2 = [[s0[0] + nx * o * 0.12, s0[1] + ny * o * 0.12], [lerp(s0[0], CHI.c[0], 0.4) + nx * o * 0.12, lerp(s0[1], CHI.c[1], 0.4) + ny * o * 0.12],
            [lerp(s0[0], CHI.c[0], 0.8) + nx * o * 0.11, lerp(s0[1], CHI.c[1], 0.8) + ny * o * 0.11], [CHI.c[0] + (rnd() - 0.5) * 0.24, CHI.c[1] + (rnd() - 0.5) * 0.16],
            [CHI.c[0] + tx * 0.25 - ty / tl * lat, CHI.c[1] + ty * 0.25 + tx / tl * lat], [CHI.c[0] + tx * 0.6 - ty / tl * lat * 1.05, CHI.c[1] + ty * 0.6 + tx / tl * lat * 1.05],
            [end[0] - ty / tl * lat * 1.1, end[1] + tx / tl * lat * 1.1]];
          var fp = makeRiver(way2);
          inks[eye][i % 2].taper(fp.map(function (q, j) { return [q[0], q[1], 0.0065 * (1 - 0.3 * Math.abs(j / (fp.length - 1) - 0.5))]; }));
        }
      });
      return [[sheath, '#E9E5DF', 0.1, '#B9B2A9'], [inks.teal[0], TEAL, 0.15], [inks.rose[0], ROSE, 0.15], [inks.teal[1], TEAL, 0.15], [inks.rose[1], ROSE, 0.15]];
    }
    steps.push.apply(steps, celSteps([-4.7, -4.4, 4.7, 4.2], F / 2.8 * paintScale * 0.6, tract, function (cel) { way.chiasm.tract = cel; }));
    steps.push.apply(steps, celSteps([-1.8, -2.5, 2.8, 1.6], F / 1.6 * paintScale * 0.72, tract, function (cel) { way.chiasm.near = cel; }));
    return steps;
  }
  // our path over it: along this eye's nerve, into the crossing, out along the other side's tract
  var CHI_PATH = [[-1.5, 1.6], [-0.75, 0.9], [0, 0.2], [0.6, -0.55], [1.15, -1.3]];
  function drawChiasm(u, now) {
    var e = clamp((u - U_NERVE) / (U_CHIASM - U_NERVE), 0, 1), at = riverAt(way.chiasm.path, e), cam = wayCam(at[0], at[1], lerp(0.4, 1.6, easeInOut(e))), T = PT;
    ensure(function () { return way.chiasm.tract && way.chiasm.ground && way.chiasm.near; });
    rollC = Math.cos(0.12 * (e - 0.5)); rollS = Math.sin(0.12 * (e - 0.5));   // a little turn as we go: the X stays an X, as Cajal drew it
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#CEC9C2'; ctx.fillRect(0, 0, W, H);
    if (view(4.6, cam, T) > 0.05) { setT(T.s, T.tx, T.ty); drawItems([way.chiasm.ground].filter(Boolean), T, 1); }
    if (view(3.2, cam, T) > 0.05) { setT(T.s, T.tx, T.ty); drawItems([way.chiasm.tract, way.chiasm.near].filter(Boolean), T, 1); }
    if (view(2.3, cam, T) > 0.05) { setT(T.s, T.tx, T.ty); drawItems(way.chiasm.motes, T, smooth(0.15, 0.5, 2.3 - cam.z)); }
    rollC = 1; rollS = 0;
    cover(CHAZE, 1 - smooth(U_NERVE, U_NERVE + 0.01, u));
    cover('#17151A', smooth(U_CHIASM - 0.012, U_CHIASM, u));   // the tract dives under, into the dark
  }

  // ---------- up through the LGN, and its radiation ----------
  // Edge on: the lateral geniculate, six layers bent like a knee, the two eyes in alternating bands (this eye's in 1, 4
  // and 6; the lowest two of big cells, for motion, the upper four of small ones, for form and colour). The tract's
  // fibres come in from below and end in their own eye's band; a new fan leaves the top, the optic radiation, and
  // rises to the white matter under the cortex. So do we, with the signals running up the fibres.
  var KNEE = { x: 0, y: 1.3, r0: 0.3, dr: 0.068 }, KNEE_EYE = [1, 0, 0, 1, 0, 1];
  function kneeAt(layer, a) { var r = KNEE.r0 + layer * KNEE.dr; return [KNEE.x + Math.cos(a) * r, KNEE.y + Math.sin(a) * r]; }
  function radiationPath(rnd, spread) {
    var a = lerp(215, 325, rnd()) * Math.PI / 180, s = kneeAt(5.4, a), ex = lerp(-2.3, 2.3, (a * 180 / Math.PI - 215) / 110) * spread + (rnd() - 0.5) * 0.5;
    var pts = [s, [s[0] + Math.cos(a) * 0.25, s[1] + Math.sin(a) * 0.3]];
    if (a < 4.2 && rnd() < 0.6) pts.push([s[0] - 0.55 - rnd() * 0.3, s[1] - 0.15], [s[0] - 0.4, s[1] - 0.75]);   // Meyer's loop: out forward first
    pts.push([lerp(s[0], ex, 0.55), -1.1 + (rnd() - 0.5) * 0.3], [ex, -2.5], [ex + (rnd() - 0.5) * 0.2, -3.4]);
    return makeRiver(pts);
  }
  function riseSteps() {
    var steps = [];
    function white(ink, x0, x1, y) {   // the white matter the radiation runs into: its lower edge uneven
      var P = ink.cur(), n = 60, i;
      P.moveTo(x1, y - 3);
      for (i = 0; i <= n; i++) { var x = lerp(x1, x0, i / n); P.lineTo(x, y + 0.08 * Math.sin(x * 2.3) + 0.04 * Math.sin(x * 7.1)); }
      P.lineTo(x0, y - 3); P.closePath(); ink.fit(x0, y - 3, 0); ink.fit(x1, y + 0.15, 0);
    }
    steps.push.apply(steps, celSteps([-2.5, -3.8, 2.5, 2.7], F / 2 * paintScale * 0.68, function () {
      var rnd = rng(SEED + 70), band = [new Ink(), new Ink()], cells = new Ink(), fin = [new Ink(), new Ink()], rad = new Ink(), wm = new Ink(), i, j;
      for (i = 0; i < 6; i++) {
        var arc = [];
        for (j = 0; j <= 48; j++) { var q = kneeAt(i, lerp(200, 340, j / 48) * Math.PI / 180); arc.push([q[0], q[1], 0.026 * Math.sin(Math.PI * (0.06 + 0.88 * j / 48))]); }
        band[KNEE_EYE[i]].taper(arc);
        for (j = 0; j < (i < 2 ? 34 : 56); j++) { var c = kneeAt(i + (rnd() - 0.5) * 0.5, lerp(203, 337, (j + rnd()) / (i < 2 ? 34 : 56)) * Math.PI / 180); cells.blob(c[0], c[1], i < 2 ? 0.012 : 0.0075, -Math.PI / 2, 0.3); }
      }
      // the tract's fibres, each to a band of its own eye, ending in a little bush
      var bush = { step: 0.008, wiggle: 0.5, taper: 0.4, spread: 0.9, lenK: 0.6, wK: 0.65, depth: 2 };
      for (i = 0; i < 70; i++) {
        var eye = i % 2, layers = [0, 1, 2, 3, 4, 5].filter(function (l) { return KNEE_EYE[l] === eye; }), l = layers[Math.floor(rnd() * layers.length)];
        var a = lerp(212, 328, rnd()) * Math.PI / 180, end = kneeAt(l, a), x0 = (rnd() - 0.5) * 1.6;
        var fp = makeRiver([[x0, 2.8], [x0 * 0.5, 2.1], [KNEE.x + (end[0] - KNEE.x) * 0.3, KNEE.y + 0.15], [KNEE.x + (end[0] - KNEE.x) * 0.8, KNEE.y + (end[1] - KNEE.y) * 0.8], end]);
        fin[eye].taper(fp.map(function (q) { return [q[0], q[1], 0.0034]; }));
        for (j = 0; j < 3; j++) grow(fin[eye], bush, rnd, end[0], end[1], a + (j - 1) * 0.9, 0.035, 0.002, 0);
      }
      // the radiation, out of the top and up into the white
      way.rise.paths = [];
      for (i = 0; i < 130; i++) {
        var rp = radiationPath(rnd, 1);
        rad.taper(rp.map(function (q, k) { return [q[0], q[1], lerp(0.0032, 0.0048, k / (rp.length - 1))]; }));
        if (i % 3 === 0) way.rise.paths.push(rp);
      }
      white(wm, -2.6, 2.6, -2.75);
      return [[band[1], mix(ROSE, '#E2DED8', 0.5), 0.1], [band[0], mix(TEAL, '#E2DED8', 0.5), 0.1], [rad, '#7E7873', 0.3], [fin[0], TEAL, 0.2], [fin[1], ROSE, 0.2],
        [cells, '#45403E', 0.15], [wm, MYELIN, 0.05, '#CFC9C0']];
    }, function (cel) { way.rise.main = cel; }));
    steps.push.apply(steps, celSteps([-5, -6, 5, 4.6], F / 4.5 * paintScale * 0.5, function () {
      var rnd = rng(SEED + 71), rad = new Ink(), wm = new Ink(), i;
      for (i = 0; i < 160; i++) {
        var rp = radiationPath(rnd, 1.9).map(function (q) { return [q[0] * 1.6, q[1] * 1.25 - 0.4, 0.008]; });
        rad.taper(rp);
      }
      white(wm, -5.1, 5.1, -4.1);
      return [[rad, mix('#7E7873', CHAZE, 0.5), 0.3], [wm, MYELIN, 0.05, '#D6D1C9']];
    }, function (cel) { way.rise.far = cel; }));
    steps.push.apply(steps, celSteps([-1.7, -3.8, 1.7, 2.7], F / 1.15 * paintScale * 0.3, function () {
      var rnd = rng(SEED + 72), rad = new Ink(), i;
      for (i = 0; i < 9; i++) {
        var x = lerp(-1.5, 1.5, (i + rnd()) / 9), rp = makeRiver([[x + 0.2, 2.8], [x, 1], [x + (rnd() - 0.5) * 0.4, -0.8], [x * 1.3, -2.4], [x * 1.4, -3.8]]);
        rad.taper(rp.map(function (q) { return [q[0], q[1], 0.012]; }));
      }
      return [[rad, '#8A847E', 0.2]];
    }, function (cel) { way.rise.near = cel; }, { blur: 4 }));
    return steps;
  }
  function drawRise(u, now) {
    var e = clamp((u - U_CHIASM) / (U_RISE - U_CHIASM), 0, 1), cam = wayCam(lerp(0, 0.25, e), lerp(1.55, -3.05, easeInOut(e)), 0), T = PT, i;
    var R = way.rise;
    ensure(function () { return R.main && R.far && R.near; });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix('#D9D5CF', MYELIN, smooth(0.5, 1, e))); g.addColorStop(1, '#C3BEB7');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    [[4.5, R.far], [2, R.main]].forEach(function (pl) { if (pl[1] && view(pl[0], cam, T) > 0.05) { setT(T.s, T.tx, T.ty); drawItems([pl[1]], T, 1); } });
    // the signals, rising along the fibres
    if (!reduce && R.paths) {
      view(2, cam, T); setT(T.s, T.tx, T.ty);
      ctx.fillStyle = 'rgba(255,250,240,.9)';
      for (i = 0; i < R.paths.length; i++) {
        var pth = R.paths[i], f = ((now * 0.00012 * (0.8 + (i % 5) * 0.12) + i * 0.137) % 1) * (pth.length - 1), q = pth[Math.floor(f)];
        ctx.beginPath(); ctx.arc(q[0], q[1], 0.007, 0, TAU); ctx.fill();
      }
    }
    if (R.near && view(1.15, cam, T) > 0.05) { setT(T.s, T.tx, T.ty); drawItems([R.near], T, 1); }
    cover('#17151A', 1 - smooth(U_CHIASM, U_CHIASM + 0.008, u));
    cover(MYELIN, smooth(U_RISE - 0.014, U_RISE, u));   // into the white matter
  }

  function buildWay() {
    var rnd = rng(SEED + 59), motes = new Ink(), i, k;
    way = { nerve: [], chiasm: { path: makeRiver(CHI_PATH) }, rise: {} };
    way.scenes = [
      { u0: U_LAKE, u1: U_NERVE, lead: 0.25, make: nerveSteps, steps: null, clear: function () { way.nerve.forEach(free); way.nerve = []; } },
      { u0: U_NERVE, u1: U_CHIASM, make: chiasmSteps, steps: null, clear: function () { free(way.chiasm.ground); free(way.chiasm.tract); free(way.chiasm.near); way.chiasm.ground = way.chiasm.tract = way.chiasm.near = null; } },
      { u0: U_CHIASM, u1: U_RISE, make: riseSteps, steps: null, clear: function () { free(way.rise.main); free(way.rise.far); free(way.rise.near); way.rise = {}; } }
    ];
    // loose strands drifting just under us over the chiasm
    for (i = 0; i < 26; i++) {
      var x = (rnd() - 0.5) * 6, y = (rnd() - 0.5) * 6, a = rnd() * TAU, pts = [];
      for (k = 0; k <= 16; k++) { a += (rnd() - 0.5) * 0.5; x += Math.cos(a) * 0.02; y += Math.sin(a) * 0.02; pts.push([x, y, 0.0025]); }
      motes.taper(pts);
    }
    way.chiasm.motes = [{ path: motes.path, fill: 'rgba(90,84,80,.3)', box: motes.box }];
  }
  function wayNext() {
    for (var i = 0; way && i < way.scenes.length; i++) if (way.scenes[i].steps && way.scenes[i].steps.length) return way.scenes[i].steps;
    return null;
  }
  function drawWay(u, now) {
    if (u < U_LAKE) drawLake(u);
    else if (u < U_NERVE) drawNerve(u);
    else if (u < U_CHIASM) drawChiasm(u, now);
    else drawRise(u, now);
  }

  // ---------- the visual cortex ----------
  // The retina was a warm, tropical forest; the cortex is a birch wood in snow. Its pyramidal cells are the birches:
  // white trunks with dark marks, bare dark twigs (Cajal's black ink), a little snow caught in their crowns; the white
  // matter is the snow they stand in, its astrocytes frost stars, and the stripe of Gennari a band of mist. Edge on, in
  // world units: the pia on top, Cajal's layers I to VI, then the white matter. Its areas lie along the sheet, and the
  // camera tracks along it while the page's second half goes by over it. V1 first: the fibres from the LGN end in
  // layer IV, still in alternating columns for the two eyes, and the mist hangs in it, stopping where V2 begins. V2,
  // the same wood larger, its horizontal fibres longer. Then V4, larger still, where colour is seen: it fills in, as
  // golden leaves, from where it starts until the shape it is in holds it, as a wash does. At rest, down by a
  // capillary running red through the snow, the little eye comes back. Each depth is a long strip of cels, painted in
  // chunks in the order the camera reaches them.
  var PIA = -0.9, L_II = -0.78, L_IV = -0.3, L_IVC = -0.12, L_V = 0.14, L_VI = 0.44, WM = 0.8;
  var V2_AT = 2.2, V4_AT = 4.9, CX_END = 7.6, CZ = -0.4, CPLANES = [14, 8, 4.8, 3, 2, 1.3];
  var CX_AT = [[U_V1, 0], [U_V2, 2.5], [U_C0, 2.75], [U_C1, 2.95], [U_V4, 5.3], [U_REST, 6.9], [1, 7.3]];   // all but still while the circuit is drawn
  var KINDS_C = [['Pyr', 'pyramidal cell'], ['St', 'stellate cell'], ['CR', 'Cajal–Retzius cell'], ['Lgn', 'fibre from the LGN', 2], ['G', 'stripe of Gennari'],
    ['Ax', 'horizontal axon'], ['Ast', 'astrocyte'], ['Cap', 'capillary'], ['Rbc', 'red blood cell'], ['S', 'sehn']];
  var LAYERS_C = [['I', 'molecular', PIA, L_II], ['II–III', 'pyramidal', L_II, L_IV], ['IV', 'granular', L_IV, L_V], ['V', 'inner pyramidal', L_V, L_VI], ['VI', 'multiform', L_VI, WM]];
  function scaleAt(x) { return x < V2_AT ? 1 : x < V4_AT ? 1.35 : 1.75; }
  // and how old the wood is: V1 young and slender, close together; V2 old, its birches thick and black-fissured; V4 grown
  function ageAt(x) { return x < V2_AT ? 0.55 : x < V4_AT ? 1.6 : 1.15; }

  // A pyramidal cell, the cortex's birch: a triangular body, its apical dendrite a white trunk with dark marks up to a
  // crown of bare twigs in layer I, a skirt of basal dendrites like roots, an axon down into the snow. Snow is caught
  // in its twigs; in V4 the same places hold leaves, for the colour to fill.
  var OBL = { step: 0.012, wiggle: 0.35, taper: 0.4, spread: 0.7, lenK: 0.6, wK: 0.65, depth: 1 };
  function pyramidal(g, rnd, x, y, top, sc, lod, big) {
    var age = ageAt(x), w = (big ? 0.014 : 0.0092) * sc * age, r = (big ? 0.017 : 0.011) * sc, lean = (rnd() - 0.5) * 0.03 * (0.6 + age * 0.6), n = 14, pts = [], i;
    sc *= 0.75 + 0.25 * age;   // older, the crowns and roots spread wider
    var lr = rnd(), leaf = lr < 0.45 ? g.leafA : lr < 0.85 ? g.leafB : g.leafC, v4 = x > V4_AT;
    for (i = 0; i <= n; i++) {
      var t = i / n, yy = lerp(y - r, top, t), xx = x + lean * t + Math.sin(t * 5 + x * 13) * 0.004 * sc;
      pts.push([xx, yy, w * (1 - 0.55 * t)]);
      if (lod && i > 2 && i < n - 1 && rnd() < 0.22) {
        grow(g.ink, OBL, rnd, xx, yy, -Math.PI / 2 + (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 0.5), (0.04 + rnd() * 0.05) * sc, w * 0.25, 0);
        g.marks.blob(xx, yy, w * 0.55, 0, 0.6);   // the dark eye where a branch leaves a birch
      }
    }
    g.bark.taper(pts);
    // the birch's marks: dark dashes across the white, closer and heavier towards its foot (few on a young one; an old one
    // fissured black in diamonds, and black all round its foot)
    for (var yy2 = y - r - 0.01 * sc; yy2 > top + 0.02; yy2 -= (0.018 + rnd() * 0.03) * sc * (0.6 + 0.6 * (y - yy2) / (y - top)) / Math.min(1.4, age)) {
      var tt = (y - r - yy2) / (y - r - top), mx = x + lean * tt + Math.sin(tt * 5 + x * 13) * 0.004 * sc, mw = w * (1 - 0.55 * tt);
      if (age < 1 && rnd() < 0.45) continue;
      g.marks.taper([[mx - mw * (0.3 + rnd() * 0.7), yy2, 0.0008 * sc], [mx + mw * (rnd() - 0.3), yy2 + 0.002, 0.0016 * sc * age], [mx + mw * (0.4 + rnd() * 0.6), yy2 + (rnd() - 0.5) * 0.004, 0.0006 * sc]]);
      if (age > 1.2 && tt < 0.6 && rnd() < 0.35) g.marks.blob(mx + (rnd() - 0.5) * mw, yy2, mw * (0.35 + rnd() * 0.3), Math.PI / 2, 0.9);   // a black diamond
    }
    var foot = 0.03 * sc * age * age;
    g.marks.taper([[x - w * 0.9, y - r * 0.6, w * 0.25], [x, y - r - foot, w * 0.5], [x + w * 0.9, y - r * 0.4, w * 0.25]]);   // dark at the foot
    var tx = pts[n][0], tuft = { step: 0.012 * sc, wiggle: 0.4, taper: 0.4, spread: 0.8, lenK: 0.6, wK: 0.65, depth: 1 + lod, pullK: 0.08,
      leafInk: leaf, leaf: v4 ? 0.95 : lod ? 0.3 : 0.15, leafR: (v4 ? 0.0085 : 0.0055) * sc };
    for (i = 0; i < 3 + lod; i++) {
      tuft.pull = i % 2 ? -0.15 : Math.PI + 0.15;
      grow(g.ink, tuft, rnd, tx, top, -Math.PI / 2 + (i % 2 ? 1 : -1) * (0.4 + rnd() * 0.6), (0.06 + rnd() * 0.07) * sc, w * 0.22, 0);
    }
    var bas = { step: 0.01 * sc, wiggle: 0.45, taper: 0.4, spread: 0.7, lenK: 0.6, wK: 0.65, depth: 1 + lod, spine: lod > 1 ? 0.2 : 0, spineLen: 0.006 * sc,
      leafInk: leaf, leaf: v4 ? 0.6 : lod ? 0.08 : 0, leafR: (v4 ? 0.0075 : 0.005) * sc };
    for (i = 0; i < 4 + lod; i++) grow(g.ink, bas, rnd, x + (i / (3 + lod) - 0.5) * r * 1.4, y + r * 0.4, Math.PI / 2 + (i / (3 + lod) - 0.5) * 2.4, (0.05 + rnd() * 0.06) * sc * (big ? 1.4 : 1), w * 0.24, 0);
    if (rnd() < 0.5) g.thin.taper([[x, y + r * 0.6, w * 0.16], [x + (rnd() - 0.5) * 0.05, lerp(y, WM, 0.5), w * 0.12], [x + (rnd() - 0.5) * 0.1, WM + 0.06, 0]]);
    g.soma.blob(x, y, r, -Math.PI / 2, 0.9);
    if (v4 && g.seeds) g.seeds.push([tx, top + 0.03, 0.17 * sc], [x, y + 0.08, 0.12 * sc]);
    mark('Pyr', x, y);
  }
  // a stellate cell of layer IV: a star of short, spiny dendrites
  function stellate(g, rnd, x, y, sc, lod) {
    var o = { step: 0.008 * sc, wiggle: 0.6, taper: 0.4, spread: 0.9, lenK: 0.55, wK: 0.6, depth: 1 + (lod > 1 ? 1 : 0), spine: lod > 1 ? 0.35 : 0.1, spineLen: 0.005 * sc };
    for (var i = 0; i < 7; i++) grow(g.ink, o, rnd, x, y, i / 7 * TAU + rnd() * 0.5, (0.03 + rnd() * 0.03) * sc, 0.0026 * sc, 0);
    g.soma.dot(x, y, 0.008 * sc);
    mark('St', x, y);
  }
  // a fibre from the LGN: up out of the white matter into layer IV, where it spreads into a dense bush
  function lgnFibre(g, rnd, x, lod, ink) {
    var top = lerp(L_IVC, L_V, 0.25 + rnd() * 0.4), pts = [], i;
    for (i = 0; i <= 14; i++) { var t = i / 14; pts.push([x + Math.sin(t * 4 + x * 7) * 0.03 + Math.sin(t * 11 + x * 3) * 0.012, lerp(WM + 0.7, top, t), 0.0022]); }
    ink.taper(pts);
    var o = { step: 0.008, wiggle: 0.55, taper: 0.4, spread: 1, lenK: 0.6, wK: 0.7, depth: 2 + (lod > 1 ? 1 : 0), inside: function (xx, yy) { return yy > L_IVC - 0.07 && yy < L_V + 0.03; } };
    for (i = 0; i < 4; i++) grow(ink, o, rnd, x, top, -Math.PI / 2 + (i - 1.5) * 0.8, 0.05 + rnd() * 0.05, 0.0018, 0);
    mark('Lgn', x, top);
  }
  // a Cajal–Retzius cell of layer I: long processes running along it, little branches up to the pia
  function cajalRetzius(g, rnd, x, sc) {
    var y = -0.845 + (rnd() - 0.5) * 0.02;
    [-1, 1].forEach(function (s) {
      var L = (0.25 + rnd() * 0.25) * sc, pts = [], i;
      for (i = 0; i <= 16; i++) {
        var t = i / 16, xx = x + s * L * t, yy = y + Math.sin(t * 6 + x * 5) * 0.008;
        pts.push([xx, yy, 0.0028 * (1 - 0.7 * t)]);
        if (i % 4 === 2) g.ink.taper([[xx, yy, 0.0012], [xx + s * 0.01, yy - 0.035, 0]]);
      }
      g.ink.taper(pts);
    });
    g.soma.blob(x, y, 0.009 * sc, 0, 0.8);
    mark('CR', x, y);
  }
  // an astrocyte: a bushy star of glia, a frost star in the wood, in the cool ink of the retina's Müller cells
  function astrocyte(g, rnd, x, y, sc) {
    var o = { step: 0.007 * sc, wiggle: 0.7, taper: 0.5, spread: 0.8, lenK: 0.5, wK: 0.6, depth: 1 };
    for (var i = 0; i < 12; i++) grow(g.glia, o, rnd, x, y, i / 12 * TAU + rnd() * 0.4, (0.025 + rnd() * 0.03) * sc, 0.0022 * sc, 0);
    g.glia.dot(x, y, 0.007 * sc);
    mark('Ast', x, y);
  }
  // an arteriole diving down from the pia, its capillaries winding off it, and an astrocyte's foot on it
  function vessel(g, rnd, x, sc, lod) {
    var bottom = lerp(L_V, WM - 0.1, rnd()), pts = [], i, o = { step: 0.012, wiggle: 0.5, taper: 0.85, spread: 0.9, lenK: 0.7, wK: 0.8, depth: 1 + lod, joint: true };
    for (i = 0; i <= 20; i++) { var t = i / 20; pts.push([x + Math.sin(t * 7 + x * 3) * 0.02, lerp(PIA - 0.05, bottom, t), 0.0065 * (1 - 0.5 * t)]); }
    g.blood.taper(pts);
    for (i = 3; i < 20; i += 3 + Math.floor(rnd() * 3)) grow(g.blood, o, rnd, pts[i][0], pts[i][1], (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.8, 0.08 + rnd() * 0.08, 0.0022, 0);
    if (lod) {
      var q = pts[8 + Math.floor(rnd() * 8)], ax = q[0] + 0.07 * (rnd() < 0.5 ? -1 : 1), ay = q[1] + (rnd() - 0.5) * 0.06;
      astrocyte(g, rnd, ax, ay, sc * 0.9);
      g.glia.taper([[ax, ay, 0.0026], [lerp(ax, q[0], 0.6), lerp(ay, q[1], 0.6) - 0.01, 0.002], [q[0], q[1], 0.003]]);
      g.glia.blob(q[0], q[1], 0.008, Math.atan2(q[1] - ay, q[0] - ax), 0.4);   // the end-foot
    }
    mark('Cap', pts[12][0], pts[12][1]);
  }
  // long horizontal axons in layers II and III, linking clusters of cells that see the same orientation: the fibres
  // along which, in Grossberg's models, boundaries are completed across gaps
  function vine(g, rnd, a, b, lod) {
    var mx = (a[0] + b[0]) / 2, i;
    for (i = 0; i < 1 + lod; i++) {
      var sag = (rnd() - 0.4) * 0.08, fp = makeRiver([[a[0], a[1] + (rnd() - 0.5) * 0.02], [lerp(a[0], mx, 0.6), lerp(a[1], (a[1] + b[1]) / 2, 0.6) + sag],
        [lerp(mx, b[0], 0.4), lerp((a[1] + b[1]) / 2, b[1], 0.4) + sag], [b[0], b[1] + (rnd() - 0.5) * 0.02]]);
      g.vine.taper(fp.map(function (q) { return [q[0], q[1], 0.0017]; }));
    }
    var o = { step: 0.008, wiggle: 0.6, taper: 0.4, spread: 0.9, lenK: 0.6, wK: 0.6, depth: 1 + (lod > 1 ? 1 : 0) };
    [a, b].forEach(function (c) { for (var j = 0; j < 3; j++) grow(g.vine, o, rnd, c[0], c[1], rnd() * TAU, 0.03 + rnd() * 0.03, 0.0014, 0); });
    mark('Ax', mx, (a[1] + b[1]) / 2);
  }

  // what runs on along a plane, drawn the same in every chunk: the pia and its vessels, the mat of fibres in layer I,
  // the stripe of Gennari in V1 (the band of mist), the white matter (the snow)
  function bands(g, pl, x0, x1) {
    var xa = x0 - 0.06, xb = x1 + 0.06, n = Math.ceil((xb - xa) / 0.012), i, j, x, pts, P;
    function line(ink, fy, w) { pts = []; for (i = 0; i <= n; i++) { x = lerp(xa, xb, i / n); pts.push([x, fy(x), typeof w === 'function' ? w(x) : w]); } ink.taper(pts); }
    // short strokes along a course, where they fall decided by the place itself, so every chunk agrees
    function dashes(ink, k, fy, w, len) {
      var x = Math.floor(xa / len) * len, m;
      for (; x < xb; x += len) {
        var hsh = Math.sin(x * 127.1 + k * 311.7) * 43758.5453, f = hsh - Math.floor(hsh), a = x + f * len * 0.5, b = a + len * (0.4 + 0.9 * f);
        if (f < 0.25) continue;
        pts = [];
        for (m = 0; m <= 8; m++) { var xx = lerp(a, b, m / 8); pts.push([xx, fy(xx) + Math.sin(xx * 31 + k) * 0.004, w * Math.sin(Math.PI * (0.1 + 0.8 * m / 8))]); }
        ink.taper(pts);
      }
    }
    line(g.pia, function (x) { return PIA + 0.006 * Math.sin(x * 9.1) + 0.004 * Math.sin(x * 23.7); }, 0.008);
    [[PIA - 0.07, 0.011, 3.3, 1], [PIA - 0.14, 0.007, 5.1, 2.2]].forEach(function (v) { line(g.blood, function (x) { return v[0] + 0.025 * Math.sin(x * v[2] + v[3]); }, v[1]); });
    for (j = 0; j < (pl.lod ? 12 : 5); j++) {
      var ph = j * 2.39 + pl.D, f = 3 + (j % 5) * 1.7, y0 = lerp(-0.885, -0.8, (j + 0.5) / 12);
      dashes(g.mat, j, function (x) { return y0 + 0.012 * Math.sin(x * f + ph) + 0.007 * Math.sin(x * f * 2.7 + ph * 1.3); }, 0.0018, 0.22 + (j % 3) * 0.08);
    }
    if (xa < V2_AT + 0.1) {
      var end = function (x) { return smooth(V2_AT + 0.02, V2_AT - 0.1, x + 0.03 * Math.sin(x * 37)); };
      line(g.gen, function (x) { return -0.205 + 0.006 * Math.sin(x * 4.3); }, function (x) { return 0.03 * end(x); });
      for (j = 0; j < 7; j++) {
        var gy = -0.228 + j * 0.0078, gp = j * 1.7;
        line(g.genf, function (x) { return gy + 0.004 * Math.sin(x * 7 + gp); }, function (x) { return 0.0012 * end(x - 0.02 * j); });
      }
      for (x = Math.ceil(xa / 0.6) * 0.6; x < Math.min(xb, V2_AT - 0.2); x += 0.6) mark('G', x, -0.205);
    }
    P = g.wm.cur(); P.moveTo(xb, WM + 1.3);
    for (i = 0; i <= n; i++) { x = lerp(xb, xa, i / n); P.lineTo(x, WM + 0.012 * Math.sin(x * 6.1) + 0.006 * Math.sin(x * 17.3)); }
    P.lineTo(xa, WM + 1.3); P.closePath(); g.wm.fit(xa, WM - 0.02, 0); g.wm.fit(xb, WM + 1.3, 0);
    for (j = 0; j < (pl.lod ? 14 : 6); j++) {
      var wy = WM + 0.05 + j * 0.06, wp = j * 1.3;
      dashes(g.wmf, j + 40, function (x) { return wy + 0.02 * Math.sin(x * 2.1 + wp) + 0.008 * Math.sin(x * 5.3 + wp); }, 0.0035, 0.3 + (j % 4) * 0.1);
    }
  }

  function buildCortex() {
    var rnd = rng(SEED + 100), view2 = A / 2;
    cortex = { planes: [], steps: [], markBy: {}, kinds: KINDS_C, layers: LAYERS_C, legend: legends[1] || legends[legends.length - 1], chunks: [] };
    CPLANES.forEach(function (D, pi) {
      var den = D - CZ, frame = pi === CPLANES.length - 1, lod = frame ? 1 : D < 3.5 ? 2 : D < 9 ? 1 : 0, x, i, j;
      var hw = view2 * den + 0.35, x0 = -hw, x1 = CX_END + hw;
      var pl = { D: D, lod: lod, frame: frame, items: [], chunks: [], qpx: F / den * paintScale * (frame ? 0.45 : D > 6 ? 0.72 : 0.8) };
      function add(cx, reach, draw) { pl.items.push({ x0: cx - reach, x1: cx + reach, seed: (rnd() * 1e9) | 0, draw: draw }); }
      // the trees: layer V's big pyramids, II and III's smaller ones, VI's (their trunks only up to IV)
      for (x = x0; x < x1; x += 0.42 * scaleAt(x) * (0.55 + 0.45 * ageAt(x)) * (frame ? 3.5 : 1) * (0.45 + rnd() * 1.1)) add(x, 0.44 * scaleAt(x), P5(x, lerp(L_V, L_VI, 0.3 + rnd() * 0.3), scaleAt(x), lod, PIA + 0.03, true));
      for (x = x0; x < x1; x += (frame ? 1.1 : lod > 1 ? 0.24 : lod ? 0.3 : 0.45) * scaleAt(x) * (0.55 + 0.45 * ageAt(x)) * (0.45 + rnd() * 1.1)) add(x, 0.34 * scaleAt(x), P5(x, lerp(L_II + 0.12, L_IV - 0.06, rnd()), scaleAt(x), lod, PIA + 0.03, false));
      if (!frame) {
        for (x = x0; x < x1; x += 0.55 * scaleAt(x) * (0.45 + rnd() * 1.1)) add(x, 0.2 * scaleAt(x), P5(x, lerp(L_VI + 0.08, WM - 0.1, rnd()), scaleAt(x), lod, L_IV, false));
        if (lod) for (x = x0; x < x1; x += (x < V2_AT ? 0.11 : 0.3 * scaleAt(x)) * (0.7 + rnd() * 0.6)) add(x, 0.08, ST(x, lerp(L_IVC + 0.03, L_V - 0.03, rnd()), scaleAt(x), lod));
        if (lod) for (x = x0; x < V2_AT - 0.05; x += 0.2 * (0.6 + rnd() * 0.8)) add(x, 0.14, LG(x, lod, Math.floor((x + 50) / 0.42) % 2 ? 'lgnR' : 'lgnT'));
        if (lod) for (x = x0; x < x1; x += 0.9 * scaleAt(x) * (0.7 + rnd() * 0.6)) add(x, 0.6 * scaleAt(x), CR(x, scaleAt(x)));
        if (lod) for (x = x0; x < x1; x += 0.5 * scaleAt(x) * (0.7 + rnd() * 0.6)) add(x, 0.1, AS(x, lerp(-0.7, 0.7, rnd()), scaleAt(x)));
        for (x = x0; x < x1; x += 0.8 * scaleAt(x) * (0.7 + rnd() * 0.6)) add(x, 0.3, VS(x, scaleAt(x), lod));
        // the horizontal axons: clusters further apart in each area, linked by long fibres
        var cl = [];
        for (x = x0; x < x1; x += 0.75 * scaleAt(x) * (0.8 + rnd() * 0.4)) cl.push([x, lerp(-0.62, -0.44, rnd())]);
        for (i = 0; i < cl.length - 1; i++) for (j = 1; j <= (lod ? 2 : 1) && i + j < cl.length; j++) {
          if (j > 1 && rnd() < 0.5) continue;
          add((cl[i][0] + cl[i + j][0]) / 2, Math.abs(cl[i + j][0] - cl[i][0]) / 2 + 0.1, VN(cl[i], cl[i + j], lod));
        }
      }
      // chunks, each at most about 1800 pixels across
      var cw = Math.min(1000 / pl.qpx, x1 - x0), n = Math.ceil((x1 - x0) / cw);   // (small enough to keep only those near us)
      for (i = 0; i < n; i++) {
        var ch = { pl: pl, x0: x0 + i * cw, x1: x0 + (i + 1) * cw, cel: null, col: null, want: false, fresh: true, marks: null };
        ch.steps = chunkSteps(pl, ch);
        pl.chunks.push(ch); cortex.chunks.push(ch);
      }
      cortex.planes.push(pl);
    });
    // painted in the order the camera reaches them, near ones first where they start together
    cortex.chunks.sort(function (a, b) { return Math.max(a.x0, -1) - Math.max(b.x0, -1) || a.pl.D - b.pl.D; });

    // the capillary in the bottom layer, winding off into the distance, single file, and the boat coming back on it
    var cap = makeRiver([[7.95, -0.25], [7.85, 0.25], [7.75, 0.6], [7.55, 0.95], [7.25, 1.25],   // from past us on the right, where it runs off the screen
       [7.05, 1.7], [7.45, 2.4], [7.7, 3.3], [7.15, 4.8], [6.75, 7.2], [7.4, 10.5], [7.9, 15], [7.3, 22]]), cells = [];
    for (var i = 0; i < 26; i++) cells.push({ t: (i + rnd() * 0.5) / 26, v: 0.9 + rnd() * 0.2, off: (rnd() - 0.5) * 0.2, d: rnd() * 0.3, ph: rnd() * TAU, spin: 0.5 + rnd(), rot: (rnd() - 0.5) * 0.6, size: 0.9 + rnd() * 0.2 });
    cortex.stream = { pts: cap, Y: WM, wid: 0.042, cells: cells, boat: { t: 0.9 }, rf: null, banks: true, cellK: 1.25, boatK: 0.7 };
    cortex.runs = split(cap.map(function (r) { return r[1]; }), CPLANES);
    cortex.snow = [];
    for (i = 0; i < 140; i++) cortex.snow.push({ D: lerp(0.9, 7, Math.pow(rnd(), 1.6)), x: rnd() * 40, y: rnd() * 20, v: 0.05 + rnd() * 0.06, w: 0.4 + rnd() * 0.6, ph: rnd() * TAU, r: 0.0022 + rnd() * 0.0018 });
    // what the plate may name that is not painted into the chunks (theirs come and go with them: see marks3)
    cortex.fixed = [];
    for (i = 0; i < cap.length; i += 4) cortex.fixed.push(['Cap', { x: cap[i][0], Y: WM, D: cap[i][1] }]);
    cells.forEach(function (c) { cortex.fixed.push(['Rbc', { cell: c }]); });
    cortex.fixed.push(['S', { boat: true }]);
    cortex.dirty = true;
  }
  // (each tree's drawing, kept for every chunk it reaches into)
  function P5(x, y, sc, lod, top, big) { return function (g, r) { pyramidal(g, r, x, y, top, sc, lod, big); }; }
  function ST(x, y, sc, lod) { return function (g, r) { stellate(g, r, x, y, sc, lod); }; }
  function LG(x, lod, ink) { return function (g, r) { lgnFibre(g, r, x, lod, g[ink]); }; }
  function CR(x, sc) { return function (g, r) { cajalRetzius(g, r, x, sc); }; }
  function AS(x, y, sc) { return function (g, r) { astrocyte(g, r, x, y, sc); }; }
  function VS(x, sc, lod) { return function (g, r) { vessel(g, r, x, sc, lod); }; }
  function VN(a, b, lod) { return function (g, r) { vine(g, r, a, b, lod); }; }

  // A chunk of a plane: lay out its inks, wash them one at a time, then finish (and in V4, a second cel of colour)
  function chunkSteps(pl, ch) {
    var S = {};
    function pin(on) { tint = on ? TEX.cool : null; org[0] = on ? -S.box[0] * S.qpx : 0; org[1] = on ? -S.box[1] * S.qpx : 0; }
    // the brush's state is shared, and another chunk may be painted between two steps of this one
    function inking(on) { wob = S.wob; wobble = on ? 0.32 : 0; minInk = on ? 0.7 / S.qpx : 0; marks = on ? S.marks : null; }
    return [
      function chunkInk() {
        S.g = { pia: new Ink(), blood: new Ink(), mat: new Ink(), gen: new Ink(), genf: new Ink(), wm: new Ink(), wmf: new Ink(), vine: new Ink(), glia: new Ink(),
          lgnR: new Ink(), lgnT: new Ink(), thin: new Ink(), ink: new Ink(), bark: new Ink(), marks: new Ink(), leafA: new Ink(), leafB: new Ink(), leafC: new Ink(), soma: new Ink(),
          seeds: ch.x1 > V4_AT ? [] : null };
        S.box = [ch.x0, PIA - 0.22, ch.x1, WM + 1.25];
        S.qpx = Math.min(pl.qpx, 4096 / (S.box[3] - S.box[1]));
        S.marks = []; S.wob = rng(Math.round(ch.x0 * 1000 + pl.D * 77));
        S.items = pl.items.filter(function (it) { return it.x1 >= ch.x0 - 0.02 && it.x0 <= ch.x1 + 0.02; });
        inking(true); bands(S.g, pl, ch.x0, ch.x1); inking(false);
      },
      // the trees, a few at a time (a chunk holds hundreds)
      function chunkTrees() {
        var t0 = performance.now();
        inking(true);
        while (S.items.length && performance.now() - t0 < 12) { var it = S.items.shift(); it.draw(S.g, rng(it.seed)); }
        inking(false);
        return !S.items.length;
      },
      function chunkPrepare() {
        var g = S.g;
        S.marks = S.marks.filter(function (m) { return m.x >= ch.x0 && m.x < ch.x1; });
        var hz = haze(pl.D) * 0.8;
        function c(col) { return mix(col, CHAZE, hz); }
        var snow = c('#FAF9F6'), snowEdge = c('#A9AFBB');
        S.washes = [[g.wm, snow, 0.06, snowEdge], [g.wmf, c('#D5D8DE'), 0.3], [g.pia, c('#B4AFA9'), 0.2], [g.blood, c('#A3474C'), 0.25],
          [g.gen, c('#FBFAF8'), 0.02, c('#DADCE0')], [g.genf, c('#E2E4E8'), 0.3], [g.mat, c('#6A6560'), 0.3], [g.vine, c('#4E4845'), 0.35], [g.glia, c('#8E9AB2'), 0.3],
          [g.lgnT, c(TEAL), 0.3], [g.lgnR, c(ROSE), 0.3], [g.thin, c('#6E6864'), 0.4], [g.ink, c('#3A3431'), 0.4],
          [g.bark, c('#F2EFEA'), 0.12, c('#4A4542')], [g.marks, c('#2A2624'), 0.3], [g.soma, c('#2E2A28'), 0.2],
          [g.leafA, snow, 0.1, snowEdge], [g.leafB, snow, 0.1, snowEdge], [g.leafC, snow, 0.1, snowEdge]].filter(function (w) { return isFinite(w[0].box[0]); });
        // in V4 the snow in the crowns is leaves, gold and rose and the odd green, for the colour to fill
        if (g.seeds && g.seeds.length) S.colour = [[g.leafA, '#D69A34', 0.15], [g.leafB, '#E6C45E', 0.15], [g.leafC, '#C9707E', 0.15]].filter(function (w) { return isFinite(w[0].box[0]); });
        S.cv = document.createElement('canvas');
        S.cv.width = Math.ceil((S.box[2] - S.box[0]) * S.qpx); S.cv.height = Math.ceil((S.box[3] - S.box[1]) * S.qpx);
        if (S.colour && S.colour.length) { S.cc = document.createElement('canvas'); S.cc.width = S.cv.width; S.cc.height = S.cv.height; }
      },
      function chunkWash() {
        var t0 = performance.now();
        pin(true);
        while ((S.washes.length || S.colour && S.colour.length) && performance.now() - t0 < 6) {
          var list = S.washes.length ? S.washes : S.colour, out = S.washes.length ? S.cv : S.cc, w = list[0];
          w.strips = w.strips || strips(w[0].box, S.qpx);
          wash(out, w[0].path, w[1], w[3] || mix(w[1], '#16141A', 0.45), S.qpx, S.box, pl.frame ? 0.02 : w[0] === S.g.gen ? 0.03 : 0.008, w[2], w[0].box, w.strips.shift());
          if (!w.strips.length) list.shift();
        }
        pin(false);
        return !(S.washes.length || S.colour && S.colour.length);
      },
      function chunkFinish() {
        pin(true); paper(S.cv, 0.5); pin(false);
        if (pl.frame) {
          var bl = blank(1, S.cv.width, S.cv.height), b = bl.getContext('2d');
          b.filter = 'blur(1.6px)'; b.drawImage(S.cv, 0, 0); b.filter = 'none';
          var o2 = S.cv.getContext('2d'); o2.clearRect(0, 0, S.cv.width, S.cv.height); o2.drawImage(bl, 0, 0);
        }
        ch.cel = settle({ img: S.cv, box: S.box });
        if (S.cc) ch.col = { img: S.cc, box: S.box, w: S.cv.width, h: S.cv.height, qpx: S.qpx, u: -1,
          seeds: S.g.seeds.map(function (s) { return [s[0], s[1], s[2], U_V4 - 0.05 + (s[0] - V4_AT) * 0.045 + Math.random() * 0.03]; }) };
        ch.marks = !pl.frame && pl.D < 5 ? S.marks.map(function (m) { return [m.k, { x: m.x, Y: m.y, D: pl.D }]; }) : [];
        cortex.dirty = true;
        S = {};
      }
    ];
  }
  // paint a chunk: a step at a time from the queue, or all of it now (n = Infinity) when the camera needs it
  function paintChunk(ch, n) {
    ch.fresh = false;
    while (ch.steps.length && n-- > 0) if (ch.steps[0]() !== false) ch.steps.shift();
    return !ch.steps.length;
  }
  // the next chunk to paint: of those wanted, the one nearest where the camera is (a little ahead counts as near)
  function cortexNext() {
    if (!cortex) return null;
    var best = null, bk = Infinity, wx = cortex.wx || 0;
    cortex.chunks.forEach(function (ch) {
      if (!ch.want || !ch.steps.length) return;
      var k = Math.max(0, ch.x0 - wx) + Math.max(0, wx - ch.x1) * 1.5 + ch.pl.D * 0.01;
      if (k < bk) { bk = k; best = ch; }
    });
    return best ? [function chunk() { return paintChunk(best, 1); }] : null;   // (a queue of one, for paintNext)
  }
  function dropChunk(ch) {
    free(ch.cel); if (ch.col) { free(ch.col); free(ch.col.rev); }
    ch.cel = ch.col = null; ch.marks = null; ch.fresh = true;
    ch.steps = chunkSteps(ch.pl, ch);
    cortex.dirty = true;
  }
  // the cortex's marks, gathered from the chunks painted now
  function marks3() {
    if (!cortex.dirty) return;
    cortex.dirty = false;
    var by = cortex.markBy = {};
    function put(km) { (by[km[0]] = by[km[0]] || []).push(km[1]); }
    cortex.fixed.forEach(put);
    cortex.chunks.forEach(function (ch) { if (ch.marks) ch.marks.forEach(put); });
  }

  // the colour of V4, filling in: from each place it starts it spreads out, until the shape it is in holds it
  function drawColour(ch, T, u) {
    var c = ch.col, all = true, any = false, i, s, t;
    for (i = 0; i < c.seeds.length; i++) { t = (u - c.seeds[i][3]) / 0.05; if (t < 1) all = false; if (t > 0) any = true; }
    if (!any) return;
    if (all || reduce) { drawItems([c], T, 1); return; }
    if (Math.abs(c.u - u) > 0.0018) {   // (soft colour, slowly spreading: a third of the resolution, and not every frame)
      c.u = u;
      var w = Math.ceil(c.w / 3), h = Math.ceil(c.h / 3), rc = c.rev || (c.rev = { img: document.createElement('canvas'), box: c.box }), g = rc.img.getContext('2d'), k = c.qpx / 3;
      if (rc.img.width !== w || rc.img.height !== h) { rc.img.width = w; rc.img.height = h; } else g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      for (i = 0; i < c.seeds.length; i++) {
        s = c.seeds[i]; t = clamp((u - s[3]) / 0.05, 0, 1);
        if (t <= 0) continue;
        var px = (s[0] - c.box[0]) * k, py = (s[1] - c.box[1]) * k, r = s[2] * k * easeInOut(t) + 1, gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, '#000'); gr.addColorStop(0.75, 'rgba(0,0,0,.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = 'source-in';
      g.drawImage(c.img, 0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    drawItems([c.rev], T, 1);
  }

  // the banks of the capillary: its wall of endothelial cells, sealed by tight junctions, standing up along each side,
  // as rocks along a stream in snow. A few rocks are painted once, each its own lumpy shape, shadowed below, most with
  // snow on top; along the banks they are set turned and stretched, pebbles to the odd boulder.
  function hash(n) { var h = Math.sin(n * 12.9898) * 43758.5453; return h - Math.floor(h); }
  var ROCKS = null;
  function makeRocks() {
    var rnd = rng(SEED + 120);
    ROCKS = [];
    for (var k = 0; k < 10; k++) ROCKS.push(texCanvas(96, 64, function (g) {
      var P = [], m = 9, j, path = new Path2D();
      for (j = 0; j < m; j++) {
        var a = j / m * TAU, rr = 0.78 + 0.3 * rnd(), sa = Math.sin(a) * (Math.sin(a) > 0 ? 0.72 : 1);
        P.push([48 + Math.cos(a) * 42 * rr, 36 + sa * 26 * rr]);
      }
      path.moveTo((P[m - 1][0] + P[0][0]) / 2, (P[m - 1][1] + P[0][1]) / 2);
      for (j = 0; j < m; j++) { var q = P[(j + 1) % m]; path.quadraticCurveTo(P[j][0], P[j][1], (P[j][0] + q[0]) / 2, (P[j][1] + q[1]) / 2); }
      g.fillStyle = ['#8E8A86', '#7F7B78', '#9A9691'][k % 3]; g.fill(path);
      g.save(); g.clip(path);
      g.globalAlpha = 0.3; g.fillStyle = pattern(g, TEX.mottleCool, 0.6, k * 17, k * 5); g.fillRect(0, 0, 96, 64); g.globalAlpha = 1;
      g.fillStyle = 'rgba(46,48,60,.38)'; g.beginPath(); g.ellipse(56, 54, 46, 22, 0, 0, TAU); g.fill();   // its shadowed side
      if (k % 5) { g.fillStyle = '#FBFAF7'; g.beginPath(); g.ellipse(44 + rnd() * 8, 14 + rnd() * 6, 30 + rnd() * 10, 13 + rnd() * 5, (rnd() - 0.5) * 0.3, 0, TAU); g.fill(); }   // snow
      g.restore();
      g.strokeStyle = 'rgba(48,46,48,.75)'; g.lineWidth = 2.2; g.stroke(path);
    }));
  }
  function drawBanks(sc, n) {
    if (!ROCKS) makeRocks();
    var side, i, c, prev;
    for (side = -1; side <= 1; side += 2) {
      prev = null;
      for (i = 0; i < n; i++) {
        c = sc[i];
        var f = hash(i * 7.1 + side * 3.3), g2 = hash(i * 3.7 + side * 9.1), bx = c[0] + c[3] * side * (1.12 + 0.12 * g2), by = c[1] + c[4] * side * (1.12 + 0.12 * g2);
        var h = Math.max(1, c[2] * (0.3 + 0.35 * f) * (g2 > 0.8 ? 1.8 : 1));   // pebbles, stones, the odd boulder
        if (prev && Math.hypot(bx - prev[0], by - prev[1]) < h * (1.1 + 0.9 * g2)) continue;
        var ang = prev ? Math.atan2(by - prev[1], bx - prev[0]) : 0, len = h * (1.3 + 0.9 * f), cs = Math.cos(ang) * dpr, sn = Math.sin(ang) * dpr;
        if (Math.abs(ang) > Math.PI / 2) { cs = -cs; sn = -sn; }   // the snow stays on top
        ctx.setTransform(cs, sn, -sn, cs, bx * dpr, (by - h * 0.5) * dpr);
        ctx.drawImage(ROCKS[Math.floor(hash(i * 1.3 + side) * ROCKS.length)], -len * 0.6, -h * 0.7, len * 1.2, h * 1.3);
        prev = [bx, by];
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var CC = { wx: 0, by: 0, z: CZ, x: 0, py: 0, y: 0 };
  // where along the sheet the camera is at u
  function wxAt(u) {
    if (u <= U_V1) return 0;
    for (var i = 1; i < CX_AT.length - 1 && u > CX_AT[i][0]; i++);
    return lerp(CX_AT[i - 1][1], CX_AT[i][1], clamp((u - CX_AT[i - 1][0]) / (CX_AT[i][0] - CX_AT[i - 1][0]), 0, 1));
  }
  function cortexCam(u) {
    var c = CC, i;
    c.by = lerp(1.55, 0, easeInOut(clamp((u - U_RISE) / (U_V1 - U_RISE), 0, 1)));   // up out of the white matter
    c.wx = wxAt(u);
    var r = smooth(U_REST - 0.04, 1, u);   // at rest: down by the capillary in the bottom layer
    c.by += 0.55 * r; c.z = CZ + 0.45 * r;
    c.x = ptr.x * 0.08 * (1 - 0.5 * r); c.py = ptr.y * 0.03 * (1 - 0.5 * r); c.y = c.by + c.py;
    cortex.stream.boat.t = lerp(0.85, 0.26, smooth(U_REST - 0.02, 1, u));   // rowing towards us, stopping in view
    return c;
  }
  function paintCortexBack(cam) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var hy = C.y - cam.by * F / 200 - cam.py * sway(200), h = clamp(hy / H, 0, 1), g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#BFC1C4'); g.addColorStop(clamp(h - 0.1, 0, 1), '#D0D1D2'); g.addColorStop(h, '#DCDCDB'); g.addColorStop(1, '#F1F0EC');   // a winter sky
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    plane(cam, PIA, '#CCCBCA', CHAZE, TEX.pia, 0.1, 0.3);
    if (cam.by > WM) plane(cam, WM, '#B9B6B2', CHAZE, TEX.wm, 0.06, 0.25);   // from inside the white matter, the cortex's underside
    else plane(cam, WM, '#F6F5F1', CHAZE, TEX.wm, 0.06, 0.18);   // the snow
  }
  function drawCortex(cam, now, u) {
    rollC = 1; rollS = 0;
    marks3();
    if (SKIP.indexOf('planes') < 0) drawBackdrop(cam, paintCortexBack);
    var ref = proj(cam.wx, WM, cam.z + 2, cam), T = PT, i, t0 = performance.now();
    cortex.stream.rf = { x: ref.x, y: ref.y, s: ref.s * 0.6 };
    queue.length = 0;
    cortex.planes.forEach(function (pl) { queue.push({ D: pl.D, k: 0, pl: pl }); });
    if (u > U_REST - 0.08 && SKIP.indexOf('river') < 0) cortex.runs.forEach(function (r) { queue.push({ D: r.D, k: 1, r: r }); });
    queue.sort(function (a, b) { return b.D - a.D; });
    for (i = 0; i < queue.length; i++) {
      var it = queue[i];
      if (it.k === 1) { drawRiverRun(it.r, cam, now, cortex.stream); continue; }
      if (SKIP.indexOf('slices') >= 0) continue;
      var den = view(it.pl.D, cam, T);
      if (den < 0.25) continue;
      var xa = (-60 - T.tx) / T.s, xb = (W + 60 - T.tx) / T.s, a = smooth(0.25, 0.55, den);
      it.pl.chunks.forEach(function (ch) {
        if (ch.x1 < xa || ch.x0 > xb) return;
        while (!ch.cel && performance.now() - t0 < 12) paintChunk(ch, 1);   // we got here before it was painted: a moment's painting a frame
        if (!ch.cel) return;
        setT(T.s, T.tx, T.ty);
        drawItems([ch.cel], T, a);
        if (ch.col) drawColour(ch, T, u);
      });
    }
    drawResonance(cam, now, u);
    drawSnow(cam, now);
  }
  // snow, falling slowly through the wood, near and far
  function drawSnow(cam, now) {
    if (reduce || SKIP.indexOf('snow') >= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    var fl = cortex.snow, i, f, t = now / 1000;
    for (i = 0; i < fl.length; i++) {
      f = fl[i];
      var den = f.D - cam.z;
      if (den < 0.3) continue;
      // each flake has a copy every k across: draw the one nearest us, so it passes by as we track along
      var span = den * 1.4, k = A * den * 1.2, y = ((f.y + t * f.v) % span + span) % span - span / 2 + cam.by, bx = f.x + Math.sin(t * f.w + f.ph) * 0.03 * den, x = bx + Math.round((cam.wx - bx) / k) * k;
      var q = proj(x, y, f.D, cam), r = Math.max(0.6, f.r * F / den);
      if (q.x < -5 || q.x > W + 5 || q.y < -5 || q.y > H + 5) continue;
      ctx.globalAlpha = 0.55 + 0.35 * smooth(6, 1, den);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Plate III: the circuit, after Grossberg ----------
  // In a pause in the page, over the old wood of V2, his laminar circuit is drawn in as we scroll, a connection at a
  // time, on cells that are really there: a, input from below to layers IV and VI; b, VI's on-centre, off-surround onto
  // IV; c, IV up to II–III; d, the bipole, two cells far apart that see the same line completing a boundary inward onto
  // a cell between them (and one alone held back, two against one); e, the folded feedback, down from II–III to VI;
  // f, on to V4. Then in V4, g: a surface filling in, outward, until its boundary holds it. His notation: arrows excite,
  // round ends inhibit, the bipole's receptive field a figure of eight.
  var plate3El = document.getElementById('plate3'), P3 = null, p3show = 0;
  var CIRCUIT = { a: [0, 0.13], b: [0.13, 0.28], c: [0.28, 0.38], d: [0.38, 0.62], e: [0.62, 0.77], f: [0.77, 0.9] };
  var P3_LABELS = { a: 'input, from below', b: 'on-centre, off-surround', c: 'up to II–III', d: 'bipole: a boundary completes inward', e: 'folded feedback',
    f: 'on to V4', g: 'filling-in, outward, until a boundary holds it' };
  function buildPlate3() {
    plate3El.textContent = '';
    P3 = { els: {}, shown: -1, pick: null, seed: null };
    'abcdefg'.split('').forEach(function (k) {
      var g = svgEl('g', '', plate3El), e = { g: g, strokes: [], text: svgEl('text', 'lab', g), a: -1 };
      svgEl('tspan', 'k', e.text).textContent = k + '. ';
      svgEl('tspan', '', e.text).textContent = P3_LABELS[k];
      P3.els[k] = e;
    });
    P3.title = svgEl('text', 'ttl', plate3El);
    P3.title.textContent = 'Pl. III, after S. Grossberg';
  }
  // the i-th stroke of an element: a halo and a line, drawn on as it goes (pathLength 1), and its end
  function stroke3(e, i, cls, end) {
    var s = e.strokes[i];
    if (!s) {
      s = e.strokes[i] = { halo: svgEl('path', 'halo3', e.g), line: svgEl('path', cls, e.g), end: end ? svgEl(end === 'head' ? 'path' : 'circle', end, e.g) : null };
      if (cls !== 'rf') [s.halo, s.line].forEach(function (q) { q.setAttribute('pathLength', 1); q.setAttribute('stroke-dasharray', '1 1'); });   // (a dotted line keeps its own lengths)
      e.g.appendChild(e.text);   // the label over its lines
    }
    return s;
  }
  // a gently bowed stroke from a to b (they stop short of the cells they join), drawn on to f
  function curve3(s, a, b, bow, f, pad) {
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    pad = pad == null ? 9 : pad;
    var ax = a.x + ux * pad, ay = a.y + uy * pad, bx = b.x - ux * pad, by = b.y - uy * pad, cx = (ax + bx) / 2 - uy * bow, cy = (ay + by) / 2 + ux * bow;
    var d = 'M' + ax.toFixed(1) + ',' + ay.toFixed(1) + 'Q' + cx.toFixed(1) + ',' + cy.toFixed(1) + ' ' + bx.toFixed(1) + ',' + by.toFixed(1), off = (1 - f).toFixed(3);
    attr(s.halo, 'd', d); attr(s.line, 'd', d); attr(s.halo, 'stroke-dashoffset', off); attr(s.line, 'stroke-dashoffset', off);
    if (!s.end) return;
    attr(s.end, 'opacity', f > 0.97 ? 1 : 0);
    if (s.end.tagName === 'circle') { attr(s.end, 'cx', bx.toFixed(1)); attr(s.end, 'cy', by.toFixed(1)); attr(s.end, 'r', 4.5); return; }
    var an = Math.atan2(by - cy, bx - cx), c = Math.cos(an), sn = Math.sin(an);
    attr(s.end, 'd', 'M' + (bx + c * 3).toFixed(1) + ',' + (by + sn * 3).toFixed(1) + 'L' + (bx - c * 10 - sn * 5).toFixed(1) + ',' + (by - sn * 10 + c * 5).toFixed(1) +
      'L' + (bx - c * 10 + sn * 5).toFixed(1) + ',' + (by - sn * 10 - c * 5).toFixed(1) + 'Z');
  }
  function label3(e, x, y, f) {
    var a = Math.round(smooth(0.45, 1, f) * 100) / 100;
    attr(e.text, 'x', x.toFixed(1)); attr(e.text, 'y', y.toFixed(1)); attr(e.text, 'opacity', a);
  }
  // the cells it is drawn on: in the nearest plane that names its cells, around a II–III pyramid a little left of middle
  function nearest3(k, x, y0, y1, D, not) {
    var best = null, bd = 1e9;
    (cortex.markBy[k] || []).forEach(function (m) {
      if (m.D !== D || m.Y < y0 || m.Y > y1 || m === not) return;
      var d = Math.abs(m.x - x);
      if (d < bd) { bd = d; best = m; }
    });
    return best;
  }
  function pick3(cam) {
    // centred on where the camera will be when it is half drawn (it is still drifting along when it starts)
    var D = 2, den = D - cam.z, xc = wxAt(U_C0 + (U_C1 - U_C0) * 0.6) - 0.03 * W * den / F, span = Math.min(0.75 * scaleAt(xc), 0.34 * W * den / F);
    var P = nearest3('Pyr', xc, L_II, L_IV, D) || { x: xc, Y: -0.5, D: D };
    return {
      P: P, D: D,
      S: nearest3('St', P.x + 0.04, L_IV, L_V + 0.05, D) || { x: P.x + 0.05, Y: 0, D: D },
      V6: nearest3('Pyr', P.x - 0.06, L_VI, WM, D) || { x: P.x - 0.06, Y: 0.62, D: D },
      L: nearest3('Pyr', P.x - span, L_II, L_IV, D, P) || { x: P.x - span, Y: -0.5, D: D },
      R: nearest3('Pyr', P.x + span, L_II, L_IV, D, P) || { x: P.x + span, Y: -0.5, D: D }
    };
  }
  function at3(m, cam, dy) { var q = proj(m.x, m.Y + (dy || 0), m.D, cam); return { x: q.x, y: q.y }; }
  function hidePlate3() { if (P3 && P3.shown !== 0) { P3.shown = 0; plate3El.style.opacity = 0; plate3El.style.visibility = 'hidden'; } p3show = 0; }

  function drawPlate3(cam, now, u) {
    if (!P3) buildPlate3();
    var s1 = circuitEl ? smooth(U_C0 - 0.006, U_C0 + 0.008, u) * (1 - smooth(U_C1 + 0.05, U_V4 - 0.03, u)) : 0;
    var s3 = resEl ? smooth(U_R0 - 0.01, U_R0 + 0.005, u) * (1 - smooth(U_R1 + 0.01, U_R1 + 0.04, u)) : 0;
    var s2 = smooth(U_V4, U_V4 + 0.02, u) * (1 - smooth(U_REST - 0.05, U_REST - 0.02, u)) * (1 - s3);
    var show = Math.round(Math.max(s1, s2, s3) * 100) / 100;
    labelsRes();
    if (SKIP.indexOf('plate') >= 0) show = 0;
    p3show = Math.max(s1, s3);
    if (show !== P3.shown) { P3.shown = show; plate3El.style.opacity = show; plate3El.style.visibility = show > 0 ? 'visible' : 'hidden'; }
    'abcdefg'.split('').forEach(function (k) { var e = P3.els[k], f = k === focusK; if (e.f !== f) { e.f = f; e.g.classList.toggle('is-focus', f); } });
    attr(P3.title, 'x', 14); attr(P3.title, 'y', (H - 24).toFixed(0)); attr(P3.title, 'opacity', show);
    if (show <= 0) { P3.pick = null; P3.seed = null; return; }

    // the circuit, over V2
    var t = reduce ? 1 : clamp((u - U_C0) / (U_C1 - U_C0), 0, 1), E = P3.els;
    if (s1 > 0) {
      var m = P3.pick || (P3.pick = pick3(cam));
      var P = at3(m.P, cam), S = at3(m.S, cam), V6 = at3(m.V6, cam), L = at3(m.L, cam), R = at3(m.R, cam), D = m.D, k = F / (D - cam.z);
      var bottom = Math.min(H + 20, at3(m.S, cam, WM + 0.45 - m.S.Y).y), wing = 0.2 * k, sF = function (key) { var r = CIRCUIT[key]; return clamp((t - r[0]) / (r[1] - r[0]), 0, 1); };
      var f;
      f = sF('a');
      curve3(stroke3(E.a, 0, 'ex', 'head'), { x: S.x - 14, y: bottom }, S, 12, f, 0);
      curve3(stroke3(E.a, 1, 'ex', 'head'), { x: V6.x + 22, y: bottom }, V6, -10, f, 0);
      label3(E.a, S.x + 18, lerp(S.y, bottom, 0.62), f);
      f = sF('b');
      curve3(stroke3(E.b, 0, 'ex', 'head'), V6, S, -0.25 * Math.abs(V6.y - S.y), f);
      curve3(stroke3(E.b, 1, 'inh', 'disc'), V6, { x: S.x - wing, y: S.y + 4 }, -18, f);
      curve3(stroke3(E.b, 2, 'inh', 'disc'), V6, { x: S.x + wing, y: S.y + 4 }, 18, f);
      label3(E.b, S.x + wing + 12, S.y + 26, f);
      f = sF('c');
      curve3(stroke3(E.c, 0, 'ex', 'head'), S, P, 0.18 * Math.abs(S.y - P.y), f);
      label3(E.c, Math.max(S.x, P.x) + 16, lerp(S.y, P.y, 0.45), f);
      f = sF('d');
      curve3(stroke3(E.d, 0, 'ex', 'head'), L, P, -0.12 * Math.abs(P.x - L.x), f);
      curve3(stroke3(E.d, 1, 'ex', 'head'), R, P, 0.12 * Math.abs(R.x - P.x), f);
      var I = { x: P.x, y: P.y + 0.09 * k };   // the small inhibitory cell under it: two against one
      curve3(stroke3(E.d, 2, 'inh', 'disc'), I, P, 0, f, 3);
      var rf = stroke3(E.d, 3, 'rf', null), rxL = Math.max(8, (P.x - L.x) / 2 * 0.92), rxR = Math.max(8, (R.x - P.x) / 2 * 0.92), ry = 0.07 * k;
      var lobes = 'M' + P.x.toFixed(1) + ',' + P.y.toFixed(1) + 'A' + rxL.toFixed(1) + ',' + ry.toFixed(1) + ' 0 1 0 ' + (P.x - 2 * rxL).toFixed(1) + ',' + P.y.toFixed(1) +
        'A' + rxL.toFixed(1) + ',' + ry.toFixed(1) + ' 0 1 0 ' + P.x.toFixed(1) + ',' + P.y.toFixed(1) +
        'M' + P.x.toFixed(1) + ',' + P.y.toFixed(1) + 'A' + rxR.toFixed(1) + ',' + ry.toFixed(1) + ' 0 1 1 ' + (P.x + 2 * rxR).toFixed(1) + ',' + P.y.toFixed(1) +
        'A' + rxR.toFixed(1) + ',' + ry.toFixed(1) + ' 0 1 1 ' + P.x.toFixed(1) + ',' + P.y.toFixed(1);
      attr(rf.line, 'd', lobes); attr(rf.halo, 'd', ''); attr(rf.line, 'opacity', smooth(0.3, 0.8, f));
      label3(E.d, P.x - 2 * rxL + 6, P.y - ry - 12, f);
      f = sF('e');
      curve3(stroke3(E.e, 0, 'ex', 'head'), P, V6, 0.45 * Math.abs(V6.y - P.y), f);   // round by the left, down through V
      label3(E.e, Math.min(P.x, V6.x) - 0.3 * Math.abs(V6.y - P.y) - 100, lerp(P.y, V6.y, 0.55), f);
      f = sF('f');
      var out = { x: Math.min(W - 40, P.x + 0.32 * W), y: Math.max(PLATE_TOP + 30, P.y - 0.24 * H) };
      curve3(stroke3(E.f, 0, 'ex', 'head'), P, out, -40, f);
      label3(E.f, out.x - 70, out.y - 12, f);
    }
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function (k2) { attr(E[k2].g, 'opacity', s1 > 0 ? 1 : 0); });

    // filling-in, in V4: around a crown whose colour is filling in now, outward from inside, held by its boundary
    attr(E.g.g, 'opacity', s2 > 0 ? 1 : 0);
    if (s2 > 0) {
      var sd = P3.seed;
      if (!sd || (u - sd[3]) / 0.05 > 1.4) {
        sd = null;
        var bestD = 1e9;
        cortex.planes.forEach(function (pl) {
          if (pl.D !== 2 && pl.D !== 3) return;
          pl.chunks.forEach(function (ch) {
            if (!ch.col) return;
            ch.col.seeds.forEach(function (q) {
              var tt = (u - q[3]) / 0.05;
              if (tt < 0.02 || tt > 0.7) return;
              var pr = proj(q[0], q[1], pl.D, cam), dd = Math.hypot(pr.x - 0.62 * W, pr.y - 0.4 * H);
              if (pr.x > 60 && pr.x < W - 60 && pr.y > PLATE_TOP + 40 && dd < bestD) { bestD = dd; sd = [q[0], q[1], q[2], q[3], pl.D]; }
            });
          });
        });
        P3.seed = sd;
      }
      if (sd) {
        var c0 = proj(sd[0], sd[1], sd[4], cam), cx0 = c0.x, cy0 = c0.y, rr = sd[2] * F / (sd[4] - cam.z), tf = clamp((u - sd[3]) / 0.05, 0, 1), i;
        var ring = stroke3(E.g, 0, 'rf', null);
        attr(ring.line, 'd', 'M' + (cx0 + rr).toFixed(1) + ',' + cy0.toFixed(1) + 'A' + rr.toFixed(1) + ',' + rr.toFixed(1) + ' 0 1 1 ' + (cx0 - rr).toFixed(1) + ',' + cy0.toFixed(1) +
          'A' + rr.toFixed(1) + ',' + rr.toFixed(1) + ' 0 1 1 ' + (cx0 + rr).toFixed(1) + ',' + cy0.toFixed(1));
        attr(ring.halo, 'd', ''); attr(ring.line, 'opacity', 1);
        for (i = 0; i < 6; i++) {
          var an = i / 6 * TAU + 0.3, r0 = rr * 0.12, r1 = rr * (0.2 + 0.62 * easeInOut(tf));
          curve3(stroke3(E.g, 1 + i, 'ex', 'head'), { x: cx0 + Math.cos(an) * r0, y: cy0 + Math.sin(an) * r0 }, { x: cx0 + Math.cos(an) * r1, y: cy0 + Math.sin(an) * r1 }, 0, 1, 0);
        }
        label3(E.g, cx0 + rr + 10, cy0 - rr * 0.6, 1);
      } else attr(E.g.g, 'opacity', 0);
    }
  }

  // ---------- Plate III, ART: adaptive resonance ----------
  // Where the page has a pause for it (#resonance), in the golden wood of V4: Grossberg's Adaptive Resonance Theory, the
  // heart of it. What the eye brings rises from below, up the trunks of the birches it lights; what is expected comes
  // down from above, from a category already learned. A first guess does not fit: the match fails, the guess is reset,
  // and the search goes on. The next fits: where what rises and what descends agree, those trees ring together, the
  // others quiet (the matching rule's off-surround; an expectation alone only primes, two against one); and only
  // there, in resonance, is anything learned, which is why nothing old is forgotten.
  var resEl = document.getElementById('resonance'), circuitEl = document.getElementById('circuit');
  var U_R0 = 0.72, U_R1 = 0.86;
  if (resEl) CX_AT = [[U_V1, 0], [U_V2, 2.5], [0.66, 4.6], [U_R0, 5.5], [U_R1, 5.8], [U_REST, 6.9], [1, 7.3]];   // all but still while it plays
  var R_BU = [1, 2, 4, 5], R_A = [0, 3, 6], R_B = [1, 2, 4, 6];   // which of seven trees: what rises, a wrong guess, the right one
  var RES = { picks: null };
  function resT(u) { return clamp((u - U_R0) / (U_R1 - U_R0), 0, 1); }
  function pickRes(cam) {
    var D = 2, den = D - cam.z, list = (cortex.markBy.Pyr || []).filter(function (m) { return m.D === D && m.Y > L_V && m.Y < L_VI; }), out = [];
    var x0 = cam.wx + (0.1 * W - C.x) * den / F, x1 = cam.wx + (0.9 * W - C.x) * den / F, step = (x1 - x0) / 7;
    for (var i = 0; i < 7; i++) {
      var want = x0 + step * (i + 0.5), best = null, bd = Infinity;
      list.forEach(function (m) { var d = Math.abs(m.x - want); if (d < bd && d < step * 0.5) { bd = d; best = m; } });
      out.push(best || { x: want, Y: lerp(L_V, L_VI, 0.4), D: D });
    }
    return out;
  }
  function has(a, i) { return a.indexOf(i) >= 0; }
  // a soft light along a line, added to what is there
  function glowLine(x0, y0, x1, y1, w, col, a) {
    if (a <= 0.01) return;
    ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineCap = 'round';
    [[w * 3.2, 0.25], [w * 1.6, 0.5], [w * 0.7, 1]].forEach(function (s) { ctx.lineWidth = s[0]; ctx.globalAlpha = a * s[1]; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); });
    ctx.globalAlpha = 1;
  }
  function halo(x, y, r, col, a) {
    if (a <= 0.01) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  // a thread of expectation coming down from above to a tree's crown and on down its trunk, grown to f; solid once learned
  function thread(top, soma, f, a, learned) {
    if (f <= 0 || a <= 0.01) return;
    var y0 = Math.min(top.y - 0.1 * H, PLATE_TOP), len = soma.y - y0, y1 = Math.min(y0 + len * f, soma.y);
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';   // a glow under it, so it reads against the wood
    ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgba(255,200,90,.6)'; ctx.lineWidth = learned ? 12 : 9;
    ctx.beginPath(); ctx.moveTo(top.x, y0); ctx.lineTo(top.x, y1); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a; ctx.strokeStyle = learned ? '#D9A23C' : '#E9B648'; ctx.lineWidth = learned ? 4 : 3;
    ctx.setLineDash(learned ? [] : [3, 6]);
    ctx.beginPath(); ctx.moveTo(top.x, y0); ctx.lineTo(top.x, y1); ctx.stroke();
    ctx.setLineDash([]);
    if (f < 1) halo(top.x, y1, 10, 'rgba(255,226,140,1)', a);   // its head, coming down
    if (learned) { ctx.fillStyle = '#E8B547'; ctx.beginPath(); ctx.arc(top.x, top.y, 5, Math.PI, TAU); ctx.fill(); }   // the learned trace, Grossberg's half-disc
    ctx.globalAlpha = 1;
  }
  function drawResonance(cam, now, u) {
    if (!resEl) return;
    var on = smooth(U_R0 - 0.01, U_R0 + 0.005, u) * (1 - smooth(U_R1 + 0.01, U_R1 + 0.04, u));
    if (on <= 0) { RES.picks = null; return; }
    if (!RES.picks) RES.picks = pickRes(cam);
    var t = reduce ? 1 : resT(u), i, T = [];
    for (i = 0; i < 7; i++) {
      var m = RES.picks[i], b = proj(m.x, WM + 0.02, m.D, cam), bx = b.x, by = b.y, sm = proj(m.x, m.Y, m.D, cam), sx = sm.x, sy = sm.y, tp = proj(m.x, PIA + 0.06, m.D, cam);
      T.push({ base: { x: bx, y: by }, soma: { x: sx, y: sy }, top: { x: tp.x, y: tp.y } });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var bu = smooth(0.02, 0.12, t), aIn = smooth(0.22, 0.33, t), aOut = smooth(0.38, 0.41, t), bIn = smooth(0.43, 0.56, t), res = smooth(0.6, 0.68, t), learn = smooth(0.84, 0.92, t);
    var beat = 0.65 + 0.35 * Math.sin(now * 0.0125);   // ringing together, all in time
    // the off-surround: what rose without being expected is quieted
    if (res > 0) for (i = 0; i < 7; i++) if (has(R_BU, i) && !has(R_B, i)) {
      var qx = T[i].soma.x, qy = (T[i].top.y + T[i].base.y) / 2, qh = (T[i].base.y - T[i].top.y) * 0.6, sg = ctx.createRadialGradient(qx, qy, 0, qx, qy, qh);
      sg.addColorStop(0, 'rgba(48,52,64,.42)'); sg.addColorStop(0.5, 'rgba(48,52,64,.24)'); sg.addColorStop(1, 'rgba(48,52,64,0)');
      ctx.save(); ctx.translate(qx, qy); ctx.scale(0.22, 1); ctx.translate(-qx, -qy);   // a soft, tall shade over the tree
      ctx.globalAlpha = res * on; ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(qx, qy, qh, 0, TAU); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 7; i++) {
      var q = T[i], up = has(R_BU, i), match = has(R_B, i) && up, quiet = up && !has(R_B, i) ? 1 - 0.75 * res : 1;
      // bottom-up: light running up the trunk
      if (up) {
        // (up the whole tree: in by the foot, through the body, up the trunk to the crown)
        glowLine(q.base.x, q.base.y, q.soma.x, q.soma.y, 3, 'rgba(255,236,190,1)', 0.6 * bu * on * quiet);
        glowLine(q.soma.x, q.soma.y, q.top.x, q.top.y, 2.4, 'rgba(255,236,190,1)', 0.45 * bu * on * quiet);
        for (var k = 0; k < 4; k++) {
          var f = (now * 0.00035 + k / 4 + i * 0.17) % 1, px = lerp(q.base.x, q.top.x, f), py = lerp(q.base.y, q.top.y, f);
          halo(px, py, 12, 'rgba(255,244,214,1)', bu * on * quiet * Math.sin(Math.PI * f));
        }
      }
      // resonance: the matched trees ring, crown to foot
      if (match && res > 0) {
        glowLine(q.soma.x, q.soma.y, q.top.x, q.top.y, 3, 'rgba(255,214,120,1)', 0.55 * res * beat * on);
        halo(q.soma.x, q.soma.y, 0.045 * H, 'rgba(255,226,150,1)', 0.75 * res * beat * on);
        halo(q.top.x, q.top.y + 0.02 * H, 0.08 * H, 'rgba(255,214,110,1)', 0.5 * res * beat * on);
      }
      // expected but not seen: primed, not lit
      if (has(R_B, i) && !up && res > 0) halo(q.soma.x, q.soma.y, 0.03 * H, 'rgba(255,226,150,1)', 0.22 * res * on);
    }
    ctx.globalCompositeOperation = 'source-over';
    // the guesses, coming down
    for (i = 0; i < 7; i++) {
      if (has(R_A, i)) thread(T[i].top, T[i].soma, aIn, on * (1 - aOut) * (t > 0.33 && t < 0.4 ? 0.55 + 0.45 * Math.sin(now * 0.05) : 1), false);
      if (has(R_B, i)) thread(T[i].top, T[i].soma, bIn, on, learn > 0.5 && has(R_BU, i));
    }
    // the reset: a flash, as the wrong guess is dropped
    var fl = smooth(0.38, 0.4, t) * (1 - smooth(0.4, 0.45, t));
    if (fl > 0) cover('#FFF6E0', 0.28 * fl * on);
    RES.T = T; RES.t = t; RES.on = on;
  }
  // its lettering, in Plate III's layer
  var RES_LABELS = [['a', 'what the eye brings, rising', 0.04, 1], ['b', 'what is expected, coming down', 0.24, 0.42], ['c', 'no match: reset, and search on', 0.35, 0.5],
    ['b', 'another expectation', 0.45, 0.62], ['d', 'a match: they resonate, ringing together', 0.63, 1], ['e', 'the rest is quieted', 0.68, 1], ['f', 'and only now is anything learned', 0.86, 1]];
  function labelsRes() {
    if (!P3.res) {
      P3.res = RES_LABELS.map(function (L) {
        var tx = svgEl('text', 'lab', plate3El);
        svgEl('tspan', 'k', tx).textContent = L[0] + '. ';
        svgEl('tspan', '', tx).textContent = L[1];
        return tx;
      });
    }
    var T = RES.T, t = RES.t || 0, on = resEl && RES.on ? RES.on : 0;
    P3.res.forEach(function (tx, j) {
      var L = RES_LABELS[j], a = on * smooth(L[2], L[2] + 0.04, t) * (1 - smooth(L[3], L[3] + 0.04, t)), x = 0, y = 0;
      if (T && a > 0) {
        var q = j === 0 ? T[1] : j === 1 || j === 2 ? T[3] : j === 3 ? T[6] : j === 4 ? T[2] : j === 5 ? T[5] : T[4];
        if (j === 0) { x = q.soma.x + 16; y = lerp(q.soma.y, q.base.y, 0.5); }
        else if (j < 4) { x = q.top.x + 12; y = q.top.y - 0.12 * H; }
        else if (j === 4) { x = q.top.x + 14; y = q.top.y + 0.05 * H; }
        else if (j === 5) { x = q.soma.x + 14; y = q.soma.y + 0.06 * H; }
        else { x = q.top.x + 12; y = q.top.y - 0.06 * H; }
        x = Math.min(x, W - 300); y = clamp(y, PLATE_TOP + 24, H - 40);
      }
      attr(tx, 'x', x.toFixed(1)); attr(tx, 'y', y.toFixed(1)); attr(tx, 'opacity', Math.round(a * 100) / 100);
    });
  }

  // ---------- render ----------
  function render(now) {
    if (p < 1 + U_RISE) hidePlate3();
    if (forest) keep(p - 1);
    useScale(p < P_PUPIL ? dprEye : dprIn);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rollC = 1; rollS = 0;
    if (p < P_PUPIL) { hidePlate(); drawEye(eyeCam(p + (P_DIVE + 0.024 - p) * root.tease), now); return; }
    if (p < P_CUT) { hidePlate(); drawFall(fallCam(p)); return; }
    var u = p - 1;
    if (u >= U_DARK && u < U_RISE) { hidePlate(); drawWay(u, now); return; }
    if (u >= U_RISE) {
      world = cortex;
      var cc = cortexCam(u);
      drawCortex(cc, now, u);
      drawPlate(cc, now);
      drawPlate3(cc, now, u);
      cover(MYELIN, 1 - smooth(U_RISE, U_RISE + 0.01, u));   // out of the white
      return;
    }
    world = forest;
    var fc = forestCam(p);
    drawForest(fc, now);
    drawPlate(fc, now);
    cover('#160A0E', smooth(0, U_DARK, u));   // past the river: up into the dark of the roof again
    // the far side of the cut: still dark in the roof, until we drop out of it
    var dark = 1 - smooth(P_CUT, P_CUT + 0.035, p);
    if (dark > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = alpha('#160A0E', dark.toFixed(3));
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- update: scroll, pointer, the eye's own life ----------
  var root = { tease: 0 }, cueEl = document.getElementById('cue'), cueText = cueEl && cueEl.querySelector('span'), heroCopy = document.getElementById('hero-copy'), flatBox = document.getElementById('dive-flat'), paperEl = document.querySelector('.paper');
  var track = document.querySelector('.track');
  var flatBtn = document.getElementById('flat'), bareBox = document.getElementById('dive-bare'), bareBtn = document.getElementById('bare'), bare = false;
  function fade(el, v) {
    v = Math.round(v * 100) / 100;
    if (el._o === v) return;
    el._o = v;
    el.style.opacity = v;
    el.style.visibility = v > 0 ? 'visible' : 'hidden';
  }
  // Scrolling through the track flies the camera from the eye to the forest at rest, arriving as the track's end
  // reaches the bottom of the screen; then, while the page's sections scroll over it, it goes on, slowly, deeper in.
  // The forest ends where its plate's folded legend comes in (opened, it scrolls on without moving the camera). The
  // journey after it carries the camera on to the cortex, and from there each part of the page has its place in it.
  var journeyEl = document.getElementById('journey');
  var STOPS = [['how', 0.85, U_V1], ['model', 0.4, U_V2], ['circuit', 0.35, U_C0], ['evidence', 0.75, U_C1], ['markets', 0.4, U_V4], ['contact', 0.4, U_REST]];
  // (a page can set its own: data-u, where in the way on an element comes in, and data-at, how far up the screen then)
  var pageStops = document.querySelectorAll('[data-u]');
  if (pageStops.length) STOPS = Array.prototype.map.call(pageStops, function (el) { return [el, parseFloat(el.getAttribute('data-at') || 0.5), parseFloat(el.getAttribute('data-u'))]; });
  function docTop(el) { return el.getBoundingClientRect().top + window.scrollY; }
  function legendEnd(el, vh) { var sum = el.querySelector('summary'); return docTop(sum) + sum.offsetHeight + 28 - vh; }
  function scrollP() {
    var y = window.scrollY, vh = window.innerHeight, end = Math.max(1, track.offsetTop + track.offsetHeight - vh);
    if (y <= end) return P_REST * y / end;
    var max = document.documentElement.scrollHeight - vh, lg = journeyEl ? legends[0] : legends[legends.length - 1];
    if (lg) max = Math.min(max, legendEnd(lg, vh));
    if (!journeyEl || y <= max) return P_REST + (1 - P_REST) * clamp((y - end) / Math.max(1, max - end), 0, 1);
    // the way on: from one stop to the next, each where a part of the page comes in
    var stops = [[Math.max(max, docTop(journeyEl) - vh * 0.6), 0]], last = document.documentElement.scrollHeight - vh, i, el;
    STOPS.forEach(function (s) { if ((el = typeof s[0] === 'string' ? document.getElementById(s[0]) : s[0])) stops.push([docTop(el) - vh * s[1], s[2]]); });
    if (legends.length > 1) last = Math.min(last, legendEnd(legends[legends.length - 1], vh));
    stops.push([last, 1]);
    for (i = 1; i < stops.length; i++) stops[i][0] = Math.max(stops[i][0], stops[i - 1][0] + 1);
    if (y <= stops[0][0]) return 1;
    for (i = 1; i < stops.length; i++) if (y < stops[i][0]) break;
    if (i === stops.length) return 2;
    return 1 + lerp(stops[i - 1][1], stops[i][1], (y - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }

  var shown = null, swapAt = 0;
  function update(dt, now) {
    var target = fixedP != null ? fixedP : scrollP();
    if (reduce) {
      // no flight: fade between the eye, the forest, and the cortex's areas, each as its part of the page comes in
      var at = [0, 1, 1 + U_V1, 1 + U_V2, 1 + U_C1, 1 + U_V4, 1 + U_REST], i;
      for (i = at.length - 1; i > 0 && target < (i === 1 ? 0.5 : at[i] - 0.02); i--);
      target = at[i];
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
    // Beckoning. Whenever we stop where no page is over the scene (on the way in, on the journey, in Plate III's pause),
    // the cue says to keep scrolling; and at the very top,
    // left alone a few seconds, the eye glances down at it and the camera leans in towards the pupil and back, a taste of
    // what scrolling does. (Someone on a phone once scrolled a little, met the cookie question, and never went in.)
    var idle = now - lastInput, top = p < 0.008;
    if (cueEl) {
      if (cueText && cueText._top !== top) { cueText._top = top; cueText.textContent = top ? 'scroll to look inside' : 'keep scrolling'; }
      var bare2 = p < P_CUT - 0.02 || (p > 1 + U_DARK && p < 1 + U_V1 - 0.03) || (p > 1 + U_C0 && p < 1 + U_C1 - 0.01);   // no page over the scene: the way in, the journey, the pause
      fade(cueEl, fixedP == null && bare2 && (top || idle > 1600) ? 1 : 0);
    }
    var phase = (idle - 3500) % 6500 / 1700, tz = !reduce && fixedP == null && top && idle > 3500 && phase < 1 ? Math.sin(Math.PI * phase) : 0;
    root.tease += (tz - root.tease) * (1 - Math.exp(-dt * 8));
    if (root.tease > 0.01) { iris.tx *= 1 - root.tease; iris.ty = lerp(iris.ty, MAX_Y, root.tease); }
    var look = 1 - smooth(0.02, 0.08, p), ki = reduce || fixedPtr ? 1 : 1 - Math.exp(-dt * 7);   // diving in, it looks straight at us
    iris.x += (iris.tx * look - iris.x) * ki;
    iris.y += (iris.ty * look - iris.y) * ki;

    // a blink now and then, while we are still outside
    var ts = now / 1000;
    if (!reduce && fixedP == null && p < 0.02 && ts > blink.at) { blink.start = ts; blink.at = ts + 3.5 + Math.random() * 4; }
    var bt = (ts - blink.start) / 0.2;
    blink.v = bt >= 0 && bt <= 1 ? Math.sin(Math.PI * bt) : 0;

    fade(heroCopy, 1 - smooth(0.008, 0.045, p));
    var diving = p > 0.045, arrived = p > P_REST - 0.01;   // the headline has gone; we are in the forest (a phone asks about cookies only then)
    if (diving !== root.diving) { root.diving = diving; document.documentElement.classList.toggle('diving', diving); }
    if (arrived !== root.arrived) { root.arrived = arrived; document.documentElement.classList.toggle('arrived', arrived); }
    fade(paperEl, smooth(P_PUPIL, P_GLOW + 0.03, p));
    // once in the forest, the page can be lifted off it; the flattening only while the scene is in full view: the
    // forest before the page comes over it, the way on to the cortex (or anywhere, bare)
    var inForest = smooth(P_CUT + 0.04, P_CUT + 0.1, p), onWay = smooth(1 + U_DARK, 1 + U_DARK * 2, p) * (1 - smooth(1 + U_V1 - 0.04, 1 + U_V1 - 0.02, p));
    fade(flatBox, inForest * (bare ? 1 : Math.max(onWay, 1 - smooth(P_REST + 0.008, P_REST + 0.02, p))));
    fade(bareBox, bare ? 1 : inForest);   // bare, it stays wherever we go, so there is always a way back
  }

  // ---------- setup ----------
  // Sizes, scales, and everything cheap that depends on them.
  function measure() {
    W = window.innerWidth; H = window.innerHeight;
    var dev = window.devicePixelRatio || 1;
    dprEye = Math.min(dev, 2);
    dprBase = forceScale || Math.min(dev, 1.5, Math.sqrt(PIXEL_BUDGET / (W * H)));
    dprIn = forceScale || (dprIn ? Math.min(dprIn, dprBase) : dprBase);
    paintScale = Math.min(dprBase, 1);
    dpr = 0; useScale(p < P_PUPIL ? dprEye : dprIn);
    A = W / H; F = H; C = { x: W / 2, y: H / 2 }; halfDiag = Math.hypot(W, H) / 2;
    var portrait = W < H;
    eyePx = Math.min(W * (portrait ? 0.6 : 0.5), H * 0.72);   // narrow screens: keep the logo's sparkles on screen
    EYE_S = eyePx / (192 * H);   // world units per logo unit, at the eye's distance (1) with F = H
    cam0 = { x: 0, y: portrait ? 0.13 : 0.1 };   // the eye sits above the middle, the headline below it
    dMin = 13 * EYE_S * F / (1.3 * halfDiag);   // this close, the pupil fills the screen
    sparks = buildSparks();
    if (!irisArt) irisArt = buildIris(rng(SEED + 5));
    irisGrad = ctx.createRadialGradient(194.6, 129.8, 0, 194.6, 129.8, 34);
    irisGrad.addColorStop(0, '#F7D3DE'); irisGrad.addColorStop(0.65, '#E7A1B6'); irisGrad.addColorStop(1, '#8E2F55');
    glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 140);
    glowGrad.addColorStop(0, 'rgba(231,161,182,.16)'); glowGrad.addColorStop(0.6, 'rgba(231,161,182,.07)'); glowGrad.addColorStop(1, 'rgba(231,161,182,0)');
    nightGrad = ctx.createLinearGradient(0, 0, 0, H);
    nightGrad.addColorStop(0, '#18263F'); nightGrad.addColorStop(1, '#0A111D');
  }

  // The fall's layers, and the forest: the forest takes a while to paint, and the eye and the fall do not need it,
  // so it is painted bit by bit meanwhile.
  var built = null;
  function build() {
    var t0 = performance.now();
    fall = buildFall(rng(SEED));
    buildForest();
    buildWay();
    buildCortex();
    plate = null;   // laid out again for the new shape
    paintSoon();
    built = { w: W, h: H };
    buildMs = performance.now() - t0;
  }
  function layout() {
    measure();
    // On a phone, the address bar showing or hiding changes the height a little: keep what is built (it is drawn
    // in units of the screen's height, so it just scales). Anything bigger, and it is built again for the new shape.
    if (built && W === built.w && Math.abs(H - built.h) < built.h * 0.3) return;
    build();
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
    poke();
    flatTarget = flatTarget ? 0 : 1;
    flatBtn.setAttribute('aria-pressed', flatTarget ? 'true' : 'false');
  });
  function setBare(on) {
    poke();
    bare = on;
    bareBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.documentElement.classList.toggle('bare', on);
  }
  bareBtn.addEventListener('click', function () { setBare(!bare); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bare) setBare(false); });
  if (q.has('bare')) setBare(true);
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 150); });

  // ---------- go ----------
  var hud = q.has('debug') ? document.body.appendChild(document.createElement('pre')) : null, hudAt = 0, renderMs = 0, frameMs = 16, last = 0;
  if (hud) hud.className = 'hud';
  var paused = false, tick = 0, lastInput = 0;
  function poke() { lastInput = performance.now(); }
  window.addEventListener('scroll', poke, { passive: true });
  function frame(now) {
    if (paused) { requestAnimationFrame(frame); return; }
    // When nobody is doing anything the scene still lives (cells drift, the eye looks around), but every other
    // frame is enough for that, and it spares the battery.
    var calm = fixedP == null && now - Math.max(lastInput, ptr.last) > 1500 && Math.abs(scrollP() - p) < 1e-4;
    if (calm && (tick++ & 1)) { requestAnimationFrame(frame); return; }
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    frameMs = lerp(frameMs, last ? now - last : 16, 0.1);
    last = now;
    update(dt, now);
    var t0 = performance.now();
    render(now);
    renderMs = lerp(renderMs, performance.now() - t0, 0.1);
    // Twice a second, inside the eye, measure what a frame really costs, waiting for the drawing to finish (the
    // time between frames would not do: browsers slow down pages that are not in front). Three slow ones in a row:
    // draw with fewer pixels; a run of quick ones: with more again, up to the budget.
    if (p >= P_PUPIL && fixedP == null && !forceScale && ++cost.n % 30 === 0) {
      flush();
      var c = cost.last = performance.now() - t0;
      cost.slow = c > 15 ? cost.slow + (c > 30 ? 1.5 : 1) : 0;   // very slow ones count for more
      cost.fast = c < 6 ? cost.fast + 1 : 0;
      if (cost.slow >= 3 && dprIn > 0.45) { dprIn = Math.max(0.45, dprIn * (c > 30 ? 0.75 : 0.84)); cost.slow = 0; }
      if (cost.fast >= 6 && dprIn < dprBase) { dprIn = Math.min(dprBase, dprIn * 1.1); cost.fast = 0; }
    }
    if (hud && now - hudAt > 250) {
      hudAt = now;
      hud.textContent = 'fps ' + (1000 / frameMs).toFixed(0) + '  draw ' + renderMs.toFixed(1) + 'ms  build ' + buildMs.toFixed(0) + 'ms  slices ' + (forest ? forest.planes.length : 0) + '/' + SLICES.length + '\n' +
        'p ' + p.toFixed(3) + '  fall ' + FC.c.toFixed(4) + '  forest ' + SC.y.toFixed(2) + ',' + SC.z.toFixed(2) + '  flat ' + flatT.toFixed(2) + '\n' +
        'scale ' + dpr.toFixed(2) + ' (inside ' + dprIn.toFixed(2) + ' of ' + dprBase.toFixed(2) + ')  measured ' + cost.last.toFixed(1) + 'ms';
    }
    requestAnimationFrame(frame);
  }

  // for tuning: time a frame at a given scroll position (forces the canvas to finish drawing)
  window.__dive = {
    bench: function (pp, n) {
      var keep = p, t0, i;
      n = n || 20; p = pp; t0 = performance.now();
      for (i = 0; i < n; i++) render(t0 + i * 16);
      flush();
      var ms = (performance.now() - t0) / n;
      p = keep;
      return Math.round(ms * 100) / 100;
    },
    build: function () { return Math.round(buildMs); },
    scale: function () { return { now: dpr, inside: dprIn, base: dprBase, paint: paintScale, eye: dprEye }; },
    steps: function () { return { n: stepStats.n, max: Math.round(stepStats.max), over30: stepStats.over30, by: stepStats.by }; },
    // megapixels held in painted bitmaps (each pixel is 4 bytes, on the GPU or in memory)
    memory: function () {
      var px = 0, wpx, cpx;
      function add(it) { if (it && it.img) px += it.img.width * it.img.height; }
      if (forest) { forest.planes.forEach(function (pl) { pl.items.forEach(add); }); add(forest.veil); forest.grove.forEach(function (t) { add(t.cel); }); }
      var fpx = px; px = 0;
      if (way) { way.nerve.forEach(add); add(way.chiasm.ground); add(way.chiasm.tract); add(way.chiasm.near); add(way.rise.main); add(way.rise.far); add(way.rise.near); }
      wpx = px; px = 0;
      if (cortex) cortex.chunks.forEach(function (ch) { add(ch.cel); add(ch.col); });
      cpx = px; px = fpx;
      return { wayMP: Math.round(wpx / 1e5) / 10, cortexMP: Math.round(cpx / 1e5) / 10, cortexChunks: cortex ? cortex.chunks.filter(function (c) { return c.cel; }).length + '/' + cortex.chunks.length : 0, forestMP: Math.round(px / 1e5) / 10, stageMP: Math.round(canvas.width * canvas.height / 1e5) / 10, scratchMP: Math.round(scratch.reduce(function (a, c) { return a + c.width * c.height; }, 0) / 1e5) / 10 };
    },
    // hold the camera at a point of the scroll (and, optionally, the pointer), as ?p= and ?px=&py= do
    seek: function (pp, px, py) {
      fixedP = clamp(pp, 0, 2); p = fixedP;
      if (px != null) { fixedPtr = { x: px, y: py || 0 }; ptr.x = ptr.tx = px; ptr.y = ptr.ty = py || 0; }
    },
    ready: function () { return !!forest && !forest.steps.length; },
    readyAll: function () { return !paintNext.peek(); },
    // for recording: stop the clock, then draw frames at chosen moments (scroll point, pointer, time in ms, flattening)
    pause: function () { paused = true; },
    frameAt: function (pp, px, py, t, flat) {
      fixedP = clamp(pp, 0, 2); p = fixedP; fixedPtr = { x: px || 0, y: py || 0 };
      if (flat != null) { flatTarget = flat; flatT = flat; flatBtn.setAttribute('aria-pressed', flat > 0.5 ? 'true' : 'false'); }
      update(1 / 30, t);
      render(t);
    }
  };

  // ---------- the panels of the page's second half: Kanizsa squares ----------
  // From V2 on, where boundaries are completed and surfaces filled in, each panel arrives as a Kanizsa square, with the
  // pair Grossberg calls complementary: boundaries complete inward, surfaces fill in outward. Four pac-men, mouths in,
  // around where it will be; the boundary completing between them dot by dot, inward from each; then the paper filling
  // in from inside, outward, unoriented, until the boundary holds it (in the page's CSS); then what is written on it.
  // All of it follows one number (--kzt), moved on with time once the panel comes up the screen, and with the scroll
  // when that is faster: however quickly we go, it is done by the time the panel reaches the top quarter.
  (function () {
    var NS = 'http://www.w3.org/2000/svg', panels = [], named = document.querySelectorAll('[data-kz]');   // (a page may name its own)
    (named.length ? Array.prototype.slice.call(named) : ['model', 'evidence', 'markets', 'name', 'team', 'contact']).forEach(function (id) {
      var sec = typeof id === 'string' ? document.getElementById(id) : id, wrap = sec && sec.querySelector(':scope > .wrap');
      if (!wrap) return;
      sec.classList.add('kz');
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'kz-marks'); svg.setAttribute('aria-hidden', 'true');
      wrap.insertBefore(svg, wrap.firstChild);
      panels.push({ sec: sec, wrap: wrap, svg: svg, w: 0, h: 0, t: 0, t0: null });
      wrap.style.setProperty('--kzt', reduce ? 1 : 0);
    });
    function draw(pn) {
      // the square is the paper, set in from the panel's edge by --kzi (so the pac-men stay on screen)
      var k = parseFloat(getComputedStyle(pn.wrap).getPropertyValue('--kzi')) || 0, W0 = pn.wrap.offsetWidth, H0 = pn.wrap.offsetHeight;
      var w = W0 - 2 * k, h = H0 - 2 * k, r = W0 < 600 ? 17 : 27, gap = r + 8, step = W0 < 600 ? 11 : 14, html = '';
      if (!W0 || (w === pn.w && h === pn.h)) return;
      pn.w = w; pn.h = h;
      pn.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); pn.svg.setAttribute('width', w); pn.svg.setAttribute('height', h);
      pn.svg.style.left = pn.svg.style.top = k + 'px';
      function at(cx, cy, a) { a *= Math.PI / 180; return (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1); }
      // the pac-men: each missing the quarter that faces the middle
      [[0, 0, 0], [w, 0, 90], [w, h, 180], [0, h, 270]].forEach(function (c, i) {
        html += '<path class="kz-pac" style="--d:' + (i * 0.02).toFixed(2) + ';transform-origin:' + c[0] + 'px ' + c[1] + 'px" d="M' + c[0] + ' ' + c[1] + 'L' + at(c[0], c[1], c[2] + 90) +
          'A' + r + ' ' + r + ' 0 1 1 ' + at(c[0], c[1], c[2] + 360) + 'Z"/>';
      });
      // the boundary between them, completing inward from both ends of each side
      [[0, 0, w, 0], [w, 0, w, h], [w, h, 0, h], [0, h, 0, 0]].forEach(function (e) {
        var len = Math.hypot(e[2] - e[0], e[3] - e[1]), ux = (e[2] - e[0]) / len, uy = (e[3] - e[1]) / len, n = Math.floor((len / 2 - gap) / step), i;
        for (i = 0; i <= n; i++) {
          var d = gap + i * step;
          var fr = (i / Math.max(1, n)).toFixed(3);   // how far in from its pac-man: when it appears
          html += '<circle class="kz-dot" style="--f:' + fr + '" r="2.6" cx="' + (e[0] + ux * d).toFixed(1) + '" cy="' + (e[1] + uy * d).toFixed(1) + '"/>';
          html += '<circle class="kz-dot" style="--f:' + fr + '" r="2.6" cx="' + (e[2] - ux * d).toFixed(1) + '" cy="' + (e[3] - uy * d).toFixed(1) + '"/>';
        }
      });
      pn.svg.innerHTML = html;
    }
    function drawAll() { panels.forEach(draw); }
    if ('ResizeObserver' in window) new ResizeObserver(drawAll).observe(document.body);
    else window.addEventListener('resize', drawAll);
    drawAll();
    if (reduce) return;
    // it starts once the panel's top is three quarters of the way up the screen, takes about three seconds left to
    // itself, and is done by the time that top reaches a quarter of the way down, however fast we got there
    var DUR = 3200, running = false;
    function step() {
      var vh = window.innerHeight, now = performance.now(), busy = false;
      panels.forEach(function (pn) {
        if (pn.t >= 1) return;
        var top = pn.wrap.getBoundingClientRect().top;
        if (pn.t0 == null) { if (top > vh * 0.75) return; pn.t0 = now; }
        var t = clamp(Math.max((now - pn.t0) / DUR, (vh * 0.75 - top) / (vh * 0.5)), pn.t, 1);
        if (t - pn.t > 0.002 || t === 1) { pn.t = t; pn.wrap.style.setProperty('--kzt', t.toFixed(3)); }
        if (t < 1) busy = true;
      });
      running = busy;
      if (busy) requestAnimationFrame(step);
    }
    function go() { if (!running) { running = true; requestAnimationFrame(step); } }
    window.addEventListener('scroll', go, { passive: true });
    go();
  })();

  makeTextures();
  paintCells();
  makeGrain();
  layout();
  requestAnimationFrame(frame);
})();
