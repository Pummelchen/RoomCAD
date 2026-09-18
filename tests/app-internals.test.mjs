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
// Everything here is now the real module: app/ui.js exports esc(), app/status.js
// exports roomDigest()/updateVersionBadge(), app/sidebar.js exports validWidth(),
// and exportBaseName() is driven through its only caller, exportRoom(), by
// reading the download name it hands the browser. Nothing is lifted out of the
// source any more.
//
// Run:  node tests/app-internals.test.mjs

import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { appSource } from "./harness/app-source.mjs";

const app = appSource();

// Before anything from the app is imported: a bare specifier inside
// roomcad/web/ resolves through the page's own import map. The real page goes
// in the DOM so app/ui.js finds the elements it binds, and so exportRoom() has
// a body to append its download link to.
registerHooks({ resolve });
const dom = installDOM({ page: true });

const { esc } = await import("../roomcad/web/app/ui.js");
const { roomDigest, updateVersionBadge } = await import("../roomcad/web/app/status.js");
const { validWidth } = await import("../roomcad/web/app/sidebar.js");
const { exportRoom } = await import("../roomcad/web/app/files.js");
const { store } = await import("../roomcad/web/store.js");
const { APP_VERSION } = await import("../roomcad/web/version.js");
const P = await import("../roomcad/web/plan.js");

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

/// The source still has to contain the function under test — the check the
/// lifting helper used to make before it built one. It can fail: delete the
/// function and this goes red.
function located(header) {
  const body = sliceFn(app, header);
  check(`${header.replace(/\(.*/, "")} can be located`, !!body);
  return body;
}

