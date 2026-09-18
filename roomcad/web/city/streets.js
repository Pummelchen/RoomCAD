// City: streets.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  ARROW_DROP,
  ARROW_PITCH,
  CROSSING_TURN,
  CROSS_BAR,
  CROSS_BAR_GAP,
  CROSS_DEPTH,
  CROSS_GAP,
  GRID_RADIUS,
  LAMP_CROWDED_GAP,
  LAMP_MIN_GAP,
  MARKING_COLOR,
  NEAR_SIDE_TURN,
  PAVEMENT_Y,
  ROAD_WIDTH,
  ROAD_Y,
  SIGNAL_CLEAR,
  SIGNAL_HEAD_H,
  SIGNAL_HEIGHT,
  STOP_LINE_W,
} from "./constants.js";
import { _m, boxMatrix } from "./matrices.js";
import { City } from "../city.js";

export const streets = {

  // MARK: - Streets

  /// Road paint, laid out from the junction grid rather than run blindly from
  /// one side of the city to the other. Lane dashes stop short of every
  /// junction, each approach gets a stop line, and the crossing sits between
  /// the line and the carriageway — which is the order a driver meets them in.
  _roadMarkings(flats, cx, cz, block, span) {
    // Crossings are painted into their own set — see sets.crossings.
    const y = ROAD_Y + 0.02;
    const halfRoad = ROAD_WIDTH / 2;
    const outer = GRID_RADIUS * span + block / 2 + ROAD_WIDTH / 2;

    // How much of each approach is given over to the crossing and its line.
    const keepClear = halfRoad + CROSS_GAP + CROSS_DEPTH + STOP_LINE_W + 0.3;

    const dash = 2.2;
    const gap = 2.6;
    /// Centre dashes along one stretch of road, between two junctions.
    const dashes = (from, to, alongX, fixed) => {
      const usable = to - from;
      if (usable < dash) return;
      // Centre the pattern in the stretch so it does not start with a stub.
      const pitch = dash + gap;
      const n = Math.max(1, Math.floor((usable + gap) / pitch));
      const used = n * pitch - gap;
      let p = from + (usable - used) / 2;
      for (let i = 0; i < n; i++) {
        const at = p + dash / 2;
        flats.add(alongX
          ? boxMatrix(at, y, fixed, dash, 0.04, 0.16)
          : boxMatrix(fixed, y, at, 0.16, 0.04, dash), MARKING_COLOR);
        p += pitch;
      }
    };

    for (const [roads, crossRoads, alongX] of [
      [this.roadZ, this.roadX, true],
      [this.roadX, this.roadZ, false],
    ]) {
      for (const fixed of roads) {
        // Stretches between consecutive junctions, plus the two open ends.
        const stops = crossRoads.slice().sort((a, b) => a - b);
        const edges = [-outer + (alongX ? cx : cz), ...stops, outer + (alongX ? cx : cz)];
        for (let i = 0; i < edges.length - 1; i++) {
          const from = edges[i] + (i === 0 ? 0 : keepClear);
          const to = edges[i + 1] - (i === edges.length - 2 ? 0 : keepClear);
          dashes(from, to, alongX, fixed);
        }
      }
    }

    // Junction furniture: a crossing and a stop line on every arm.
    for (const rx of this.roadX) {
      for (const rz of this.roadZ) {
        for (const arm of [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }]) {
          this._crossing(flats, rx, rz, arm, y);
        }
      }
    }
  },

  /// One arm of one junction: the crossing, and the line traffic stops at.
  /// `arm` points outwards from the junction along the road being crossed.
  _crossing(flats, rx, rz, arm, y) {
    const alongX = arm.dx !== 0;
    const dir = alongX ? arm.dx : arm.dz;
    const halfRoad = ROAD_WIDTH / 2;
    // Distance out from the junction centre to the near and far edge of the
    // crossing band, then the stop line beyond it.
    const near = halfRoad + CROSS_GAP;
    const far = near + CROSS_DEPTH;

    // The bars run PARALLEL to the traffic, side by side across the road, so
    // a pedestrian steps over each one in turn. That is what a crossing looks
    // like; bars laid across the traffic are a ladder, not a crossing.
    const usable = ROAD_WIDTH - 0.5;
    const bars = Math.max(3, Math.round(usable / (CROSS_BAR + CROSS_BAR_GAP)));
    const pitch = usable / bars;
    for (let i = 0; i < bars; i++) {
      const off = -usable / 2 + pitch * (i + 0.5);
      const at = dir * (near + CROSS_DEPTH / 2);
      this._crossingSet.add(alongX
        ? boxMatrix(rx + at, y, rz + off, CROSS_DEPTH, 0.04, CROSS_BAR)
        : boxMatrix(rx + off, y, rz + at, CROSS_BAR, 0.04, CROSS_DEPTH));
    }

    // The stop line covers the approaching half of the carriageway only. Which
    // half that is comes from laneOffset — the same function the vehicles use
    // to decide where to drive — so the paint cannot end up in the oncoming
    // lane if the driving side ever changes.
    const approach = -dir;
    const offset = City.laneOffset(alongX ? "x" : "z", approach);
    const side = Math.sign(offset);
    const lane = ROAD_WIDTH / 4;
    const at = dir * (far + STOP_LINE_W / 2);
    flats.add(alongX
      ? boxMatrix(rx + at, y, rz + side * lane, STOP_LINE_W, 0.04, ROAD_WIDTH / 2 - 0.25)
      : boxMatrix(rx + side * lane, y, rz + at, ROAD_WIDTH / 2 - 0.25, 0.04, STOP_LINE_W),
      MARKING_COLOR);
  },

  /// A signal head on every approach of every junction, showing what the model
  /// is actually doing. The lights are not decoration timed to look plausible:
  /// they read the same phase the vehicles obey, so what you see on the pole is
  /// why the queue in front of it is stopped.
  /// `_cx`/`_cz` are retained for the call shape: the junction centre is passed
  /// by every caller and this signature is a stable internal interface.
  _trafficSignals(poles, housings, darkLamps, _cx, _cz) {
    this.signals = [];
    const poleH = SIGNAL_HEIGHT;
    const reach = ROAD_WIDTH / 2 + 1.6;
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        const rx = this.roadX[ix];
        const rz = this.roadZ[iz];
        for (const arm of [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }]) {
          const alongX = arm.dx !== 0;
          const axis = alongX ? "x" : "z";
          // The signal faces the traffic coming IN along this arm and stands on
          // that traffic's own kerb, which is whichever side laneOffset puts
          // its lane on.
          const dir = -(alongX ? arm.dx : arm.dz);      // direction of approach
          const side = Math.sign(City.laneOffset(axis, dir));
          const px = alongX ? rx + arm.dx * reach : rx + side * (ROAD_WIDTH / 2 + 1.1);
          const pz = alongX ? rz + side * (ROAD_WIDTH / 2 + 1.1) : rz + arm.dz * reach;
          const heading = alongX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);

          poles.add(boxMatrix(px, PAVEMENT_Y + poleH / 2, pz, 1, poleH, 1));
          const headY = PAVEMENT_Y + poleH + SIGNAL_HEAD_H / 2 - 0.1;
          housings.add(boxMatrix(px, headY, pz, 0.34, SIGNAL_HEAD_H, 0.34, -heading));

          // The three dark lenses, always there. The lit one is drawn a
          // centimetre proud of its lens so the two never share a plane.
          const faceOut = 0.17;
          const fx = Math.cos(heading);
          const fz = Math.sin(heading);
          const lamps = [];
          for (let k = 0; k < 3; k++) {
            const ly = headY + SIGNAL_HEAD_H / 2 - 0.16 - k * 0.26;
            darkLamps.add(boxMatrix(px + fx * faceOut, ly, pz + fz * faceOut, 0.15, 0.15, 0.15, -heading));
            lamps.push({ x: px + fx * (faceOut + 0.03), y: ly, z: pz + fz * (faceOut + 0.03) });
          }
          // The three turn arrows, on a bar under the main head: left, straight
          // and right as the driver sees them. The signal's heading IS the
          // direction of travel, so the across-the-face direction is the
          // near-side turn — which makes the arrow for turn t sit at t * pitch
          // along it, right-hand turn to the right, with no separate table of
          // which way round the face is.
          const across = { x: -fz, z: fx };
          const armY = headY - SIGNAL_HEAD_H / 2 - ARROW_DROP;
          const arrows = [];
          for (const turn of [CROSSING_TURN, 0, NEAR_SIDE_TURN]) {
            arrows.push({
              turn,
              x: px + fx * faceOut + across.x * turn * ARROW_PITCH,
              y: armY,
              z: pz + fz * faceOut + across.z * turn * ARROW_PITCH,
            });
          }
          housings.add(boxMatrix(px + fx * (faceOut - 0.06), armY, pz + fz * (faceOut - 0.06),
            ARROW_PITCH * 2 + 0.16, 0.2, 0.1, -heading));
          // The pole's own position is kept, not only the lenses on it: the
          // street lamps have to stand clear of it, and working the position
          // out a second time somewhere else is how the two end up disagreeing.
          this.signals.push({ axis, dir, ix, iz, heading, lamps, arrows, x: px, z: pz });
        }
      }
    }
  },

  /// Lights the lamp the phase calls for, and only that one. Counts move
  /// rather than lamps being drawn at zero size or hidden inside the housing.
  _writeSignalLamps() {
    const parts = this.signalLamps;
    if (!parts || !this.signals.length) return;
    let red = 0;
    let amber = 0;
    let green = 0;
    for (const s of this.signals) {
      const state = this._signalState(s.axis, s.ix, s.iz, this._clock);
      const lamp = state === "green" ? s.lamps[2] : state === "amber" ? s.lamps[1] : s.lamps[0];
      const mesh = state === "green" ? parts.green : state === "amber" ? parts.amber : parts.red;
      const slot = state === "green" ? green++ : state === "amber" ? amber++ : red++;
      mesh.setMatrixAt(slot, boxMatrix(lamp.x, lamp.y, lamp.z, 0.16, 0.16, 0.16, -s.heading, _m));
    }
    parts.red.count = red;
    parts.amber.count = amber;
    parts.green.count = green;
    parts.red.instanceMatrix.needsUpdate = true;
    parts.amber.instanceMatrix.needsUpdate = true;
    parts.green.instanceMatrix.needsUpdate = true;
  },

  /// What one approach's signal is showing. Derived from the same phase the
  /// vehicles read, so the two cannot disagree.
  _signalState(axis, ix, iz, t) {
    void t;
    const phase = this._phaseAt(ix, iz);
    if (!phase || phase.axis !== axis) return "red";
    if (phase.state === "green") return "green";
    if (phase.state === "amber") return "amber";
    return "red";
  },

  _streetLamps(poles, heads, cx, cz, block, span, laybys = null) {
    const h = 4.6;
    this.lampPosts = [];
    // A lamp standing in front of a signal is worse than no lamp: the light you
    // have to see to know whether to stop is behind a pole. The signals are
    // already placed by the time this runs, so their poles are simply avoided —
    // and the lamp is MOVED rather than dropped, because a junction with no
    // light on it is the other way to get this wrong.
    const signalPoles = (this.signals || []).map(s => ({ x: s.x, z: s.z }));
    const clearOfSignals = (x, z) =>
      !signalPoles.some(p => Math.abs(p.x - x) < SIGNAL_CLEAR && Math.abs(p.z - z) < SIGNAL_CLEAR);
    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const edge = block / 2 - 0.9;
        // Along the streets at a real spacing, not four to a block at the
        // corners. A block side is 46 m, so a lamp at each corner leaves 46 m
        // of unlit street between them; on a real street they stand about every
        // 25 m. Corners plus the middle of each side gives 23 m, which is what
        // the pools of light either side of you should look like.
        const spots = [
          [edge, edge], [-edge, edge], [edge, -edge], [-edge, -edge],
          [edge, 0], [-edge, 0], [0, edge], [0, -edge],
        ];
        for (const [ox, oz] of spots) {
          // Slide along the kerb until the lamp is clear of the signals and out
          // of the layby, taking the shortest move that works. A corner lamp
          // that cannot be freed at all is dropped: the next lamp along the
          // side is 23 m away, so the junction is still lit.
          let x = bx + ox;
          let z = bz + oz;
          const alongX = Math.abs(oz) > Math.abs(ox) || (ox === 0);
          // Moving a lamp out of the way must not park it next to the lamp it
          // was moved towards: two posts a few metres apart light the same
          // patch of pavement twice and leave the street between them dark.
          const spaced = (px, pz, gap) => !this.lampPosts.some(p =>
            Math.hypot(p.x - px, p.z - pz) < gap);
          const usable = (px, pz, gap) =>
            clearOfSignals(px, pz) && !City._inLayby(laybys, px, pz, 1.0) && spaced(px, pz, gap);
          // Signals and laybys are absolute; the spacing is a preference. A
          // lamp that cannot keep its distance is better standing closer than
          // not standing at all: dropping it left 32 m of unlit street on a
          // 46 m block, which is the thing the spacing was there to prevent.
          let placed = false;
          for (const gap of [LAMP_MIN_GAP, LAMP_CROWDED_GAP]) {
            if (usable(x, z, gap)) { placed = true; break; }
            for (let step = 1; !placed && step <= 8; step++) {
              for (const away of [step, -step]) {
                const tx = alongX ? bx + ox + away * 1.2 : x;
                const tz = alongX ? z : bz + oz + away * 1.2;
                // Never past the end of its own block side.
                if (Math.abs(alongX ? tx - bx : tz - bz) > block / 2) continue;
                if (!usable(tx, tz, gap)) continue;
                x = tx; z = tz; placed = true;
                break;
              }
            }
            if (placed) break;
          }
          if (!placed) continue;
          poles.add(boxMatrix(x, PAVEMENT_Y + h / 2, z, 1, h, 1));
          heads.add(boxMatrix(x, PAVEMENT_Y + h + 0.12, z, 0.44, 0.16, 0.44));
          // Where the light actually comes from, kept so something can light
          // the street with it rather than only drawing a bright box.
          this.lampPosts.push({ x, y: PAVEMENT_Y + h - 0.02, z });
        }
      }
    }
  }
};
