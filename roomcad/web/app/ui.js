// Element handles, the small DOM helpers, and what the app says to the user.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Element refs


import * as P from "../plan.js";
import { Editor2D } from "../editor2d.js";
import { APP_VERSION } from "../version.js";
import { store } from "../store.js";

export const planCanvas = document.getElementById("plan-canvas");
export const walkHost = document.getElementById("walk-host");
export const inspectorContent = document.getElementById("inspector-content");
export const statusMessage = document.getElementById("status-message");
export const statusHint = document.getElementById("status-hint");
export const roomsList = document.getElementById("rooms-list");
export const fileInput = document.getElementById("file-input");
export const undoButton = document.getElementById("undo");
export const redoButton = document.getElementById("redo");
export const liveButton = document.getElementById("live-room");
export const leaveLiveButton = document.getElementById("leave-live-room");
export const appVersion = document.getElementById("app-version");
export const main = document.getElementById("main");
export const leftSidebarResizer = document.getElementById("left-sidebar-resizer");
export const rightSidebarResizer = document.getElementById("right-sidebar-resizer");
export const toggleSidebarButton = document.getElementById("toggle-sidebar");
export const toggleInspectorButton = document.getElementById("toggle-inspector");

export const editor = new Editor2D(planCanvas);

appVersion.textContent = "v" + APP_VERSION;

// MARK: - Helpers

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// The marker a `safeMarkup` value carries, so a builder's output can be
// interpolated into another builder without being escaped a second time.
const SAFE = Symbol("roomcad.safeHtml");

/// Marks app-built markup as safe to insert. Returns a small tagged value.
///
/// Every `${value}` is escaped with `esc()` unless it is itself a `safeMarkup`
/// value, in which case its `html` passes through unchanged. That is what lets
/// `statRow()`/`field()`/a whole section compose: one builder's marked result is
/// trusted by the next, while a room name or a teammate's label — a raw string
/// from outside the app — is escaped exactly once. Literal text between
/// interpolations passes through untouched.
///
/// Prefer this over `safeHtml` for anything another builder interpolates: the
/// marker is what keeps the escaping from happening twice.
export function safeMarkup(strings, ...values) {
  let html = "";
  strings.forEach((part, i) => {
    html += part;
    if (i >= values.length) return;
    const value = values[i];
    html += value && value[SAFE] ? value.html : esc(value);
  });
  return { [SAFE]: true, html };
}

/// The tag used at every `innerHTML` assignment. Returns a PRIMITIVE string, so
/// the DOM stub and `String.prototype` methods keep working exactly as they did
/// on a hand-built template literal.
export function safeHtml(strings, ...values) {
  return safeMarkup(strings, ...values).html;
}

export function inspectorFocused() {
  const el = document.activeElement;
  return !!el && !!el.closest && !!el.closest("#inspector");
}

export function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function confirmDiscard() {
  // OK discards — every caller destroys the edits and none of them saves. The
  // question used to say "Save changes?", so the button that did the opposite
  // read as the safe one. Ask what OK actually does.
  return !store.edited || window.confirm(
    "Discard unsaved changes to " + (store.documentName || store.room.name) + "?\n\n" +
    "They have not been saved and this cannot be undone."
  );
}

// MARK: - Toast notifications (thin, transient error/info UX)

const toastEl = document.getElementById("toast");
let toastTimer = null;

/// Says what opening a document had to repair, if there was anything.
///
/// `sanitize()` used to do this in silence, so a plan that lost a wall opened
/// looking whole and the user went on to build on it, save it and print it
/// without ever being told. The document still opens — that is the point of the
/// repair pass — but it opens SAYING what it cost.
///
/// Only a DROP gets a toast. A wall that is gone changes what the user has; a
/// joint that was healed, or a coordinate nudged into the plate, is invisible
/// either way and does not deserve to interrupt anyone. Both go in the status
/// line, because "it opened" and "it opened unchanged" are different facts.
///
/// Emits, because the status has to reach the screen: the load paths set their
/// own status and called this after their last emit, so the sentence sat in
/// store.status while the page showed the line from before it — the exact "it
/// opened looking whole" failure this exists to end. `store.emit()` runs its
/// listeners synchronously and none of them comes back here, so this cannot
/// re-enter or loop.
export function announceRepairs(report) {
  if (!report || P.reportIsEmpty(report)) return;
  const said = P.describeReport(report);
  store.status = (store.status ? store.status + " · " : "") + "with repairs: " + said;
  store.emit();
  if (report.dropped.length) toast("Opened with repairs — " + said, "warn");
}

export function toast(message, kind = "info") {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = "show " + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "";
  }, 3200);
}
