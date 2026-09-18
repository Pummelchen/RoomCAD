// The keyboard.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Keyboard


import { inspectorFocused, isTyping } from "./ui.js";
import { togglePanel } from "./sidebar.js";
import { setMode } from "./view.js";
import { openFileDialog, saveRoom } from "./files.js";
import * as P from "../plan.js";
import { store } from "../store.js";

document.addEventListener("keydown", e => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = isTyping();

  // A text field owns its editing keys. ⌘Z, ⇧⌘Z and ⌘Y have to undo and redo
  // the text being typed rather than the drawing underneath it, so while the
  // focus is in one they are left to the browser. Saving and opening are
  // explicit app actions rather than text editing, so they keep working from
  // inside a field — as does every non-modified key below.
  if (mod) {
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      // The inspector writes a field back on `change`, which the browser fires
      // when the field loses focus. Saving is an app action that can be pressed
      // with the field still focused, so commit it first — otherwise the save
      // serialises the value from before the edit. Blurring is what commits it.
      const el = document.activeElement;
      if (inspectorFocused() && el && el.blur) el.blur();
      saveRoom();
      return;
    }
    if (key === "o") {
      e.preventDefault();
      openFileDialog();
      return;
    }
    if (typing) return;
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
    // One panel each, on the same key: the modifier says which side, the way
    // an editor hides its navigator and its inspector.
    if (key === "\\") {
      e.preventDefault();
      togglePanel(e.shiftKey ? "right" : "left");
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

  if (typing) return;

  // Everything below belongs to the 2D editor: choosing a tool, carrying and
  // turning furniture, deleting a selection, nudging it with the arrows. In 3D
  // those keys belong to the walkthrough — WASD and the arrows drive it — and
  // taking them also left the wrong tool armed when the user came back to 2D.
  // The app-wide shortcuts handled above (save, open, undo/redo, the mode
  // switch, the plan rotation and the panel toggles) deliberately still work in
  // either mode.
  if (store.mode !== "2d") return;

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
      // R turns whatever is in hand: the piece waiting to be placed first,
      // then a selected label, then selected furniture. A piece being carried
      // is the one you most want to turn and the only one that could not be.
      if (!store.rotatePendingFurniture() && !store.rotateSelectedLabel()) {
        store.rotateSelectedFurniture();
      }
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
      // The arrows are the walkthrough's in 3D, which the mode gate above
      // already takes care of.
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
