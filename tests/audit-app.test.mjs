// The app-layer findings of the 2026-09-18 audit, driven through the REAL
// modules rather than read out of the source.
//
// app.js is importable now: tests/harness/three-resolver.mjs resolves the page's
// import map for the whole graph, and tests/harness/dom-stub.mjs parses the real
// index.html, so the app's own buttons, inspectors and status line are the ones
// under test. The browser primitives the app reaches for but node does not have
// — EventSource, FileReader — are faked here, the way the DOM stub already fakes
// the canvas.
//
// Run:  node tests/audit-app.test.mjs

import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";

// Before anything from the app is imported, bare specifiers inside roomcad/web/
// resolve through the page's own import map. The app modules are then imported
// by literal relative path — the resolver handles the graph under roomcad/web,
// so a literal here still reaches the real modules from their real paths.
registerHooks({ resolve });

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}
const sleep = ms => new Promise(r => { setTimeout(r, ms); });
/// Waits for a condition, rather than guessing how long an async path takes.
async function waitFor(test, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return true;
    await sleep(5);
  }
  return test();
}

const dom = installDOM({ page: true });

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// A mutable router in front of the app's fetch calls. Tests replace it to say
// what the server answers.
let routes = [];
function resetRoutes() { routes = []; }
function route(prefix, reply) { routes.push({ prefix, reply }); }
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  for (const r of routes) if (u.startsWith(r.prefix)) return Promise.resolve(r.reply(u, opts));
  return Promise.resolve(response({ ok: false, status: 404 }));
};

/// A room of one wall, serialised the way the server sends it over SSE.
const roomJsonOf = (name, wallID = "w-" + name) => P.serializeRoom({
  ...P.demoRoom(),
  name,
  walls: [{ id: wallID, start: { x: 0, z: 0 }, end: { x: 3, z: 0 } }],
  doors: [], windows: [], furniture: [], labels: [], publicAreas: [],
});

// ── The real app modules ──────────────────────────────────────────────────
const P = await import("../roomcad/web/plan.js");
const { store } = await import("../roomcad/web/store.js");
const { appState } = await import("../roomcad/web/app/state.js");
const statusMod = await import("../roomcad/web/app/status.js");
const watchMod = await import("../roomcad/web/app/watch.js");
const filesMod = await import("../roomcad/web/app/files.js");
const uiMod = await import("../roomcad/web/app/ui.js");

// ── T0018 — the status poll backs off from the interval, not from zero ────
//
// `statusBackoff: 0` made `Math.min(0 * 2, 30000)` 0 forever, so an unreachable
// server was re-polled in a tight loop (measured: 95 requests in 120 ms). The
// delay has to start at the interval and grow from there.
{
  check("the backoff starts at the poll interval, not zero",
    appState.statusBackoff === statusMod.STATUS_INTERVAL_MS && statusMod.STATUS_INTERVAL_MS > 0,
    `${appState.statusBackoff} vs ${statusMod.STATUS_INTERVAL_MS}`);

  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); return delays.length; };
  globalThis.fetch = () => Promise.reject(new Error("offline"));

  await statusMod.runStatusPoll();
  const first = delays[delays.length - 1];
  await statusMod.runStatusPoll();
  const second = delays[delays.length - 1];
  check("a failed poll backs off to twice the interval",
    first === statusMod.STATUS_INTERVAL_MS * 2, String(first));
  check("and keeps growing on repeated failures",
    second === statusMod.STATUS_INTERVAL_MS * 4, String(second));

  globalThis.fetch = () => Promise.resolve(response({ body: { count: 1 } }));
  await statusMod.runStatusPoll();
  check("a reachable server resets the backoff to the interval",
    delays[delays.length - 1] === statusMod.STATUS_INTERVAL_MS, String(delays[delays.length - 1]));

  globalThis.setTimeout = realTimeout;
  globalThis.fetch = realFetch;
}

