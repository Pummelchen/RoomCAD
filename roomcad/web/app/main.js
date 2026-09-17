// What runs at startup.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Store change subscription


import { appState } from "./state.js";

import { renderInspector, renderStatus, renderToolbar, syncMode } from "./view.js";
import { renderRooms, resumeLastRoom } from "./files.js";
import { STATUS_INTERVAL_MS, runStatusPoll, scheduleLivePush, scheduleStatus, updateVersionBadge } from "./status.js";
import { store } from "../store.js";

store.onChange(() => {
  // store.newRoom() and store.loadRoom() put the app back on the 2D plan
  // themselves, without going through setMode() — follow them here.
  syncMode();
  if (store.mode === "3d" && appState.walk3d) {
    appState.walk3d.update(store.room);
    appState.walk3d.applyTimeOfDay();
  }
  renderInspector();
  renderStatus();
  renderToolbar();
  // Deliberately NOT renderRooms(): the sidebar only changes when a room is
  // saved, deleted or opened, and those call it directly. Refreshing here fired
  // an /api/rooms request for every selection, tool change and undo.
  document.title = (store.documentName || store.room.name)
    + (store.edited ? " · Edited" : "") + " — RoomCAD";
  // Live: push edits to teammates as drafts (no save, no version bump).
  if (store.live && store.serverRoomName && store.edited) scheduleLivePush();
});

// MARK: - Init

renderInspector();
renderStatus();
renderToolbar();
renderRooms();
document.title = (store.documentName || store.room.name) + " — RoomCAD";
updateVersionBadge();
runStatusPoll();
resumeLastRoom();
// Coming back to a backgrounded tab should show the truth immediately rather
// than after the next tick of whatever backoff it had drifted into.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    appState.statusBackoff = STATUS_INTERVAL_MS;
    scheduleStatus(0);
  }
});
