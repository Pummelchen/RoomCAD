// The remembered sidebar widths and their drag handles.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Remembered sidebar widths


import { leftSidebarResizer, main, rightSidebarResizer, toggleInspectorButton, toggleSidebarButton } from "./ui.js";

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

const sidebarWidths = loadSidebarWidths();
const panelsShown = loadPanelsShown();

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
    localStorage.setItem(SIDEBAR_LAYOUT_KEY,
      JSON.stringify({ ...sidebarWidths, shown: panelsShown }));
  } catch {
    // Private browsing can reject storage; resizing should still work now.
  }
}

/// Which panels were left showing. Both, unless the user hid one: a panel that
/// came back every reload would have to be hidden again every reload.
function loadPanelsShown() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_LAYOUT_KEY) || "{}").shown || {};
    return { left: saved.left !== false, right: saved.right !== false };
  } catch {
    return { left: true, right: true };
  }
}

/// Shows or hides one panel. The drawing area is a flex child, so it simply
/// takes the room back — nothing has to be resized by hand.
function applyPanelsShown({ persist = false } = {}) {
  document.body.classList.toggle("sidebar-collapsed", !panelsShown.left);
  document.body.classList.toggle("inspector-collapsed", !panelsShown.right);
  for (const [button, on, what] of [
    [toggleSidebarButton, panelsShown.left, "left"],
    [toggleInspectorButton, panelsShown.right, "right"],
  ]) {
    if (!button) continue;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.title = (on ? "Hide" : "Show") + " the " + what + " panel"
      + (what === "left" ? " (\u2318\\)" : " (\u2318\u21e7\\)");
  }
  // The widths are clamped against the space available, and hiding a panel
  // changes that space. Without this the panel that is still open keeps a width
  // that was only valid while it had a neighbour.
  applySidebarWidths({ persist });
  if (persist) saveSidebarWidths();
  // The plan is drawn to the canvas's pixel size, so it has to be told.
  window.dispatchEvent(new Event("resize"));
}

export function togglePanel(side) {
  panelsShown[side] = !panelsShown[side];
  applyPanelsShown({ persist: true });
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
toggleSidebarButton.addEventListener("click", () => togglePanel("left"));
toggleInspectorButton.addEventListener("click", () => togglePanel("right"));
edgeGapPx = measureEdgeGap();
applySidebarWidths();
applyPanelsShown();
window.addEventListener("resize", () => applySidebarWidths({ persist: true }));
