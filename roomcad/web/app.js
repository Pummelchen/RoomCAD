// app.js — UI wiring: toolbar, inspector, keyboard, files, and My Rooms.

import * as P from "./plan.js";
import { store, TOOL_HELP } from "./store.js";
import { Editor2D } from "./editor2d.js";
import { Walk3D } from "./walk3d.js";

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

const editor = new Editor2D(planCanvas);
let walk3d = null;

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
}

function renderStatus() {
  let extra = store.serverRoomName ? " · Shared live" : "";
  if (store.serverRoomName && store.serverRoomVersion) extra += " · v" + store.serverRoomVersion;
  statusMessage.textContent = store.status + extra;
  statusHint.textContent = store.mode === "2d"
    ? TOOL_HELP[store.tool] + " · Drag empty space to pan"
    : "Click to look · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch · L lights · right-click: door swing";
}

function renderInspector() {
  if (inspectorFocused()) return;
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
    html += `<div class="inspector-note">Ceiling fixture — mounted directly under the roof.</div>`;
  } else {
    html += statRow("Size", P.cm(w) + " × " + P.cm(d));
    html += `<button class="inspector-button" data-action="turn">Turn 90°</button>`;
  }
  html += `<button class="inspector-button danger" data-action="delete">Delete ${esc(kind.title)}</button>`;
  return html;
}

function roomSection() {
  const room = store.room;
  const canvas = P.canvasOf(room);
  let html = `<h4>Room</h4>`;
  html += `<div class="field"><label>Room Name</label>` +
    `<input type="text" data-action="rename" value="${esc(room.name)}"></div>`;
  html += `<div class="field"><label>Canvas width (m)</label>` +
    `<input type="number" data-action="canvas-w" value="${canvas.width.toFixed(2)}" min="2" max="60" step="0.1"></div>`;
  html += `<div class="field"><label>Canvas length (m)</label>` +
    `<input type="number" data-action="canvas-l" value="${canvas.length.toFixed(2)}" min="2" max="60" step="0.1"></div>`;
  html += `<div class="field"><label>Ceiling height (m)</label>` +
    `<input type="number" data-action="height" value="${room.height.toFixed(2)}" min="2.2" max="5" step="0.1"></div>`;
  html += `<div class="inspector-note">Select a wall, door, window, or furniture item to edit it. ` +
    `Resize the canvas to make room for more rooms; the grey plate stays in the 2D view only.</div>`;
  html += `<div class="floor-row">` +
    `<label>Outside floor</label>` +
    `<div class="floor-control">` +
    `<button class="inspector-button floor-btn" data-action="floor-down" title="Floor down">▼</button>` +
    `<span class="floor-value">Floor ${store.floor}</span>` +
    `<button class="inspector-button floor-btn" data-action="floor-up" title="Floor up">▲</button>` +
    `</div></div>`;
  return html;
}

// MARK: - Inspector events

inspectorContent.addEventListener("input", e => {
  const t = e.target;
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
  } else if (t.dataset.action === "canvas-w") {
    store.updateCanvasSize(Number(t.value), P.canvasOf(store.room).length);
  } else if (t.dataset.action === "canvas-l") {
    store.updateCanvasSize(P.canvasOf(store.room).width, Number(t.value));
  } else if (t.dataset.action === "height") {
    store.updateRoomHeight(Number(t.value));
  } else if (t.dataset.action === "width") {
    store.endDrag("Set width");
  } else if (t.dataset.action === "offset") {
    store.endDrag("Adjusted position");
  }
});

