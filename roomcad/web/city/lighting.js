// City: window lights and the light pool.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  BRAKE_LIGHT_COLOR,
  BRAKE_LIGHT_POWER,
  BRAKE_LIGHT_REACH,
  HEADLAMP_COLOR,
  HEADLAMP_POWER,
  HEADLAMP_THROW,
  LAMP_LIGHT_COLOR,
  LAMP_LIGHT_POWER,
  LAMP_LIGHT_REACH,
  ROAD_Y,
  VEHICLE_REF,
} from "./constants.js";
import { clamp01 } from "./helpers.js";
import { _m } from "./matrices.js";

export const lighting = {

  /// One slab layer of a block, as up to four strips around an optional hole.
  /// The room's own plot is the hole: paving over it would push pavement up
  /// through the floor of a ground-floor room.
  /// Turns off a share of the lit rooms, and puts a dark one in each place.
  ///
  /// A city does not keep the same windows burning all night. Every so often
  /// another goes out, and by the small hours most of them have. The lit
  /// instance is dropped from its band and a dark room is drawn where it was —
  /// dropping it alone would leave the window looking through to nothing.
  ///
  /// Instances are packed, so the one taken is always the last in its band, and
  /// the bulb that goes with it is the last in the matching bulb mesh: the two
  /// were filled in step, one entry each per lit room.
  /// The lit things a night can turn off, each with the dark thing that takes
  /// its place. The near blocks have rooms behind their glass; the towers have
  /// the glass alone. Both are lit rooms as far as the night is concerned, and
  /// listing them here is what stops that being two systems that drift apart.
  _litPopulations() {
    const out = [];
    if (this.roomsLit && this.roomsDark) {
      out.push({ lit: this.roomsLit, dark: this.roomsDark, bulbs: this.litBulbs });
    }
    if (this.litWindows && this.darkWindows) {
      out.push({ lit: this.litWindows, dark: this.darkWindows, bulbs: null });
    }
    return out;
  },

  _lightsOut(count, only = null) {
    const all = this._litPopulations();
    const groups = only ? all.filter(g => g.lit === only.lit) : all;
    if (!groups.length) return 0;
    let done = 0;
    for (let n = 0; n < count; n++) {
      // From the band with the most left, across every population, so they
      // empty together rather than one whole band — or one whole city block —
      // at a time.
      let band = -1;
      let most = 0;
      let group = null;
      for (const g of groups) {
        if (g.dark.count >= g.dark.instanceMatrix.count) continue;
        for (let i = 0; i < g.lit.length; i++) {
          const mesh = g.lit[i];
          if (mesh && mesh.count > most) { most = mesh.count; band = i; group = g; }
        }
      }
      if (band < 0 || !group) break;
      const lit = group.lit[band];
      const last = lit.count - 1;
      lit.getMatrixAt(last, _m);
      group.dark.setMatrixAt(group.dark.count++, _m);
      group.dark.instanceMatrix.needsUpdate = true;
      lit.count = last;
      const bulbs = group.bulbs && group.bulbs[band];
      if (bulbs && bulbs.count > 0) bulbs.count--;
      // Which band it came from AND which population, so morning can put it
      // back exactly where it was. The instance itself is still in the mesh's
      // buffer just past the count, so turning it on again is a matter of
      // counting it back in.
      this._extinguished.push({ band, group: all.indexOf(group) });
      done++;
    }
    return done;
  },

  /// Puts the lights back on, in the order they went off.
  ///
  /// Without this the city only ever gets darker: a night takes fifty windows
  /// and morning gives none of them back, so after a few of them every window
  /// in the city is dark for good. Measured over two nights, 497 lit rooms
  /// became 395 and would have kept going.
  ///
  /// Each room returns to the band it left, which is why the band was recorded.
  /// Both meshes are strictly last-in-first-out — the room was taken from the
  /// end of its band and appended to the end of the dark set — so this is a
  /// pair of counters moving back, and the room that comes on is exactly the
  /// room that went off.
  _restoreLights(count) {
    const groups = this._litPopulations();
    if (!groups.length) return 0;
    let done = 0;
    for (let n = 0; n < count; n++) {
      const went = this._extinguished.pop();
      if (went === undefined) break;
      const group = groups[went.group];
      if (!group) break;
      const lit = group.lit[went.band];
      if (!lit || lit.count >= lit.instanceMatrix.count) break;
      lit.count++;
      const bulbs = group.bulbs && group.bulbs[went.band];
      if (bulbs && bulbs.count < bulbs.instanceMatrix.count) bulbs.count++;
      if (group.dark.count > 0) group.dark.count--;
      done++;
    }
    return done;
  },

  /// Every light in the city that could reach a given point, nearest first.
  ///
  /// Candidates, not lights: there are a hundred street lamps and a headlamp on
  /// the nose of every vehicle, and no renderer will light a scene with three
  /// hundred of them. What it will do is light it with a dozen, so long as they
  /// are the right dozen — which is what the caller picks, from this.
  ///
  /// Each carries the distance it reaches, so a light is only ever a candidate
  /// where it would actually be seen. A lamp two streets away contributes
  /// nothing but a slot in the pool that a nearer one needed.
  collectLights(out, viewer, reach) {
    out.length = 0;
    if (!this.lampPosts) return out;
    const night = 1 - clamp01(this._dayAmount);
    const far = reach * reach;

    if (night > 0.02) {
      for (const post of this.lampPosts) {
        const dx = post.x - viewer.x;
        const dz = post.z - viewer.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > far) continue;
        out.push({
          x: post.x, y: post.y, z: post.z, d2,
          color: LAMP_LIGHT_COLOR,
          intensity: LAMP_LIGHT_POWER * night,
          distance: LAMP_LIGHT_REACH,
        });
      }
    }

    for (const v of this.cars) {
      if (v.stop && v.stop.kind === "park") continue;   // parked, and dark
      const fx = Math.cos(v.heading);
      const fz = Math.sin(v.heading);
      const ref = VEHICLE_REF[v.kind];
      // One light for the pair, hung off the nose and pointing the way the
      // vehicle is: two would cost twice as much to look almost the same.
      const nose = v.length / 2 + HEADLAMP_THROW * 0.25;
      const x = v.x + fx * nose;
      const z = v.z + fz * nose;
      const dx = x - viewer.x;
      const dz = z - viewer.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far) continue;
      out.push({
        x, y: ROAD_Y + ref.lampY, z, d2,
        color: HEADLAMP_COLOR,
        intensity: HEADLAMP_POWER * (0.35 + 0.65 * night),
        distance: HEADLAMP_THROW,
      });
      if (v.braking) {
        out.push({
          x: v.x - fx * (v.length / 2), y: ROAD_Y + ref.lampY, z: v.z - fz * (v.length / 2),
          d2,
          color: BRAKE_LIGHT_COLOR,
          intensity: BRAKE_LIGHT_POWER,
          distance: BRAKE_LIGHT_REACH,
        });
      }
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
  }
};
