// app.js — UI wiring: toolbar, inspector, keyboard, files, and My Rooms.

import * as P from "./plan.js";
import { store, TOOL_HELP } from "./store.js";
import { Editor2D } from "./editor2d.js";
import { Walk3D } from "./walk3d.js";
import { APP_VERSION } from "./version.js";
import { roomToSVG } from "./svg.js";

// A per-tab identity so a client can ignore its own live-update echo.
const CLIENT_ID = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);

// MARK: - Element refs

const planCanvas = document.getElementById("plan-canvas");
const walkHost = document.getElementById("walk-host");
const inspectorContent = document.getElementById("inspector-content");
const statusMessage = document.getElementById("status-message");
const statusHint = document.getElementById("status-hint");
const roomsList = document.getElementById("rooms-list");
const fileInput = document.getElementById("file-input");
const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
const liveButton = document.getElementById("live-room");
const leaveLiveButton = document.getElementById("leave-live-room");
const appVersion = document.getElementById("app-version");
const main = document.getElementById("main");
const leftSidebarResizer = document.getElementById("left-sidebar-resizer");
const rightSidebarResizer = document.getElementById("right-sidebar-resizer");

const editor = new Editor2D(planCanvas);
let walk3d = null;

appVersion.textContent = "v" + APP_VERSION;

// MARK: - Helpers

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function inspectorFocused() {
  const el = document.activeElement;
  return !!el && !!el.closest && !!el.closest("#inspector");
}

function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function confirmDiscard() {
  return !store.edited || window.confirm(
    "Save changes to " + (store.documentName || store.room.name) + "?\n\nYour latest changes are not saved yet."
  );
}

// MARK: - Remembered sidebar widths

const SIDEBAR_LAYOUT_KEY = "roomcad.sidebar-layout.v1";
const LEFT_SIDEBAR_DEFAULT = 200;
const RIGHT_SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN_WIDTH = 140;
const CANVAS_MIN_WIDTH = 320;
const RESIZER_TOTAL_WIDTH = 16;

/// The panels are inset from the screen edge by --edge-gap, which is set in mm.
/// Measure it rather than assuming a pixel count, so the width budget below
/// always matches whatever the stylesheet says.
function measureEdgeGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:0;width:var(--edge-gap)";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}
let edgeGapPx = 0;

/// Everything between the two panels that is not drawing area: the resizers,
/// plus the inset on each side.
function chromeWidth() {
  return RESIZER_TOTAL_WIDTH + edgeGapPx * 2;
}

let sidebarWidths = loadSidebarWidths();

function validWidth(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function loadSidebarWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_LAYOUT_KEY) || "{}");
    return {
      left: validWidth(saved.left, LEFT_SIDEBAR_DEFAULT),
      right: validWidth(saved.right, RIGHT_SIDEBAR_DEFAULT),
    };
  } catch {
    return { left: LEFT_SIDEBAR_DEFAULT, right: RIGHT_SIDEBAR_DEFAULT };
  }
}

function saveSidebarWidths() {
  try {
    localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(sidebarWidths));
  } catch {
    // Private browsing can reject storage; resizing should still work now.
  }
}

function widthLimit(side) {
  const other = side === "left" ? sidebarWidths.right : sidebarWidths.left;
  return Math.max(SIDEBAR_MIN_WIDTH, main.clientWidth - other - CANVAS_MIN_WIDTH - chromeWidth());
}

function clampSidebarWidth(side, width) {
  return Math.round(Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), widthLimit(side)));
}

function applySidebarWidths({ persist = false } = {}) {
  sidebarWidths.left = clampSidebarWidth("left", sidebarWidths.left);
  sidebarWidths.right = clampSidebarWidth("right", sidebarWidths.right);

  // If the app is made very narrow, preserve a usable drawing area before
  // honoring a saved wide-panel layout.
  const available = main.clientWidth - CANVAS_MIN_WIDTH - chromeWidth();
  if (available >= SIDEBAR_MIN_WIDTH * 2 && sidebarWidths.left + sidebarWidths.right > available) {
    sidebarWidths.right = Math.max(SIDEBAR_MIN_WIDTH, available - sidebarWidths.left);
    sidebarWidths.left = Math.max(SIDEBAR_MIN_WIDTH, available - sidebarWidths.right);
  }

  document.documentElement.style.setProperty("--sidebar-width", sidebarWidths.left + "px");
  document.documentElement.style.setProperty("--inspector-width", sidebarWidths.right + "px");
  leftSidebarResizer.setAttribute("aria-valuemin", String(SIDEBAR_MIN_WIDTH));
  leftSidebarResizer.setAttribute("aria-valuemax", String(widthLimit("left")));
  leftSidebarResizer.setAttribute("aria-valuenow", String(sidebarWidths.left));
  rightSidebarResizer.setAttribute("aria-valuemin", String(SIDEBAR_MIN_WIDTH));
  rightSidebarResizer.setAttribute("aria-valuemax", String(widthLimit("right")));
  rightSidebarResizer.setAttribute("aria-valuenow", String(sidebarWidths.right));
  if (persist) saveSidebarWidths();
}

function installSidebarResizer(handle, side, defaultWidth) {
  let drag = null;

  handle.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    drag = { pointerID: e.pointerId, startX: e.clientX, startWidth: sidebarWidths[side] };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing-sidebars");
    e.preventDefault();
  });

  handle.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.pointerID) return;
    const delta = e.clientX - drag.startX;
    sidebarWidths[side] = clampSidebarWidth(side, drag.startWidth + (side === "left" ? delta : -delta));
    applySidebarWidths();
  });

  const finish = e => {
    if (!drag || e.pointerId !== drag.pointerID) return;
    drag = null;
    document.body.classList.remove("resizing-sidebars");
    applySidebarWidths({ persist: true });
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => {
    sidebarWidths[side] = defaultWidth;
    applySidebarWidths({ persist: true });
  });

  handle.addEventListener("keydown", e => {
    const amount = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const signed = e.key === "ArrowRight" ? amount : -amount;
      sidebarWidths[side] = clampSidebarWidth(side, sidebarWidths[side] + (side === "left" ? signed : -signed));
      applySidebarWidths({ persist: true });
      e.preventDefault();
    } else if (e.key === "Home") {
      sidebarWidths[side] = SIDEBAR_MIN_WIDTH;
      applySidebarWidths({ persist: true });
      e.preventDefault();
    } else if (e.key === "End") {
      sidebarWidths[side] = widthLimit(side);
      applySidebarWidths({ persist: true });
      e.preventDefault();
    }
  });
}

