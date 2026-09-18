// City: damage.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  GRASS_COLOR,
  GROUND_DEPTH,
  HOLE_SIZE,
  KERB_COLOR,
  KERB_HEIGHT,
  PAVEMENT_Y,
  ROAD_Y,
  SIDEWALK,
  SIDEWALK_COLOR,
} from "./constants.js";
import { boxMatrix } from "./matrices.js";
import { City } from "../city.js";

export const damage = {

  // MARK: - Damage

  /// Blows a metre-square hole through whatever piece of building is at a
  /// point, and takes the same square out of what holds the player up.
  ///
  /// The wall and its collider are cut from the same box by the same routine.
  /// Cutting them separately is how you get a hole you can see through and not
  /// walk through, or worse, one you can walk through and not see.
  punchHole(point, normal) {
    if (!this.facadeSet || !this.facadeSet.mesh) return null;
    // The face that was hit decides which way the hole is bored.
    const axis = Math.abs(normal.x) >= Math.abs(normal.z) ? "x" : "z";
    const across = axis === "x" ? "z" : "x";
    const atA = across === "x" ? point.x : point.z;

    const hit = this._facadeAt(point);
    if (hit < 0) return null;
    const box = City.boxOf(this.facadeSet.items[hit].matrix);
    const color = this.facadeSet.items[hit].color;
    const pieces = City.holePieces(box, axis, atA, point.y, HOLE_SIZE);
    if (!pieces || !pieces.length) return null;

    // The first piece takes the original slot; the rest need spare ones. If
    // the spares have run out the wall is left as it was rather than half
    // rebuilt, which would leave a building with a piece missing.
    if (this.facadeSet.mesh.count + pieces.length - 1
        > this.facadeSet.mesh.instanceMatrix.count) return null;
    this.facadeSet.replace(hit, boxMatrix(
      pieces[0].x, pieces[0].y, pieces[0].z, pieces[0].w, pieces[0].h, pieces[0].d), color);
    for (let i = 1; i < pieces.length; i++) {
      const p = pieces[i];
      this.facadeSet.append(boxMatrix(p.x, p.y, p.z, p.w, p.h, p.d), color);
    }

    // And the same square out of the collision, so the hole is a way through.
    let cut = false;
    for (let i = 0; i < this.solids.length; i++) {
      const solid = this.solids[i];
      if (solid.h <= GROUND_DEPTH) continue;              // ground and pavement
      if (!City.boxHolds(solid, point, 0.6)) continue;
      const parts = City.holePieces(solid, axis, atA, point.y, HOLE_SIZE);
      if (!parts || !parts.length) continue;
      this.solids.splice(i, 1, ...parts);
      cut = true;
      break;
    }
    this.damage = (this.damage || 0) + 1;
    return { axis, x: point.x, y: point.y, z: point.z, brokeCollision: cut };
  },

  /// Which piece of facade is at a point. The nearest one that contains it,
  /// because a corner is two pieces of wall overlapping.
  _facadeAt(point) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.facadeSet.items.length; i++) {
      if (i >= this.facadeSet.mesh.count) break;
      const box = City.boxOf(this.facadeSet.items[i].matrix);
      if (!City.boxHolds(box, point, 0.35)) continue;
      const d = (point.x - box.x) ** 2 + (point.y - box.y) ** 2 + (point.z - box.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  },

  /// The level of the carriageway: the lowest thing in the city you can stand
  /// on. Everything else is a step up from it.
  groundY() {
    return ROAD_Y;
  },

  _padLayer(flats, rect, hole, top, height, color, holeGrow = 0, notches = null) {
    const strip = (ax0, ax1, az0, az1) => {
      const w = ax1 - ax0;
      const d = az1 - az0;
      if (w <= 0.01 || d <= 0.01) return;
      flats.add(boxMatrix((ax0 + ax1) / 2, top - height / 2, (az0 + az1) / 2, w, height, d), color);
    };

    // The pad, less the room's own plot, less every bus layby cut into its
    // kerb. Done as rectangle subtraction rather than as a special case for
    // each, because a block can have a plot AND two laybys and the strips
    // either side of one have to be cut by the others in turn.
    let pieces = [{ ...rect }];
    const cutAll = (cut) => { pieces = City.subtractRect(pieces, cut); };

    if (hole) {
      // Each layer cuts the plot a little differently. Cut them all to exactly
      // the same edge and the kerb strip and the pavement strip share a
      // vertical face right along the boundary of the room's own plot — which
      // is a face you look straight at from a ground-floor room.
      cutAll({
        x0: hole.x0 - holeGrow, x1: hole.x1 + holeGrow,
        z0: hole.z0 - holeGrow, z1: hole.z1 + holeGrow,
      });
    }
    // Grown by the same amount as the plot, and for the same reason: cut every
    // layer to exactly the same edge and the kerb strip and the pavement strip
    // share a vertical face right down the side of the layby — a face you stand
    // next to at the bus stop. It was 158 of them.
    for (const notch of notches || []) {
      cutAll({
        x0: notch.x0 - holeGrow, x1: notch.x1 + holeGrow,
        z0: notch.z0 - holeGrow, z1: notch.z1 + holeGrow,
      });
    }
    for (const r of pieces) strip(r.x0, r.x1, r.z0, r.z1);
  },

  /// The raised pavement pad for one block: kerb, pavement, and a lawn on the
  /// blocks that are not the room's own. Each layer tops out a few millimetres
  /// below the one outside it, so nothing z-fights.
  _blockPad(flats, bx, bz, block, hole, laybys = null) {
    const rect = { x0: bx - block / 2, x1: bx + block / 2, z0: bz - block / 2, z1: bz + block / 2 };
    // The raised pavement, as something to stand on. Cut to the same shape as
    // the paving above — the room's own plot and every bus layby taken out of
    // it — because a kerb you can see and a kerb you can walk on that disagree
    // is a player standing in mid-air over a layby.
    let walkable = [rect];
    if (hole) walkable = City.subtractRect(walkable, hole);
    for (const notch of laybys || []) walkable = City.subtractRect(walkable, notch);
    for (const r of walkable) {
      this.solids.push({
        x: (r.x0 + r.x1) / 2, y: PAVEMENT_Y - KERB_HEIGHT / 2, z: (r.z0 + r.z1) / 2,
        w: r.x1 - r.x0, h: KERB_HEIGHT, d: r.z1 - r.z0,
      });
    }
    this._padLayer(flats, rect, hole, PAVEMENT_Y, KERB_HEIGHT, KERB_COLOR, 0, laybys);
    const inset = 0.35;
    this._padLayer(flats, {
      x0: rect.x0 + inset, x1: rect.x1 - inset, z0: rect.z0 + inset, z1: rect.z1 - inset,
    }, hole, PAVEMENT_Y - 0.005, KERB_HEIGHT, SIDEWALK_COLOR, 0.03, laybys);
    if (!hole) {
      this._padLayer(flats, {
        x0: rect.x0 + SIDEWALK, x1: rect.x1 - SIDEWALK,
        z0: rect.z0 + SIDEWALK, z1: rect.z1 - SIDEWALK,
      }, null, PAVEMENT_Y - 0.002, KERB_HEIGHT, GRASS_COLOR);
    }
  }
};
