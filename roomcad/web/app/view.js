// Switching between the 2D plan and the 3D walkthrough, and drawing.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Mode switching


import { appState } from "./state.js";

import { inspectorContent, inspectorFocused, planCanvas, redoButton, safeHtml, statusHint, statusMessage, undoButton, walkHost } from "./ui.js";
import { furnitureSection, labelSection, openingSection, publicSection, roomSection, roomsToolSection, wallSection } from "./inspector.js";
import { renderLiveButton } from "./live.js";
import { Walk3D } from "../walk3d.js";
import { store, TOOL_HELP } from "../store.js";

/// The mode the DOM is actually showing. `store.mode` is the source of truth,
/// but two paths below it — store.newRoom() and store.loadRoom() — set it
/// directly, because they run in the model and know nothing about the view.
/// This is what lets the change handler notice and follow them.
let shownMode = "2d";

export function setMode(mode) {
  store.mode = mode;
  shownMode = mode;
  const is3d = mode === "3d";
  planCanvas.hidden = is3d;
  walkHost.hidden = !is3d;
  document.querySelectorAll(".plan-only").forEach(el => {
    el.style.display = is3d ? "none" : "";
  });
  if (is3d) {
    if (!appState.walk3d) appState.walk3d = new Walk3D(walkHost);
    else appState.walk3d.update(store.room);
  }
  // The 3D loop renders, steps physics and drives the whole traffic simulation
  // at 60 fps. None of it can be seen while the user is editing in 2D, so stop
  // it on the way out and start it again on the way back. `walk3d` is built
  // lazily on the first 3D entry, and pause()/resume() are optional methods, so
  // both the instance and each call are guarded.
  if (appState.walk3d) {
    if (is3d) {
      if (typeof appState.walk3d.resume === "function") appState.walk3d.resume();
    } else if (typeof appState.walk3d.pause === "function") {
      appState.walk3d.pause();
    }
  }
  renderToolbar();
  renderStatus();
  store.emit();
}

/// Follows `store.mode` when something below the UI changed it.
///
/// store.newRoom() and store.loadRoom() put the app back on the 2D plan
/// themselves, because they run in the model and know nothing about the view.
/// Left alone, New Room or Open… pressed while standing in the walkthrough
/// switched the model to 2D but left the 3D view on screen — and kept its
/// render loop, physics and traffic simulation running behind a plan the user
/// could not see. Returns true when it had to switch.
///
/// setMode() re-emits, but by then the two agree, so this settles in one pass.
export function syncMode() {
  if (store.mode === shownMode) return false;
  setMode(store.mode);
  return true;
}

// MARK: - Rendering

export function renderToolbar() {
  document.querySelectorAll("#mode-picker [data-mode]").forEach(b => {
    b.classList.toggle("active", store.mode === b.dataset.mode);
  });
  document.querySelectorAll("#grid-picker [data-grid]").forEach(b => {
    b.classList.toggle("active", store.room.grid === b.dataset.grid);
  });
  document.querySelectorAll("#toolbar [data-tool]").forEach(b => {
    b.classList.toggle("active", store.tool === b.dataset.tool);
  });
  document.querySelectorAll("#build-palette [data-tool]").forEach(b => {
    const active = b.dataset.tool === "light"
      ? (store.tool === "furniture" && (store.pendingFurnitureKind === "light" || store.pendingFurnitureKind === "lightPanel"))
      : store.tool === b.dataset.tool;
    b.classList.toggle("active", active);
  });
  document.querySelectorAll("#furniture-palette [data-kind]").forEach(b => {
    b.classList.toggle(
      "active",
      store.tool === "furniture" && store.pendingFurnitureKind === b.dataset.kind
    );
  });
  undoButton.disabled = !store.canUndo();
  redoButton.disabled = !store.canRedo();
  renderLiveButton();
}

export function renderStatus() {
  let extra = store.live ? " · Live" : (store.serverRoomName ? " · Shared" : "");
  if (store.serverRoomName && store.serverRoomVersion != null) extra += " · v" + store.serverRoomVersion;
  statusMessage.textContent = store.status + extra;
  statusHint.textContent = store.mode === "2d"
    ? TOOL_HELP[store.tool] + " · Drag empty space to pan"
    : "Click to look · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch · L lights · right-click: door swing";
}

export function renderInspector() {
  if (inspectorFocused()) return;
  if (store.selectedLabelID) {
    inspectorContent.innerHTML = safeHtml`${labelSection(store.selectedLabel())}`;
    return;
  }
  if (store.selectedPublicID) {
    inspectorContent.innerHTML = safeHtml`${publicSection(store.selectedPublicArea())}`;
    return;
  }
  if (store.tool === "rooms") {
    inspectorContent.innerHTML = safeHtml`${roomsToolSection()}`;
    return;
  }
  const kind = store.selectedOpeningKind();
  if (kind === "door" || kind === "window") {
    inspectorContent.innerHTML = safeHtml`${openingSection(kind)}`;
    return;
  }
  if (store.selectedWallID) {
    inspectorContent.innerHTML = safeHtml`${wallSection(store.selectedWall())}`;
    return;
  }
  if (store.selectedFurnitureID) {
    inspectorContent.innerHTML = safeHtml`${furnitureSection(store.selectedFurniture())}`;
    return;
  }
  inspectorContent.innerHTML = safeHtml`${roomSection()}`;
}
