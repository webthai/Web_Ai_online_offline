/* ==========================================================================
   common.js — shared across all pages
   ========================================================================== */

// ---- fixed login (client-side gate only, no backend involved) ----------
const FIXED_USERNAME = "meen";
const FIXED_PASSWORD = "5340";

// ---- storage keys --------------------------------------------------------
const LS_KEYS = {
  LOGGED_IN: "aichat_logged_in",
  MODE: "aichat_mode", // "online" | "offline"
  CHAT_HISTORY: "aichat_history",
  OFFLINE_DATA: "aichat_offline_data", // array of {id, keyword, reply}
  GEMINI_KEY: "aichat_gemini_key",
  GEMINI_MODEL: "aichat_gemini_model",
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
