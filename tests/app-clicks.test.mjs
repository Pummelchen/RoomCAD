// The buttons, clicked.
//
// This is the last piece of app.js that no test could reach. Its click wiring is
// bound at load by querying the STATIC markup in index.html — the toolbar, the
// mode picker, the grid picker, the furniture palette — and the DOM stub had no
// page in it and did not parse innerHTML, so `querySelectorAll` found nothing,
// no handler was ever attached, and a click could not be aimed at a button.
//
// `installDOM({ page: true })` parses the real index.html, and the stub now
// parses innerHTML too, so the buttons the app renders are real elements with
// real datasets. The clicks below are the app's own handlers doing what they do.
//
// Run:  node tests/app-clicks.test.mjs

import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

registerHooks({ resolve });

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const at = name => pathToFileURL(join(web, name)).href;

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const settle = () => new Promise(resolve => { setTimeout(resolve, 20); });

// The real page, with the canvas sized the way the stub sizes one.
const dom = installDOM({ width: 1200, height: 800, page: true });

globalThis.fetch = (url) => {
  const u = String(url);
  const body = u.startsWith("/api/rooms") ? [] : u.startsWith("/api/session/last") ? null : {};
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
};

let bootError = null;
try {
  await import(at("app.js"));
} catch (err) {
  bootError = err;
}
check("app.js boots against the real page", bootError === null, bootError ? bootError.message : "");
await settle();

const { store } = await import(at("store.js"));

const inPage = sel => dom.document.querySelectorAll(sel);
const click = sel => {
  const el = dom.document.querySelector(sel);
  if (el) el.click();
  return el;
};

// ── The page's markup is really there, and really bound ───────────────────
{
  check("the toolbar's tools are in the page and bound",
    inPage("#toolbar [data-tool]").length >= 3, `${inPage("#toolbar [data-tool]").length}`);
  check("the mode picker is there", inPage("#mode-picker [data-mode]").length === 2);
  check("the grid picker is there", inPage("#grid-picker [data-grid]").length === 3);
  check("the furniture palette is there", inPage("#furniture-palette [data-kind]").length >= 5);
  check("the build palette is there", inPage("#build-palette [data-tool]").length >= 5);
}

// ── A tool button selects that tool ───────────────────────────────────────
{
  const measure = inPage("#toolbar [data-tool]").find(b => b.dataset.tool === "measure");
  check("Measure is a real button with a data-tool", !!measure,
    inPage("#toolbar [data-tool]").map(b => b.dataset.tool).join(", "));
  measure.click();
  check("clicking Measure selects the measure tool", store.tool === "measure", store.tool);
  check("and the button is marked active", measure.classList.contains("active"));
  check("and the tool that was active is not",
    inPage("#toolbar [data-tool]").filter(b => b.classList.contains("active")).length === 1);

  const wall = inPage("#build-palette [data-tool]").find(b => b.dataset.tool === "wall");
  wall.click();
  check("clicking Wall in the build palette selects the wall tool", store.tool === "wall", store.tool);
  check("and the toolbar's own selection is cleared",
    inPage("#toolbar [data-tool]").every(b => !b.classList.contains("active")));
}

// ── A grid button sets the grid ───────────────────────────────────────────
{
  const one = inPage("#grid-picker [data-grid]").find(b => b.dataset.grid === "oneCentimeter");
  one.click();
  check("clicking 1 cm sets a one-centimetre grid",
    store.room.grid === "oneCentimeter", String(store.room.grid));
  check("and that button is the active one", one.classList.contains("active"));
}

// ── A furniture icon starts placement, and clicking it again stops ────────
{
  const icons = inPage("#furniture-palette [data-kind]");
  const kind = icons[0].dataset.kind;
  check("a furniture icon names a kind", !!kind, String(kind));

  icons[0].click();
  check("clicking it starts placing that kind",
    store.tool === "furniture" && store.pendingFurnitureKind === kind,
    `${store.tool}/${store.pendingFurnitureKind}`);
  check("and the icon shows as active", icons[0].classList.contains("active"));

  icons[0].click();
  check("clicking the active icon again puts the tool away",
    !(store.tool === "furniture" && store.pendingFurnitureKind === kind),
    `${store.tool}/${store.pendingFurnitureKind}`);
}

