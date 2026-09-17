// Editor2D's menu methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";

export const menu = {

  // MARK: Context menu (right-click)

  onContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const p = this.plan(c);

    // Only show a menu when there is something to act on under the cursor.
    const hit = P.labelNear(store.room, p)
      || P.furnitureNear(store.room, p)
      || P.openingNear(store.room, p)
      || P.wallNear(store.room, p)
      || P.publicAreaAt(store.room, p);
    if (!hit) {
      this.hideContextMenu();
      return;
    }
    store.select(p);
    this.showContextMenu(e.clientX, e.clientY);
  },

  showContextMenu(x, y) {
    if (!this.contextMenu) return;
    const { title, items } = this.contextMenuEntries();
    if (!title) {
      this.hideContextMenu();
      return;
    }

    this.contextMenu.innerHTML = "";
    const head = document.createElement("div");
    head.className = "ctx-title";
    head.textContent = title;
    this.contextMenu.appendChild(head);

    for (const item of items) {
      if (!item.action) {
        const note = document.createElement("div");
        note.className = "ctx-note";
        note.textContent = item.label;
        this.contextMenu.appendChild(note);
        continue;
      }
      const button = document.createElement("button");
      button.textContent = item.label;
      if (item.danger) button.className = "danger";
      button.addEventListener("click", () => this.runContextMenuAction(item.action));
      this.contextMenu.appendChild(button);
    }

    this.contextMenu.hidden = false;
    const rect = this.contextMenu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(x, window.innerWidth - rect.width - margin);
    const top = Math.min(y, window.innerHeight - rect.height - margin);
    this.contextMenu.style.left = Math.max(margin, left) + "px";
    this.contextMenu.style.top = Math.max(margin, top) + "px";
  },

  hideContextMenu() {
    if (this.contextMenu) this.contextMenu.hidden = true;
  },

  contextMenuEntries() {
    let title = "";
    const items = [];
    if (store.selectedLabelID) {
      title = "Label";
      items.push({ label: "Turn 90°", action: "turn-label" });
      items.push({ label: "Delete label", danger: true, action: "delete" });
    } else if (store.selectedPublicID) {
      const area = store.selectedPublicArea();
      title = "Public area";
      if (area) items.push({ label: P.cm(area.w) + " × " + P.cm(area.l), action: null });
      items.push({ label: "Delete public area", danger: true, action: "delete" });
    } else if (store.selectedFurnitureID) {
      const item = store.selectedFurniture();
      if (!item) return { title, items };
      const kind = P.FURNITURE_KINDS[item.kind];
      title = kind.title;
      if (kind.category !== "fixture") {
        items.push({ label: "Turn 90°", action: "turn" });
      }
      items.push({ label: "Delete " + kind.title.toLowerCase(), danger: true, action: "delete" });
    } else if (store.selectedDoorID) {
      const door = store.selectedDoor();
      title = "Door";
      if (door) items.push({ label: door.open ? "Close door" : "Open door", action: "toggle-open" });
      // Turning it round moves the hinge to the other edge. Different from the
      // swing, which is the room it opens into.
      items.push({ label: "Turn door round", action: "flip-door" });
      items.push({ label: "Delete door", danger: true, action: "delete" });
    } else if (store.selectedWindowID) {
      title = "Window";
      items.push({ label: "Delete window", danger: true, action: "delete" });
    } else if (store.selectedWallID) {
      const wall = store.selectedWall();
      const outer = wall && P.outsideFacingWalls(store.room).has(wall.id);
      title = outer ? "Outside wall" : "Wall";
      if (wall) items.push({ label: P.cm(P.wallLength(wall)), action: null });
      if (outer) {
        items.push(wall.dragUnlocked
          ? { label: "Lock Drag", action: "lock-wall" }
          : { label: "Unlock Drag", action: "unlock-wall" });
      }
      items.push({ label: "Delete wall", danger: true, action: "delete" });
    }
    return { title, items };
  }
};
