'use strict';
/* オフライン用: 開いたページと部品を端末に保存。ネットがあれば最新を優先。外部サイトは保存しない。 */
const CACHE = 'tp-v2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'data/ideas.json', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = url.origin + url.pathname; // ?以降は保存の名前に使わない
  e.respondWith(
    // 古い控えを使わないよう、毎回サーバーに確認する(オフラインのときだけ保存分を使う)
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
