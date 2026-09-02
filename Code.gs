/**
 * AI แชท ออนไลน์/ออฟไลน์ — Apps Script backend
 * เก็บ 2 อย่าง: ประวัติแชท (ChatHistory) และคู่คีย์เวิร์ด-คำตอบโหมดออฟไลน์ (OfflineData)
 * ให้ทุกเครื่องที่ตั้งค่า Apps Script URL เดียวกันเห็นข้อมูลตรงกัน
 *
 * ต้องตรงกับ SYNC_TOKEN ใน js/common.js — เปลี่ยนเป็นค่าของคุณเองก่อน deploy จริง
 */
const SYNC_TOKEN = "meen";

const CHAT_SHEET = "ChatHistory";
const CHAT_HEADERS = ["id", "role", "text", "time", "ts"];

const DATA_SHEET = "OfflineData";
const DATA_HEADERS = ["id", "keyword", "reply"];

const CACHE_KEY = "bootstrap_v1";
const CACHE_TTL_SECONDS = 30;

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const [headers, ...data] = rows;
  return data
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = row[i]));
      return obj;
    });
}

function findRowIndexById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function checkToken_(token) {
  if (token !== SYNC_TOKEN) throw new Error("unauthorized");
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nowBangkok_() {
  return Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** GET ?action=bootstrap&token=... — โหลดทั้งแชทและข้อมูลออฟไลน์ครั้งเดียว (แคช 30 วิ) */
function doGet(e) {
  try {
    checkToken_(e.parameter.token);
    if (e.parameter.action !== "bootstrap") return jsonOut_({ error: "unknown action" });

    const cache = CacheService.getScriptCache();
    const cached = cache.get(CACHE_KEY);
    if (cached) return jsonOut_(JSON.parse(cached));

    const chatSheet = getSheet_(CHAT_SHEET, CHAT_HEADERS);
    const dataSheet = getSheet_(DATA_SHEET, DATA_HEADERS);
    const payload = {
      chat: sheetToObjects_(chatSheet),
      entries: sheetToObjects_(dataSheet),
      serverTime: nowBangkok_(),
    };
    cache.put(CACHE_KEY, JSON.stringify(payload), CACHE_TTL_SECONDS);
    return jsonOut_(payload);
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

/**
 * POST body ตัวอย่าง:
 *  { action: "addMessage", token, message: {id, role, text, time, ts} }
 *  { action: "upsertEntry", token, entry: {id, keyword, reply} }
 *  { action: "deleteEntry", token, id }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    checkToken_(body.token);

    if (body.action === "addMessage") {
      const m = body.message || {};
      const sheet = getSheet_(CHAT_SHEET, CHAT_HEADERS);
      sheet.appendRow([m.id || Utilities.getUuid(), m.role || "", m.text || "", m.time || "", m.ts || Date.now()]);
      CacheService.getScriptCache().remove(CACHE_KEY);
      return jsonOut_({ ok: true });
    }

    if (body.action === "upsertEntry") {
      const entry = body.entry || {};
      const sheet = getSheet_(DATA_SHEET, DATA_HEADERS);
      const rowIndex = findRowIndexById_(sheet, entry.id);
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, DATA_HEADERS.length).setValues([[entry.id, entry.keyword || "", entry.reply || ""]]);
      } else {
        sheet.appendRow([entry.id || Utilities.getUuid(), entry.keyword || "", entry.reply || ""]);
      }
      CacheService.getScriptCache().remove(CACHE_KEY);
      return jsonOut_({ ok: true });
    }

    if (body.action === "deleteEntry") {
      const sheet = getSheet_(DATA_SHEET, DATA_HEADERS);
      const rowIndex = findRowIndexById_(sheet, body.id);
      if (rowIndex > 0) sheet.deleteRow(rowIndex);
      CacheService.getScriptCache().remove(CACHE_KEY);
      return jsonOut_({ ok: true });
    }

    return jsonOut_({ error: "unknown action" });
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}
