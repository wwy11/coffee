'use strict';

/* ============ 品类 ============ */
const CATEGORIES = [
  { id: 'coffee', label: '咖啡' },
  { id: 'milktea', label: '奶茶' },
  { id: 'juice', label: '果汁' },
  { id: 'other', label: '其他' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
// 老数据无 category 时归为咖啡
const normCat = (c) => (CAT_LABEL[c] ? c : 'coffee');

/* ============ 存储层：IndexedDB ============ */
const DB = (() => {
  const NAME = 'coffee-db';
  const STORE = 'records';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(NAME, 1); // 隐私模式等场景下访问 indexedDB 可能同步抛错
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
    // 关键：失败后清掉缓存的 promise，下次调用会重新尝试打开，
    // 而不是把这个"失败的结果"永久缓存住，导致之后全部跟着失败
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function tx(mode) {
    return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  return {
    async all() {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const out = [];
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { const v = c.value; v.category = normCat(v.category); out.push(v); c.continue(); }
          else { out.sort((a, b) => b.drankAt - a.drankAt); res(out); }
        };
        cur.onerror = () => rej(cur.error);
      });
    },
    async get(id) {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => { const v = r.result; if (v) v.category = normCat(v.category); res(v); };
        r.onerror = () => rej(r.error);
      });
    },
    async put(rec) {
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.put(rec);
        r.onsuccess = () => res(rec);
        r.onerror = () => rej(r.error);
      });
    },
    async remove(id) {
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async bulkPut(recs) {
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        let i = 0;
        function next() {
          if (i >= recs.length) return res();
          const r = store.put(recs[i++]);
          r.onsuccess = next;
          r.onerror = () => rej(r.error);
        }
        next();
      });
    },
  };
})();

/* ============ 工具 ============ */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function stars(n) { return '★★★★★☆☆☆☆☆'.slice(5 - n, 10 - n); }

function relTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (days === 2) return `前天 ${hm}`;
  if (days < 7) return `${days}天前`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toLocalInput(ts) {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v) { return new Date(v).getTime(); }

function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

