/* Офлайн-режим для iPhone/браузера: страница — «сначала сеть», three.js и распознавание фото (jsdelivr) — из кэша. */
const C = 'gcnc-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'unpkg.com' || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'tessdata.projectnaptha.com') {
    e.respondWith(caches.open(C).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  if (u.origin === self.location.origin && !u.pathname.endsWith('version.json')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(C).then(c => c.put(req, cl)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
  }
});