installSidebarResizer(leftSidebarResizer, "left", LEFT_SIDEBAR_DEFAULT);
installSidebarResizer(rightSidebarResizer, "right", RIGHT_SIDEBAR_DEFAULT);
edgeGapPx = measureEdgeGap();
applySidebarWidths();
window.addEventListener("resize", () => applySidebarWidths({ persist: true }));

// MARK: - Mode switching

function setMode(mode) {
  store.mode = mode;
  const is3d = mode === "3d";
  planCanvas.hidden = is3d;
  walkHost.hidden = !is3d;
  document.querySelectorAll(".plan-only").forEach(el => {
    el.style.display = is3d ? "none" : "";
  });
  if (is3d) {
    if (!walk3d) walk3d = new Walk3D(walkHost);
    else walk3d.update(store.room);
  }
  renderToolbar();
  renderStatus();
  store.emit();
}

// MARK: - Rendering

function renderToolbar() {
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

function renderStatus() {
  let extra = store.live ? " · Live" : (store.serverRoomName ? " · Shared" : "");
  if (store.serverRoomName && store.serverRoomVersion != null) extra += " · v" + store.serverRoomVersion;
  statusMessage.textContent = store.status + extra;
  statusHint.textContent = store.mode === "2d"
    ? TOOL_HELP[store.tool] + " · Drag empty space to pan"
    : "Click to look · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch · L lights · right-click: door swing";
}

function renderInspector() {
  if (inspectorFocused()) return;
  if (store.selectedLabelID) {
    inspectorContent.innerHTML = labelSection(store.selectedLabel());
    return;
  }
  if (store.selectedPublicID) {
    inspectorContent.innerHTML = publicSection(store.selectedPublicArea());
    return;
  }
  if (store.tool === "rooms") {
    inspectorContent.innerHTML = roomsToolSection();
    return;
  }
  const kind = store.selectedOpeningKind();
  if (kind === "door" || kind === "window") {
    inspectorContent.innerHTML = openingSection(kind);
    return;
  }
  if (store.selectedWallID) {
    inspectorContent.innerHTML = wallSection(store.selectedWall());
    return;
  }
  if (store.selectedFurnitureID) {
    inspectorContent.innerHTML = furnitureSection(store.selectedFurniture());
    return;
  }
  inspectorContent.innerHTML = roomSection();
}

// MARK: - Inspector sections

function field(name, control, value) {
  return `<div class="field"><label>${name}</label><div class="value-row">${control}` +
    `<span class="readout">${P.cm(value)}</span></div></div>`;
}

function range(min, max, value, action) {
  const step = 0.01;
  return `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-action="${action}">`;
}

function statRow(name, value) {
  return `<div class="stat-row"><span>${name}</span><span>${value}</span></div>`;
}

function openingSection(kind) {
  const title = kind === "door" ? "Door" : "Window";
  const opening = kind === "door" ? store.selectedDoor() : store.selectedWindow();
  const wall = store.selectedOpeningWall();
  const spacing = store.selectedOpeningSpacing();
  if (!opening || !wall) return roomSection();
  const minW = kind === "door" ? 0.6 : 0.4;
  const maxW = kind === "door" ? 1.4 : 2.0;
  const maxOffset = Math.max(0.1, P.wallLength(wall) - opening.width - 0.1);
  let html = `<h4>${title}</h4>`;
  html += field("Width", range(minW, maxW, opening.width.toFixed(2), "width"), opening.width);
  html += field("Position", range(0.1, maxOffset.toFixed(2), opening.offset.toFixed(2), "offset"), opening.offset);
  if (spacing) {
    html += statRow("From wall start", P.cm(spacing.toWallStart));
    html += statRow("From wall end", P.cm(spacing.toWallEnd));
    if (spacing.gapToPrevious !== null) html += statRow("Gap to neighbor", P.cm(spacing.gapToPrevious));
    if (spacing.gapToNext !== null) html += statRow("Gap to neighbor", P.cm(spacing.gapToNext));
  }
  if (kind === "door") {
    html += `<div class="field"><label>Open</label>` +
      `<button class="inspector-button" data-action="toggle-open">` +
      `${opening.open ? "Close Door" : "Open Door"}</button></div>`;
    html += `<div class="field"><label>Swing</label><div class="seg-row">` +
      `<button class="seg-btn ${opening.swingInside ? "active" : ""}" data-action="swing-inside">Inside</button>` +
      `<button class="seg-btn ${!opening.swingInside ? "active" : ""}" data-action="swing-outside">Outside</button>` +
      `</div></div>`;
  }
  html += `<button class="inspector-button danger" data-action="delete">Delete ${title}</button>`;
  return html;
}

function wallSection(wall) {
  if (!wall) return roomSection();
  let html = `<h4>Wall</h4>`;
  html += statRow("Length", P.cm(P.wallLength(wall)));
  html += statRow("From", wall.start.x.toFixed(2) + " m, " + wall.start.z.toFixed(2) + " m");
  html += statRow("To", wall.end.x.toFixed(2) + " m, " + wall.end.z.toFixed(2) + " m");
  html += `<button class="inspector-button danger" data-action="delete">Delete Wall</button>`;
  return html;
}

function furnitureSection(item) {
  if (!item) return roomSection();
  const kind = P.FURNITURE_KINDS[item.kind];
  const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
  const w = swaps ? kind.d : kind.w;
  const d = swaps ? kind.w : kind.d;
  let html = `<h4>${esc(kind.title)}</h4>`;
  if (kind.category === "fixture") {
    html += `<div class="inspector-note">Ceiling light — hangs from the ceiling.</div>`;
  } else {
    html += statRow("Size", P.cm(w) + " × " + P.cm(d));
    html += `<button class="inspector-button" data-action="turn">Turn 90°</button>`;
  }
  html += `<button class="inspector-button danger" data-action="delete">Delete ${esc(kind.title)}</button>`;
  return html;
}

function labelSection(label) {
  if (!label) return roomSection();
  let html = `<h4>Label</h4>`;
  html += `<div class="field"><label>Text</label>` +
    `<input type="text" data-action="label-text" value="${esc(label.text)}" maxlength="60" placeholder="Kitchen"></div>`;
  html += `<div class="field"><label>Text size (cm)</label><div class="value-row">` +
    `<input type="number" data-action="label-size" value="${Math.round(label.size * 100)}" min="8" max="100" step="1">` +
    `<span class="readout">cap height</span></div></div>`;
  html += statRow("Rotation", label.rotationDegrees + "°");
  html += `<button class="inspector-button" data-action="turn-label">Turn 90°</button>`;
  html += `<button class="inspector-button danger" data-action="delete">Delete Label</button>`;
  return html;
}

function publicSection(area) {
  if (!area) return roomSection();
  let html = `<h4>Public area</h4>`;
  html += statRow("Width", P.cm(area.w));
  html += statRow("Length", P.cm(area.l));
  html += statRow("Area", (area.w * area.l).toFixed(2) + " m²");
  html += `<div class="inspector-note">Drag a red corner handle to resize it. ` +
    `Public areas are left untouched by the automatic room layout.</div>`;
  html += `<button class="inspector-button danger" data-action="delete">Delete Public Area</button>`;
  return html;
}

function roomsToolSection() {
  const rooms = store.selectedRooms();
  let html = `<h4>Rooms</h4>`;
  if (!store.roomSelection) {
    html += `<div class="inspector-note">Drag a box across a row of rooms to select ` +
      `them. RoomCAD can then even out their sizes by sliding only the walls ` +
      `between them — the outside of the row stays exactly where it is.</div>`;
    return html;
  }
  if (rooms.length === 0) {
    html += `<div class="inspector-note">No whole rooms in that box. Drag across ` +
      `the rooms themselves — a room counts when most of its floor is inside.</div>`;
    return html;
  }
  html += statRow("Selected", rooms.length + (rooms.length === 1 ? " room" : " rooms"));
  for (const r of rooms) {
    const w = r.bounds.maxX - r.bounds.minX;
    const l = r.bounds.maxZ - r.bounds.minZ;
    html += statRow(P.cm(w) + " × " + P.cm(l), r.area.toFixed(2) + " m²");
  }
  const check = P.roomRow(rooms);
  if (check.reason) {
    html += `<div class="inspector-note">${esc(check.reason)}.</div>`;
  } else {
    const span = check.axis === "x"
      ? check.order[check.order.length - 1].bounds.maxX - check.order[0].bounds.minX
      : check.order[check.order.length - 1].bounds.maxZ - check.order[0].bounds.minZ;
    html += statRow("Each would become", P.cm(span / rooms.length));
    html += `<button class="inspector-button" data-action="equalize-rooms">Make all the same size</button>`;
  }
  html += `<button class="inspector-button" data-action="clear-room-selection">Clear selection</button>`;
  return html;
}

function roomSection() {
  const room = store.room;
  // The floor actually enclosed by the walls — not width × length, which counts
  // the notch of an L-shaped plan as if it were inside.
  const area = P.floorArea(room).toFixed(2);
  const rooms = P.detectRooms(room).length;
  let html = `<h4>Room</h4>`;
  html += `<div class="field"><label>Room Name</label>` +
    `<input type="text" data-action="rename" value="${esc(room.name)}"></div>`;
  // Size is measured from the walls, not typed. It used to be a pair of fields
  // that changed the number and moved nothing, so the label and the drawing
  // could disagree by metres. Resize by dragging a wall instead — outside walls
  // unlock from their right-click menu.
  html += `<div class="field"><label>Overall size</label>` +
    `<div class="value-row"><span class="readout measured">${P.cm(room.width)} × ${P.cm(room.length)}</span></div>` +
    `<div class="hint">measured from the walls — drag a wall to resize</div></div>`;
  html += `<div class="field"><label>Wall height (cm)</label><div class="value-row">` +
    `<input type="number" data-action="height" value="${Math.round(room.height * 100)}" min="220" max="500" step="1">` +
    `<span class="readout">= ${room.height.toFixed(2)} m</span></div></div>`;
  html += `<div class="stat-row"><span>Floor area</span><span>${area} m²</span></div>`;
  if (rooms > 0) {
    html += `<div class="stat-row"><span>Enclosed rooms</span><span>${rooms}</span></div>`;
  }
  html += `<div class="inspector-note">Tap a wall, door, window, or furniture to edit it. ` +
    `The grey area is just extra drawing space for more rooms.</div>`;
  html += `<div class="inspector-sep"></div>`;
  html += `<div class="floor-row">` +
    `<label>Outside floor</label>` +
    `<div class="floor-control">` +
    `<button class="inspector-button floor-btn" data-action="floor-down" title="Floor down">▼</button>` +
    `<span class="floor-value">Floor ${store.floor}</span>` +
    `<button class="inspector-button floor-btn" data-action="floor-up" title="Floor up">▲</button>` +
    `</div></div>`;
  html += `<div class="inspector-sep"></div>`;
  html += `<div class="field"><label>Canvas size (m)</label><div class="value-row">` +
    `<input type="number" data-action="canvas-size" value="${P.canvasOf(room).width.toFixed(1)}" min="${Math.ceil(Math.max(room.width, room.length))}" max="60" step="0.5">` +
    `<span class="readout">square</span></div></div>`;
  html += `<div class="inspector-sep"></div>`;
  html += `<div class="floor-row">` +
    `<label>Time of day (24 h)</label>` +
    `<div class="floor-control">` +
    `<button class="inspector-button floor-btn" data-action="time-down" title="Earlier hour">&lt;</button>` +
    `<span class="floor-value">${String((Math.round(store.timeOfDay) % 24 + 24) % 24).padStart(2, "0")}:00</span>` +
    `<button class="inspector-button floor-btn" data-action="time-up" title="Later hour">&gt;</button>` +
    `</div></div>`;
  html += `<div class="floor-row">` +
    `<label>Weather</label>` +
    `<div class="floor-control">` +
    `<button class="inspector-button floor-btn" data-action="weather-prev" title="Previous weather">&lt;</button>` +
    `<span class="floor-value">${store.weather.charAt(0).toUpperCase() + store.weather.slice(1)}</span>` +
    `<button class="inspector-button floor-btn" data-action="weather-next" title="Next weather">&gt;</button>` +
    `</div></div>`;
  html += `<div class="inspector-sep"></div>`;
  html += `<h4>Auto layout</h4>`;
  html += `<div class="field"><label>Rooms</label><div class="value-row">` +
    `<input type="number" data-action="layout-count" value="${store.layoutCount}" min="1" max="20" step="1">` +
    `<span class="readout">rooms</span></div></div>`;
  html += `<div class="field"><label>m² per room</label><div class="value-row">` +
    `<input type="number" data-action="layout-area" value="${store.layoutArea}" min="2" max="200" step="0.5">` +
    `<span class="readout">target</span></div></div>`;
  html += `<div class="field"><label>Window in each room ` +
    `<input type="checkbox" data-action="layout-windows" ${store.layoutWindows ? "checked" : ""}></label></div>`;
  html += `<div class="inspector-note">Mark shared (public) floor space with the 🟩 Public tool, then ` +
    `Generate partitions the rest into rooms. Each has one door; windows only go on outside walls.</div>`;
  html += `<button class="inspector-button" data-action="layout-generate">Generate rooms</button>`;
  html += `<button class="inspector-button" data-action="layout-redesign">Redesign (new layout)</button>`;
  return html;
}

// MARK: - Inspector events

inspectorContent.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.action === "label-text") {
    if (store.selectedLabelID) store.renameLabel(store.selectedLabelID, t.value);
    return;
  }
  if (t.dataset.action === "label-size") {
    if (store.selectedLabelID) store.setLabelSize(store.selectedLabelID, Number(t.value) / 100);
    return;
  }
  if (t.dataset.action === "width") {
    const kind = store.selectedOpeningKind();
    if (!kind) return;
    store.updateOpeningWidth(kind, Number(t.value));
    const readout = t.closest(".field").querySelector(".readout");
    if (readout) readout.textContent = P.cm(Number(t.value));
  } else if (t.dataset.action === "offset") {
    const kind = store.selectedOpeningKind();
    const id = kind === "door" ? store.selectedDoorID : store.selectedWindowID;
    if (!kind || !id) return;
    store.slideOpeningToOffset(kind, id, Number(t.value));
    const readout = t.closest(".field").querySelector(".readout");
    if (readout) readout.textContent = P.cm(Number(t.value));
  }
});