// ── T0006 / T0017 — what the live stream does with an arriving message ────
//
// T0006: the sequence must move only for a message that was really adopted (or
// for our own echo, which by definition carries the sequence our edit landed
// at). A message dropped for a drag or a parse failure left the counter where
// it was, so the next push claimed to be current and overwrote a teammate's
// accepted work.
//
// T0017: a teammate's room arriving while a local edit is still unpublished must
// not replace it — applyRemoteRoom clears both undo stacks, so the edit would be
// gone and had never been sent.
{
  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  store.dragTransactionActive = false;
  watchMod.watchRoom("flat");
  statusMod.stopLiveSync();               // drive messages directly
  const es = dom.EventSource.last();
  check("the watcher opened a stream", !!es && watchMod.eventSource === es);

  const theirs = over => JSON.stringify({
    name: "flat", clientId: "them", live: true, version: 1, ...over,
  });
  const mine = over => JSON.stringify({
    name: "flat", clientId: watchMod.CLIENT_ID, live: true, version: 1, ...over,
  });

  // (a) mid-drag: the message is refused, and so is its sequence.
  statusMod.resetLiveSequence();
  const beforeDrag = store.room;
  store.dragTransactionActive = true;
  es.emit("message", theirs({ seq: 42, json: roomJsonOf("Theirs") }));
  check("a mid-drag message does not advance liveSeq",
    appState.liveSeq === 0, String(appState.liveSeq));
  check("and is not applied", store.room === beforeDrag);
  store.dragTransactionActive = false;

  // (b) unparseable: the throw must not leave us claiming the sequence.
  statusMod.resetLiveSequence();
  const beforeBad = store.room;
  es.emit("message", theirs({ seq: 42, json: "{not json" }));
  check("an unreadable message does not advance liveSeq",
    appState.liveSeq === 0, String(appState.liveSeq));
  check("and does not replace the room", store.room === beforeBad);

  // (c) adopted: now the sequence travels with the copy we took.
  statusMod.resetLiveSequence();
  es.emit("message", theirs({ seq: 7, json: roomJsonOf("Theirs") }));
  check("an adopted message advances liveSeq", appState.liveSeq === 7, String(appState.liveSeq));
  check("and is applied", store.room.name === "Theirs", store.room.name);

  // (d) our own echo: not applied, but it is where we learn our own new seq.
  statusMod.resetLiveSequence();
  const beforeEcho = store.room;
  es.emit("message", mine({ seq: 11, json: roomJsonOf("Mine") }));
  check("our own echo advances liveSeq", appState.liveSeq === 11, String(appState.liveSeq));
  check("without replacing the room", store.room === beforeEcho);

  // T0017 — a teammate's update held back by an unpublished local edit.
  statusMod.resetLiveSequence();
  const beforePending = store.room;
  statusMod.scheduleLivePush();           // an edit is waiting to go out
  es.emit("message", theirs({ seq: 21, json: roomJsonOf("Theirs") }));
  check("a teammate's room is not applied over an unpublished local edit",
    store.room === beforePending);
  check("and its sequence is not adopted", appState.liveSeq === 0, String(appState.liveSeq));
  check("the user is told the change is waiting",
    /waiting|teammate/i.test(store.status), store.status);
  statusMod.resetLiveSequence();
}

// ── T0019 — the drift check adopts the sequence only after it applies ─────
//
// Advancing `liveSeq` before parsing the shared room left the client
// "current" on a stale room when the parse threw into an empty catch: its next
// push was accepted with a current baseSeq and replaced everyone's work.
{
  const realSetInterval = globalThis.setInterval;
  let driftCheck = null;
  globalThis.setInterval = fn => { driftCheck = fn; return 987654; };
  statusMod.startLiveSync();
  globalThis.setInterval = realSetInterval;
  check("the real drift check can be driven", typeof driftCheck === "function");

  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  store.dragTransactionActive = false;

  const realFetch = globalThis.fetch;
  statusMod.resetLiveSequence();
  const before = store.room;
  globalThis.fetch = () => Promise.resolve(
    response({ body: { inSync: false, seq: 42, version: 3, json: "{not json" } }));
  await driftCheck();
  check("an unreadable catch-up does not adopt the sequence",
    appState.liveSeq === 0, String(appState.liveSeq));
  check("and does not replace the room", store.room === before);
  check("and the failure is surfaced rather than swallowed",
    store.status.length > 0 && /could not|out of date|read/i.test(store.status), store.status);

  globalThis.fetch = () => Promise.resolve(
    response({ body: { inSync: true, seq: 5, version: 2 } }));
  await driftCheck();
  check("an in-sync answer adopts the server's authoritative sequence",
    appState.liveSeq === 5, String(appState.liveSeq));
  check("and its version", store.serverRoomVersion === 2);

  globalThis.fetch = () => Promise.resolve(response({ body: {
    inSync: false, seq: 7, version: 4, json: roomJsonOf("Shared", "w-shared"),
  } }));
  await driftCheck();
  check("a readable catch-up adopts the sequence only after applying",
    appState.liveSeq === 7, String(appState.liveSeq));
  check("and applies the shared room", store.room.name === "Shared", store.room.name);

  globalThis.fetch = realFetch;
  statusMod.stopLiveSync();
}

