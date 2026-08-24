// Five people in the same room at the same time.
//
// The live-mode contracts test the DECISION the watcher makes. They cannot tell
// you whether a wall drawn on one screen actually arrives on four others: that
// needs a real server, real event streams, and a real store at the far end.
// This is that test, end to end —
//
//   a throwaway API server on its own port and its own database
//   -> five clients watching the same room over Server-Sent Events
//   -> one of them drawing walls and placing furniture
//   -> the other four running the real liveUpdateAction and the real store
//
// It was written after live editing was reported broken between two machines,
// and the bug it would have caught was this: a live draft carries the SENDER's
// version, and the receiver dropped any draft whose version was not its own. So
// it worked until somebody saved, and then never again.
//
// Run:  node tests/live-multi.test.mjs

import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import sqlite from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = "liveteam";

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const work = mkdtempSync(join(tmpdir(), "roomcad-live-"));
let server = null;
const stop = () => {
  if (server) { try { server.kill("SIGKILL"); } catch {} server = null; }
  try { rmSync(work, { recursive: true, force: true }); } catch {}
};
process.on("exit", stop);

// ── A server of its own, on its own port, with its own database ──────────
const dbPath = join(work, "rooms.db");
server = spawn("python3", [join(root, "roomcad", "server", "server.py")], {
  env: {
    ...process.env,
    ROOMCAD_PORT: String(PORT),
    ROOMCAD_DB_PATH: dbPath,
    ROOMCAD_LEGACY_DIR: join(work, "rooms"),
    ROOMCAD_PASSWORD: "not-used-a-session-is-seeded-directly",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", d => { serverLog += d; });
server.stderr.on("data", d => { serverLog += d; });

const waitFor = async (test, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await test()) return true; } catch {}
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
};

const up = await waitFor(async () => (await fetch(BASE + "/api/rooms")).status === 401);
check("the test server came up", up, serverLog.slice(-400));
if (!up) { stop(); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }

// A session, put straight into the database — no password goes near this test.
const token = randomBytes(18).toString("base64url");
{
  const db = new sqlite.DatabaseSync(dbPath);
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT OR REPLACE INTO browser_sessions (token_hash, created_at, expires_at) VALUES (?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), now, now + 3600);
  db.close();
}
const COOKIE = { Cookie: `roomcad_auth=${token}` };
check("the seeded session is accepted",
  (await fetch(BASE + "/api/rooms", { headers: COOKIE })).status === 200);

// ── The real client pieces ───────────────────────────────────────────────
const P = await import(join(root, "roomcad", "web", "plan.js"));

// liveUpdateAction, lifted out of app.js — app.js reaches for the DOM on load.
const appSrc = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
const fnSrc = appSrc.slice(appSrc.indexOf("export function liveUpdateAction"));
const { liveUpdateAction } = await import("data:text/javascript;base64," +
  Buffer.from(fnSrc.slice(0, fnSrc.indexOf("\nfunction watchRoom")), "utf8").toString("base64"));

/// Five independent stores. ESM caches by URL, so a distinct query string is a
/// distinct module — which is what makes five separate people rather than one
/// person with five names.
const storeURL = "file://" + join(root, "roomcad", "web", "store.js");
const clients = [];
for (let i = 0; i < 5; i++) {
  const mod = await import(`${storeURL}?client=${i}`);
  clients.push({ id: "client-" + i, store: mod.store, applied: 0, ignored: 0, held: 0 });
}
check("five separate clients, five separate rooms",
  new Set(clients.map(c => c.store.room)).size === 5);

// ── The room they will all work on ───────────────────────────────────────
const blank = P.freshRoom("Team Room", 6, 5, 2.6);
blank.origin = { x: 0, z: 0 };
P.sanitize(blank);
const created = await (await fetch(BASE + "/api/save", {
  method: "POST", headers: { "Content-Type": "application/json", ...COOKIE },
  body: JSON.stringify({ json: P.serializeRoom(blank), name: ROOM, clientId: "client-0" }),
})).json();
check("the room is created at v0", created.name === ROOM && created.version === 0,
  JSON.stringify(created));

for (const c of clients) {
  c.store.room = P.parseRoom(P.serializeRoom(blank));
  c.store.serverRoomName = ROOM;
  c.store.serverRoomVersion = created.version;
  c.store.live = true;                       // everyone has pressed Join Live
}

// ── Each client watches the room ─────────────────────────────────────────
/// Reads one Server-Sent Events stream and feeds every message through the very
/// code the browser runs.
async function watch(client) {
  const res = await fetch(BASE + "/api/watch/" + ROOM, { headers: COOKIE });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  client.stop = () => reader.cancel().catch(() => {});
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = frame.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          let data;
          try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
          const { action, version } = liveUpdateAction(data, {
            serverRoomName: client.store.serverRoomName,
            serverRoomVersion: client.store.serverRoomVersion,
            clientId: client.id,
            live: client.store.live,
            dragTransactionActive: false,
          });
          if (action === "ignore") { client.ignored++; continue; }
          if (action === "hold") { client.held++; continue; }
          // The version comes from liveUpdateAction, not worked out again here:
          // a test that decides it for itself cannot tell you the app decides
          // it correctly.
          client.store.applyRemoteRoom(P.parseRoom(data.json), version);
          client.applied++;
        }
      }
    } catch { /* cancelled */ }
  })();
}
for (const c of clients) await watch(c);
await new Promise(r => setTimeout(r, 400));

