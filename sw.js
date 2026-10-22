const CACHE_NAME='gabs2026-v19'; // Must match APP_VERSION in index.html: update them together on every release
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
// kind "announcement" shows the same way but never counts on the app icon badge.
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
// Shown whenever an alert's payload cannot be read or lacks its fields: a push must always show something
const genericAlert=()=>({body:'You have a new message',tag:'gabs-generic',renotify:true,data:{url:'/'},icon:PUSH_ICON,badge:PUSH_ICON});
self.addEventListener('push',e=>{
  e.waitUntil((async()=>{
    let title='GABS Connect',opts=genericAlert(),announcement=false;
    try{
      const p=e.data?e.data.json():null;
      const d=p&&typeof p==='object'?(p.data&&typeof p.data==='object'?p.data:p):null;
      const str=v=>typeof v==='string'?v:'';
      announcement=!!d&&d.kind==='announcement';
      if(d&&str(d.body)&&str(d.tag)){
        title=str(d.title)||'GABS Connect';
        // renotify with the tag: a newer alert from the same sender replaces the old one and still sounds
        opts={body:str(d.body),tag:str(d.tag),renotify:true,data:{url:safePath(d.url)},icon:PUSH_ICON,badge:PUSH_ICON};
      }
    }catch(err){}
    try{
      // iOS requires every push to show a notification; elsewhere skip it while the app is in front
      if(!isIOS()){
        const wins=await self.clients.matchAll({type:'window',includeUncontrolled:true});
        if(wins.some(c=>c.focused&&c.visibilityState==='visible'))return;
      }
    }catch(err){}
    try{await self.registration.showNotification(title,opts);}
    catch(err){try{await self.registration.showNotification('GABS Connect',genericAlert());}catch(err2){}}
    // The badge counts unread messages only, so an announcement leaves it alone
    if(announcement)return;
    try{
      const n=Math.min(99,(await readBadge())+1);
      await writeBadge(n);
      if('setAppBadge' in self.navigator)await self.navigator.setAppBadge(n);
    }catch(err){}
  })());
});
// The browser replaced or expired the push subscription: subscribe again with the same key if possible,
// and ask open pages to refresh and re-register their token
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil((async()=>{
    try{
      const key=e.oldSubscription&&e.oldSubscription.options&&e.oldSubscription.options.applicationServerKey;
      if(key&&!e.newSubscription)await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    }catch(err){}
    try{
      const wins=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      wins.forEach(c=>c.postMessage({type:'push-resubscribe'}));
    }catch(err){}
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
