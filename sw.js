const CACHE_NAME='gabs2026-v14';
// App icon badge counter, kept in its own cache so it survives the worker being stopped and app updates
const BADGE_CACHE='gabs-badge',BADGE_KEY='/__badge';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/','index.html','manifest.json']).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==BADGE_CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
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
// ── App icon badge ───────────────────────────────────────────────────────────
// An integer 0-99 (above 99 shows 99); anything else is 0
const clampBadgeN=n=>Number.isInteger(n)?Math.min(99,Math.max(0,n)):0;
async function readBadge(){
  try{
    const r=await (await caches.open(BADGE_CACHE)).match(BADGE_KEY);
    if(!r)return 0;
    const d=await r.json();
    return clampBadgeN(d&&d.n);
  }catch(err){return 0;}
}
async function writeBadge(n){
  try{
    await (await caches.open(BADGE_CACHE)).put(BADGE_KEY,new Response(JSON.stringify({n:clampBadgeN(n)}),{headers:{'Content-Type':'application/json'}}));
  }catch(err){}
}
// The page sends its unread count ({type:"badge-set", n}) so this counter matches it
self.addEventListener('message',e=>{
  const d=e.data;
  if(!d||d.type!=='badge-set')return;
  const n=clampBadgeN(d.n);
  e.waitUntil((async()=>{
    await writeBadge(n);
    try{
      if(n>0){if('setAppBadge' in self.navigator)await self.navigator.setAppBadge(n);}
      else if('clearAppBadge' in self.navigator)await self.navigator.clearAppBadge();
    }catch(err){}
  })());
});
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
    const n=Math.min(99,(await readBadge())+1);
    await writeBadge(n);
    try{if('setAppBadge' in self.navigator)await self.navigator.setAppBadge(n);}catch(err){}
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
