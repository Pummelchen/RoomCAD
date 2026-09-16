// The password gate.
//
// login.js is the only thing standing between the internet and the whole
// application, and until now nothing exercised it: it has no exports, it runs
// its session probe the moment it is imported, and it touches four DOM elements
// and fetch. A regression in it — a wrong error message, a password left in the
// input, a failed login that reloads anyway — would take the site down or leak
// something, and no test would notice.
//
// It is loaded for real, as a module, with the browser globals it expects faked
// and a fresh module instance per scenario (the probe runs at import time, so
// each case needs its own copy, the way live-multi.test.mjs does with store.js).
//
// Run:  node tests/login.test.mjs

import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const loginPath = join(here, "..", "roomcad", "web", "login.js");
const loginSrc = readFileSync(loginPath, "utf8");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// One fake form control, with just what login.js touches.
function makeElement(id) {
  const listeners = {};
  return {
    id, hidden: true, value: "", textContent: "",
    focused: 0, selected: 0,
    focus() { this.focused++; },
    select() { this.selected++; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type, event) { for (const fn of listeners[type] || []) fn(event); },
    hasListener: type => !!(listeners[type] || []).length,
  };
}

let instance = 0;

/// Loads a fresh login.js with the given answer for the session probe, and an
/// answer for the login POST.
async function loadLogin({ probe, login }) {
  const els = {
    "login-screen": makeElement("login-screen"),
    "login-form": makeElement("login-form"),
    "login-password": makeElement("login-password"),
    "login-error": makeElement("login-error"),
  };
  const calls = [];
  const reloads = [];


  globalThis.document = { getElementById: id => els[id] || null };
  globalThis.window = {};
  globalThis.location = { reload: () => reloads.push(calls.length) };
  globalThis.fetch = (url, opts) => {
    // What the input held at the moment the request went out — the password
    // must not still be sitting in the DOM while the round-trip is in flight.
    calls.push({ url, opts, inputAtCall: els["login-password"].value });
    const handler = url === "/api/login" ? login : probe;
    return handler ? handler(url, opts) : Promise.resolve({ ok: false });
  };

  // A fresh COPY at a fresh path, not a fresh query string.
  //
  // ESM caches by URL, and a different query on the same path is not enough
  // here: the module is evaluated once and every later import of it — whatever
  // the query — hands back the instance that already ran, so every scenario
  // would silently share the first one's probe result. A distinct path is a
  // distinct module. load-web-module.mjs writes its rewritten copies beside
  // this file for the same reason, and removes them again.
  const copy = join(here, "harness", `.under-test-login-${++instance}.mjs`);
  writeFileSync(copy, loginSrc);
  try {
    await import(pathToFileURL(copy).href);
  } finally {
    try { unlinkSync(copy); } catch { /* already gone */ }
  }
  // Let the import-time probe settle.
  await tick();
  return { els, calls, reloads, win: globalThis.window, settle: tick };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ok = () => Promise.resolve({ ok: true });
const denied = () => Promise.resolve({ ok: false });

// ── The session probe at load ─────────────────────────────────────────────
{
  // Already signed in: the form must NOT appear.
  const { els } = await loadLogin({ probe: ok });
  check("a live session leaves the login form hidden", els["login-screen"].hidden === true);
  check("and does not ask for a password", els["login-password"].focused === 0);
}
{
  // No session: the form appears and takes focus, so a returning user can type
  // straight away.
  const { els, calls } = await loadLogin({ probe: denied });
  check("no session shows the login form", els["login-screen"].hidden === false);
  check("and puts the cursor in the password field", els["login-password"].focused === 1);
  check("the probe asks the server rather than guessing",
    calls[0] && calls[0].url === "/api/rooms", calls[0] && calls[0].url);
}
{
  // The server is unreachable. Failing closed matters: a network error must ask
  // for the password, never assume the user is in.
  const { els } = await loadLogin({ probe: () => Promise.reject(new Error("offline")) });
  check("a failed probe shows the login form rather than assuming a session",
    els["login-screen"].hidden === false);
  check("and focuses the field", els["login-password"].focused === 1);
}

// ── The hook app.js uses when a call comes back 401 ───────────────────────
{
  const { win, els } = await loadLogin({ probe: ok });
  check("the 401 hook is published for app.js",
    typeof win.__roomcadShowLogin === "function");
  // It has to be the same routine the probe uses, not a second copy that could
  // drift: calling it shows the form exactly as an expired session does.
  win.__roomcadShowLogin();
  check("calling it re-shows the form and refocuses the field",
    els["login-screen"].hidden === false && els["login-password"].focused >= 1);
}

// ── Submitting ────────────────────────────────────────────────────────────
{
  const { els, calls, reloads, settle } = await loadLogin({ probe: denied, login: ok });
  els["login-password"].value = "letmein";
  let prevented = 0;
  els["login-form"].dispatch("submit", { preventDefault: () => { prevented++; } });
  await settle();

  check("submitting does not navigate the page", prevented === 1);
  const post = calls.find(c => c.url === "/api/login");
  check("the password is POSTed to /api/login", !!post, JSON.stringify(calls.map(c => c.url)));
  check("as a JSON body", post && post.opts && post.opts.method === "POST"
    && post.opts.headers["Content-Type"] === "application/json"
    && JSON.parse(post.opts.body).password === "letmein");
  check("the field is emptied before the request goes out, not after",
    post && post.inputAtCall === "", `held "${post && post.inputAtCall}"`);
  check("a correct password reloads into the app", reloads.length === 1);
}
{
  const { els, calls, reloads, settle } = await loadLogin({ probe: denied, login: denied });
  els["login-password"].value = "wrong";
  els["login-form"].dispatch("submit", { preventDefault: () => {} });
  await settle();

  check("a wrong password does NOT reload", reloads.length === 0);
  check("and says so", els["login-error"].textContent === "Wrong password."
    && els["login-error"].hidden === false, els["login-error"].textContent);
  check("the field is cleared and re-selected so it can be retyped",
    els["login-password"].value === "" && els["login-password"].selected === 1
    && els["login-password"].focused >= 1);
  check("the session probe is not mistaken for a failed login", calls.length >= 2);
}
{
  const { els, reloads, settle } = await loadLogin({
    probe: denied, login: () => Promise.reject(new Error("offline")),
  });
  els["login-password"].value = "letmein";
  els["login-form"].dispatch("submit", { preventDefault: () => {} });
  await settle();

  check("an unreachable server is reported separately from a wrong password",
    els["login-error"].textContent === "Could not reach the server.",
    els["login-error"].textContent);
  check("and does not reload either", reloads.length === 0);
  check("the field is re-selected", els["login-password"].selected === 1);
}
{
  // A previous failure's message must not linger over a successful attempt.
  const { els, settle } = await loadLogin({ probe: denied, login: ok });
  els["login-error"].hidden = false;
  els["login-error"].textContent = "Wrong password.";
  els["login-password"].value = "letmein";
  els["login-form"].dispatch("submit", { preventDefault: () => {} });
  check("the error is cleared as soon as a new attempt starts",
    els["login-error"].hidden === true);
  await settle();
}

// ── The form is actually wired ────────────────────────────────────────────
{
  const { els } = await loadLogin({ probe: ok });
  check("the submit handler is attached to the form", els["login-form"].hasListener("submit"));
}

console.log(`${passed} passed, ${failed} failed — the password gate`);
if (failed) process.exit(1);
