'use strict';

/* ============================================================
 * CONFIG — paste your deployed Apps Script Web App URL here once,
 * so it never needs to be re-entered on any device/browser.
 * (Can still be overridden per-device via the "ตั้งค่า URL เซิร์ฟเวอร์"
 * link on the login screen — that override is stored in localStorage.)
 * ============================================================ */
const DEFAULT_SCRIPT_URL = ''; // e.g. 'https://script.google.com/macros/s/AKfycb.../exec'

const DB_NAME = 'offlineAIChatDB';
const DB_VERSION = 1;

let db = null;
let state = {
  token: null,
  user: null,          // { id, username, role }
  scriptUrl: '',
  mode: 'offline',      // 'offline' | 'online'
  page: 'chat',         // 'chat' | 'data'
  entries: []
};

/* ============================================================
 * IndexedDB helpers
 * ============================================================ */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('session')) idb.createObjectStore('session', { keyPath: 'key' });
      if (!idb.objectStoreNames.contains('entries')) idb.createObjectStore('entries', { keyPath: 'id' });
      if (!idb.objectStoreNames.contains('chatlogs')) idb.createObjectStore('chatlogs', { keyPath: 'id', autoIncrement: true });
      if (!idb.objectStoreNames.contains('pendingOps')) idb.createObjectStore('pendingOps', { keyPath: 'localId', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function storeRef(name, mode) {
  return db.transaction(name, mode).objectStore(name);
}
function dbGet(name, key) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readonly').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function dbGetAll(name) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readonly').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function dbPut(name, value) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readwrite').put(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function dbAdd(name, value) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readwrite').add(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function dbDeleteKey(name, key) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readwrite').delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
function dbClear(name) {
  return new Promise((resolve, reject) => {
    const r = storeRef(name, 'readwrite').clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

/* ============================================================
 * Crypto / API / formatting helpers
 * ============================================================ */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function callApi(action, data) {
  if (!state.scriptUrl) return { ok: false, error: 'ยังไม่ได้ตั้งค่า URL เซิร์ฟเวอร์ (กด "ตั้งค่า URL เซิร์ฟเวอร์")' };
  try {
    const res = await fetch(state.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
      body: JSON.stringify(Object.assign({ action }, data))
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต/URL เซิร์ฟเวอร์' };
  }
}

function formatThaiTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) { return iso; }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setSyncStatus(text) {
  document.getElementById('syncStatus').textContent = text;
}

function showAuthMsg(text, isError) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = 'auth-msg ' + (isError ? 'error' : 'success');
}

/* ============================================================
 * Chat rendering
 * ============================================================ */

function appendMessage(role, text, modeClass, timestamp) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'msg-user' : ('msg-assistant' + (modeClass ? ' mode-' + modeClass : '')));
  el.textContent = text;
  if (timestamp) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = formatThaiTime(timestamp);
    el.appendChild(meta);
  }
  const log = document.getElementById('chatLog');
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function greetingText() {
  return state.mode === 'online'
    ? 'สวัสดีค่ะ ถามอะไรก็ได้เลย ระบบจะเชื่อมต่อ AI ผ่านอินเทอร์เน็ตเพื่อค้นคำตอบให้'
    : 'สวัสดีค่ะ ในโหมดออฟไลน์ ระบบจะค้นคำตอบจาก "ข้อมูลของฉัน" ที่บันทึกไว้ในเครื่องนี้เท่านั้น';
}

async function renderChatHistory() {
  const log = document.getElementById('chatLog');
  log.innerHTML = '';
  const logs = await dbGetAll('chatlogs');
  logs.sort((a, b) => (a.id || 0) - (b.id || 0));
  if (logs.length === 0) {
    appendMessage('assistant', greetingText(), state.mode);
  } else {
    logs.forEach(l => {
      appendMessage('user', l.message);
      appendMessage('assistant', l.answer, l.mode, l.createdAt);
    });
  }
}

// Simple keyword/substring search over the user's own locally stored entries.
function searchLocalEntries(query) {
  const q = query.trim().toLowerCase();
  const words = q.split(/[\s,]+/).filter(w => w.length >= 2);
  const scored = state.entries.map(entry => {
    const hay = [entry.question, entry.keywords, entry.answer, entry.category].join(' ').toLowerCase();
    let score = 0;
    if (q && hay.includes(q)) score += 5;
    words.forEach(w => { if (hay.includes(w)) score += 1; });
    return { entry, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return 'ไม่พบข้อมูลที่เกี่ยวข้องในข้อมูลที่บันทึกไว้ในเครื่อง ลองเพิ่มข้อมูลในหน้า "ข้อมูลของฉัน" หรือสลับเป็นโหมดออนไลน์เพื่อถาม AI โดยตรง';
  }
  const top = scored.slice(0, 3);
  if (top.length === 1) return top[0].entry.answer;
  return top.map((x, i) => `${i + 1}. ${x.entry.question}\n${x.entry.answer}`).join('\n\n');
}

/* ============================================================
 * Entries: local-first CRUD + sync queue
 * ============================================================ */

async function enqueueOp(type, entry) {
  await dbAdd('pendingOps', { type, entry });
}

async function addEntryFlow(data) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry = {
    id, userId: state.user.id, ownerUsername: state.user.username,
    question: data.question, answer: data.answer, keywords: data.keywords, category: data.category,
    createdAt: now, updatedAt: now
  };
  await dbPut('entries', entry);
  await enqueueOp('create', entry);
  await refreshEntriesUI();
  if (state.mode === 'online') syncNow(true);
}

async function updateEntryFlow(id, data) {
  const existing = await dbGet('entries', id);
  const now = new Date().toISOString();
  const updated = Object.assign({}, existing, data, { updatedAt: now });
  await dbPut('entries', updated);
  await enqueueOp('update', { id, question: data.question, answer: data.answer, keywords: data.keywords, category: data.category });
  await refreshEntriesUI();
  if (state.mode === 'online') syncNow(true);
}

async function deleteEntryFlow(id) {
  if (!confirm('ยืนยันการลบข้อมูลนี้หรือไม่?')) return;
  await dbDeleteKey('entries', id);
  await enqueueOp('delete', { id });
  await refreshEntriesUI();
  if (state.mode === 'online') syncNow(true);
}

async function refreshFromServer() {
  const res = await callApi('bootstrap', { token: state.token });
  if (!res.ok) { setSyncStatus('ไม่สามารถเชื่อมต่อ: ' + res.error); return res; }
  await dbClear('entries');
  for (const e of res.entries) await dbPut('entries', e);
  const session = await dbGet('session', 'current');
  if (session) { session.lastSync = res.serverTime; await dbPut('session', session); }
  state.entries = res.entries;
  setSyncStatus('เชื่อมต่อออนไลน์ • ซิงค์ล่าสุด ' + formatThaiTime(res.serverTime));
  return res;
}

async function syncNow(silent) {
  if (state.mode !== 'online') {
    if (!silent) alert('กรุณาสลับเป็นโหมดออนไลน์ก่อนซิงค์ข้อมูล');
    return;
  }
  const ops = await dbGetAll('pendingOps');
  if (ops.length === 0) {
    await refreshFromServer();
    await refreshEntriesUI();
    return;
  }
  setSyncStatus('กำลังซิงค์ข้อมูล...');
  const payloadOps = ops.map(o => ({ type: o.type, localId: o.localId, entry: o.entry }));
  const res = await callApi('sync', { token: state.token, ops: payloadOps });
  if (!res.ok) { setSyncStatus('ซิงค์ไม่สำเร็จ: ' + res.error); return; }
  for (const r of res.opResults) {
    if (r.ok) await dbDeleteKey('pendingOps', r.localId);
  }
  await dbClear('entries');
  for (const e of res.entries) await dbPut('entries', e);
  const session = await dbGet('session', 'current');
  if (session) { session.lastSync = res.serverTime; await dbPut('session', session); }
  state.entries = res.entries;
  setSyncStatus('ซิงค์ล่าสุด ' + formatThaiTime(res.serverTime));
  await refreshEntriesUI();
}

async function refreshEntriesUI() {
  state.entries = await dbGetAll('entries');
  const pending = await dbGetAll('pendingOps');
  const pendingIds = new Set(pending.map(p => p.entry && p.entry.id).filter(Boolean));

  const listEl = document.getElementById('entriesList');
  const ownerFilterEl = document.getElementById('ownerFilter');
  let entriesToShow = state.entries;

  if (state.user.role === 'admin') {
    ownerFilterEl.classList.remove('hidden');
    const owners = {};
    state.entries.forEach(e => { owners[e.userId] = e.ownerUsername || e.userId; });
    const currentVal = ownerFilterEl.value || 'all';
    ownerFilterEl.innerHTML = '<option value="all">ผู้ใช้ทั้งหมด</option>' +
      Object.keys(owners).map(uid => `<option value="${uid}">${escapeHtml(owners[uid])}</option>`).join('');
    ownerFilterEl.value = currentVal;
    if (currentVal !== 'all') entriesToShow = state.entries.filter(e => e.userId === currentVal);
  } else {
    ownerFilterEl.classList.add('hidden');
  }

  listEl.innerHTML = '';
  if (entriesToShow.length === 0) {
    listEl.innerHTML = '<div class="empty-state">ยังไม่มีข้อมูล กด “+ เพิ่มข้อมูลใหม่” เพื่อเริ่มบันทึกความรู้ของคุณ</div>';
    updatePendingBanner(pending.length);
    return;
  }

  entriesToShow.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  entriesToShow.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const ownerTag = state.user.role === 'admin' ? `<span class="tag">${escapeHtml(entry.ownerUsername || '')}</span>` : '';
    const pendingTag = pendingIds.has(entry.id) ? '<span class="tag pending">รอซิงค์</span>' : '';
    const catTag = entry.category ? `<span class="tag">${escapeHtml(entry.category)}</span>` : '';
    card.innerHTML = `
      <h3>${escapeHtml(entry.question)}</h3>
      <p>${escapeHtml(entry.answer)}</p>
      <div class="entry-meta">${catTag}${ownerTag}${pendingTag}
        <span class="entry-actions">
          <button type="button" class="edit">แก้ไข</button>
          <button type="button" class="del">ลบ</button>
        </span>
      </div>`;
    card.querySelector('.edit').addEventListener('click', () => openEntryModal(entry));
    card.querySelector('.del').addEventListener('click', () => deleteEntryFlow(entry.id));
    listEl.appendChild(card);
  });
  updatePendingBanner(pending.length);
}

