// The inspector: what it shows, and what its controls do.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Inspector sections


import { appState } from "./state.js";

import { inspectorContent, safeMarkup } from "./ui.js";
import { renderInspector } from "./view.js";
import * as P from "../plan.js";
import { store, clockText } from "../store.js";

function field(name, control, value) {
  return safeMarkup`<div class="field"><label>${name}</label><div class="value-row">${control}<span class="readout">${P.cm(value)}</span></div></div>`;
}

function range(min, max, value, action) {
  const step = 0.01;
  return safeMarkup`<input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-action="${action}">`;
}

function statRow(name, value) {
  return safeMarkup`<div class="stat-row"><span>${name}</span><span>${value}</span></div>`;
}

export function openingSection(kind) {
  const title = kind === "door" ? "Door" : "Window";
  const opening = kind === "door" ? store.selectedDoor() : store.selectedWindow();
  const wall = store.selectedOpeningWall();
  const spacing = store.selectedOpeningSpacing();
  if (!opening || !wall) return roomSection();
  // From plan.js, not typed out again: the inspector slider and the model's own
  // clamp must agree, or the slider can be dragged to a width the editor then
  // refuses.
  const minW = kind === "door" ? P.MIN_OPENING_WIDTH.door : P.MIN_OPENING_WIDTH.window;
  const maxW = kind === "door" ? P.MAX_OPENING_WIDTH.door : P.MAX_OPENING_WIDTH.window;
  const maxOffset = Math.max(0.1, P.wallLength(wall) - opening.width - 0.1);
  let html = safeMarkup`<h4>${title}</h4>`;
  html = safeMarkup`${html}${field("Width", range(minW, maxW, opening.width.toFixed(2), "width"), opening.width)}`;
  html = safeMarkup`${html}${field("Position", range(0.1, maxOffset.toFixed(2), opening.offset.toFixed(2), "offset"), opening.offset)}`;
  if (spacing) {
    html = safeMarkup`${html}${statRow("From wall start", P.cm(spacing.toWallStart))}`;
    html = safeMarkup`${html}${statRow("From wall end", P.cm(spacing.toWallEnd))}`;
    if (spacing.gapToPrevious !== null) html = safeMarkup`${html}${statRow("Gap to neighbor", P.cm(spacing.gapToPrevious))}`;
    if (spacing.gapToNext !== null) html = safeMarkup`${html}${statRow("Gap to neighbor", P.cm(spacing.gapToNext))}`;
  }
  if (kind === "door") {
    html = safeMarkup`${html}<div class="field"><label>Open</label><button class="inspector-button" data-action="toggle-open">${opening.open ? "Close Door" : "Open Door"}</button></div>`;
    html = safeMarkup`${html}<div class="field"><label>Swing</label><div class="seg-row"><button class="seg-btn ${opening.swingInside ? "active" : ""}" data-action="swing-inside">Inside</button><button class="seg-btn ${!opening.swingInside ? "active" : ""}" data-action="swing-outside">Outside</button></div></div>`;
    // Which EDGE the hinge is on, which is a different question from which side
    // the door swings to: turned round, the leaf opens into the same room from
    // the other edge.
    html = safeMarkup`${html}<div class="field"><label>Hinge</label><div class="seg-row"><button class="seg-btn ${!opening.hingeAtEnd ? "active" : ""}" data-action="hinge-start">This side</button><button class="seg-btn ${opening.hingeAtEnd ? "active" : ""}" data-action="hinge-end">Other side</button></div><div class="hint">turn the door round without changing the room it opens into</div></div>`;
  }
  html = safeMarkup`${html}<button class="inspector-button danger" data-action="delete">Delete ${title}</button>`;
  return html;
}

export function wallSection(wall) {
  if (!wall) return roomSection();
  let html = safeMarkup`<h4>Wall</h4>`;
  html = safeMarkup`${html}${statRow("Length", P.cm(P.wallLength(wall)))}`;
  html = safeMarkup`${html}${statRow("From", wall.start.x.toFixed(2) + " m, " + wall.start.z.toFixed(2) + " m")}`;
  html = safeMarkup`${html}${statRow("To", wall.end.x.toFixed(2) + " m, " + wall.end.z.toFixed(2) + " m")}`;
  html = safeMarkup`${html}<button class="inspector-button danger" data-action="delete">Delete Wall</button>`;
  return html;
}

