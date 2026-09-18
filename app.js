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
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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

const LS_LAST_BACKUP = 'coffee-last-backup';

/* ============ 路由 ============ */
const app = document.getElementById('app');
const routes = {};
function route(name, fn) { routes[name] = fn; }
let state = { search: '', cat: 'all', star: 0, starOpen: false };

function go(name, params) {
  location.hash = '#' + name + (params ? '?' + new URLSearchParams(params) : '');
}
function render() {
  const raw = location.hash.slice(1) || 'home';
  const [name, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  (routes[name] || routes.home)(params);
}
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

/* ============ 首页：列表 + 搜索 + 品类筛选 ============ */
route('home', async () => {
  const records = await DB.all();

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
      el(`<div class="title">🥤 我的饮品</div>`),
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
    const starOptions = [{ v: 0, label: '全部' }, { v: 5, label: '5★' }, { v: 4, label: '4★+' }, { v: 3, label: '3★+' }, { v: 2, label: '2★+' }, { v: 1, label: '1★+' }];
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
      const item = el(`
        <button class="list-item">
          <div><span class="stars">${stars(r.rating)}</span><span class="shop">${esc(r.shop || '未命名')}</span></div>
          <div class="sub"><span class="cat-chip">${CAT_LABEL[r.category]}</span>${esc(r.coffee || '')}${r.coffee ? ' · ' : ' '}${relTime(r.drankAt)}</div>
        </button>`);
      item.onclick = () => go('detail', { id: r.id });
      content.append(item);
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
  back.onclick = () => history.back();
  const title = el(`<div class="title">${editing ? '编辑' : '记一杯'}</div>`);
  const save = el(`<button class="textbtn" disabled>保存</button>`);
  topbar.append(back, title, save);
  page.append(topbar);

  const form = el(`<div class="form"></div>`);
  const hintSlot = el(`<div></div>`);
  form.append(hintSlot);

  const importRow = el(`<div class="import-row"></div>`);
  const ocrBtn = el(`<button class="ocr-btn">📷 截图识别</button>`);
  const fileInput = el(`<input type="file" accept="image/*" style="display:none" />`);
  ocrBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) runOCR(fileInput.files[0]); };
  importRow.append(ocrBtn);
  if (Voice.supported) {
    const voiceBtn = el(`<button class="ocr-btn">🎤 语音输入</button>`);
    voiceBtn.onclick = () => runVoice(voiceBtn);
    importRow.append(voiceBtn);
  }
  form.append(importRow, fileInput);

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

  async function runOCR(file) {
    const overlay = showOverlay(`<div class="spinner"></div><div class="msg">正在识别…</div>`);
    try {
      const text = await OCR.recognize(file);
      overlay.remove();
      if (!text || !text.trim()) throw new Error('empty');
      const guess = OCR.guessFields(text);
      if (guess.shop) shopInput.value = guess.shop;
      if (guess.coffee) coffeeInput.value = guess.coffee;
      validate();
      hintSlot.innerHTML = '';
      hintSlot.append(el(`<div class="hint ok">✓ 已从截图识别，请核对</div>`));
    } catch (e) {
      overlay.remove();
      showOverlay(`
        <div class="msg">没认出来，手动填吧</div>
        <div class="row">
          <button id="ov-retry">重新选图</button>
          <button id="ov-manual" class="primary">手动填</button>
        </div>`, (box, close) => {
        box.querySelector('#ov-retry').onclick = () => { close(); fileInput.value = ''; fileInput.click(); };
        box.querySelector('#ov-manual').onclick = close;
      });
    } finally {
      fileInput.value = '';
    }
  }

  async function runVoice(btn) {
    const overlay = showOverlay(`<div class="spinner"></div><div class="msg">请说话…<br><span style="font-size:13px;color:var(--text-soft)">例：刚才喝了一杯 manner 的橘皮拿铁</span></div>`);
    try {
      const text = await Voice.listen();
      overlay.remove();
      if (!text || !text.trim()) throw new Error('empty');
      const g = Voice.parse(text);
      if (g.shop) shopInput.value = g.shop;
      if (g.coffee) coffeeInput.value = g.coffee;
      if (g.drankAt) { rec.drankAt = g.drankAt; timeInput.value = toLocalInput(g.drankAt); }
      if (g.category) {
        rec.category = g.category;
        catOpts.forEach((x) => x.classList.toggle('on', x.dataset.cat === rec.category));
      }
      validate();
      hintSlot.innerHTML = '';
      hintSlot.append(el(`<div class="hint ok">✓ 已识别：「${esc(text)}」，请核对</div>`));
    } catch (e) {
      overlay.remove();
      const msg = e.message === 'not-allowed' ? '麦克风没授权，请在系统设置里允许'
        : e.message === 'no-speech' ? '没听到声音，再试一次'
        : '识别失败，手动填吧';
      showOverlay(`
        <div class="msg">${msg}</div>
        <div class="row">
          <button id="ov-retry">重说</button>
          <button id="ov-manual" class="primary">手动填</button>
        </div>`, (box, close) => {
        box.querySelector('#ov-retry').onclick = () => { close(); runVoice(btn); };
        box.querySelector('#ov-manual').onclick = close;
      });
    }
  }

  save.onclick = async () => {
    rec.shop = shopInput.value.trim();
    rec.coffee = coffeeInput.value.trim();
    rec.note = noteInput.value.trim();
    rec.drankAt = fromLocalInput(timeInput.value) || Date.now();
    if (!editing) rec.createdAt = Date.now();
    rec.updatedAt = Date.now();
    await DB.put(rec);
    toast('已保存');
    if (editing) go('detail', { id: rec.id }); else go('home');
  };

  app.innerHTML = '';
  app.append(page);
});