function updatePendingBanner(count) {
  const el = document.getElementById('pendingBanner');
  if (count > 0) {
    el.classList.remove('hidden');
    el.textContent = `มีข้อมูล ${count} รายการรอซิงค์กับเซิร์ฟเวอร์`;
  } else {
    el.classList.add('hidden');
  }
}

function openEntryModal(entry) {
  document.getElementById('entryModalTitle').textContent = entry ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล';
  document.getElementById('entryId').value = entry ? entry.id : '';
  document.getElementById('entryQuestion').value = entry ? entry.question : '';
  document.getElementById('entryAnswer').value = entry ? entry.answer : '';
  document.getElementById('entryKeywords').value = entry ? entry.keywords : '';
  document.getElementById('entryCategory').value = entry ? entry.category : '';
  document.getElementById('entryModal').classList.remove('hidden');
}
function closeEntryModal() {
  document.getElementById('entryModal').classList.add('hidden');
}

/* ============================================================
 * Auth flow
 * ============================================================ */

async function onlineAuthSuccess(token, user, passwordHash) {
  state.token = token;
  state.user = user;
  state.mode = 'online';
  await dbPut('session', { key: 'current', token, userId: user.id, username: user.username, role: user.role, passwordHash, lastSync: null });
  await enterApp();
  await refreshFromServer();
  await refreshEntriesUI();
}