inspectorContent.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.action === "rename") {
    store.renameRoom(t.value);
  } else if (t.dataset.action === "height") {
    store.updateRoomHeight(Number(t.value) / 100);
  } else if (t.dataset.action === "canvas-size") {
    const s = Number(t.value);
    store.updateCanvasSize(s, s);
  } else if (t.dataset.action === "width") {
    store.endDrag("Set width");
  } else if (t.dataset.action === "offset") {
    store.endDrag("Adjusted position");
  } else if (t.dataset.action === "layout-count") {
    store.layoutCount = Math.max(1, Math.min(20, Math.round(Number(t.value))));
  } else if (t.dataset.action === "layout-area") {
    store.layoutArea = Math.max(2, Math.min(200, Number(t.value)));
  } else if (t.dataset.action === "layout-windows") {
    store.layoutWindows = t.checked;
  }
});

inspectorContent.addEventListener("click", e => {
  const t = e.target.closest("button[data-action]");
  if (!t) return;
  if (t.dataset.action === "turn") {
    store.rotateSelectedFurniture();
  } else if (t.dataset.action === "equalize-rooms") {
    store.equalizeSelectedRooms();
  } else if (t.dataset.action === "clear-room-selection") {
    store.roomSelection = null;
    store.status = "Selection cleared";
    store.emit();
  } else if (t.dataset.action === "turn-label") {
    store.rotateSelectedLabel();
  } else if (t.dataset.action === "delete") {
    store.deleteSelection();
  } else if (t.dataset.action === "toggle-open") {
    const id = store.selectedDoorID;
    if (id) store.toggleDoorOpen(id);
  } else if (t.dataset.action === "swing-inside") {
    const id = store.selectedDoorID;
    if (id) store.setDoorSwing(id, true);
  } else if (t.dataset.action === "swing-outside") {
    const id = store.selectedDoorID;
    if (id) store.setDoorSwing(id, false);
  } else if (t.dataset.action === "floor-up") {
    store.setFloor(1);
  } else if (t.dataset.action === "floor-down") {
    store.setFloor(-1);
  } else if (t.dataset.action === "time-up") {
    store.setTimeOfDay(store.timeOfDay + 1);
  } else if (t.dataset.action === "time-down") {
    store.setTimeOfDay(store.timeOfDay - 1);
  } else if (t.dataset.action === "weather-next") {
    store.stepWeather(1);
  } else if (t.dataset.action === "weather-prev") {
    store.stepWeather(-1);
  } else if (t.dataset.action === "layout-generate") {
    store.generateLayout({ count: store.layoutCount, area: store.layoutArea, windows: store.layoutWindows });
  } else if (t.dataset.action === "layout-redesign") {
    store.redesignLayout({ count: store.layoutCount, area: store.layoutArea, windows: store.layoutWindows });
  }
  // Blur the button so the inspector re-renders with the updated state.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  renderInspector();
});