export function furnitureSection(item) {
  if (!item) return roomSection();
  const kind = P.FURNITURE_KINDS[item.kind];
  const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
  const w = swaps ? kind.d : kind.w;
  const d = swaps ? kind.w : kind.d;
  let html = safeMarkup`<h4>${kind.title}</h4>`;
  if (kind.category === "fixture") {
    html = safeMarkup`${html}<div class="inspector-note">Ceiling light — hangs from the ceiling.</div>`;
  } else {
    html = safeMarkup`${html}${statRow("Size", P.cm(w) + " × " + P.cm(d))}`;
    html = safeMarkup`${html}<button class="inspector-button" data-action="turn">Turn 90°</button>`;
  }
  html = safeMarkup`${html}<button class="inspector-button danger" data-action="delete">Delete ${kind.title}</button>`;
  return html;
}

export function labelSection(label) {
  if (!label) return roomSection();
  let html = safeMarkup`<h4>Label</h4>`;
  html = safeMarkup`${html}<div class="field"><label>Text</label><input type="text" data-action="label-text" value="${label.text}" maxlength="60" placeholder="Kitchen"></div>`;
  html = safeMarkup`${html}<div class="field"><label>Text size (cm)</label><div class="value-row"><input type="number" data-action="label-size" value="${Math.round(label.size * 100)}" min="8" max="100" step="1"><span class="readout">cap height</span></div></div>`;
  html = safeMarkup`${html}${statRow("Rotation", label.rotationDegrees + "°")}`;
  html = safeMarkup`${html}<button class="inspector-button" data-action="turn-label">Turn 90°</button>`;
  html = safeMarkup`${html}<button class="inspector-button danger" data-action="delete">Delete Label</button>`;
  return html;
}

export function publicSection(area) {
  if (!area) return roomSection();
  let html = safeMarkup`<h4>Public area</h4>`;
  html = safeMarkup`${html}${statRow("Width", P.cm(area.w))}`;
  html = safeMarkup`${html}${statRow("Length", P.cm(area.l))}`;
  html = safeMarkup`${html}${statRow("Area", (area.w * area.l).toFixed(2) + " m²")}`;
  html = safeMarkup`${html}<div class="inspector-note">Drag a red corner handle to resize it. Public areas are left untouched by the automatic room layout.</div>`;
  html = safeMarkup`${html}<button class="inspector-button danger" data-action="delete">Delete Public Area</button>`;
  return html;
}

export function roomsToolSection() {
  const rooms = store.selectedRooms();
  let html = safeMarkup`<h4>Rooms</h4>`;
  if (!store.roomSelection) {
    html = safeMarkup`${html}<div class="inspector-note">Drag a box across a row of rooms to select them. RoomCAD can then even out their sizes by sliding only the walls between them — the outside of the row stays exactly where it is.</div>`;
    return html;
  }
  if (rooms.length === 0) {
    html = safeMarkup`${html}<div class="inspector-note">No whole rooms in that box. Drag across the rooms themselves — a room counts when most of its floor is inside.</div>`;
    return html;
  }
  html = safeMarkup`${html}${statRow("Selected", rooms.length + (rooms.length === 1 ? " room" : " rooms"))}`;
  for (const r of rooms) {
    const w = r.bounds.maxX - r.bounds.minX;
    const l = r.bounds.maxZ - r.bounds.minZ;
    html = safeMarkup`${html}${statRow(P.cm(w) + " × " + P.cm(l), r.area.toFixed(2) + " m²")}`;
  }
  const check = P.roomRow(rooms);
  if (check.reason) {
    html = safeMarkup`${html}<div class="inspector-note">${check.reason}.</div>`;
  } else {
    const span = check.axis === "x"
      ? check.order[check.order.length - 1].bounds.maxX - check.order[0].bounds.minX
      : check.order[check.order.length - 1].bounds.maxZ - check.order[0].bounds.minZ;
    html = safeMarkup`${html}${statRow("Each would become", P.cm(span / rooms.length))}`;
    html = safeMarkup`${html}<button class="inspector-button" data-action="equalize-rooms">Make all the same size</button>`;
  }
  html = safeMarkup`${html}<button class="inspector-button" data-action="clear-room-selection">Clear selection</button>`;
  return html;
}

