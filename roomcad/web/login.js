// login.js — a simple shared-password gate. The password itself is checked
// server-side (POST /api/login), which sets an HttpOnly session cookie; this
// script only drives the form and remembers the session via that cookie.

const screen = document.getElementById("login-screen");
const form = document.getElementById("login-form");
const input = document.getElementById("login-password");
const error = document.getElementById("login-error");

function showLogin() {
  screen.hidden = false;
  input.focus();
}

// Already logged in? The session cookie is HttpOnly, so ask the server.
fetch("/api/rooms")
  .then(res => {
    if (res.ok) screen.hidden = true;
    else showLogin();
  })
  .catch(showLogin);

form.addEventListener("submit", e => {
  e.preventDefault();
  const password = input.value;
  input.value = "";
  error.hidden = true;

  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
    .then(res => {
      if (res.ok) {
        // Cookie is set — reload so the app boots straight into the room list.
        location.reload();
      } else {
        error.textContent = "Wrong password.";
        error.hidden = false;
        input.select();
        input.focus();
      }
    })
    .catch(() => {
      error.textContent = "Could not reach the server.";
      error.hidden = false;
      input.select();
      input.focus();
    });
});
