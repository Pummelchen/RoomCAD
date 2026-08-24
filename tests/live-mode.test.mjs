// The deliberate Join Live / Leave Live Mode flow — and, now, what the watcher
// actually DOES with an update, which was wrong in a way source contracts could
// never have caught.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");
const css = readFileSync(join(root, "roomcad", "web", "styles.css"), "utf8");

let failed = 0;
let passed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
    return;
  }
  passed++;
}

check("toolbar exposes a Join Live button", html.includes('id="live-room"') && html.includes(">Join Live</button>"));
check("toolbar exposes the red leave action", html.includes('id="leave-live-room"') && html.includes(">Leave Live Mode</button>"));
check("second-session invitation uses Join Live text", app.includes('liveButton.textContent = store.live ? "Live Active" : "Join Live";'));
check("live drafts wait safely for an explicit join", app.includes("let pendingLiveDraft = null;") && app.includes("pendingLiveDraft = { room, version }"));
check("joining never pushes stale local data immediately", !app.includes("pushLiveDraft(); // publish our current state right away"));
check("leave saves before detaching the watcher", app.includes("const saved = await saveRoom({ watch: false });") && app.includes("stopWatching({ detached: true });"));
check("leave failure keeps the editor live", app.includes("still in Live Active"));
check("Join Live has a slow neon pulse", css.includes("#live-room.join-live") && css.includes("@keyframes roomcad-live-pulse"));
check("leave action is styled red", css.includes("#toolbar #leave-live-room.live-leave"));

// Status polling. setInterval around an await lets a slow server collect
// overlapping requests from every open tab, which makes it slower still.
check("status polls are scheduled one at a time, not on a fixed interval",
  !app.includes("setInterval(pollStatus") && app.includes("scheduleStatus(statusBackoff)"));
check("the next poll is scheduled only after the previous one resolves",
  app.includes("const offline = await pollStatus();"));
check("pollStatus reports whether the server could be reached",
  app.includes("/// Polls the server once. Resolves true if the server could not be reached."));
check("an unreachable server is backed off from rather than hammered",
  app.includes("Math.min(statusBackoff * 2, STATUS_BACKOFF_MAX_MS)"));
check("backoff is bounded",
  /STATUS_BACKOFF_MAX_MS\s*=\s*\d+/.test(app));
check("returning to the tab refreshes immediately",
  app.includes('addEventListener("visibilitychange"') && app.includes("scheduleStatus(0)"));
check("a hidden tab keeps counting as present",
  !app.includes("if (document.hidden) {\n    scheduleStatus"));

// Overall size is measured from the walls, not typed. The old pair of fields
// changed a number and moved no walls, so the label and the drawing could
// disagree by metres — and the generator, the SVG title block and the 3D view
// all size themselves from that number.
check("the size fields are gone from the sidebar",
  !app.includes('data-action="room-w"') && !app.includes('data-action="room-l"'));
