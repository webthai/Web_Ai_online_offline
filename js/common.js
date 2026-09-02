/* ==========================================================================
   common.js — shared across all pages
   ========================================================================== */

// ---- fixed login (client-side gate only, no backend involved) ----------
const FIXED_USERNAME = "meen";
const FIXED_PASSWORD = "5340";

// ---- Google Sheets sync (optional — makes every device see the same data) ---
// วาง Web app URL ของ Apps Script ที่ deploy แล้วตรงนี้ ไม่ต้องกรอกใหม่ทุกเครื่อง
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyw8pLiBWa20gW6XvYn7ijXbe3ugLSzJNC7s_y_X_UOMEYd_tV6xe4sm8XGFCI-gR2XxQ/exec";
// ต้องตรงกับ SYNC_TOKEN ใน Code.gs ทุกตัวอักษร
const SYNC_TOKEN = "meen";

// ค่าเริ่มต้นของ Gemini API Key (โหมดออนไลน์) — ใส่ไว้ล่วงหน้าไม่ต้องกรอกทุกเครื่อง
// ยังแก้ทับได้จากหน้าตั้งค่าในแอปถ้าต้องการเปลี่ยนคีย์
const DEFAULT_GEMINI_KEY = "AQ.Ab8RN6IdyzuZV6L5yBCh43bNhsBAHaoLqdMhE8MHumjD3WBueQ";

// ---- storage keys --------------------------------------------------------
const LS_KEYS = {
  LOGGED_IN: "aichat_logged_in",
  MODE: "aichat_mode", // "online" | "offline"
  CHAT_HISTORY: "aichat_history",
  OFFLINE_DATA: "aichat_offline_data", // array of {id, keyword, reply}
  GEMINI_KEY: "aichat_gemini_key",
  GEMINI_MODEL: "aichat_gemini_model",
  SCRIPT_URL: "aichat_script_url",
};

const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

// ---- auth guard ------------------------------------------------------
function requireLogin() {
  if (localStorage.getItem(LS_KEYS.LOGGED_IN) !== "1") {
    window.location.href = "index.html";
  }
}

function logout() {
  localStorage.removeItem(LS_KEYS.LOGGED_IN);
  window.location.href = "index.html";
}

// ---- Bangkok time helpers ----------------------------------------------
function nowBangkokLabel() {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fullBangkokLabel(date) {
  return date.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---- small helpers --------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uuid() {
  // simple RFC4122-ish v4 generator, no external lib needed
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==========================================================================
// Google Sheets sync — ทำงานเฉพาะตอนออนไลน์ ไม่มีเน็ตก็ใช้แอปได้ปกติ
// เก็บทุกอย่างในเครื่องก่อนเสมอ (localStorage) แล้วค่อยส่งขึ้น/ดึงลงตอนมีเน็ต
// ==========================================================================
function getScriptUrl() {
  return localStorage.getItem(LS_KEYS.SCRIPT_URL) || DEFAULT_SCRIPT_URL;
}

function setScriptUrl(url) {
  localStorage.setItem(LS_KEYS.SCRIPT_URL, url || "");
}

function getGeminiKey() {
  return localStorage.getItem(LS_KEYS.GEMINI_KEY) || DEFAULT_GEMINI_KEY;
}

async function syncBootstrap() {
  const url = getScriptUrl();
  if (!url || !navigator.onLine) return null;
  try {
    const res = await fetch(url + "?action=bootstrap&token=" + encodeURIComponent(SYNC_TOKEN), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("ซิงก์ bootstrap ไม่สำเร็จ:", e.message);
    return null;
  }
}

async function syncPost(body) {
  const url = getScriptUrl();
  if (!url || !navigator.onLine) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // เลี่ยง CORS preflight ของ Apps Script
      body: JSON.stringify(Object.assign({ token: SYNC_TOKEN }, body)),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("ซิงก์ไม่สำเร็จ (จะลองใหม่ครั้งหน้าที่มีเน็ต):", e.message);
    return null;
  }
}

function syncPushMessage(msg) {
  return syncPost({ action: "addMessage", message: msg });
}

function syncPushEntry(entry) {
  return syncPost({ action: "upsertEntry", entry: entry });
}

function syncDeleteEntry(id) {
  return syncPost({ action: "deleteEntry", id: id });
}

