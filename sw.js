const CACHE_NAME='gabs2026-v13';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/','index.html','manifest.json']).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const url=e.request.url;
  if(!url.startsWith('http'))return;
  if(url.includes('/ics?'))return;
  if(url.includes('firestore')||url.includes('firebase')||url.includes('gstatic')||url.includes('googleapis')||url.includes('cdnjs')||url.includes('fonts.')||url.includes('emailjs')||url.includes('cloudfunctions.net')){
    e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503})));return;
  }
  if(e.request.mode==='navigate'||url.endsWith('index.html')||url.endsWith('gabsconnect.com/')||url.endsWith('gabsconnect.com')){
    e.respondWith(fetch(e.request,{cache:'no-cache'}).then(res=>{const clone=res.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,clone));return res;}).catch(()=>caches.match('/')||caches.match('index.html')));return;
  }
  e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(res=>{if(!res||res.status!==200||res.type==='opaque')return res;const clone=res.clone();caches.open(CACHE_NAME).then(ca=>ca.put(e.request,clone));return res;}).catch(()=>caches.match('/'));}));
});
// ── Push alerts ──────────────────────────────────────────────────────────────
// Data-only FCM messages: {title, body, tag, url, kind}, all strings, under p.data.
const PUSH_ICON='/icon-192.png';
// iPadOS reports a Mac user agent and a worker cannot see touch support, so Safari on a Mac counts too
const isIOS=()=>{const ua=self.navigator.userAgent;return /iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&/Safari/.test(ua)&&!/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua));};
// Only same-origin paths; anything else opens the app's start page
const safePath=u=>typeof u==='string'&&u.startsWith('/')&&!u.startsWith('//')?u:'/';
self.addEventListener('push',e=>{
  let p={};
  try{p=e.data?e.data.json():{};}catch(err){p={};}
  const d=(p&&typeof p.data==='object'&&p.data)||p||{};
  const str=v=>typeof v==='string'?v:'';
  const title=str(d.title)||'GABS Connect';
  const opts={body:str(d.body),tag:str(d.tag)||undefined,data:{url:safePath(d.url)},icon:PUSH_ICON,badge:PUSH_ICON,renotify:false};
  e.waitUntil((async()=>{
    // iOS requires every push to show a notification; elsewhere skip it while the app is in front
    if(!isIOS()){
      const wins=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      if(wins.some(c=>c.focused&&c.visibilityState==='visible'))return;
    }
    await self.registration.showNotification(title,opts);
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=safePath(e.notification.data&&e.notification.data.url);
  e.waitUntil((async()=>{
    const wins=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const win=wins.find(c=>c.focused)||wins[0];
    if(win){
      try{await win.focus();}catch(err){}
      win.postMessage({type:'open-chat',url});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