const author = clients[0];
const audience = clients.slice(1);
const push = async (version) => {
  await fetch(BASE + "/api/live/" + ROOM, {
    method: "POST", headers: { "Content-Type": "application/json", ...COOKIE },
    body: JSON.stringify({
      json: P.serializeRoom(author.store.room), clientId: author.id, version,
    }),
  });
  await new Promise(r => setTimeout(r, 250));
};

// ── One of them draws walls ──────────────────────────────────────────────
author.store.room.walls.push({ id: "w-a", start: P.point(1, 1), end: P.point(5, 1) });
author.store.room.walls.push({ id: "w-b", start: P.point(5, 1), end: P.point(5, 4) });
await push(author.store.serverRoomVersion);

check("everyone else got the walls",
  audience.every(c => c.store.room.walls.some(w => w.id === "w-a")
                   && c.store.room.walls.some(w => w.id === "w-b")),
  audience.map(c => `${c.id}:${c.store.room.walls.length}`).join(" "));
check("the author did not receive their own echo",
  author.applied === 0 && author.ignored > 0, `applied ${author.applied}`);

// ── And places furniture ─────────────────────────────────────────────────
const kind = Object.keys(P.FURNITURE_KINDS)[0];
author.store.room.furniture.push({
  id: "f-1", kind, center: P.point(2.5, 2.5), rotation: 0,
});
await push(author.store.serverRoomVersion);
check("everyone else got the furniture",
  audience.every(c => c.store.room.furniture.some(f => f.id === "f-1")),
  audience.map(c => `${c.id}:${c.store.room.furniture.length}`).join(" "));

// ── Somebody saves. This is where it used to die ─────────────────────────
const saved = await (await fetch(BASE + "/api/save", {
  method: "POST", headers: { "Content-Type": "application/json", ...COOKIE },
  body: JSON.stringify({
    json: P.serializeRoom(author.store.room), name: ROOM, clientId: author.id,
  }),
})).json();
author.store.serverRoomVersion = saved.version;
await new Promise(r => setTimeout(r, 350));
check("saving moves the version on", saved.version === 1, JSON.stringify(saved));
check("and the audience is told which version they are on",
  audience.every(c => c.store.serverRoomVersion === saved.version),
  audience.map(c => `${c.id}:v${c.store.serverRoomVersion}`).join(" "));

// Now the author keeps drawing. Before the fix every one of these was dropped,
// because the author's version had moved and the audience's had not.
author.store.room.walls.push({ id: "w-after-save", start: P.point(1, 4), end: P.point(5, 4) });
await push(author.store.serverRoomVersion);
check("live edits still arrive AFTER a save",
  audience.every(c => c.store.room.walls.some(w => w.id === "w-after-save")),
  audience.map(c => `${c.id}:${c.store.room.walls.map(w => w.id).join("/")}`).join("  "));

// And with the audience deliberately left on an older version, which is what
// happens when someone opens an earlier version from the picker.
for (const c of audience) c.store.serverRoomVersion = 0;
author.store.room.furniture.push({
  id: "f-2", kind, center: P.point(3.5, 2.0), rotation: 0,
});
await push(saved.version);
check("and arrive even when the audience is on a different version",
  audience.every(c => c.store.room.furniture.some(f => f.id === "f-2")),
  audience.map(c => `${c.id}:${c.store.room.furniture.length}`).join(" "));
// A live draft carries the sender's version, and taking it is what puts the
// audience back on the same baseline. Without it they stay where they were and
// the version on their screen is a lie — which is the whole point of showing it
// ("so with the audience I can check that we work on v3 of file x"). The save
// broadcast alone does not cover this: someone who joins after the save, or
// misses it, has only the drafts to tell them.
check("a live draft brings the audience onto the sender's version",
  audience.every(c => c.store.serverRoomVersion === saved.version),
  audience.map(c => `${c.id}:v${c.store.serverRoomVersion}`).join(" ") + ` — sender is on v${saved.version}`);

// ── Everyone ends up with the same drawing ───────────────────────────────
// Compared like for like: the audience's rooms have been through parse, and the
// author's has not, so the author's is round-tripped once before the comparison.
// Otherwise this measures the serialiser filling in defaults rather than whether
// the five people are looking at the same drawing.
const mine = P.serializeRoom(P.parseRoom(P.serializeRoom(author.store.room)));
check("all five rooms agree, wall for wall and chair for chair",
  audience.every(c => P.serializeRoom(c.store.room) === mine),
  audience.map(c => `${c.id}:${P.serializeRoom(c.store.room) === mine ? "same" : "DIFFERENT"}`).join(" "));