/* ============ 详情页 ============ */
route('detail', async (params) => {
  const rec = await DB.get(params.id);
  if (!rec) { go('home'); return; }

  const page = el(`<div></div>`);
  const topbar = el(`<div class="topbar"></div>`);
  const back = el(`<button class="iconbtn">←</button>`);
  back.onclick = () => go('home');
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
      box.querySelector('#ov-ok').onclick = async () => { await DB.remove(rec.id); close(); toast('已删除'); go('home'); };
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
      ${rec.photo ? `<div class="d-photo"><img src="${rec.photo}" alt="饮品照片" /></div>` : ''}
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
  back.onclick = () => go('home');
  topbar.append(back, el(`<div class="title">设置</div>`));
  page.append(topbar);

  const s = el(`<div class="settings"></div>`);

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
        photo: r.photo || null,
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

/* ============ OCR（按需加载 tesseract.js） ============ */
const OCR = (() => {
  let loaded = null;
  function load() {
    if (loaded) return loaded;
    loaded = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('no-network'));
      document.head.appendChild(sc);
    });
    return loaded;
  }
  return {
    async recognize(file) {
      await load();
      const { data } = await Tesseract.recognize(file, 'chi_sim+eng');
      return data.text || '';
    },
    // 启发式：从 OCR 文本猜店名/咖啡名
    guessFields(text) {
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 2 && l.length <= 20);
      const coffeeKw = /(拿铁|美式|摩卡|卡布|澳白|馥芮白|dirty|espresso|latte|americano|mocha|馥芮|生椰|手冲|耶加|冷萃|燕麦|香草|焦糖|气泡|冰博克)/i;
      const shopKw = /(咖啡|coffee|café|cafe|星巴克|瑞幸|manner|库迪|nowwa|挪瓦|tims|arabica|blue bottle|% ?arabica|seesaw|m stand)/i;
      let coffee = '', shop = '';
      for (const l of lines) {
        if (!coffee && coffeeKw.test(l)) coffee = l.replace(/[¥￥]?\d+(\.\d+)?元?/g, '').trim();
        if (!shop && shopKw.test(l)) shop = l;
      }
      // 兜底：第一行常是店名
      if (!shop && lines[0]) shop = lines[0];
      return { shop, coffee };
    },
  };
})();

