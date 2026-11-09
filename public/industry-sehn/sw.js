/*
 * Service worker of the sealed preview (scripts/deploy/seal.ts). The files of the app lie encrypted in s/
 * under names that say nothing; s/m.bin is the encrypted list (path → name, type). With the key that the
 * gate stored after the right password, this worker answers every request of the app with the decrypted
 * file, and keeps the encrypted files in a cache, so the preview works offline after the first visit.
 * Without the key it steps aside and the gate (index.html) asks for the password.
 */
'use strict';
var GATE = {"v":1,"iter":600000,"salt":"sehn.ai/industry-sehn · gate v1"};
var SCOPE = new URL(self.registration.scope).pathname;
var CACHE = 'sehn-sealed-v1';
var DB = 'sehn-industry-gate';
var STORE = 'kv';
var KEY = 'aes';
var enc = new TextEncoder();
var dec = new TextDecoder();

var keyPromise = null; // Promise<CryptoKey|null>, kept only once a key was found
var current = null; // { key, m } the decrypted file list
var previous = null; // the list before a new version, for pages that are still open
var precaching = null;

self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('message', function (e) {
  var type = e.data && e.data.type;
  if (type === 'claim') e.waitUntil(self.clients.claim());
  if (type === 'key') {
    keyPromise = null;
    current = null;
  }
});

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
function getKey() {
  if (keyPromise) return keyPromise;
  var p = idb('readonly', function (st) {
    return st.get(KEY);
  }).catch(function () {
    return null;
  });
  return p.then(function (k) {
    if (k) keyPromise = p;
    return k || null;
  });
}
function forgetKey() {
  keyPromise = null;
  current = null;
  return idb('readwrite', function (st) {
    return st.delete(KEY);
  }).catch(function () {});
}

function open(bytes, key, aad) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: enc.encode(aad) }, key, bytes.slice(12));
}
function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error('timeout'));
    }, ms);
    promise.then(
      function (v) {
        clearTimeout(timer);
        resolve(v);
      },
      function (e) {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// The file list. Page loads take it from the network (a new version shows up at once) and fall back to the
// cache offline; the files of a page take the list that page was loaded with (cache first).
var loading = null;
function manifest(fresh) {
  return getKey().then(function (key) {
    if (!key) return null;
    if (current && current.key === key && !fresh) return current;
    if (loading && !fresh) return loading;
    var p = load(key, fresh).then(
      function (v) {
        if (loading === p) loading = null;
        return v;
      },
      function (e) {
        if (loading === p) loading = null;
        throw e;
      },
    );
    loading = p;
    return p;
  });
}
function load(key, fresh) {
  var url = SCOPE + 's/m.bin';
  return caches.open(CACHE).then(function (cache) {
    function fromNetwork() {
      return withTimeout(fetch(url, { cache: 'no-cache' }), 5000).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return cache.put(url, r.clone()).then(function () {
          return r.arrayBuffer();
        });
      });
    }
    function fromCache() {
      return cache.match(url).then(function (r) {
        return r ? r.arrayBuffer() : null;
      });
    }
    var bytes = fresh
      ? fromNetwork().catch(fromCache)
      : fromCache().then(function (b) {
          return b || fromNetwork();
        });
    return bytes.then(function (buf) {
      if (!buf) return current;
      return open(new Uint8Array(buf), key, 'm').then(
        function (plain) {
          var m = JSON.parse(dec.decode(plain));
          if (!current || current.m.build !== m.build || current.key !== key) {
            if (current && current.key === key) previous = current;
            current = { key: key, m: m };
          }
          return current;
        },
        function () {
          // the password changed with a new version: ask for it again
          return forgetKey().then(function () {
            return null;
          });
        },
      );
    });
  });
}

function fileUrl(entry) {
  return SCOPE + 's/' + entry.id + '.bin';
}
function cipher(entry) {
  var url = fileUrl(entry);
  return caches.open(CACHE).then(function (cache) {
    return cache.match(url).then(function (hit) {
      if (hit) return hit.arrayBuffer();
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
        return cache.put(url, r.clone()).then(function () {
          return r.arrayBuffer();
        });
      });
    });
  });
}

// After the app is open: fetch the rest for offline use, drop files no version needs any more.
function precache(state) {
  if (precaching) return precaching;
  precaching = caches
    .open(CACHE)
    .then(function (cache) {
      var keep = {};
      keep[SCOPE + 's/m.bin'] = true;
      [state, previous].forEach(function (s) {
        if (!s) return;
        Object.keys(s.m.files).forEach(function (p) {
          keep[fileUrl(s.m.files[p])] = true;
        });
      });
      var todo = state.m.precache.map(function (p) {
        return fileUrl(state.m.files[p]);
      });
      function next() {
        var url = todo.shift();
        if (!url) return Promise.resolve();
        return cache
          .match(url)
          .then(function (hit) {
            if (hit) return;
            return fetch(url).then(function (r) {
              if (r.ok) return cache.put(url, r);
            });
          })
          .catch(function () {})
          .then(next);
      }
      return Promise.all([next(), next(), next(), next()])
        .then(function () {
          return cache.keys();
        })
        .then(function (reqs) {
          return Promise.all(
            reqs
              .filter(function (req) {
                return !keep[new URL(req.url).pathname];
              })
              .map(function (req) {
                return cache.delete(req);
              }),
          );
        });
    })
    .catch(function () {})
    .then(function () {
      precaching = null;
    });
  return precaching;
}

function serve(event, req, rel) {
  var nav = req.mode === 'navigate';
  return manifest(nav)
    .catch(function () {
      return null;
    })
    .then(function (state) {
      if (!state) return fetch(req); // locked: the gate page, or a plain file next to it
      // every page of the app is the one index.html (routes live in the query)
      var path = nav ? 'index.html' : decodeURIComponent(rel);
      var entry = state.m.files[path] || (previous && previous.m.files[path]);
      if (!entry) return fetch(req);
      return cipher(entry)
        .then(function (buf) {
          return open(new Uint8Array(buf), state.key, entry.id);
        })
        .then(function (body) {
          if (nav) event.waitUntil(precache(state));
          return new Response(body, { status: 200, headers: { 'Content-Type': entry.type, 'X-Content-Type-Options': 'nosniff' } });
        })
        .catch(function (err) {
          if (nav) return fetch(req);
          return new Response('Could not open ' + path + ': ' + ((err && err.message) || err), { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
    });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(SCOPE) !== 0) return;
  var rel = url.pathname.slice(SCOPE.length);
  if (rel.indexOf('s/') === 0 || rel === 'sw.js') return;
  event.respondWith(serve(event, req, rel));
});

// GATE is part of the file so that a new password or salt also replaces the worker.
void GATE;
