/* ==========================================================================
   auth.js — login page logic
   Fixed credentials, checked entirely client-side. This is a simple gate
   for a personal/private app, not a security system — anyone who can view
   the page source can see the check. Do not reuse this pattern for
   anything that needs real security.
   ========================================================================== */

(function () {
  // if already logged in, skip straight to the chat page
  if (localStorage.getItem(LS_KEYS.LOGGED_IN) === "1") {
    window.location.href = "ai.html";
    return;
  }

  const form = document.getElementById("loginForm");
  const userInput = document.getElementById("username");
  const passInput = document.getElementById("password");
  const errorText = document.getElementById("errorText");
  const loginBtn = document.getElementById("loginBtn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const u = userInput.value.trim();
    const p = passInput.value;

    if (u === FIXED_USERNAME && p === FIXED_PASSWORD) {
      errorText.textContent = "";
      loginBtn.disabled = true;
      loginBtn.textContent = "กำลังเข้าสู่ระบบ...";
      localStorage.setItem(LS_KEYS.LOGGED_IN, "1");
      window.location.href = "ai.html";
    } else {
      errorText.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
      passInput.value = "";
      passInput.focus();
    }
  });
})();
