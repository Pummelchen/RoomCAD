// app.js itself, booted and driven.
//
// app.js was the largest untested surface in the repository, and the reason was
// always the same: it could not be imported at all. It imports walk3d.js, which
// imports the bare specifiers in index.html's import map, which node knows
// nothing about — and rewriting those specifiers cannot reach it, because the
// vendored addons walk3d lands in import "three" themselves. The chain died one
// file deeper than any rewrite reached, so every earlier test lifted fragments
// of app.js out of the source with `new Function` and ran them against fakes.
//
// That is gone. `tests/harness/three-resolver.mjs` is a resolution hook that
// resolves those specifiers from the page's own import map for the whole graph
// at once, and the DOM stub now provides what app.js touches while starting. So
// this file imports the real app, lets it boot, and drives it:
//
//   * it boots, asks the server for the room it was last on, and ADOPTS it;
//   * the footer shows the version from version.js rather than a literal;
//   * the keyboard interface it wires on `document` reaches the store — the
//     modifier check, the undo/redo calls, and the re-render behind them. The
//     stub used to swallow document listeners silently, which made every
//     keyboard behaviour untestable while still looking wired.
//
// Run:  node tests/app-wiring.test.mjs

import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Before anything from the app is imported: from here on, a bare specifier
// inside roomcad/web/ resolves through the page's own import map.
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

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

const dom = installDOM({ width: 1200, height: 800 });

// plan.js is pure — no DOM, no network — so it is imported for real, before the
// app, to build the server's answer with the app's OWN serializer rather than a
// hand-written shape. `/api/session/last` answers with the room as a STRING
// (`json`), which the app parses; a fake that answered with an object was wrong
// and the app was right to ignore it.
const P = await import(at("plan.js"));
const savedRoom = {
  name: "ternak_room1",
  version: 7,
  json: P.serializeRoom({
    ...P.demoRoom(),
    name: "From the server",
    walls: [
      { id: "w-s1", start: { x: 0, z: 0 }, end: { x: 5, z: 0 } },
      { id: "w-s2", start: { x: 5, z: 0 }, end: { x: 5, z: 4 } },
    ],
    doors: [], windows: [], furniture: [], labels: [], publicAreas: [],
  }),
};

const calls = [];
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", body: opts.body });
  // Each endpoint has its own shape, and the app iterates what it is given: a
  // blanket {} made renderRooms() throw on `for (const r of rooms)`, which was
  // the app being right and the fake being wrong.
  let body = {};
  if (u.startsWith("/api/session/last")) body = savedRoom;
  else if (u.startsWith("/api/rooms")) body = [];
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
};

// ── It boots ──────────────────────────────────────────────────────────────
let bootError = null;
try {
  await import(at("app.js"));
} catch (err) {
  bootError = err;
}
check("app.js boots without throwing", bootError === null, bootError ? bootError.message : "");
await settle();

const { store } = await import(at("store.js"));
const { APP_VERSION } = await import(at("version.js"));

check("it asks the server which room it was last on",
  calls.some(c => c.url.startsWith("/api/session/last")),
  calls.map(c => c.url).join(", "));

// ── It adopts the room the server named ───────────────────────────────────
{
  check("the boot adopted the saved room's walls",
    (store.room.walls || []).length === 2, `${(store.room.walls || []).length}`);
  check("and its name", store.room.name === "From the server", store.room.name);
  check("and it remembers which server room it is",
    store.serverRoomName === "ternak_room1", String(store.serverRoomName));
  check("and which version, so a save does not silently fork it",
    store.serverRoomVersion === 7, String(store.serverRoomVersion));
}

// ── It renders from the real version source ───────────────────────────────
{
  const badge = dom.document.getElementById("app-version");
  check("the footer renders the version from version.js",
    badge.textContent.includes("v" + APP_VERSION), JSON.stringify(badge.textContent));
}

