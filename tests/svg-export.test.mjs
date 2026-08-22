// The SVG export is a measured drawing, not a screenshot: it must be valid,
// self-contained, drawn at a real architectural scale, and it must survive
// whatever the room name and labels contain.
//
// Run:  node tests/svg-export.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const asDataUrl = src => "data:text/javascript;base64," + Buffer.from(src).toString("base64");
const planUrl = asDataUrl(readFileSync(join(web, "plan.js"), "utf8"));
const P = await import(planUrl);
const S = await import(asDataUrl(
  readFileSync(join(web, "svg.js"), "utf8").replace('from "./plan.js"', `from "${planUrl}"`)
));

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`);
}

const demo = P.demoRoom();
const svg = S.roomToSVG(demo, { date: "23 Aug 2026" });

// ── A valid, standalone document ───────────────────────────────────────
check("declares the SVG namespace", svg.includes('xmlns="http://www.w3.org/2000/svg"'));
check("opens and closes cleanly", /^<svg[\s>]/.test(svg) && svg.trim().endsWith("</svg>"));
check("every tag that opens is closed",
  (svg.match(/<g[\s>]/g) || []).length === (svg.match(/<\/g>/g) || []).length);
check("carries no external references — it is one file",
  !/<image|xlink:href|<script|url\(/.test(svg));
check("has a viewBox so it scales anywhere", /viewBox="0 0 [\d.]+ [\d.]+"/.test(svg));

// ── Drawn for paper ────────────────────────────────────────────────────
check("the page is sized in millimetres", /width="[\d.]+mm" height="[\d.]+mm"/.test(svg));
check("states the scale it was drawn at", /1 : \d+/.test(svg));
check("uses a scale from the architectural ladder",
  [20, 25, 50, 100, 200, 500].includes(Number((svg.match(/1 : (\d+)/) || [])[1])),
  (svg.match(/1 : (\d+)/) || [])[1]);
check("a small room gets a closer scale than a large one",
  Number((S.roomToSVG(P.freshRoom("S", 4, 3, 2.6), {}).match(/1 : (\d+)/) || [])[1])
  < Number((svg.match(/1 : (\d+)/) || [])[1]));
check("a tall plan may use the sheet in portrait",
  S.chooseScale(7.7, 19.2) === 100, String(S.chooseScale(7.7, 19.2)));
check("names the design in the title block", svg.includes("7-Room Demo"));
check("prints on white, not the editor's dark ground", svg.includes('fill="#ffffff"'));

// ── The plan itself ────────────────────────────────────────────────────
check("walls are drawn as solid bodies", (svg.match(/fill="#111418"/g) || []).length > 10);
check("doors are drawn with their swing arc", (svg.match(/ A /g) || []).length >= demo.doors.length);
check("dimensions are printed in centimetres", /\d+ cm<\/text>/.test(svg));
check("room areas are printed in m²", /[\d.]+ m²/.test(svg));
check("furniture is drawn", svg.includes('stroke="#7c8794"'));

// Openings must be gaps in the wall, not drawn over it.
{
  const room = P.freshRoom("Gap", 6, 4, 2.6);
  P.centerRoom(room);
  const bare = S.roomToSVG(room, {});
  room.doors = [{ id: "d", wallID: room.walls[0].id, offset: 2, width: 1.2, open: true, swingInside: true }];
  const holed = S.roomToSVG(room, {});
  check("a door cuts the wall rather than sitting on it",
    (holed.match(/fill="#111418"/g) || []).length > (bare.match(/fill="#111418"/g) || []).length,
    "wall should split into more pieces");
}

// ── Content is escaped ─────────────────────────────────────────────────
{
  const nasty = P.freshRoom('Bath & "Utility" <plan>', 5, 4, 2.6);
  P.centerRoom(nasty);
  nasty.labels = [{ id: "l", text: '<script>x</script> & "quoted"', center: { x: 2, z: 2 }, rotationDegrees: 0, size: 0.3 }];
  const out = S.roomToSVG(nasty, {});
  check("a name with markup is escaped, not injected", !out.includes("<script>"), "script tag leaked");
  check("ampersands are escaped", out.includes("&amp;"));
  check("the document is still well formed", out.trim().endsWith("</svg>"));
}

// ── Degenerate rooms do not crash it ───────────────────────────────────
{
  const empty = P.freshRoom("Empty", 4, 3, 2.6);
  empty.walls = [];
  empty.doors = [];
  empty.windows = [];
  check("a plan with no walls still exports", S.roomToSVG(empty, {}).trim().endsWith("</svg>"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