// ── esc(): the HTML escaping boundary ─────────────────────────────────────
{
  located("function esc(s) {");

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

// Every innerHTML assignment in the app package goes through an escaper. The
// app's discipline is the `safeHtml` tag, which escapes each raw interpolation
// itself and cannot be forgotten at a call site the way a hand-written esc()
// can; a quoted literal and an esc() call are the two other safe forms. A plain
// template literal, a variable, or any other call is the hole this catches.
{
  const offenders = [];
  for (const m of app.matchAll(/\.innerHTML\s*\+?=\s*/g)) {
    const rest = app.slice(m.index + m[0].length);
    if (/^safeHtml`/.test(rest) || /^esc\(/.test(rest) || /^["']/.test(rest)) continue;
    const lineStart = app.lastIndexOf("\n", m.index) + 1;
    const lineEnd = app.indexOf("\n", m.index);
    offenders.push(app.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim());
  }
  check("every innerHTML assignment is a safeHtml tag, an esc() call, or a quoted literal",
    offenders.length === 0, offenders.join(" | "));

  // And the escape hatch is not bypassed wholesale.
  check("no innerHTML is built straight from a room name",
    !/innerHTML\s*=\s*[^;`]*(room\.name|label\.text)/.test(app));
  // The room list renders a teammate-chosen name, so it must be interpolated
  // inside the escaping tag rather than into a plain template.
  check("the room list feeds the room name through the escaping tag",
    /button\.innerHTML = safeHtml`<div class="room-name">\$\{r\.name\}<\/div>/.test(app));
}

// ── roomDigest(): the live-sync drift check ───────────────────────────────
{
  located("async function roomDigest(json) {");

  // Cross-checked against Node's own SHA-256, so this is not just "it returns
  // something consistent with itself".
  const expected = json => createHash("sha256").update(json, "utf8").digest("hex");

  check("the digest is the SHA-256 of the document, as hex",
    await roomDigest("hello") === expected("hello"));
  check("it is 64 hex characters", (await roomDigest("x")).length === 64
    && /^[0-9a-f]{64}$/.test(await roomDigest("x")));
  check("a different document gives a different digest",
    await roomDigest("a") !== await roomDigest("b"));
  const digestOnce = await roomDigest("same");
  const digestAgain = await roomDigest("same");
  check("the same document is stable", digestOnce === digestAgain);
  // The room is UTF-8 in the file and on the wire; hashing must agree.
  check("non-ASCII hashes as UTF-8, not as code units",
    await roomDigest("Küche 台所") === expected("Küche 台所"));
  check("an empty document still hashes", (await roomDigest("")).length === 64);
}

// ── exportBaseName(): what the downloaded file is called ──────────────────
//
// exportBaseName() is private, but it has exactly one caller — exportRoom() —
// and the name it computes is the name the browser is handed. So it is driven
// through the real export path and the download link's own `download` is read
// back. The REAL slug is used, because that is what app.js calls.
{
  /// Runs exportRoom() with the store pointed at the given names and returns
  /// the base name it put on the download (the ".rcad" suffix removed).
  const downloadName = ({ name = "", serverRoomName = null, documentName = null } = {}) => {
    located("function exportBaseName() {");
    // The name is set AFTER the parse round-trip: parseRoom() defaults an empty
    // name, and the empty-name fallbacks are exactly what is under test here.
    // exportRoom() computes the base name before it serialises, so the name
    // that reaches exportBaseName() is the one set here.
    const room = P.parseRoom(P.serializeRoom(P.freshRoom(name || "x")));
    room.name = name;
    store.room = room;
    store.serverRoomName = serverRoomName;
    store.documentName = documentName;

    const anchors = [];
    const realCreate = dom.document.createElement.bind(dom.document);
    dom.document.createElement = tag => {
      const el = realCreate(tag);
      if (String(tag).toLowerCase() === "a") anchors.push(el);
      return el;
    };
    try {
      exportRoom("rcad");
    } finally {
      dom.document.createElement = realCreate;
    }
    return anchors[anchors.length - 1].download.replace(/\.rcad$/, "");
  };

  check("the Room Name is the file name",
    downloadName({ name: "My Room" }) === "My-Room");
  check("accents are folded rather than dropped",
    downloadName({ name: "Küche" }) === "Kuche");
  check("a name with nothing slug-able falls back to the server name",
    downloadName({ name: "###", serverRoomName: "ternak_room1" }) === "ternak_room1");
  check("and then to the opened document",
    downloadName({ name: "", documentName: "opened.rcad" }) === "opened.rcad");
  check("and then to something, rather than nothing",
    downloadName({ name: "" }) === "room");
  check("a hostile name cannot escape the download directory",
    !downloadName({ name: "../../etc/passwd" }).includes("/"),
    downloadName({ name: "../../etc/passwd" }));
  check("and comes out as one usable file name",
    /^[A-Za-z0-9._-]+$/.test(downloadName({ name: "../../etc/passwd" })),
    downloadName({ name: "../../etc/passwd" }));
  check("a long name is capped by the slug",
    downloadName({ name: "x".repeat(200) }).length <= 48);
}

// ── validWidth(): a saved panel width that is not a number ────────────────
{
  located("function validWidth(value, fallback) {");

  check("a finite width is used", validWidth(240, 200) === 240);
  check("zero and negatives are numbers, and left alone", validWidth(0, 200) === 0);
  check("NaN falls back rather than collapsing the panel", validWidth(NaN, 200) === 200);
  check("Infinity falls back too", validWidth(Infinity, 200) === 200);
  check("a string from corrupt local storage falls back", validWidth("wide", 200) === 200);
}

// ── updateVersionBadge(): the footer, which is how you know what is live ──
{
  const badge = dom.document.getElementById("app-version");
  const build = ({ serverLatency = null, serverOffline = false } = {}) => {
    located("function updateVersionBadge() {");
    store.serverLatency = serverLatency;
    store.serverOffline = serverOffline;
    updateVersionBadge();
    return badge.innerHTML;
  };

  check("no latency yet, and online: just the version",
    build({ serverLatency: null, serverOffline: false }) === "v" + APP_VERSION);
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