check("nothing tries to set the size any more", !app.includes("updateRoomSize"));
check("the sidebar shows a measured size instead", app.includes('class="readout measured"'));
check("and says where the number comes from and how to change it",
  /measured from the walls[^`]*drag a wall to resize/.test(app));
check("floor area is the enclosed floor, not width times length",
  app.includes("P.floorArea(room)") && !app.includes("(room.width * room.length)"));


// ── What an update from the watcher means ────────────────────────────────
//
// A live draft carries the SENDER's version. The receiver used to drop any
// draft whose version was not its own — so the first time either side saved,
// the two versions parted company and every live edit from then on was
// silently discarded. Live editing worked right until somebody saved, which is
// the moment people start collaborating: "the other side opened it but none of
// the walls I drew were shown".
//
// Driven through the real function rather than read out of the source. The
// function is lifted out of app.js on its own because app.js reaches for the
// DOM the moment it loads.
{
  const src = app.slice(app.indexOf("export function liveUpdateAction"));
  const body = src.slice(0, src.indexOf("\nfunction watchRoom"));
  const { liveUpdateAction } = await import(
    "data:text/javascript;base64," + Buffer.from(body, "utf8").toString("base64"));

  const me = { serverRoomName: "flat", serverRoomVersion: 3, clientId: "me", live: true,
               dragTransactionActive: false };
  const draft = (over = {}) => ({ name: "flat", clientId: "them", live: true, version: 3, ...over });

  check("a live draft from a teammate is applied",
    liveUpdateAction(draft(), me).action === "live");
  // The bug, stated as its own case.
  check("a live draft is applied even when the versions differ",
    liveUpdateAction(draft({ version: 7 }), me).action === "live");
  check("and when the sender has no version at all",
    liveUpdateAction(draft({ version: null }), me).action === "live");
  check("a draft for another room is ignored",
    liveUpdateAction(draft({ name: "attic" }), me).action === "ignore");
  check("our own echo is ignored",
    liveUpdateAction(draft({ clientId: "me" }), me).action === "ignore");
  check("nothing lands mid-drag",
    liveUpdateAction(draft(), { ...me, dragTransactionActive: true }).action === "ignore");
  check("a draft is held, not applied, before joining live",
    liveUpdateAction(draft(), { ...me, live: false }).action === "hold");
  check("and held whatever version it carries",
    liveUpdateAction(draft({ version: 9 }), { ...me, live: false }).action === "hold");

  // Saves are the other half: a new version from anyone is adopted, and the
  // version the watcher echoes back on connect is not mistaken for one.
  const save = (over = {}) => ({ name: "flat", clientId: "them", live: false, version: 4, ...over });
  check("a teammate's save is applied", liveUpdateAction(save(), me).action === "saved");
  check("the version we already have is not re-applied",
    liveUpdateAction(save({ version: 3 }), me).action === "ignore");
  check("a save is applied while live too",
    liveUpdateAction(save(), { ...me, live: true }).action === "saved");
}

// ── Exporting writes out the design on screen ────────────────────────────
//
// Saving decides which file it is writing from the Room Name — "the Room Name
// is the file name". Exporting preferred the last design opened from the
// server instead, so drawing something new and exporting it handed you a file
// named after somebody else's room.
{
  check("export names the file the way saving does",
    /const slug = P\.roomSlug\(store\.room\.name\);/.test(app)
    && /return \(slug \|\| store\.serverRoomName/.test(app));
  check("and saving still decides the same way",
    /const slug = P\.roomSlug\(store\.room\.name\);\s*\n\s*const target = slug \|\| store\.serverRoomName/.test(app));
}

// ── The constant sync check ──────────────────────────────────────────────
//
// Pushing an edit and hoping it lands is fine until one does not. A dropped
// stream or a sleeping laptop left two people editing what they each believed
// was the same drawing, with no way back. So a live client asks every couple of
// seconds whether it still matches, and this runs that real code — the timer
// and the network handed in, so the guards can be exercised rather than read.
{
  const start = app.indexOf("let livePushTimer = null;");
  const end = app.indexOf("// MARK: - Store change subscription", start);
  check("the sync code can be located", start > 0 && end > start);

  // The interval is read out of the app rather than restated here: a test that
  // repeats the number it is checking passes whatever the number becomes.
  const declared = Number((app.match(/const LIVE_SYNC_MS = (\d+);/) || [])[1]);
  check("the app declares how often to check", Number.isFinite(declared));
  check("which is a couple of seconds, as asked for",
    declared >= 1000 && declared <= 3000);

  const build = () => {
    const calls = [];
    let scheduled = null;
    const store = {
      live: true, serverRoomName: "flat", serverRoomVersion: 2,
      dragTransactionActive: false, room: { walls: [{ id: "w-1" }] },
      status: "", emit() {}, applied: null,
      applyRemoteRoom(room, version) { this.room = room; this.applied = version; },
    };
    let reply = { inSync: true, version: 2 };
    const pushes = [];
    let pushAnswer = { ok: true };
    const fetchStub = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => reply };
    };
    const api = new Function(
      "store", "P", "CLIENT_ID", "fetch", "apiLiveDraft", "toast",
      "setInterval", "clearInterval", "setTimeout", "clearTimeout",
      `const LIVE_SYNC_MS = ${declared};\nlet liveSeq = 0;\n` + app.slice(start, end) +
      "\nreturn { checkLiveSync, startLiveSync, stopLiveSync, scheduleLivePush, pushLiveDraft, seq: () => liveSeq };"
    )(
      store,
      { serializeRoom: r => JSON.stringify(r), parseRoom: t => JSON.parse(t) },
      "me", fetchStub,
      async (json, name, clientId, version, baseSeq) => {
        pushes.push({ json, name, clientId, version, baseSeq });
        return pushAnswer;
      },
      () => {},
      (fn, ms) => { scheduled = { fn, ms }; return 1; },
      () => { scheduled = null; },
      () => 1, () => {},
    );
    return {
      api, store, calls, timer: () => scheduled, pushes,
      reply: v => { reply = v; },
      answerPushWith: v => { pushAnswer = v; },
    };
  };

  // It asks, on a timer, with a fingerprint rather than the drawing.
  {
    const { api, calls, timer } = build();
    api.startLiveSync();
    check("joining live schedules a repeating check", timer() !== null);
    check("and it uses that interval rather than one of its own",
      timer() && timer().ms === declared);
    await timer().fn();
    check("and it asks the server", calls.length === 1);
    check("it asks about the room it is in",
      calls[0] && calls[0].url === "/api/live-check/flat");
    check("it sends a fingerprint, not the whole drawing",
      calls[0] && /^[0-9a-f]{64}$/.test(calls[0].body.digest) && calls[0].body.json === undefined);
    check("the fingerprint is the one the server computes",
      calls[0] && calls[0].body.digest
        === createHash("sha256").update(JSON.stringify({ walls: [{ id: "w-1" }] })).digest("hex"));
    api.stopLiveSync();
    check("leaving live stops the check", timer() === null);
  }

  // Told it agrees, it changes nothing but the version it is on.
  {
    const { api, store, reply } = build();
    reply({ inSync: true, version: 7 });
    await api.checkLiveSync();
    check("agreeing leaves the drawing alone", store.room.walls[0].id === "w-1");
    check("and moves it onto the version everyone is on", store.serverRoomVersion === 7);
    check("agreeing is not announced as an event", store.status === "");
  }

  // Told it has drifted, it takes the shared state.
  {
    const { api, store, reply } = build();
    reply({ inSync: false, json: JSON.stringify({ walls: [{ id: "w-theirs" }] }), version: 9 });
    await api.checkLiveSync();
    check("drifting is corrected from the shared state",
      store.room.walls.length === 1 && store.room.walls[0].id === "w-theirs");
    check("and carries the version with it", store.applied === 9);
    check("and the person is told why their drawing moved",
      /caught up/i.test(store.status));
  }

  // The guards. Asking while holding unpublished work would answer "you
  // differ" for the good reason that WE changed it — and taking that answer
  // would throw away the very edit being made.
  {
    const { api, calls } = build();
    api.scheduleLivePush();                 // an edit is waiting to go out
    await api.checkLiveSync();
    check("a client with unpublished work does not ask", calls.length === 0);
  }
  {
    const { api, store, calls } = build();
    store.dragTransactionActive = true;
    await api.checkLiveSync();
    check("a client mid-drag does not ask", calls.length === 0);
  }
  {
    const { api, store, calls } = build();
    store.live = false;
    await api.checkLiveSync();
    check("a client that has not joined live does not ask", calls.length === 0);
  }
  {
    const { api, store, calls } = build();
    store.serverRoomName = null;
    await api.checkLiveSync();
    check("a client with no room on the server does not ask", calls.length === 0);
  }

  // Publishing an edit built on a copy that has moved on is how a whole
  // afternoon of somebody else's design disappeared: this client's older
  // picture replaced it for everyone. The edit is published against the
  // sequence the copy is based on, and a refusal is caught up from, not
  // retried.
  {
    const { api, store, pushes, answerPushWith } = build();
    answerPushWith({ ok: true, seq: 5 });
    api.pushLiveDraft();
    await new Promise(r => setTimeout(r, 0));
    check("an edit is published against the copy it was made on",
      pushes.length === 1 && pushes[0].baseSeq === 0, JSON.stringify(pushes[0]));
    check("and the client moves on to what the server assigned", api.seq() === 5);

    api.pushLiveDraft();
    await new Promise(r => setTimeout(r, 0));
    check("so the next edit is published against that",
      pushes.length === 2 && pushes[1].baseSeq === 5, JSON.stringify(pushes[1]));
    check("the room really is what gets sent",
      JSON.parse(pushes[1].json).walls[0].id === "w-1");
    check("and it is sent for the room this client is in",
      pushes[1].name === "flat" && pushes[1].version === 2);
    check("nothing was applied over the person's own work", store.room.walls[0].id === "w-1");
  }
  {
    const { api, store, answerPushWith } = build();
    answerPushWith({
      ok: false, stale: true, seq: 9, version: 4,
      json: JSON.stringify({ walls: [{ id: "w-theirs" }] }),
    });
    api.pushLiveDraft();
    await new Promise(r => setTimeout(r, 0));
    check("a refused edit leaves the client on the shared state, not its own",
      store.room.walls.length === 1 && store.room.walls[0].id === "w-theirs");
    check("carrying the version that state is on", store.applied === 4);
    check("and the sequence to publish against next", api.seq() === 9);
    check("the person is told their copy was out of date, in words they can act on",
      /out of date/i.test(store.status) && /again/i.test(store.status), store.status);
  }

  // The sequence has to be taken from a message BEFORE deciding to ignore it.
  // A client ignores the echo of its own save — and that echo is the only place
  // it learns the sequence the save moved the room to. Read it afterwards and
  // the person who just saved cannot publish anything else: every edit they
  // make is refused as built on an out-of-date copy.
  {
    const handler = app.slice(app.indexOf("eventSource.onmessage"),
                              app.indexOf("} catch (err) {", app.indexOf("eventSource.onmessage")));
    const takesSeq = handler.indexOf("liveSeq = data.seq");
    const ignores = handler.indexOf('action === "ignore"');
    check("the stream handler reads the sequence", takesSeq > 0);
    check("and does it before deciding to ignore the message",
      takesSeq > 0 && ignores > 0 && takesSeq < ignores,
      `sequence at ${takesSeq}, ignore at ${ignores}`);
  }

  // Wiring: the timer is worthless if nothing starts or stops it.
  check("joining live starts the sync",
    /store\.live = true;[\s\S]{0,400}startLiveSync\(\);/.test(app));
  check("leaving live stops it",
    /store\.live = false;[\s\S]{0,200}stopLiveSync\(\);/.test(app));
  check("and detaching the watcher stops it too",
    /function stopWatching\([^)]*\) \{\s*\n\s*stopLiveSync\(\);/.test(app));
  check("but re-watching a room does not silently stop checking",
    /if \(store\.live\) startLiveSync\(\);/.test(app));
}

console.log(`${passed} passed, ${failed} failed — live collaboration UI contracts`);
if (failed) process.exit(1);