// MARK: - Toolbar

document.querySelectorAll("#mode-picker [data-mode]").forEach(b => {
  b.addEventListener("click", () => setMode(b.dataset.mode));
});
document.querySelectorAll("#toolbar [data-tool]").forEach(b => {
  b.addEventListener("click", () => store.chooseTool(b.dataset.tool));
});
document.querySelectorAll("#grid-picker [data-grid]").forEach(b => {
  b.addEventListener("click", () => store.setGrid(b.dataset.grid));
});
undoButton.addEventListener("click", () => store.undo());
redoButton.addEventListener("click", () => store.redo());
document.getElementById("rotate-left").addEventListener("click", () => store.rotatePlan(-90));
document.getElementById("rotate-right").addEventListener("click", () => store.rotatePlan(90));

// Bottom-right zoom controls.
document.getElementById("zoom-out").addEventListener("click", () => editor.zoomStep(-10));
document.getElementById("zoom-in").addEventListener("click", () => editor.zoomStep(10));
document.getElementById("zoom-100").addEventListener("click", () => editor.zoomTo(100));
document.getElementById("zoom-200").addEventListener("click", () => editor.zoomTo(200));
document.getElementById("zoom-fit").addEventListener("click", () => editor.fit());

// Signing out. The session cookie lasts a year, so without this there is no way
// to end a login on a machine you do not own. Unsaved work is protected by the
// same guard as opening another room.
document.getElementById("sign-out").addEventListener("click", async () => {
  if (!confirmDiscard()) return;
  if (!window.confirm("Sign out of RoomCAD on this device?")) return;
  try {
    await apiLogout();
  } catch (err) {
    console.warn("Sign out failed:", err);
  }
  // Reload either way: if the cookie is gone the login gate returns, and if the
  // request failed the gate will reappear as soon as the next call is refused.
  location.reload();
});

