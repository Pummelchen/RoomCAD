// login.js — a simple password gate. A successful login is remembered in a
// cookie so the same visitor skips the gate on their next visit.

const PASSWORD = "ternak";
const COOKIE_NAME = "roomcad_auth";

const screen = document.getElementById("login-screen");
const form = document.getElementById("login-form");
const input = document.getElementById("login-password");
const error = document.getElementById("login-error");

function isAuthed() {
  return document.cookie.split("; ").some(c => c.startsWith(COOKIE_NAME + "="));
}

function setAuthCookie() {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = COOKIE_NAME + "=1; expires=" + expires + "; path=/; SameSite=Lax";
}

if (isAuthed()) {
  screen.hidden = true;
} else {
  screen.hidden = false;
  input.focus();
}

form.addEventListener("submit", e => {
  e.preventDefault();
  if (input.value === PASSWORD) {
    setAuthCookie();
    screen.hidden = true;
  } else {
    error.textContent = "Wrong password.";
    error.hidden = false;
    input.select();
  }
});
