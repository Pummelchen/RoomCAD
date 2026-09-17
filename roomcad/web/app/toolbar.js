// The toolbar buttons.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Toolbar


import { confirmDiscard, editor, redoButton, undoButton } from "./ui.js";
import { setMode } from "./view.js";
import { apiLogout } from "./api.js";
import { store } from "../store.js";

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
