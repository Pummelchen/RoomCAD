// Joining and leaving a live session.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Live collaboration (unsaved, real-time sharing)


import { appState } from "./state.js";

import { leaveLiveButton, liveButton } from "./ui.js";
import { eventSource, liveDetached, stopWatching, watchRoom } from "./watch.js";
import { saveRoom } from "./files.js";
import { startLiveSync, stopLiveSync } from "./status.js";
import { store } from "../store.js";

// Bound here rather than with the other toolbar buttons: these two handlers are
// declared in this section, and a listener needs its function at registration
// time — so binding them from a section that is evaluated earlier would need this
// one evaluated first, which is how a split turns into a reordering.
document.getElementById("live-room").addEventListener("click", toggleLive);
leaveLiveButton.addEventListener("click", leaveLiveMode);

export function renderLiveButton() {
  const teammatePresent = store.presenceCount > 1;
  const canJoin = teammatePresent && !!store.serverRoomName;
  liveButton.hidden = !store.live && !canJoin;
  leaveLiveButton.hidden = !store.live;
  liveButton.disabled = appState.leavingLive || store.live;
  leaveLiveButton.disabled = appState.leavingLive;
  liveButton.classList.toggle("join-live", !store.live && canJoin);
  liveButton.classList.toggle("live-on", store.live);
  liveButton.textContent = store.live ? "Live Active" : "Join Live";
}

function toggleLive() {
  if (store.live || appState.leavingLive) return;
  if (!store.serverRoomName) {
    store.status = "Save or open a room from the server first, then Join Live";
    store.emit();
    return;
  }
  if (store.edited) {
    store.status = "Save your local changes before joining Live";
    store.emit();
    return;
  }
  if (liveDetached || !eventSource) watchRoom(store.serverRoomName);
  store.live = true;
  if (appState.pendingLiveDraft) {
    const draft = appState.pendingLiveDraft;
    appState.pendingLiveDraft = null;
    store.applyRemoteRoom(draft.room, null);
  }
  startLiveSync();
  store.status = "Live Active — changes now sync for everyone";
  store.emit();
}

async function leaveLiveMode() {
  if (!store.live || appState.leavingLive) return;
  appState.leavingLive = true;
  renderLiveButton();
  const saved = await saveRoom({ watch: false });
  appState.leavingLive = false;
  if (!saved) {
    store.status = "Could not save for everyone — still in Live Active";
    store.emit();
    return;
  }
  store.live = false;
  stopLiveSync();
  stopWatching({ detached: true });
  store.status = "Saved for everyone · left Live Mode · working on your own";
  store.emit();
}
