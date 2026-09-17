// Element handles, the small DOM helpers, and what the app says to the user.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Element refs


import { appState } from "./state.js";

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

export function inspectorFocused() {
  const el = document.activeElement;
  return !!el && !!el.closest && !!el.closest("#inspector");
}

export function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function confirmDiscard() {
  return !store.edited || window.confirm(
    "Save changes to " + (store.documentName || store.room.name) + "?\n\nYour latest changes are not saved yet."
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
export function announceRepairs(report) {
  if (!report || P.reportIsEmpty(report)) return;
  const said = P.describeReport(report);
  store.status = (store.status ? store.status + " · " : "") + "with repairs: " + said;
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
