(() => {
  "use strict";

  const sessionKey = "techmart.api.session";
  const form = document.querySelector("#login-form");
  const email = document.querySelector("#email");
  const password = document.querySelector("#password");
  const remember = document.querySelector("#remember-device");
  const message = document.querySelector("#login-message");
  const submit = document.querySelector("#submit-button");
  const toggle = document.querySelector("#password-toggle");

  toggle.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    toggle.textContent = visible ? "Hide" : "Show";
    toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(visible));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    if (!form.reportValidity()) return;
    submit.disabled = true;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim().toLowerCase(), password: password.value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Sign-in failed.");
      const session = { ...payload.data.user, token: payload.data.token };
      localStorage.removeItem(sessionKey);
      sessionStorage.removeItem(sessionKey);
      (remember.checked ? localStorage : sessionStorage).setItem(sessionKey, JSON.stringify(session));
      window.location.href = "/#dashboard";
    } catch (error) {
      message.textContent = error.message || "Could not reach the TechMart API. Try again.";
      message.classList.add("error");
      message.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();
