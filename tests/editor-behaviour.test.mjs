// Editor behaviour that has no pure-geometry form: what the 2D canvas does in
// response to a click, and what it draws as a warning. These are source
// contracts — they check the wiring is present, not that it renders — so read
// the assertion before "fixing" one.
//
// Run:  node tests/editor-behaviour.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const editor = readFileSync(join(root, "roomcad", "web", "editor2d.js"), "utf8");

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name);
}

// ── The measurement is not sticky ──────────────────────────────────────
// A measurement answers the question you just asked. Anything else you do
// makes it stale, so it goes rather than hanging over the next thing.
check("switching tool clears the measurement",
  editor.includes('if (store.tool !== "measure") this.clearMeasurement();'));
check("clicking anything else clears it too",
  (editor.match(/this\.clearMeasurement\(\)/g) || []).length >= 2);
check("clearing drops both the live drag and the finished line",
  /clearMeasurement\(\)\s*\{[\s\S]*this\.measureDrag = null;[\s\S]*this\.measureResult = null;/.test(editor));

// ── A wall cannot be started off the building ──────────────────────────
check("the wall tool checks where it is allowed to begin",
  editor.includes("if (!P.canStartWallAt(store.room, p)) {"));
check("holding outside pans the view instead of drawing",
  editor.includes('this.drag.type === "wallOutside"') && editor.includes('{ type: "pan" }'));
check("a plain click outside falls back to Select",
  editor.includes('case "wallOutside":') && editor.includes('store.chooseTool("select")'));
check("and says why, rather than appearing to do nothing",
  /Start walls on the building/.test(editor));
check("no snap dot is offered where a wall cannot start",
  editor.includes('store.tool === "wall" && this.hover && P.canStartWallAt(room, this.hover)'));

// ── Overlapping walls are shown, not prevented ─────────────────────────
// The user asked to see the problem and fix it themselves, so nothing is
// blocked or moved — the overlap is simply made visible.
check("overlapping walls are drawn", editor.includes("this.drawWallClashes(room);"));
check("they are drawn after the walls, so the mark is not hidden under one",
  editor.indexOf("this.drawWallClashes(room);") > editor.indexOf("this.drawWall(wall,"));
check("the mark is yellow", /CLASH_FILL = "rgba\(255, 214, 0/.test(editor));
check("nothing about the overlap blocks the edit",
  !/canStartWallAt[\s\S]{0,400}overlappingWallAreas/.test(editor));

console.log(`${passed} passed, ${failed} failed — 2D editor behaviour contracts`);
if (failed) process.exit(1);
