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
        off: 'Line A runs to box 1.', on: 'Line A ends in box 3.' },
      front: { q: 'Can people read the label of the first field?', thumb: 'thumb-front',
        off: 'Yes, the first field is clearly labelled above the input.', on: 'No. The button covers the label.' },
      pipe: { q: 'Which of the three pipes feeds the valve on the right?', thumb: 'thumb-pipe',
        off: 'The top pipe. It is the closest one to the valve.', on: 'The bottom one. It runs behind the middle pipe, over the top one, and into the valve.' }
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
          body.appendChild(el('div', 'toolcall', 'using the tools at sehn.ai'));
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

  // ---------- API key request: sent to HubSpot ----------
  (function () {
    var form = $('#key-form');
    if (!form) return;
    var HS_PORTAL = '246360482';
    var HS_FORM = '8d7dfcd6-e21c-44d4-984f-2a887915d7d3'; // HubSpot form "sehn.ai API key request"
    var HS_NEWS_SUB = '2854179345';                  // subscription type "Marketing Information"
    var see = $('#f-see'), status = $('#form-status'), submit = $('button[type="submit"]', form);

    $$('.idea', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = see.value.trim();
        see.value = v ? v + '; ' + b.textContent.toLowerCase() : b.textContent;
        see.focus();
      });
    });

    form.addEventListener('input', function (e) { if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false'); });
    function val(name) { var f = form.elements[name]; return f ? f.value.trim() : ''; }
    function setStatus(text, isError) {
      status.textContent = text;
      status.classList.toggle('is-error', !!isError);
    }
    function mailtoFallback(d) {
      var text = 'Hi Anton and Diana,\n\nI\'d like an API key to try sehn.ai.\n\n' + d.message +
        '\n\nName: ' + d.firstname + ' ' + d.lastname + '\nCompany or project: ' + d.company + '\nRole: ' + d.jobtitle + '\n\nThanks!';
      return 'mailto:anton@mindsprings.ai,diana@mindsprings.ai?subject=' +
        encodeURIComponent('sehn.ai API key' + (d.company ? ' for ' + d.company : '')) + '&body=' + encodeURIComponent(text);
    }
    function showError(d) {
      status.innerHTML = '';
      status.classList.add('is-error');
      status.appendChild(document.createTextNode('Sorry, that didn’t go through. Please try again, or '));
      var a = document.createElement('a'); a.href = mailtoFallback(d); a.textContent = 'send it by email';
      status.appendChild(a);
      status.appendChild(document.createTextNode('.'));
    }
    function showThanks(d) {
      form.innerHTML = '<span class="tape" aria-hidden="true"></span><h3></h3><p class="form-thanks"></p>';
      $('h3', form).textContent = 'Thanks, ' + d.firstname + '!';
      $('.form-thanks', form).textContent = 'We got your request and will write to ' + d.email + ' soon.' +
        (d.news ? ' You’ll also hear from us when there’s news.' : '');
      form.setAttribute('tabindex', '-1'); form.focus();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var first = null;
      ['firstname', 'lastname', 'email', 'see'].forEach(function (n) {
        var f = form.elements[n], v = f.value.trim();
        var bad = !v || (n === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
        f.setAttribute('aria-invalid', String(bad));
        if (bad && !first) first = f;
      });
      if (first) {
        setStatus(first.name === 'email' && first.value.trim() ? 'Please check your email address.' : 'Please fill in the fields marked with *.', true);
        first.focus();
        return;
      }

      var d = {
        firstname: val('firstname'), lastname: val('lastname'), email: val('email'),
        company: val('company'), jobtitle: val('jobtitle'), news: form.elements.news.checked
      };
      d.message = 'What should the agent see: ' + val('see') +
        (val('agent') ? '\nAgent: ' + val('agent') : '') +
        '\nNewsletter: ' + (d.news ? 'yes' : 'no');

      if (val('website')) { showThanks(d); return; } // a bot filled the hidden field
      if (!HS_FORM) { showError(d); return; }

      var body = {
        fields: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'message']
          .filter(function (k) { return d[k]; })
          .map(function (k) { return { objectTypeId: '0-1', name: k, value: d[k] }; }),
        context: { pageUri: location.href, pageName: document.title }
      };
      if (d.news && HS_NEWS_SUB) {
        body.legalConsentOptions = { consent: {
          consentToProcess: true,
          text: 'We use your details only to reply and set up your access.',
          communications: [{ value: true, subscriptionTypeId: Number(HS_NEWS_SUB),
            text: 'Keep me posted: occasional news about sehn.ai and Mindsprings. Unsubscribe any time.' }]
        } };
      }

      submit.disabled = true; submit.textContent = 'Sending…'; setStatus('');
      fetch('https://api.hsforms.com/submissions/v3/integration/submit/' + HS_PORTAL + '/' + HS_FORM, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error('HubSpot ' + r.status);
        if (window.gtag) window.gtag('event', 'generate_lead', { form: 'api_key' });
        showThanks(d);
      }).catch(function () {
        submit.disabled = false; submit.textContent = 'Send request →';
        showError(d);
      });
    });
  })();
})();
