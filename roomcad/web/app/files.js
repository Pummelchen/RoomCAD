// Saving, downloading, exporting, and the My Rooms list and its dialogs.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.

import { announceRepairs, confirmDiscard, esc, fileInput, roomsList, toast } from "./ui.js";
import { apiDeleteRoom, apiListRooms, apiLoadLastRoom, apiLoadRoom, apiLoadRoomVersion, apiRememberLastRoom, apiSaveRoom, apiVersions } from "./api.js";
import { CLIENT_ID, liveDetached, watchRoom } from "./watch.js";
import * as P from "../plan.js";
import { roomToSVG } from "../svg.js";
import { store } from "../store.js";

export async function saveRoom({ watch = !liveDetached } = {}) {
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
    // The save result, not the verification result: the verification is a
    // SECOND request, and a save that stored the work but whose read-back failed
    // is still a save. Reporting `verified` here made leaveLiveMode refuse to
    // leave a session that had already been saved, so the user retried and
    // created a duplicate version.
    return { saved: true, verified };
  } catch {
    store.status = "Could not save to the server";
    store.emit();
    toast("Could not save — server not reachable", "error");
    btn.classList.remove("saving");
    return { saved: false, verified: false };
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

export function exportRoom(format = "rcad") {
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

export function openFileDialog() {
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
export async function openRoomModal() {
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
    const repairs = {};
    const room = P.parseRoom(data.json, repairs);
    store.loadRoom(room, data.name, true);
    store.serverRoomVersion = data.version;
    // announceRepairs() emits, so the repair sentence is on screen with the
    // version it belongs to.
    announceRepairs(repairs);
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

export async function renderRooms() {
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

export async function resumeLastRoom() {
  try {
    const data = await apiLoadLastRoom();
    if (!data || !data.name || !data.json || !Number.isInteger(data.version)) return;
    const repairs = {};
    const room = P.parseRoom(data.json, repairs);
    store.loadRoom(room, data.name, true);
    store.serverRoomVersion = data.version;
    store.status = (data.projectLatest ? "Opened latest project design " : "Resumed ")
      + data.name + " · v" + data.version;
    store.emit();
    // Emits only when it has something to add, so an untouched load is not
    // rendered twice.
    announceRepairs(repairs);
    watchRoom(data.name);
  } catch (err) {
    // No prior session or an offline server leaves the normal demo intact.
    // apiReject already reopens the sign-in screen for an expired session.
    if (err.message !== "unauthorized") console.warn("Could not resume last room:", err);
  }
}
