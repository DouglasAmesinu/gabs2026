const CACHE_NAME='gabs2026-v6';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/gabs2026/','/gabs2026/index.html','/gabs2026/manifest.json']).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(u.includes('firestore')||u.includes('firebase')||u.includes('gstatic')||u.includes('googleapis')||u.includes('cdnjs')||u.includes('fonts.')){
    e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503})));return;
  }
  e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(!r||r.status!==200||r.type==='opaque')return r;const cl=r.clone();caches.open(CACHE_NAME).then(ca=>ca.put(e.request,cl));return r;}).catch(()=>caches.match('/gabs2026/index.html'));}));
});
