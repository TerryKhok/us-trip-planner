'use strict';
/* 旅のしおり: 画面部分。データは端末の localStorage に保存。外部通信は、ライブ共有を設定したときの Supabase だけ。 */
(() => {
  const BUILD = '2026-11-16-r2'; // logic.js / sync.js と同じ番号。ちがえば、古い部品が混ざっている
  if (typeof TPSync === 'undefined' || TPLogic.BUILD !== BUILD || TPSync.BUILD !== BUILD) {
    // 古い控えが残っていて、新旧の部品が混ざった。控えを捨てて、1回だけ読み込み直す(それでもだめなら案内を出す)
    let tried = false;
    try { tried = sessionStorage.getItem('tp.stale') === '1'; sessionStorage.setItem('tp.stale', '1'); } catch (e) { /* そのまま */ }
    if (tried) { const a = document.getElementById('app'); if (a) a.textContent = 'ページの一部が古いままです。ブラウザの更新ボタンで、もう一度読み込んでください。'; return; }
    const fresh = ['index.html', 'style.css', 'logic.js', 'sync.js', 'config.js', 'app.js'].map(f => fetch(f, { cache: 'reload' }).catch(() => null));
    const drop = typeof caches === 'object' ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => null) : null;
    const unreg = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).catch(() => null) : null;
    Promise.all([...fresh, drop, unreg]).then(() => location.reload());
    return;
  }
  try { sessionStorage.removeItem('tp.stale'); } catch (e) { /* そのまま */ } // 部品がそろっているので、次に混ざったときもう一度直せる
  const L = TPLogic;
  const KEY = { state: 'tp.state.v1', me: 'tp.me', tab: 'tp.tab', backup: 'tp.backup.v1', room: 'tp.room', backupJoin: 'tp.backup.join', seen: 'tp.seen' };
  // ライブ共有の設定(config.js)。空ならこの端末だけで使う(従来どおり)
  const CFG = window.TP_CONFIG || {};
  const LIVE_ON = (() => {
    try {
      const u = new URL(CFG.supabaseUrl);
      const localOk = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
      return !!CFG.supabaseAnonKey && (u.protocol === 'https:' || localOk);
    } catch (e) { return false; }
  })();
  const IN_LINE = /\bLine\//i.test(navigator.userAgent || ''); // LINEアプリの中のブラウザ
  const TRIP_NAME = 'アメリカ卒業旅行';
  const COVER_ID = 'sf-006'; // 表紙の写真(ゴールデン・ゲート・ブリッジ)
  const MAX_PEOPLE = 10;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const CAT_JP = { food: '食事', sight: '観光', activity: '体験', shopping: '買い物', nature: '自然', nightlife: '夜遊び', transport: '移動', other: 'その他' };
  const CAT_ICON = { food: 'utensils', sight: 'camera', activity: 'ticket', shopping: 'shopping-bag', nature: 'trees', nightlife: 'moon-star', transport: 'train-front', other: 'map-pin' };
  const CITY_JP = { 'San Francisco': 'サンフランシスコ', 'Los Angeles': 'ロサンゼルス', 'San Diego': 'サンディエゴ' };
  const CITY_EN = Object.fromEntries(Object.entries(CITY_JP).map(([k, v]) => [v, k]));
  const cityLabel = c => CITY_JP[c] || c;
  const KIND_JP = { meta: '年・為替レート', days: '都市', items: '旅程の予定', ideas: '候補', people: 'プロフィール', expenses: '支払い', checks: 'チェックリスト' };
  const TYPE_JP = { add: '追加', update: '変更', delete: '削除', votes: '投票' };
  const TABS = ['itinerary', 'ideas', 'budget', 'checks', 'share'];

  // ---- ツアーの日程（ユーザー提供の情報。航空便・時刻・ホテル名は載せない）----
  const DAY_CITY = ['サンフランシスコ', 'サンフランシスコ', 'サンフランシスコ', 'サンフランシスコ → ロサンゼルス',
    'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', '日本'];
  const FREE_NOTE = 'やりたいことは「候補」から入れられます';
  const PLAN = [
    ['t01', 1, 'fixed', '日本を出発（同じ日にサンフランシスコへ到着）', '日付変更線のため同じ日に着きます'],
    ['t02', 1, 'fixed', 'サンフランシスコ 半日観光（ツアー）', ''],
    ['t03', 2, 'free', '自由時間', FREE_NOTE],
    ['t04', 3, 'free', '自由時間', FREE_NOTE],
    ['t05', 4, 'fixed', '午後の便でロサンゼルスへ移動', ''],
    ['t06', 4, 'fixed', '企業研修（ツアー）', ''],
    ['t07', 5, 'free', '自由時間', FREE_NOTE],
    ['t08', 6, 'free', '自由時間', FREE_NOTE],
    ['t09', 7, 'free', '自由時間', FREE_NOTE],
    ['t10', 8, 'free', '自由時間', FREE_NOTE],
    ['t11', 9, 'fixed', '帰国便（空港へは早めに）', '移動日。自由時間はほぼありません'],
    ['t12', 10, 'fixed', '日本に到着（この日は移動だけ）', '移動日（日付変更線で1日進みます）'],
  ];
  const CHECKS = [
    ['c-before-01', 'before', 'パスポートの有効期限を確認する'],
    ['c-before-02', 'before', 'ESTA（電子渡航認証）の申請・承認を確認する'],
    ['c-before-03', 'before', '海外旅行保険の加入を確認する'],
    ['c-before-04', 'before', 'スマホの通信（eSIM・ローミング）を準備する'],
    ['c-before-05', 'before', 'クレジットカードの海外利用設定を確認する'],
    ['c-before-06', 'before', 'ドルの現金を少し用意する'],
    ['c-before-07', 'before', 'ツアー会社に自由行動のルール・集合時間を確認する'],
    ['c-before-08', 'before', '家族に日程を伝える'],
    ['c-pack-09', 'pack', '重ね着できる服（朝晩は冷えます）'],
    ['c-pack-10', 'pack', '薄手のダウンかコート'],
    ['c-pack-11', 'pack', '雨具（冬は雨の日もあります）'],
    ['c-pack-12', 'pack', '歩きやすい靴'],
    ['c-pack-13', 'pack', '充電器・モバイルバッテリー（機内持ち込み）'],
    ['c-pack-14', 'pack', '常備薬・マスク'],
    ['c-pack-15', 'pack', '日焼け止め・サングラス'],
    ['c-book-16', 'book', '人気スポットの入場チケットが必要か調べる'],
    ['c-book-17', 'book', '人気レストランの予約を考える'],
    ['c-book-18', 'book', '空港⇄市内の移動手段（配車アプリ・電車・バス）を調べる'],
    ['c-book-19', 'book', '友だちとの集合場所・連絡方法を決める'],
  ];
  const CHECK_GROUP_JP = { before: '出発前にやること', pack: '持ち物（西海岸の冬）', book: '予約・手配' };

  function defaults() {
    return {
      days: DAY_CITY.map((city, i) => ({ id: 'd' + (i + 1), city, u: 0 })),
      items: PLAN.map(([id, day, type, title, note]) => ({ id, day: 'd' + day, time: '', title, place: '', note, type, u: 0 })),
      checks: CHECKS.map(([id, group, text]) => ({ id, group, text, done: false, u: 0 })),
    };
  }

  // ---- 保存 ----
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 何もしない */ } },
  };
  let state = null, me = '', tab = 'itinerary', prevTab = 'itinerary', ideasMsg = '', saveWarned = false;
  let engine = null, applying = false, syncStatus = 'local', syncInfo = '', pendingRender = false;
  let fCity = '', fCat = '', fTag = '', checkEdit = false;
  let credits = {};
  const PRICE_ASOF = '2026年時点'; // 確認済みの金額を調べた年(データの注記による)
  const TAG_MARK = { games: ['gamepad-2', 'ゲーム'], movies: ['clapperboard', '映画'] };

  function load() {
    const raw = ls.get(KEY.state);
    if (raw) {
      try { state = L.sanitize(JSON.parse(raw)); } catch (e) {
        ls.set(KEY.state + '.broken', raw); // 壊れたデータは消さずに退避
        state = null;
        setTimeout(() => toast('保存データを読めなかったため、初期状態から始めます'), 300);
      }
    }
    if (!state) state = L.emptyState();
    L.seedMissing(state, defaults());
    me = (ls.get(KEY.me) || '').trim().slice(0, 30);
    const t = ls.get(KEY.tab);
    if (TABS.includes(t)) tab = t;
  }
  function save() {
    const ok = ls.set(KEY.state, JSON.stringify(state));
    if (!ok && !saveWarned) {
      saveWarned = true;
      toast('この端末に保存できません（プライベートブラウズ？）。「ファイルに保存」で控えを残してください');
    }
    if (ok && !applying && engine) engine.touch(); // 共有プランに入っているときは、少し待ってから送る
    return ok;
  }

  // ---- 小さな部品 ----
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (['checked', 'selected', 'disabled', 'required', 'readOnly', 'hidden'].includes(k)) el[k] = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  // Lucide アイコン(index.html の中のスプライトを参照)
  const SVGNS = 'http://www.w3.org/2000/svg';
  function ic(name, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.append(u);
    return s;
  }
  const btn = (text, onclick, cls, extra, icon) => h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, extra), icon ? ic(icon) : null, text);
  const iconBtn = (icon, label, onclick, cls) => h('button', { type: 'button', class: 'btn icon ' + (cls || ''), 'aria-label': label, title: label, onclick }, ic(icon));
  const field = (label, input, hint) => h('label', { class: 'f' }, h('span', { text: label }), input, hint ? h('small', { class: 'hint', text: hint }) : null);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  function toast(msg) {
    const box = document.getElementById('toast');
    const el = h('div', { text: msg });
    box.append(el);
    setTimeout(() => el.remove(), 4800);
  }

  function modal(title, body, actions) {
    return new Promise(resolve => {
      let done = false;
      const err = h('p', { class: 'err', role: 'alert' });
      const setErr = m => { err.textContent = m || ''; };
      const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'dlg-title' });
      const finish = v => { if (done) return; done = true; if (dlg.open && typeof dlg.close === 'function') dlg.close(); dlg.remove(); resolve(v); };
      const buttons = actions.map((a, i) => h('button', {
        type: i === actions.length - 1 ? 'submit' : 'button', class: a.cls || 'btn',
        onclick: i === actions.length - 1 ? null : () => run(a), text: a.label,
      }));
      const run = a => { const r = a.onClick ? a.onClick(setErr) : true; if (r !== false) finish(a.value); };
      const form = h('form', { onsubmit: e => { e.preventDefault(); run(actions[actions.length - 1]); } },
        typeof body === 'function' ? body(finish) : body, err, h('div', { class: 'actions' }, buttons));
      dlg.append(h('h2', { id: 'dlg-title', text: title }), form);
      dlg.addEventListener('close', () => finish(null));
      document.body.append(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else { dlg.setAttribute('open', ''); dlg.classList.add('fb'); } // 古いブラウザ用: 画面の上に重ねて表示
    });
  }
  const confirmDlg = (msg, okLabel, danger) => modal('確認', h('p', { text: msg }), [
    { label: 'やめる', value: false },
    { label: okLabel || 'OK', cls: 'btn ' + (danger ? 'danger' : 'primary'), value: true },
  ]).then(v => v === true);

  // ---- 時間の言い方(「2時間前」など) ----
  function ago(ms) {
    if (!ms) return '';
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'たった今';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    if (s < 7 * 86400) return Math.floor(s / 86400) + '日前';
    const d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // ---- データ操作 ----
  const live = kind => state[kind].filter(e => !e.deleted);
  const livePeople = () => live('people').map(p => p.name).sort();
  const HAS_ED = ['items', 'ideas', 'expenses'];
  function upsert(kind, obj) {
    const c = L.cleanOne(kind, obj);
    if (!c) return false;
    const arr = state[kind];
    const i = arr.findIndex(x => x.id === c.id);
    c.u = Math.max(Date.now(), i >= 0 ? arr[i].u + 1 : 0);
    if (HAS_ED.includes(kind) && me) c.ed = me; // 最後に直した人(いちばん新しい編集の人)
    if (HAS_ED.includes(kind)) c.bu = c.by ? (i >= 0 && arr[i].bu ? arr[i].bu : c.u) : 0; // 作った時刻: 最初の1回だけ決めて、あとは変えない
    if (i >= 0) arr[i] = c; else arr.push(c);
    save(); render();
    return true;
  }
  function removeEntity(kind, id) {
    const arr = state[kind];
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return;
    arr[i] = L.cleanOne(kind, { id, deleted: true, u: Math.max(Date.now(), arr[i].u + 1), by: arr[i].by, bu: arr[i].bu, ed: me || arr[i].ed, v: arr[i].v });
    save(); render();
  }
  function setMeta(changes) {
    const m = Object.assign({}, state.meta, changes);
    if ('year' in changes) m.yu = Math.max(Date.now(), state.meta.yu + 1);
    if ('rate' in changes) m.ru = Math.max(Date.now(), state.meta.ru + 1);
    state.meta = m;
    save(); render();
  }
  // ---- プロフィール（名前＋アイコン）。パスワードなし。友だち同士用で、安全のための仕組みではない ----
  const profile = name => live('people').find(p => p.name === name);
  const who = name => (profile(name) ? profile(name).icon + ' ' : '') + name;
  function setMe(name) { me = name; ls.set(KEY.me, name); render(); }
  function normalizeMe() { if (me && !profile(me)) { me = ''; ls.set(KEY.me, ''); } }
  function chooseProfile(switchTo, welcome) {
    let icon = L.PROFILE_ICONS[0];
    const name = h('input', { type: 'text', maxlength: 30, placeholder: '例: ゆうた', autocomplete: 'off', 'aria-label': '名前' });
    const iconBtns = L.PROFILE_ICONS.map(ic2 => h('button', {
      type: 'button', class: 'icon-btn' + (ic2 === icon ? ' on' : ''), 'aria-pressed': String(ic2 === icon), 'aria-label': 'アイコン ' + ic2,
      onclick: () => { icon = ic2; iconBtns.forEach(b => { const on = b.textContent === ic2; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); },
    }, ic2));
    return modal(welcome ? 'ようこそ、旅のしおりへ' : switchTo ? 'あなたの名前は？' : 'メンバーを追加', finish => {
      const existing = live('people').slice().sort((x, y) => (x.name < y.name ? -1 : 1));
      return h('div', null,
        welcome ? h('p', { class: 'lead', text: '友だちとは、LINEで送るリンクで一緒に使えます。まずは、名前とアイコンを決めましょう。' }) : null,
        switchTo && existing.length ? h('div', null, h('h3', { text: 'いるメンバーから選ぶ' }),
          h('div', { class: 'chips' }, existing.map(p => h('button', { type: 'button', class: 'btn small' + (p.name === me ? ' primary' : ''), onclick: () => { setMe(p.name); finish(true); } }, p.icon + ' ' + p.name)))) : null,
        h('h3', { text: switchTo && existing.length ? '新しく作る' : '名前とアイコン' }),
        field('名前', name),
        h('p', { class: 'small', text: 'アイコンを選ぶ' }), h('div', { class: 'icons' }, iconBtns),
        h('p', { class: 'hint', text: 'パスワードはなく、だれでも好きな名前を選べます。友だち同士で「だれが決めたか」が分かるための仕組みで、なりすまし防止ではありません。同じ名前を入れると、アイコンだけ更新されます。' }));
    }, [
      { label: welcome ? 'あとで' : 'やめる', value: false },
      {
        label: welcome ? 'はじめる' : switchTo ? '決める' : '追加する', cls: 'btn primary', value: true,
        onClick: setErr => {
          const n = name.value.trim().slice(0, 30);
          if (!n) { setErr('名前を入れてください'); return false; }
          if (!profile(n) && live('people').length >= MAX_PEOPLE) { setErr('メンバーは最大' + MAX_PEOPLE + '人までです'); return false; }
          upsert('people', { name: n, icon });
          if (switchTo) setMe(n);
        },
      },
    ]);
  }
  function needProfile() {
    normalizeMe();
    return me ? Promise.resolve(me) : chooseProfile(true).then(() => me);
  }

  const dayLabel = n => {
    const d = L.dayDate(state.meta.year, n);
    return n + '日目 ' + d.m + '/' + d.d + '(' + WD[d.w] + ')';
  };
  const dateLabel = n => { const d = L.dayDate(state.meta.year, n); return d.m + '/' + d.d + '（' + WD[d.w] + '）'; };
  const dayCity = n => { const d = state.days.find(x => x.id === 'd' + n); return d && !d.deleted ? d.city : ''; };
  const rate = () => state.meta.rate;
  const money = cents => L.fmtUSD(cents) + (rate() ? '（約' + L.fmtJPY(cents, rate()) + '）' : '');
  // ドルは大きく、円は小さく(文の流れをじゃましない)
  const moneyEl = cents => h('span', { class: 'money' }, h('span', { class: 'usd', text: L.fmtUSD(cents) }), rate() ? h('span', { class: 'jpy', text: '（約' + L.fmtJPY(cents, rate()) + '）' }) : null);
  const extLink = (url, text, icon) => { const u = L.safeUrl(url); return u ? h('a', { class: 'lnk', href: u, target: '_blank', rel: 'noopener noreferrer' }, icon ? ic(icon) : null, text) : null; };
  const mapLink = (q, text) => h('a', { class: 'lnk', href: L.mapUrl(q), target: '_blank', rel: 'noopener noreferrer' }, ic('map-pin'), text || '地図で見る');
  const centsToInput = c => Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');

  // 「だれが・いつ」を文にする。作った人と、いちばん最後に直した人は別々に出す
  function byLine(e, fallbackCreator) {
    const parts = [];
    if (e.by) parts.push(who(e.by) + 'さんが追加'); else if (fallbackCreator) parts.push(fallbackCreator);
    if (e.ed && e.ed !== e.by) parts.push(who(e.ed) + 'さんが直した');
    const t = ago(e.u);
    if (t) parts.push(t);
    return parts.join(' · ');
  }

  // 写真(Wikimedia Commons の自由な画像)。クレジットを必ず表示する。写真がないときは色のブロックにする。
  function creditLine(id) {
    const c = credits[id];
    if (!c) return null;
    return h('figcaption', { class: 'cr' },
      c.caption ? h('span', { class: 'cap', text: c.caption }) : null, // 別の(近くの・姉妹の)場所の写真のときの注記
      h('span', null, '写真: ' + (c.author || '作者不明') + ' / ',
        c.licenseUrl ? h('a', { href: c.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, c.license) : c.license,
        ' / ', h('a', { href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Commonsの写真ページ'), c.modified ? '（大きさを変更）' : ''));
  }
  function photoBlock(id, title, category, city) {
    const blank = () => h('div', { class: 'ph ph-none', 'aria-hidden': 'true' }, ic(CAT_ICON[category] || 'map-pin', 'big'), h('span', { text: cityLabel(city || '') }));
    if (!credits[id]) return blank();
    const img = h('img', { src: 'img/' + id + '.jpg', alt: title + 'の写真', loading: 'lazy', decoding: 'async', width: 640, height: 360 });
    const fig = h('figure', { class: 'ph' }, img, creditLine(id));
    img.addEventListener('error', () => fig.replaceWith(blank())); // 壊れた画像のマークは出さない
    return fig;
  }

  // ================= 旅程 =================
  function viewItinerary() {
    const root = h('div', { class: 'stack' });
    root.append(h('datalist', { id: 'cities' }, h('option', { value: 'サンフランシスコ' }), h('option', { value: 'ロサンゼルス' })));
    for (let n = 1; n <= 10; n++) root.append(dayCard(n));
    const yearIn = h('input', {
      id: 'yr', type: 'number', min: 2000, max: 2100, value: state.meta.year,
      onchange: e => { const y = parseInt(e.target.value, 10); if (y >= 2000 && y <= 2100) setMeta({ year: y }); else { toast('年は2000〜2100で入れてください'); render(); } },
    });
    root.append(h('section', { class: 'card soft' },
      h('div', { class: 'row' }, h('label', { for: 'yr', class: 'grow-0', text: '旅行の年' }), h('div', { class: 'grow' }, yearIn)),
      h('p', { class: 'hint', text: '日付がちがうときは、ここで年を直せます（いまは' + state.meta.year + '年。1/31は' + WD[L.dayDate(state.meta.year, 1).w] + '曜です）。' })));
    root.append(footerLinks());
    return root;
  }
  function footerLinks() {
    return h('p', { class: 'foot' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => go('about') }, ic('info'), 'このサイトについて'));
  }
  function dayCard(n) {
    const id = 'd' + n;
    const items = live('items').filter(i => i.day === id)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
    const hasFree = items.some(i => i.type === 'free');
    const stops = items.map(i => i.mapQuery || i.place).filter(Boolean);
    const route = L.routeUrl(stops);
    const city = h('input', {
      class: 'city', type: 'text', list: 'cities', maxlength: 40, value: dayCity(n), placeholder: '都市（未定）', 'aria-label': n + '日目の都市',
      onchange: e => upsert('days', { id, city: e.target.value }),
    });
    const foot = h('div', { class: 'day-foot' },
      route ? h('a', { class: 'btn soft wide', href: route, target: '_blank', rel: 'noopener noreferrer' }, ic('route'), 'この日の順路を地図で開く')
        : (stops.length === 1 ? h('p', { class: 'one-stop' }, mapLink(stops[0], 'この日の場所を地図で見る')) : null),
      h('div', { class: 'row gap' },
        btn('予定を足す', () => needProfile().then(m => m && itemForm(null, id)), '', null, 'plus'),
        btn('候補から入れる', () => go('ideas'), 'ghost', null, 'lightbulb')));
    return h('section', { class: 'card day', 'aria-label': dayLabel(n) },
      h('div', { class: 'day-head' },
        h('div', { class: 'day-no' }, h('span', { class: 'n', text: String(n) }), h('span', { class: 'u', text: '日目' })),
        h('div', { class: 'day-meta' }, h('span', { class: 'date', text: dateLabel(n) }), !items.length ? h('span', { class: 'chip', text: '予定なし' }) : hasFree ? h('span', { class: 'chip free', text: '自由時間あり' }) : h('span', { class: 'chip fixed', text: 'ツアー中心' }))),
      city,
      items.length ? h('ul', { class: 'plain items' }, items.map(itemRow))
        : h('div', { class: 'empty' }, h('p', { class: 'empty-t', text: 'この日はまだ空いています' }), h('p', { class: 'hint', text: '候補から入れるか、自分で足せます。' })),
      foot);
  }
  function itemRow(it) {
    const idea = it.src ? state.ideas.find(i => i.id === it.src && !i.deleted) : null;
    const q = it.mapQuery || it.place;
    const line = byLine(it);
    return h('li', { class: 'item ' + it.type },
      it.src && credits[it.src] ? photoBlock(it.src, it.title, idea ? idea.category : 'other', idea ? idea.city : '') : null,
      h('div', { class: 'item-main' },
        h('div', { class: 'item-top' }, h('span', { class: 'time', text: it.time || '時間は未定' }), h('span', { class: 'chip ' + it.type, text: it.type === 'fixed' ? 'ツアー' : '自由時間' })),
        h('h4', { class: 'item-title', text: it.title }),
        (it.place || q) ? h('p', { class: 'place' }, it.place ? it.place + '　' : '', q ? mapLink(q) : null) : null,
        it.note ? h('p', { class: 'note', text: it.note }) : null,
        line ? h('p', { class: 'by', text: line }) : null),
      h('div', { class: 'item-ops' },
        iconBtn('pencil', it.title + 'を直す', () => itemForm(it, it.day)),
        iconBtn('trash', it.title + 'を消す', async () => { if (await confirmDlg('「' + it.title + '」を消しますか？', '消す', true)) removeEntity('items', it.id); }, 'danger')));
  }
  function itemForm(item, dayId) {
    const it = item || { id: L.newId('i'), day: dayId, time: '', title: '', place: '', mapQuery: '', note: '', type: 'free', src: '', by: me };
    const day = h('select', null, range(1, 10).map(n => h('option', { value: 'd' + n, selected: 'd' + n === it.day, text: dayLabel(n) })));
    const time = h('input', { type: 'time', value: it.time });
    const type = h('select', null, h('option', { value: 'free', selected: it.type === 'free', text: '自由時間' }), h('option', { value: 'fixed', selected: it.type === 'fixed', text: 'ツアーの予定' }));
    const title = h('input', { type: 'text', maxlength: 100, value: it.title, required: true });
    const place = h('input', { type: 'text', maxlength: 150, value: it.place, placeholder: '例: サンタモニカ・ピア' });
    const note = h('textarea', { maxlength: 500, value: it.note });
    return modal(item ? '予定を直す' : '予定を足す', h('div', null,
      field('日', day), field('時間（わからなければ空でOK）', time), field('種類', type), field('タイトル', title),
      field('場所（地図リンクに使います）', place, '住所や予約情報は入れないでください'), field('メモ', note)), [
      { label: 'やめる', value: false },
      {
        label: '保存する', cls: 'btn primary', value: true,
        onClick: setErr => {
          if (!title.value.trim()) { setErr('タイトルを入れてください'); return false; }
          upsert('items', { id: it.id, day: day.value, time: time.value, title: title.value, place: place.value, mapQuery: (place.value.trim() === it.place && it.mapQuery) || '', note: note.value, type: type.value, src: it.src || '', by: it.by });
        },
      },
    ]);
  }

  // ================= アイデア =================
  const CHOICES = [['g', '行く', 'circle-check'], ['m', '迷う', 'help'], ['n', '行かない', 'circle-x']];
  const TIER_ORDER = { all: 0, split: 1, open: 2 };
  const addedDays = idea => live('items').filter(i => i.src === idea.id).map(i => i.day).filter((d, k, a) => a.indexOf(d) === k).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  // まだ決まっていない候補: 答えが出ていて、全員が行くではなく、まだ旅程に入っていないもの
  const undecidedCount = () => {
    const members = livePeople();
    return live('ideas').filter(i => { const a = L.agreement(i, members); return a.answered > 0 && a.tier !== 'all' && !addedDays(i).length; }).length;
  };
  function viewIdeas() {
    const root = h('div', { class: 'stack' });
    const all = live('ideas'), members = livePeople();
    const cities = [...new Set(all.map(i => i.city).filter(Boolean))].sort();
    const citySel = h('select', { 'aria-label': '都市で絞り込む', onchange: e => { fCity = e.target.value; render(); } },
      h('option', { value: '', text: 'すべての都市' }), cities.map(c => h('option', { value: c, selected: c === fCity, text: cityLabel(c) })));
    const catSel = h('select', { 'aria-label': 'カテゴリで絞り込む', onchange: e => { fCat = e.target.value; render(); } },
      h('option', { value: '', text: 'すべてのカテゴリ' }), L.CATEGORIES.map(c => h('option', { value: c, selected: c === fCat, text: CAT_JP[c] })));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'ジャンルで絞り込む' },
      [['', '全部', null], ['games', 'ゲーム', 'gamepad-2'], ['movies', '映画', 'clapperboard']].map(([v, text, icon]) => h('button', {
        type: 'button', class: 'seg-btn' + (fTag === v ? ' on' : ''), 'aria-pressed': String(fTag === v), onclick: () => { fTag = v; render(); },
      }, icon ? ic(icon) : null, text)));
    const rows = all.map((idea, i) => ({ idea, i, ag: L.agreement(idea, members) }))
      .filter(({ idea }) => (!fCity || idea.city === fCity) && (!fCat || idea.category === fCat) && (!fTag || (idea.tags || []).includes(fTag)))
      .sort((a, b) => TIER_ORDER[a.ag.tier] - TIER_ORDER[b.ag.tier] || b.ag.go - a.ag.go || a.i - b.i);
    const nAll = rows.filter(r => r.ag.tier === 'all').length, nSplit = rows.filter(r => r.ag.tier === 'split').length;
    root.append(h('section', { class: 'card tools' },
      h('h2', { class: 'sec', text: '行きたい場所を、みんなで決めよう' }),
      h('p', { class: 'lead', text: me ? who(me) + ' として答えています。「行く」「迷う」「行かない」を選んでね。' : '名前を決めると、「行く」「迷う」「行かない」で答えられます。' }),
      seg,
      h('div', { class: 'filters' }, citySel, catSel),
      h('p', { class: 'sum', text: rows.length + '件' + (nAll || nSplit ? '　・　全員が行く ' + nAll + '　・　意見が割れている ' + nSplit : '') }),
      h('div', { class: 'row gap' }, btn('候補を足す', () => needProfile().then(m => m && ideaForm(null)), 'soft', null, 'plus')),
      h('p', { class: 'hint', text: '金額は目安です。「目安・未確認」は、まだ確認していない金額です。' })));
    if (ideasMsg && !all.length) root.append(h('p', { class: 'hint', text: ideasMsg }));
    if (!rows.length) root.append(h('div', { class: 'card empty' }, h('p', { class: 'empty-t', text: '条件に合う候補がありません' }), h('p', { class: 'hint', text: '絞り込みを「全部」に戻してみてください。' })));
    rows.forEach(({ idea, ag }) => root.append(ideaCard(idea, ag, members)));
    root.append(footerLinks());
    return root;
  }
  function ideaCard(idea, ag, members) {
    const mine = me ? L.ballotMap(idea).get(me) || null : null;
    const bl = L.ballots(idea);
    const cost = idea.costUSD == null ? '費用: わからない'
      : idea.costUSD === 0 ? '無料'
        : '約$' + idea.costUSD + (rate() ? '（約' + L.fmtJPY(Math.round(idea.costUSD * 100), rate()) + '）' : '');
    const estimate = !idea.verified && (idea.costUSD != null || /ドル/.test((idea.note || '') + (idea.tip || ''))); // 本文にドルの金額があるときも
    const asOf = idea.verified && idea.costUSD != null; // 確認済みの金額も、調べた年を出す
    const days = addedDays(idea);
    const vote = h('div', { class: 'vote', role: 'group', 'aria-label': idea.title + 'に行くか答える' },
      CHOICES.map(([c, label, icon]) => h('button', { type: 'button', class: 'vbtn v-' + c + (mine === c ? ' on' : ''), 'aria-pressed': String(mine === c), onclick: () => setAnswer(idea.id, c) }, ic(icon), label)));
    const faces = h('div', { class: 'faces' }, CHOICES.filter(([c]) => bl[c].length).map(([c, label]) =>
      h('p', { class: 'face-row' }, h('span', { class: 'fl v-' + c, text: label }), bl[c].map(n => h('span', { class: 'face', text: who(n) })))));
    const verdict = ag.tier === 'all' ? h('p', { class: 'verdict ok' }, ic('check'), '全員が行く')
      : ag.tier === 'split' ? h('p', { class: 'verdict split' }, ic('info'), '意見が割れています')
        : h('p', { class: 'verdict' }, ag.answered ? ag.answered + '人が答えました（メンバー' + members.length + '人）' : 'まだだれも答えていません');
    const line = byLine(idea, '下調べで追加');
    return h('article', { class: 'card idea' },
      photoBlock(idea.id, idea.title, idea.category, idea.city),
      h('div', { class: 'idea-body' },
        h('div', { class: 'idea-top' },
          h('p', { class: 'kicker' }, ic(CAT_ICON[idea.category] || 'map-pin'), [cityLabel(idea.city), idea.area].filter(Boolean).join(' ・ ')),
          h('div', { class: 'idea-ops' },
            iconBtn('pencil', idea.title + 'を直す', () => ideaForm(idea)),
            iconBtn('trash', idea.title + 'を消す', async () => { if (await confirmDlg('「' + idea.title + '」を消しますか？', '消す', true)) removeEntity('ideas', idea.id); }, 'danger'))),
        h('h3', { class: 'idea-title', text: idea.title }),
        h('p', { class: 'chips' },
          h('span', { class: 'chip', text: CAT_JP[idea.category] }),
          (idea.tags || []).filter(t => TAG_MARK[t]).map(t => h('span', { class: 'chip tag' }, ic(TAG_MARK[t][0]), TAG_MARK[t][1])),
          h('span', { class: 'chip', text: cost }),
          idea.duration ? h('span', { class: 'chip', text: idea.duration }) : null,
          estimate ? h('span', { class: 'chip warn', text: '目安・未確認' }) : null,
          asOf ? h('span', { class: 'chip', text: PRICE_ASOF }) : null),
        idea.note ? h('p', { class: 'note', text: idea.note }) : null,
        idea.bestTime ? h('p', { class: 'small', text: 'おすすめの時間: ' + idea.bestTime }) : null,
        idea.tip ? h('p', { class: 'small', text: 'ヒント: ' + idea.tip }) : null,
        vote, faces, verdict,
        h('div', { class: 'row gap acts' },
          btn('この日に入れる', () => needProfile().then(m => m && addToDay(idea)), 'primary', null, 'plus'),
          days.length ? h('span', { class: 'chip free', text: days.map(d => d.slice(1) + '日目').join('・') + 'に入っています' }) : null),
        h('div', { class: 'row gap links' },
          mapLink(idea.mapQuery || (idea.title + ' ' + idea.city).trim()),
          extLink(idea.link, '情報元を見る', 'external-link')),
        line ? h('p', { class: 'by', text: line }) : null));
  }
  async function setAnswer(id, choice) {
    if (!(await needProfile())) return;
    const idea = state.ideas.find(i => i.id === id);
    if (!idea || idea.deleted) return;
    const on = L.ballotMap(idea).get(me) !== choice; // 同じ答えをもう一度押すと取り消し
    idea.v = L.setVote(idea.v, me, on, Date.now(), choice);
    save(); render();
  }
  function addToDay(idea) {
    const def = idea.city === 'Los Angeles' ? 5 : 2;
    const day = h('select', null, range(1, 10).map(n => h('option', { value: 'd' + n, selected: n === def, text: dayLabel(n) + (dayCity(n) ? ' ' + dayCity(n) : '') })));
    const time = h('input', { type: 'time' });
    return modal('この日に入れる', h('div', null, h('p', { class: 'lead', text: idea.title }), field('日', day), field('時間（わからなければ空でOK）', time)), [
      { label: 'やめる', value: false },
      {
        label: '旅程に入れる', cls: 'btn primary', value: true,
        onClick: () => {
          upsert('items', { id: L.newId('i'), day: day.value, time: time.value, title: idea.title, place: idea.area ? idea.area : '', mapQuery: idea.mapQuery || (idea.title + ' ' + idea.city).trim(), note: idea.note, type: 'free', src: idea.id, by: me });
          toast(dayLabel(Number(day.value.slice(1))) + ' に入れました');
        },
      },
    ]);
  }
  function ideaForm(idea) {
    const it = idea || { id: L.newId('a'), title: '', city: '', category: 'food', costUSD: null, link: '', note: '', by: me, v: [] };
    const title = h('input', { type: 'text', maxlength: 100, value: it.title });
    const city = h('input', { type: 'text', maxlength: 40, list: 'idea-cities', value: cityLabel(it.city), placeholder: 'サンフランシスコ / ロサンゼルス' });
    const cat = h('select', null, L.CATEGORIES.map(c => h('option', { value: c, selected: c === it.category, text: CAT_JP[c] })));
    const cost = h('input', { type: 'text', inputmode: 'decimal', value: it.costUSD == null ? '' : String(it.costUSD), placeholder: '例: 25（わからなければ空でOK）' });
    const link = h('input', { type: 'url', maxlength: 500, value: it.link, placeholder: '例: 店の公式サイト' });
    const note = h('textarea', { maxlength: 500, value: it.note });
    return modal(idea ? '候補を直す' : '候補を足す', h('div', null,
      h('datalist', { id: 'idea-cities' }, h('option', { value: 'サンフランシスコ' }), h('option', { value: 'ロサンゼルス' })),
      field('タイトル', title), field('都市', city), field('カテゴリ', cat), field('費用の目安（ドル）', cost), field('リンク', link), field('メモ', note)), [
      { label: 'やめる', value: false },
      {
        label: '保存する', cls: 'btn primary', value: true,
        onClick: setErr => {
          if (!title.value.trim()) { setErr('タイトルを入れてください'); return false; }
          let c = null;
          if (cost.value.trim()) {
            const cents = L.parseMoney(cost.value);
            if (cents == null) { setErr('費用は数字で入れてください（例: 25 または 12.50）'); return false; }
            c = cents / 100;
          }
          const ct = city.value.trim();
          upsert('ideas', Object.assign({}, it, { title: title.value, city: CITY_EN[ct] || ct, category: cat.value, costUSD: c, verified: c === it.costUSD ? it.verified : false, link: link.value, note: note.value }));
        },
      },
    ]);
  }

  // ================= 予算 =================
  function viewBudget() {
    const root = h('div', { class: 'stack' });
    const people = livePeople();
    const exps = live('expenses');
    const rateIn = h('input', {
      type: 'text', inputmode: 'decimal', value: rate() ? String(rate()) : '', placeholder: '例: 150', 'aria-label': '1ドルは何円',
      onchange: e => {
        const t = e.target.value.normalize('NFKC').replace(/[,\s]/g, '');
        if (!t) return setMeta({ rate: null });
        const v = Number(t);
        if (v > 0 && v <= 100000) setMeta({ rate: v }); else { toast('レートは数字で入れてください'); render(); }
      },
    });

    if (!exps.length) {
      root.append(h('section', { class: 'card empty' },
        h('h2', { class: 'sec', text: '立て替えの記録' }),
        h('p', { class: 'empty-t', text: '立て替えはまだありません' }),
        h('p', { class: 'lead', text: 'ごはんや移動のお金を、だれが払ったか記録すると、最後に「だれが誰にいくら」を自動で出します。' }),
        people.length < 2 ? h('p', { class: 'hint', text: 'まず、下のメンバーを2人以上にしてください。' }) : null,
        btn('立て替えを記録する', () => needProfile().then(m => m && expenseForm(null)), 'primary', { disabled: people.length < 2 }, 'plus')));
    } else {
      const { total, rows } = L.summarize(exps);
      const names = [...rows.keys()].sort();
      const sets = L.settle(new Map(names.map(n => [n, rows.get(n).net])));
      root.append(h('section', { class: 'card hero-money' },
        h('p', { class: 'kicker', text: 'みんなの出費の合計' }),
        h('p', { class: 'big-num' }, moneyEl(total)),
        h('h2', { class: 'sec', text: '精算（送金は最少' + sets.length + '回）' }),
        sets.length ? h('ul', { class: 'plain xfers' }, sets.map(t => h('li', { class: 'xfer' }, h('span', { class: 'xw', text: who(t.from) }), h('span', { class: 'par' }, 'が'), h('span', { class: 'xw', text: who(t.to) }), h('span', { class: 'par' }, 'に'), h('span', { class: 'amt' }, moneyEl(t.cents), h('span', { class: 'par', text: ' 払う' })))))
          : h('p', { class: 'lead', text: '精算はいりません。ぴったりです。' }),
        h('p', { class: 'hint', text: '割り切れないときは、1セントをだれか1人に上乗せして合計を合わせています。' })));
      root.append(h('section', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', { class: 'sec', text: '立て替えた記録' }), btn('記録する', () => needProfile().then(m => m && expenseForm(null)), 'soft', { disabled: people.length < 2 }, 'plus')),
        h('ul', { class: 'plain pays' }, exps.slice().reverse().map(e => payRow(e))),
        h('details', { class: 'more' }, h('summary', { text: 'ひとりずつの内訳を見る' }),
          h('table', null,
            h('thead', null, h('tr', null, h('th', { text: '名前' }), h('th', { text: '払った' }), h('th', { text: '負担' }), h('th', { text: '差額' }))),
            h('tbody', null, names.map(n => {
              const r = rows.get(n);
              return h('tr', null, h('td', { text: who(n) }), h('td', { text: L.fmtUSD(r.paid) }), h('td', { text: L.fmtUSD(r.owed) }),
                h('td', { class: r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '', text: (r.net > 0 ? '+' : '') + L.fmtUSD(r.net) }));
            }))),
          h('p', { class: 'hint', text: '差額: ＋は受け取る、－は払う金額です。' }))));
    }

    root.append(h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'sec', text: 'メンバー（' + people.length + '/' + MAX_PEOPLE + '人）' }),
        btn('追加する', () => chooseProfile(false), 'soft', { disabled: people.length >= MAX_PEOPLE }, 'plus')),
      people.length ? h('div', { class: 'chips big' }, people.map(n => h('span', { class: 'chip person' }, who(n), h('button', { type: 'button', 'aria-label': n + 'を外す', onclick: () => removePerson(n) }, ic('x')))))
        : h('p', { class: 'lead', text: 'まだメンバーがいません。名前とアイコンを決めて、友だちも足しましょう。' }),
      null));
    root.append(h('section', { class: 'card soft' },
      h('h2', { class: 'sec', text: '為替レート（手入力）' }),
      h('div', { class: 'row' }, '1ドル =', h('div', { class: 'grow' }, rateIn), '円'),
      h('p', { class: 'hint', text: '自動では取得しません。円はおおよその目安です。ツアーに含まれる航空券・ホテルは入れず、自由時間の出費だけを記録します。' })));
    root.append(footerLinks());
    return root;
  }
  function payRow(e) {
    const sharers = e.split === 'custom' ? e.custom.map(p => p[0] + ' ' + L.fmtUSD(p[1])) : e.shares.map(n => n);
    const line = byLine(e);
    return h('li', { class: 'pay' },
      h('div', { class: 'pay-main' },
        h('h4', { class: 'pay-title', text: e.title }),
        h('p', { class: 'pay-sentence' }, h('strong', { text: who(e.payer) + 'さん' }), 'が ', h('strong', null, moneyEl(e.cents)), h('span', { class: 'nw', text: ' 立て替えた' })),
        h('p', { class: 'chips' }, h('span', { class: 'chip', text: e.split === 'custom' ? '金額を決めて分けた' : e.shares.length + '人で均等に' }), sharers.map(s => h('span', { class: 'chip', text: s }))),
        line ? h('p', { class: 'by', text: line }) : null),
      h('div', { class: 'item-ops' },
        iconBtn('pencil', e.title + 'を直す', () => expenseForm(e)),
        iconBtn('trash', e.title + 'を消す', async () => { if (await confirmDlg('「' + e.title + '」を消しますか？', '消す', true)) removeEntity('expenses', e.id); }, 'danger')));
  }
  async function removePerson(name) {
    const used = live('expenses').some(e => e.payer === name || e.shares.includes(name) || e.custom.some(p => p[0] === name));
    if (used) return toast(name + 'さんは立て替えの記録に使われています。先にその記録を直すか消してください');
    if (!(await confirmDlg(who(name) + ' をメンバーから外しますか？', '外す', true))) return;
    if (name === me) setMe('');
    removeEntity('people', 'p:' + name);
  }
  function expenseForm(exp) {
    const people = [...new Set([...livePeople(), ...(exp ? [exp.payer, ...exp.shares, ...exp.custom.map(p => p[0])] : [])])].sort();
    if (people.length < 2) return toast('先にメンバーを2人以上にしてください');
    const e0 = exp || { id: L.newId('e'), title: '', cents: 0, payer: people.includes(me) ? me : people[0], split: 'equal', shares: people, custom: [], by: me };
    const title = h('input', { type: 'text', maxlength: 100, value: e0.title, placeholder: '例: ランチ' });
    const amount = h('input', { type: 'text', inputmode: 'decimal', value: e0.cents ? centsToInput(e0.cents) : '', placeholder: '例: 48.50', oninput: () => updDiff() });
    const payer = h('select', null, people.map(n => h('option', { value: n, selected: n === e0.payer, text: who(n) })));
    const shareChecks = people.map(n => h('input', { type: 'checkbox', checked: e0.split === 'custom' ? true : e0.shares.includes(n), 'aria-label': n }));
    const customIns = people.map(n => {
      const p = e0.custom.find(x => x[0] === n);
      return h('input', { type: 'text', inputmode: 'decimal', value: p ? centsToInput(p[1]) : '', placeholder: '0.00', 'aria-label': n + 'の負担額', oninput: () => updDiff() });
    });
    const diff = h('p', { class: 'hint', 'aria-live': 'polite' });
    const mkRadio = (v, text) => h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'split', value: v, checked: e0.split === v, onchange: () => upd() }), text);
    const radios = [mkRadio('equal', '均等に分ける'), mkRadio('custom', '金額を決めて分ける')];
    const equalBox = h('div', null, h('p', { class: 'small', text: '負担する人（払った人本人も含めて選びます）' }),
      people.map((n, i) => h('label', { class: 'chk' }, shareChecks[i], who(n))));
    const customBox = h('div', null, h('p', { class: 'small', text: '一人ずつの負担額（ドル）。合計が支払い金額と同じになるようにします。' }),
      people.map((n, i) => h('label', { class: 'f' }, h('span', { text: who(n) }), customIns[i])), diff);
    const mode = () => radios[1].querySelector('input').checked ? 'custom' : 'equal';
    function updDiff() {
      const total = L.parseMoney(amount.value);
      let sum = 0, bad = false;
      customIns.forEach(i => { if (i.value.trim()) { const c = L.parseMoney(i.value); if (c == null) bad = true; else sum += c; } });
      if (bad) diff.textContent = '数字で入れてください';
      else if (total == null) diff.textContent = '先に金額を入れてください';
      else diff.textContent = sum === total ? '合計が合っています ✓' : '合計との差: ' + L.fmtUSD(total - sum) + (total > sum ? '（足りません）' : '（多すぎます）');
    }
    function upd() {
      const c = mode() === 'custom';
      equalBox.hidden = c; customBox.hidden = !c;
      if (c && customIns.every(i => !i.value.trim())) {
        const total = L.parseMoney(amount.value);
        const chosen = people.filter((n, i) => shareChecks[i].checked);
        if (total && chosen.length) { const m = L.splitEqual(total, chosen, e0.id); customIns.forEach((i, k) => { if (m.has(people[k])) i.value = centsToInput(m.get(people[k])); }); }
      }
      updDiff();
    }
    const body = h('div', null, field('内容', title), field('金額（ドル）', amount), field('払った人', payer), h('div', { class: 'subcard' }, radios, equalBox, customBox));
    upd();
    return modal(exp ? '立て替えを直す' : '立て替えを記録する', body, [
      { label: 'やめる', value: false },
      {
        label: '保存する', cls: 'btn primary', value: true,
        onClick: setErr => {
          const cents = L.parseMoney(amount.value);
          if (!title.value.trim()) { setErr('内容を入れてください'); return false; }
          if (!cents) { setErr('金額は0より大きい数字で入れてください（例: 48.50）'); return false; }
          const out = { id: e0.id, title: title.value, cents, payer: payer.value, split: mode(), shares: [], custom: [], by: e0.by };
          if (out.split === 'equal') {
            out.shares = people.filter((n, i) => shareChecks[i].checked);
            if (!out.shares.length) { setErr('負担する人を1人以上選んでください'); return false; }
          } else {
            let sum = 0;
            for (let k = 0; k < people.length; k++) {
              if (!customIns[k].value.trim()) continue;
              const c = L.parseMoney(customIns[k].value);
              if (c == null) { setErr('負担額は数字で入れてください'); return false; }
              if (c > 0) { out.custom.push([people[k], c]); sum += c; }
            }
            if (sum !== cents) { setErr('負担額の合計が金額と一致していません（' + L.fmtUSD(cents - sum) + '）'); return false; }
          }
          upsert('expenses', out);
        },
      },
    ]);
  }

  // ================= チェックリスト =================
  function viewChecks() {
    const root = h('div', { class: 'stack' });
    const total = live('checks'), doneAll = total.filter(c => c.done).length;
    root.append(h('section', { class: 'card tools' },
      h('h2', { class: 'sec', text: '出発までの準備' }),
      h('p', { class: 'lead', text: doneAll === total.length && total.length ? '準備はぜんぶ終わりました。いってらっしゃい！' : 'ひとつずつチェックしていけば大丈夫。いまは ' + doneAll + ' / ' + total.length + ' 終わっています。' }),
      btn(checkEdit ? '整え終わり' : '項目を整える（直す・消す）', () => { checkEdit = !checkEdit; render(); }, 'soft small', { 'aria-pressed': String(checkEdit) }, checkEdit ? 'check' : 'pencil')));
    for (const g of L.CHECK_GROUPS) {
      const items = live('checks').filter(c => c.group === g);
      const done = items.filter(c => c.done).length;
      const add = h('input', { type: 'text', maxlength: 120, placeholder: '項目を足す（例: 変換プラグ）', 'aria-label': CHECK_GROUP_JP[g] + 'に項目を足す', autocomplete: 'off' });
      root.append(h('section', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', { class: 'sec', text: CHECK_GROUP_JP[g] }), h('span', { class: 'count', text: done + ' / ' + items.length })),
        h('progress', { max: Math.max(items.length, 1), value: done, 'aria-label': CHECK_GROUP_JP[g] + 'の進み具合' }),
        items.length ? h('ul', { class: 'plain checks' }, items.map(c => h('li', { class: 'chk-row' },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: c.done, onchange: () => upsert('checks', Object.assign({}, c, { done: !c.done })) }),
            h('span', { class: c.done ? 'done' : '', text: c.text })),
          checkEdit ? iconBtn('pencil', c.text + 'を直す', () => editText(c)) : null,
          checkEdit ? iconBtn('trash', c.text + 'を消す', async () => { if (await confirmDlg('「' + c.text + '」を消しますか？', '消す', true)) removeEntity('checks', c.id); }, 'danger') : null)))
          : h('p', { class: 'hint', text: 'まだ項目がありません。下から足せます。' }),
        h('form', { class: 'row add', onsubmit: e => { e.preventDefault(); if (add.value.trim()) upsert('checks', { id: L.newId('c'), group: g, text: add.value, done: false }); } },
          h('div', { class: 'grow' }, add), h('button', { type: 'submit', class: 'btn soft' }, ic('plus'), '足す'))));
    }
    root.append(h('p', { class: 'hint', text: 'メモ用です。パスポート番号や予約番号は書かないでください。' }));
    root.append(footerLinks());
    return root;
  }
  function editText(c) {
    const input = h('input', { type: 'text', maxlength: 120, value: c.text });
    return modal('項目を直す', field('内容', input), [
      { label: 'やめる', value: false },
      { label: '保存する', cls: 'btn primary', value: true, onClick: setErr => { if (!input.value.trim()) { setErr('内容を入れてください'); return false; } upsert('checks', Object.assign({}, c, { text: input.value })); } },
    ]);
  }

  // ================= ライブ共有 =================
  const CHIP = { syncing: '同期中…', online: '同期済み', offline: 'オフライン（つながったら自動で同期）', conflict: 'ほかの人の変更と合わせています…', gone: '共有プランが見つかりません', error: '同期エラー' };
  const PAUSED_MSG = 'サーバーが休止中のようです。しばらくしてからもう一度。ローカルの内容は消えていません';
  const LINE_NOTICE = 'LINEの中でリンクを開くと、別の端末のように保存先が分かれてしまうことがあります。右下（または右上）のメニューから「ブラウザで開く」を選ぶか、リンクをコピーして、スマホ標準のブラウザ（SafariやChromeなど）で開いてください。';
  const LIVE_ERR = {
    full: '共有プランをためておく場所がいっぱいです。待っても空きません。使っていない共有プランを削除するか、運営者に連絡して整理してもらってください。',
    too_large: 'データが大きすぎて保存できません。',
    bad_doc: 'データの形式が正しくないため保存できませんでした。',
    bad_token: 'リンクの形式が正しくありません。',
    conflict: '同じプランがすでにあります。',
    not_found: '共有プランが見つかりません（削除されたか、リンクが違います）。',
  };
  const liveErr = code => LIVE_ERR[code] || 'うまくいきませんでした（' + code + '）。';
  const NO_NET = '通信できませんでした。電波のよいところで、もう一度お試しください。';
  const LIVE_NOTICE = '共有プランのデータは、プランがある間、外部サービス Supabase に保存されます。リンクを知っている人はだれでも見て・編集できます。パスポート番号・カード番号・予約番号などは入れないでください。';
  const roomLink = tok => location.origin + location.pathname + '#r=' + tok;
  // サーバーが答えない/エラーを返し続けている(無料プランの休止など)。電波がないだけのときとは区別する
  const serverDown = () => !!engine && syncStatus === 'offline' && navigator.onLine !== false && (engine.failures >= 2 || /^http \d/.test(engine.lastNetError || ''));
  function updateChip() {
    const el = document.getElementById('sync-chip');
    if (!el) return;
    if (!engine || !engine.token) { el.hidden = true; return; }
    el.hidden = false;
    const down = serverDown();
    el.dataset.s = down ? 'error' : syncStatus;
    el.replaceChildren(ic(syncStatus === 'online' ? 'check' : syncStatus === 'offline' || syncStatus === 'gone' || syncStatus === 'error' ? 'cloud-off' : 'refresh-cw'),
      down ? 'サーバーに届きません' : (CHIP[syncStatus] || '') + (syncStatus === 'error' && syncInfo === 'too_large' ? '（データが大きすぎます）' : ''));
  }
  // 受け取った内容を画面に反映。入力の途中なら、入力が終わるまで待つ(打っている文字が消えないように)
  function renderSoon() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && main.contains(a)) {
      if (!pendingRender) { pendingRender = true; a.addEventListener('blur', () => { pendingRender = false; render(); }, { once: true }); }
      return;
    }
    render();
  }
  function initSync() {
    if (!LIVE_ON) return;
    engine = TPSync.createEngine({
      L,
      transport: TPSync.httpTransport({ url: CFG.supabaseUrl, key: CFG.supabaseAnonKey }),
      getState: () => state,
      applyState: s => { applying = true; try { state = s; L.seedMissing(state, defaults()); save(); } finally { applying = false; } renderSoon(); },
      onStatus: (s, info) => { syncStatus = s; syncInfo = info || ''; updateChip(); if (tab === 'share') renderSoon(); },
      isVisible: () => document.visibilityState !== 'hidden',
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') engine.wake(); });
    window.addEventListener('focus', () => engine.wake());
    window.addEventListener('online', () => engine.wake());
    const tok = ls.get(KEY.room);
    if (tok && TPSync.isToken(tok)) engine.resume(tok);
  }
  function leaveRoom() { if (engine) engine.leave(); ls.del(KEY.room); updateChip(); }
  async function createRoom() {
    if (!(await confirmDlg('いまの旅程・投票・支払いを、外部サービス Supabase に保存して、リンクを知っている人と共有します。リンクを知っている人はだれでも見て・編集できます。パスポート番号などは入れないでください。', '共有プランを作る'))) return;
    const t = TPSync.makeToken();
    try {
      const w = await engine.create(t);
      if (!w.ok) return toast(liveErr(w.error));
      ls.set(KEY.room, t);
      toast('共有プランができました。「LINEで送る」で友だちを呼びましょう');
      render();
    } catch (e) { toast(NO_NET); }
  }
  async function joinRoom(token) {
    const strip = () => history.replaceState(null, '', location.pathname + location.search);
    if (!engine) { strip(); return toast('この版ではライブ共有を使えません'); }
    if (engine.token === token) { strip(); return; }
    const msg = (engine.token ? 'いまの共有プランから抜けて、別の共有プランに参加します。' : '共有プランに参加します。') + 'この端末の内容は共有プランと合体し、みんなの変更が数秒で届き合うようになります（元に戻すためのコピーは作ります）。リンクを知っている人はだれでも編集できます。';
    const ok = await modal('共有プランに参加しますか？', h('div', null, h('p', { text: msg }), IN_LINE ? h('p', { class: 'warn-box' }, ic('info'), LINE_NOTICE) : null),
      [{ label: 'やめる', value: false }, { label: '参加する', cls: 'btn primary', value: true }]);
    if (ok !== true) return; // リンクはそのまま残す(あとでもう一度開ける)
    if (!ls.set(KEY.backup, JSON.stringify(state))) return toast('元に戻すためのコピーを保存できないため、参加を中止しました');
    ls.set(KEY.backupJoin, '1');
    if (engine.token) engine.leave();
    ls.set(KEY.room, token);
    const r = await engine.join(token);
    if (r === 'gone' || r === 'error') {
      leaveRoom(); strip(); render();
      return toast(r === 'gone' ? liveErr('not_found') : 'この共有プランに参加できませんでした。リンクを確かめてください');
    }
    strip(); render();
    toast(r === 'offline' ? 'いまは通信できません。つながったら自動で参加します' : '共有プランに参加しました。みんなの変更がここに届きます');
    if (!me) chooseProfile(true);
  }
  async function leaveFlow() {
    if (!(await confirmDlg('この共有プランから抜けます。この端末の内容は残りますが、みんなとはつながらなくなります。プランそのものは消えません。', '抜ける', true))) return;
    leaveRoom(); render(); toast('共有プランから抜けました');
  }
  async function deleteFlow() {
    if (!(await confirmDlg('共有プランをサーバーから完全に削除します。ほかの人も使えなくなり、元に戻せません。この端末の内容は残ります。', '削除する', true))) return;
    try {
      const r = await engine.remove();
      if (!r.ok) return toast(liveErr(r.error));
      ls.del(KEY.room); updateChip(); render(); toast('共有プランを削除しました');
    } catch (e) { toast(NO_NET); }
  }
  // 「LINEで送る」: 3行(旅の名前 / リンク / 注意)。プランの中身は貼らない
  function lineShare() {
    const text = TRIP_NAME + '（' + L.dayDate(state.meta.year, 1).m + '/' + L.dayDate(state.meta.year, 1).d + '〜' + L.dayDate(state.meta.year, 10).m + '/' + L.dayDate(state.meta.year, 10).d + '）のしおりです。\n' + roomLink(engine.token) + '\n※このリンクの人は編集もできます';
    window.open(L.lineShareUrl(text), '_blank', 'noopener');
  }
  function inviteCard() {
    const lineHint = h('p', { class: 'warn-box' }, ic('info'), LINE_NOTICE);
    if (!LIVE_ON || !engine) {
      return h('section', { class: 'card hero' },
        h('h2', { class: 'sec', text: '友だちに送る' }),
        h('p', { class: 'lead', text: 'ライブ共有はまだ使えません。いまは、ファイルに保存してLINEのグループに送り、受け取った人が「取り込む」で合体させます。' }),
        h('div', { class: 'row gap' }, btn('ファイルに保存', exportJson, 'primary', null, 'save')),
        IN_LINE ? lineHint : null);
    }
    const tok = engine.token;
    if (!tok) {
      return h('section', { class: 'card hero' },
        h('h2', { class: 'sec', text: 'みんなで同時に編集しよう' }),
        h('p', { class: 'lead', text: '共有プランを作ると、LINEで送ったリンクを開いた友だちと、旅程・投票・立て替えが数秒で届き合います。パスワードはいりません。' }),
        h('div', { class: 'row gap' }, btn('共有プランを作る', createRoom, 'primary', null, 'users')),
        h('p', { class: 'hint', text: LIVE_NOTICE }),
        IN_LINE ? lineHint : null);
    }
    const down = serverDown(), gone = syncStatus === 'gone';
    const box = h('textarea', { readOnly: true, class: 'linkbox', 'aria-label': '招待リンク', onfocus: e => e.target.select() });
    box.value = roomLink(tok);
    return h('section', { class: 'card hero' },
      h('h2', { class: 'sec', text: '友だちを呼ぶ' }),
      h('p', { class: 'status-line', 'aria-live': 'polite' }, ic(gone || down || syncStatus === 'offline' ? 'cloud-off' : 'check'), gone ? liveErr('not_found') + ' この端末の内容は残っています。「もう一度共有する」を押すと新しいリンクができます。古いリンクは使えないので、新しいリンクをみんなに送り直してください。' : down ? PAUSED_MSG : (CHIP[syncStatus] || '')),
      gone ? h('div', { class: 'row gap' }, btn('もう一度共有する', async () => { leaveRoom(); await createRoom(); }, 'primary', null, 'users'), btn('共有をやめる', leaveFlow))
        : h('div', null,
          h('div', { class: 'row gap' }, btn('LINEで送る', lineShare, 'primary line', null, 'send'),
            btn('リンクをコピー', async () => { try { await navigator.clipboard.writeText(box.value); toast('リンクをコピーしました'); } catch (e) { box.focus(); box.select(); toast('コピーできませんでした。選択したので手動でコピーしてください'); } }, 'soft', null, 'copy')),
          h('p', { class: 'hint strong', text: 'このリンクの人は編集もできます。LINEのグループなど、信頼できる相手にだけ送ってください。' }),
          box,
          lineHint,
          h('p', { class: 'hint', text: LIVE_NOTICE }),
          h('div', { class: 'row gap' }, btn('このプランから抜ける', leaveFlow, 'ghost'), btn('プランを削除', deleteFlow, 'danger', null, 'trash'))));
  }

  // ================= 共有 =================
  function viewShare() {
    const root = h('div', { class: 'stack' });
    const out = h('div', { 'aria-live': 'polite' });
    const paste = h('textarea', { placeholder: '共有リンクをここに貼り付け（保存したファイルの中身でもOK）', 'aria-label': '共有リンクを貼り付け' });
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: onFile });
    root.append(inviteCard());
    root.append(h('section', { class: 'card' },
      h('details', { class: 'more', open: !LIVE_ON },
        h('summary', { text: 'リンクやファイルで合わせる（ライブ共有を使わないとき）' }),
        h('p', { class: 'lead', text: '予定や候補はこの端末の中にあります。リンクかファイルを送り合って、「取り込む」で合体させます（リアルタイムではありません）。' }),
        h('div', { class: 'row gap' }, btn('共有リンクを作る', () => makeLink(out), 'soft', null, 'link'), btn('ファイルに保存', exportJson, 'soft', null, 'save')),
        out,
        h('p', { class: 'hint', text: 'LINEで開けないときは、ファイルを送るか、リンクの文字を貼り付けてください。' }),
        h('h3', { class: 'sub', text: '取り込む' }),
        h('p', { class: 'hint', text: '取り込む前に、何が変わるか必ず確認画面が出ます。' }),
        h('div', { class: 'row gap' }, btn('ファイルを選んで取り込む', () => file.click(), 'soft', null, 'upload'), file),
        paste,
        h('div', { class: 'row gap' }, btn('貼り付けた内容を確認', () => importPasted(paste.value), 'soft')))));
    const hasBackup = !!ls.get(KEY.backup);
    root.append(h('section', { class: 'card' },
      h('h2', { class: 'sec', text: 'データの管理' }),
      h('div', { class: 'row gap' },
        hasBackup ? btn('直前の取り込みを元に戻す', undoImport, 'soft', null, 'refresh-cw') : null,
        btn('この端末のデータを全部消す', resetAll, 'danger', null, 'trash'))));
    root.append(h('section', { class: 'card soft' },
      h('h2', { class: 'sec', text: 'プライバシー' }),
      h('p', { text: (LIVE_ON ? 'ふだんは外部のサーバーにデータを送りません。「共有プラン」を作る・参加したときだけ、そのプランの内容が Supabase（外部サービス）に保存されます。それ以外の内容はこの端末のブラウザにだけ保存されます。' : 'このアプリは外部のサーバーにデータを送りません。入力した内容はこの端末のブラウザにだけ保存されます。') + '共有リンクには旅程・候補・投票・支払い・チェックの内容と、プロフィール（名前とアイコン）が含まれるので、送る相手に気をつけてください。' }),
      h('p', { text: 'ページは公開されています。パスポート番号・カード番号・予約番号・ホテルの部屋情報・自宅の住所は入力しないでください。' }),
      h('p', { class: 'hint', text: '地図リンクを開くと Google マップに場所名が送られます（押したときだけ）。' }),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => go('about') }, ic('info'), 'このサイトについて（運営者・保存場所・写真の出典）')));
    return root;
  }

  // ================= このサイトについて =================
  function viewAbout() {
    const root = h('div', { class: 'stack about' });
    const list = Object.keys(credits).map(id => { const idea = state.ideas.find(i => i.id === id); return { id, title: idea ? idea.title : id, c: credits[id] }; });
    const sec = (title, ...kids) => h('section', { class: 'card' }, h('h2', { class: 'sec', text: title }), ...kids);
    root.append(h('div', { class: 'row' }, btn('戻る', () => go(prevTab === 'about' ? 'itinerary' : prevTab), 'ghost', null, 'chevron-left')));
    root.append(h('section', { class: 'card hero' },
      h('h2', { class: 'sec', text: 'このサイトについて' }),
      h('p', { class: 'lead', text: 'これは、卒業旅行の計画を友だちとみんなで作るための、小さな無料のアプリです。' }),
      h('p', { class: 'op' }, h('strong', { text: '運営者: ' }), h('span', { text: 'カク（ニックネーム）' })),
      h('p', { class: 'op' }, h('strong', { text: '連絡先: ' }), 'Discord ', h('a', { class: 'lnk', href: 'https://discord.com/users/225438575716466688', target: '_blank', rel: 'noopener noreferrer' }, 'カク（ユーザーID 225438575716466688）'))));
    root.append(sec('保存されるもの・保存される場所',
      h('ul', { class: 'bul' },
        h('li', { text: '入力した旅程・候補・投票・立て替え・チェック・プロフィール（名前とアイコン）は、まず、このスマホ（ブラウザ）の中に保存されます。' }),
        h('li', { text: '「共有プラン」を作る・参加したときだけ、そのプランの内容（旅程・候補・投票・支払い・チェック・プロフィール）が Supabase（外部のデータベースサービス）に保存されます。共有プランがない間は、サーバーに何も送りません。' }),
        h('li', { text: '広告・アクセス解析・クッキーは使っていません。' }),
        h('li', { text: '「地図で見る」「LINEで送る」を押したときだけ、Google マップや LINE に移ります。' }))));
    root.append(sec('リンクが「かぎ」です',
      h('p', { text: '共有プランの入口は、長いランダムなリンクだけです。パスワードはありません。リンクを知っている人はだれでも見て・編集でき、プランを削除することもできます。LINEのグループなど、信頼できる相手にだけ送ってください。' }),
      h('p', { class: 'hint', text: 'プロフィール（名前とアイコン）にもパスワードはありません。だれが決めたかが分かるための仕組みで、なりすまし防止ではありません。' })));
    root.append(sec('プランの消しかた',
      h('ul', { class: 'bul' },
        h('li', { text: '共有プラン: 「共有」タブの「プランを削除」で、サーバーから完全に消せます（元に戻せません）。' }),
        h('li', { text: '長いあいだ使われない共有プランは、半年ほどで自動的に消えることがあります。' }),
        h('li', { text: 'この端末の内容: 「共有」タブの「この端末のデータを全部消す」。' }))));
    root.append(sec('写真・アイコンの出典',
      h('p', { text: '場所の写真は、Wikimedia Commons にある自由に使える画像（CC0・パブリックドメイン・CC BY・CC BY-SA）です。それぞれの写真の下に、撮影者・ライセンス・出典を表示しています。アイコンは Lucide（ISCライセンス）です。' }),
      list.length ? h('details', { class: 'more' }, h('summary', { text: '写真のクレジット一覧（' + list.length + '枚）' }),
        h('ul', { class: 'plain credits' }, list.map(({ title, c }) => h('li', null, h('strong', { text: title }), h('br'), (c.author || '作者不明') + ' / ',
          c.licenseUrl ? h('a', { href: c.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, c.license) : c.license, ' / ', h('a', { href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '出典'))))) : null));
    root.append(sec('入れないでほしい情報',
      h('p', { text: 'パスポート番号・カード番号・予約番号・ホテルの部屋情報・自宅の住所は、どこにも入力しないでください。このアプリはそれらを必要としません。' })));
    root.append(sec('保証について',
      h('p', { text: 'このアプリは無料で提供していて、正確さや、ずっと動き続けることは保証できません。金額や営業時間は目安です。大事な予約や出費は、公式の情報で確認してください。データが失われても責任を負えないので、大事な内容は「ファイルに保存」で控えをとっておいてください。' })));
    return root;
  }

  async function makeLink(out) {
    out.replaceChildren(h('p', { class: 'hint', text: '作成中…' }));
    try {
      const code = await L.encodeShare(state);
      const base = location.protocol === 'file:' ? location.href.split('#')[0] : location.origin + location.pathname;
      const url = base + '#s=' + code;
      if (url.length > 8000) { out.replaceChildren(h('p', { class: 'err', text: 'リンクが長すぎて送れません（' + url.length.toLocaleString() + '文字）。「ファイルに保存」で、友だちにファイルを送ってください。' })); return; }
      const box = h('textarea', { readOnly: true, class: 'linkbox', 'aria-label': '共有リンク', onfocus: e => e.target.select() });
      box.value = url;
      out.replaceChildren(box,
        h('p', { class: 'hint', text: 'リンクの長さ: ' + url.length.toLocaleString() + '文字' + (url.length > 2000 ? '（長めです。途中で切れる場合はファイルで送ってください）' : '') + (location.protocol === 'file:' ? '（このリンクは公開後に使えます）' : '') }),
        h('div', { class: 'row gap' }, btn('コピー', async () => {
          try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch (e) { box.focus(); box.select(); toast('コピーできませんでした。選択したので手動でコピーしてください'); }
        }, 'soft', null, 'copy')));
    } catch (e) { out.replaceChildren(h('p', { class: 'err', text: 'リンクを作れませんでした: ' + e.message })); }
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const d = new Date();
    const name = '旅行プラン-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('保存しました: ' + name);
  }
  async function onFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('ファイルが大きすぎます（2MBまで）');
    await importText(await f.text());
  }
  const importPasted = t => importText(t);
  async function importText(text) {
    text = String(text).trim();
    try {
      let incoming;
      if (text.startsWith('{')) incoming = L.sanitize(JSON.parse(text)); // ファイルの中身は、中に「#s=」があってもファイルとして読む
      else {
        const m = /#s=([A-Za-z0-9_-]+)/.exec(text);
        if (!m) throw new Error('共有リンクか、保存したファイルの中身を貼り付けてください');
        incoming = await L.decodeShare(m[1]);
      }
      await startImport(incoming);
    } catch (err) { toast('取り込めませんでした: ' + (err && err.message ? err.message : '形式が違います')); }
  }
  async function startImport(incoming, fromHash) {
    const stripHash = () => { if (fromHash) history.replaceState(null, '', location.pathname + location.search); };
    const { state: merged, changes } = L.merge(state, incoming);
    const real = changes.filter(c => c.type !== 'keep');
    const keeps = changes.filter(c => c.type === 'keep');
    if (!real.length) { stripHash(); return toast(keeps.length ? '新しい変更はありません（あなたの版のほうが新しい項目が' + keeps.length + '件あります）' : '新しい変更はありません'); }
    const body = h('div', { class: 'chg' },
      h('p', { text: '次の内容を取り込みます。「変更」「削除」は、あなたの今のデータを書き換えます（取り込み後も「元に戻す」で戻せます）。' }),
      Object.keys(KIND_JP).map(kind => {
        const list = real.filter(c => c.kind === kind);
        if (!list.length) return null;
        return h('div', null, h('h4', { text: KIND_JP[kind] + '（' + list.length + '件）' }),
          h('ul', null, list.slice(0, 15).map(c => h('li', { text: '[' + TYPE_JP[c.type] + '] ' + c.label + (c.detail ? ' — ' + c.detail : '') })),
            list.length > 15 ? h('li', { text: '…ほか' + (list.length - 15) + '件' }) : null));
      }),
      keeps.length ? h('p', { class: 'hint', text: 'あなたの版のほうが新しいので、そのまま残す項目: ' + keeps.length + '件' }) : null);
    const ok = await modal('取り込む内容を確認', body, [{ label: 'やめる', value: false }, { label: '取り込む', cls: 'btn primary', value: true }]);
    if (ok !== true) return;
    if (!ls.set(KEY.backup, JSON.stringify(state))) { toast('元に戻すためのコピーを保存できないため、取り込みを中止しました'); return; }
    ls.del(KEY.backupJoin);
    state = merged;
    L.seedMissing(state, defaults());
    if (save()) stripHash();
    render();
    toast('取り込みました（' + real.length + '件）');
    if (!me) chooseProfile(true);
  }
  async function undoImport() {
    if (!(await confirmDlg('直前の取り込みを取り消して、取り込み前の状態に戻しますか？その後に入力した内容は消えます。', '元に戻す', true))) return;
    try {
      const wasJoin = ls.get(KEY.backupJoin) === '1'; // 共有プランへの参加を取り消すときは、プランからも抜ける
      state = L.sanitize(JSON.parse(ls.get(KEY.backup))); ls.del(KEY.backup); ls.del(KEY.backupJoin);
      if (wasJoin) leaveRoom();
      save(); render(); toast(wasJoin ? '元に戻しました（共有プランからも抜けました）' : '元に戻しました');
    } catch (e) { toast('元に戻せませんでした'); }
  }
  async function resetAll() {
    if (!(await confirmDlg('この端末に保存した旅程・候補の投票・支払い・チェックをすべて消して、初期状態に戻します（共有プランに入っている場合は、そこからも抜けます。プランそのものは消えません）。よろしいですか？（先に「ファイルに保存」をおすすめします）', '全部消す', true))) return;
    state = L.emptyState(); ls.del(KEY.backup); ls.del(KEY.backupJoin);
    leaveRoom(); // 全部消すときは、共有プランからも抜ける(プランそのものは残る)
    L.seedMissing(state, defaults());
    save(); loadIdeas(); render(); toast('初期状態に戻しました');
  }

  // ================= 起動 =================
  const VIEWS = { itinerary: viewItinerary, ideas: viewIdeas, budget: viewBudget, checks: viewChecks, share: viewShare, about: viewAbout };
  const main = document.getElementById('app');
  const meBtn = document.getElementById('me-btn');
  meBtn.addEventListener('click', () => chooseProfile(true));
  // 表紙: 旅の名前・日付・状況(持ち物 n/n ・ 参加者 n人 ・ 未決定の候補 n)
  function updateCover() {
    const cover = document.getElementById('cover');
    cover.classList.toggle('compact', tab !== 'itinerary');
    document.body.dataset.tab = tab;
    const a = L.dayDate(state.meta.year, 1), b = L.dayDate(state.meta.year, 10);
    document.getElementById('cover-dates').replaceChildren(a.m + '/' + a.d + '（' + WD[a.w] + '）– ' + b.m + '/' + b.d + '（' + WD[b.w] + '）', h('span', { class: 'route', text: 'サンフランシスコ → ロサンゼルス' }));
    const pack = live('checks').filter(c => c.group === 'pack');
    const und = undecidedCount();
    const st = document.getElementById('cover-status');
    st.replaceChildren(
      h('span', { class: 'st' }, ic('luggage'), '持ち物 ' + pack.filter(c => c.done).length + '/' + pack.length),
      h('span', { class: 'st' }, ic('users'), '参加者 ' + livePeople().length + '人'),
      h('span', { class: 'st' }, ic('lightbulb'), '未決定の候補 ' + (und || 'なし')));
    const cr = document.getElementById('cover-credit');
    if (cr.dataset.k !== String(!!credits[COVER_ID])) {
      cr.dataset.k = String(!!credits[COVER_ID]);
      cr.replaceChildren();
      const c = credits[COVER_ID];
      if (c) cr.append('表紙の写真: ' + (c.author || '作者不明') + ' / ', h('a', { href: c.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, c.license), ' / ', h('a', { href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Commonsの写真ページ'));
    }
  }
  function render() {
    normalizeMe();
    updateChip();
    updateCover();
    meBtn.replaceChildren(ic(me ? 'user-round' : 'user-round'), me ? who(me) : '名前を決める');
    meBtn.setAttribute('aria-label', me ? 'いまの名前: ' + me + '（押すと切りかえ）' : '名前を決める');
    const y = window.scrollY;
    main.replaceChildren((VIEWS[tab] || viewItinerary)());
    document.querySelectorAll('nav.tabs [data-tab]').forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, y);
  }
  function go(t) {
    if (t !== 'about') ls.set(KEY.tab, t);
    if (t === 'about' && tab !== 'about') prevTab = tab;
    tab = t; render(); window.scrollTo(0, 0);
  }

  async function loadIdeas() {
    try {
      const r = await fetch('data/ideas.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('http ' + r.status);
      const raw = await r.json();
      if (!Array.isArray(raw)) throw new Error('format');
      const list = [], seen = new Set();
      for (const x of raw.slice(0, 300)) {
        const c = L.cleanOne('ideas', Object.assign({}, x, { u: 0, v: [], deleted: false }));
        if (c && !seen.has(c.id)) { seen.add(c.id); list.push(c); }
      }
      L.seedMissing(state, { ideas: list }, { prune: true });
      ideasMsg = '';
      save(); render();
    } catch (e) {
      ideasMsg = '候補の初期データを読み込めませんでした（ファイルを直接開いた場合は表示されません。公開ページから開いてください）。';
      render();
    }
  }
  async function loadCredits() {
    try {
      const r = await fetch('data/credits.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      const out = {};
      for (const [id, c] of Object.entries(j || {})) {
        if (!c || typeof c !== 'object') continue;
        out[String(id).slice(0, 40)] = { author: String(c.author || '').slice(0, 120), license: String(c.license || '').slice(0, 40), licenseUrl: L.safeUrl(c.licenseUrl), sourceUrl: L.safeUrl(c.sourceUrl), modified: !!c.modified, caption: String(c.caption || '').slice(0, 160) };
      }
      credits = out;
    } catch (e) { credits = {}; } // 写真が読めなくても、色のブロックで動く
    render();
  }
  async function checkHash() {
    const room = /^#r=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (room) {
      if (TPSync.isToken(room[1])) return joinRoom(room[1]);
      history.replaceState(null, '', location.pathname + location.search);
      return toast(liveErr('bad_token'));
    }
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return;
    try { await startImport(await L.decodeShare(m[1]), true); } catch (e) { toast('リンクを開けませんでした: ' + (e && e.message ? e.message : '形式が違います')); }
  }
  // はじめて開いたとき: 名前とアイコンだけ。友だちはLINEのリンクで入る、と一言
  function firstRun() {
    if (ls.get(KEY.seen) || me || live('people').length || /^#[rs]=/.test(location.hash)) return;
    ls.set(KEY.seen, '1');
    chooseProfile(true, true);
  }

  load();
  document.querySelectorAll('nav.tabs [data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  window.addEventListener('hashchange', checkHash);
  render();
  initSync();
  Promise.all([loadCredits(), loadIdeas()]).then(() => { checkHash(); firstRun(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 新しいサービスワーカーに切りかわったら、1回だけ読み込み直す(開いたままのタブが古いJavaScriptを使い続けないように)
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) return; // はじめてのインストールでは読み込み直さない
      let last = 0;
      try { last = Number(sessionStorage.getItem('tp.swreload')) || 0; } catch (e) { /* そのまま */ }
      if (Date.now() - last < 60000) return; // 読み込み直しの繰り返しを防ぐ
      try { sessionStorage.setItem('tp.swreload', String(Date.now())); } catch (e) { /* そのまま */ }
      if (document.querySelector('dialog[open]')) return toast('新しいバージョンがあります。あとで開き直すと切りかわります');
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン機能なしで続ける */ });
  }
})();
