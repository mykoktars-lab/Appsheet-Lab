/* LabStock - Inventory Laboratorium (PWA, tanpa server, data tersimpan di HP) */
(() => {
'use strict';

/* ---------- util ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDT = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}`; };
const fmtTime = iso => { const d = new Date(iso); return `${pad(d.getHours())}.${pad(d.getMinutes())}`; };
const fmtDate = k => { const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString('id-ID');
const nowLocalInput = () => { const d = new Date(); return `${dKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const longDate = d => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const UNITS = ['pcs', 'botol', 'g', 'kg', 'mL', 'L', 'lembar', 'box', 'pak', 'set', 'tes'];
const EXPIRY_WARN_DAYS = 90;
const ICON_BOX = '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>';

/* ---------- penyimpanan (IndexedDB) ---------- */
const DB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('labstock', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
};

let state = { items: [], logs: [], vendors: [], user: '' };
const ui = { tab: 'home', q: '', cat: '', logType: '', logFrom: '', logTo: '', mon: 'stock' };
let legacyState = null;

/* ---------- database bersama (Firebase Firestore) ---------- */
const CFG = window.FIREBASE_CONFIG || {};
let fs = null, auth = null, FV = null, unsubs = [];
const col = n => fs.collection(n);
const fail = e => { console.error(e); toast('Gagal menyimpan: ' + (e.code || e.message)); };
const who = () => state.user || ((auth && auth.currentUser && auth.currentUser.email) || '').split('@')[0];
const nextCode = () => Math.max(90000000, ...state.items.map(i => (/^\d+$/.test(i.code) ? +i.code : 0))) + 1;
let renderQueued = false;
const renderSoon = () => {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; if (document.activeElement && document.activeElement.id === 'q') return; render(); });
};
function listen() {
  stopListen();
  ['items', 'logs', 'vendors'].forEach(c => {
    unsubs.push(col(c).onSnapshot(snap => { state[c] = snap.docs.map(d => d.data()); renderSoon(); },
      e => toast('Sinkron gagal: ' + (e.code || e.message))));
  });
}
function stopListen() { unsubs.forEach(u => u()); unsubs = []; }
async function deleteMany(pairs) {
  for (let i = 0; i < pairs.length; i += 400) {
    const b = fs.batch(); pairs.slice(i, i + 400).forEach(([c, id]) => b.delete(col(c).doc(id)));
    await b.commit();
  }
}
async function importState(d) {
  const pairs = [];
  (d.vendors || []).forEach(x => x.id && pairs.push(['vendors', x]));
  (d.items || []).forEach(x => x.id && pairs.push(['items', x]));
  (d.logs || []).forEach(x => x.id && pairs.push(['logs', x]));
  for (let i = 0; i < pairs.length; i += 400) {
    const b = fs.batch(); pairs.slice(i, i + 400).forEach(([c, x]) => b.set(col(c).doc(x.id), x));
    await b.commit();
  }
  return pairs.length;
}
function showLogin(msg, fatal) {
  $('#login').hidden = false;
  if (msg) $('#login-msg').textContent = msg;
  if (fatal) $('#login form button').disabled = true;
}
function startFirebase() {
  if (typeof firebase === 'undefined') { showLogin('Gagal memuat Firebase. Cek koneksi internet (dibutuhkan saat pertama kali membuka).', true); return; }
  if (!CFG.apiKey || /ISI_/.test(CFG.apiKey)) { showLogin('Konfigurasi Firebase belum diisi. Isi file config.js sesuai panduan.', true); return; }
  firebase.initializeApp(CFG);
  auth = firebase.auth(); fs = firebase.firestore(); FV = firebase.firestore.FieldValue;
  fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  auth.onAuthStateChanged(u => {
    if (u) { $('#login').hidden = true; $('#login-msg').textContent = 'Masuk untuk membuka data laboratorium'; listen(); }
    else { stopListen(); state.items = []; state.logs = []; state.vendors = []; render(); showLogin(); }
  });
}
const AUTH_MSG = {
  'auth/invalid-credential': 'Email atau password salah', 'auth/wrong-password': 'Email atau password salah',
  'auth/user-not-found': 'Email atau password salah', 'auth/invalid-email': 'Format email tidak valid',
  'auth/network-request-failed': 'Tidak ada koneksi internet', 'auth/too-many-requests': 'Terlalu banyak percobaan, coba lagi nanti'
};

/* ---------- helper data ---------- */
const item = id => state.items.find(i => i.id === id);
const vendor = id => state.vendors.find(v => v.id === id);
const status = i => (i.stock <= 0 ? 'zero' : (i.min > 0 && i.stock <= i.min ? 'low' : 'ok'));
const statusText = { zero: 'Habis', low: 'Menipis', ok: 'Aman' };
const daysLeft = i => {
  if (!i.expiry) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(i.expiry + 'T00:00:00') - t) / 864e5);
};
const categories = () => [...new Set(['Bahan Kimia', 'Alat', 'Habis Pakai', 'Test Kit', ...state.items.map(i => i.category).filter(Boolean)])];
const logsOn = key => state.logs.filter(l => dKey(new Date(l.ts)) === key);
const sumQty = (arr, type) => arr.filter(l => l.type === type).reduce((a, l) => a + l.qty, 0);
const byTimeDesc = (a, b) => b.ts.localeCompare(a.ts);

