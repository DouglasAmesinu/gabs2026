const CACHE_NAME='gabs2026-v8';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/gabs2026/','/gabs2026/index.html','/gabs2026/manifest.json']).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const url=e.request.url;
  // Skip non-http requests (chrome-extension etc)
  if(!url.startsWith('http'))return;
  if(url.includes('firestore')||url.includes('firebase')||url.includes('gstatic')||url.includes('googleapis')||url.includes('cdnjs')||url.includes('fonts.')){
    e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503})));return;
  }
  if(e.request.mode==='navigate'||url.endsWith('index.html')||url.endsWith('/gabs2026/')){
    e.respondWith(fetch(e.request).then(res=>{const clone=res.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,clone));return res;}).catch(()=>caches.match(e.request)));return;
  }
  e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(res=>{if(!res||res.status!==200||res.type==='opaque')return res;const clone=res.clone();caches.open(CACHE_NAME).then(ca=>ca.put(e.request,clone));return res;}).catch(()=>caches.match('/gabs2026/index.html'));}));
});
