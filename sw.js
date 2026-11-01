/* Офлайн-режим для iPhone/браузера.
   Страница: сеть, но не дольше 3 с — иначе сохранённая копия (белого экрана при слабой связи нет).
   three.js и распознавание фото (unpkg/jsdelivr) — из кэша. */
const C = 'gcnc-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const offline = () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;background:#0f1115;color:#e6e8ec;font:16px -apple-system,Segoe UI,Roboto,sans-serif;padding:80px 24px;text-align:center">
<div style="width:56px;height:56px;margin:0 auto 18px;border-radius:15px;background:linear-gradient(135deg,#ffc400,#ff8a00);color:#111;font:900 30px/56px sans-serif">G</div>
<h2 style="margin:0 0 10px">Нет связи</h2><p style="color:#8b93a3">Приложение ещё не сохранено на этом устройстве.<br>Подключитесь к интернету и нажмите «Повторить».</p>
<button onclick="location.reload()" style="margin-top:14px;padding:12px 22px;border:0;border-radius:12px;background:#ffc400;color:#111;font:600 16px sans-serif">Повторить</button></body>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'unpkg.com' || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'tessdata.projectnaptha.com') {
    e.respondWith(caches.open(C).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== self.location.origin || u.pathname.endsWith('version.json')) return;
  const nav = req.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html');
  const key = nav ? new URL('./index.html', self.registration.scope).href : req;
  e.respondWith(new Promise(res => {
    let done = false;
    const give = r => { if (!done && r) { done = true; res(r); } };
    const fromCache = () => caches.match(key, { ignoreSearch: true });
    const t = setTimeout(() => fromCache().then(give), 3000);
    fetch(req).then(r => {
      if (r.ok) { const cl = r.clone(); caches.open(C).then(c => c.put(key, cl)); }
      clearTimeout(t); give(r);
    }).catch(() => { clearTimeout(t); fromCache().then(h => give(h || (nav ? offline() : Response.error()))); });
  }));
});