// Build palette in the left sidebar: Wall / Door / Window go straight to their
// tool; Light opens a small choice between the 60 W bulb and the 200 W panel.
const lightButton = document.getElementById("light-button");
const lightMenu = document.getElementById("light-menu");
document.querySelectorAll("#build-palette [data-tool]").forEach(b => {
  b.addEventListener("click", () => {
    if (b.dataset.tool === "light") {
      lightMenu.hidden = !lightMenu.hidden;
    } else {
      lightMenu.hidden = true;
      store.chooseTool(b.dataset.tool);
    }
  });
});
lightMenu.querySelectorAll("[data-light-kind]").forEach(b => {
  b.addEventListener("click", () => {
    lightMenu.hidden = true;
    store.beginFurniturePlacement(b.dataset.lightKind);
  });
});
document.addEventListener("click", e => {
  if (!lightMenu.hidden && !lightButton.contains(e.target) && !lightMenu.contains(e.target)) {
    lightMenu.hidden = true;
  }
});

document.getElementById("furniture-palette").querySelectorAll("[data-kind]").forEach(b => {
  b.addEventListener("click", () => {
    const kind = b.dataset.kind;
    // Clicking the active icon again turns the placement off.
    if (store.tool === "furniture" && store.pendingFurnitureKind === kind) {
      store.chooseTool("select");
    } else {
      store.beginFurniturePlacement(kind);
    }
  });
});

// MARK: - Files and My Rooms (server-side)

document.getElementById("new-room").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  store.newRoom();
});
document.getElementById("save-room").addEventListener("click", saveRoom);
document.getElementById("open-room").addEventListener("click", openRoomModal);
const exportButton = document.getElementById("export-room");
const exportMenu = document.getElementById("export-menu");
exportButton.addEventListener("click", e => {
  exportMenu.hidden = !exportMenu.hidden;
  e.stopPropagation();
});
exportMenu.querySelectorAll("[data-export]").forEach(b => {
  b.addEventListener("click", () => {
    exportMenu.hidden = true;
    exportRoom(b.dataset.export);
  });
});
// Clicking anywhere else puts the menu away.
document.addEventListener("click", e => {
  if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportButton) {
    exportMenu.hidden = true;
  }
});
document.getElementById("live-room").addEventListener("click", toggleLive);
leaveLiveButton.addEventListener("click", leaveLiveMode);
document.getElementById("open-close").addEventListener("click", () => {
  document.getElementById("open-modal").hidden = true;
});
document.getElementById("version-close").addEventListener("click", () => {
  document.getElementById("version-modal").hidden = true;
});
document.getElementById("open-import").addEventListener("click", openFileDialog);
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const room = P.parseRoom(String(reader.result));
      if (!confirmDiscard()) { fileInput.value = ""; return; }
      const name = file.name.replace(/\.(room|json|rcad)$/i, "");
      store.loadRoom(room, name);
    } catch (err) {
      window.alert("Could not open " + file.name + ":\n" + err.message);
    }
    fileInput.value = "";
  };
  reader.readAsText(file);
});

// Rooms are saved on the webserver (not downloaded) as ternak_roomN.rcad.
function apiReject(res) {
  if (res.status === 401) {
    // Session expired — surface the login form (never auto-reload, which loops).
    if (window.__roomcadShowLogin) window.__roomcadShowLogin();
    return new Error("unauthorized");
  }
  return new Error("request failed (" + res.status + ")");
}