/* ============ 语音输入（Web Speech API + 规则解析） ============ */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR;

  // 店名词库（可扩展）
  const SHOP_KW = ['manner', 'starbucks', '星巴克', '瑞幸', 'luckin', '库迪', 'cotti', '喜茶', 'heytea', '奈雪', '茶百道', '古茗', '蜜雪冰城', '沪上阿姨', '书亦', 'coco', '一点点', '霸王茶姬', 'tims', 'seesaw', 'm stand', 'arabica', 'blue bottle', 'peets', '皮爷'];
  // 饮品后缀词库
  const DRINK_KW = ['拿铁', '美式', '摩卡', '卡布奇诺', '卡布', '澳白', '馥芮白', 'dirty', 'espresso', 'latte', '生椰', '手冲', '耶加', '冷萃', '燕麦', '香草', '焦糖玛奇朵', '玛奇朵', '气泡', '冰博克', '奶茶', '奶绿', '红茶', '绿茶', '乌龙', '珍珠', '波霸', '果茶', '柠檬茶', '西瓜汁', '橙汁', '果汁', '奶昔', '冰沙', '气泡水'];

  // 品类推断
  const CAT_KW = {
    milktea: ['奶茶', '奶绿', '珍珠', '波霸', '喜茶', 'heytea', '奈雪', '茶百道', '古茗', '蜜雪', '沪上阿姨', '书亦', 'coco', '一点点', '霸王茶姬', '乌龙', '红茶', '绿茶'],
    juice: ['果汁', '西瓜汁', '橙汁', '柠檬茶', '果茶', '奶昔', '冰沙', '气泡水'],
    coffee: ['拿铁', '美式', '摩卡', '卡布', '澳白', '馥芮白', 'dirty', 'espresso', 'latte', '生椰', '手冲', '耶加', '冷萃', 'coffee', '咖啡', 'manner', '星巴克', '瑞幸', 'luckin', '库迪', 'tims', 'seesaw', 'arabica', 'blue bottle'],
  };

  function guessCategory(text) {
    const t = text.toLowerCase();
    for (const cat of ['milktea', 'juice', 'coffee']) {
      if (CAT_KW[cat].some((k) => t.includes(k.toLowerCase()))) return cat;
    }
    return null;
  }

  // 简单中文数字（1-99，够用）
  function cnNum(s) {
    const d = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (s in d) return d[s];
    if (s.length === 2 && s[0] === '十') return 10 + d[s[1]];       // 十一~十九
    if (s.length === 2 && s[1] === '十') return d[s[0]] * 10;        // 二十~九十
    if (s.length === 3 && s[1] === '十') return d[s[0]] * 10 + d[s[2]]; // 二十一…
    return 0;
  }

  // 时间词 → 相对天数/时段偏移，返回时间戳或 null
  function parseTime(text) {
    const now = new Date();
    let dayOffset = null;
    if (/前天/.test(text)) dayOffset = -2;
    else if (/昨天|昨晚/.test(text)) dayOffset = -1;
    else if (/今天|刚才|刚刚|方才|现在/.test(text)) dayOffset = 0;
    else {
      const m = text.match(/(\d+)\s*天前/);
      if (m) dayOffset = -Number(m[1]);
      else {
        const cn = text.match(/([一二两三四五六七八九十]+)\s*天前/);
        if (cn) dayOffset = -cnNum(cn[1]);
      }
    }
    if (dayOffset === null) return null;

    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    // 时段：非"今天/刚才"时，把具体时分设为该时段的代表点；今天/刚才保留当前时刻
    if (dayOffset === 0 && /刚才|刚刚|方才|现在/.test(text)) return now.getTime();
    if (/早上|早晨|上午|早/.test(text)) d.setHours(9, 0, 0, 0);
    else if (/中午/.test(text)) d.setHours(12, 0, 0, 0);
    else if (/下午/.test(text)) d.setHours(15, 0, 0, 0);
    else if (/晚上|晚|夜里/.test(text)) d.setHours(20, 0, 0, 0);
    else if (dayOffset === 0) return now.getTime();
    else d.setHours(12, 0, 0, 0); // 无时段的往日，默认中午
    return d.getTime();
  }

  function parseShop(text) {
    const t = text.toLowerCase();
    // 先按词库命中（保留原文大小写）
    for (const kw of SHOP_KW) {
      const idx = t.indexOf(kw.toLowerCase());
      if (idx >= 0) return text.slice(idx, idx + kw.length);
    }
    // 再试"X的"模式：一杯 <店名> 的 <饮品>
    const m = text.match(/(?:一杯|杯|喝了|喝的)?\s*([一-龥A-Za-z0-9%]{2,10})的/);
    if (m) return m[1];
    return '';
  }

  function parseDrink(text, shop) {
    const lower = text.toLowerCase();
    for (const kw of DRINK_KW) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx >= 0) {
        // 往前扩几个修饰字（如"橘皮拿铁""生椰拿铁"）
        let start = idx;
        while (start > 0 && /[一-龥A-Za-z]/.test(text[start - 1]) && idx - start < 4) start--;
        let seg = text.slice(start, idx + kw.length);
        // 去掉"…的"前缀（店名+的）
        seg = seg.replace(/^.*的/, '');
        // 若前扩把店名带了进来，切掉店名部分
        if (shop) {
          const si = seg.toLowerCase().indexOf(shop.toLowerCase());
          if (si >= 0) seg = seg.slice(si + shop.length);
        }
        return seg || text.slice(idx, idx + kw.length);
      }
    }
    return '';
  }

  function parse(text) {
    const shop = parseShop(text);
    const out = { shop, coffee: parseDrink(text, shop), raw: text };
    const ts = parseTime(text);
    if (ts) out.drankAt = ts;
    const cat = guessCategory(text);
    if (cat) out.category = cat;
    return out;
  }

  function listen() {
    return new Promise((resolve, reject) => {
      if (!supported) return reject(new Error('unsupported'));
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      let done = false;
      rec.onresult = (e) => { done = true; resolve(e.results[0][0].transcript || ''); };
      rec.onerror = (e) => { if (!done) reject(new Error(e.error || 'error')); };
      rec.onend = () => { if (!done) reject(new Error('no-speech')); };
      rec.start();
    });
  }

  return { supported, listen, parse };
})();
// 暴露供测试
window.__Voice = Voice;
