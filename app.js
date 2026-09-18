'use strict';

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
          if (c) { out.push(c.value); c.continue(); }
          else { out.sort((a, b) => b.drankAt - a.drankAt); res(out); }
        };
        cur.onerror = () => rej(cur.error);
      });
    },
    async get(id) {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result);
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
let state = { search: '' };

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

/* ============ 首页：列表 + 搜索 ============ */
route('home', async () => {
  const records = await DB.all();
  const q = state.search.trim().toLowerCase();
  const filtered = q
    ? records.filter((r) => (r.shop + ' ' + r.coffee).toLowerCase().includes(q))
    : records;

  const page = el(`<div></div>`);

  // 顶栏
  const topbar = el(`<div class="topbar"></div>`);
  if (state.searchOpen) {
    const bar = el(`<div class="searchbar"><input type="text" placeholder="🔍 搜店名 / 咖啡名" /></div>`);
    const input = bar.querySelector('input');
    input.value = state.search;
    input.addEventListener('input', () => { state.search = input.value; renderList(); });
    const close = el(`<button class="iconbtn">✕</button>`);
    close.onclick = () => { state.searchOpen = false; state.search = ''; render(); };
    topbar.append(bar, close);
    setTimeout(() => input.focus(), 0);
  } else {
    topbar.append(
      el(`<div class="title">☕ 我的咖啡</div>`),
    );
    const search = el(`<button class="iconbtn" aria-label="搜索">🔍</button>`);
    search.onclick = () => { state.searchOpen = true; render(); };
    const settings = el(`<button class="iconbtn" aria-label="设置">⚙️</button>`);
    settings.onclick = () => go('settings');
    topbar.append(search, settings);
  }
  page.append(topbar);

  const content = el(`<div class="content"></div>`);
  page.append(content);

  function renderList() {
    content.innerHTML = '';
    const q2 = state.search.trim().toLowerCase();
    const list = q2 ? records.filter((r) => (r.shop + ' ' + r.coffee).toLowerCase().includes(q2)) : records;
    if (records.length === 0) {
      content.append(el(`
        <div class="empty">
          <div class="big">☕</div>
          <div class="t1">还没有记录</div>
          <div class="t2">喝到一杯好咖啡就记下来吧</div>
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
          <div class="sub">${esc(r.coffee || '')}${r.coffee ? ' · ' : ''}${relTime(r.drankAt)}</div>
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
  const rec = editing || { id: uid(), shop: '', coffee: '', rating: 0, note: '', drankAt: Date.now(), photo: null };

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

  const ocrBtn = el(`<button class="ocr-btn">📷 从截图识别填写</button>`);
  const fileInput = el(`<input type="file" accept="image/*" style="display:none" />`);
  ocrBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) runOCR(fileInput.files[0]); };
  form.append(ocrBtn, fileInput);

  const shopField = el(`
    <div class="field"><label>店名</label>
      <input type="text" id="f-shop" value="${esc(rec.shop)}" /></div>`);
  const coffeeField = el(`
    <div class="field"><label>咖啡名</label>
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

  form.append(shopField, coffeeField, ratingField, noteField, timeField);
  page.append(form);

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
      ${rec.coffee ? `<div class="d-coffee">${esc(rec.coffee)}</div>` : ''}
      ${rec.note ? `<div class="d-note">${esc(rec.note)}</div>` : ''}
      <div class="d-time">${new Date(rec.drankAt).toLocaleString('zh-CN')}</div>
      ${rec.photo ? `<div class="d-photo"><img src="${rec.photo}" alt="咖啡照片" /></div>` : ''}
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
    a.download = `咖啡记录-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
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
        id: String(r.id), shop: r.shop || '', coffee: r.coffee || '',
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
    s.append(el(`<div class="stat">共 ${records.length} 杯 · 平均 ${avg}★${top ? ` · 最常喝 ${esc(top[0])}` : ''}</div>`));
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
