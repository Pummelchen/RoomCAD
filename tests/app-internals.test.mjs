// app.js: the parts that can be tested without a browser.
//
// app.js is the largest untested surface in the repository and it touches the
// DOM everywhere, which is why only fragments of it were ever exercised
// (liveUpdateAction, the sidebar functions, the mode switch). These are the
// pieces that carry real risk and need no DOM at all: the HTML escaping
// boundary, the drift-check digest, the export file name, and the footer badge.
//
// The escaping one matters most. `esc()` is the only thing between a room name
// or a label — text the user types, and text that arrives from a teammate over
// the live channel — and the innerHTML it is interpolated into. The function was
// never tested and its use was per-call-site, so a new interpolation that forgot
// it would be an XSS hole with nothing to notice.
//
// Run:  node tests/app-internals.test.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const app = readFileSync(join(web, "app.js"), "utf8");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// The source of one function, from its header to its closing brace at column 0.
function sliceFn(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  const end = src.indexOf("\n}", start);
  return src.slice(start, end + 2);
}

/// Builds a function from the real source with its free variables injected.
function lift(header, params = [], extra = "") {
  const body = sliceFn(app, header);
  check(`${header.replace(/\(.*/, "")} can be located`, !!body);
  return new Function(...params, `${body}\n${extra}`);
}

// ── esc(): the HTML escaping boundary ─────────────────────────────────────
{
  const esc = lift("function esc(s) {", [], "return esc;")();

  check("angle brackets are escaped", esc("<b>") === "&lt;b&gt;");
  check("so a script tag cannot open", esc("<script>alert(1)</script>")
    === "&lt;script&gt;alert(1)&lt;/script&gt;");
  check("double quotes are escaped, so a value= attribute cannot be broken out of",
    esc('" onfocus="alert(1)') === "&quot; onfocus=&quot;alert(1)");
  check("single quotes are escaped too", esc("' onfocus='x") === "&#39; onfocus=&#39;x");
  check("ampersands are escaped first, so the result is not double-decoded",
    esc("&lt;") === "&amp;lt;");
  check("a number is stringified rather than throwing", esc(42) === "42");
  check("null and undefined do not throw", esc(null) === "null" && esc(undefined) === "undefined");
}