inspectorContent.addEventListener("click", e => {
  const t = e.target.closest("button[data-action]");
  if (!t) return;
  if (t.dataset.action === "turn") {
    store.rotateSelectedFurniture();
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
document.getElementById("fit").addEventListener("click", () => editor.fit());
document.getElementById("rotate-left").addEventListener("click", () => store.rotatePlan(-90));
document.getElementById("rotate-right").addEventListener("click", () => store.rotatePlan(90));

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
document.getElementById("open-close").addEventListener("click", () => {
  document.getElementById("open-modal").hidden = true;
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
async function apiListRooms() {
  const res = await fetch("/api/rooms");
  if (!res.ok) throw new Error("list failed");
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
  if (!res.ok) throw new Error("save failed");
  return res.json();
}

async function apiLoadRoom(name) {
  const res = await fetch("/api/load/" + encodeURIComponent(name));
  if (!res.ok) throw new Error("load failed");
  return res.json();
}

async function apiDeleteRoom(name) {
  const res = await fetch("/api/rooms/" + encodeURIComponent(name), { method: "DELETE" });
  if (!res.ok) throw new Error("delete failed");
  return res.json();
}

let eventSource = null;

/// Subscribes to live updates for a server room (Google-Docs style sharing).
function watchRoom(name) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  try {
    eventSource = new EventSource("/api/watch/" + encodeURIComponent(name));
    eventSource.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId === CLIENT_ID) return; // ignore our own echo
        const room = P.parseRoom(data.json);
        store.applyRemoteRoom(room, data.version);
      } catch {}
    };
  } catch {}
}

async function saveRoom() {
  try {
    // Update the existing server slot when the room was opened from the
    // server, otherwise create a new ternak_roomN (no duplicate copies).
    const result = await apiSaveRoom(P.serializeRoom(store.room), store.serverRoomName, CLIENT_ID);
    store.serverRoomName = result.name;
    store.serverRoomVersion = result.version;
    store.status = "Saved as " + result.name + " · v" + result.version;
    store.edited = false;
    store.emit();
    renderRooms();
    watchRoom(result.name);
  } catch {
    store.status = "Could not save to the server";
    store.emit();
  }
}

function openFileDialog() {
  fileInput.click();
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
      openStoredRoom(r.name);
    });
    li.appendChild(button);
    const remove = document.createElement("button");
    remove.className = "room-delete";
    remove.textContent = "✕";
    remove.title = "Delete this room";
    remove.addEventListener("click", e => {
      e.stopPropagation();
      if (!window.confirm("Delete " + r.name + "?\n\nThis removes the file from the server.")) return;
      removeStoredRoom(r.name);
      li.remove();
    });
    li.appendChild(remove);
    list.appendChild(li);
  }
  modal.hidden = false;
}

async function removeStoredRoom(name) {
  try { await apiDeleteRoom(name); } catch {}
  renderRooms();
}

async function openStoredRoom(name) {
  if (!confirmDiscard()) return;
  try {
    const data = await apiLoadRoom(name);
    const room = P.parseRoom(data.json);
    store.loadRoom(room, data.name, true);
    store.serverRoomVersion = data.version;
    watchRoom(data.name);
  } catch {
    window.alert("This saved room could not be opened.");
    removeStoredRoom(name);
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
    button.addEventListener("click", () => openStoredRoom(r.name));
    li.appendChild(button);
    const remove = document.createElement("button");
    remove.className = "room-delete";
    remove.textContent = "✕";
    remove.title = "Remove from this list";
    remove.addEventListener("click", e => {
      e.stopPropagation();
      removeStoredRoom(r.name);
    });
    li.appendChild(remove);
    roomsList.appendChild(li);
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
    case "KeyF":
      // Toggle the last used furniture kind on/off.
      if (store.tool === "furniture" && store.pendingFurnitureKind) {
        store.chooseTool("select");
      } else {
        store.beginFurniturePlacement(store.lastFurnitureKind || "bed");
      }
      break;
    case "KeyB":
    case "KeyR": store.rotateSelectedFurniture(); break;
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

// MARK: - Store change subscription

let autoSaveTimer = null;

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (store.serverRoomName && store.edited) saveRoom();
  }, 600);
}

store.onChange(() => {
  if (store.mode === "3d" && walk3d) walk3d.update(store.room);
  renderInspector();
  renderStatus();
  renderToolbar();
  renderRooms();
  document.title = (store.documentName || store.room.name)
    + (store.edited ? " · Edited" : "") + " — RoomCAD";
  // Live sharing: auto-push edits to the server room (debounced).
  if (store.serverRoomName && store.edited) scheduleAutoSave();
});

// MARK: - Init

renderInspector();
renderStatus();
renderToolbar();
renderRooms();
document.title = (store.documentName || store.room.name) + " — RoomCAD";