// ── The mode picker switches mode ─────────────────────────────────────────
{
  // Only 2D is driven here: entering 3D starts the WebGPU walkthrough, which
  // cannot run in node, and this file is about the buttons rather than about
  // modes. The mode-switch test covers setMode itself.
  const two = inPage("#mode-picker [data-mode]").find(b => b.dataset.mode === "2d");
  two.click();
  check("clicking 2D Plan selects 2D mode", store.mode === "2d", store.mode);
  check("and 2D Plan is the active segment", two.classList.contains("active"));
  check("and 3D Walk is not",
    inPage("#mode-picker [data-mode]").filter(b => b.classList.contains("active")).length === 1);
}

// ── New Room asks, then replaces the plan ─────────────────────────────────
{
  // Something to lose, so the confirmation is a real decision.
  store.commit("scratch wall", room => {
    room.walls = (room.walls || []).concat([{ id: "w-click", start: { x: 0, z: 0 }, end: { x: 4, z: 0 } }]);
    room.name = "Scratch";
  });
  store.tool = "wall";
  check("there is work to lose",
    (store.room.walls || []).some(w => w.id === "w-click"), store.room.name);

  click("#new-room");

  // "New Room" has to GIVE you a new room rather than reload the demo, so this
  // checks the scratch work is gone and the room is the fresh one — not that the
  // plan is empty, because a fresh room has its own four walls.
  check("clicking New Room throws the old plan away",
    !(store.room.walls || []).some(w => w.id === "w-click"), store.room.name);
  check("and hands over a new room", store.room.name === "My Room", store.room.name);
  check("with its own walls", (store.room.walls || []).length === 4,
    `${(store.room.walls || []).length}`);
  check("and the tool back to select", store.tool === "select", store.tool);
}

// ── The export menu opens and closes ──────────────────────────────────────
{
  const menu = dom.document.getElementById("export-menu");
  menu.hidden = true;

  click("#export-room");
  check("clicking Export opens its menu", menu.hidden === false);

  // The app closes it from a document-level click that is not inside the menu.
  const elsewhere = dom.document.getElementById("toolbar");
  dom.document.dispatch("click", { target: elsewhere });
  check("and clicking elsewhere closes it again", menu.hidden === true);
}

// ── An inspector action, through the app's delegated handler ──────────────
//
// The inspector attaches ONE click listener to its container and finds the
// button from `e.target.closest("button[data-action]")`, so this only works if
// events bubble and the container's innerHTML is real elements — both of which
// the stub had to learn. Selecting a wall makes the inspector render a Delete
// Wall button, and clicking it must delete the wall.
{
  const wall = (store.room.walls || [])[0];
  check("the room has a wall to select", !!wall, `${(store.room.walls || []).length}`);
  // The store keeps the selection as an id, and app.js's inspector renders from
  // it; editor2d sets the same field when you click a wall on the plan.
  store.selectedWallID = wall.id;
  store.emit();

  const del = dom.document.querySelector('button[data-action="delete"]');
  check("the inspector rendered a Delete button for it", !!del,
    dom.document.getElementById("inspector-content").innerHTML.slice(0, 80));

  const before = (store.room.walls || []).length;
  if (del) del.click();
  check("clicking Delete in the inspector removes the wall",
    (store.room.walls || []).length === before - 1,
    `${before} -> ${(store.room.walls || []).length}`);
  check("and the wall that was selected is the one that went",
    !(store.room.walls || []).some(w => w.id === wall.id));
}

console.log(`${passed} passed, ${failed} failed — the app's buttons, clicked`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50);
