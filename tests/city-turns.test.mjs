// Which way is this vehicle going at that junction?
//
// A vehicle records the junction decision it is acting on so it does not
// re-decide every frame. That record has to name the junction it belongs to
// EXACTLY, and it has to be dropped whenever the decision it holds is
// overridden — otherwise the model can be told "you already decided" and act on
// a decision that was never about the junction in front of it.
//
// Both halves were wrong, and together they let a bus drive off the edge of the
// city:
//
//   * the record held only the road INDEX, and an index is not a junction —
//     ten roads and two axes means index 0 names four different junctions, so a
//     decision to carry straight on through index 0 heading east still counted
//     as a decision when the vehicle came back to index 0 heading west, where
//     carrying on is not a road at all;
//   * the stop-for-a-space path set turn/mustTurn without clearing the record,
//     so a bus that had decided a COMPULSORY turn at the outermost junction
//     could pull in somewhere, keep the stale record, and then be told "already
//     decided" at that junction — where the stale decision was the straight-on
//     one.
//
// It went past the last junction and 13 m out into the void at full cruise,
// until the safety net turned it round. Every check here fails against that
// code.
//
// Run:  node tests/city-turns.test.mjs

import { loadWebModule } from "./harness/load-web-module.mjs";

const { City, ROAD_WIDTH, seedFromString, setTransportRandom } = await loadWebModule("city.js");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// The traffic is driven by real Math.random in production; a gate needs a drive
// that repeats. Same generator as city-physics.test.mjs.
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bounds = { centerX: 0, centerZ: 0, width: 9, length: 7 };
const viewer = { x: 0, y: 1.6, z: 0 };
const build = (seed) => {
  const city = new City();
  city.build(bounds, seed, 0);
  return city;
};

// ── A junction's identity includes the direction ──────────────────────────
{
  const city = build(2718);
  const last = city.roadX.length - 1;

  const ids = new Set();
  for (const axis of ["x", "z"]) {
    for (const dir of [1, -1]) {
      for (let i = 0; i <= last; i++) ids.add(city._junctionId(axis, dir, i));
    }
  }
  check("every (axis, direction, road) is a distinct junction",
    ids.size === 4 * (last + 1), `${ids.size} ids for ${4 * (last + 1)} junctions`);

  // The specific confusion that caused the escape: index 0 the two ways.
  check("the same road indexed the two ways is two junctions",
    city._junctionId("x", 1, 0) !== city._junctionId("x", -1, 0));
  check("and the same index on the two axes is two junctions",
    city._junctionId("x", 1, 0) !== city._junctionId("z", 1, 0));
  check("no id collides with the 'nothing decided' value",
    !ids.has(-1));
}

// ── Overriding a decision drops the record ────────────────────────────────
{
  const city = build(2718);
  const last = city.roadX.length - 1;

  // A bus on its way to a space, approaching an interior junction — so carrying
  // straight on is a real road and the stop path applies.
  const bus = city.cars.find(v => v.kind === "bus" && !v.arc) || city.cars[0];
  bus.stopTarget = { kind: "stop", at: 0 };
  bus.axis = "x";
  bus.dir = 1;
  bus.turn = 1;
  bus.mustTurn = true;
  // The decision it is holding names the OUTERMOST junction, where it cannot
  // carry straight on.
  bus.turnDecidedAt = city._junctionId("x", 1, last);

  const interior = { index: 1, coord: city.roadX[1], distance: 6 };
  city._decideTurn(bus, interior);

  check("pulling in for a space clears the decision it was holding",
    bus.turnDecidedAt === -1, `still ${bus.turnDecidedAt}`);
  check("and stops claiming a compulsory turn it is no longer making",
    bus.turn === 0 && bus.mustTurn === false, `turn=${bus.turn} must=${bus.mustTurn}`);
}

