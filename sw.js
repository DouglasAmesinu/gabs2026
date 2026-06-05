const CACHE_NAME = 'gabs2026-v5';
const ASSETS = [
  '/gabs2026/',
  '/gabs2026/index.html',
  '/gabs2026/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if(
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('gstatic.com') ||
    url.includes('googleapis.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('fonts.')
  ){
    e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503})));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/gabs2026/index.html'));
    })
  );
});