async function enterApp() {
  document.getElementById('authScreen').classList.remove('active');
  document.getElementById('mainScreen').classList.add('active');
  document.getElementById('whoLabel').textContent = state.user.username + (state.user.role === 'admin' ? ' (ผู้ดูแลระบบ)' : '');
  document.querySelectorAll('.mode-btn').forEach(b => {
    const active = b.dataset.mode === state.mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  setSyncStatus(state.mode === 'online' ? 'เชื่อมต่อออนไลน์' : 'โหมดออฟไลน์ — ใช้ข้อมูลในเครื่อง');
  await renderChatHistory();
  await refreshEntriesUI();
}

/* ============================================================
 * Event bindings
 * ============================================================ */

function bindAuthEvents() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => {
        x.classList.toggle('active', x === t);
        x.setAttribute('aria-selected', String(x === t));
      });
      document.getElementById('loginForm').classList.toggle('hidden', t.dataset.tab !== 'login');
      document.getElementById('registerForm').classList.toggle('hidden', t.dataset.tab !== 'register');
      document.getElementById('authMsg').textContent = '';
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    showAuthMsg('กำลังเข้าสู่ระบบ...', false);
    const passwordHash = await sha256Hex(password);
    const res = await callApi('login', { username, passwordHash });
    if (!res.ok) { showAuthMsg(res.error || 'เข้าสู่ระบบไม่สำเร็จ', true); return; }
    showAuthMsg('', false);
    await onlineAuthSuccess(res.token, res.user, passwordHash);
  });

  document.getElementById('loginOfflineBtn').addEventListener('click', async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) { showAuthMsg('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', true); return; }
    const session = await dbGet('session', 'current');
    if (!session) { showAuthMsg('ยังไม่เคยเข้าสู่ระบบออนไลน์ในเครื่องนี้มาก่อน กรุณาเข้าสู่ระบบออนไลน์อย่างน้อย 1 ครั้ง', true); return; }
    const passwordHash = await sha256Hex(password);
    if (session.username !== username || session.passwordHash !== passwordHash) {
      showAuthMsg('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', true); return;
    }
    state.token = session.token;
    state.user = { id: session.userId, username: session.username, role: session.role };
    state.mode = 'offline';
    showAuthMsg('', false);
    await enterApp();
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const p1 = document.getElementById('registerPassword').value;
    const p2 = document.getElementById('registerPassword2').value;
    if (p1 !== p2) { showAuthMsg('รหัสผ่านทั้งสองช่องไม่ตรงกัน', true); return; }
    showAuthMsg('กำลังสมัครสมาชิก...', false);
    const passwordHash = await sha256Hex(p1);
    const res = await callApi('register', { username, passwordHash });
    if (!res.ok) { showAuthMsg(res.error || 'สมัครสมาชิกไม่สำเร็จ', true); return; }
    showAuthMsg('', false);
    await onlineAuthSuccess(res.token, res.user, passwordHash);
  });

  document.getElementById('toggleUrlConfig').addEventListener('click', () => {
    document.getElementById('urlConfigBox').classList.toggle('hidden');
  });
  document.getElementById('saveUrlBtn').addEventListener('click', () => {
    const val = document.getElementById('scriptUrlInput').value.trim();
    localStorage.setItem('scriptUrl', val);
    state.scriptUrl = val;
    showAuthMsg('บันทึก URL เซิร์ฟเวอร์เรียบร้อยแล้ว', false);
  });
}

