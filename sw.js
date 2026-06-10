const CACHE_NAME = 'gabs2026-v7';
const SHELL = [
  '/gabs2026/',
  '/gabs2026/index.html',
  '/gabs2026/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always bypass SW for Firebase, fonts, CDN
  if (
    url.includes('firestore') ||
    url.includes('firebase') ||
    url.includes('gstatic') ||
    url.includes('googleapis') ||
    url.includes('cdnjs') ||
    url.includes('fonts.')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Network-first for HTML — always get latest, fall back to cache if offline
  if (e.request.mode === 'navigate' || url.endsWith('index.html') || url.endsWith('/gabs2026/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Update cache with fresh version
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/gabs2026/index.html'));
    })
  );
});