async function apiListRooms() {
  const res = await fetch("/api/rooms");
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiSaveRoom(json, name, clientId) {
  const body = { json, clientId };
  if (name) body.name = name;
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiLoadRoom(name) {
  const res = await fetch("/api/load/" + encodeURIComponent(name));
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiLoadLastRoom() {
  const res = await fetch("/api/session/last");
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiRememberLastRoom(name, version) {
  const res = await fetch("/api/session/last", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, version }),
  });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiLoadRoomVersion(name, version) {
  const res = await fetch("/api/load/" + encodeURIComponent(name) + "?version=" + version);
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiVersions(name) {
  const res = await fetch("/api/versions/" + encodeURIComponent(name));
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiLogout() {
  const res = await fetch("/api/logout", { method: "POST" });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiDeleteRoom(name) {
  const res = await fetch("/api/rooms/" + encodeURIComponent(name), { method: "DELETE" });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

async function apiLiveDraft(json, name, clientId, version) {
  const res = await fetch("/api/live/" + encodeURIComponent(name), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json, clientId, version }),
  });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

let eventSource = null;
let pendingLiveDraft = null;
let liveDetached = false;
let leavingLive = false;

function stopWatching({ detached = false } = {}) {
  if (eventSource) eventSource.close();
  eventSource = null;
  pendingLiveDraft = null;
  if (detached) liveDetached = true;
}

/// Subscribes to live updates for a server room (Google-Docs style sharing).
/// What an update from the watcher means for this client.
///
/// Pulled out of the event handler so it can be stated and tested on its own.
/// It is four lines of decision that decide whether a teammate's work appears
/// on your screen, and it was wrong in a way nobody could see: a live draft
/// carries the SENDER's version, and a receiver on any other version dropped it
/// silently. One save by either side and the two versions differ from then on,
/// so live editing worked right up until somebody saved and never again — which
/// is exactly when people start collaborating.
///
/// Returns { action, version }, where action is one of: "ignore", "hold"
/// (remember it in case they join), "live" (apply as a draft), "saved" (apply a
/// teammate's save). `version` is the version to adopt, or null to keep the one
/// we have.
///
/// The version is part of the answer rather than something the caller works out
/// for itself. It is the second half of the same bug — a draft that arrived but
/// left the version behind meant the audience could not see that we had moved
/// to v3 — and a caller that decides it separately is a second copy of the rule
/// that can disagree with this one.
export function liveUpdateAction(data, state) {
  const nothing = { action: "ignore", version: null };
  if (!data || data.name !== state.serverRoomName) return nothing;
  if (data.clientId === state.clientId) return nothing;    // our own echo
  if (state.dragTransactionActive) return nothing;         // never clobber a drag
  const version = data.version != null ? data.version : null;
  if (data.live) {
    // Not gated on the version. While live, the draft IS the shared state, and
    // whoever sent it is by definition further along than we are. It carries
    // the sender's version, and taking it is what keeps the two sides on one
    // baseline instead of drifting apart.
    return { action: state.live ? "live" : "hold", version };
  }
  // A real save from anyone. The watcher sends the current version on connect,
  // so the one we already have is a no-op rather than a teammate's update.
  if (data.version === state.serverRoomVersion) return nothing;
  return { action: "saved", version };
}

function watchRoom(name) {
  stopWatching();
  liveDetached = false;
  try {
    eventSource = new EventSource("/api/watch/" + encodeURIComponent(name));
    eventSource.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        const { action, version } = liveUpdateAction(data, {
          serverRoomName: store.serverRoomName,
          serverRoomVersion: store.serverRoomVersion,
          clientId: CLIENT_ID,
          live: store.live,
          dragTransactionActive: store.dragTransactionActive,
        });
        if (action === "ignore") return;
        const room = P.parseRoom(data.json);
        if (action === "hold") {
          // Remembered while the user considers joining, so Join Live adopts
          // the teammate's work instead of overwriting it.
          pendingLiveDraft = { room, version };
          return;
        }
        store.applyRemoteRoom(room, version);
      } catch (err) {
        console.warn("Live update ignored:", err);
      }
    };
  } catch (err) {
    console.warn("Live stream failed to open:", err);
  }
}

async function saveRoom({ watch = !liveDetached } = {}) {
  const btn = document.getElementById("save-room");
  btn.classList.remove("saved");
  btn.classList.add("saving");
  try {
    // The Room Name is the file name. Saving under a name that already exists
    // adds a version to it; saving under a new one starts a new file at v0.
    // That makes renaming a design and saving it a fork, which is what renaming
    // a file means everywhere else.
    const json = P.serializeRoom(store.room);
    const slug = P.roomSlug(store.room.name);
    const target = slug || store.serverRoomName || "";
    const forking = !!slug && !!store.serverRoomName && slug !== store.serverRoomName;
    const result = await apiSaveRoom(json, target, CLIENT_ID);

    // Verify the saved data is not corrupted by loading the new version back
    // and parsing it (also confirm the stored JSON round-trips unchanged).
    let verified = false;
    try {
      const data = await apiLoadRoomVersion(result.name, result.version);
      const room = P.parseRoom(data.json);
      verified = !!room && data.json === json;
    } catch {
      verified = false;
    }

    store.serverRoomName = result.name;
    store.serverRoomVersion = result.version;
    // The version is not repeated here: renderStatus already appends it, so
    // spelling it out again read as "Saved as Attic-Flat · v0 · Shared · v0".
    store.status = !verified
      ? "Saved, but the data could not be verified"
      : forking
        ? "Started " + result.name + " — the previous design is untouched"
        : "Saved as " + result.name;
    store.edited = false;
    store.emit();
    renderRooms();
    if (watch) watchRoom(result.name);

    btn.classList.remove("saving");
    if (verified) {
      btn.classList.add("saved");
      setTimeout(() => btn.classList.remove("saved"), 3000);
    }
    return verified;
  } catch {
    store.status = "Could not save to the server";
    store.emit();
    toast("Could not save — server not reachable", "error");
    btn.classList.remove("saving");
    return false;
  }
}

/// Exports the current room (canvas + walls + furniture) as a .rcad download.
/// The same `parseRoom` path is used on import, so the file round-trips.
/// Hands the browser a file to save.
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportBaseName() {
  // The Room Name is the file name — that is what saving uses to decide which
  // file it is writing, so it is what exporting has to use to decide which file
  // it is writing out. Preferring serverRoomName instead named every export
  // after the last design opened from the server, so drawing something new and
  // exporting it handed you a file named after somebody else's room.
  const slug = P.roomSlug(store.room.name);
  return (slug || store.serverRoomName || store.documentName || "room")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function exportRoom(format = "rcad") {
  const base = exportBaseName();
  if (format === "svg") {
    // A measured drawing rather than a picture of the screen: it prints to a
    // real architectural scale and opens in anything that reads vectors.
    const svg = roomToSVG(store.room, {
      date: new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    });
    download(base + ".svg", svg, "image/svg+xml");
    const scale = (svg.match(/1 : (\d+)/) || [])[1];
    store.status = "Exported " + base + ".svg" + (scale ? " · drawn at 1:" + scale : "");
    store.emit();
    return;
  }
  download(base + ".rcad", P.serializeRoom(store.room), "application/octet-stream");
  store.status = "Exported " + base + ".rcad";
  store.emit();
}

function openFileDialog() {
  fileInput.click();
}

/// Right-click context menu for a room entry (Open + Delete).
const roomContextMenu = document.getElementById("context-menu");

function showRoomContextMenu(x, y, name) {
  roomContextMenu.innerHTML = "";
  const head = document.createElement("div");
  head.className = "ctx-title";
  head.textContent = name;
  roomContextMenu.appendChild(head);
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", () => {
    hideRoomContextMenu();
    showVersionModal(name);
  });
  roomContextMenu.appendChild(openBtn);
  const delBtn = document.createElement("button");
  delBtn.className = "danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => {
    hideRoomContextMenu();
    if (!window.confirm("Delete " + name + "?\n\nThis removes the room from the server.")) return;
    removeStoredRoom(name);
  });
  roomContextMenu.appendChild(delBtn);
  roomContextMenu.hidden = false;
  const rect = roomContextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  roomContextMenu.style.left = Math.max(8, left) + "px";
  roomContextMenu.style.top = Math.max(8, top) + "px";
}

function hideRoomContextMenu() {
  if (roomContextMenu) roomContextMenu.hidden = true;
}

