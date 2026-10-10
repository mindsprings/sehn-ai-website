// sehn.ai: small interactions, no framework.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }

  // Run fn once, the first time el scrolls into view.
  function onFirstView(el, fn, margin) {
    if (!el) return;
    if (!hasIO) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { io.disconnect(); fn(); }
    }, { rootMargin: margin || '0px 0px -15% 0px' });
    io.observe(el);
  }

  // ---------- fade-up on scroll ----------
  $$('.reveal, .chart').forEach(function (el) {
    onFirstView(el, function () { el.classList.add('is-visible'); }, '0px 0px -8% 0px');
  });

  // ---------- header: highlight the section you are in ----------
  var navLinks = $$('.site-nav a');
  if (hasIO && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.remove('is-active'); });
        if (byId[e.target.id]) byId[e.target.id].classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach(function (s) { spy.observe(s); });
  }

  // ---------- the logo's eye follows the pointer ----------
  (function () {
    var svg = $('.hero__logo'), iris = $('.hero__logo .iris');
    if (!svg || !iris || reduce) return;
    var cur = { x: 0, y: 0 }, target = { x: 0, y: 0 }, lastMove = 0, running = false, visible = true, wanderAt = 0;
    var MAX_X = 14, MAX_Y = 7;

    function lookAt(clientX, clientY) {
      var r = svg.getBoundingClientRect();
      var cx = r.left + r.width * 0.5, cy = r.top + r.height * (138 / 260);
      var dx = clientX - cx, dy = clientY - cy, d = Math.hypot(dx, dy) || 1;
      var k = Math.min(1, d / 320);
      target.x = dx / d * MAX_X * k;
      target.y = dy / d * MAX_Y * k;
    }
    window.addEventListener('pointermove', function (e) { lastMove = performance.now(); lookAt(e.clientX, e.clientY); }, { passive: true });

    function tick(t) {
      if (!visible) { running = false; return; }
      // nobody moving the mouse (or a phone): let the eye look around by itself
      if (t - lastMove > 2500 && t > wanderAt) {
        var a = Math.random() * Math.PI * 2, k = 0.4 + Math.random() * 0.6;
        target.x = Math.cos(a) * MAX_X * k; target.y = Math.sin(a) * MAX_Y * k;
        wanderAt = t + 1600 + Math.random() * 1800;
      }
      cur.x += (target.x - cur.x) * 0.12;
      cur.y += (target.y - cur.y) * 0.12;
      iris.setAttribute('transform', 'translate(' + cur.x.toFixed(2) + ' ' + cur.y.toFixed(2) + ')');
      requestAnimationFrame(tick);
    }
    function start() { if (!running) { running = true; requestAnimationFrame(tick); } }
    if (hasIO) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; if (visible) start(); }).observe(svg);
    }
    start();
  })();

  // ---------- the line puzzle ----------
  (function () {
    var puzzle = $('#puzzle'), card = $('#puzzle-card');
    if (!puzzle) return;
    var feedback = $('#puzzle-feedback'), trace = $('#trace-a'), sw = $('#patch-switch');
    var boxes = $$('.pz-box', puzzle), solved = false, lastText = feedback.innerHTML;

    function drawTrace() {
      trace.classList.remove('is-drawing');
      void trace.getBoundingClientRect();
      trace.classList.add('is-drawing');
    }
    function say(html) { feedback.innerHTML = html; lastText = html; }

    boxes.forEach(function (b) {
      b.addEventListener('click', function () {
        boxes.forEach(function (x) { x.classList.remove('is-right', 'is-wrong'); });
        if (b.dataset.box === '3') {
          b.classList.add('is-right'); drawTrace(); solved = true;
          say('<strong>Box 3, right.</strong> You barely had to think. On 200 new mazes, Claude Haiku 5.5 answering directly got 32% right, about what guessing scores. Now flip the switch to see why.');
        } else {
          b.classList.add('is-wrong'); drawTrace();
          say('Not quite. Watch line A…');
          setTimeout(function () {
            boxes[2].classList.add('is-right');
            say('<strong>It ends in box 3.</strong> Easy once you follow it. Following is exactly what a patch-reading model can’t do.');
          }, reduce ? 0 : 1600);
        }
      });
    });

    sw.addEventListener('click', function () {
      var on = sw.getAttribute('aria-pressed') !== 'true';
      sw.setAttribute('aria-pressed', String(on));
      puzzle.classList.toggle('is-patched', on);
      card.classList.toggle('is-patched', on);
      if (on) {
        var keep = lastText;
        feedback.innerHTML = 'Now try to follow line A. Each patch is handled on its own, so the line breaks at every edge.';
        lastText = keep;
      } else {
        feedback.innerHTML = lastText;
      }
    });
  })();

  // ---------- chat demo: with and without sehn.ai ----------
  (function () {
    var body = $('#chat-body'), sw = $('#tools-switch');
    if (!body) return;
    var demos = {
      trace: { q: 'Which box does line A end in?', thumb: 'thumb-trace',
        off: 'Line A runs to box 1.', on: 'Line A ends in box 3.', tools: ['Paths, connections'] },
      front: { q: 'Can people read the label of the first field?', thumb: 'thumb-front',
        off: 'Yes, the first field is clearly labelled above the input.', on: 'No. The button covers the label.', tools: ['Boundaries, shapes', 'What’s in front'] },
      pipe: { q: 'Which of the three pipes feeds the valve on the right?', thumb: 'thumb-pipe',
        off: 'The top pipe. It is the closest one to the valve.', on: 'The bottom one. It runs behind the middle pipe, over the top one, and into the valve.', tools: ['Paths, connections', 'What’s in front'] }
    };
    var state = { demo: 'trace', tools: false }, run = 0, touched = false;

    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function later(id, ms, fn) { setTimeout(function () { if (id === run) fn(); }, reduce ? 0 : ms); }

    function render() {
      var id = ++run, d = demos[state.demo];
      body.innerHTML = '';
      var q = el('div', 'bubble bubble--user'); q.appendChild(document.createTextNode(d.q));
      var tpl = document.getElementById(d.thumb);
      if (tpl) q.appendChild(tpl.content.cloneNode(true));
      body.appendChild(q);

      var typing = el('div', 'typing', '<i></i><i></i><i></i>'); typing.setAttribute('aria-label', 'Agent is thinking');
      var t = 350;
      if (state.tools) {
        later(id, t, function () {
          var call = el('div', 'toolcall', 'using the tools at sehn.ai');
          d.tools.forEach(function (name) { call.appendChild(el('span', 'chip', name)); });
          body.appendChild(call);
        });
        t += 650;
      }
      later(id, t, function () { body.appendChild(typing); });
      later(id, t + 900, function () {
        typing.remove();
        var a = el('div', 'bubble bubble--agent' + (state.tools ? ' is-right' : ''));
        a.appendChild(document.createTextNode(d[state.tools ? 'on' : 'off']));
        a.appendChild(el('span', 'bubble__tag', state.tools ? 'checked with sehn.ai ✓' : 'confident, but wrong'));
        body.appendChild(a);
      });
    }

    $$('.chat__tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        touched = true;
        $$('.chat__tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === tab)); });
        state.demo = tab.dataset.demo; render();
      });
    });
    sw.addEventListener('click', function () {
      touched = true;
      state.tools = sw.getAttribute('aria-pressed') !== 'true';
      sw.setAttribute('aria-pressed', String(state.tools));
      render();
    });

    // Start when it comes into view; if nobody touches it, flip the switch once by itself.
    onFirstView(body, function () {
      render();
      setTimeout(function () {
        if (touched) return;
        state.tools = true; sw.setAttribute('aria-pressed', 'true'); render();
      }, reduce ? 4000 : 4200);
    });
  })();

  // ---------- what we model: tabs + animated stage ----------
  (function () {
    var stage = $('#stage'), caption = $('#stage-caption'), btns = $$('.model__btn');
    if (!stage) return;
    var i = 0, timer = null;
    function select(n) {
      i = n;
      btns.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === n)); });
      stage.setAttribute('data-mode', btns[n].dataset.mode);
      caption.textContent = btns[n].dataset.caption;
    }
    btns.forEach(function (b, k) {
      b.addEventListener('click', function () { clearInterval(timer); timer = null; select(k); });
    });
    if (!reduce) {
      onFirstView(stage, function () {
        timer = setInterval(function () { select((i + 1) % btns.length); }, 3200);
      });
    }
  })();

  // ---------- Magic Eye: hold to peek ----------
  (function () {
    var btn = $('#peek'), stereo = $('#stereo');
    if (!btn) return;
    function on(e) { if (e) e.preventDefault(); stereo.classList.add('is-peeking'); btn.textContent = 'There it is'; }
    function off() { stereo.classList.remove('is-peeking'); btn.textContent = 'Hold to peek'; }
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { btn.addEventListener(ev, off); });
    btn.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') on(e); });
    btn.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') off(); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();

  // ---------- API key request: compose an email ----------
  (function () {
    var form = $('#key-form');
    if (!form) return;
    var see = $('#f-see');
    $$('.idea', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = see.value.trim();
        see.value = v ? v + '; ' + b.textContent.toLowerCase() : b.textContent;
        see.focus();
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#f-name').value.trim(), project = $('#f-project').value.trim(), what = see.value.trim();
      var text = 'Hi Anton and Diana,\n\nI\'d like an API key to try sehn.ai.\n\n' +
        'Name: ' + name + '\nCompany or project: ' + project + '\nWhat my agent should see: ' + what + '\n\nThanks!';
      window.location.href = 'mailto:anton@mindsprings.ai,diana@mindsprings.ai?subject=' +
        encodeURIComponent('sehn.ai API key' + (project ? ' for ' + project : '')) + '&body=' + encodeURIComponent(text);
      var note = $('small', form);
      if (note) note.textContent = 'Your email app should open now. If it doesn’t, write to anton@mindsprings.ai or diana@mindsprings.ai.';
    });
  })();
})();
