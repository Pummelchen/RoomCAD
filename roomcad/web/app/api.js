// The server API, one function per endpoint.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Files and My Rooms (server-side)


import { announceRepairs, confirmDiscard, fileInput } from "./ui.js";
import { exportRoom, openFileDialog, openRoomModal, saveRoom } from "./files.js";
import { stopWatching } from "./watch.js";
import { resetLiveSequence } from "./status.js";
import * as P from "../plan.js";
import { store } from "../store.js";

// Leaving a server room — starting a new one, or opening a local file — has to
// close the live stream and forget its sequence. Otherwise the socket and a
// server watcher slot stay held for a room nobody is looking at, and the next
// edit is published against a sequence that room never reached.
function leaveServerRoom() {
  stopWatching();
  resetLiveSequence();
}

document.getElementById("new-room").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  leaveServerRoom();
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
      const repairs = {};
      const room = P.parseRoom(String(reader.result), repairs);
      if (!confirmDiscard()) { fileInput.value = ""; return; }
      leaveServerRoom();
      const name = file.name.replace(/\.(room|json|rcad)$/i, "");
      store.loadRoom(room, name);
      announceRepairs(repairs);
    } catch (err) {
      window.alert("Could not open " + file.name + ":\n" + err.message);
    }
    fileInput.value = "";
  };
  // A read can fail outright (a file that vanished, a permission the browser
  // refuses). Nothing else runs then, so without this the picker looked inert,
  // and its stale value meant re-selecting the same file need not fire change.
  reader.onerror = () => {
    window.alert("Could not read " + file.name + ":\n" +
      ((reader.error && reader.error.message) || "the file could not be read"));
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

export async function apiListRooms() {
  const res = await fetch("/api/rooms");
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiSaveRoom(json, name, clientId) {
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

export async function apiLoadRoom(name) {
  const res = await fetch("/api/load/" + encodeURIComponent(name));
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiLoadLastRoom() {
  const res = await fetch("/api/session/last");
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiRememberLastRoom(name, version) {
  const res = await fetch("/api/session/last", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, version }),
  });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiLoadRoomVersion(name, version) {
  const res = await fetch("/api/load/" + encodeURIComponent(name) + "?version=" + version);
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiVersions(name) {
  const res = await fetch("/api/versions/" + encodeURIComponent(name));
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiLogout() {
  const res = await fetch("/api/logout", { method: "POST" });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiDeleteRoom(name) {
  const res = await fetch("/api/rooms/" + encodeURIComponent(name), { method: "DELETE" });
  if (!res.ok) throw apiReject(res);
  return res.json();
}

export async function apiLiveDraft(json, name, clientId, version, baseSeq) {
  const res = await fetch("/api/live/" + encodeURIComponent(name), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json, clientId, version, baseSeq }),
  });
  if (!res.ok) throw apiReject(res);
  return res.json();
}