/// Lists the rooms stored on the server in a modal, click one to open it.
async function openRoomModal() {
  const modal = document.getElementById("open-modal");
  const list = document.getElementById("open-list");
  list.innerHTML = "";
  let rooms;
  try {
    rooms = await apiListRooms();
  } catch {
    list.innerHTML = '<li class="rooms-error">Server not reachable</li>';
    modal.hidden = false;
    toast("Server not reachable", "error");
    return;
  }
  const seen = new Set();
  for (const r of rooms) {
    if (seen.has(r.name)) continue; // avoid duplicates
    seen.add(r.name);
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.innerHTML = `<div class="room-name">${esc(r.name)}</div>` +
      `<div class="room-meta">v${r.version} · ${new Date(r.savedAt).toLocaleDateString()} · click to open</div>`;
    button.addEventListener("click", () => {
      modal.hidden = true;
      showVersionModal(r.name);
    });
    li.appendChild(button);
    li.addEventListener("contextmenu", e => {
      e.preventDefault();
      showRoomContextMenu(e.clientX, e.clientY, r.name);
    });
    list.appendChild(li);
  }
  modal.hidden = false;
}

async function removeStoredRoom(name) {
  try {
    await apiDeleteRoom(name);
  } catch (err) {
    console.warn("Delete room failed:", err);
  }
  renderRooms();
}

/// Asks which version of a room to open, then loads the chosen one. A room
/// with a single version opens straight away.
async function showVersionModal(name) {
  let versions;
  try {
    versions = await apiVersions(name);
  } catch {
    window.alert("Could not load the versions for " + name + ".");
    return;
  }
  if (!versions.length) {
    window.alert("This room has no saved versions.");
    return;
  }
  if (versions.length === 1) {
    openStoredRoom(name, versions[0].version);
    return;
  }
  const modal = document.getElementById("version-modal");
  const list = document.getElementById("version-list");
  document.getElementById("version-title").textContent = name + " — choose a version";
  list.innerHTML = "";
  for (const v of versions) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.innerHTML = `<div class="room-name">Version ${v.version}</div>` +
      `<div class="room-meta">${new Date(v.savedAt).toLocaleString()}</div>`;
    button.addEventListener("click", () => {
      modal.hidden = true;
      openStoredRoom(name, v.version);
    });
    li.appendChild(button);
    list.appendChild(li);
  }
  modal.hidden = false;
}

async function openStoredRoom(name, version) {
  if (!confirmDiscard()) return;
  try {
    const data = version != null
      ? await apiLoadRoomVersion(name, version)
      : await apiLoadRoom(name);
    const room = P.parseRoom(data.json);
    store.loadRoom(room, data.name, true);
    store.serverRoomVersion = data.version;
    watchRoom(data.name);
    // Persist the exact version the person selected. This is deliberately
    // server-side: a reload resumes it without browser-local storage.
    // Best effort: if this does not land the room still opened, the next
    // session just resumes somewhere else.
    apiRememberLastRoom(data.name, data.version)
      .catch(err => console.warn("Could not remember the open version:", err));
  } catch (err) {
    // NEVER delete here. This used to call removeStoredRoom(), which issues
    // DELETE /api/rooms/<name> and destroys the file and every version of it on
    // the server. Anything at all failing above — a dropped connection, a
    // momentary 500, an error thrown while applying the room — therefore wiped
    // the user's work permanently, with no confirmation and no undo. Opening a
    // room is a read; a read that fails must cost nothing.
    console.warn("Could not open saved room:", name, err);
    window.alert("This saved room could not be opened. It has been left untouched — try again.");
    renderRooms();   // refresh the list, in case it really is gone server-side
  }
}

let roomsRequestSeq = 0;

async function renderRooms() {
  const seq = ++roomsRequestSeq;
  let rooms;
  try {
    rooms = await apiListRooms();
  } catch {
    if (seq !== roomsRequestSeq) return; // a newer request superseded us
    roomsList.innerHTML = "";
    const li = document.createElement("li");
    li.className = "rooms-error";
    li.textContent = "Server not reachable";
    roomsList.appendChild(li);
    return;
  }
  if (seq !== roomsRequestSeq) return; // stale response, ignore it
  roomsList.innerHTML = "";
  const seen = new Set();
  for (const r of rooms) {
    if (seen.has(r.name)) continue; // avoid duplicates
    seen.add(r.name);
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.innerHTML = `<div class="room-name">${esc(r.name)}</div>` +
      `<div class="room-meta">v${r.version} · ${new Date(r.savedAt).toLocaleDateString()} · click to open</div>`;
    button.addEventListener("click", () => showVersionModal(r.name));
    li.appendChild(button);
    li.addEventListener("contextmenu", e => {
      e.preventDefault();
      showRoomContextMenu(e.clientX, e.clientY, r.name);
    });
    roomsList.appendChild(li);
  }
}

// MARK: - Resume the last server design

async function resumeLastRoom() {
  try {
    const data = await apiLoadLastRoom();
    if (!data || !data.name || !data.json || !Number.isInteger(data.version)) return;
    const room = P.parseRoom(data.json);
    store.loadRoom(room, data.name, true);
    store.serverRoomVersion = data.version;
    store.status = (data.projectLatest ? "Opened latest project design " : "Resumed ")
      + data.name + " · v" + data.version;
    watchRoom(data.name);
    store.emit();
  } catch (err) {
    // No prior session or an offline server leaves the normal demo intact.
    // apiReject already reopens the sign-in screen for an expired session.
    if (err.message !== "unauthorized") console.warn("Could not resume last room:", err);
  }
}

// MARK: - Keyboard