// Every place a user-controlled value is interpolated into an HTML template is
// escaped. Values the user types, or a teammate's edits arriving over the live
// channel, are exactly the ones that reach innerHTML.
{
  const sensitive = ["room.name", "label.text", "r.name", "check.reason", "kind.title", "area.name"];
  const unescaped = [];
  for (const m of app.matchAll(/\$\{([^{}]*)\}/g)) {
    const expr = m[1];
    if (!sensitive.some(s => expr.includes(s))) continue;
    if (!/^\s*esc\(/.test(expr)) unescaped.push(expr);
  }
  check("every user-controlled value in an HTML template goes through esc()",
    unescaped.length === 0, unescaped.join(" | "));

  // And the escape hatch is not bypassed wholesale.
  check("no innerHTML is built straight from a room name",
    !/innerHTML\s*=\s*[^;`]*(room\.name|label\.text)/.test(app));
  check("the room list escapes the names it renders",
    (app.match(/class="room-name">\$\{esc\(r\.name\)\}/g) || []).length >= 1);
}

// ── roomDigest(): the live-sync drift check ───────────────────────────────
{
  const roomDigest = lift("async function roomDigest(json) {",
    ["TextEncoder", "crypto"], "return roomDigest;")(TextEncoder, globalThis.crypto);

  // Cross-checked against Node's own SHA-256, so this is not just "it returns
  // something consistent with itself".
  const expected = json => createHash("sha256").update(json, "utf8").digest("hex");

  check("the digest is the SHA-256 of the document, as hex",
    await roomDigest("hello") === expected("hello"));
  check("it is 64 hex characters", (await roomDigest("x")).length === 64
    && /^[0-9a-f]{64}$/.test(await roomDigest("x")));
  check("a different document gives a different digest",
    await roomDigest("a") !== await roomDigest("b"));
  check("the same document is stable", await roomDigest("same") === await roomDigest("same"));
  // The room is UTF-8 in the file and on the wire; hashing must agree.
  check("non-ASCII hashes as UTF-8, not as code units",
    await roomDigest("Küche 台所") === expected("Küche 台所"));
  check("an empty document still hashes", (await roomDigest("")).length === 64);
}

// ── exportBaseName(): what the downloaded file is called ──────────────────
{
  // The REAL slug, not a stand-in: app.js calls P.roomSlug, and a local
  // imitation would keep passing while the real one changed underneath it.
  const P = await import(join(web, "plan.js"));
  const build = (store) => lift("function exportBaseName() {",
    ["P", "store"], "return exportBaseName;")(P, store);

  check("the Room Name is the file name",
    build({ room: { name: "My Room" } })() === "My-Room");
  check("accents are folded rather than dropped",
    build({ room: { name: "Küche" } })() === "Kuche");
  check("a name with nothing slug-able falls back to the server name",
    build({ room: { name: "###" }, serverRoomName: "ternak_room1" })() === "ternak_room1");
  check("and then to the opened document",
    build({ room: { name: "" }, documentName: "opened.rcad" })() === "opened.rcad");
  check("and then to something, rather than nothing",
    build({ room: { name: "" } })() === "room");
  check("a hostile name cannot escape the download directory",
    !build({ room: { name: "../../etc/passwd" } })().includes("/"),
    build({ room: { name: "../../etc/passwd" } })());
  check("and comes out as one usable file name",
    /^[A-Za-z0-9._-]+$/.test(build({ room: { name: "../../etc/passwd" } })()),
    build({ room: { name: "../../etc/passwd" } })());
  check("a long name is capped by the slug",
    build({ room: { name: "x".repeat(200) } })().length <= 48);
}

// ── validWidth(): a saved panel width that is not a number ────────────────
{
  const validWidth = lift("function validWidth(value, fallback) {", [], "return validWidth;")();
  check("a finite width is used", validWidth(240, 200) === 240);
  check("zero and negatives are numbers, and left alone", validWidth(0, 200) === 0);
  check("NaN falls back rather than collapsing the panel", validWidth(NaN, 200) === 200);
  check("Infinity falls back too", validWidth(Infinity, 200) === 200);
  check("a string from corrupt local storage falls back", validWidth("wide", 200) === 200);
}

// ── updateVersionBadge(): the footer, which is how you know what is live ──
{
  const build = (store) => {
    const el = { innerHTML: "" };
    const fn = lift("function updateVersionBadge() {",
      ["APP_VERSION", "store", "appVersion"], "return updateVersionBadge;")(10.6, store, el);
    fn();
    return el.innerHTML;
  };

  check("no latency yet, and online: just the version",
    build({ serverLatency: null, serverOffline: false }) === "v10.6");
  check("a fast server is green",
    build({ serverLatency: 40, serverOffline: false }).includes("lat-green"));
  check("the green/orange boundary is at 150 ms",
    build({ serverLatency: 149, serverOffline: false }).includes("lat-green")
    && build({ serverLatency: 150, serverOffline: false }).includes("lat-orange"));
  check("the orange/red boundary is at 400 ms",
    build({ serverLatency: 399, serverOffline: false }).includes("lat-orange")
    && build({ serverLatency: 400, serverOffline: false }).includes("lat-red"));
  check("an offline server says so, and says so in red",
    build({ serverLatency: null, serverOffline: true }).includes("offline")
    && build({ serverLatency: null, serverOffline: true }).includes("lat-red"));
  check("the reading is shown in milliseconds",
    build({ serverLatency: 230, serverOffline: false }).includes("230ms"));
}

console.log(`${passed} passed, ${failed} failed — app internals`);
if (failed) process.exit(1);
