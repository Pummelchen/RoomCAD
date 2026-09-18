// City: turn arcs.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  CROSSING_TURN,
  PACE_FASTEST,
  PACE_SLOWEST,
  PITCH_MAX,
  PITCH_PER_G,
  ROAD_WIDTH,
  ROLL_MAX,
  ROLL_PER_G,
  SAFE_GAP,
  SUSPENSION_RATE,
  TURN_RADIUS,
} from "./constants.js";
import { clamp, trueRandom } from "./helpers.js";
import { City } from "../city.js";

export const turn_arcs = {

  _beginTurn(v, junction) {
    const target = this._turnTarget(v, junction);
    if (!target) { v.turn = 0; return; }
    const { forward, side, newAxis, newDir, lane, P } = target;

    // The arc is sized so that it STARTS where the vehicle already is. A fixed
    // radius means a fixed tangent point, and a vehicle that is past it —
    // which happens whenever a turn is taken late, and always for one that
    // entered the junction before its light changed — gets snapped backwards
    // onto the arc. That is a car jumping several metres, and it was the only
    // teleport left in the model. Tightening the radius instead keeps the
    // start exactly under the wheels, and the exit still lands on the centre
    // of the lane being joined.
    const toCrossing = (P.x - v.x) * forward.x + (P.z - v.z) * forward.z;
    if (toCrossing > TURN_RADIUS + 0.35) {
      v.atTurnPoint = false;
      return;   // still approaching
    }
    // Past the point where the two lane centrelines cross, no arc can both
    // start under the wheels and end on the centre of the lane being joined —
    // the vehicle would have to be dragged backwards onto it, which is a car
    // jumping several metres. A driver who has missed the turning carries on
    // instead, so an optional turn is simply abandoned here. A compulsory one
    // never gets this far: it holds at the turning point until it can go.
    // Below this the arc's minimum radius would put its start behind the
    // vehicle again, which is the same jump in miniature. Treated as "too late
    // to turn" rather than snapped.
    if (toCrossing < 1.5) {
      if (!v.mustTurn) v.turn = 0;
      v.atTurnPoint = false;
      return;
    }
    // From here on, every remaining reason to bail is traffic rather than
    // geometry. A vehicle that MUST turn can hold here; holding any earlier
    // means never reaching this point at all.
    v.atTurnPoint = true;
    // Exactly the distance to the crossing point, so the arc begins under the
    // wheels and there is no jump at all. Never larger than the standard
    // radius, so a turn taken early is still a normal-looking corner.
    const R = Math.min(TURN_RADIUS, toCrossing);
    const C = {
      x: P.x - R * forward.x + R * side.x,
      z: P.z - R * forward.z + R * side.z,
    };
    const start = { x: P.x - R * forward.x, z: P.z - R * forward.z };

    const theta0 = Math.atan2(start.z - C.z, start.x - C.x);
    const theta1 = Math.atan2(R * forward.z, R * forward.x);
    let sweep = theta1 - theta0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;

    // The crossing turn cuts straight over the oncoming lane, so it has to
    // give way to it. Without this the turn is taken regardless and the
    // vehicle sweeps through whatever is coming the other way — which is by
    // far the commonest way two of them end up occupying the same ground.
    if (v.turn === CROSSING_TURN) {
      const oncoming = this.lanes.get(`${v.axis}|${-v.dir}|${v.lane.roadIndex}`);
      if (oncoming) {
        const turnSeconds = (TURN_RADIUS * Math.PI / 2) / Math.max(2, v.speed);
        for (const other of oncoming.members) {
          if (other.arc) continue;
          const here = other.axis === "x" ? other.x : other.z;
          const toJunction = (junction.coord - here) * other.dir;
          if (toJunction > -ROAD_WIDTH
            && toJunction < other.speed * (turnSeconds + 1.5) + ROAD_WIDTH) return;
        }
      }
    }

    // Never turn into a queue. Joining a lane is the one move that puts a
    // vehicle somewhere it was not a moment ago, so it is the one move that
    // can land on top of something; everything else is continuous.
    const exitProgress = newAxis === "x"
      ? (P.x + R * side.x) * newDir
      : (P.z + R * side.z) * newDir;
    // The gap has to be clear when the vehicle ARRIVES, not when it sets off:
    // a quarter circle takes over a second, and a car fifteen metres back down
    // the new road is exactly where the turn ends by the time it gets there.
    //
    // Inside the junction this is a safety check rather than a fresh decision
    // — the same question was answered at the line — so the margin is the room
    // actually needed rather than a comfortable one. Refusing generously from
    // in here strands the vehicle in the box; refusing not at all drives it
    // into the side of whatever is there.
    const turnTime = (R * Math.abs(sweep)) / Math.max(2, v.speed);
    for (const other of lane.members) {
      if (other.arc) continue;
      const need = (other.length + v.length) / 2 + SAFE_GAP + 1.5;
      const now = City.progressOf(other);
      const then = now + other.speed * turnTime;
      if (Math.abs(now - exitProgress) < need) return;   // occupied now
      if (Math.abs(then - exitProgress) < need) return;  // occupied on arrival
      if ((now - exitProgress) * (then - exitProgress) < 0) return;  // passes through
    }
    // And whoever else is already part-way round a turn into the same lane.
    // They are not in its member list yet — they join only when their arc
    // finishes — so without this two vehicles turning in from different
    // directions both aim at the same spot and one lands on the other.
    for (const other of this.cars) {
      if (other === v || !other.arc || other.arc.lane !== lane) continue;
      const need = (other.length + v.length) / 2 + SAFE_GAP + 1.5;
      if (Math.abs(other.arc.exitProgress - exitProgress) < need) return;
    }

    // Finally, is the ground the vehicle will sweep over actually clear? The
    // checks above look at the lane being joined, which is not the same thing:
    // a long vehicle turning through a junction passes over a good deal of it,
    // and something queued on another approach is not in either lane but is
    // very much in the way. It cannot move aside either — it is stopped at a
    // light — so the turn has to wait instead. This was the commonest contact
    // left in the model, and every one of them was a turn crossing something
    // standing still.
    const sweptClear = (() => {
      for (let k = 1; k <= 4; k++) {
        const theta = theta0 + sweep * (k / 4);
        const px = C.x + R * Math.cos(theta);
        const pz = C.z + R * Math.sin(theta);
        for (const other of this.cars) {
          if (other === v || other.arc) continue;
          const need = other.length / 2 + v.width / 2 + 0.6;
          if (Math.hypot(other.x - px, other.z - pz) < need) return false;
        }
      }
      return true;
    })();
    if (!sweptClear) return;

    v.atTurnPoint = false;
    v.arc = { cx: C.x, cz: C.z, r: R, theta0, sweep, u: 0, lane, newAxis, newDir, exitProgress };
    // Down to the bend's own limit on the frame it commits, not on the next
    // one. Waiting a frame let a vehicle that arrived fast take the first slice
    // of the corner at whatever it was doing.
    v.speed = Math.min(v.speed, City.corneringSpeed(v, R));
  },

  /// What the suspension is doing: the nose dipping under the brakes, the body
  /// leaning out of a corner.
  ///
  /// Both are read off the forces already in the model rather than faked from
  /// the steering input — the lean is the sideways push the corner is applying,
  /// the dip is the acceleration this frame — and both are eased rather than
  /// snapped, because springs take time. Without it a vehicle is a box that
  /// changes direction, and it is the single clearest tell that nothing in the
  /// city has any weight.
  _settleSuspension(v, dt) {
    let wantPitch = 0;
    let wantRoll = 0;
    if (Number.isFinite(v.accelNow)) {
      // Nose down under braking, up under power. Softer springs on the heavy
      // ones, so a loaded truck wallows rather than nodding.
      wantPitch = clamp(v.accelNow * PITCH_PER_G, -PITCH_MAX, PITCH_MAX);
    }
    if (v.arc && v.arc.r > 0.01) {
      const lateral = (v.speed * v.speed) / v.arc.r;
      // Leaning AWAY from the turn, which is what a body on springs does.
      wantRoll = clamp(-Math.sign(v.arc.sweep) * lateral * ROLL_PER_G, -ROLL_MAX, ROLL_MAX);
    }
    const ease = Math.min(1, dt * SUSPENSION_RATE);
    v.pitch = (v.pitch || 0) + (wantPitch - (v.pitch || 0)) * ease;
    v.roll = (v.roll || 0) + (wantRoll - (v.roll || 0)) * ease;
  },

  /// Moves a vehicle round its turn. Returns true while the turn is running.
  _advanceTurn(v, dt) {
    const arc = v.arc;
    // Held to what the bend allows for as long as it is in it, not only on the
    // way in. Clamped on approach alone, a vehicle that entered the junction
    // fast — carried in by the queue behind, or released late on a green —
    // went round at whatever speed it arrived with: nine corners in ten were
    // taken harder than the tyres would have allowed.
    v.speed = Math.min(v.speed, City.corneringSpeed(v, arc.r));
    const sweepLen = arc.r * Math.abs(arc.sweep);
    arc.u += (v.speed * dt) / Math.max(0.01, sweepLen);
    const u = Math.min(1, arc.u);
    const theta = arc.theta0 + arc.sweep * u;
    v.x = arc.cx + arc.r * Math.cos(theta);
    v.z = arc.cz + arc.r * Math.sin(theta);
    // Tangent to the circle, pointing the way round the vehicle is going.
    const sign = arc.sweep >= 0 ? 1 : -1;
    v.heading = Math.atan2(sign * Math.cos(theta), -sign * Math.sin(theta));
    if (arc.u < 1) return true;

    // Joined the new lane.
    const from = v.lane.members.indexOf(v);
    if (from >= 0) v.lane.members.splice(from, 1);
    v.lane = arc.lane;
    v.lane.members.push(v);
    v.axis = arc.newAxis;
    v.dir = arc.newDir;
    v.fixed = arc.lane.fixed;
    v.center = arc.lane.center;
    if (v.axis === "x") v.z = v.fixed; else v.x = v.fixed;
    const forward = City.forwardOf(v.axis, v.dir);
    v.heading = Math.atan2(forward.z, forward.x);
    v.arc = null;
    v.turn = 0;
    v.indicate = 0;
    v.turnDecidedAt = -1;
    // A fresh pace out of every corner. A vehicle keeps one speed for the
    // length of a street and then picks another, so the same car is the one
    // holding everyone up on one road and the one pressing on down the next —
    // the traffic keeps rearranging itself instead of settling into a fixed
    // order. Drawn from the vehicle's own deterministic stream, so a given
    // city still behaves identically every time it is opened.
    v.pace = PACE_SLOWEST + trueRandom() * (PACE_FASTEST - PACE_SLOWEST);
    v.cruise = v.spec.cruise * v.pace;
    return false;
  }
};