function bindMainEvents() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === state.mode) return;
      state.mode = mode;
      document.querySelectorAll('.mode-btn').forEach(b => {
        const active = b.dataset.mode === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      if (mode === 'online') {
        setSyncStatus('กำลังเชื่อมต่อ...');
        await syncNow(true);
      } else {
        setSyncStatus('โหมดออฟไลน์ — ใช้ข้อมูลในเครื่อง');
      }
      if (state.page === 'data') await refreshEntriesUI();
    });
  });

  document.querySelectorAll('.pagebtn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const page = btn.dataset.page;
      state.page = page;
      document.querySelectorAll('.pagebtn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
      if (page === 'data') await refreshEntriesUI();
    });
  });

  document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;
    appendMessage('user', message);
    input.value = '';

    if (state.mode === 'offline') {
      const answer = searchLocalEntries(message);
      const now = new Date().toISOString();
      appendMessage('assistant', answer, 'offline', now);
      await dbAdd('chatlogs', { mode: 'offline', message, answer, createdAt: now });
    } else {
      const thinkingEl = appendMessage('assistant', 'กำลังค้นหาคำตอบ...', 'online');
      const res = await callApi('chat', { token: state.token, message });
      if (res.ok) {
        thinkingEl.textContent = res.answer;
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = formatThaiTime(res.createdAt);
        thinkingEl.appendChild(meta);
        await dbAdd('chatlogs', { mode: 'online', message, answer: res.answer, createdAt: res.createdAt });
      } else {
        thinkingEl.textContent = 'เกิดข้อผิดพลาด: ' + res.error;
      }
    }
  });

  document.getElementById('addEntryBtn').addEventListener('click', () => openEntryModal(null));
  document.getElementById('entryCancelBtn').addEventListener('click', closeEntryModal);
  document.getElementById('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('entryId').value;
    const data = {
      question: document.getElementById('entryQuestion').value.trim(),
      answer: document.getElementById('entryAnswer').value.trim(),
      keywords: document.getElementById('entryKeywords').value.trim(),
      category: document.getElementById('entryCategory').value.trim()
    };
    if (id) await updateEntryFlow(id, data);
    else await addEntryFlow(data);
    closeEntryModal();
  });

  document.getElementById('syncNowBtn').addEventListener('click', () => syncNow(false));
  document.getElementById('ownerFilter').addEventListener('change', () => refreshEntriesUI());

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const pending = await dbGetAll('pendingOps');
    const warn = pending.length > 0
      ? `มีข้อมูล ${pending.length} รายการยังไม่ได้ซิงค์ หากออกจากระบบตอนนี้ข้อมูลเหล่านี้จะหายไป ต้องการดำเนินการต่อหรือไม่?`
      : 'ออกจากระบบและล้างข้อมูลในเครื่องนี้หรือไม่?';
    if (!confirm(warn)) return;
    await dbClear('session');
    await dbClear('entries');
    await dbClear('chatlogs');
    await dbClear('pendingOps');
    location.reload();
  });
}

/* ============================================================
 * Init
 * ============================================================ */

async function init() {
  db = await openDB();
  state.scriptUrl = localStorage.getItem('scriptUrl') || DEFAULT_SCRIPT_URL;
  document.getElementById('scriptUrlInput').value = state.scriptUrl;

  bindAuthEvents();
  bindMainEvents();

  const session = await dbGet('session', 'current');
  if (session && session.userId) {
    state.token = session.token;
    state.user = { id: session.userId, username: session.username, role: session.role };
    state.mode = 'offline'; // always start offline; user can tap "โหมดออนไลน์" to reconnect
    await enterApp();
  }
}

document.addEventListener('DOMContentLoaded', init);