const SWIPE_W = 72; // 删除按钮露出宽度
function closeSwipe(wrap) {
  wrap.classList.remove('open');
  const body = wrap.querySelector('.item-body');
  if (body) body.style.transform = '';
}
function attachSwipe(wrap, body) {
  let x0 = 0, y0 = 0, dx = 0, dragging = false, decided = false, horiz = false;
  const onStart = (e) => {
    const t = e.touches ? e.touches[0] : e;
    x0 = t.clientX; y0 = t.clientY; dx = 0;
    dragging = true; decided = false; horiz = false;
  };
  const onMove = (e) => {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const mx = t.clientX - x0, my = t.clientY - y0;
    if (!decided) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      decided = true;
      horiz = Math.abs(mx) > Math.abs(my);
    }
    if (!horiz) return;
    if (e.cancelable) e.preventDefault();
    const base = wrap.classList.contains('open') ? -SWIPE_W : 0;
    dx = Math.max(-SWIPE_W, Math.min(0, base + mx));
    body.style.transform = `translateX(${dx}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    if (!horiz) return;
    if (dx < -SWIPE_W / 2) { wrap.classList.add('open'); body.style.transform = `translateX(${-SWIPE_W}px)`; }
    else closeSwipe(wrap);
  };
  body.addEventListener('touchstart', onStart, { passive: true });
  body.addEventListener('touchmove', onMove, { passive: false });
  body.addEventListener('touchend', onEnd);
  body.addEventListener('mousedown', (e) => {
    onStart(e);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  });
}

/* ============ 快速输入：把「店名+饮品名」一句话切成两个字段 ============ */
// 店名词库：命中即按词库标准写法填入（顺带纠正拼写/大小写）。想加新店直接往里放。
const SHOP_KW = [
  // 咖啡连锁
  '星巴克', '瑞幸', 'luckin', '库迪', 'Cotti', 'Manner', 'M Stand', 'Seesaw',
  '%Arabica', 'Arabica', 'Blue Bottle', '蓝瓶', 'Tim Hortons', 'Tims', 'Costa',
  "Peet's", 'Peets', '皮爷', 'NOWWA', '挪瓦', 'T97', '幸运咖', '歪咖啡',
  '代数学家', 'Algebraist', '鹰集', 'Grid Coffee', 'Metal Hands', '铁手',
  // 茶饮
  '喜茶', '奈雪', '茶百道', '蜜雪冰城', '雪王', '古茗', '沪上阿姨', '霸王茶姬',
  '茶颜悦色', '乐乐茶', 'Lelecha', 'CoCo', '都可', '一点点', '书亦', '益禾堂',
  '7分甜', '甜啦啦', '茶理宜世', '茉莉奶白', '阿嬷手作', '丘大叔', '伏见桃山',
  'LINLEE', '柠季', '挞柠', '爷爷不泡茶', '茶救星球', '快乐柠檬', '贡茶',
  // 果汁/鲜榨/酸奶
  '混果汁', '一芳', '果呀呀', '果之满满', '鲜果时间', '果汁先生', '满小柚',
  '本来不该有', '野人先生', '莓超疯', 'gaga', '一只酸奶牛',
  // 酸奶/其他
  'Blueglass', '茉酸奶',
];
const SHOP_KW_COMPACT = SHOP_KW.map((k) => ({ name: k, key: k.replace(/\s+/g, '').toLowerCase() }));

// 口语开头词（剥掉，避免混进店名）
const LEAD_WORDS = ['来一杯', '给我来', '帮我来', '来杯', '我要', '喝一杯', '喝个', '点一杯', '点个', '刚在', '刚去', '买了'];

// 兜底用品类词：词库没收录店名时，按第一个品类词的位置切（允许犯错，店名保留原话）
const DRINK_HINT = /(拿铁|美式|澳白|dirty|摩卡|卡布|浓缩|手冲|冷萃|生椰|奶茶|柠檬茶|杨枝甘露|轻乳茶|芝士|水果茶|奶咖|燕麦|龙井|茉莉|乌龙|四季春)/;

/* 自定义店名词库：保存记录时自动收集词库外的新店名，切分时与内置词库合并使用 */
const LS_CUSTOM_SHOPS = 'coffee-custom-shops';
function loadCustomShops() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CUSTOM_SHOPS) || '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch (e) { return []; }
}
function addCustomShop(name) {
  const t = String(name || '').trim();
  const key = t.replace(/\s+/g, '').toLowerCase();
  if (!key || t.length > 15) return false; // 过长的不学，防止把整句话当店名收进去
  if (SHOP_KW_COMPACT.some((x) => x.key === key)) return false; // 内置词库已有
  const list = loadCustomShops();
  if (list.some((s) => s.replace(/\s+/g, '').toLowerCase() === key)) return false;
  list.push(t);
  try {
    localStorage.setItem(LS_CUSTOM_SHOPS, JSON.stringify(list));
  } catch (e) { return false; } // 隐私模式等场景存不了，本次会话不影响使用
  return true;
}
function removeCustomShop(name) {
  const list = loadCustomShops().filter((s) => s !== name);
  try {
    localStorage.setItem(LS_CUSTOM_SHOPS, JSON.stringify(list));
  } catch (e) {}
}

function splitShopDrink(raw) {
  const text = String(raw || '').trim();
  if (!text) return { shop: '', coffee: '' };
  const compact = text.replace(/\s+/g, ''); // 去空格保大小写，用于切分和取值
  const lower = compact.toLowerCase();       // 长度与 compact 一致，用于匹配

  // 剥口语开头："来一杯manner拿铁" → "manner拿铁"
  let s = lower, start = 0, changed = true;
  while (changed) {
    changed = false;
    for (const w of LEAD_WORDS) {
      if (s.startsWith(w)) { s = s.slice(w.length); start += w.length; changed = true; }
    }
  }

  // 1) 店名词库最长匹配（内置 + 自动学到的自定义）→ 店名填词条写法，其后为饮品名
  const custom = loadCustomShops().map((k) => ({ name: k, key: k.replace(/\s+/g, '').toLowerCase() }));
  let hit = -1, hitLen = 0, hitName = '';
  for (const { name, key } of [...SHOP_KW_COMPACT, ...custom]) {
    const i = s.indexOf(key);
    if (i >= 0 && key.length > hitLen) { hit = i; hitLen = key.length; hitName = name; }
  }
  if (hit >= 0) {
    const abs = start + hit;
    return { shop: hitName, coffee: compact.slice(abs + hitLen) };
  }

  // 2) 词库没收录 → 第一个品类词处切分，店名保留用户原话
  const m = DRINK_HINT.exec(s);
  if (m && m.index > 0) {
    const abs = start + m.index;
    return { shop: compact.slice(start, abs), coffee: compact.slice(abs) };
  }

  // 3) 完全没头绪 → 全填饮品名，店名留空手动补
  return { shop: '', coffee: compact.slice(start) || text };
}

const LS_LAST_BACKUP = 'coffee-last-backup';

/* ============ 主题：默认跟随系统，设置页可固定为浅色/深色 ============ */
const LS_THEME = 'coffee-theme';
const THEME_COLOR = { light: '#88c1a3', dark: '#161a16' };
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

// 'auto' | 'light' | 'dark'；无记录时视为 auto
function storedTheme() {
  const t = localStorage.getItem(LS_THEME);
  return (t === 'light' || t === 'dark') ? t : 'auto';
}
// 把当前主题应用到 <html data-theme> 和状态栏颜色（theme-color meta）
function applyTheme() {
  const m = storedTheme();
  const dark = m === 'dark' || (m === 'auto' && mqDark.matches);
  // 必须带值：CSS 用 [data-theme="dark"] 匹配，空值属性（toggleAttribute）匹配不上
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
}
function setTheme(mode) {
  try {
    localStorage.setItem(LS_THEME, mode);
  } catch (e) {} // 隐私模式等场景 localStorage 可能不可用，本次会话仍生效
  applyTheme();
}
// "跟随系统"下系统切换亮暗时实时跟进；老 iOS 用 addListener
if (mqDark.addEventListener) mqDark.addEventListener('change', () => { if (storedTheme() === 'auto') applyTheme(); });
else if (mqDark.addListener) mqDark.addListener(() => { if (storedTheme() === 'auto') applyTheme(); });
applyTheme();

/* ============ 路由 ============ */
const app = document.getElementById('app');
const routes = {};
function route(name, fn) { routes[name] = fn; }
let state = { search: '', cat: 'all', star: 0, starOpen: false };

// 应用内跳转栈：go() 压入出发页，goBack() 消费。
// 只在应用内跳转时有值，所以"刷新后/直接打开深链"时它是空的，
// 此时退无可退，就用 location.replace 原地换页，不会退出网页。
const navStack = [];
function go(name, params) {
  navStack.push(location.hash.slice(1) || 'home');
  location.hash = '#' + name + (params ? '?' + new URLSearchParams(params) : '');
}
function goBack(fallback = 'home') {
  if (navStack.length > 0) {
    navStack.pop();
    history.back();
  } else {
    location.replace('#' + fallback);
  }
}
async function render() {
  const raw = location.hash.slice(1) || 'home';
  const [name, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  try {
    await (routes[name] || routes.home)(params);
  } catch (err) {
    console.error('[饮记] 页面渲染失败:', err);
    renderError(err);
  }
}
// 统一错误兜底：IndexedDB 打不开、配额满等异常不再白屏
function renderError(err) {
  const msg = err && err.message ? err.message : String(err);
  const page = el(`
    <div class="empty">
      <div class="big">😵</div>
      <div class="t1">页面出错了</div>
      <div class="t2">${esc(msg)}</div>
      <button class="retry-btn">重试</button>
    </div>`);
  page.querySelector('.retry-btn').onclick = () => render();
  app.innerHTML = '';
  app.append(page);
}
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

/* ============ 首页：列表 + 搜索 + 品类筛选 ============ */
route('home', async () => {
  let records = await DB.all();

  const page = el(`<div></div>`);

  // 顶栏
  const topbar = el(`<div class="topbar"></div>`);
  if (state.searchOpen) {
    const bar = el(`<div class="searchbar"><input type="text" placeholder="🔍 搜店名 / 饮品名" /></div>`);
    const input = bar.querySelector('input');
    input.value = state.search;
    input.addEventListener('input', () => { state.search = input.value; renderList(); });
    const close = el(`<button class="iconbtn">✕</button>`);
    close.onclick = () => { state.searchOpen = false; state.search = ''; render(); };
    topbar.append(bar, close);
    setTimeout(() => input.focus(), 0);
  } else {
    topbar.append(
      el(`<div class="title">🥤 饮记</div>`),
    );
    const search = el(`<button class="iconbtn" aria-label="搜索">🔍</button>`);
    search.onclick = () => { state.searchOpen = true; render(); };
    const settings = el(`<button class="iconbtn" aria-label="设置">⚙️</button>`);
    settings.onclick = () => go('settings');
    topbar.append(search, settings);
  }
  page.append(topbar);

  // 品类筛选条
  const tabs = el(`<div class="cat-tabs"></div>`);
  const catOptions = [{ id: 'all', label: '全部' }, ...CATEGORIES];
  const tabEls = {};
  for (const c of catOptions) {
    const t = el(`<button class="cat-tab${state.cat === c.id ? ' on' : ''}">${c.label}</button>`);
    t.onclick = () => {
      state.cat = c.id;
      Object.values(tabEls).forEach((x) => x.classList.remove('on'));
      t.classList.add('on');
      renderList();
    };
    tabEls[c.id] = t;
    tabs.append(t);
  }
  // 星级筛选展开按钮（默认隐藏筛选条，点这里展开）
  const starToggle = el(`<button class="cat-tab star-toggle${state.starOpen || state.star ? ' on' : ''}" aria-label="按星级筛选">☆ 星级</button>`);
  starToggle.onclick = () => { state.starOpen = !state.starOpen; render(); };
  tabs.append(starToggle);
  page.append(tabs);

  // 星级筛选条（默认隐藏）
  if (state.starOpen) {
    const starBar = el(`<div class="star-tabs"></div>`);
    const starOptions = [{ v: 0, label: '全部' }, { v: 5, label: '5★' }, { v: 4, label: '4★+' }, { v: 3, label: '3★+' }];
    const starEls = {};
    for (const o of starOptions) {
      const t = el(`<button class="star-tab${state.star === o.v ? ' on' : ''}">${o.label}</button>`);
      t.onclick = () => {
        state.star = o.v;
        Object.values(starEls).forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        renderList();
      };
      starEls[o.v] = t;
      starBar.append(t);
    }
    page.append(starBar);
  }

  const content = el(`<div class="content"></div>`);
  page.append(content);

  function renderList() {
    content.innerHTML = '';
    const q2 = state.search.trim().toLowerCase();
    let list = records;
    if (state.cat !== 'all') list = list.filter((r) => r.category === state.cat);
    if (state.star === 5) list = list.filter((r) => r.rating === 5);
    else if (state.star > 0) list = list.filter((r) => r.rating >= state.star);
    if (q2) list = list.filter((r) => (r.shop + ' ' + r.coffee).toLowerCase().includes(q2));
    if (records.length === 0) {
      content.append(el(`
        <div class="empty">
          <div class="big">🥤</div>
          <div class="t1">还没有记录</div>
          <div class="t2">喝到一杯好喝的就记下来吧</div>
        </div>`));
      return;
    }
    if (list.length === 0) {
      content.append(el(`<div class="empty"><div class="t1">没有匹配的记录</div></div>`));
      return;
    }
    for (const r of list) {
      const wrap = el(`
        <div class="item-wrap">
          <div class="item-body">
            <div><span class="stars">${stars(r.rating)}</span><span class="shop">${esc(r.shop || '未命名')}</span></div>
            <div class="sub"><span class="cat-chip">${CAT_LABEL[r.category]}</span>${esc(r.coffee || '')}${r.coffee ? ' · ' : ' '}${relTime(r.drankAt)}</div>
          </div>
          <button class="item-del" aria-label="删除">🗑</button>
        </div>`);
      const body = wrap.querySelector('.item-body');
      const del = wrap.querySelector('.item-del');
      attachSwipe(wrap, body);
      body.onclick = () => { if (wrap.classList.contains('open')) { closeSwipe(wrap); return; } go('detail', { id: r.id }); };
      del.onclick = async (e) => {
        e.stopPropagation();
        try {
          await DB.remove(r.id);
        } catch (err) {
          toast('删除失败');
          return;
        }
        records = records.filter((x) => x.id !== r.id);
        toast('已删除');
        renderList();
      };
      content.append(wrap);
    }
  }
  renderList();

  if (!state.searchOpen) {
    const fab = el(`<button class="fab">➕ 记一杯</button>`);
    fab.onclick = () => go('edit');
    page.append(fab);
  }

  app.innerHTML = '';
  app.append(page);
});

/* ============ 记一杯 / 编辑 表单 ============ */
route('edit', async (params) => {
  const editing = params.id ? await DB.get(params.id) : null;
  const rec = editing || { id: uid(), category: 'coffee', shop: '', coffee: '', rating: 0, note: '', drankAt: Date.now(), photo: null };
  rec.category = normCat(rec.category);

  const page = el(`<div></div>`);
  const topbar = el(`<div class="topbar"></div>`);
  const back = el(`<button class="iconbtn">←</button>`);
  back.onclick = () => goBack(); // 进入编辑页前必有来源页；深链直开时 goBack 会原地换页
  const title = el(`<div class="title">${editing ? '编辑' : '记一杯'}</div>`);
  const save = el(`<button class="textbtn" disabled>保存</button>`);
  topbar.append(back, title, save);
  page.append(topbar);

  const form = el(`<div class="form"></div>`);
  const hintSlot = el(`<div></div>`);

  // 快速输入：语音说一句 / 文本粘一句「店名+饮品名」，切分后分别填入
  const importRow = el(`<div class="import-row"></div>`);
  const voiceBtn = el(`<button class="quick-btn">🎤 语音输入</button>`);
  const textBtn = el(`<button class="quick-btn">✂️ 文本切分</button>`);
  voiceBtn.onclick = () => runVoice();
  textBtn.onclick = () => runText();
  if (Voice.supported) importRow.append(voiceBtn);
  importRow.append(textBtn);

  form.append(hintSlot, importRow);

  const catField = el(`
    <div class="field"><label>品类</label>
      <div class="cat-select">
        ${CATEGORIES.map((c) => `<button type="button" class="cat-opt${rec.category === c.id ? ' on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('')}
      </div></div>`);
  const shopField = el(`
    <div class="field"><label>店名</label>
      <input type="text" id="f-shop" value="${esc(rec.shop)}" /></div>`);
  const coffeeField = el(`
    <div class="field"><label>饮品名</label>
      <input type="text" id="f-coffee" value="${esc(rec.coffee)}" /></div>`);
  const ratingField = el(`
    <div class="field"><label>评分</label>
      <div class="stars-input">
        ${[1, 2, 3, 4, 5].map((i) => `<span class="star" data-v="${i}">★</span>`).join('')}
      </div></div>`);
  const noteField = el(`
    <div class="field"><label>印象（选填）</label>
      <textarea id="f-note">${esc(rec.note)}</textarea></div>`);
  const timeField = el(`
    <div class="field"><label>时间</label>
      <div class="time-row">
        <input type="datetime-local" id="f-time" value="${toLocalInput(rec.drankAt)}" />
      </div></div>`);

  form.append(catField, shopField, coffeeField, ratingField, noteField, timeField);
  page.append(form);

  const catOpts = [...catField.querySelectorAll('.cat-opt')];
  catOpts.forEach((b) => b.onclick = () => {
    rec.category = b.dataset.cat;
    catOpts.forEach((x) => x.classList.toggle('on', x.dataset.cat === rec.category));
  });

  const shopInput = shopField.querySelector('input');
  const coffeeInput = coffeeField.querySelector('input');
  const noteInput = noteField.querySelector('textarea');
  const timeInput = timeField.querySelector('input');
  const starEls = [...ratingField.querySelectorAll('.star')];

  function paintStars() {
    starEls.forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= rec.rating));
  }
  starEls.forEach((s) => s.onclick = () => {
    const v = Number(s.dataset.v);
    rec.rating = (rec.rating === v) ? v - 1 : v; // 再点同一颗可减一星
    paintStars();
  });
  paintStars();

  function validate() {
    const ok = shopInput.value.trim() || coffeeInput.value.trim();
    save.disabled = !ok;
  }
  [shopInput, coffeeInput].forEach((i) => i.addEventListener('input', validate));
  validate();

  // 撞库提示（P2）
  if (!editing) {
    const check = async () => {
      const s = shopInput.value.trim(), c = coffeeInput.value.trim();
      hintSlot.innerHTML = '';
      if (!s && !c) return;
      const all = await DB.all();
      const dup = all.find((r) => r.shop.trim() === s && r.coffee.trim() === c && s && c);
      if (dup) {
        hintSlot.append(el(`<div class="hint warn">⚠ 你在「${relTime(dup.drankAt)}」喝过 ${esc(s)} ${esc(c)}，当时 ${stars(dup.rating)}</div>`));
      }
    };
    shopInput.addEventListener('blur', check);
    coffeeInput.addEventListener('blur', check);
  }

  // 语音说一句「店名+饮品名」，切分填入。
  // 识别可能一直不结束（iOS onend 偶发不触发），所以有三个出口：
  // ① 识别完成 ② 手动点「停止」 ③ 30 秒看门狗自动停。停止后 2.5 秒宽限期内
  // 仍等得到结果就用它，等不到就强制收尾进失败浮层，绝不永远转圈。
  async function runVoice() {
    const handle = Voice.listen();
    let overlay = null, grace = null, finished = false;

    const enterGrace = (btn) => {
      if (grace || finished) return;
      if (btn) { btn.disabled = true; btn.textContent = '停止中…'; }
      try { handle.stop(); } catch (e) {}
      grace = setTimeout(() => {
        if (finished) return;
        finished = true;
        handle.abort();
        if (overlay) overlay.remove();
        showVoiceFail('没听清内容，再试一次');
      }, 2500);
    };

    overlay = showOverlay(`
      <div class="spinner"></div>
      <div class="msg">请说出「店名 + 饮品名」<br><span style="font-size:13px;color:var(--text-soft)">例：manner 拿铁巴西喜拉多日晒</span></div>
      <div class="row"><button id="ov-stop">停止</button></div>`, (box) => {
      box.querySelector('#ov-stop').onclick = (e) => enterGrace(e.target);
    });

    setTimeout(() => enterGrace(null), 30000); // 看门狗

    try {
      const text = await handle.promise;
      finished = true;
      clearTimeout(grace);
      overlay.remove();
      if (!text || !text.trim()) throw new Error('empty');
      applySplit(text, `✓ 「${esc(text)}」已切分填入，请核对`);
    } catch (e) {
      finished = true;
      clearTimeout(grace);
      overlay.remove();
      showVoiceFail(
        e.message === 'not-allowed' ? '麦克风没授权，请在系统设置里允许'
        : e.message === 'no-speech' ? '没听到声音，再试一次'
        : '识别失败，手动填吧'
      );
    }
  }

  function showVoiceFail(msg) {
    showOverlay(`
      <div class="msg">${msg}</div>
      <div class="row">
        <button id="ov-retry">重说</button>
        <button id="ov-manual" class="primary">手动填</button>
      </div>`, (box, close) => {
      box.querySelector('#ov-retry').onclick = () => { close(); runVoice(); };
      box.querySelector('#ov-manual').onclick = close;
    });
  }

  // 文本粘一句「店名+饮品名」，切分填入（语音不可用/没听清时的兜底）
  function runText() {
    showOverlay(`
      <div class="msg">粘贴或输入「店名 + 饮品名」</div>
      <input id="ov-text" type="text" placeholder="例：manner 拿铁巴西喜拉多日晒" />
      <div class="row">
        <button id="ov-cancel">取消</button>
        <button id="ov-ok" class="primary">填入</button>
      </div>`, (box, close) => {
      const input = box.querySelector('#ov-text');
      setTimeout(() => input.focus(), 0);
      const apply = () => {
        const t = input.value;
        close();
        applySplit(t, '✓ 已切分填入，请核对');
      };
      box.querySelector('#ov-cancel').onclick = close;
      box.querySelector('#ov-ok').onclick = apply;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    });
  }

  function applySplit(text, okMsg) {
    const g = splitShopDrink(text);
    if (g.shop) shopInput.value = g.shop;
    if (g.coffee) coffeeInput.value = g.coffee;
    validate();
    hintSlot.innerHTML = '';
    hintSlot.append(el(`<div class="hint ok">${okMsg}</div>`));
  }

  save.onclick = async () => {
    rec.shop = shopInput.value.trim();
    rec.coffee = coffeeInput.value.trim();
    rec.note = noteInput.value.trim();
    rec.drankAt = fromLocalInput(timeInput.value) || Date.now();
    if (!editing) rec.createdAt = Date.now();
    rec.updatedAt = Date.now();
    try {
      await DB.put(rec);
    } catch (e) {
      toast('保存失败：存储不可用或空间不足');
      return;
    }
    addCustomShop(rec.shop); // 词库里没有的店名自动收编，下次切分直接认识
    toast('已保存');
    // 回到进入编辑页之前的地方（新记录 → 列表；编辑 → 详情），不往历史栈里压新条目
    goBack();
  };

  app.innerHTML = '';
  app.append(page);
});

