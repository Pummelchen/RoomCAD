// A piece of furniture whose kind this build does not know.
//
// There are two answers to it, and they are deliberately different:
//
//   sanitize()                 DROPS the item. It is the one door a document
//                              comes through, and an item it cannot measure
//                              cannot be shown, saved or walked into.
//   furnitureFootprint()       THROW. There is no honest default footprint: a
//   furnitureCenter()          footprint is what decides whether a piece fits,
//                              so a guessed one answers "yes" about a position
//                              that is wrong — a silent lie about the user's own
//                              plan, which is the one failure a repair pass must
//                              not have.
//
// and two callers that can be reached holding an un-repaired item, which GUARD
// rather than throw, because a child dragging a piece across the floor must not
// meet a stack trace:
//
//   isFurniturePlacementValid()  refuses the placement — returns false
//   store.refreshFurnitureGaps() reports no gaps — sets furnitureGaps to null
//
// The decision is old; the assertion that holds it is not. It lived in comments,
// and a comment cannot fail, so nothing stopped the next person from making the
// throw a `kind || FURNITURE_KINDS.chair` "fix" that would silently measure every
// unknown piece as a chair.
//
// Run:  node tests/furniture-kinds.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";
import { resolve, stubModule } from "./harness/three-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const at = name => pathToFileURL(join(web, name)).href;
const asDataUrl = src => "data:text/javascript;base64," + Buffer.from(src).toString("base64");

// The real store, with its imports resolved inline, exactly as wall-lengths and
// furniture-freedom do. plan.js re-exports roomcad/web/plan/*.js, so it is
// loaded by URL: a data: URL cannot resolve the relative imports in the facade.
const planUrl = pathToFileURL(join(web, "plan.js")).href;
// The real store, on the real plan module, with the WebAudio helper replaced by a
// stub: audio.js needs a WebAudio context, and nothing here is about sound. The stub
// is installed in the RESOLVER rather than by rewriting store.js's source, because
// store.js is a facade over store/ now — the import to rewrite is no longer in the
// file it used to be in.
registerHooks({ resolve });
stubModule("audio.js", "export function playDoorSound() {}");
const storeUrl = at("store.js");

const { store } = await import(storeUrl);
const P = await import(planUrl);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const unknownKind = "sofa-bed";
const unknownItem = () => ({
  id: "ghost", kind: unknownKind, center: { x: 2, z: 2 }, rotationDegrees: 0,
});
const knownItem = () => ({
  id: "chair-1", kind: "chair", center: { x: 2, z: 2 }, rotationDegrees: 0,
});

/// Runs `fn` and reports how it refused: "threw", or "returned".
function refusalOf(fn) {
  try {
    return { how: "returned", value: fn() };
  } catch (e) {
    return { how: "threw", error: e };
  }
}

// ── The two functions with no way out refuse loudly ───────────────────────

{
  const footprint = refusalOf(() => P.furnitureFootprint(unknownItem()));
  check("furnitureFootprint refuses an unknown kind rather than measuring it",
    footprint.how === "threw", "it returned " + JSON.stringify(footprint.value));

  // The message matters: it is the only thing that says WHICH item in a document
  // was at fault. `undefined.d` would be true and useless.
  check("and the refusal names the kind it could not measure",
    footprint.how === "threw" && footprint.error.message.includes(unknownKind),
    footprint.how === "threw" ? footprint.error.message : "it did not throw at all");

  const room = P.freshRoom("kinds", 6, 4, 2.6);
  const centre = refusalOf(() => P.furnitureCenter(room, { x: 2, z: 2 }, unknownItem()));
  check("furnitureCenter refuses one too, rather than snapping it to a made-up size",
    centre.how === "threw", "it returned " + JSON.stringify(centre.value));
  check("and says which kind as well",
    centre.how === "threw" && centre.error.message.includes(unknownKind));

  // The refusal must be about the KIND, not about refusing everything: a real
  // piece still measures. Without this the test passes if both functions throw
  // unconditionally.
  const real = refusalOf(() => P.furnitureFootprint(knownItem()));
  check("a kind this build does know still measures normally",
    real.how === "returned" && real.value.maxX > real.value.minX
    && real.value.maxZ > real.value.minZ,
    "got " + JSON.stringify(real.value ?? String(real.error)));
}

// ── sanitize() is the quiet door, and it drops rather than refuses ────────

{
  const room = P.freshRoom("kinds", 6, 4, 2.6);
  room.furniture = [knownItem(), unknownItem()];
  // sanitize() repairs the room it is given and returns nothing — it does not
  // hand back a new one. It is contained in a try because the drop is
  // load-bearing further down: the filter is what stops the loop below it from
  // reaching for `kind.d` on an entry that is not there, so removing it makes
  // sanitize() throw rather than keep the item. A crash here would end this file
  // before it printed anything, so it is reported as the failure it is.
  let opened = true;
  let how = "";
  try {
    P.sanitize(room);
  } catch (e) {
    opened = false;
    how = e.constructor.name + ": " + e.message;
  }
  check("a document naming an unknown kind still opens", opened, how);
  const kinds = (room.furniture || []).map(f => f.kind);
  check("sanitize drops the item it cannot measure", opened && !kinds.includes(unknownKind),
    "still has: " + JSON.stringify(kinds));
  check("and keeps the one it can", opened && kinds.includes("chair"),
    "kept: " + JSON.stringify(kinds));
  check("so exactly the known piece survives", opened && (room.furniture || []).length === 1,
    (room.furniture || []).length + " left");
}

// ── The reachable callers guard instead of throwing ───────────────────────

{
  const room = P.freshRoom("kinds", 6, 4, 2.6);
  room.furniture = [unknownItem()];
  const valid = refusalOf(() => P.isFurniturePlacementValid(room, unknownItem()));
  check("isFurniturePlacementValid refuses the placement instead of throwing",
    valid.how === "returned" && valid.value === false,
    valid.how === "threw" ? "threw " + valid.error.message : "returned " + valid.value);
}

{
  // The path a drag takes: the editor asks for the surrounding gaps on every
  // pointer move, so an item it cannot measure must report nothing at all.
  const room = P.freshRoom("kinds", 6, 4, 2.6);
  room.furniture = [unknownItem()];
  store.room = room;
  store.furnitureGaps = { stale: true };
  const gaps = refusalOf(() => store.refreshFurnitureGaps("ghost"));
  check("refreshFurnitureGaps reports nothing instead of throwing",
    gaps.how === "returned", gaps.how === "threw" ? "threw " + gaps.error.message : "");
  check("and clears the gaps rather than leaving the previous item's",
    store.furnitureGaps === null, JSON.stringify(store.furnitureGaps));
}

console.log(`${passed} passed, ${failed} failed — what an unknown furniture kind does`);
process.exit(failed ? 1 : 0);
