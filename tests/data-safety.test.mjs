// Contracts for the things that can destroy a user's work.
//
// RoomCAD keeps every save as a version on the server, so a wrong delete is not
// one lost file but a lost history. These checks guard the paths that can issue
// one, and the client-side guards around a save.
//
// The bug that prompted this file: opening a saved room wrapped the whole load
// in try/catch, and the catch called removeStoredRoom() — which issues
// DELETE /api/rooms/<name> and drops the file and every version of it. Any
// failure at all, including a dropped connection, therefore destroyed the room
// the user was merely trying to open. Reproduced with a single simulated
// network error: three versions, gone.
//
// Run:  node tests/data-safety.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appRaw = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
// Comments discuss the very calls being checked for — this file's own subject
// is named in a comment explaining why it is no longer called — so the checks
// look at code only. Whole-line comments are dropped; trailing ones are left
// alone so a string containing "//" (a URL) survives intact.
const app = appRaw.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const server = readFileSync(join(root, "roomcad", "server", "server.py"), "utf8");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// The body of a named async function, up to the next top-level declaration.
function bodyOf(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nasync function ", start + 1);
  const next2 = src.indexOf("\nfunction ", start + 1);
  const end = Math.min(next < 0 ? src.length : next, next2 < 0 ? src.length : next2);
  return src.slice(start, end);
}

// ── Opening a room is a read. A read that fails must cost nothing. ─────────
{
  const open = bodyOf(app, "openStoredRoom");
  check("openStoredRoom exists", open.length > 0);
  check("failing to open a room never deletes it",
    !/removeStoredRoom/.test(open), "its catch must not delete");
  check("failing to open a room issues no DELETE at all",
    !/method:\s*"DELETE"/.test(open) && !/apiDeleteRoom/.test(open));
  check("the failure is reported rather than swallowed",
    /window\.alert\(/.test(open) && /console\.warn\(/.test(open));
  check("the message says the room was left alone",
    /left untouched/i.test(open), "so the user does not assume the worst");
  check("the list is refreshed instead, in case it really is gone",
    /renderRooms\(\)/.test(open));
}

// ── Deleting is only ever an explicit, confirmed user action ──────────────
{
  // Every call to removeStoredRoom, other than its own declaration, must sit
  // behind a confirm(). Checked against the 400 characters preceding the call.
  const callSites = [];
  const re = /removeStoredRoom\(/g;
  let m;
  while ((m = re.exec(app)) !== null) {
    const isDeclaration = /(async\s+)?function\s+$/.test(app.slice(Math.max(0, m.index - 20), m.index));
    if (isDeclaration) continue;
    callSites.push({
      index: m.index,
      confirmed: /window\.confirm\(/.test(app.slice(Math.max(0, m.index - 400), m.index)),
    });
  }
  check("something still deletes rooms, or the menu is broken", callSites.length >= 1,
    `${callSites.length} call sites found`);
  check("every delete call site is guarded by a confirmation",
    callSites.every(c => c.confirmed),
    `${callSites.filter(c => !c.confirmed).length} of ${callSites.length} unguarded`);
  check("the confirmation says the removal is server-side",
    /removes the room from the server/.test(app));
}

// ── The server's delete is all-or-nothing and complete ────────────────────
{
  check("deleting a room removes every version in one statement",
    /DELETE FROM rooms WHERE name=\?/.test(server));
  check("it also clears sessions pointing at the deleted room",
    /UPDATE browser_sessions SET last_room_name=NULL/.test(server));
  check("and drops the in-memory draft, so it cannot outlive the file",
    /LIVE\.pop\(name, None\)/.test(server));
  check("only DELETE can delete — no other verb reaches delete_room",
    (server.match(/delete_room\(/g) || []).length === 2,
    "definition plus exactly one call, from do_DELETE");
}

// ── A login can be ended ──────────────────────────────────────────────────
//
// The session cookie lasts a year. Without a way to end it, signing in on a
// machine you do not own could not be undone.
{
  const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");
  check("there is a sign-out control", /id="sign-out"/.test(html));
  check("it calls the logout endpoint", /\/api\/logout/.test(app));
  check("signing out protects unsaved work first",
    /sign-out[\s\S]{0,400}confirmDiscard\(\)/.test(app));
  check("and asks before doing it",
    /sign-out[\s\S]{0,500}window\.confirm\(/.test(app));
  check("the page reloads either way, so a failed logout still shows the gate",
    /sign-out[\s\S]{0,900}location\.reload\(\)/.test(app));

  check("the server destroys the session rather than only clearing the cookie",
    /def destroy_session/.test(server) && /DELETE FROM browser_sessions WHERE token_hash=\?/.test(server));
  check("logout does not require a valid session",
    /No auth check on purpose/.test(server));
  check("logout expires the cookie", /Max-Age=0/.test(server));
  check("presence is dropped too, so a signed-out tab stops being counted",
    /def destroy_session[\s\S]{0,900}PRESENCE\.pop/.test(server));
}

// ── Unsaved work is not discarded without asking ──────────────────────────
{
  check("there is a guard before abandoning unsaved changes",
    /function confirmDiscard\(/.test(app));
  check("opening another room asks first",
    /openStoredRoom[\s\S]{0,200}confirmDiscard\(\)/.test(app));
}

console.log(`${passed} passed, ${failed} failed — data-safety contracts`);
if (failed) process.exit(1);
