/* ==========================================================================
   chat.js — ai.html logic
   ========================================================================== */

requireLogin();

(function () {
  // ---- element refs -----------------------------------------------------
  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");
  const modeOnlineBtn = document.getElementById("modeOnlineBtn");
  const modeOfflineBtn = document.getElementById("modeOfflineBtn");
  const dataBtn = document.getElementById("dataBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const chatWindow = document.getElementById("chatWindow");
  const emptyState = document.getElementById("emptyState");
  const composerForm = document.getElementById("composerForm");
  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");

  const settingsModal = document.getElementById("settingsModal");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelInput = document.getElementById("modelInput");
  const scriptUrlInput = document.getElementById("scriptUrlInput");
  const settingsError = document.getElementById("settingsError");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const lastSyncedLabel = document.getElementById("lastSyncedLabel");
  const clearChatBtn = document.getElementById("clearChatBtn");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const autoDeleteInput = document.getElementById("autoDeleteInput");

  // ---- state --------------------------------------------------------------
  let history = readJson(LS_KEYS.CHAT_HISTORY, []); // [{id, role, text, time, ts, synced}]

  // ลบข้อความที่เก่ากว่าจำนวนวันที่ตั้งไว้ (ถ้าตั้งไว้) ทันทีตอนโหลดหน้า
  // กันไม่ให้ localStorage บวมขึ้นเรื่อย ๆ ในระยะยาว — ปิดใช้งานได้โดยเว้นค่าไว้ที่หน้าตั้งค่า
  (function pruneOldMessages() {
    const days = parseInt(localStorage.getItem(LS_KEYS.AUTO_DELETE_DAYS), 10);
    if (!days || days <= 0) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const before = history.length;
    history = history.filter(function (m) { return m.ts >= cutoff; });
    if (history.length !== before) {
      writeJson(LS_KEYS.CHAT_HISTORY, history);
    }
  })();
  let mode = localStorage.getItem(LS_KEYS.MODE) || (navigator.onLine ? "online" : "offline");
  let busy = false;
  let currentAudio = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  // ---- render history on load ---------------------------------------------
  function renderAll() {
    chatWindow.innerHTML = "";
    if (history.length === 0) {
      chatWindow.appendChild(emptyState);
      return;
    }
    history.forEach((m) => appendBubble(m.role, m.text, m.time, false));
    scrollToBottom();
  }

  function appendBubble(role, text, time, doScroll) {
    if (emptyState.parentNode === chatWindow) chatWindow.removeChild(emptyState);

    const row = document.createElement("div");
    row.className = "bubble-row " + (role === "user" ? "from-user" : "from-ai");

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>") +
      '<span class="bubble-meta">' + escapeHtml(time) + "</span>";
    wrap.appendChild(bubble);

    const actions = document.createElement("div");
    actions.className = "bubble-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "คัดลอก";
    copyBtn.addEventListener("click", function () {
      copyTextToClipboard(text);
    });
    actions.appendChild(copyBtn);

    if (role === "ai") {
      const ttsBtn = document.createElement("button");
      ttsBtn.type = "button";
      ttsBtn.textContent = "🔊 ฟัง";
      ttsBtn.addEventListener("click", function () {
        playAiSpeech(text, ttsBtn);
      });
      actions.appendChild(ttsBtn);
    }

    wrap.appendChild(actions);
    row.appendChild(wrap);
    chatWindow.appendChild(row);
    if (doScroll !== false) scrollToBottom();
    return row;
  }

  function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          showToast("คัดลอกแล้ว");
        })
        .catch(function () {
          showToast("คัดลอกไม่สำเร็จ", "error");
        });
    } else {
      showToast("เบราว์เซอร์นี้ไม่รองรับการคัดลอกอัตโนมัติ", "error");
    }
  }

  async function playAiSpeech(text, btn) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    const apiKey = getGroqKey();
    if (!apiKey) {
      openSettings();
      showToast("ยังไม่ได้ตั้งค่า Groq API Key", "error");
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "กำลังโหลดเสียง...";
    try {
      const url = await callGroqTTS(text);
      currentAudio = new Audio(url);
      currentAudio.play();
    } catch (err) {
      showToast("เล่นเสียงไม่สำเร็จ: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function pushMessage(role, text, opts) {
    opts = opts || {};
    const time = opts.time || nowBangkokLabel();
    const msg = {
      id: opts.id || uuid(),
      role: role,
      text: text,
      time: time,
      ts: opts.ts || Date.now(),
      synced: opts.synced || false,
    };
    history.push(msg);
    // keep history bounded so localStorage doesn't grow forever
    if (history.length > 200) history = history.slice(history.length - 200);
    writeJson(LS_KEYS.CHAT_HISTORY, history);
    if (opts.render !== false) appendBubble(role, text, time);
    if (!msg.synced) {
      syncPushMessage(msg).then(function (res) {
        if (res && res.ok) {
          msg.synced = true;
          writeJson(LS_KEYS.CHAT_HISTORY, history);
        }
      });
    }
    return msg;
  }

  // ---- Google Sheets sync: pull remote history once on load, then keep
  // pushing new messages as they're sent (see pushMessage above) ------------
  async function syncChatOnLoad() {
    const data = await syncBootstrap();
    if (!data || !Array.isArray(data.chat)) return;
    const localIds = new Set(history.map(function (m) { return m.id; }));
    let changed = false;
    data.chat.forEach(function (m) {
      if (!localIds.has(m.id)) {
        history.push({ id: m.id, role: m.role, text: m.text, time: m.time, ts: Number(m.ts) || Date.now(), synced: true });
        changed = true;
      }
    });
    if (changed) {
      history.sort(function (a, b) { return a.ts - b.ts; });
      if (history.length > 200) history = history.slice(history.length - 200);
      writeJson(LS_KEYS.CHAT_HISTORY, history);
      renderAll();
    }
  }

  function retryUnsyncedMessages() {
    const pending = history.filter(function (m) { return !m.synced; });
    if (pending.length === 0) return;
    Promise.all(
      pending.map(function (m) {
        return syncPushMessage(m).then(function (res) {
          if (res && res.ok) m.synced = true;
        });
      })
    ).then(function () {
      writeJson(LS_KEYS.CHAT_HISTORY, history);
      const stillPending = history.some(function (m) { return !m.synced; });
      if (!stillPending) showToast("ซิงก์ข้อความที่ค้างอยู่สำเร็จ");
    });
  }

  // ---- mode / connectivity -------------------------------------------------
  function setMode(newMode) {
    mode = newMode;
    localStorage.setItem(LS_KEYS.MODE, mode);
    modeOnlineBtn.classList.toggle("active", mode === "online");
    modeOfflineBtn.classList.toggle("active", mode === "offline");
    dataBtn.style.display = mode === "offline" ? "inline-flex" : "none";
  }

  function updateConnectivityUI() {
    const online = navigator.onLine;
    statusDot.classList.toggle("is-online", online);
    statusDot.classList.toggle("is-offline", !online);
    statusLabel.textContent = online ? "ออนไลน์" : "ออฟไลน์";
    modeOnlineBtn.disabled = !online;

    // สลับโหมดให้ตรงกับสถานะเน็ตจริงเสมอ ทุกครั้งที่เน็ตหลุด/กลับมา
    // (ไม่ต้องกดปุ่มสลับเองอีกต่อไป — ออนไลน์<->ออฟไลน์ ตามเน็ตจริงตลอด)
    setMode(online ? "online" : "offline");

    if (online) {
      retryUnsyncedMessages();
      syncChatOnLoad();
    }
  }

  modeOnlineBtn.addEventListener("click", function () {
    if (!navigator.onLine) return;
    setMode("online");
  });
  modeOfflineBtn.addEventListener("click", function () {
    setMode("offline");
  });

  window.addEventListener("online", updateConnectivityUI);
  window.addEventListener("offline", updateConnectivityUI);

  // เปิดแอปค้างไว้เฉย ๆ ก็ยังดึงแชทจากเครื่องอื่นเข้ามาเรื่อย ๆ ไม่ต้องรีเฟรชเอง:
  //   - ดึงซ้ำทุก 30 วิ ระหว่างเปิดหน้าค้างไว้ (เบา เพราะ Apps Script แคชไว้ 30 วิอยู่แล้ว)
  //   - ดึงทันทีเวลาสลับกลับมาที่แท็บ/แอปนี้ (เช่น พิมพ์จากมือถือ แล้วสลับมาดู PC)
  setInterval(function () {
    if (navigator.onLine) syncChatOnLoad();
  }, 30000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && navigator.onLine) {
      syncChatOnLoad();
    }
  });

  dataBtn.addEventListener("click", function () {
    window.location.href = "data.html";
  });

  logoutBtn.addEventListener("click", function () {
    if (confirm("ออกจากระบบ?")) logout();
  });

  // ---- settings modal -------------------------------------------------------
  function refreshThemeToggleLabel() {
    if (!themeToggleBtn) return;
    themeToggleBtn.textContent = getTheme() === "light" ? "สลับเป็นธีมมืด" : "สลับเป็นธีมสว่าง";
  }

  if (themeToggleBtn) {
    refreshThemeToggleLabel();
    themeToggleBtn.addEventListener("click", function () {
      setTheme(getTheme() === "light" ? "dark" : "light");
      refreshThemeToggleLabel();
    });
  }

  function openSettings() {
    apiKeyInput.value = getGroqKey();
    modelInput.value = getGroqModel();
    scriptUrlInput.value = getScriptUrl();
    settingsError.textContent = "";
    if (lastSyncedLabel) lastSyncedLabel.textContent = "ซิงก์ล่าสุด: " + getLastSyncLabel();
    if (autoDeleteInput) autoDeleteInput.value = localStorage.getItem(LS_KEYS.AUTO_DELETE_DAYS) || "";
    refreshThemeToggleLabel();
    settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    settingsModal.classList.add("hidden");
  }
  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", function (e) {
    if (e.target === settingsModal) closeSettings();
  });
  saveSettingsBtn.addEventListener("click", function () {
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || DEFAULT_GROQ_MODEL;
    if (!key) {
      settingsError.textContent = "กรุณาใส่ API Key";
      return;
    }
    localStorage.setItem(LS_KEYS.GROQ_KEY, key);
    localStorage.setItem(LS_KEYS.GROQ_MODEL, model);
    setScriptUrl(scriptUrlInput.value.trim());
    if (autoDeleteInput) {
      const days = autoDeleteInput.value.trim();
      if (days) {
        localStorage.setItem(LS_KEYS.AUTO_DELETE_DAYS, days);
      } else {
        localStorage.removeItem(LS_KEYS.AUTO_DELETE_DAYS);
      }
    }
    closeSettings();
    if (navigator.onLine) {
      retryUnsyncedMessages();
      syncChatOnLoad();
    }
  });

  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", function () {
      if (!confirm("ล้างแชททั้งหมดในเครื่องนี้?\n(ข้อมูลใน Google Sheets จะไม่ถูกลบ ถ้าเปิดจากเครื่องอื่นที่ซิงก์ไว้จะยังเห็นแชทเดิมอยู่)")) {
        return;
      }
      history = [];
      writeJson(LS_KEYS.CHAT_HISTORY, history);
      renderAll();
      closeSettings();
      showToast("ล้างแชทแล้ว (ในเครื่องนี้เท่านั้น)");
    });
  }

  // ---- offline keyword matching ---------------------------------------------
  // ลำดับการ match:
  //   1) ตรงกันเป๊ะ (exact) — ถ้าเจอ ใช้ชุดนี้อย่างเดียว เพราะแม่นยำที่สุด
  //   2) match แบบสองทาง — ข้อความที่พิมพ์มีคีย์เวิร์ดแฝงอยู่ (แบบเดิม)
  //      หรือคีย์เวิร์ดมีข้อความที่พิมพ์แฝงอยู่ (ใหม่ — ทำให้คำสั้น ๆ เช่น
  //      "key" match กับคีย์เวิร์ดยาวอย่าง "Api Key" ได้ด้วย)
  //      กันคำพิมพ์ที่สั้นกว่า 2 ตัวอักษรไม่ให้ไปเทียบทางนี้ เพื่อไม่ให้ match มั่ว
  //   3) ถ้า match ได้มากกว่า 1 รายการ รวมทุกคำตอบเข้าเป็นคำตอบเดียว
  //      โดยขึ้นต้นแต่ละส่วนด้วยชื่อคีย์เวิร์ดของมัน
  function findOfflineReply(text) {
    const data = readJson(LS_KEYS.OFFLINE_DATA, []);
    const norm = text.trim().toLowerCase();
    if (!norm || data.length === 0) return null;

    const exactHits = data.filter(function (d) {
      return d.keyword.trim().toLowerCase() === norm;
    });
    if (exactHits.length > 0) {
      return exactHits.map(function (d) { return d.reply; }).join("\n\n");
    }

    const partialHits = data.filter(function (d) {
      const k = d.keyword.trim().toLowerCase();
      if (!k) return false;
      const messageContainsKeyword = norm.indexOf(k) !== -1;
      const keywordContainsMessage = norm.length >= 2 && k.indexOf(norm) !== -1;
      return messageContainsKeyword || keywordContainsMessage;
    });

    if (partialHits.length === 0) return null;
    if (partialHits.length === 1) return partialHits[0].reply;

    return partialHits
      .map(function (d) { return d.keyword.trim() + ": " + d.reply; })
      .join("\n\n");
  }

  // ---- online AI (Groq — free tier, OpenAI-compatible) -----------------------
  async function callGroq(userText, isRetry) {
    const apiKey = getGroqKey();
    const model = getGroqModel();
    if (!apiKey) {
      openSettings();
      throw new Error("ยังไม่ได้ตั้งค่า API Key — กรุณาใส่ Groq API Key ในหน้าตั้งค่า");
    }

    // send a short window of recent turns for context
    const recent = history.slice(-10);
    const messages = recent.map(function (m) {
      return { role: m.role === "user" ? "user" : "assistant", content: m.text };
    });
    messages.push({ role: "user", content: userText });

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({ model: model, messages: messages }),
    });

    // โดนจำกัดอัตราการใช้งาน (rate limit) — รอสักครู่แล้วลองใหม่ให้อัตโนมัติ 1 ครั้ง
    if (res.status === 429 && !isRetry) {
      showToast("ใช้งานถี่ไปหน่อย รอสักครู่แล้วลองใหม่ให้อัตโนมัติ...");
      await new Promise(function (resolve) { setTimeout(resolve, 3000); });
      return callGroq(userText, true);
    }

    const json = await res.json();
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || ("เรียก Groq API ไม่สำเร็จ (HTTP " + res.status + ")");
      throw new Error(msg);
    }
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error("AI ไม่ได้ส่งข้อความตอบกลับมา ลองใหม่อีกครั้ง");
    return text.trim();
  }

  // ---- speech-to-text (mic button: click to start, click again to stop) -----
  async function toggleRecording() {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          const blob = new Blob(recordedChunks, { type: "audio/webm" });
          transcribeAndFill(blob);
        };
        mediaRecorder.start();
        isRecording = true;
        micBtn.classList.add("recording");
      } catch (err) {
        showToast("ขอสิทธิ์ใช้ไมโครโฟนไม่สำเร็จ", "error");
      }
    } else {
      isRecording = false;
      micBtn.classList.remove("recording");
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }
  }

  async function transcribeAndFill(blob) {
    const apiKey = getGroqKey();
    if (!apiKey) {
      openSettings();
      showToast("ยังไม่ได้ตั้งค่า Groq API Key", "error");
      return;
    }
    micBtn.disabled = true;
    showToast("กำลังถอดเสียง...");
    try {
      const text = await callGroqSTT(blob);
      if (text) {
        msgInput.value = msgInput.value ? msgInput.value + " " + text : text;
        autoResize();
        msgInput.focus();
      } else {
        showToast("ไม่ได้ยินเสียงพูด ลองใหม่อีกครั้ง", "error");
      }
    } catch (err) {
      showToast("ถอดเสียงไม่สำเร็จ: " + err.message, "error");
    } finally {
      micBtn.disabled = false;
    }
  }

  if (micBtn) {
    micBtn.addEventListener("click", toggleRecording);
  }

  // ---- send flow -------------------------------------------------------
  function autoResize() {
    msgInput.style.height = "auto";
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + "px";
  }
  msgInput.addEventListener("input", autoResize);
  msgInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composerForm.requestSubmit();
    }
  });

  composerForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (busy) return;
    const text = msgInput.value.trim();
    if (!text) return;

    pushMessage("user", text);
    msgInput.value = "";
    autoResize();

    // offline data can answer in either mode — check it first
    const offlineHit = findOfflineReply(text);
    if (offlineHit !== null) {
      pushMessage("ai", offlineHit);
      return;
    }

    if (mode === "offline") {
      pushMessage("ai", "ยังไม่มีข้อมูลสำหรับคำนี้ในโหมดออฟไลน์ — ลองเพิ่มคำและคำตอบในหน้า “ข้อมูล”");
      return;
    }

    // online mode: call Groq
    busy = true;
    sendBtn.disabled = true;
    const thinkingRow = appendBubble("ai", "กำลังพิมพ์...", nowBangkokLabel());
    try {
      const reply = await callGroq(text);
      thinkingRow.remove();
      pushMessage("ai", reply);
    } catch (err) {
      thinkingRow.remove();
      pushMessage("ai", "เกิดข้อผิดพลาด: " + err.message);
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  });

  // ---- init -------------------------------------------------------------
  renderAll();
  setMode(mode);
  updateConnectivityUI();
  syncChatOnLoad();
})();
