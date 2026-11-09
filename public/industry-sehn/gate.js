/*
 * Gate of the sealed preview (scripts/deploy/seal.ts). Every file of the app in this folder is encrypted
 * (AES-GCM, key from the password by PBKDF2-SHA-256). The password is checked by decrypting the file list:
 * no password and no hash of it are stored anywhere. Once it is right, the key (not extractable) is kept in
 * this browser's IndexedDB, and sw.js decrypts the files as the app asks for them.
 */
(function () {
  'use strict';
  var GATE = {"v":1,"iter":600000,"salt":"sehn.ai/industry-sehn · gate v1"};
  var DB = 'sehn-industry-gate';
  var STORE = 'kv';
  var KEY = 'aes';
  var HANDOVER = 'sehn-gate-handover';

  var de = (function () {
    try {
      var saved = localStorage.getItem('sehn.lang');
      if (saved === 'de' || saved === 'en') return saved === 'de';
    } catch (e) {
      /* storage may be blocked */
    }
    return (navigator.language || '').toLowerCase().indexOf('de') === 0;
  })();
  var TEXT = {
    title: ['Drawing Check', 'Drawing Check'],
    badge: ['Concept preview · results are illustrative', 'Konzept-Vorschau · Ergebnisse sind illustrativ'],
    lead: ['This preview is password protected.', 'Diese Vorschau ist passwortgeschützt.'],
    label: ['Password', 'Passwort'],
    open: ['Open', 'Öffnen'],
    foot: [
      'Once opened, the preview stays unlocked on this device and also works offline.',
      'Einmal geöffnet, bleibt die Vorschau auf diesem Gerät entsperrt und läuft auch offline.',
    ],
    wrong: ['Wrong password.', 'Falsches Passwort.'],
    busy: ['Unlocking…', 'Wird entsperrt …'],
    opening: ['Opening…', 'Wird geöffnet …'],
    failed: ['The preview could not be opened: ', 'Die Vorschau ließ sich nicht öffnen: '],
    nosw: [
      'This browser does not allow the storage the preview needs (private window?). Please open the link in a normal window of Safari, Chrome, Edge or Firefox.',
      'Dieser Browser erlaubt den Speicher nicht, den die Vorschau braucht (privates Fenster?). Bitte öffne den Link in einem normalen Fenster von Safari, Chrome, Edge oder Firefox.',
    ],
    offline: ['No connection. Connect once to unlock the preview.', 'Keine Verbindung. Zum Entsperren einmal online gehen.'],
  };
  function t(k) {
    return TEXT[k][de ? 1 : 0];
  }
  document.documentElement.lang = de ? 'de' : 'en';
  var nodes = document.querySelectorAll('[data-t]');
  for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-t'));

  var form = document.getElementById('form');
  var pw = document.getElementById('pw');
  var go = document.getElementById('go');
  var msg = document.getElementById('msg');
  function say(text, info) {
    msg.textContent = text || '';
    msg.className = info ? 'info' : '';
  }

  function idb(mode, run) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onerror = function () {
        reject(req.error);
      };
      req.onsuccess = function () {
        var db = req.result;
        var tx = db.transaction(STORE, mode);
        var q = run(tx.objectStore(STORE));
        tx.oncomplete = function () {
          db.close();
          resolve(q ? q.result : undefined);
        };
        tx.onerror = tx.onabort = function () {
          db.close();
          reject(tx.error);
        };
      };
    });
  }

  var enc = new TextEncoder();
  function derive(password) {
    return crypto.subtle
      .importKey('raw', enc.encode(password.trim().normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(GATE.salt), iterations: GATE.iter, hash: 'SHA-256' }, base, 512);
      })
      .then(function (bits) {
        var raw = new Uint8Array(bits);
        return crypto.subtle.importKey('raw', raw.slice(0, 32), { name: 'AES-GCM' }, false, ['decrypt']).then(function (key) {
          raw.fill(0);
          return key;
        });
      });
  }
  // resolves when the key opens the file list; rejects with name 'OperationError' when it does not
  function check(key) {
    return fetch('s/m.bin', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var b = new Uint8Array(buf);
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: enc.encode('m') }, key, b.slice(12));
      });
  }

  // registers sw.js and waits until it controls this page
  function worker() {
    return navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      if (navigator.serviceWorker.controller) return;
      return new Promise(function (resolve) {
        navigator.serviceWorker.addEventListener('controllerchange', resolve);
        navigator.serviceWorker.ready.then(function (r) {
          if (r.active) r.active.postMessage({ type: 'claim' });
        });
        setTimeout(resolve, 5000);
      });
    });
  }
  // auto: handing over without asking; remembered, so that a worker that does not take over cannot loop
  function enter(auto) {
    if (auto)
      try {
        sessionStorage.setItem(HANDOVER, String(Date.now()));
      } catch (e) {
        /* ignore */
      }
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'key' });
    location.reload();
  }
  function showForm() {
    form.hidden = false;
    pw.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!pw.value) return;
    go.disabled = true;
    say(t('busy'), true);
    var key;
    derive(pw.value)
      .then(function (k) {
        key = k;
        return check(key);
      })
      .then(function () {
        return idb('readwrite', function (st) {
          return st.put(key, KEY);
        });
      })
      .then(worker)
      .then(function () {
        say(t('opening'), true);
        enter(false);
      })
      .catch(function (err) {
        go.disabled = false;
        var name = err && err.name;
        if (name === 'OperationError') {
          say(t('wrong'));
          pw.select();
        } else if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError') say(t('nosw'));
        else if (!navigator.onLine) say(t('offline'));
        else say(t('failed') + ((err && err.message) || err));
      });
  });

  if (!('serviceWorker' in navigator) || !window.crypto || !crypto.subtle || !window.indexedDB) {
    say(t('nosw'));
    return;
  }
  // Opened before on this device: the worker serves the app. This page shows up after a hard reload
  // (which bypasses the worker) or before the worker took over; hand over once, then ask again.
  idb('readonly', function (st) {
    return st.get(KEY);
  })
    .then(function (key) {
      if (!key) return showForm();
      var last = 0;
      try {
        last = Number(sessionStorage.getItem(HANDOVER) || 0);
      } catch (e) {
        /* ignore */
      }
      if (Date.now() - last < 15000) return showForm();
      return check(key)
        .then(worker)
        .then(function () {
          enter(true);
        }, function (err) {
          if (err && err.name === 'OperationError')
            return idb('readwrite', function (st) {
              return st.delete(KEY);
            }).then(showForm);
          showForm();
        });
    })
    .catch(function (err) {
      if (err && err.name === 'SecurityError') say(t('nosw'));
      else showForm();
    });
})();
