/* ==========================================================================
   data.js — data.html logic
   ========================================================================== */

requireLogin();

(function () {
  const backBtn = document.getElementById("backBtn");
  const dataForm = document.getElementById("dataForm");
  const keywordInput = document.getElementById("keywordInput");
  const replyInput = document.getElementById("replyInput");
  const saveEntryBtn = document.getElementById("saveEntryBtn");
  const dataTableWrap = document.getElementById("dataTableWrap");
  const dataEmpty = document.getElementById("dataEmpty");

  let entries = readJson(LS_KEYS.OFFLINE_DATA, []);
  let editingId = null;

  async function syncEntriesOnLoad() {
    const data = await syncBootstrap();
    if (!data || !Array.isArray(data.entries)) return;
    const localIds = new Set(entries.map(function (x) { return x.id; }));
    let changed = false;
    data.entries.forEach(function (r) {
      const existing = entries.find(function (x) { return x.id === r.id; });
      if (existing) {
        if (existing.keyword !== r.keyword || existing.reply !== r.reply) {
          existing.keyword = r.keyword;
          existing.reply = r.reply;
          changed = true;
        }
      } else {
        entries.push({ id: r.id, keyword: r.keyword, reply: r.reply });
        changed = true;
      }
    });
    if (changed) {
      persist();
      render();
    }
  }

  backBtn.addEventListener("click", function () {
    window.location.href = "ai.html";
  });

  function persist() {
    writeJson(LS_KEYS.OFFLINE_DATA, entries);
  }

  function render() {
    dataTableWrap.innerHTML = "";
    if (entries.length === 0) {
      dataTableWrap.appendChild(dataEmpty);
      return;
    }
    entries.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "data-row";
      row.innerHTML =
        '<div class="col"><span class="k">คีย์เวิร์ด</span>' + escapeHtml(item.keyword) + "</div>" +
        '<div class="col"><span class="k">คำตอบ</span>' + escapeHtml(item.reply) + "</div>" +
        '<div class="row-actions">' +
        '<button type="button" data-action="edit" data-id="' + item.id + '">แก้ไข</button>' +
        '<button type="button" class="danger" data-action="delete" data-id="' + item.id + '">ลบ</button>' +
        "</div>";
      dataTableWrap.appendChild(row);
    });
  }

  dataTableWrap.addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    const item = entries.find(function (x) {
      return x.id === id;
    });
    if (!item) return;

    if (action === "delete") {
      if (!confirm("ลบข้อมูลคู่นี้?")) return;
      entries = entries.filter(function (x) {
        return x.id !== id;
      });
      if (editingId === id) resetForm();
      persist();
      render();
      syncDeleteEntry(id);
    } else if (action === "edit") {
      editingId = id;
      keywordInput.value = item.keyword;
      replyInput.value = item.reply;
      saveEntryBtn.textContent = "บันทึกการแก้ไข";
      keywordInput.focus();
    }
  });

  function resetForm() {
    editingId = null;
    keywordInput.value = "";
    replyInput.value = "";
    saveEntryBtn.textContent = "เพิ่ม";
  }

  dataForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const keyword = keywordInput.value.trim();
    const reply = replyInput.value.trim();
    if (!keyword || !reply) return;

    if (editingId) {
      const item = entries.find(function (x) {
        return x.id === editingId;
      });
      if (item) {
        item.keyword = keyword;
        item.reply = reply;
        persist();
        render();
        resetForm();
        syncPushEntry(item);
      }
    } else {
      const item = { id: uuid(), keyword: keyword, reply: reply };
      entries.push(item);
      persist();
      render();
      resetForm();
      syncPushEntry(item);
    }
  });

  render();
  syncEntriesOnLoad();
})();
