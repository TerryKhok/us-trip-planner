'use strict';
/* ライブ共有: 同期の仕組み。画面に依存しない。
   - 部屋のカギ(token)は端末で作る。サーバーには SHA-256 の値だけが残る(サーバー側で計算)。
   - 通信は Supabase の関数(room_read / room_version / room_write / room_delete)を fetch で呼ぶだけ。
   - 手元のデータは常に端末に保存(オフラインでも使える)。つながったら取り込んで合体し、書き戻す。 */
const TPSync = (() => {
  const TOKEN_RE = /^[A-Za-z0-9_-]{22,100}$/;
  const isToken = s => typeof s === 'string' && TOKEN_RE.test(s);

  // 192ビットの乱数 → 32文字(base64url)
  function makeToken(cryptoObj) {
    const c = cryptoObj || crypto;
    const b = new Uint8Array(24);
    c.getRandomValues(b);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function sha256hex(str) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  class NetError extends Error {}

  // Supabase(PostgREST)の関数呼び出し。ネットの失敗は NetError を投げる。サーバーの返事({ok:false,...})はそのまま返す。
  function httpTransport(cfg, fetchFn) {
    const base = String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/';
    const headers = { 'Content-Type': 'application/json', apikey: cfg.key };
    if (/^eyJ/.test(cfg.key)) headers.Authorization = 'Bearer ' + cfg.key; // 旧形式(JWT)のキーだけ
    const f = fetchFn || ((u, o) => fetch(u, o));
    async function call(fn, body) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
      try {
        const r = await f(base + fn, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl && ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!r.ok) throw new NetError('http ' + r.status);
        const j = await r.json();
        if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') throw new NetError('bad response');
        return j;
      } catch (e) {
        throw e instanceof NetError ? e : new NetError(e && e.message ? e.message : 'network');
      } finally { if (timer) clearTimeout(timer); }
    }
    return {
      read: t => call('room_read', { p_token: t }),
      version: t => call('room_version', { p_token: t }),
      write: (t, doc, expected) => call('room_write', { p_token: t, p_doc: doc, p_expected: expected }),
      del: t => call('room_delete', { p_token: t }),
    };
  }

  /* 同期エンジン。opts:
     L: TPLogic / transport / getState() / applyState(state) / onStatus(status, info)
     isVisible(): 画面が見えているか / setT, clearT: タイマー(テストで差し替える) / pollMs: 見ている間の確認間隔 */
  function createEngine(opts) {
    const { L, transport, getState, applyState } = opts;
    const onStatus = opts.onStatus || (() => {});
    const setT = opts.setT || ((f, ms) => setTimeout(f, ms));
    const clearT = opts.clearT || (t => clearTimeout(t));
    const isVisible = opts.isVisible || (() => true);
    const pollMs = opts.pollMs || 4000;
    const debounceMs = opts.debounceMs == null ? 500 : opts.debounceMs;
    const MAX_ATTEMPTS = 8;

    let token = null, lastVersion = -1, serverKey = null, blockedKey = null;
    let running = false, busy = null, again = false, timer = null, debounce = null, failures = 0;
    let status = 'local', lastNetError = '';
    const stats = { versionCalls: 0, reads: 0, writes: 0, conflicts: 0, netErrors: 0 };

    const setStatus = (s, info) => { status = s; onStatus(s, info); };

    function reset(t) { token = t; lastVersion = -1; serverKey = null; blockedKey = null; failures = 0; }
    function clearTimers() { if (timer) { clearT(timer); timer = null; } if (debounce) { clearT(debounce); debounce = null; } }

    // 1回分の同期: 確認 → (違えば)取り込んで合体 → (自分の方が新しければ)書き戻し。競合したらやり直す。
    async function cycle() {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const v = await transport.version(token); stats.versionCalls++;
        if (!v.ok) return remoteError(v.error);
        if (v.version !== lastVersion) {
          const r = await transport.read(token); stats.reads++;
          if (!r.ok) return remoteError(r.error);
          pull(r.version, r.doc);
        }
        const mine = L.docKey(getState());
        if (mine === serverKey) return 'idle';
        if (mine === blockedKey) return 'blocked'; // 大きすぎて断られた内容は、変わるまで送り直さない
        const w = await transport.write(token, L.toDoc(getState()), lastVersion); stats.writes++;
        if (w.ok) { lastVersion = w.version; serverKey = mine; blockedKey = null; return 'pushed'; }
        if (w.error === 'conflict') { stats.conflicts++; setStatus('conflict'); pull(w.version, w.doc); continue; }
        if (w.error === 'too_large' || w.error === 'bad_doc') blockedKey = mine;
        return remoteError(w.error);
      }
      return 'busy-conflict';
    }
    function pull(version, doc) {
      let remote = null;
      try { remote = L.sanitize(doc); } catch (e) { remote = null; } // 読めない書類は空として扱い、手元の内容で上書きして直す
      lastVersion = version;
      if (!remote) { serverKey = '(unreadable)'; return; }
      const local = getState();
      const merged = L.merge(local, remote).state;
      serverKey = L.docKey(remote);
      if (L.stable(merged) !== L.stable(local)) applyState(merged);
    }
    function remoteError(err) {
      if (err === 'not_found') { running = false; clearTimers(); setStatus('gone'); return 'gone'; }
      if (err === 'too_large') { setStatus('error', 'too_large'); return 'error'; }
      if (err === 'bad_token') { running = false; clearTimers(); setStatus('error', 'bad_token'); return 'error'; }
      setStatus('error', err || 'unknown');
      return 'error';
    }

    async function syncOnce() {
      if (!token) return 'local';
      if (busy) { again = true; return busy; }
      busy = (async () => {
        let result = 'idle';
        try {
          do {
            again = false;
            if (status !== 'conflict' && status !== 'error') setStatus('syncing');
            result = await cycle();
            if (result === 'idle' || result === 'pushed') { failures = 0; setStatus('online'); }
            else if (result === 'blocked') setStatus('error', 'too_large');
          } while (again && running !== false && token);
        } catch (e) {
          failures++; stats.netErrors++;
          lastNetError = e && e.message ? String(e.message) : 'network';
          setStatus('offline', lastNetError);
          result = 'offline';
        } finally { busy = null; }
        return result;
      })();
      return busy;
    }

    function nextDelay() { return failures ? Math.min(30000, pollMs * Math.pow(2, Math.min(failures, 3))) : pollMs; }
    function loop() {
      timer = null;
      if (!running || !token) return;
      if (!isVisible()) return; // 見えていない間は確認しない(wake で再開)
      syncOnce().then(() => { if (running && token && isVisible() && !timer) timer = setT(loop, nextDelay()); });
    }

    return {
      get status() { return status; },
      get token() { return token; },
      get version() { return lastVersion; },
      get failures() { return failures; },
      get lastNetError() { return lastNetError; },
      stats,
      isRunning: () => running,
      syncOnce,
      // 参加(合体は最初の同期で行う)
      join(t) { reset(t); running = true; clearTimers(); setStatus('syncing'); return syncOnce().then(r => { if (running && isVisible()) timer = setT(loop, nextDelay()); return r; }); },
      // 新しい部屋を作る。成功したら token を返す
      async create(t) {
        reset(t);
        const doc = L.toDoc(getState());
        const w = await transport.write(t, doc, 0); stats.writes++;
        if (!w.ok) { token = null; return w; }
        lastVersion = w.version; serverKey = L.docKey(getState());
        running = true; setStatus('online');
        if (isVisible()) timer = setT(loop, nextDelay());
        return w;
      },
      resume(t) { return this.join(t); },
      // 手元で変更があった。少し待ってからまとめて送る
      touch() {
        if (!running || !token) return;
        if (debounce) clearT(debounce);
        debounce = setT(() => { debounce = null; if (isVisible()) syncOnce(); }, debounceMs);
      },
      // 画面が見えるようになった / オンラインに戻った: すぐ確認して、定期確認を再開
      wake() {
        if (!running || !token) return Promise.resolve('local');
        if (timer) { clearT(timer); timer = null; }
        failures = 0;
        return syncOnce().then(r => { if (running && token && isVisible() && !timer) timer = setT(loop, nextDelay()); return r; });
      },
      stop() { running = false; clearTimers(); },
      leave() { running = false; clearTimers(); token = null; lastVersion = -1; serverKey = null; setStatus('local'); },
      async remove() {
        if (!token) return { ok: false, error: 'no_room' };
        const t = token;
        const r = await transport.del(t);
        if (r.ok) this.leave();
        return r;
      },
    };
  }

  return { BUILD: '2026-11-16-r4', isToken, makeToken, sha256hex, httpTransport, createEngine, NetError };
})();