/* ---------- UI dasar ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function openSheet(html) { $('#sheet-body').innerHTML = html; const s = $('#sheet'); s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); $('.panel').scrollTop = 0; }
function closeSheet() { const s = $('#sheet'); s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); }
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const emptyBox = (msg) => `<div class="empty">${ICON_BOX}<div>${msg}</div></div>`;

function thumb(i) {
  return i.photo ? `<img class="thumb" src="${i.photo}" alt="">` : `<div class="thumb">${ICON_BOX}</div>`;
}
function itemRow(i) {
  const s = status(i);
  return `<div class="row" data-act="item" data-id="${i.id}">${thumb(i)}
    <div class="grow"><b>${esc(i.name)}</b><small>${esc(i.code)}${i.category ? ' • ' + esc(i.category) : ''}</small></div>
    <div class="qty">${fmtNum(i.stock)} ${esc(i.unit)}<small><span class="badge ${s}">${statusText[s]}</span></small></div></div>`;
}
function logRow(l, showDate) {
  const it = item(l.itemId);
  const unit = it ? it.unit : l.unit || '';
  return `<div class="row" data-act="log-detail" data-id="${l.id}">${it ? thumb(it) : `<div class="thumb">${ICON_BOX}</div>`}
    <div class="grow"><b>${esc(it ? it.name : l.itemName)}</b><small>${showDate ? fmtDT(l.ts) : fmtTime(l.ts)}${l.note ? ' • ' + esc(l.note) : ''}</small></div>
    <div class="qty ${l.type}">${l.type === 'in' ? '+' : '−'}${fmtNum(l.qty)}<small>${esc(unit)}</small></div></div>`;
}

/* ---------- tampilan ---------- */
const TITLES = { home: 'Beranda', items: 'Barang', log: 'Riwayat Stok', monitor: 'Monitor', vendors: 'Vendor' };

function render() {
  $('#title').textContent = TITLES[ui.tab];
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#fab').classList.toggle('hide', ui.tab === 'monitor');
  const v = { home: viewHome, items: viewItems, log: viewLog, monitor: viewMonitor, vendors: viewVendors }[ui.tab]();
  $('#view').innerHTML = v;
}

function viewHome() {
  const today = dKey(new Date());
  const tl = logsOn(today).sort(byTimeDesc);
  const inL = tl.filter(l => l.type === 'in'), outL = tl.filter(l => l.type === 'out');
  const kinds = arr => new Set(arr.map(l => l.itemId)).size;
  const low = state.items.filter(i => status(i) !== 'ok');
  const exp = state.items.filter(i => { const d = daysLeft(i); return d !== null && d <= EXPIRY_WARN_DAYS; });
  return `
  <div class="date-line">${longDate(new Date())}</div>
  <div class="today">
    <div class="stat in"><div class="n">${fmtNum(sumQty(tl, 'in'))}</div><div class="l">Barang masuk hari ini</div><div class="s">${inL.length} transaksi • ${kinds(inL)} jenis</div></div>
    <div class="stat out"><div class="n">${fmtNum(sumQty(tl, 'out'))}</div><div class="l">Terpakai hari ini</div><div class="s">${outL.length} transaksi • ${kinds(outL)} jenis</div></div>
    <div class="stat low" data-act="goto" data-tab="monitor"><div class="n">${low.length}</div><div class="l">Stok menipis / habis</div></div>
    <div class="stat exp" data-act="goto" data-tab="monitor"><div class="n">${exp.length}</div><div class="l">Expired ≤ ${EXPIRY_WARN_DAYS} hari</div></div>
  </div>
  <div class="quick">
    <button class="btn in" data-act="log-new" data-type="in">+ Barang masuk</button>
    <button class="btn out" data-act="log-new" data-type="out">− Pemakaian</button>
  </div>
  <button class="btn ghost block" data-act="report" style="margin-top:10px">Laporan PDF (kirim ke WhatsApp / email)</button>
  <h2 class="sec">Transaksi hari ini</h2>
  ${tl.length ? `<div class="card">${tl.map(l => logRow(l)).join('')}</div>` : emptyBox('Belum ada transaksi hari ini.')}
  ${low.length ? `<h2 class="sec">Perlu diisi ulang</h2><div class="card">${low.slice(0, 6).map(itemRow).join('')}</div>` : ''}`;
}

