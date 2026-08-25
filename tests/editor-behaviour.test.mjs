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

// Fit puts the ROOM on screen, not the base plate. Fitting to the 25 m canvas
// left a 5 m room as a stamp in the middle, and the dimension readouts around
// the plan are drawn at a fixed pixel size, so they have to be measured rather
// than assumed.
check("fit measures what was drawn, not the base plate",
  editor.includes("contentBounds()") && /fit\(\)[\s\S]{0,600}this\.contentBounds\(\)/.test(editor));
check("fit no longer sizes itself from the canvas plate",
  !/fit\(\)\s*\{[\s\S]{0,400}this\.displaySize\(\)/.test(editor));
check("content bounds cover the walls the user drew",
  /contentBounds\(\)[\s\S]{0,400}P\.wallsBounds\(room\)/.test(editor));
check("content bounds also cover public floor, labels and furniture",
  /contentBounds\(\)[\s\S]{0,900}publicAreas[\s\S]{0,400}labelBounds[\s\S]{0,400}furnitureFootprint/.test(editor));
check("an empty plan still falls back to the base plate",
  /contentBounds\(\)[\s\S]{0,1200}P\.canvasOf\(room\)/.test(editor));
check("the usable area excludes whatever floats over the canvas",
  editor.includes('document.getElementById("zoom-controls")') && editor.includes("viewport()"));
check("the annotations around the plan are measured, not guessed",
  editor.includes("paintedExtent()") && editor.includes("this.dimensionBoxes"));
check("fit solves for the scale that makes geometry plus annotations fill the view",
  /annoW\s*=\s*Math\.max\(0, painted\.w - geomW \* this\.scale\)/.test(editor)
  && /\(view\.availW - annoW\) \/ geomW/.test(editor));
check("fit accounts for a rotated plan",
  /fit\(\)[\s\S]{0,900}store\.rotation === 90 \|\| store\.rotation === 270/.test(editor));

// Outer walls are held still and look it. The colour, the handles and the
// hit-testing must all agree about which walls those are, or the plan invites
// a drag it then refuses.
check("the locked set is worked out once per frame and shared",
  editor.includes("this._lockedWalls = new Set()") && /this\.wallHeld\(wall\)/.test(editor));
check("an outer wall is drawn light brown, not the blue of a movable one",
  /locked \? "#c8a06a" : "#4a90e2"/.test(editor));
check("selecting an outer wall keeps it visibly different",
  /locked \? "#e0b877" : "#2ecc40"/.test(editor));
check("a fixed wall shows no grab handles",
  /!this\.wallHeld\(wall\)\)[\s\S]{0,200}drawHandle\(wall\.start\)/.test(editor));
check("a fixed wall's endpoints are not hit-testable",
  /!this\.wallHeld\(wall\)\)[\s\S]{0,240}kind: "wallEnd"/.test(editor));
check("pressing on a fixed wall selects it instead of starting a drag",
  /wallHeld\(wall\)[\s\S]{0,400}return \{ type: "click" \}/.test(editor));
check("and says how to free it", /free it/.test(editor));
// One place decides whether a wall is held. Five places used to ask, two of
// them working it out for themselves — which is how the grab handles came to
// promise a drag that the store then refused.
check("the editor asks the store rather than deciding for itself",
  /wallHeld\(wall\) \{\s*\n\s*return !!wall && store\.wallIsLocked\(wall\.id\);/.test(editor)
  && !/P\.wallDragLocked/.test(editor));

// The menu is where the lock is lifted, and it has to toggle both ways.
check("an outer wall gets its own menu title", /title = outer \? "Outside wall" : "Wall"/.test(editor));
check("the menu offers Unlock Drag when locked",
  /label: "Unlock Drag", action: "unlock-wall"/.test(editor));
check("and Lock Drag once unlocked",
  /label: "Lock Drag", action: "lock-wall"/.test(editor));
check("only outer walls offer the lock toggle",
  /if \(outer\) \{[\s\S]{0,220}Unlock Drag/.test(editor));
check("both menu actions reach the store",
  /case "unlock-wall"[\s\S]{0,200}setWallDragUnlocked\(store\.selectedWallID, true\)/.test(editor)
  && /case "lock-wall"[\s\S]{0,200}setWallDragUnlocked\(store\.selectedWallID, false\)/.test(editor));

// R turns what is in hand first. Reaching for the selected item instead is how
// a piece being carried came to be the one thing that could not be turned.
{
  const app = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
  check("R offers the piece being placed before anything else",
    /rotatePendingFurniture\(\) && !store\.rotateSelectedLabel\(\)/.test(app));
  check("the ghost is drawn the way round it will land",
    /rotationDegrees: store\.pendingFurnitureRotation \|\| 0/.test(editor));
}

console.log(`${passed} passed, ${failed} failed — 2D editor behaviour contracts`);
if (failed) process.exit(1);
