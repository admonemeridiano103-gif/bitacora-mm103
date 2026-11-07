// Service worker — Bitácora MM103 offline
var VERSION = '0.6.2';
var CACHE = 'bitacora-mm103-' + VERSION;
var SHELL = ['./', 'index.html', 'puente.js', 'piel.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png',
  'lecturas.js', 'medidores.json', 'ocr/ocr.js', 'ocr/digitos.js', 'ocr/modelo_digitos.json'];
// Tesseract (segunda opinión del lector, ~11 MB): se descarga en segundo plano tras instalar
var CDN = 'https://cdn.jsdelivr.net/npm/';
var OCR_PESADO = [CDN + 'tesseract.js@6.0.1/dist/tesseract.min.js', CDN + 'tesseract.js@6.0.1/dist/worker.min.js', CDN + 'jsqr@1.4.0/dist/jsQR.js',
  CDN + 'tesseract.js-core@6.1.2/tesseract-core-simd-lstm.wasm.js', CDN + 'tesseract.js-core@6.1.2/tesseract-core-lstm.wasm.js',
  CDN + '@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz'];
var EXTERNOS = ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })); })).then(function () {
      return Promise.all(EXTERNOS.map(function (u) { return c.add(new Request(u, { mode: 'cors' })).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('bitacora-mm103-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }).then(function () {
    // lector sin internet: baja Tesseract por detrás (no bloquea la instalación)
    return caches.open(CACHE).then(function (c) { return Promise.all(OCR_PESADO.map(function (u) { return c.match(u).then(function (r) { return r || c.add(new Request(u, { mode: 'cors' })).catch(function () {}); }); })); });
  }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // la API (POST) nunca se guarda aquí
  var url = new URL(req.url);
  if (EXTERNOS.indexOf(url.href) !== -1) {
    e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
    return;
  }
  if (url.href.indexOf(CDN) === 0) {                // librerías del lector (jsDelivr): primero la copia guardada
    e.respondWith(caches.match(req.url).then(function (r) {
      return r || fetch(req).then(function (resp) {
        if (resp.ok || resp.type === 'opaque') { var cp = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req.url, cp); }); }
        return resp;
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
    return r || fetch(req).then(function (resp) {
      if (resp.ok && url.pathname.indexOf('/ocr/') !== -1) { var cp = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return resp;
    });
  }));
});
// Android: cuando regresa la señal, avisa a la app para que suba lo pendiente.
self.addEventListener('sync', function (e) {
  if (e.tag !== 'mm103-subir') return;
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage('mm103-subir'); });
  }));
});
