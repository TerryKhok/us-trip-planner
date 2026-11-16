'use strict';
/* オフライン用: 開いたページと部品を端末に保存。ネットがあれば最新を優先。外部サイトは保存しない。
   写真は、見たものだけを端末に保存する(最初の読み込みを軽くするため、写真は先に全部は保存しない)。
   【更新のとき】写真(img/*.jpg)や data/credits.json を変えたら、必ず下の CACHE の名前を変えること。
   写真は一度保存したら再確認しない(名前が変わると、古い保存が全部捨てられて入れ替わる)。 */
const CACHE = 'tp-v7';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'sync.js', 'config.js', 'data/ideas.json', 'data/credits.json', 'manifest.webmanifest', 'icon.svg', 'img/sf-006.jpg'];

self.addEventListener('install', e => {
  // 全部そろったときだけ入れる(ひとつでも取れなければ失敗して、古い版のまま)。HTTPの古い控えは使わず、毎回サーバーから取る。
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'reload' })).then(r => {
      if (!r.ok) throw new Error('precache ' + f + ' ' + r.status);
      return c.put(new URL(f, self.registration.scope).href, r);
    }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = url.origin + url.pathname; // ?以降は保存の名前に使わない
  const store = res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return res; };
  if (/\/img\/[^/]+\.jpg$/.test(url.pathname)) { // 写真: 保存があればそれを使う(写真は変わらない)
    e.respondWith(caches.match(key).then(r => r || fetch(req).then(store)));
    return;
  }
  e.respondWith(
    // 古い控えを使わないよう、毎回サーバーに確認する(オフラインのときだけ保存分を使う)
    fetch(req, { cache: 'no-cache' }).then(store)
      .catch(() => caches.match(key).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
