// City: kerbside.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  ASPHALT_COLOR,
  BAY_LENGTH,
  BAY_LINE_COLOR,
  BAY_LINE_W,
  BUS_BOX_COLOR,
  BUS_LAYBY_LENGTH,
  KERB_HEIGHT,
  LAYBY_DEPTH,
  PARK_BOX_DEPTH,
  ROAD_WIDTH,
  ROAD_Y,
} from "./constants.js";
import { boxMatrix } from "./matrices.js";
import { City } from "../city.js";

export const kerbside = {

  /// Where every bus layby is, in world rectangles.
  ///
  /// A bus stop has to be a layby and not just a painted box: on a thirteen
  /// metre street a bus that pulls as far over as the kerb allows still has a
  /// metre of itself in the running lane, and everything behind it waits. Cut
  /// back into the pavement it stands completely clear, which is the whole
  /// point of building one.
  _laybyRects() {
    const out = [];
    for (const [, lane] of this.lanes) {
      const side = City.kerbSide(lane.axis, lane.dir);
      const inner = lane.fixed - City.laneOffset(lane.axis, lane.dir) + side * (ROAD_WIDTH / 2);
      const outer = inner + side * LAYBY_DEPTH;
      for (const bay of lane.bays) {
        if (!bay.busStop) continue;
        const half = BUS_LAYBY_LENGTH / 2;
        const a0 = bay.at - half;
        const a1 = bay.at + half;
        out.push(lane.axis === "x"
          ? { x0: a0, x1: a1, z0: Math.min(inner, outer), z1: Math.max(inner, outer) }
          : { x0: Math.min(inner, outer), x1: Math.max(inner, outer), z0: a0, z1: a1 });
      }
    }
    return out;
  },

  /// The paint along the kerb: a box for every parking space, and a coloured
  /// bed with BUS across it at every stop, so what a space is for is legible
  /// from the pavement rather than only from the code.
  _paintKerbside(flats, laybys) {
    const y = ROAD_Y + 0.02;
    // The laybys are road surface, not pavement — laid at road level in the
    // hole the pads left for them.
    // Each patch is laid a little LARGER than the piece cut out of the pavement
    // for it, so its side faces end up buried inside the pad rather than flush
    // with the cut edge. Flush is two surfaces at one depth along a face you
    // stand right next to, and it was 1158 of them across the city.
    const bury = 0.12;
    for (const r of laybys) {
      flats.add(boxMatrix((r.x0 + r.x1) / 2, ROAD_Y - KERB_HEIGHT / 2, (r.z0 + r.z1) / 2,
        (r.x1 - r.x0) + bury * 2, KERB_HEIGHT, (r.z1 - r.z0) + bury * 2), ASPHALT_COLOR);
    }

    for (const [, lane] of this.lanes) {
      const alongX = lane.axis === "x";
      const side = City.kerbSide(lane.axis, lane.dir);
      const kerb = lane.fixed - City.laneOffset(lane.axis, lane.dir) + side * (ROAD_WIDTH / 2);
      // A line laid ACROSS the lane direction, at a given distance along it.
      const tick = (at, from, to, colour) => {
        const mid = (from + to) / 2;
        const width = Math.abs(to - from);
        flats.add(alongX
          ? boxMatrix(at, y, mid, BAY_LINE_W, 0.04, width)
          : boxMatrix(mid, y, at, width, 0.04, BAY_LINE_W), colour);
      };
      const rail = (a0, a1, across, colour, thickness = BAY_LINE_W) => {
        const mid = (a0 + a1) / 2;
        const len = Math.abs(a1 - a0);
        flats.add(alongX
          ? boxMatrix(mid, y, across, len, 0.04, thickness)
          : boxMatrix(across, y, mid, thickness, 0.04, len), colour);
      };

      for (const bay of lane.bays) {
        if (bay.busStop) {
          // A bed of colour the length of the layby, with BUS laid along it.
          const half = BUS_LAYBY_LENGTH / 2 - 0.5;
          const nearEdge = kerb - side * (LAYBY_DEPTH * 0.02);
          const farEdge = kerb + side * (LAYBY_DEPTH - 0.25);
          const mid = (nearEdge + farEdge) / 2;
          const depth = Math.abs(farEdge - nearEdge);
          flats.add(alongX
            ? boxMatrix(bay.at, y - 0.004, mid, half * 2, 0.03, depth)
            : boxMatrix(mid, y - 0.004, bay.at, depth, 0.03, half * 2), BUS_BOX_COLOR);
          // No lettering. It was drawn as bars making out B, U and S, on the
          // theory that it would read as lettering without a font in the
          // bundle. It does not: at any angle you actually see a bus stop
          // from, it reads as white dashes scattered across the bay. The
          // coloured bed and the shape of the layby say what it is.
          continue;
        }
        // An ordinary space: a box open to the carriageway, as they are painted.
        const half = BAY_LENGTH / 2;
        const back = kerb - side * 0.12;
        const front = kerb - side * (LAYBY_DEPTH * 0 + PARK_BOX_DEPTH);
        // The rail stops short of both ticks. Run through them and the two
        // share a square of road at exactly one depth at each corner, which is
        // 912 z-fighting corners across the city.
        tick(bay.at - half, back, front, BAY_LINE_COLOR);
        tick(bay.at + half, back, front, BAY_LINE_COLOR);
        rail(bay.at - half + BAY_LINE_W, bay.at + half - BAY_LINE_W, front, BAY_LINE_COLOR);
      }
    }
  }
};
