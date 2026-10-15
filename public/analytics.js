// sehn.ai: Google Analytics, loaded only after the visitor says yes.
(function () {
  var GA_ID = 'G-BFQ9WQS0J5'; // GA4 measurement ID (Admin → Data streams → sehn.ai)
  var KEY = 'sehn-consent';   // 'granted' | 'denied'
  if (!/^G-[A-Z0-9]+$/.test(GA_ID) || /^G-X+$/.test(GA_ID)) return; // no ID yet: no banner, no tracking

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var loaded = false;
  function loadGA() {
    if (loaded) return; loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  // Remove Google Analytics cookies (_ga, _ga_<id>) on this domain and its parent.
  function clearCookies() {
    var host = location.hostname, domains = ['', host, '.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^_ga/.test(name)) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  var banner = null;
  function showBanner() {
    if (banner) { banner.hidden = false; banner.querySelector('button').focus(); return; }
    banner = document.createElement('div');
    banner.className = 'consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<p>May we count your visit with Google Analytics? It sets cookies and helps us see what people read. ' +
      '<a href="imprint.html#analytics">Details</a></p>' +
      '<div class="consent__btns">' +
      '<button class="btn btn--plum btn--small" type="button" data-v="granted">Yes, that’s fine</button>' +
      '<button class="btn btn--small consent__no" type="button" data-v="denied">No, thanks</button>' +
      '</div>';
    banner.addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-v');
      if (!v) return;
      var was = read();
      write(v);
      banner.hidden = true;
      if (v === 'granted') loadGA();
      else { clearCookies(); if (was === 'granted' && loaded) location.reload(); }
    });
    document.body.appendChild(banner);
  }

  function init() {
    var choice = read();
    if (choice === 'granted') loadGA();
    else if (choice !== 'denied') showBanner();
    // "Cookie settings" links reopen the banner
    Array.prototype.forEach.call(document.querySelectorAll('[data-consent-open]'), function (b) {
      b.hidden = false;
      b.addEventListener('click', showBanner);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