// ── T0020 — a stale push answer must not land over a newer local edit ─────
//
// Edit A is pushed; while the POST is in flight edit B is scheduled; A's answer
// comes back stale and was applied with no check, replacing B before it was ever
// sent. Its sequence must not be adopted either — that would let B's push win
// against the very work that made A stale.
{
  const realFetch = globalThis.fetch;
  const inFlight = [];
  globalThis.fetch = (url, opts) => new Promise(resolve => { inFlight.push({ url, opts, resolve }); });

  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  store.dragTransactionActive = false;
  store.room = P.parseRoom(P.serializeRoom(P.freshRoom("Guard", 6, 4, 2.6)));
  statusMod.resetLiveSequence();

  const before = store.room;
  statusMod.scheduleLivePush();           // edit A
  await waitFor(() => inFlight.length === 1);   // its 150 ms timer has fired
  check("the push went out", inFlight.length === 1, String(inFlight.length));
  statusMod.scheduleLivePush();           // edit B, while A is in flight
  inFlight[0].resolve(response({ body: {
    stale: true, seq: 9, version: 4, json: roomJsonOf("Theirs"),
  } }));
  await sleep(10);
  check("a stale answer is not applied over a newer local edit", store.room === before);
  check("and its sequence is not adopted", appState.liveSeq === 0, String(appState.liveSeq));
  statusMod.resetLiveSequence();

  // The control: the same answer with nothing newer IS applied, so the guard is
  // a guard and not a way to ignore every stale reply.
  inFlight.length = 0;
  const before2 = store.room;
  statusMod.scheduleLivePush();
  await waitFor(() => inFlight.length === 1);
  inFlight[0].resolve(response({ body: {
    stale: true, seq: 9, version: 4, json: roomJsonOf("Theirs"),
  } }));
  await waitFor(() => store.room !== before2);
  check("a stale answer with no newer edit is applied",
    store.room !== before2 && store.room.name === "Theirs", store.room.name);
  check("and its sequence is adopted", appState.liveSeq === 9, String(appState.liveSeq));
  statusMod.resetLiveSequence();
  globalThis.fetch = realFetch;
}

// ── T0036 — New Room and a local import leave the server room behind ──────
{
  store.edited = false;
  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  watchMod.watchRoom("flat");
  statusMod.stopLiveSync();
  const es = dom.EventSource.last();
  check("watching opens a stream", !!es && watchMod.eventSource === es);
  dom.document.getElementById("new-room").dispatch("click", {});
  check("New Room closes the live stream",
    es.closed === true && watchMod.eventSource === null,
    `closed ${es.closed}, eventSource ${watchMod.eventSource}`);
  check("and forgets the server room and its sequence",
    store.serverRoomName === null && appState.liveSeq === 0);
}
{
  store.edited = false;
  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  watchMod.watchRoom("flat");
  statusMod.stopLiveSync();
  const es = dom.EventSource.last();
  const json = P.serializeRoom({ ...P.freshRoom("Imported", 5, 4, 2.6) });
  globalThis.FileReader = class {
    readAsText() { this.result = json; if (this.onload) this.onload(); }
  };
  const fileInput = dom.document.getElementById("file-input");
  fileInput.files = [{ name: "import.rcad" }];
  fileInput.dispatch("change", {});
  check("importing a local file closes the live stream",
    es.closed === true && watchMod.eventSource === null);
  check("and forgets the sequence", appState.liveSeq === 0, String(appState.liveSeq));
}

