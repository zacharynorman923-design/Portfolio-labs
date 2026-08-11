/* Portfolio Labs service worker — offline app shell + font caching.
   Bump VERSION on every release so clients discard the old cached shell. */
const VERSION = 'plabs-v9';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

/* Paths are relative to the SW scope (this folder). */
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/data.js',
  './js/providers.js',
  './js/stats.js',
  './js/optimize.js',
  './js/style.js',
  './js/charts.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Cache-first for the shell + fonts. Market-data API calls (cross-origin,
   not a font host) always go to the network so quotes stay fresh. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(cacheFirst(req, RUNTIME)); return; }
  if (url.origin !== self.location.origin) return; // let API requests pass through

  if (req.mode === 'navigate') {
    event.respondWith(cacheFirst(req, SHELL).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(cacheFirst(req, SHELL));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  try { const c = await caches.open(cacheName); c.put(request, response.clone()); } catch (e) {}
  return response;
}