function viewItems() {
  const q = ui.q.trim().toLowerCase();
  const list = state.items.filter(i =>
    (!ui.cat || i.category === ui.cat) &&
    (!q || [i.name, i.code, i.desc, i.location].some(x => (x || '').toLowerCase().includes(q)))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const cats = categories();
  return `
  <input class="search" id="q" type="search" placeholder="Cari nama, kode, lokasi…" value="${esc(ui.q)}">
  <div class="chips"><button class="chip ${ui.cat ? '' : 'on'}" data-act="cat" data-v="">Semua (${state.items.length})</button>
    ${cats.map(c => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
  ${list.length ? `<div class="card">${list.map(itemRow).join('')}</div>` :
    emptyBox(state.items.length ? 'Tidak ada barang yang cocok.' : 'Belum ada barang. Ketuk tombol + untuk menambah barang pertama.')}`;
}

function viewLog() {
  let list = [...state.logs];
  if (ui.logType) list = list.filter(l => l.type === ui.logType);
  if (ui.logFrom) list = list.filter(l => dKey(new Date(l.ts)) >= ui.logFrom);
  if (ui.logTo) list = list.filter(l => dKey(new Date(l.ts)) <= ui.logTo);
  list.sort(byTimeDesc);
  const groups = {};
  list.forEach(l => (groups[dKey(new Date(l.ts))] ||= []).push(l));
  const html = Object.keys(groups).map(k => `
    <div class="day-head">${fmtDate(k)}<span>masuk ${fmtNum(sumQty(groups[k], 'in'))} • pakai ${fmtNum(sumQty(groups[k], 'out'))}</span></div>
    <div class="card">${groups[k].map(l => logRow(l)).join('')}</div>`).join('');
  return `
  <button class="btn ghost block" data-act="report" style="margin-bottom:10px">Buat laporan PDF</button>
  <div class="chips">
    <button class="chip ${ui.logType === '' ? 'on' : ''}" data-act="logtype" data-v="">Semua</button>
    <button class="chip ${ui.logType === 'in' ? 'on' : ''}" data-act="logtype" data-v="in">Masuk</button>
    <button class="chip ${ui.logType === 'out' ? 'on' : ''}" data-act="logtype" data-v="out">Terpakai</button>
  </div>
  <div class="two">
    <label class="f">Dari<input type="date" id="lf" value="${ui.logFrom}"></label>
    <label class="f">Sampai<input type="date" id="lt" value="${ui.logTo}"></label>
  </div>
  ${html || emptyBox('Belum ada riwayat.')}`;
}

function viewVendors() {
  const list = [...state.vendors].sort((a, b) => a.name.localeCompare(b.name));
  return list.length ? `<div class="card">${list.map(v => {
    const n = state.items.filter(i => i.vendorId === v.id).length;
    return `<div class="row" data-act="vendor-edit" data-id="${v.id}"><div class="thumb"><svg viewBox="0 0 24 24"><path d="M1 4h13v12H1zM14 8h4l4 4v4h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg></div>
      <div class="grow"><b>${esc(v.name)}</b><small>${esc(v.phone || v.email || '-')}</small></div><div class="qty">${n}<small>barang</small></div></div>`;
  }).join('')}</div>` : emptyBox('Belum ada vendor. Ketuk + untuk menambah.');
}

function viewMonitor() {
  const tabs = [['stock', 'Level stok'], ['usage', 'Pemakaian'], ['vendor', 'Per vendor']];
  const head = `<div class="chips">${tabs.map(([k, n]) => `<button class="chip ${ui.mon === k ? 'on' : ''}" data-act="mon" data-v="${k}">${n}</button>`).join('')}</div>`;
  if (ui.mon === 'stock') {
    const list = [...state.items].sort((a, b) => {
      const o = { zero: 0, low: 1, ok: 2 }; return o[status(a)] - o[status(b)] || a.name.localeCompare(b.name);
    });
    const exp = state.items.filter(i => { const d = daysLeft(i); return d !== null && d <= EXPIRY_WARN_DAYS; }).sort((a, b) => a.expiry.localeCompare(b.expiry));
    return head + (list.length ? `<div class="card">${list.map(i => {
      const s = status(i); const target = Math.max(i.min * 2, i.stock, 1);
      return `<div class="bar-row" data-act="item" data-id="${i.id}"><div class="bar-top"><b>${esc(i.name)}</b><span>${fmtNum(i.stock)} ${esc(i.unit)}${i.min ? ` <small>(min ${fmtNum(i.min)})</small>` : ''}</span></div>
        <div class="track"><div class="fill ${s}" style="width:${Math.max(2, Math.min(100, i.stock / target * 100))}%"></div></div></div>`;
    }).join('')}</div>` : emptyBox('Belum ada data.')) +
    (exp.length ? `<h2 class="sec">Mendekati expired</h2><div class="card">${exp.map(i => {
      const d = daysLeft(i);
      return `<div class="row" data-act="item" data-id="${i.id}">${thumb(i)}<div class="grow"><b>${esc(i.name)}</b><small>${fmtDate(i.expiry)}</small></div>
        <div class="qty"><span class="badge ${d < 0 ? 'zero' : 'low'}">${d < 0 ? 'Lewat ' + (-d) + ' hari' : d + ' hari lagi'}</span></div></div>`;
    }).join('')}</div>` : '');
  }
  if (ui.mon === 'usage') {
    const days = [];
    for (let k = 6; k >= 0; k--) { const d = new Date(); d.setDate(d.getDate() - k); days.push(d); }
    const data = days.map(d => { const l = logsOn(dKey(d)); return { d, in: sumQty(l, 'in'), out: sumQty(l, 'out') }; });
    const max = Math.max(1, ...data.map(x => Math.max(x.in, x.out)));
    const W = 340, H = 190, bw = 16, gap = (W - 7 * bw * 2) / 8;
    const bars = data.map((x, i) => {
      const x0 = gap + i * (bw * 2 + gap), h1 = x.in / max * 140, h2 = x.out / max * 140;
      return `<rect x="${x0}" y="${160 - h1}" width="${bw}" height="${h1}" rx="3" fill="#2f8f4e"/>
        <rect x="${x0 + bw}" y="${160 - h2}" width="${bw}" height="${h2}" rx="3" fill="#e8a317"/>
        <text x="${x0 + bw}" y="180" font-size="11" text-anchor="middle" fill="currentColor" opacity=".7">${DAYS[x.d.getDay()].slice(0, 3)}</text>
        ${x.in ? `<text x="${x0 + bw / 2}" y="${154 - h1}" font-size="10" text-anchor="middle" fill="currentColor">${fmtNum(x.in)}</text>` : ''}
        ${x.out ? `<text x="${x0 + bw * 1.5}" y="${154 - h2}" font-size="10" text-anchor="middle" fill="currentColor">${fmtNum(x.out)}</text>` : ''}`;
    }).join('');
    const since = new Date(); since.setDate(since.getDate() - 30);
    const use = {};
    state.logs.filter(l => l.type === 'out' && new Date(l.ts) >= since).forEach(l => use[l.itemId] = (use[l.itemId] || 0) + l.qty);
    const top = Object.entries(use).sort((a, b) => b[1] - a[1]).slice(0, 8).filter(([id]) => item(id));
    return head + `<div class="chart"><svg viewBox="0 0 ${W} ${H}"><line x1="0" y1="160" x2="${W}" y2="160" stroke="currentColor" opacity=".25"/>${bars}</svg>
      <div class="legend"><span><i style="background:#2f8f4e"></i>Masuk</span><span><i style="background:#e8a317"></i>Terpakai</span><span>7 hari terakhir</span></div></div>
      <h2 class="sec">Paling banyak dipakai (30 hari)</h2>
      ${top.length ? `<div class="card">${top.map(([id, q]) => { const i = item(id); return `<div class="row" data-act="item" data-id="${id}">${thumb(i)}<div class="grow"><b>${esc(i.name)}</b></div><div class="qty out">${fmtNum(q)}<small>${esc(i.unit)}</small></div></div>`; }).join('')}</div>` : emptyBox('Belum ada pemakaian.')}`;
  }
  // per vendor
  const groups = {};
  state.items.forEach(i => (groups[i.vendorId || ''] ||= []).push(i));
  const keys = Object.keys(groups).sort();
  return head + (keys.length ? keys.map(k => {
    const arr = groups[k];
    return `<h2 class="sec">${k && vendor(k) ? esc(vendor(k).name) : 'Tanpa vendor'} (${arr.length})</h2><div class="card">${arr.map(itemRow).join('')}</div>`;
  }).join('') : emptyBox('Belum ada data.'));
}

/* ---------- form: barang ---------- */
function itemForm(id) {
  tmpPhoto = null;
  const i = id ? item(id) : null;
  const code = i ? i.code : String(nextCode());
  openSheet(`<h3>${i ? 'Ubah barang' : 'Barang baru'}</h3>
  <form data-form="item" data-id="${id || ''}">
    <div class="photo-pick"><div class="thumb" id="pp">${i && i.photo ? `<img src="${i.photo}" style="width:100%;height:100%;object-fit:cover">` : ICON_BOX}</div>
      <div class="grow btn-row" style="flex-direction:column"><label class="btn ghost">Kamera<input type="file" id="photo-cam" accept="image/*" capture="environment" hidden></label><label class="btn ghost">Galeri<input type="file" id="photo" accept="image/*" hidden></label></div></div>
    <label class="f">Nama barang *<input name="name" required value="${esc(i?.name)}" placeholder="mis. 2-Propanol"></label>
    <div class="with-btn"><label class="f">Kode / Item ID<input name="code" required value="${esc(code)}"></label>
      <button type="button" class="inline-btn" data-act="scan-field">Scan</button></div>
    <label class="f">Deskripsi<input name="desc" value="${esc(i?.desc)}" placeholder="mis. AV, FFA"></label>
    <div class="two">
      <label class="f">Kategori<input name="category" list="cats" value="${esc(i?.category || 'Bahan Kimia')}"></label>
      <label class="f">Satuan<input name="unit" list="units" required value="${esc(i?.unit || 'botol')}"></label>
    </div>
    <datalist id="cats">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="units">${UNITS.map(c => `<option value="${c}">`).join('')}</datalist>
    <div class="two">
      ${i ? '' : '<label class="f">Stok awal<input name="stock" type="number" min="0" step="any" value="0" inputmode="decimal"></label>'}
      <label class="f">Stok minimum<input name="min" type="number" min="0" step="any" value="${i?.min ?? 0}" inputmode="decimal"></label>
    </div>
    <div class="two">
      <label class="f">Lokasi simpan<input name="location" value="${esc(i?.location)}" placeholder="mis. Lemari A2"></label>
      <label class="f">Expired<input name="expiry" type="date" value="${esc(i?.expiry)}"></label>
    </div>
    <label class="f">Vendor<select name="vendorId"><option value="">— tanpa vendor —</option>
      ${state.vendors.map(v => `<option value="${v.id}" ${i?.vendorId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <div class="btn-row"><button class="btn block" type="submit">Simpan</button></div>
  </form>`);
  const pick = async e => {
    const f = e.target.files[0]; if (!f) return;
    tmpPhoto = await shrink(f);
    $('#pp').innerHTML = `<img src="${tmpPhoto}" style="width:100%;height:100%;object-fit:cover">`;
  };
  $('#photo').onchange = pick; $('#photo-cam').onchange = pick;
}
let tmpPhoto = null;
function shrink(file, max = 360) {
  return new Promise(res => {
    const img = new Image(); img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * r; c.height = img.height * r;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', .65)); URL.revokeObjectURL(img.src);
    }; img.src = URL.createObjectURL(file);
  });
}

function itemDetail(id) {
  const i = item(id); if (!i) return;
  const s = status(i), v = vendor(i.vendorId), d = daysLeft(i);
  const recent = state.logs.filter(l => l.itemId === id).sort(byTimeDesc).slice(0, 5);
  openSheet(`${i.photo ? `<img class="hero-photo" src="${i.photo}" alt="">` : ''}
  <h3>${esc(i.name)}</h3>
  <div class="btn-row" style="margin-bottom:14px">
    <button class="btn in" data-act="log-new" data-type="in" data-id="${i.id}">+ Masuk</button>
    <button class="btn out" data-act="log-new" data-type="out" data-id="${i.id}">− Pakai</button></div>
  <dl class="kv">
    <dt>Stok</dt><dd>${fmtNum(i.stock)} ${esc(i.unit)} <span class="badge ${s}">${statusText[s]}</span></dd>
    <dt>Item ID</dt><dd>${esc(i.code)}</dd>
    <dt>Deskripsi</dt><dd>${esc(i.desc || '-')}</dd>
    <dt>Kategori</dt><dd>${esc(i.category || '-')}</dd>
    <dt>Stok minimum</dt><dd>${fmtNum(i.min || 0)} ${esc(i.unit)}</dd>
    <dt>Lokasi</dt><dd>${esc(i.location || '-')}</dd>
    <dt>Expired</dt><dd>${i.expiry ? fmtDate(i.expiry) + (d !== null && d <= EXPIRY_WARN_DAYS ? ` <span class="badge ${d < 0 ? 'zero' : 'low'}">${d < 0 ? 'lewat' : d + ' hari'}</span>` : '') : '-'}</dd>
    <dt>Vendor</dt><dd>${esc(v?.name || '-')}</dd>
  </dl>
  ${recent.length ? `<h2 class="sec" style="margin-top:6px">Riwayat terakhir</h2><div class="card">${recent.map(l => logRow(l, true)).join('')}</div>` : ''}
  <div class="btn-row" style="margin-top:14px">
    <button class="btn ghost" data-act="item-edit" data-id="${i.id}">Ubah</button>
    <button class="btn danger" data-act="item-del" data-id="${i.id}">Hapus</button></div>`);
}

/* ---------- form: transaksi ---------- */
function logForm(type = 'in', itemId = '') {
  if (!state.items.length) { toast('Tambah barang dulu di tab Barang.'); return; }
  const opts = [...state.items].sort((a, b) => a.name.localeCompare(b.name))
    .map(i => `<option value="${i.id}" ${i.id === itemId ? 'selected' : ''}>${esc(i.name)} (${fmtNum(i.stock)} ${esc(i.unit)})</option>`).join('');
  openSheet(`<h3>Catat stok</h3>
  <form data-form="log">
    <div class="seg">
      <label><input type="radio" name="type" value="in" ${type === 'in' ? 'checked' : ''}><span class="i">Masuk</span></label>
      <label><input type="radio" name="type" value="out" ${type === 'out' ? 'checked' : ''}><span class="o">Terpakai</span></label>
    </div>
    <div class="with-btn"><label class="f">Barang<select name="itemId" id="log-item" required>${opts}</select></label>
      <button type="button" class="inline-btn" data-act="scan-log">Scan</button></div>
    <div class="two">
      <label class="f">Jumlah<input name="qty" type="number" min="0" step="any" required inputmode="decimal" autofocus></label>
      <label class="f">Waktu<input name="ts" type="datetime-local" required value="${nowLocalInput()}"></label>
    </div>
    <label class="f">Catatan / keperluan<input name="note" placeholder="mis. analisis FFA, pembelian dari vendor"></label>
    <button class="btn block" type="submit">Simpan</button>
  </form>`);
}
function logDetail(id) {
  const l = state.logs.find(x => x.id === id); if (!l) return;
  const it = item(l.itemId);
  openSheet(`<h3>${l.type === 'in' ? 'Barang masuk' : 'Pemakaian'}</h3>
  <dl class="kv"><dt>Barang</dt><dd>${esc(it ? it.name : l.itemName)}</dd><dt>Jumlah</dt><dd>${l.type === 'in' ? '+' : '−'}${fmtNum(l.qty)} ${esc(it?.unit || '')}</dd>
  <dt>Waktu</dt><dd>${fmtDT(l.ts)}</dd><dt>Catatan</dt><dd>${esc(l.note || '-')}</dd><dt>Petugas</dt><dd>${esc(l.user || '-')}</dd></dl>
  <button class="btn danger block" data-act="log-del" data-id="${l.id}">Hapus transaksi (stok dikembalikan)</button>`);
}

/* ---------- form: vendor ---------- */
function vendorForm(id) {
  const v = id ? vendor(id) : null;
  openSheet(`<h3>${v ? 'Ubah vendor' : 'Vendor baru'}</h3>
  <form data-form="vendor" data-id="${id || ''}">
    <label class="f">Nama vendor *<input name="name" required value="${esc(v?.name)}"></label>
    <div class="two"><label class="f">Telepon<input name="phone" type="tel" value="${esc(v?.phone)}"></label>
    <label class="f">Email<input name="email" type="email" value="${esc(v?.email)}"></label></div>
    <label class="f">Alamat / catatan<textarea name="note">${esc(v?.note)}</textarea></label>
    <div class="btn-row"><button class="btn" type="submit">Simpan</button>
    ${v ? `<button type="button" class="btn danger" data-act="vendor-del" data-id="${v.id}">Hapus</button>` : ''}</div>
  </form>`);
}

/* ---------- pengaturan, ekspor/impor ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function settings() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const mail = (auth && auth.currentUser && auth.currentUser.email) || '';
  openSheet(`<h3>Pengaturan</h3>
  <p style="margin:0 0 12px;font-size:14px;color:var(--muted)">Masuk sebagai <b>${esc(mail)}</b></p>
  <label class="f">Nama petugas (tercatat di setiap transaksi)<input id="user" value="${esc(state.user)}" placeholder="mis. Rina"></label>
  <div class="btn-row" style="margin-bottom:10px">
    ${installEvt && !standalone ? '<button class="btn" data-act="install">Install aplikasi</button>' : ''}
    <button class="btn ghost" data-act="logout">Keluar akun</button>
  </div>
  ${!standalone && !installEvt ? `<p style="font-size:13.5px;color:var(--muted);margin-top:0">${ios ? 'Di iPhone: ketuk tombol Bagikan lalu pilih “Tambah ke Layar Utama”.' : 'Untuk install: menu ⋮ browser → “Instal aplikasi” / “Tambahkan ke layar utama”.'}</p>` : ''}
  ${legacyState ? '<h2 class="sec">Data lama di HP ini</h2><button class="btn block" data-act="migrate">Pindahkan data lama ke database bersama</button>' : ''}
  <h2 class="sec">Laporan</h2>
  <button class="btn ghost block" data-act="report">Laporan PDF (bagikan ke WhatsApp / email)</button>
  <h2 class="sec">Cadangan dan ekspor</h2>
  <div class="btn-row"><button class="btn ghost" data-act="export-json">Backup (JSON)</button>
  <label class="btn ghost">Impor backup<input type="file" id="import" accept=".json,application/json" hidden></label></div>
  <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="export-items">Ekspor barang (CSV)</button>
  <button class="btn ghost" data-act="export-logs">Ekspor riwayat (CSV)</button></div>
  <h2 class="sec">Lainnya</h2>
  <div class="btn-row"><button class="btn ghost" data-act="demo">Isi data contoh</button></div>
  <p style="font-size:12.5px;color:var(--muted)">Data tersimpan online dan dipakai bersama semua akun.</p>`);
  $('#user').onchange = e => { state.user = e.target.value.trim(); localStorage.setItem('labstock_user', state.user); };
  $('#import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.items) || !Array.isArray(d.logs)) throw 0;
      if (!confirm('Isi file ini akan ditambahkan ke database bersama (data dengan ID sama ditimpa). Lanjutkan?')) return;
      toast('Mengimpor…'); const n = await importState(d); closeSheet(); toast(n + ' data diimpor');
    } catch { toast('File backup tidak valid'); }
  };
}
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCSV = (head, rows) => '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');

function demoData() {
  const b = fs.batch(); let code = nextCode(); const now = new Date().toISOString();
  const v1 = { id: uid(), name: 'Merck / Supelco', phone: '', email: '', note: '' };
  const v2 = { id: uid(), name: 'Whatman / Cytiva', phone: '', email: '', note: '' };
  [v1, v2].forEach(v => b.set(col('vendors').doc(v.id), v));
  const mk = (name, desc, cat, unit, min, loc, vendorId) => ({ id: uid(), code: String(code++), name, desc, category: cat, unit, stock: 0, min, location: loc, vendorId, expiry: '', photo: '', createdAt: now });
  [[mk('2-Propanol', 'AV, FFA', 'Bahan Kimia', 'botol', 2, 'Lemari asam 1', v1.id), 6],
   [mk('Kertas Saring Kasar', 'FC', 'Habis Pakai', 'lembar', 20, 'Rak B', v2.id), 80],
   [mk('Whatman 597', '', 'Habis Pakai', 'lembar', 100, 'Rak B', v2.id), 500],
   [mk('Phenolphthalein (PP)', 'Indikator', 'Bahan Kimia', 'botol', 1, 'Lemari A2', v1.id), 3]
  ].forEach(([it, q]) => { b.set(col('items').doc(it.id), it); addLog(it, 'in', q, 'Stok awal (contoh)', now, b); });
  b.commit().catch(fail);
}

/* ---------- operasi data ---------- */
function addLog(it, type, qty, note, ts, batch) {
  const b = batch || fs.batch();
  const l = { id: uid(), itemId: it.id, itemName: it.name, unit: it.unit, type, qty, note, ts, user: who() };
  b.set(col('logs').doc(l.id), l);
  b.update(col('items').doc(it.id), { stock: FV.increment(type === 'in' ? qty : -qty) });
  if (!batch) b.commit().catch(fail);
}

/* ---------- laporan PDF (format Form Pemakaian Bahan Kimia) ---------- */
function reportRows(type, from, to) {
  const map = {};
  state.logs.filter(l => l.type === type && dKey(new Date(l.ts)) >= from && dKey(new Date(l.ts)) <= to)
    .sort((a, b) => a.ts.localeCompare(b.ts)).forEach(l => {
      const it = item(l.itemId);
      const r = map[l.itemId] || (map[l.itemId] = { code: it ? it.code : '-', name: it ? it.name : l.itemName, unit: (it && it.unit) || l.unit || '', qty: 0, notes: [] });
      r.qty += l.qty; if (l.note && !r.notes.includes(l.note)) r.notes.push(l.note);
    });
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
}
const longD = k => { const [y, m, d] = k.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };

function reportForm() {
  const t = dKey(new Date());
  openSheet(`<h3>Laporan PDF</h3>
  <form data-form="report">
    <div class="seg">
      <label><input type="radio" name="type" value="out" checked><span class="o">Pemakaian</span></label>
      <label><input type="radio" name="type" value="in"><span class="i">Barang masuk</span></label>
    </div>
    <div class="two">
      <label class="f">Dari tanggal<input type="date" name="from" value="${ui.logFrom || t}" required></label>
      <label class="f">Sampai tanggal<input type="date" name="to" value="${ui.logTo || t}" required></label>
    </div>
    <label class="f">No. Form<input name="formNo" placeholder="mis. 012/W-05/2026 (boleh dikosongkan)"></label>
    <label class="f">Material Type<input name="matType" value="Chemical Lab"></label>
    <label class="f">Dibuat oleh (nama)<input name="by" value="${esc(state.user)}"></label>
    <div class="btn-row"><button type="button" class="btn" data-act="report-share">Bagikan PDF</button>
    <button type="button" class="btn ghost" data-act="report-save">Unduh PDF</button></div>
    <p style="font-size:12.5px;color:var(--muted);margin-bottom:0">“Bagikan” membuka pilihan WhatsApp, email, Drive, dan lainnya. Jumlah dijumlahkan per barang dalam periode yang dipilih.</p>
  </form>`);
}

function buildReport(o) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 14, W = 182, cols = [9, 21, 64, 17, 17, 54], X = [L];
  cols.forEach((c, i) => X.push(X[i] + c));
  const isOut = o.type === 'out', LH = 4.4, PAD = 1.6, BOTTOM = 284;
  const title = isOut ? 'KODE FORM PEMAKAIAN BAHAN KIMIA' : 'FORM BARANG MASUK BAHAN KIMIA';
  const period = o.from === o.to ? longD(o.from) : `${longD(o.from)} s.d. ${longD(o.to)}`;

  const pageHead = () => {
    let y = 12;
    doc.setLineWidth(.3); doc.setDrawColor(0);
    doc.rect(L, y, 101, 12); doc.rect(L + 101, y, 81, 12);
    doc.setFont('times', 'bold'); doc.setFontSize(10);
    doc.text('PT. INDOFOOD CBP SUKSES MAKMUR, Tbk', L + 50.5, y + 5, { align: 'center' });
    doc.text('DIVISI NOODLE - PABRIK BANJARMASIN', L + 50.5, y + 9.5, { align: 'center' });
    doc.setFont('times', 'normal');
    doc.text('KODE FORM    : WHS-000', L + 141.5, y + 5, { align: 'center' });
    doc.text('NO.TERBITAN : 1.0', L + 141.5, y + 9.5, { align: 'center' });
    doc.setFont('times', 'bold'); doc.setFontSize(13);
    doc.text(title, L + W / 2, 32, { align: 'center' });
    doc.setFont('times', 'normal'); doc.setFontSize(10);
    [['NO. Form', o.formNo || '/W-    /' + o.to.slice(0, 4)], ['Tanggal', period], ['Material Type', o.matType]].forEach(([k, v], i) => {
      doc.text(k, L + 1, 41 + i * 5); doc.text(':', L + 28, 41 + i * 5); doc.text(String(v), L + 31, 41 + i * 5);
    });
    return 60;
  };
  const tableHead = y => {
    const h = 10; doc.setFont('times', 'normal'); doc.setFontSize(10);
    cols.forEach((c, i) => doc.rect(X[i], y, c, h));
    const mid = i => X[i] + cols[i] / 2;
    doc.text('NO.', mid(0), y + 6, { align: 'center' });
    doc.text(['SAP', 'Material'], mid(1), y + 4.2, { align: 'center' });
    doc.text('Deskripsi', mid(2), y + 6, { align: 'center' });
    doc.text(isOut ? ['Actual', 'Usage'] : ['Jumlah', 'Masuk'], mid(3), y + 4.2, { align: 'center' });
    doc.text('Uom', mid(4), y + 6, { align: 'center' });
    doc.text('Remark', mid(5), y + 6, { align: 'center' });
    return y + h;
  };

  let y = tableHead(pageHead());
  const rows = o.rows.slice();
  while (rows.length < 10) rows.push(null);
  rows.forEach((r, i) => {
    const desc = r ? doc.splitTextToSize(r.name, cols[2] - 2 * PAD) : [''];
    const rem = r ? doc.splitTextToSize(r.notes.join('; '), cols[5] - 2 * PAD) : [''];
    const h = Math.max(7, Math.max(desc.length, rem.length) * LH + 2.6);
    if (y + h > BOTTOM) { doc.addPage(); y = tableHead(pageHead()); }
    cols.forEach((c, k) => doc.rect(X[k], y, c, h));
    if (r) {
      const ty = y + 4.8;
      doc.text(String(i + 1), X[0] + cols[0] / 2, ty, { align: 'center' });
      doc.text(String(r.code), X[1] + cols[1] / 2, ty, { align: 'center' });
      doc.text(desc, X[2] + PAD, ty);
      doc.text(fmtNum(r.qty), X[3] + cols[3] / 2, ty, { align: 'center' });
      doc.text(r.unit, X[4] + cols[4] / 2, ty, { align: 'center' });
      doc.text(rem, X[5] + PAD, ty);
    }
    y += h;
  });

  y += 10;
  if (y + 42 > BOTTOM + 6) { doc.addPage(); y = 20; }
  doc.text('Dibuat oleh,', L + 12, y);
  if (o.by) doc.text(o.by, L + 12, y + 25);
  doc.text('QC Analis Proses', L + 12, y + (o.by ? 30 : 27));

  const pages = doc.getNumberOfPages();
  if (pages > 1) for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.text(`Hal. ${p}/${pages}`, L + W, 291, { align: 'right' }); }
  return doc.output('blob');
}

async function makeReport(share) {
  const f = Object.fromEntries(new FormData($('form[data-form=report]')));
  if (!f.from || !f.to || f.from > f.to) { toast('Periksa tanggal: “Dari” tidak boleh setelah “Sampai”'); return; }
  if (!window.jspdf) { toast('Pustaka PDF belum termuat. Cek internet lalu coba lagi.'); return; }
  const rows = reportRows(f.type, f.from, f.to);
  if (!rows.length && !confirm('Tidak ada transaksi pada periode ini. Tetap buat form kosong?')) return;
  const blob = buildReport({ type: f.type, from: f.from, to: f.to, formNo: f.formNo.trim(), matType: f.matType.trim() || 'Chemical Lab', by: f.by.trim(), rows });
  const name = `Form-${f.type === 'out' ? 'Pemakaian' : 'Barang-Masuk'}-Bahan-Kimia_${f.from}${f.from !== f.to ? '_sd_' + f.to : ''}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(share ? 'Bagikan tidak didukung di perangkat ini. PDF diunduh.' : 'PDF diunduh');
}

/* ---------- scanner barcode ---------- */
async function scanCode() {
  if (!('BarcodeDetector' in window)) { toast('Scan belum didukung browser ini. Ketik kode manual.'); return null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { toast('Izin kamera ditolak'); return null; }
  const det = new BarcodeDetector();
  const box = document.createElement('div'); box.className = 'scanner';
  box.innerHTML = '<video playsinline muted></video><div class="frame"></div><div class="bar"><span>Arahkan ke barcode / QR</span><button class="btn ghost" id="sc-x">Batal</button></div>';
  document.body.appendChild(box);
  const video = $('video', box); video.srcObject = stream; await video.play();
  return new Promise(res => {
    let done = false;
    const stop = v => { if (done) return; done = true; stream.getTracks().forEach(t => t.stop()); box.remove(); res(v); };
    $('#sc-x', box).onclick = () => stop(null);
    (async function loop() {
      while (!done) {
        try { const r = await det.detect(video); if (r.length) { stop(r[0].rawValue); return; } } catch {}
        await new Promise(r => setTimeout(r, 250));
      }
    })();
  });
}

/* ---------- event ---------- */
document.addEventListener('click', async e => {
  const tb = e.target.closest('#tabs button');
  if (tb) { ui.tab = tb.dataset.tab; render(); scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id, type, v } = el.dataset;
  switch (act) {
    case 'close': closeSheet(); break;
    case 'goto': ui.tab = el.dataset.tab; render(); break;
    case 'settings': settings(); break;
    case 'fab':
      if (ui.tab === 'items') itemForm();
      else if (ui.tab === 'vendors') vendorForm();
      else logForm('in');
      break;
    case 'cat': ui.cat = v; render(); break;
    case 'logtype': ui.logType = v; render(); break;
    case 'mon': ui.mon = v; render(); break;
    case 'item': itemDetail(id); break;
    case 'item-edit': itemForm(id); break;
    case 'item-del': {
      const it = item(id);
      if (it && confirm(`Hapus “${it.name}” beserta seluruh riwayatnya?`)) {
        deleteMany([['items', id], ...state.logs.filter(l => l.itemId === id).map(l => ['logs', l.id])]).catch(fail);
        closeSheet(); toast('Barang dihapus');
      } break;
    }
    case 'log-new': logForm(type, id || ''); break;
    case 'log-detail': logDetail(id); break;
    case 'log-del': {
      const l = state.logs.find(x => x.id === id), it = l && item(l.itemId);
      if (l && confirm('Hapus transaksi ini? Stok akan dikembalikan.')) {
        const b = fs.batch(); b.delete(col('logs').doc(id));
        if (it) b.update(col('items').doc(it.id), { stock: FV.increment(l.type === 'in' ? -l.qty : l.qty) });
        b.commit().catch(fail); closeSheet(); toast('Transaksi dihapus');
      } break;
    }
    case 'vendor-edit': vendorForm(id); break;
    case 'vendor-del':
      if (confirm('Hapus vendor ini?')) {
        const b = fs.batch(); b.delete(col('vendors').doc(id));
        state.items.filter(i => i.vendorId === id).forEach(i => b.update(col('items').doc(i.id), { vendorId: '' }));
        b.commit().catch(fail); closeSheet();
      }
      break;
    case 'scan-search': { const c = await scanCode(); if (c) { const it = state.items.find(i => i.code === c); if (it) itemDetail(it.id); else { ui.tab = 'items'; ui.q = c; render(); toast('Kode tidak ditemukan'); } } break; }
    case 'scan-field': { const c = await scanCode(); if (c) $('input[name=code]').value = c; break; }
    case 'scan-log': { const c = await scanCode(); if (c) { const it = state.items.find(i => i.code === c); if (it) $('#log-item').value = it.id; else toast('Kode tidak ditemukan'); } break; }
    case 'report': reportForm(); break;
    case 'report-share': makeReport(true); break;
    case 'report-save': makeReport(false); break;
    case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; closeSheet(); } break;
    case 'export-json': download(`labstock-backup-${dKey(new Date())}.json`, JSON.stringify({ items: state.items, logs: state.logs, vendors: state.vendors }), 'application/json'); break;
    case 'export-items':
      download(`labstock-barang-${dKey(new Date())}.csv`, toCSV(['Kode', 'Nama', 'Deskripsi', 'Kategori', 'Stok', 'Satuan', 'Minimum', 'Lokasi', 'Expired', 'Vendor'],
        state.items.map(i => [i.code, i.name, i.desc, i.category, i.stock, i.unit, i.min, i.location, i.expiry, vendor(i.vendorId)?.name || ''])), 'text/csv'); break;
    case 'export-logs':
      download(`labstock-riwayat-${dKey(new Date())}.csv`, toCSV(['Waktu', 'Jenis', 'Barang', 'Jumlah', 'Satuan', 'Catatan', 'Petugas'],
        [...state.logs].sort(byTimeDesc).map(l => [fmtDT(l.ts), l.type === 'in' ? 'Masuk' : 'Terpakai', item(l.itemId)?.name || l.itemName, l.qty, item(l.itemId)?.unit || l.unit, l.note, l.user])), 'text/csv'); break;
    case 'demo': demoData(); closeSheet(); toast('Data contoh ditambahkan'); break;
    case 'logout': if (auth) { closeSheet(); auth.signOut(); } break;
    case 'migrate':
      if (legacyState && confirm('Pindahkan data lama di HP ini ke database bersama?')) {
        toast('Memindahkan…');
        try { const n = await importState(legacyState); legacyState = null; DB.set('state', null).catch(() => {}); closeSheet(); toast(n + ' data dipindahkan'); }
        catch (err) { fail(err); }
      } break;
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'lf') { ui.logFrom = e.target.value; render(); }
  if (e.target.id === 'lt') { ui.logTo = e.target.value; render(); }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form, id = form.dataset.id;
  if (kind === 'login') {
    const btn = $('#login-btn'); btn.disabled = true;
    auth.signInWithEmailAndPassword(f.email.trim(), f.password)
      .catch(err => { $('#login-msg').textContent = AUTH_MSG[err.code] || ('Gagal masuk: ' + err.code); })
      .finally(() => { btn.disabled = false; });
    return;
  }
  if (kind === 'item') {
    const code = f.code.trim();
    if (state.items.some(i => i.code === code && i.id !== id)) { toast('Kode sudah dipakai barang lain'); return; }
    const data = { name: f.name.trim(), code, desc: f.desc.trim(), category: f.category.trim(), unit: f.unit.trim(), min: +f.min || 0, location: f.location.trim(), expiry: f.expiry, vendorId: f.vendorId };
    if (id) { const upd = { ...data }; if (tmpPhoto) upd.photo = tmpPhoto; col('items').doc(id).set(upd, { merge: true }).catch(fail); }
    else {
      const it = { id: uid(), stock: 0, photo: tmpPhoto || '', createdAt: new Date().toISOString(), ...data };
      const b = fs.batch(); b.set(col('items').doc(it.id), it);
      const s0 = +f.stock || 0; if (s0 > 0) addLog(it, 'in', s0, 'Stok awal', new Date().toISOString(), b);
      b.commit().catch(fail);
    }
    tmpPhoto = null; closeSheet(); toast('Barang tersimpan');
  } else if (kind === 'log') {
    const it = item(f.itemId), qty = +f.qty;
    if (!it || !(qty > 0)) { toast('Isi jumlah lebih dari 0'); return; }
    if (f.type === 'out' && qty > it.stock) { toast(`Stok tidak cukup (tersisa ${fmtNum(it.stock)} ${it.unit})`); return; }
    addLog(it, f.type, qty, f.note.trim(), new Date(f.ts).toISOString());
    closeSheet(); toast(f.type === 'in' ? 'Barang masuk tercatat' : 'Pemakaian tercatat');
  } else if (kind === 'vendor') {
    const data = { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), note: f.note.trim() };
    const vid = id || uid(); col('vendors').doc(vid).set({ id: vid, ...data }, { merge: true }).catch(fail);
    closeSheet(); toast('Vendor tersimpan');
  }
});

/* ---------- mulai ---------- */
(async function init() {
  state.user = localStorage.getItem('labstock_user') || '';
  try { const s = await DB.get('state'); if (s && s.items && s.items.length) legacyState = s; } catch {}
  render();
  startFirebase();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
})();