// ── T0037 — a refused stream is noticed, not left claiming Live ───────────
//
// Only a thrown constructor reached the try/catch. A non-200 (401 after the
// session expired, 503 at the watcher cap) fails the stream permanently per the
// EventSource spec, and nothing listened: `eventSource` stayed non-null, so
// Join Live never reopened it and the UI went on saying Live.
{
  store.edited = false;
  store.live = true;
  store.serverRoomName = "flat";
  store.serverRoomVersion = 1;
  watchMod.watchRoom("flat");
  statusMod.stopLiveSync();
  const es = dom.EventSource.last();

  // A plain drop: the platform retries it itself, so the channel stays.
  es.readyState = 0;
  es.emit("error", {});
  check("a plain drop leaves the stream in place to reconnect",
    watchMod.eventSource === es, String(watchMod.eventSource));

  // A refused stream: CLOSED for good.
  es.readyState = 2;
  store.status = "";
  es.emit("error", {});
  check("a refused stream is dropped so Join Live can reopen it",
    watchMod.eventSource === null, String(watchMod.eventSource));
  check("the channel is marked detached", watchMod.liveDetached === true);
  check("the UI no longer claims Live", store.live === false);
  check("and the user is told",
    /stream|refused|reconnect|lost|connection/i.test(store.status), store.status);
}

// ── T0039 — saveRoom reports the SAVE, not the verification ───────────────
//
// The verification is a second request. When the POST stored the work and the
// follow-up GET failed, saveRoom returned false, so leaveLiveMode refused to
// leave and the user retried into a duplicate version.
{
  const posted = [];
  let loadFails = false;
  resetRoutes();
  route("/api/save", (u, opts) => {
    posted.push(JSON.parse(opts.body));
    return response({ body: { name: "Audit-Room", version: 3 } });
  });
  route("/api/load/", () => loadFails
    ? response({ ok: false, status: 500 })
    : response({ body: { json: posted[posted.length - 1].json } }));
  route("/api/rooms", () => response({ body: [] }));

  store.room = P.parseRoom(P.serializeRoom(P.freshRoom("Audit Room", 6, 4, 2.6)));
  store.serverRoomName = "Audit-Room";
  store.serverRoomVersion = 2;
  store.edited = true;

  loadFails = true;
  const unverified = await filesMod.saveRoom({ watch: false });
  check("a stored-but-unverified save reports saved",
    unverified.saved === true && unverified.verified === false, JSON.stringify(unverified));
  check("the room is no longer dirty, because it really was saved", store.edited === false);
  check("and the wording still says it could not be verified",
    store.status === "Saved, but the data could not be verified", store.status);

  loadFails = false;
  const verified = await filesMod.saveRoom({ watch: false });
  check("a fully verified save reports both",
    verified.saved === true && verified.verified === true, JSON.stringify(verified));

  resetRoutes();
  route("/api/save", () => response({ ok: false, status: 500 }));
  route("/api/rooms", () => response({ body: [] }));
  const refused = await filesMod.saveRoom({ watch: false });
  check("a save the server refused reports not saved",
    refused.saved === false && refused.verified === false, JSON.stringify(refused));
  check("with the existing wording", store.status === "Could not save to the server", store.status);
}

// ── T0040 — a failed file read is reported and resets the picker ──────────
{
  const alerts = [];
  dom.window.alert = msg => alerts.push(String(msg));
  globalThis.FileReader = class {
    readAsText() { if (this.onerror) this.onerror(new Error("boom")); }
  };
  const fileInput = dom.document.getElementById("file-input");
  fileInput.files = [{ name: "broken.rcad" }];
  fileInput.value = "C:\\fake\\broken.rcad";
  store.edited = false;
  fileInput.dispatch("change", {});
  check("a failed file read is reported", alerts.some(a => /broken\.rcad/.test(a)),
    JSON.stringify(alerts));
  check("and the picker is cleared so the same file can be chosen again",
    fileInput.value === "", JSON.stringify(fileInput.value));
}

// ── Boot the real app: main.js's store subscription is the render pipeline ─
resetRoutes();
route("/api/status", () => response({ body: { count: 1 } }));
route("/api/rooms", () => response({ body: [] }));
route("/api/session/last", () => response({ body: {} }));
await import("../roomcad/web/app.js");
await sleep(30);