// ── The compulsory turn at the edge cannot be talked out of ───────────────
{
  const city = build(2718);
  const last = city.roadX.length - 1;

  // Every way of arriving at the outermost junction, with the widest choice of
  // pre-existing state, must still end in a turn rather than a straight line.
  const outcomes = [];
  for (const axis of ["x", "z"]) {
    for (const dir of [1, -1]) {
      const edgeIndex = dir > 0 ? last : 0;
      for (const laneIdx of [0, 3, last]) {
        if (!city.cars.length) continue;
        const v = { ...city.cars[0] };
        v.axis = axis;
        v.dir = dir;
        v.lane = { ...city.cars[0].lane, axis, dir, roadIndex: laneIdx };
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        v.stopTarget = null;
        v.goal = null;
        v.arc = null;
        city._decideTurn(v, { index: edgeIndex, coord: 0, distance: 4 });
        outcomes.push({ axis, dir, laneIdx, turn: v.turn, must: v.mustTurn });
      }
    }
  }
  const straight = outcomes.filter(o => o.turn === 0);
  check("a vehicle at the outermost junction is always told to turn, never to carry on",
    straight.length === 0,
    straight.map(o => `${o.axis}/${o.dir} lane ${o.laneIdx}`).join(", "));
  check("and it is flagged as compulsory, so the hold logic applies",
    outcomes.every(o => o.must === true),
    outcomes.filter(o => o.must !== true).map(o => `${o.axis}/${o.dir}`).join(", "));

  // Even one that already "decided" to carry straight on here must re-decide,
  // because at this junction that decision cannot be acted on.
  {
    const v = { ...city.cars[0] };
    v.axis = "x";
    v.dir = -1;
    v.lane = { ...city.cars[0].lane, axis: "x", dir: -1, roadIndex: 3 };
    v.turn = 0;
    v.mustTurn = false;
    v.turnDecidedAt = city._junctionId("x", -1, 0);   // the stale straight-on record
    v.stopTarget = null;
    v.arc = null;
    city._decideTurn(v, { index: 0, coord: 0, distance: -2 });   // past the line
    check("a stale straight-on record at the edge does not survive as a decision",
      !(v.turn === 0 && v.mustTurn === false && v.turnDecidedAt === city._junctionId("x", -1, 0)),
      `turn=${v.turn} must=${v.mustTurn} decidedAt=${v.turnDecidedAt}`);
  }
}

// ── And it holds over a real drive ────────────────────────────────────────
{
  // The state that produces the escape, tested for directly rather than hoped
  // for: a vehicle standing at a junction whose recorded decision is a
  // straight-on one at a junction it cannot drive straight through. Sampling
  // every few frames is enough — a vehicle in this state is in it for the two
  // seconds it takes to cross the junction, not for one frame.
  const city = build(2718);
  setTransportRandom(makeRandom(seedFromString("hunt-42")));
  const last = city.roadX.length - 1;
  let stale = 0;
  let furthest = 0;

  for (let f = 0; f < 20000; f++) {
    city.update(1 / 60, viewer);
    if (f % 5) continue;
    for (const v of city.cars) {
      furthest = Math.max(furthest, Math.abs(v.x), Math.abs(v.z));
      const j = city._nextJunction(v);
      if (!j) continue;
      const edge = !(j.index + v.dir >= 0 && j.index + v.dir <= last);
      if (!edge) continue;
      if (v.turnDecidedAt === city._junctionId(v.axis, v.dir, j.index) && v.turn === 0) stale++;
    }
  }

  check("no vehicle ever holds a straight-on decision at a junction it cannot drive through",
    stale === 0, `${stale} vehicle-frames`);
  check("and none needed the safety net", city.strays === 0, `${city.strays} rescued`);
  check("every vehicle is still on the streets", city.cars.length > 0);
  check("the drive actually went somewhere",
    furthest > 0 && Number.isFinite(furthest), `${furthest.toFixed(0)} m`);
}

console.log(`${passed} passed, ${failed} failed — junction decisions`);
if (failed) process.exit(1);
