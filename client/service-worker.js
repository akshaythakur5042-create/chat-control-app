// client/service-worker.js
const CACHE = 'chat-control-v3.0.0';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        '/',
        '/index.html?v=3.0.0',
        '/style.css?v=3.0.0',
        '/script.js?v=3.0.0',
        '/manifest.json',
        '/assets/bg.jpg',
        '/assets/logo192.png',
        '/assets/logo512.png'
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE && caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // network-first for html/js/css to ensure fresh deploys
  if (url.origin === location.origin && /(\.html|\.js|\.css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(res => res || fetch(e.request))
    );
  }
});
