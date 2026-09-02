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

  const settingsModal = document.getElementById("settingsModal");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelInput = document.getElementById("modelInput");
  const scriptUrlInput = document.getElementById("scriptUrlInput");
  const settingsError = document.getElementById("settingsError");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // ---- state --------------------------------------------------------------
  let history = readJson(LS_KEYS.CHAT_HISTORY, []); // [{id, role, text, time, ts, synced}]
  let mode = localStorage.getItem(LS_KEYS.MODE) || (navigator.onLine ? "online" : "offline");
  let connectivityForcedOffline = false;
  let busy = false;

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
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>") +
      '<span class="bubble-meta">' + escapeHtml(time) + "</span>";
    row.appendChild(bubble);
    chatWindow.appendChild(row);
    if (doScroll !== false) scrollToBottom();
    return row;
  }

  function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
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
    history.filter(function (m) { return !m.synced; }).forEach(function (m) {
      syncPushMessage(m).then(function (res) {
        if (res && res.ok) {
          m.synced = true;
          writeJson(LS_KEYS.CHAT_HISTORY, history);
        }
      });
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

    if (!online && mode === "online") {
      connectivityForcedOffline = true;
      setMode("offline");
    } else if (online && connectivityForcedOffline) {
      connectivityForcedOffline = false;
      setMode("online");
    }
    if (online) retryUnsyncedMessages();
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

  dataBtn.addEventListener("click", function () {
    window.location.href = "data.html";
  });

  logoutBtn.addEventListener("click", function () {
    if (confirm("ออกจากระบบ?")) logout();
  });

  // ---- settings modal -------------------------------------------------------
  function openSettings() {
    apiKeyInput.value = getGroqKey();
    modelInput.value = localStorage.getItem(LS_KEYS.GROQ_MODEL) || DEFAULT_GROQ_MODEL;
    scriptUrlInput.value = getScriptUrl();
    settingsError.textContent = "";
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
    closeSettings();
    if (navigator.onLine) {
      retryUnsyncedMessages();
      syncChatOnLoad();
    }
  });

  // ---- offline keyword matching ---------------------------------------------
  function findOfflineReply(text) {
    const data = readJson(LS_KEYS.OFFLINE_DATA, []);
    const norm = text.trim().toLowerCase();
    if (!norm || data.length === 0) return null;

    let hit = data.find(function (d) {
      return d.keyword.trim().toLowerCase() === norm;
    });
    if (!hit) {
      hit = data.find(function (d) {
        const k = d.keyword.trim().toLowerCase();
        return k.length > 0 && norm.indexOf(k) !== -1;
      });
    }
    return hit ? hit.reply : null;
  }

  // ---- online AI (Groq — free tier, OpenAI-compatible) -----------------------
  async function callGroq(userText) {
    const apiKey = getGroqKey();
    const model = localStorage.getItem(LS_KEYS.GROQ_MODEL) || DEFAULT_GROQ_MODEL;
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

    const json = await res.json();
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || ("เรียก Groq API ไม่สำเร็จ (HTTP " + res.status + ")");
      throw new Error(msg);
    }
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error("AI ไม่ได้ส่งข้อความตอบกลับมา ลองใหม่อีกครั้ง");
    return text.trim();
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