// ── T0038 — the repair report reaches the status line on every load path ──
//
// announceRepairs() set store.status after the last emit on the local-import
// and stored-room paths, so the sentence never reached the screen and a plan
// that had lost a wall opened looking whole.
{
  const statusMessage = dom.document.getElementById("status-message");
  const broken = P.freshRoom("Repaired", 6, 4, 2.6);
  broken.walls.push({ id: "w-stub", start: { x: 0, z: 0 }, end: { x: 0.05, z: 0 } });
  const json = P.serializeRoom(broken);
  globalThis.FileReader = class {
    readAsText() { this.result = json; if (this.onload) this.onload(); }
  };
  const fileInput = dom.document.getElementById("file-input");
  fileInput.files = [{ name: "repaired.rcad" }];
  store.edited = false;
  fileInput.dispatch("change", {});
  await waitFor(() => /with repairs/i.test(statusMessage.textContent));
  check("the repair sentence reaches the status line on the local-import path",
    /with repairs/i.test(statusMessage.textContent), statusMessage.textContent);
}

// ── T0041 — the discard guard says what OK does ───────────────────────────
{
  const asked = [];
  dom.window.confirm = msg => { asked.push(String(msg)); return true; };
  store.edited = false;
  check("no guard is raised when there is nothing to lose", uiMod.confirmDiscard() === true);
  store.edited = true;
  const answer = uiMod.confirmDiscard();
  check("the guard is raised when there is unsaved work",
    asked.length === 1 && answer === true, JSON.stringify(asked));
  check("and it asks about discarding, because OK discards",
    /discard/i.test(asked[0]) && !/save changes/i.test(asked[0]), asked[0]);
}

// ── T0042 — Cmd/Ctrl-S commits the focused field before saving ────────────
//
// The inspector writes a field back on `change`, which the browser fires when
// the field loses focus; Cmd-S runs before that, so it serialised the value
// from before the edit. The app must commit the field first.
{
  const { renderInspector } = await import("../roomcad/web/app/view.js");
  store.room = P.parseRoom(P.serializeRoom(P.freshRoom("7-Room Demo", 6, 4, 2.6)));
  store.edited = false;
  dom.document.activeElement = dom.document.body;
  renderInspector();
  const input = dom.document.getElementById("inspector-content")
    .querySelector('input[data-action="rename"]');
  check("the Room Name field is rendered", !!input);
  input.value = "Kitchen Extension";
  dom.document.activeElement = input;
  // The stub's blur does not fire the change a browser fires on blur; add it so
  // this tests the app's commit, not the stub's fidelity.
  const realBlur = input.blur.bind(input);
  input.blur = () => { realBlur(); input.dispatch("change", {}); };

  let savedBody = null;
  resetRoutes();
  route("/api/save", (u, opts) => {
    savedBody = JSON.parse(opts.body);
    return response({ body: { name: "Kitchen-Extension", version: 1 } });
  });
  route("/api/load/", () => response({ body: { json: savedBody ? savedBody.json : "{}" } }));
  route("/api/rooms", () => response({ body: [] }));
  dom.document.dispatch("keydown", { key: "s", metaKey: true });
  await waitFor(() => !!savedBody);
  check("⌘S from inside the Room Name field saves the value on screen",
    !!savedBody && JSON.parse(savedBody.json).room.name === "Kitchen Extension",
    savedBody ? JSON.parse(savedBody.json).room.name : "no save");
}

// ── T0043 — a non-OK login says which non-OK it was ───────────────────────
{
  const reloads = [];
  globalThis.location = { reload: () => reloads.push(1) };
  await import("../roomcad/web/login.js");
  await sleep(0);
  const form = dom.document.getElementById("login-form");
  const input = dom.document.getElementById("login-password");
  const error = dom.document.getElementById("login-error");
  const submit = async status => {
    globalThis.fetch = () => Promise.resolve(response({ ok: false, status, body: {} }));
    input.value = "hunter2";
    form.dispatch("submit", { preventDefault() {} });
    await sleep(0);
    return error.textContent;
  };
  check("401 is a wrong password", await submit(401) === "Wrong password.");
  const locked = await submit(429);
  check("429 tells the user to wait instead of calling a correct password wrong",
    !/wrong password/i.test(locked) && /(wait|too many|minute)/i.test(locked), locked);
  const server = await submit(500);
  check("a 5xx is reported as a server problem, not a wrong password",
    !/wrong password/i.test(server) && /server/i.test(server), server);
  check("a non-OK login never reloads", reloads.length === 0);
}

console.log(`${passed} passed, ${failed} failed — app-layer audit findings`);

// main.js starts a status poll when app.js is imported, so the event loop stays
// alive by design. Exit explicitly, on a timer so the line above flushes.
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50);
