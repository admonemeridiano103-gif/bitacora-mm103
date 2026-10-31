// Service worker — Bitácora MM103 offline
var VERSION = '0.4.0';
var CACHE = 'bitacora-mm103-' + VERSION;
var SHELL = ['./', 'index.html', 'puente.js', 'piel.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
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
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // la API (POST) nunca se guarda aquí
  var url = new URL(req.url);
  if (EXTERNOS.indexOf(url.href) !== -1) {
    e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) { return r || fetch(req); }));
});
// Android: cuando regresa la señal, avisa a la app para que suba lo pendiente.
self.addEventListener('sync', function (e) {
  if (e.tag !== 'mm103-subir') return;
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage('mm103-subir'); });
  }));
});
