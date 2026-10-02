// AVO FLOW service worker: ให้เปิดแอปได้ตอนไม่มีสัญญาณ และติดตั้งเป็นแอปบนมือถือได้
// ไฟล์ของแอป: ใช้จากเน็ตก่อน (ได้รุ่นล่าสุดเสมอ) ถ้าออฟไลน์ใช้สำเนาในเครื่อง
// ข้อมูลจากฐานข้อมูล (Neon/Supabase) ไม่ผ่าน service worker — จัดการในแอป (offline.js)
const CACHE = 'avoflow-v5';
const CDN = /(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  } else if (CDN.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