/* ============ 详情页 ============ */
route('detail', async (params) => {
  const rec = await DB.get(params.id);
  if (!rec) { location.replace('#home'); return; } // 记录已不存在，重定向回首页（不压历史栈）

  const page = el(`<div></div>`);
  const topbar = el(`<div class="topbar"></div>`);
  const back = el(`<button class="iconbtn">←</button>`);
  back.onclick = () => goBack();
  const spacer = el(`<div class="spacer"></div>`);
  const editBtn = el(`<button class="textbtn">编辑</button>`);
  editBtn.onclick = () => go('edit', { id: rec.id });
  const delBtn = el(`<button class="iconbtn">🗑</button>`);
  delBtn.onclick = () => {
    showOverlay(`
      <div class="msg">删除这条记录？</div>
      <div class="row">
        <button id="ov-cancel">取消</button>
        <button id="ov-ok" class="primary" style="background:var(--danger);border-color:var(--danger)">删除</button>
      </div>`, (box, close) => {
      box.querySelector('#ov-cancel').onclick = close;
      box.querySelector('#ov-ok').onclick = async () => {
        try {
          await DB.remove(rec.id);
        } catch (err) {
          toast('删除失败');
          return;
        }
        close(); toast('已删除'); goBack();
      };
    });
  };
  topbar.append(back, spacer, editBtn, delBtn);
  page.append(topbar);

  const detail = el(`
    <div class="detail">
      <div class="d-stars">${stars(rec.rating)}</div>
      <div class="d-shop">${esc(rec.shop || '未命名')}</div>
      <div class="d-cat"><span class="cat-chip">${CAT_LABEL[rec.category]}</span></div>
      ${rec.coffee ? `<div class="d-coffee">${esc(rec.coffee)}</div>` : ''}
      ${rec.note ? `<div class="d-note">${esc(rec.note)}</div>` : ''}
      <div class="d-time">${new Date(rec.drankAt).toLocaleString('zh-CN')}</div>
      ${rec.photo ? `<div class="d-photo"><img src="${esc(rec.photo)}" alt="饮品照片" /></div>` : ''}
    </div>`);
  page.append(detail);

  app.innerHTML = '';
  app.append(page);
});

