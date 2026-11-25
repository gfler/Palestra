// sw.js — cache offline dell'app (shell) e dei file pesanti di MediaPipe (WASM + modello).
const VERSION = 'v2';
const SHELL_CACHE = `fulcro-shell-${VERSION}`;
const RUNTIME_CACHE = `fulcro-runtime-${VERSION}`;
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'biomechanics.js', 'poseEngine.js', 'hudRenderer.js',
  'sheetsSync.js', 'training.js', 'dom.js', 'store.js', 'exdb.js', 'charts.js', 'exDetail.js', 'viewTrain.js', 'viewPrograms.js', 'viewStats.js', 'viewCoach.js', 'coach.js', 'nav.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
// Solo risorse statiche: mai le API di Google (Sheets, Gemini, login), che devono passare sempre dalla rete.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'];
const isModel = (url) => url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/mediapipe-models/');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).catch(() => caches.match('index.html')));
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (isModel(url) || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
});