check("every one of the four received every update",
  audience.every(c => c.applied >= 4), audience.map(c => `${c.id}:${c.applied}`).join(" "));

// ── Everyone draws, and everyone sees it, quickly ────────────────────────
//
// Not one author and four spectators: each of the five in turn draws a wall and
// places a piece of furniture, and the other four have to have it. Measured
// from the moment the edit is published to the moment the last of the others
// has applied it — that is the number a person in the room actually feels.
{
  const SECOND = 1000;
  const waitAll = async (has, ms = 5000) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (clients.filter(c => c.store.live).every(c => c === author || has(c)) ) return Date.now() - started;
      await new Promise(r => setTimeout(r, 10));
    }
    return Infinity;
  };

  const took = [];
  let allArrived = true;
  for (let turn = 0; turn < clients.length; turn++) {
    const who = clients[turn];
    const others = clients.filter(c => c !== who && c.store.live);
    const wallID = `w-turn-${turn}`;
    const chairID = `f-turn-${turn}`;
    who.store.room.walls.push({
      id: wallID, start: P.point(0.5 + turn * 0.2, 0.5), end: P.point(0.5 + turn * 0.2, 3.5),
    });
    who.store.room.furniture.push({
      id: chairID, kind, center: P.point(1 + turn * 0.4, 3.6), rotation: 0,
    });

    const at = Date.now();
    await fetch(BASE + "/api/live/" + ROOM, {
      method: "POST", headers: { "Content-Type": "application/json", ...COOKIE },
      body: JSON.stringify({
        json: P.serializeRoom(who.store.room), clientId: who.id,
        version: who.store.serverRoomVersion,
      }),
    });
    const seen = () => {
      const started = Date.now();
      return new Promise(resolve => {
        const poll = () => {
          const done = others.every(c =>
            c.store.room.walls.some(w => w.id === wallID)
            && c.store.room.furniture.some(f => f.id === chairID));
          if (done) return resolve(Date.now() - started);
          if (Date.now() - started > 5000) return resolve(Infinity);
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    const elapsed = await seen();
    took.push({ who: who.id, ms: elapsed, others: others.length });
    if (!Number.isFinite(elapsed)) allArrived = false;
    void at;
  }
  void waitAll;

  console.error("    sync latency: " + took.map(t => t.who + " -> " + t.others + " others in " + t.ms + "ms").join("  "));
  check("every client's own drawing reached everyone else",
    allArrived, took.map(t => `${t.who}:${t.ms === Infinity ? "NEVER" : t.ms + "ms"}`).join(" "));
  const worst = Math.max(...took.map(t => t.ms));
  check("and got there in under a second",
    worst < SECOND,
    took.map(t => `${t.who} -> ${t.others} others in ${t.ms}ms`).join(" | "));
  check("all five turns were taken, not just the first",
    took.length === clients.length && took.every(t => t.others >= 1));

  // After five people have each drawn on top of the last, everyone still holds
  // the same drawing.
  // Compared as the drawing rather than as bytes: whoever published last still
  // holds their own room, which has not been through a parse, and the others
  // hold the parsed copy. What has to be true is that everyone has the same
  // walls and the same furniture.
  const shape = (c) => {
    const r = c.store.room;
    return r.walls.map(w => w.id).sort().join(",") + " | "
      + r.furniture.map(f => f.id).sort().join(",");
  };
  const settled = shape(clients[0]);
  check("and after everyone has drawn, all five still agree",
    clients.filter(c => c.store.live).every(c => shape(c) === settled),
    clients.map(c => `${c.id}:${shape(c) === settled ? "same" : "DIFFERENT"}`).join(" "));
  check("with all five turns' work present, not just the last",
    settled.split(" | ")[0].split(",").filter(id => id.startsWith("w-turn-")).length === clients.length,
    settled.slice(0, 120));
}

// ── A viewer who has not joined only holds the draft ─────────────────────
{
  const watcher = clients[4];
  watcher.store.live = false;
  const before = watcher.applied;
  author.store.room.walls.push({ id: "w-not-joined", start: P.point(1, 1), end: P.point(1, 4) });
  await push(saved.version);
  check("someone who has not pressed Join Live is not overwritten",
    watcher.applied === before && !watcher.store.room.walls.some(w => w.id === "w-not-joined"),
    `applied ${watcher.applied - before}, held ${watcher.held}`);
  check("but the others still get it",
    clients.slice(1, 4).every(c => c.store.room.walls.some(w => w.id === "w-not-joined")));
}

for (const c of clients) if (c.stop) c.stop();
stop();
console.log(`${passed} passed, ${failed} failed — five clients on one room`);
if (failed) process.exit(1);
