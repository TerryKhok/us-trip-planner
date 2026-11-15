'use strict';
/* 旅行プランナー: 画面に依存しない処理（データの検証・マージ・精算・共有リンク）。
   外部通信なし。金額は整数セント(USD)で扱い、小数の誤差を避ける。 */
const TPLogic = (() => {
  const APP_ID = 'us-trip-planner';
  const KINDS = ['days', 'items', 'ideas', 'people', 'expenses', 'checks'];
  const CATEGORIES = ['food', 'sight', 'activity', 'shopping', 'nature', 'nightlife', 'transport', 'other'];
  const CHECK_GROUPS = ['before', 'pack', 'book'];
  // プロフィールのアイコンは、この一覧にある絵文字だけ使える（共有データに変な文字が混ざらないように）
  const PROFILE_ICONS = ['🐻', '🦊', '🐱', '🐶', '🐰', '🐼', '🦁', '🐸', '🐧', '🦉', '🐙', '🦄', '🐢', '🐳', '🌸', '🍀', '⭐', '🔥', '🍙', '🎮'];
  const MAX_PER_KIND = 600;
  const MAX_DECODED_BYTES = 4 * 1024 * 1024;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const S = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  // 更新時刻は「いまから1日先」までに切り詰める(未来すぎる時刻で、いつも勝つ変更を防ぐ)
  const FUTURE_MS = 24 * 60 * 60 * 1000;
  const U = v => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Date.now() + FUTURE_MS) : 0);
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (isObj(x)) {
      return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    }
    return JSON.stringify(x);
  }

  // ---------- お金 ----------
  function parseMoney(s) {
    if (typeof s !== 'string') return null;
    const t = s.normalize('NFKC').replace(/[,\s$]/g, '');
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  }
  function fmtUSD(cents) {
    const neg = cents < 0;
    const a = Math.abs(cents);
    return (neg ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0');
  }
  function fmtJPY(cents, rate) {
    if (!rate) return '';
    const y = Math.round(cents * rate / 100);
    return (y < 0 ? '-' : '') + '¥' + Math.abs(y).toLocaleString('ja-JP');
  }

  // ---------- URL ----------
  function safeUrl(s) {
    s = S(s, 500);
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (e) { return ''; }
  }
  function mapUrl(q) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  // ---------- 日付 ----------
  function dayDate(year, n) { // n = 1..10 、1/31 が Day1
    const d = new Date(Date.UTC(year, 0, 30 + n));
    return { m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
  }

  // ---------- ID ----------
  function newId(prefix) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return prefix + '-' + Date.now().toString(36) + r[0].toString(36);
  }

  // ---------- 投票 ----------
  // votes: [[名前, 時刻]] 。時刻が正=投票あり、負=取り消し。名前ごとに絶対値が大きい方が新しい。
  function cleanVotes(a) {
    const m = new Map();
    if (Array.isArray(a)) {
      for (const p of a) {
        if (!Array.isArray(p) || typeof p[0] !== 'string' || !Number.isFinite(p[1]) || p[1] === 0) continue;
        const n = S(p[0], 30);
        if (!n) continue;
        const t = Math.sign(p[1]) * Math.min(Math.abs(Math.trunc(p[1])), Date.now() + FUTURE_MS);
        if (t === 0) continue;
        const cur = m.get(n);
        if (cur === undefined || Math.abs(t) > Math.abs(cur) || (Math.abs(t) === Math.abs(cur) && t > 0)) m.set(n, t);
      }
    }
    return [...m].sort((x, y) => byName(x[0], y[0]));
  }
  const voters = idea => (idea.v || []).filter(p => p[1] > 0).map(p => p[0]);
  function setVote(v, name, on, now) {
    const old = (v || []).find(p => p[0] === name);
    const t = Math.max(now, old ? Math.abs(old[1]) + 1 : 0);
    return cleanVotes((v || []).filter(p => p[0] !== name).concat([[name, on ? t : -t]]));
  }

  // ---------- 検証・正規化 ----------
  const IDEA_TAGS = ['games', 'movies'];
  const cleanTags = a => [...new Set((Array.isArray(a) ? a : []).filter(t => IDEA_TAGS.includes(t)))].sort();
  const cleanNames = a => [...new Set((Array.isArray(a) ? a : []).map(n => S(n, 30)).filter(Boolean))].sort(byName);
  function cleanPairs(a) {
    const m = new Map();
    if (Array.isArray(a)) {
      for (const p of a) {
        if (Array.isArray(p) && typeof p[0] === 'string' && Number.isInteger(p[1]) && p[1] > 0 && p[1] <= 1e10) {
          const n = S(p[0], 30);
          if (n) m.set(n, p[1]);
        }
      }
    }
    return [...m].sort((x, y) => byName(x[0], y[0]));
  }
  function cleanMeta(m) {
    m = isObj(m) ? m : {};
    return {
      year: Number.isInteger(m.year) && m.year >= 2000 && m.year <= 2100 ? m.year : 2027,
      yu: Number.isFinite(m.yu) ? U(m.yu) : U(m.u), // 年を直した時刻(古いデータは u を使う)
      rate: Number.isFinite(m.rate) && m.rate > 0 && m.rate <= 100000 ? m.rate : null,
      ru: Number.isFinite(m.ru) ? U(m.ru) : U(m.u), // レートを直した時刻
    };
  }
  const DAY_ID = /^d(10|[1-9])$/;
  const CLEAN = {
    days: (e, id) => (DAY_ID.test(id) ? { id, city: S(e.city, 40), u: U(e.u) } : null),
    items: (e, id) => {
      const day = S(e.day, 10);
      if (!DAY_ID.test(day)) return null;
      const t = /^(\d{1,2}):(\d{2})$/.exec(S(e.time, 5));
      const time = t && +t[1] < 24 && +t[2] < 60 ? t[1].padStart(2, '0') + ':' + t[2] : '';
      return {
        id, day, time, title: S(e.title, 100) || '（無題）', place: S(e.place, 150), mapQuery: S(e.mapQuery, 150), note: S(e.note, 500),
        type: e.type === 'fixed' ? 'fixed' : 'free', by: S(e.by, 30), u: U(e.u),
      };
    },
    ideas: (e, id) => {
      if (e.vo === true) return { id, vo: true, v: cleanVotes(e.v), u: 0 }; // 共有リンク用: 投票だけ
      let cost = null;
      if (Number.isFinite(e.costUSD) && e.costUSD >= 0 && e.costUSD <= 100000) cost = Math.round(e.costUSD * 100) / 100;
      return {
        id, title: S(e.title, 100) || '（無題）', city: S(e.city, 40), area: S(e.area, 60),
        category: CATEGORIES.includes(e.category) ? e.category : 'other', costUSD: cost,
        duration: S(e.duration, 40), bestTime: S(e.bestTime, 80), tip: S(e.tip, 300),
        mapQuery: S(e.mapQuery, 150), link: safeUrl(e.link || e.sourceUrl), note: S(e.note, 500),
        tags: cleanTags(e.tags), verified: e.verified === true, by: S(e.by, 30), v: cleanVotes(e.v), u: U(e.u),
      };
    },
    people: (e) => {
      const name = S(e.name, 30);
      return name ? { id: 'p:' + name, name, icon: PROFILE_ICONS.includes(e.icon) ? e.icon : '🙂', u: U(e.u) } : null;
    },
    expenses: (e, id) => {
      if (!Number.isInteger(e.cents) || e.cents <= 0 || e.cents > 1e10) return null;
      const payer = S(e.payer, 30);
      if (!payer) return null;
      let split = e.split === 'custom' ? 'custom' : 'equal';
      let shares = cleanNames(e.shares);
      let custom = cleanPairs(e.custom);
      if (split === 'custom' && custom.reduce((s, p) => s + p[1], 0) !== e.cents) {
        split = 'equal'; // 合計が合わない個別指定は均等割りに戻す
        shares = custom.length ? cleanNames(custom.map(p => p[0])) : shares;
      }
      if (split === 'equal') { custom = []; if (!shares.length) return null; } else shares = [];
      return { id, title: S(e.title, 100) || '（無題）', cents: e.cents, payer, split, shares, custom, by: S(e.by, 30), u: U(e.u) };
    },
    checks: (e, id) => {
      const group = S(e.group, 10);
      const text = S(e.text, 120);
      if (!CHECK_GROUPS.includes(group) || !text) return null;
      return { id, group, text, done: e.done === true, u: U(e.u) };
    },
  };
  function cleanOne(kind, e) {
    if (!isObj(e)) return null;
    const id = kind === 'people' && !e.id ? 'p:' + S(e.name, 30) : S(e.id, 80);
    if (!id) return null;
    if (e.deleted === true) {
      const t = { id, deleted: true, u: U(e.u) };
      if (kind === 'items' || kind === 'ideas' || kind === 'expenses') t.by = S(e.by, 30);
      if (kind === 'ideas') t.v = cleanVotes(e.v);
      return t;
    }
    return CLEAN[kind](e, id);
  }
  function emptyState() {
    return { app: APP_ID, v: 1, meta: { year: 2027, yu: 0, rate: null, ru: 0 }, days: [], items: [], ideas: [], people: [], expenses: [], checks: [] };
  }
  function sanitize(raw) {
    if (!isObj(raw) || raw.app !== APP_ID) throw new Error('このアプリのデータではありません');
    if (raw.v !== 1) throw new Error('データのバージョンが新しすぎます');
    const out = emptyState();
    out.meta = cleanMeta(raw.meta);
    for (const kind of KINDS) {
      const seen = new Set();
      const arr = Array.isArray(raw[kind]) ? raw[kind].slice(0, MAX_PER_KIND) : [];
      for (const e of arr) {
        const c = cleanOne(kind, e);
        if (c && !seen.has(c.id)) { seen.add(c.id); out[kind].push(c); }
      }
    }
    return out;
  }
  const clone = x => JSON.parse(JSON.stringify(x));

  // 既定データ（日程・チェックリスト・アイデア）を足す。u===0 のままの既定項目は最新内容に更新する。
  function seedMissing(state, defaults, opts) {
    for (const kind of Object.keys(defaults)) {
      const list = defaults[kind];
      const idx = new Map(state[kind].map((e, i) => [e.id, i]));
      for (const d of list) {
        const i = idx.get(d.id);
        if (i === undefined) { idx.set(d.id, state[kind].length); state[kind].push(d); }
        else {
          const cur = state[kind][i];
          if (!cur.deleted && cur.u === 0) state[kind][i] = kind === 'ideas' ? Object.assign({}, d, { v: cur.v }) : d;
        }
      }
      if (opts && opts.prune && kind === 'ideas') {
        const keep = new Set(list.map(d => d.id));
        state[kind] = state[kind].filter(e => e.deleted || e.u !== 0 || keep.has(e.id) || (e.v && e.v.length));
      }
    }
  }

  // ---------- マージ ----------
  const FIELD_JP = {
    city: '都市', time: '時間', title: 'タイトル', place: '場所', note: 'メモ', type: '種別', day: '日', category: 'カテゴリ',
    costUSD: '費用', link: 'リンク', area: 'エリア', duration: '所要時間', bestTime: 'おすすめ時間', tip: 'ヒント',
    mapQuery: '地図', verified: '確認済み', cents: '金額', payer: '支払った人', split: '分け方', shares: '負担する人',
    custom: '個別の負担額', text: '内容', done: '完了', year: '年', rate: 'レート', name: '名前', group: '分類',
    icon: 'アイコン', by: '作った人', tags: 'タグ',
  };
  function label(kind, e) {
    switch (kind) {
      case 'days': return e.id.slice(1) + '日目' + (e.city ? '（' + e.city + '）' : '');
      case 'items': return e.day.slice(1) + '日目 ' + (e.time ? e.time + ' ' : '') + e.title;
      case 'ideas': return e.title;
      case 'people': return e.name;
      case 'expenses': return e.title + ' ' + fmtUSD(e.cents);
      case 'checks': return e.text;
      default: return '年・為替レート';
    }
  }
  const strip = e => { const c = Object.assign({}, e); delete c.u; delete c.v; delete c.by; return c; };
  // どちらが新しいか: 更新時刻 → 同じなら内容(作った人・投票は除く)の文字列で決める。誰がどの順で合体しても同じ結果になる。
  function pickNewer(l, r) {
    if (r.u > l.u) return r;
    if (r.u < l.u) return l;
    return stable(strip(r)) > stable(strip(l)) ? r : l;
  }
  // 年とレートは別々に、新しく直した方を採用(同時刻なら値の大きい方)
  function mergeMeta(l, r) {
    const pick = (lt, lv, rt, rv) => (rt > lt || (rt === lt && stable(rv) > stable(lv)) ? [rt, rv] : [lt, lv]);
    const [yu, year] = pick(l.yu, l.year, r.yu, r.year);
    const [ru, rate] = pick(l.ru, l.rate, r.ru, r.rate);
    return { year, yu, rate, ru };
  }
  function mergeEntity(kind, l, r) {
    let m = pickNewer(l, r);
    // 作った人(by)は、空でない値のうち辞書順で最小のもの。削除済みの記録にも残す。
    if ('by' in l || 'by' in r) {
      const by = [l.by, r.by].filter(Boolean).sort()[0] || '';
      if (by !== (m.by || '')) m = Object.assign({}, m, { by });
    }
    // 投票は、名前ごとに新しい方を採用して合算(削除済みの記録にも残す)
    if (kind === 'ideas') m = Object.assign({}, m, { v: cleanVotes([...(l.v || []), ...(r.v || [])]) });
    return m;
  }
  function diffFields(l, m) {
    const keys = new Set([...Object.keys(l), ...Object.keys(m)]);
    const out = [];
    for (const k of keys) {
      if (k === 'id' || k === 'u' || k === 'v' || k === 'yu' || k === 'ru') continue;
      if (stable(l[k]) !== stable(m[k])) out.push(FIELD_JP[k] || k);
    }
    return out;
  }

  // local と incoming(検証済み)を統合。local は変更しない。 { state, changes } を返す。
  function merge(local, incoming) {
    const out = clone(local);
    const changes = [];
    const lm = local.meta, rm = incoming.meta;
    const mm = mergeMeta(lm, rm);
    if (stable(mm) !== stable(lm)) {
      out.meta = clone(mm);
      const mf = diffFields(lm, mm);
      if (mf.length) changes.push({ kind: 'meta', type: 'update', id: 'meta', label: label('meta'), detail: mf.join('・') });
    }
    for (const kind of KINDS) {
      const idx = new Map(out[kind].map((e, i) => [e.id, i]));
      for (const r of incoming[kind]) {
        const i = idx.get(r.id);
        if (kind === 'ideas' && r.vo) { // 投票だけの記録: 手元にあるアイデアに票を足す(手元にないものは無視)
          if (i === undefined) continue;
          const l = out[kind][i];
          const v = cleanVotes([...(l.v || []), ...r.v]);
          if (stable(v) === stable(l.v || [])) continue;
          const before = new Set(voters(l)), after = new Set(voters({ v }));
          out[kind][i] = Object.assign({}, l, { v });
          const plus = [...after].filter(n => !before.has(n)), minus = [...before].filter(n => !after.has(n));
          if (!l.deleted && (plus.length || minus.length)) {
            changes.push({ kind, type: 'votes', id: r.id, label: label(kind, l), detail: (plus.length ? '投票+ ' + plus.join('、') : '') + (plus.length && minus.length ? ' / ' : '') + (minus.length ? '票の取り消し ' + minus.join('、') : '') });
          }
          continue;
        }
        if (i === undefined) {
          idx.set(r.id, out[kind].length);
          out[kind].push(clone(r));
          if (!r.deleted) changes.push({ kind, type: 'add', id: r.id, label: label(kind, r), detail: '' });
          continue;
        }
        const l = out[kind][i];
        const m = mergeEntity(kind, l, r);
        if (stable(m) !== stable(l)) {
          out[kind][i] = clone(m);
          if (m.deleted && l.deleted) {
            continue; // どちらも削除済み。見える変化はないので報告しない
          } else if (m.deleted && !l.deleted) {
            changes.push({ kind, type: 'delete', id: r.id, label: label(kind, l), detail: '' });
          } else if (l.deleted && !m.deleted) {
            changes.push({ kind, type: 'add', id: r.id, label: label(kind, m), detail: '' });
          } else {
            const f = diffFields(l, m);
            const before = new Set(voters(l)), after = new Set(voters(m));
            const plus = [...after].filter(n => !before.has(n)), minus = [...before].filter(n => !after.has(n));
            if (!f.length && !plus.length && !minus.length) continue; // 見た目に変化がない(取り消しの記録だけ等)
            const parts = [];
            if (f.length) parts.push(f.join('・') + 'が変わる');
            if (plus.length) parts.push('投票+ ' + plus.join('、'));
            if (minus.length) parts.push('票の取り消し ' + minus.join('、'));
            changes.push({ kind, type: f.length ? 'update' : 'votes', id: r.id, label: label(kind, m), detail: parts.join(' / ') });
          }
        } else if (!l.deleted && !r.deleted && stable(strip(l)) !== stable(strip(r))) {
          changes.push({ kind, type: 'keep', id: r.id, label: label(kind, l), detail: '' });
        }
      }
    }
    return { state: out, changes };
  }

  // ---------- 精算 ----------
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // 均等割り: 端数セントは支払いIDから決まる位置の人から1セントずつ配る（全端末で同じ結果）
  function splitEqual(cents, names, seedId) {
    const list = [...new Set(names)].sort(byName);
    const n = list.length;
    const out = new Map();
    if (!n) return out;
    const base = Math.floor(cents / n);
    const rem = cents - base * n;
    const start = hash32(seedId || '') % n;
    list.forEach(nm => out.set(nm, base));
    for (let k = 0; k < rem; k++) { const nm = list[(start + k) % n]; out.set(nm, out.get(nm) + 1); }
    return out;
  }
  function expenseShares(e) {
    return e.split === 'custom' ? new Map(e.custom) : splitEqual(e.cents, e.shares, e.id);
  }
  // 各人の 支払った額 / 負担額 / 差額(+は受け取る側)
  function summarize(expenses) {
    const rows = new Map();
    const row = n => { if (!rows.has(n)) rows.set(n, { paid: 0, owed: 0, net: 0 }); return rows.get(n); };
    let total = 0;
    for (const e of expenses) {
      if (e.deleted) continue;
      total += e.cents;
      row(e.payer).paid += e.cents;
      for (const [n, c] of expenseShares(e)) row(n).owed += c;
    }
    for (const r of rows.values()) r.net = r.paid - r.owed;
    return { total, rows };
  }
  // 送金回数が最少になるよう、合計0になる最大のグループに分ける（人数16以下は厳密、超えたら貪欲法）
  function zeroSumGroups(v) {
    const m = v.length, N = 1 << m;
    const sum = new Float64Array(N), dp = new Int16Array(N), ch = new Int8Array(N);
    for (let mask = 1; mask < N; mask++) {
      sum[mask] = sum[mask & (mask - 1)] + v[31 - Math.clz32(mask & -mask)];
      let best = -1, bi = 0;
      for (let i = 0; i < m; i++) {
        if ((mask >> i) & 1) { const val = dp[mask ^ (1 << i)]; if (val > best) { best = val; bi = i; } }
      }
      dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
      ch[mask] = bi;
    }
    const order = [];
    for (let mask = N - 1; mask; mask ^= 1 << ch[mask]) order.push(ch[mask]);
    order.reverse();
    const groups = [];
    let cur = [], run = 0;
    for (const i of order) { cur.push(i); run += v[i]; if (run === 0) { groups.push(cur); cur = []; } }
    if (cur.length) groups.push(cur);
    return groups;
  }
  function settle(rows) { // rows: Map 名前 -> net(セント)
    const people = [...rows].filter(p => p[1] !== 0).sort((a, b) => byName(a[0], b[0]));
    if (!people.length) return [];
    const groups = people.length <= 16 ? zeroSumGroups(people.map(p => p[1])) : [people.map((_, i) => i)];
    const out = [];
    const order = (a, b) => b.c - a.c || byName(a.n, b.n);
    for (const g of groups) {
      const cr = g.filter(i => people[i][1] > 0).map(i => ({ n: people[i][0], c: people[i][1] })).sort(order);
      const de = g.filter(i => people[i][1] < 0).map(i => ({ n: people[i][0], c: -people[i][1] })).sort(order);
      let a = 0, b = 0;
      while (a < cr.length && b < de.length) {
        const t = Math.min(cr[a].c, de[b].c);
        out.push({ from: de[b].n, to: cr[a].n, cents: t });
        cr[a].c -= t; de[b].c -= t;
        if (!cr[a].c) a++;
        if (!de[b].c) b++;
      }
    }
    return out.sort((x, y) => byName(x.from, y.from) || byName(x.to, y.to));
  }

  // ---------- 共有リンク / JSON ----------
  // まだ触っていない既定項目(u=0)は送らない。リンクを短くするため。
  function stripForShare(state) {
    const out = emptyState();
    out.meta = state.meta;
    for (const kind of KINDS) {
      out[kind] = state[kind].filter(e => e.u > 0 || (kind === 'ideas' && e.v && e.v.length))
        .map(e => (kind === 'ideas' && e.u === 0 ? { id: e.id, vo: true, v: e.v, u: 0 } : e)); // 触っていないアイデアは id と投票だけ送る
    }
    return out;
  }
  // ---------- ライブ共有(サーバー上の1つの書類) ----------
  // 書類 = 触った項目(u>0)と、投票のあるアイデアだけ。既定の初期項目は各端末が持っているので送らない。
  function toDoc(state) {
    const out = emptyState();
    out.meta = state.meta;
    for (const kind of KINDS) out[kind] = state[kind].filter(e => e.u > 0 || (kind === 'ideas' && e.v && e.v.length));
    return out;
  }
  // 「サーバーが同じ内容を持っているか」を比べるための文字列(順番に左右されない)
  function docKey(state) {
    const d = toDoc(state);
    const o = { meta: d.meta };
    for (const kind of KINDS) o[kind] = d[kind].slice().sort((a, b) => byName(a.id, b.id));
    return stable(o);
  }
  const toB64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64 = str => {
    let t = str.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  async function runStream(bytes, stream, cap) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (cap && total > cap) { reader.cancel(); throw new Error('データが大きすぎます'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  async function encodeShare(state) {
    const bytes = new TextEncoder().encode(JSON.stringify(stripForShare(state)));
    if (typeof CompressionStream === 'function') {
      try { return 'z' + toB64(await runStream(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* 圧縮なしで続ける */ }
    }
    return 'r' + toB64(bytes);
  }
  async function decodeShare(s) {
    if (typeof s !== 'string' || s.length < 2 || s.length > 400000) throw new Error('リンクの形式が正しくありません');
    let bytes = fromB64(s.slice(1));
    if (s[0] === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('このブラウザでは圧縮リンクを開けません。ファイルで共有してください');
      bytes = await runStream(bytes, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES);
    } else if (s[0] !== 'r') throw new Error('リンクの形式が正しくありません');
    return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
  }

  return {
    APP_ID, KINDS, CATEGORIES, CHECK_GROUPS, PROFILE_ICONS, IDEA_TAGS,
    parseMoney, fmtUSD, fmtJPY, safeUrl, mapUrl, dayDate, newId,
    cleanVotes, voters, setVote, cleanOne, emptyState, sanitize, clone, seedMissing,
    merge, stable, splitEqual, expenseShares, summarize, settle, zeroSumGroups,
    stripForShare, encodeShare, decodeShare, toDoc, docKey,
  };
})();