/* ============ 设置：备份 + 统计 ============ */
route('settings', async () => {
  const records = await DB.all();
  const page = el(`<div></div>`);
  const topbar = el(`<div class="topbar"></div>`);
  const back = el(`<button class="iconbtn">←</button>`);
  back.onclick = () => goBack();
  topbar.append(back, el(`<div class="title">设置</div>`));
  page.append(topbar);

  const s = el(`<div class="settings"></div>`);

  // 外观
  s.append(el(`<h3>外观</h3>`));
  const themeTabs = el(`<div class="cat-tabs theme-tabs"></div>`);
  for (const m of [{ v: 'auto', label: '跟随系统' }, { v: 'light', label: '浅色' }, { v: 'dark', label: '深色' }]) {
    const b = el(`<button class="cat-tab${storedTheme() === m.v ? ' on' : ''}">${m.label}</button>`);
    b.onclick = () => {
      setTheme(m.v);
      themeTabs.querySelectorAll('.cat-tab').forEach((x) => x.classList.toggle('on', x === b));
    };
    themeTabs.append(b);
  }
  s.append(themeTabs);

  // 自定义店名（保存记录时自动收集，点一下删除）
  s.append(el(`<h3>自定义店名</h3>`));
  const customShops = loadCustomShops();
  if (customShops.length === 0) {
    s.append(el(`<div class="note">暂无。保存记录时，词库里没有的店名会自动加到这里。</div>`));
  } else {
    const chipWrap = el(`<div class="custom-shops"></div>`);
    for (const name of customShops) {
      const chip = el(`<button class="custom-chip">${esc(name)} ✕</button>`);
      chip.onclick = () => {
        removeCustomShop(name);
        toast('已删除');
        setTimeout(render, 300);
      };
      chipWrap.append(chip);
    }
    s.append(chipWrap);
    s.append(el(`<div class="note">点击可删除。快速输入时会把它们当店名认。</div>`));
  }

  // 备份
  s.append(el(`<h3>数据备份</h3>`));
  const exportBtn = el(`<button class="bigbtn">⬆ 导出全部记录</button>`);
  exportBtn.onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `饮品记录-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(LS_LAST_BACKUP, String(Date.now()));
    toast('已导出');
    setTimeout(render, 300);
  };
  const importBtn = el(`<button class="bigbtn">⬇ 从备份文件恢复</button>`);
  const importInput = el(`<input type="file" accept="application/json,.json" style="display:none" />`);
  importBtn.onclick = () => importInput.click();
  importInput.onchange = async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const recs = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(recs)) throw new Error('格式不对');
      const valid = recs.filter((r) => r && r.id).map((r) => ({
        id: String(r.id), category: normCat(r.category), shop: r.shop || '', coffee: r.coffee || '',
        rating: Number(r.rating) || 0, note: r.note || '',
        drankAt: Number(r.drankAt) || Date.now(),
        createdAt: Number(r.createdAt) || Date.now(),
        updatedAt: Number(r.updatedAt) || Date.now(),
        // photo 只接受图片 data URL 和 http(s) 地址，其余一律丢弃（防止导入恶意内容）
        photo: (typeof r.photo === 'string' && /^(data:image\/|https?:\/\/)/.test(r.photo)) ? r.photo : null,
      }));
      await DB.bulkPut(valid);
      toast(`已恢复 ${valid.length} 条`);
      setTimeout(render, 300);
    } catch (e) {
      toast('文件无法识别');
    } finally {
      importInput.value = '';
    }
  };
  s.append(exportBtn, importBtn, importInput);

  const last = Number(localStorage.getItem(LS_LAST_BACKUP) || 0);
  if (last) {
    const days = Math.floor((Date.now() - last) / 86400000);
    const warn = days >= 7;
    s.append(el(`<div class="note${warn ? ' warn' : ''}">上次备份：${days === 0 ? '今天' : days + ' 天前'}${warn ? ' ⚠ 建议再备份一次' : ''}</div>`));
  } else if (records.length > 0) {
    s.append(el(`<div class="note warn">还没有备份过，建议导出一次 ⚠</div>`));
  }
  s.append(el(`<div class="note">共 ${records.length} 条记录</div>`));

  // 统计
  if (records.length > 0) {
    s.append(el(`<h3>统计</h3>`));
    const avg = (records.reduce((a, r) => a + (r.rating || 0), 0) / records.length).toFixed(1);
    const shopCount = {};
    records.forEach((r) => { if (r.shop) shopCount[r.shop] = (shopCount[r.shop] || 0) + 1; });
    const top = Object.entries(shopCount).sort((a, b) => b[1] - a[1])[0];
    const catCount = CATEGORIES
      .map((c) => ({ label: c.label, n: records.filter((r) => r.category === c.id).length }))
      .filter((x) => x.n > 0);
    const catLine = catCount.map((x) => `${x.label} ${x.n}`).join(' · ');
    s.append(el(`<div class="stat">共 ${records.length} 杯 · 平均 ${avg}★${top ? ` · 最常喝 ${esc(top[0])}` : ''}</div>`));
    s.append(el(`<div class="stat" style="margin-top:8px">${catLine}</div>`));
  }

  page.append(s);
  app.innerHTML = '';
  app.append(page);
});

/* ============ 遮罩 ============ */
function showOverlay(innerHTML, setup) {
  const overlay = el(`<div class="overlay"><div class="box">${innerHTML}</div></div>`);
  const box = overlay.querySelector('.box');
  const close = () => overlay.remove();
  document.body.appendChild(overlay);
  if (setup) setup(box, close);
  return overlay;
}

/* ============ 语音识别（Web Speech API；切分规则见 splitShopDrink） ============ */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // 返回 { promise, stop, abort }：
  // stop 优雅收尾（iOS 会把已说的话吐成最终结果，onresult/onend 随后触发）；
  // abort 立即放弃并释放麦克风。iOS 的 onend 偶发不触发导致 Promise 挂起，
  // 上层必须用「宽限期 + 超时」兜底，不能只依赖事件回调。
  function listen() {
    let rec = null, settled = false;
    const promise = new Promise((resolve, reject) => {
      if (!SR) { settled = true; reject(new Error('unsupported')); return; }
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => { if (!settled) { settled = true; resolve(e.results[0][0].transcript || ''); } };
      rec.onerror = (e) => { if (!settled) { settled = true; reject(new Error(e.error || 'error')); } };
      rec.onend = () => { if (!settled) { settled = true; reject(new Error('no-speech')); } };
      try {
        rec.start();
      } catch (e) {
        if (!settled) { settled = true; reject(e); }
      }
    });
    return {
      promise,
      stop() { if (rec && rec.state === 'recording') { try { rec.stop(); } catch (e) {} } },
      abort() {
        settled = true; // 上层已放弃，之后的事件一律忽略
        if (rec) { try { rec.abort(); } catch (e) {} }
      },
    };
  }
  return { supported: !!SR, listen };
})();

/* ============ SW 更新完成后的提示 ============ */
// index.html 在「检测到新 SW 并 reload」前写入标记，这里弹一次 toast（首次安装不会弹）
try {
  if (sessionStorage.getItem('coffee-updated')) {
    sessionStorage.removeItem('coffee-updated');
    setTimeout(() => toast('✨ 已更新到最新版本'), 600); // 等首屏渲染一拍再弹
  }
} catch (e) {}