export function roomSection() {
  const room = store.room;
  // The floor actually enclosed by the walls — not width × length, which counts
  // the notch of an L-shaped plan as if it were inside.
  const area = P.floorArea(room).toFixed(2);
  const rooms = P.detectRooms(room).length;
  // detectRooms() may have refused the plan as too detailed. Say so, and say
  // what it means for the number above, rather than showing a bounding-box
  // measurement as if it were the enclosed floor.
  const detectionSkipped = P.roomDetectionSkipped();
  let html = safeMarkup`<h4>Room</h4>`;
  html = safeMarkup`${html}<div class="field"><label>Room Name</label><input type="text" data-action="rename" value="${room.name}"></div>`;
  // Size is measured from the walls, not typed. It used to be a pair of fields
  // that changed the number and moved nothing, so the label and the drawing
  // could disagree by metres. Resize by dragging a wall instead — outside walls
  // unlock from their right-click menu.
  html = safeMarkup`${html}<div class="field"><label>Overall size</label><div class="value-row"><span class="readout measured">${P.cm(room.width)} × ${P.cm(room.length)}</span></div><div class="hint">measured from the walls — drag a wall to resize</div></div>`;
  // Which walls face outwards is worked out from the plan, so a wall can lock
  // itself the moment the space beyond it opens up. This is the way out of
  // that for anyone who would rather just draw.
  html = safeMarkup`${html}<div class="field"><label>Outside walls free to drag <input type="checkbox" data-action="free-outside-walls" ${store.outsideWallsFree ? "checked" : ""}></label><div class="hint">${store.outsideWallsFree ? "every wall can be dragged" : "held still, so the footprint cannot move by accident"}</div></div>`;
  html = safeMarkup`${html}<div class="field"><label>Wall height (cm)</label><div class="value-row"><input type="number" data-action="height" value="${Math.round(room.height * 100)}" min="220" max="500" step="1"><span class="readout">= ${room.height.toFixed(2)} m</span></div></div>`;
  html = safeMarkup`${html}<div class="stat-row"><span>Floor area</span><span>${area} m²</span></div>`;
  if (rooms > 0) {
    html = safeMarkup`${html}<div class="stat-row"><span>Enclosed rooms</span><span>${rooms}</span></div>`;
  }
  if (detectionSkipped) {
    // Not a cosmetic warning: with no rooms detected, floor area above is the
    // bounding box rather than the enclosed floor, the room captions are gone,
    // and no wall can be told apart as an outside wall — so every wall is
    // draggable. The user needs to know why before they trust the number.
    html = safeMarkup`${html}<div class="inspector-note warn">This plan has too many walls for RoomCAD to work out the enclosed rooms, so the floor area above is the whole outline and the outer walls are not held in place. Move some walls onto common grid lines, or use the 5 cm grid, to bring it back.</div>`;
  }
  // Ceiling lights past what the walkthrough will light. Each one costs six
  // shadow renders, so the pool is capped and follows the viewer; the rest are
  // still drawn and still glow. Reported here rather than left to be discovered
  // as a lamp that does nothing. The walkthrough is built lazily on the first
  // 3D entry, so this says nothing until it has been opened once.
  const lightReport = appState.walk3d && typeof appState.walk3d.roomLightReport === "function"
    ? appState.walk3d.roomLightReport()
    : null;
  if (lightReport && lightReport.fixtures > lightReport.lit) {
    html = safeMarkup`${html}<div class="stat-row"><span>Ceiling lights</span><span>${lightReport.lit} of ${lightReport.fixtures} lit</span></div>`;
    html = safeMarkup`${html}<div class="inspector-note warn">RoomCAD lights the ${lightReport.lit} ceiling lights nearest you at a time, because each one costs six shadow renders. The others are drawn and glow, but light nothing — remove a few if the room is too dim.</div>`;
  }
  html = safeMarkup`${html}<div class="inspector-note">Tap a wall, door, window, or furniture to edit it. The grey area is just extra drawing space for more rooms.</div>`;
  html = safeMarkup`${html}<div class="inspector-sep"></div>`;
  html = safeMarkup`${html}<div class="floor-row"><label>Outside floor</label><div class="floor-control"><button class="inspector-button floor-btn" data-action="floor-down" title="Floor down">▼</button><span class="floor-value">Floor ${store.floor}</span><button class="inspector-button floor-btn" data-action="floor-up" title="Floor up">▲</button></div></div>`;
  html = safeMarkup`${html}<div class="inspector-sep"></div>`;
  html = safeMarkup`${html}<div class="field"><label>Canvas size (m)</label><div class="value-row"><input type="number" data-action="canvas-size" value="${P.canvasOf(room).width.toFixed(1)}" min="${Math.ceil(Math.max(room.width, room.length))}" max="60" step="0.5"><span class="readout">square</span></div></div>`;
  html = safeMarkup`${html}<div class="inspector-sep"></div>`;
  html = safeMarkup`${html}<div class="floor-row"><label>Time of day (24 h)</label><div class="floor-control"><button class="inspector-button floor-btn" data-action="time-down" title="Fifteen minutes earlier">&lt;</button><span class="floor-value">${clockText(store.timeOfDay)}</span><button class="inspector-button floor-btn" data-action="time-up" title="Fifteen minutes later">&gt;</button></div></div>`;
  // A slider as well as the arrows, because the interesting part of the day is
  // twenty minutes long: the sun drops through twilight faster than anything
  // else it does, and stepping the hour jumps straight over it.
  html = safeMarkup`${html}<div class="field"><div class="value-row"><input type="range" class="time-slider" data-action="time-set" min="0" max="1439" step="1" value="${Math.round(store.timeOfDay * 60)}" aria-label="Time of day, to the minute"></div></div>`;
  html = safeMarkup`${html}<div class="floor-row"><label>Weather</label><div class="floor-control"><button class="inspector-button floor-btn" data-action="weather-prev" title="Previous weather">&lt;</button><span class="floor-value">${store.weather.charAt(0).toUpperCase() + store.weather.slice(1)}</span><button class="inspector-button floor-btn" data-action="weather-next" title="Next weather">&gt;</button></div></div>`;
  html = safeMarkup`${html}<div class="inspector-sep"></div>`;
  html = safeMarkup`${html}<h4>Auto layout</h4>`;
  html = safeMarkup`${html}<div class="field"><label>Rooms</label><div class="value-row"><input type="number" data-action="layout-count" value="${store.layoutCount}" min="1" max="20" step="1"><span class="readout">rooms</span></div></div>`;
  html = safeMarkup`${html}<div class="field"><label>m² per room</label><div class="value-row"><input type="number" data-action="layout-area" value="${store.layoutArea}" min="2" max="200" step="0.5"><span class="readout">at least</span></div><div class="hint">decides how many rooms fit — they fill the floor you leave them</div></div>`;
  html = safeMarkup`${html}<div class="field"><label>Window in each room <input type="checkbox" data-action="layout-windows" ${store.layoutWindows ? "checked" : ""}></label></div>`;
  html = safeMarkup`${html}<div class="inspector-note">Mark the walking space — hall, landing, anywhere doors swing into — with the 🟩 Public tool. Generate builds the rooms around it and fills the rest; it never marks public floor itself. Each room gets one door; windows only go on outside walls.</div>`;
  html = safeMarkup`${html}<button class="inspector-button" data-action="layout-generate">Generate rooms</button>`;
  html = safeMarkup`${html}<button class="inspector-button" data-action="layout-redesign">Redesign (new layout)</button>`;
  return html;
}

// MARK: - Inspector events

inspectorContent.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.action === "time-set") {
    // Dragged, so it fires on every minute the handle passes: the whole point
    // is to watch the light change rather than to arrive at an hour.
    store.setTimeOfDay(Number(t.value) / 60);
    return;
  }
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
  } else if (t.dataset.action === "free-outside-walls") {
    store.setOutsideWallsFree(t.checked);
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
  } else if (t.dataset.action === "hinge-start" || t.dataset.action === "hinge-end") {
    const id = store.selectedDoorID;
    const wantEnd = t.dataset.action === "hinge-end";
    const door = id && store.room.doors.find(d => d.id === id);
    if (door && !!door.hingeAtEnd !== wantEnd) store.flipDoorHinge(id);
  } else if (t.dataset.action === "floor-up") {
    store.setFloor(1);
  } else if (t.dataset.action === "floor-down") {
    store.setFloor(-1);
  } else if (t.dataset.action === "time-up") {
    store.setTimeOfDay(store.timeOfDay + 0.25);
  } else if (t.dataset.action === "time-down") {
    store.setTimeOfDay(store.timeOfDay - 0.25);
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
