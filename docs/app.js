'use strict';
/* 旅行プランナー: 画面部分。データは端末の localStorage だけに保存。外部通信なし。 */
(() => {
  const L = TPLogic;
  const KEY = { state: 'tp.state.v1', me: 'tp.me', tab: 'tp.tab', backup: 'tp.backup.v1' };
  const MAX_PEOPLE = 10;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const CAT_JP = { food: '食事', sight: '観光', activity: '体験', shopping: '買い物', nature: '自然', nightlife: '夜遊び', transport: '移動', other: 'その他' };
  const CITY_JP = { 'San Francisco': 'サンフランシスコ', 'Los Angeles': 'ロサンゼルス', 'San Diego': 'サンディエゴ' };
  const CITY_EN = Object.fromEntries(Object.entries(CITY_JP).map(([k, v]) => [v, k]));
  const cityLabel = c => CITY_JP[c] || c;
  const KIND_JP = { meta: '年・為替レート', days: '都市', items: '旅程の予定', ideas: 'アイデア', people: 'プロフィール', expenses: '支払い', checks: 'チェックリスト' };
  const TYPE_JP = { add: '追加', update: '変更', delete: '削除', votes: '投票' };

  // ---- ツアーの日程（ユーザー提供の情報。航空便・時刻・ホテル名は載せない）----
  const DAY_CITY = ['サンフランシスコ', 'サンフランシスコ', 'サンフランシスコ', 'サンフランシスコ → ロサンゼルス',
    'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', 'ロサンゼルス', '日本'];
  const FREE_NOTE = 'やりたいことは「アイデア」から追加できます';
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
  let state = null, me = '', tab = 'itinerary', ideasMsg = '', saveWarned = false;
  let fCity = '', fCat = '', fTag = '';
  const PRICE_ASOF = '2026年時点'; // 確認済みの金額を調べた年(データの注記による)
  const TAG_MARK = { games: ['🎮', 'ゲーム'], movies: ['🎬', '映画'] };

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
    if (['itinerary', 'ideas', 'budget', 'checks', 'share'].includes(t)) tab = t;
  }
  function save() {
    const ok = ls.set(KEY.state, JSON.stringify(state));
    if (!ok && !saveWarned) {
      saveWarned = true;
      toast('この端末に保存できません（プライベートブラウズ？）。「ファイルに保存」で控えを残してください');
    }
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
  const btn = (text, onclick, cls, extra) => h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, extra), text);
  const field = (label, input, hint) => h('label', { class: 'f' }, h('span', { text: label }), input, hint ? h('small', { class: 'hint', text: hint }) : null);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  function toast(msg) {
    const box = document.getElementById('toast');
    const el = h('div', { text: msg });
    box.append(el);
    setTimeout(() => el.remove(), 4500);
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
    { label: 'キャンセル', value: false },
    { label: okLabel || 'OK', cls: 'btn ' + (danger ? 'danger' : 'primary'), value: true },
  ]).then(v => v === true);

  // ---- データ操作 ----
  const live = kind => state[kind].filter(e => !e.deleted);
  const livePeople = () => live('people').map(p => p.name).sort();
  function upsert(kind, obj) {
    const c = L.cleanOne(kind, obj);
    if (!c) return false;
    const arr = state[kind];
    const i = arr.findIndex(x => x.id === c.id);
    c.u = Math.max(Date.now(), i >= 0 ? arr[i].u + 1 : 0);
    if (i >= 0) arr[i] = c; else arr.push(c);
    save(); render();
    return true;
  }
  function removeEntity(kind, id) {
    const arr = state[kind];
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return;
    arr[i] = L.cleanOne(kind, { id, deleted: true, u: Math.max(Date.now(), arr[i].u + 1), by: arr[i].by, v: arr[i].v });
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
  function chooseProfile(switchTo) {
    let icon = L.PROFILE_ICONS[0];
    const name = h('input', { type: 'text', maxlength: 30, placeholder: '例: ゆうた', autocomplete: 'off', 'aria-label': '名前' });
    const iconBtns = L.PROFILE_ICONS.map(ic => h('button', {
      type: 'button', class: 'icon-btn' + (ic === icon ? ' on' : ''), 'aria-pressed': String(ic === icon),
      onclick: () => { icon = ic; iconBtns.forEach(b => { const on = b.textContent === ic; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); },
    }, ic));
    return modal(switchTo ? 'あなたの名前は？' : 'メンバーを追加', finish => {
      const existing = live('people').slice().sort((x, y) => (x.name < y.name ? -1 : 1));
      return h('div', null,
        switchTo && existing.length ? h('div', null, h('h3', { text: 'いるプロフィールから選ぶ' }),
          h('div', { class: 'chips' }, existing.map(p => h('button', { type: 'button', class: 'btn small' + (p.name === me ? ' primary' : ''), onclick: () => { setMe(p.name); finish(true); } }, p.icon + ' ' + p.name)))) : null,
        h('h3', { text: switchTo ? '新しく作る' : '名前とアイコン' }),
        field('名前', name),
        h('p', { class: 'small', text: 'アイコンを選ぶ' }), h('div', { class: 'icons' }, iconBtns),
        h('p', { class: 'hint', text: 'パスワードはありません。だれでも好きな名前を選べます（友だち同士で使うためのもので、なりすましを防ぐ仕組みではありません）。同じ名前を入れると、アイコンだけ更新されます。' }));
    }, [
      { label: 'キャンセル', value: false },
      {
        label: switchTo ? '作って使う' : '追加', cls: 'btn primary', value: true,
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
  const dayCity = n => { const d = state.days.find(x => x.id === 'd' + n); return d && !d.deleted ? d.city : ''; };
  const rate = () => state.meta.rate;
  const money = cents => L.fmtUSD(cents) + (rate() ? '（約' + L.fmtJPY(cents, rate()) + '）' : '');
  const mapLink = q => h('a', { href: L.mapUrl(q), target: '_blank', rel: 'noopener noreferrer' }, '🗺 地図');
  const extLink = (url, text) => { const u = L.safeUrl(url); return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, text) : null; };
  const centsToInput = c => Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');

  // ================= 旅程 =================
  function viewItinerary() {
    const root = h('div');
    const yearIn = h('input', {
      id: 'yr', type: 'number', min: 2000, max: 2100, value: state.meta.year,
      onchange: e => { const y = parseInt(e.target.value, 10); if (y >= 2000 && y <= 2100) setMeta({ year: y }); else { toast('年は2000〜2100で入れてください'); render(); } },
    });
    const freeDays = range(1, 10).filter(n => live('items').some(i => i.day === 'd' + n && i.type === 'free'))
      .map(n => { const d = L.dayDate(state.meta.year, n); return d.m + '/' + d.d; });
    root.append(h('section', { class: 'card' },
      h('div', { class: 'row' }, h('label', { for: 'yr' }, '旅行の年'), h('div', { class: 'grow' }, yearIn)),
      h('p', { class: 'hint', text: '1/31〜2/9 の10日間。年は' + state.meta.year + '年（1/31は' + WD[L.dayDate(state.meta.year, 1).w] + '曜）です。' }),
      h('p', { class: 'hint', text: '自由時間がある日: ' + (freeDays.join('・') || 'なし') + '　※ツアーの予定は仮入力です。直してかまいません。' }),
      h('p', { class: 'hint', text: '友だちの変更は自動では届きません。合わせるには共有からリンクかファイルを送ります。' })));
    root.append(h('datalist', { id: 'cities' }, h('option', { value: 'サンフランシスコ' }), h('option', { value: 'ロサンゼルス' })));
    for (let n = 1; n <= 10; n++) root.append(dayCard(n));
    return root;
  }
  function dayCard(n) {
    const id = 'd' + n;
    const items = live('items').filter(i => i.day === id)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
    const city = h('input', {
      class: 'city', type: 'text', list: 'cities', maxlength: 40, value: dayCity(n), placeholder: '都市（未定）', 'aria-label': n + '日目の都市',
      onchange: e => upsert('days', { id, city: e.target.value }),
    });
    const list = h('ul', { class: 'plain' }, items.map(it => h('li', { class: 'item' },
      h('div', { class: 'time', text: it.time || '--:--' }),
      h('div', null,
        h('div', { class: 't' }, h('span', { class: 'badge ' + it.type, text: it.type === 'fixed' ? 'ツアー' : '自由' }), it.title),
        (it.place || it.mapQuery) ? h('div', { class: 'p' }, it.place ? it.place + ' ' : '', mapLink(it.mapQuery || it.place)) : null,
        it.note ? h('div', { class: 'n', text: it.note }) : null,
        it.by ? h('div', { class: 'by', text: who(it.by) + 'さんが追加' }) : null),
      h('div', { class: 'ops' },
        btn('編集', () => itemForm(it, id), 'small', { 'aria-label': it.title + 'を編集' }),
        btn('削除', async () => { if (await confirmDlg('「' + it.title + '」を削除しますか？', '削除', true)) removeEntity('items', it.id); }, 'small danger', { 'aria-label': it.title + 'を削除' })))));
    return h('section', { class: 'card day', 'aria-label': dayLabel(n) },
      h('div', { class: 'row between day-head' }, h('h3', { text: dayLabel(n) }), city),
      list,
      h('div', { class: 'actions' }, btn('＋ 予定を追加', () => needProfile().then(m => m && itemForm(null, id)), 'small')));
  }
  function itemForm(item, dayId) {
    const it = item || { id: L.newId('i'), day: dayId, time: '', title: '', place: '', mapQuery: '', note: '', type: 'free', by: me };
    const day = h('select', null, range(1, 10).map(n => h('option', { value: 'd' + n, selected: 'd' + n === it.day, text: dayLabel(n) })));
    const time = h('input', { type: 'time', value: it.time });
    const type = h('select', null, h('option', { value: 'free', selected: it.type === 'free', text: '自由時間' }), h('option', { value: 'fixed', selected: it.type === 'fixed', text: 'ツアーの予定' }));
    const title = h('input', { type: 'text', maxlength: 100, value: it.title, required: true });
    const place = h('input', { type: 'text', maxlength: 150, value: it.place, placeholder: '例: サンタモニカ・ピア' });
    const note = h('textarea', { maxlength: 500, value: it.note });
    return modal(item ? '予定を編集' : '予定を追加', h('div', null,
      field('日', day), field('時間（空でもOK）', time), field('種類', type), field('タイトル', title),
      field('場所（地図リンクに使います）', place, '住所や予約情報は入れないでください'), field('メモ', note)), [
      { label: 'キャンセル', value: false },
      {
        label: '保存', cls: 'btn primary', value: true,
        onClick: setErr => {
          if (!title.value.trim()) { setErr('タイトルを入れてください'); return false; }
          upsert('items', { id: it.id, day: day.value, time: time.value, title: title.value, place: place.value, mapQuery: (place.value.trim() === it.place && it.mapQuery) || '', note: note.value, type: type.value, by: it.by });
        },
      },
    ]);
  }

  // ================= アイデア =================
  function viewIdeas() {
    const root = h('div');
    const all = live('ideas');
    const cities = [...new Set(all.map(i => i.city).filter(Boolean))].sort();
    const citySel = h('select', { 'aria-label': '都市で絞り込む', onchange: e => { fCity = e.target.value; render(); } },
      h('option', { value: '', text: 'すべての都市' }), cities.map(c => h('option', { value: c, selected: c === fCity, text: cityLabel(c) })));
    const catSel = h('select', { 'aria-label': 'カテゴリで絞り込む', onchange: e => { fCat = e.target.value; render(); } },
      h('option', { value: '', text: 'すべてのカテゴリ' }), L.CATEGORIES.map(c => h('option', { value: c, selected: c === fCat, text: CAT_JP[c] })));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'ジャンルで絞り込む' },
      [['', '全部'], ['games', '🎮 ゲーム'], ['movies', '🎬 映画']].map(([v, text]) => h('button', {
        type: 'button', class: 'seg-btn' + (fTag === v ? ' on' : ''), 'aria-pressed': String(fTag === v), onclick: () => { fTag = v; render(); },
      }, text)));
    root.append(h('div', { class: 'card' },
      seg,
      h('div', { class: 'filters' }, citySel, catSel),
      h('div', { class: 'actions' }, btn('＋ アイデアを追加', () => needProfile().then(m => m && ideaForm(null)), 'primary')),
      h('p', { class: 'hint', text: me ? '投票する人: ' + who(me) + '（1つのアイデアに1人1票）' : '投票するときに名前とアイコンを選びます（1つのアイデアに1人1票）' }),
      h('p', { class: 'hint', text: '金額は目安です。「目安・未確認」は、まだ確認していない金額です。' })));
    if (ideasMsg && !all.length) root.append(h('p', { class: 'hint', text: ideasMsg }));
    const list = all.map((idea, i) => ({ idea, i })).filter(({ idea }) => (!fCity || idea.city === fCity) && (!fCat || idea.category === fCat) && (!fTag || (idea.tags || []).includes(fTag)))
      .sort((a, b) => L.voters(b.idea).length - L.voters(a.idea).length || a.i - b.i);
    if (!list.length) root.append(h('p', { class: 'hint', text: 'アイデアはまだありません。' }));
    list.forEach(({ idea }) => root.append(ideaCard(idea)));
    return root;
  }
  function ideaCard(idea) {
    const vs = L.voters(idea);
    const mine = me && vs.includes(me);
    const cost = idea.costUSD == null ? '費用: わからない'
      : idea.costUSD === 0 ? '無料'
        : '約$' + idea.costUSD + (rate() ? '（約' + L.fmtJPY(Math.round(idea.costUSD * 100), rate()) + '）' : '');
    const estimate = !idea.verified && (idea.costUSD != null || /ドル/.test((idea.note || '') + (idea.tip || ''))); // 本文にドルの金額があるときも
    const asOf = idea.verified && idea.costUSD != null; // 確認済みの金額も、調べた年を出す
    const link = extLink(idea.link, '情報元');
    return h('article', { class: 'card idea' },
      h('div', { class: 'row between' }, h('h3', { text: idea.title }),
        btn('👍 ' + vs.length, () => toggleVote(idea.id), 'vote' + (mine ? ' on' : ''), { 'aria-pressed': String(!!mine), 'aria-label': idea.title + 'に投票（現在' + vs.length + '票）' })),
      h('div', { class: 'tags' },
        idea.city ? h('span', { class: 'tag', text: cityLabel(idea.city) }) : null,
        idea.area ? h('span', { class: 'tag', text: idea.area }) : null,
        h('span', { class: 'tag', text: CAT_JP[idea.category] }),
        (idea.tags || []).filter(t => TAG_MARK[t]).map(t => h('span', { class: 'tag mark', title: TAG_MARK[t][1], 'aria-label': TAG_MARK[t][1] }, TAG_MARK[t][0])),
        h('span', { class: 'tag', text: cost }),
        idea.duration ? h('span', { class: 'tag', text: idea.duration }) : null,
        estimate ? h('span', { class: 'tag warn', text: '目安・未確認' }) : null,
        asOf ? h('span', { class: 'tag', text: PRICE_ASOF }) : null),
      idea.bestTime ? h('p', { class: 'small', text: 'おすすめ: ' + idea.bestTime }) : null,
      idea.tip ? h('p', { class: 'small', text: 'ヒント: ' + idea.tip }) : null,
      idea.note ? h('p', { text: idea.note }) : null,
      h('p', { class: 'small', text: idea.by ? who(idea.by) + 'さんが追加' : '下調べで追加' }),
      vs.length ? h('p', { class: 'small', text: '投票した人: ' + vs.map(who).join('、') }) : null,
      h('div', { class: 'row' }, mapLink(idea.mapQuery || (idea.title + ' ' + idea.city).trim()), link),
      h('div', { class: 'actions' },
        btn('旅程に追加', () => needProfile().then(m => m && addToDay(idea)), 'small primary'),
        btn('編集', () => ideaForm(idea), 'small', { 'aria-label': idea.title + 'を編集' }),
        btn('削除', async () => { if (await confirmDlg('「' + idea.title + '」を削除しますか？', '削除', true)) removeEntity('ideas', idea.id); }, 'small danger', { 'aria-label': idea.title + 'を削除' })));
  }
  async function toggleVote(id) {
    if (!(await needProfile())) return;
    const idea = state.ideas.find(i => i.id === id);
    if (!idea || idea.deleted) return;
    idea.v = L.setVote(idea.v, me, !L.voters(idea).includes(me), Date.now());
    save(); render();
  }
  function addToDay(idea) {
    const day = h('select', null, range(1, 10).map(n => h('option', { value: 'd' + n, selected: n === 2, text: dayLabel(n) + (dayCity(n) ? ' ' + dayCity(n) : '') })));
    const time = h('input', { type: 'time' });
    return modal('旅程に追加', h('div', null, h('p', { text: idea.title }), field('日', day), field('時間（空でもOK）', time)), [
      { label: 'キャンセル', value: false },
      {
        label: '追加', cls: 'btn primary', value: true,
        onClick: () => {
          upsert('items', { id: L.newId('i'), day: day.value, time: time.value, title: idea.title, place: idea.area ? idea.area : '', mapQuery: idea.mapQuery || (idea.title + ' ' + idea.city).trim(), note: idea.note, type: 'free', by: me });
          toast(dayLabel(Number(day.value.slice(1))) + ' に追加しました');
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
    return modal(idea ? 'アイデアを編集' : 'アイデアを追加', h('div', null,
      h('datalist', { id: 'idea-cities' }, h('option', { value: 'サンフランシスコ' }), h('option', { value: 'ロサンゼルス' })),
      field('タイトル', title), field('都市', city), field('カテゴリ', cat), field('費用の目安（ドル）', cost), field('リンク', link), field('メモ', note)), [
      { label: 'キャンセル', value: false },
      {
        label: '保存', cls: 'btn primary', value: true,
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
    const root = h('div');
    const people = livePeople();
    const rateIn = h('input', {
      type: 'text', inputmode: 'decimal', value: rate() ? String(rate()) : '', placeholder: '例: 150', 'aria-label': '1ドルは何円',
      onchange: e => {
        const t = e.target.value.normalize('NFKC').replace(/[,\s]/g, '');
        if (!t) return setMeta({ rate: null });
        const v = Number(t);
        if (v > 0 && v <= 100000) setMeta({ rate: v }); else { toast('レートは数字で入れてください'); render(); }
      },
    });
    root.append(h('section', { class: 'card' },
      h('h3', { text: '為替レート（手入力）' }),
      h('div', { class: 'row' }, '1ドル =', h('div', { class: 'grow' }, rateIn), '円'),
      h('p', { class: 'hint', text: '自動では取得しません。円はおおよその目安です。ツアーに含まれる航空券・ホテルは入れず、自由時間の出費だけを記録します。' })));

    root.append(h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', { text: 'メンバー（' + people.length + '/' + MAX_PEOPLE + '人）' }),
        btn('＋ 追加', () => chooseProfile(false), 'small primary', { disabled: people.length >= MAX_PEOPLE })),
      h('div', { class: 'chips' }, people.map(n => h('span', { class: 'chip' }, who(n), h('button', { type: 'button', 'aria-label': n + 'を外す', onclick: () => removePerson(n) }, '×')))),
      h('p', { class: 'hint', text: 'メンバーはプロフィールと同じです。名前は自分たちで決めてください（本名でなくてOK）。' })));

    const exps = live('expenses');
    root.append(h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', { text: '支払い' }), btn('＋ 追加', () => needProfile().then(m => m && expenseForm(null)), 'small primary', { disabled: people.length < 2 })),
      people.length < 2 ? h('p', { class: 'hint', text: '先にメンバーを2人以上追加してください。' }) : null,
      !exps.length ? h('p', { class: 'hint', text: 'まだありません。' }) : null,
      exps.slice().reverse().map(e => h('div', { class: 'pay' },
        h('div', null, h('div', { class: 't', text: e.title }),
          h('div', { class: 'small', text: who(e.payer) + 'が払った / ' + (e.split === 'custom' ? '個別: ' + e.custom.map(p => p[0] + ' ' + L.fmtUSD(p[1])).join('、') : e.shares.length + '人で均等: ' + e.shares.join('、')) }),
          e.by ? h('div', { class: 'by', text: who(e.by) + 'さんが記録' }) : null),
        h('div', { class: 'row' }, h('span', { class: 'amt', text: money(e.cents) }),
          btn('編集', () => expenseForm(e), 'small', { 'aria-label': e.title + 'を編集' }),
          btn('削除', async () => { if (await confirmDlg('「' + e.title + '」を削除しますか？', '削除', true)) removeEntity('expenses', e.id); }, 'small danger', { 'aria-label': e.title + 'を削除' }))))));

    if (exps.length) {
      const { total, rows } = L.summarize(exps);
      const names = [...rows.keys()].sort();
      const sets = L.settle(new Map(names.map(n => [n, rows.get(n).net])));
      root.append(h('section', { class: 'card' },
        h('h3', { text: '合計 ' + money(total) }),
        h('table', null,
          h('thead', null, h('tr', null, h('th', { text: '名前' }), h('th', { text: '払った' }), h('th', { text: '負担' }), h('th', { text: '差額' }))),
          h('tbody', null, names.map(n => {
            const r = rows.get(n);
            return h('tr', null, h('td', { text: who(n) }), h('td', { text: L.fmtUSD(r.paid) }), h('td', { text: L.fmtUSD(r.owed) }),
              h('td', { class: r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '', text: (r.net > 0 ? '+' : '') + L.fmtUSD(r.net) }));
          }))),
        h('p', { class: 'hint', text: '差額: ＋は受け取る、－は払う金額です。' })));
      root.append(h('section', { class: 'card' },
        h('h3', { text: '精算（送金は最少' + sets.length + '回）' }),
        sets.length ? sets.map(t => h('div', { class: 'xfer' }, who(t.from) + ' → ' + who(t.to) + '　', h('strong', { text: money(t.cents) }))) : h('p', { text: '精算は不要です。' }),
        h('p', { class: 'hint', text: '割り切れないときは、1セントをだれか1人に上乗せして合計を合わせています。' })));
    }
    return root;
  }
  async function removePerson(name) {
    const used = live('expenses').some(e => e.payer === name || e.shares.includes(name) || e.custom.some(p => p[0] === name));
    if (used) return toast(name + 'は支払いに使われています。先にその支払いを直すか消してください');
    if (!(await confirmDlg(who(name) + ' をメンバーから外しますか？', '外す', true))) return;
    if (name === me) setMe('');
    removeEntity('people', 'p:' + name);
  }
  function expenseForm(exp) {
    const people = [...new Set([...livePeople(), ...(exp ? [exp.payer, ...exp.shares, ...exp.custom.map(p => p[0])] : [])])].sort();
    if (people.length < 2) return toast('先にメンバーを2人以上追加してください');
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
    const body = h('div', null, field('内容', title), field('金額（ドル）', amount), field('払った人', payer), h('div', { class: 'card' }, radios, equalBox, customBox));
    upd();
    return modal(exp ? '支払いを編集' : '支払いを追加', body, [
      { label: 'キャンセル', value: false },
      {
        label: '保存', cls: 'btn primary', value: true,
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
    const root = h('div');
    for (const g of L.CHECK_GROUPS) {
      const items = live('checks').filter(c => c.group === g);
      const done = items.filter(c => c.done).length;
      const add = h('input', { type: 'text', maxlength: 120, placeholder: '項目を追加', 'aria-label': CHECK_GROUP_JP[g] + 'に項目を追加', autocomplete: 'off' });
      root.append(h('section', { class: 'card' },
        h('h3', { text: CHECK_GROUP_JP[g] + '（' + done + '/' + items.length + '）' }),
        items.map(c => h('div', { class: 'chk-row' },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: c.done, onchange: () => upsert('checks', Object.assign({}, c, { done: !c.done })) }),
            h('span', { class: c.done ? 'done' : '', text: c.text })),
          btn('✎', async () => editText(c), 'small', { 'aria-label': c.text + 'を編集' }),
          btn('×', async () => { if (await confirmDlg('「' + c.text + '」を削除しますか？', '削除', true)) removeEntity('checks', c.id); }, 'small danger', { 'aria-label': c.text + 'を削除' }))),
        h('form', { class: 'row', onsubmit: e => { e.preventDefault(); if (add.value.trim()) upsert('checks', { id: L.newId('c'), group: g, text: add.value, done: false }); } },
          h('div', { class: 'grow' }, add), h('button', { type: 'submit', class: 'btn' }, '追加'))));
    }
    root.append(h('p', { class: 'hint', text: 'メモ用です。パスポート番号や予約番号は書かないでください。' }));
    return root;
  }
  function editText(c) {
    const input = h('input', { type: 'text', maxlength: 120, value: c.text });
    return modal('項目を編集', field('内容', input), [
      { label: 'キャンセル', value: false },
      { label: '保存', cls: 'btn primary', value: true, onClick: setErr => { if (!input.value.trim()) { setErr('内容を入れてください'); return false; } upsert('checks', Object.assign({}, c, { text: input.value })); } },
    ]);
  }

  // ================= 共有 =================
  function viewShare() {
    const root = h('div');
    const out = h('div', { 'aria-live': 'polite' });
    const paste = h('textarea', { placeholder: '共有リンクをここに貼り付け（保存したファイルの中身でもOK）', 'aria-label': '共有リンクを貼り付け' });
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: onFile });
    root.append(h('section', { class: 'card' },
      h('h3', { text: '友だちと予定を合わせる' }),
      h('p', { text: '予定やアイデアは、あなたの端末の中にあります。友だちの変更は自動では届きません（リアルタイムではありません）。リンクかファイルを送り合って、「取り込む」で合体させます。' }),
      h('div', { class: 'actions' }, btn('共有リンクを作る', () => makeLink(out), 'primary'), btn('ファイルに保存', exportJson)),
      out,
      h('p', { class: 'hint', text: 'LINEで開けないときは、ファイルを送るか、リンクの文字を貼り付けてください。' }),
      h('h3', { text: '取り込む' }),
      h('p', { class: 'hint', text: '取り込む前に、何が変わるか必ず確認画面が出ます。' }),
      h('div', { class: 'actions' }, btn('ファイルを選んで取り込む', () => file.click()), file),
      paste,
      h('div', { class: 'actions' }, btn('貼り付けた内容を確認', () => importPasted(paste.value)))));

    const hasBackup = !!ls.get(KEY.backup);
    root.append(h('section', { class: 'card' },
      h('h3', { text: 'データの管理' }),
      h('div', { class: 'actions' },
        hasBackup ? btn('直前の取り込みを元に戻す', undoImport) : null,
        btn('この端末のデータを全部消す', resetAll, 'danger'))));
    root.append(h('section', { class: 'card' },
      h('h3', { text: 'プライバシー' }),
      h('p', { text: 'このアプリは外部のサーバーにデータを送りません。入力した内容はこの端末のブラウザにだけ保存されます。共有リンクには旅程・アイデア・投票・支払い・チェックの内容と、プロフィール（名前とアイコン）が含まれるので、送る相手に気をつけてください。' }),
      h('p', { text: 'ページは公開されています。パスポート番号・カード番号・予約番号・ホテルの部屋情報・自宅の住所は入力しないでください。' }),
      h('p', { class: 'hint', text: 'プロフィールにパスワードはありません。だれでも好きな名前を選べます（友だち同士用で、なりすましを防ぐ仕組みではありません）。' }),
      h('p', { class: 'hint', text: '地図リンクを開くと Google マップに場所名が送られます（リンクを押したときだけ）。' })));
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
        h('div', { class: 'actions' }, btn('コピー', async () => {
          try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch (e) { box.focus(); box.select(); toast('コピーできませんでした。選択したので手動でコピーしてください'); }
        }, 'small primary')));
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
    const ok = await modal('取り込む内容を確認', body, [{ label: 'キャンセル', value: false }, { label: '取り込む', cls: 'btn primary', value: true }]);
    if (ok !== true) return;
    if (!ls.set(KEY.backup, JSON.stringify(state))) { toast('元に戻すためのコピーを保存できないため、取り込みを中止しました'); return; }
    state = merged;
    L.seedMissing(state, defaults());
    if (save()) stripHash();
    render();
    toast('取り込みました（' + real.length + '件）');
    if (!me) chooseProfile(true);
  }
  async function undoImport() {
    if (!(await confirmDlg('直前の取り込みを取り消して、取り込み前の状態に戻しますか？その後に入力した内容は消えます。', '元に戻す', true))) return;
    try { state = L.sanitize(JSON.parse(ls.get(KEY.backup))); ls.del(KEY.backup); save(); render(); toast('元に戻しました'); } catch (e) { toast('元に戻せませんでした'); }
  }
  async function resetAll() {
    if (!(await confirmDlg('この端末に保存した旅程・アイデアの投票・支払い・チェックをすべて消して、初期状態に戻します。よろしいですか？（先に「ファイルに保存」をおすすめします）', '全部消す', true))) return;
    state = L.emptyState(); ls.del(KEY.backup);
    L.seedMissing(state, defaults());
    save(); loadIdeas(); render(); toast('初期状態に戻しました');
  }

  // ================= 起動 =================
  const VIEWS = { itinerary: viewItinerary, ideas: viewIdeas, budget: viewBudget, checks: viewChecks, share: viewShare };
  const main = document.getElementById('app');
  const meBtn = document.getElementById('me-btn');
  meBtn.addEventListener('click', () => chooseProfile(true));
  function render() {
    normalizeMe();
    meBtn.textContent = me ? who(me) : '👤 名前を選ぶ';
    const y = window.scrollY;
    main.replaceChildren(VIEWS[tab]());
    document.querySelectorAll('nav.tabs [data-tab]').forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, y);
  }
  function go(t) { tab = t; ls.set(KEY.tab, t); render(); window.scrollTo(0, 0); }

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
      ideasMsg = 'アイデアの初期データを読み込めませんでした（ファイルを直接開いた場合は表示されません。公開ページから開いてください）。';
      render();
    }
  }
  async function checkHash() {
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return;
    try { await startImport(await L.decodeShare(m[1]), true); } catch (e) { toast('リンクを開けませんでした: ' + (e && e.message ? e.message : '形式が違います')); }
  }

  load();
  document.querySelectorAll('nav.tabs [data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  window.addEventListener('hashchange', checkHash);
  render();
  loadIdeas().then(checkHash);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン機能なしで続ける */ });
})();
