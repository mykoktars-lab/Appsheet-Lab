const CACHE = 'labstock-v3';
const ASSETS = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon.png', './logo.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  const mine = u.origin === location.origin, lib = u.hostname === 'www.gstatic.com' || u.hostname === 'cdnjs.cloudflare.com';
  if (!mine && !lib) return;                       // Firestore/Auth tidak lewat cache
  const store = res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; };
  if (lib) { e.respondWith(caches.match(e.request).then(h => h || fetch(e.request).then(store))); return; }
  e.respondWith(fetch(e.request).then(store).catch(() => caches.match(e.request).then(h => h || caches.match('./index.html'))));
});