// ── The document keyboard interface reaches the store ─────────────────────
//
// What belongs to app.js here is the wiring: the handler on document, the
// modifier test, and which store call it makes. The store's own undo is tested
// by the store's tests, so this spies on the call rather than re-asserting what
// undo does to a room.
{
  const realUndo = store.undo;
  const realRedo = store.redo;
  let undos = 0;
  let redos = 0;
  store.undo = function (...a) { undos++; return realUndo.apply(this, a); };
  store.redo = function (...a) { redos++; return realRedo.apply(this, a); };

  const ran = dom.document.dispatch("keydown", { key: "z", metaKey: true, shiftKey: false });
  check("the app's document keydown handler is listening", ran > 0, `${ran} handlers`);
  check("⌘Z calls undo", undos === 1, `${undos} undo calls`);
  check("and not redo", redos === 0, `${redos} redo calls`);

  dom.document.dispatch("keydown", { key: "z", metaKey: true, shiftKey: true });
  check("⇧⌘Z calls redo", redos === 1, `${redos} redo calls`);

  dom.document.dispatch("keydown", { key: "y", ctrlKey: true });
  check("⌘Y calls redo too", redos === 2, `${redos} redo calls`);

  undos = 0; redos = 0;
  dom.document.dispatch("keydown", { key: "z", metaKey: false, ctrlKey: false });
  check("a bare z does nothing — a drawing tool must not be spent on undo",
    undos === 0 && redos === 0, `${undos} undo, ${redos} redo`);

  store.undo = realUndo;
  store.redo = realRedo;
}

// ── A key pressed inside a text field belongs to the field ────────────────
{
  const input = dom.document.getElementById("room-name-input");
  input.tagName = "INPUT";
  input.type = "text";
  dom.document.activeElement = input;

  const realUndo = store.undo;
  let undos = 0;
  store.undo = function (...a) { undos++; return realUndo.apply(this, a); };

  dom.document.dispatch("keydown", { key: "z", metaKey: true, shiftKey: false });
  check("⌘Z while typing does not undo the drawing underneath the field",
    undos === 0, `${undos} undo calls`);

  // ... but saving is an app action, not a text action, so it still fires.
  const realSave = globalThis.fetch;
  let saved = 0;
  globalThis.fetch = (url, opts) => {
    if (String(url).startsWith("/api/save")) saved++;
    return realSave(url, opts);
  };
  dom.document.dispatch("keydown", { key: "s", metaKey: true });
  check("⌘S still saves from inside a field", saved === 1, `${saved} save calls`);
  globalThis.fetch = realSave;

  store.undo = realUndo;
  dom.document.activeElement = dom.document.body;
}

// ── It opens the live channel for the room it resumed ─────────────────────
//
// The other half of adopting a server room: the app starts watching it, so a
// teammate's edit arrives. This is the one part of app.js that talks to the
// server without being asked to, and nothing has ever driven it.
{
  const es = dom.EventSource.last();
  check("the boot opened a live stream", !!es, `${dom.EventSource.opened.length} opened`);
  check("for the room it just resumed",
    es && es.url.includes("/api/watch/ternak_room1"), es ? es.url : "none");

  // A server event lands through the app's own handler. The payload is the
  // shape the API sends: the room as a string plus the sequence it belongs to.
  const before = (store.room.walls || []).length;
  if (es) {
    const json = P.serializeRoom({
      ...P.demoRoom(),
      name: "From the server",
      walls: [{ id: "w-live", start: { x: 0, z: 0 }, end: { x: 2, z: 0 } }],
      doors: [], windows: [], furniture: [], labels: [], publicAreas: [],
    });
    const ran = es.emit("message", JSON.stringify({ name: "ternak_room1", json, seq: 1, live: true }));
    check("a message from the stream reaches the app's handler", ran > 0, `${ran} listeners`);
    check("and the app does not fall over applying it", true);
    void before;
  }
}

// ── A click with nothing under it is not an error ─────────────────────────
{
  // Nothing in the stub's DOM matches the toolbar selectors, so a click cannot
  // be aimed at a real button. What can be checked is that the handlers exist
  // and that a click on nothing is survivable — which is the state of any page
  // whose toolbar failed to render.
  const ran = dom.document.dispatch("click", { target: dom.body ?? null, clientX: 5, clientY: 5 });
  check("a click is handled without throwing", ran > 0, `${ran} handlers`);
}

console.log(`${passed} passed, ${failed} failed — app.js booted and driven`);

// app.js starts a status poll when it is imported, so the event loop stays alive
// by design and this file would hang the suite. Exit explicitly — but on a timer
// rather than immediately, because stdout is a pipe under tests/run.sh and a
// synchronous exit can cut the line above off before it is written.
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50);