document.addEventListener("keydown", e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (key === "y") {
      e.preventDefault();
      store.redo();
      return;
    }
    if (key === "s") {
      e.preventDefault();
      saveRoom();
      return;
    }
    if (key === "o") {
      e.preventDefault();
      openFileDialog();
      return;
    }
    if (key === "1") {
      e.preventDefault();
      setMode("2d");
      return;
    }
    if (key === "2") {
      e.preventDefault();
      setMode("3d");
      return;
    }
    if (key === "[") {
      e.preventDefault();
      store.rotatePlan(-90);
      return;
    }
    if (key === "]") {
      e.preventDefault();
      store.rotatePlan(90);
      return;
    }
    return;
  }

  if (isTyping()) return;

  switch (e.code) {
    case "KeyV": store.chooseTool("select"); break;
    case "KeyW": store.chooseTool("wall"); break;
    case "KeyD": store.chooseTool("door"); break;
    case "KeyG": store.chooseTool("window"); break;
    case "KeyE": store.chooseTool("erase"); break;
    case "KeyM": store.chooseTool("measure"); break;
    case "KeyT": store.chooseTool("label"); break;
    case "KeyY": store.chooseTool("rooms"); break;
    case "KeyF":
      // Toggle the last used furniture kind on/off.
      if (store.tool === "furniture" && store.pendingFurnitureKind) {
        store.chooseTool("select");
      } else {
        store.beginFurniturePlacement(store.lastFurnitureKind || "bed");
      }
      break;
    case "KeyB":
    case "KeyR":
      // R turns whichever kind of thing is selected.
      if (!store.rotateSelectedLabel()) store.rotateSelectedFurniture();
      break;
    case "Delete":
    case "Backspace": store.deleteSelection(); break;
    case "Escape":
      store.cancelPlacement();
      break;
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
      // In 3D the arrows belong to the walkthrough.
      if (store.mode !== "2d") return;
      {
        const step = P.GRID_STEPS[store.room.grid].meters;
        const dx = e.code === "ArrowLeft" ? -step : e.code === "ArrowRight" ? step : 0;
        const dz = e.code === "ArrowUp" ? -step : e.code === "ArrowDown" ? step : 0;
        store.nudgeSelectedFurniture(dx, dz);
      }
      break;
    default:
      return;
  }
  e.preventDefault();
});

// MARK: - Live collaboration (unsaved, real-time sharing)

function renderLiveButton() {
  const teammatePresent = store.presenceCount > 1;
  const canJoin = teammatePresent && !!store.serverRoomName;
  liveButton.hidden = !store.live && !canJoin;
  leaveLiveButton.hidden = !store.live;
  liveButton.disabled = leavingLive || store.live;
  leaveLiveButton.disabled = leavingLive;
  liveButton.classList.toggle("join-live", !store.live && canJoin);
  liveButton.classList.toggle("live-on", store.live);
  liveButton.textContent = store.live ? "Live Active" : "Join Live";
}

function toggleLive() {
  if (store.live || leavingLive) return;
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
  if (pendingLiveDraft) {
    const draft = pendingLiveDraft;
    pendingLiveDraft = null;
    store.applyRemoteRoom(draft.room, null);
  }
  store.status = "Live Active — changes now sync for everyone";
  store.emit();
}

async function leaveLiveMode() {
  if (!store.live || leavingLive) return;
  leavingLive = true;
  renderLiveButton();
  const saved = await saveRoom({ watch: false });
  leavingLive = false;
  if (!saved) {
    store.status = "Could not save for everyone — still in Live Active";
    store.emit();
    return;
  }
  store.live = false;
  stopWatching({ detached: true });
  store.status = "Saved for everyone · left Live Mode · working on your own";
  store.emit();
}

// MARK: - Server status (presence + latency), polled every 3 s

function updateVersionBadge() {
  let html = "v" + APP_VERSION;
  if (store.serverLatency != null) {
    const ms = store.serverLatency;
    const cls = ms < 150 ? "lat-green" : ms < 400 ? "lat-orange" : "lat-red";
    html += ` · <span class="latency-dot ${cls}"></span> Server ${ms}ms`;
  } else if (store.serverOffline) {
    html += ` · <span class="latency-dot lat-red"></span> offline`;
  }
  appVersion.innerHTML = html;
}

// The status poll reschedules itself from the moment the previous one FINISHES.
// On a plain setInterval an await that outlives the interval lets the next poll
// start anyway, so a server that has become slow — exactly when this matters —
// collects a growing pile of overlapping requests from every open tab and gets
// slower still. Backing off while the server is unreachable also keeps a
// restart from being met with a request storm from every client at once.
//
// Polling deliberately continues in a hidden tab: the server counts a client as
// present from its requests, so pausing would drop people out of the
// collaborator count whenever they switched tabs. Browsers already throttle
// background timers, which is the right amount of restraint here.
const STATUS_INTERVAL_MS = 3000;
const STATUS_BACKOFF_MAX_MS = 30000;
let statusTimer = null;
let statusBackoff = STATUS_INTERVAL_MS;

function scheduleStatus(delay) {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(runStatusPoll, delay);
}

async function runStatusPoll() {
  statusTimer = null;
  const offline = await pollStatus();
  statusBackoff = offline
    ? Math.min(statusBackoff * 2, STATUS_BACKOFF_MAX_MS)
    : STATUS_INTERVAL_MS;
  scheduleStatus(statusBackoff);
}

/// Polls the server once. Resolves true if the server could not be reached.
async function pollStatus() {
  const t0 = performance.now();
  try {
    const res = await fetch("/api/status");
    const ms = Math.round(performance.now() - t0);
    if (res.status === 401) {
      if (window.__roomcadShowLogin) window.__roomcadShowLogin();
      return false;
    }
    const data = await res.json();
    store.presenceCount = data.count || 1;
    store.serverLatency = ms;
    store.serverOffline = false;
  } catch {
    store.serverLatency = null;
    store.serverOffline = true;
    updateVersionBadge();
    renderLiveButton();
    return true;
  }
  updateVersionBadge();
  renderLiveButton();
  return false;
}

let livePushTimer = null;

function scheduleLivePush() {
  if (livePushTimer) clearTimeout(livePushTimer);
  livePushTimer = setTimeout(() => {
    livePushTimer = null;
    pushLiveDraft();
  }, 150);
}

function pushLiveDraft() {
  if (!store.live || !store.serverRoomName) return;
  apiLiveDraft(P.serializeRoom(store.room), store.serverRoomName, CLIENT_ID, store.serverRoomVersion)
    .catch(() => {
      store.status = "Live: could not reach the server";
      store.emit();
      toast("Live sync lost — reconnecting…", "error");
    });
}

// MARK: - Store change subscription

store.onChange(() => {
  if (store.mode === "3d" && walk3d) {
    walk3d.update(store.room);
    walk3d.applyTimeOfDay();
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

// MARK: - Toast notifications (thin, transient error/info UX)

const toastEl = document.getElementById("toast");
let toastTimer = null;

function toast(message, kind = "info") {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = "show " + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "";
  }, 3200);
}

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
    statusBackoff = STATUS_INTERVAL_MS;
    scheduleStatus(0);
  }
});
