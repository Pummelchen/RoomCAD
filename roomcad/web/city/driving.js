// City: driving.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  BRAKE_MAX,
  BUS_DWELL_MAX,
  BUS_DWELL_MIN,
  INDICATE_FROM,
  KERB_EASE_FROM,
  MANOEUVRE_WAIT,
  NEAR_SIDE_TURN,
  NOSE_TO_TAIL,
  PARK_MAX,
  PARK_MIN,
  REVERSE_RUN,
  ROAD_WIDTH,
  SAFE_GAP,
  SEPARATE_STEP,
  TURN_RADIUS,
  UNLOAD_MAX,
  UNLOAD_MIN,
} from "./constants.js";
import { trueRandom } from "./helpers.js";
import { City } from "../city.js";

export const driving = {

  /// One step of the traffic model for one vehicle: look at what is ahead,
  /// pick a speed, then accelerate or brake towards it. Everything visible —
  /// the brake lights, the indicators, the queue at a red light — falls out of
  /// this rather than being animated separately.
  _driveVehicle(v, dt) {
    if (v.arc) {
      v.braking = false;
      v.indicate = v.turn;
      // Drive THROUGH the turn. Without this the speed is frozen at whatever
      // it happened to be when the arc began, so a vehicle that crept into the
      // junction crawls all the way round at walking pace — several seconds
      // lying across the box, with the whole approach stopped behind it.
      const through = Math.min(v.cruise, 7);
      v.speed = v.speed < through
        ? Math.min(through, v.speed + v.accel * dt)
        : Math.max(through, v.speed - v.brakeRate * dt);
      this._advanceTurn(v, dt);
      return;
    }

    // Stopped, or on its way into a space: that takes over entirely.
    if (this._handleStopping(v, dt)) {
      this._holdAtKerb(v);
      return;
    }

    let desired = v.cruise;
    const heading = City.forwardOf(v.axis, v.dir);

    // Pulling in. It eases towards the kerb while it runs down to the space.
    // Part-way through reversing into a space: the manoeuvre owns the vehicle
    // until it is done.
    if (v.manoeuvre) return this._runManoeuvre(v, dt);

    if (v.stopTarget) {
      const along = v.axis === "x" ? v.x : v.z;
      const target = v.stopTarget;
      // A space with a car in front of it has to be reversed into, and the
      // run-up stops one car's length past it rather than at it.
      const reversing = target.reverse === true;
      const togo = (target.bay.at + (reversing ? v.dir * REVERSE_RUN : 0) - along) * v.dir;
      // The pull-over starts only once the space is close. Started the moment
      // the space was claimed — up to PARK_APPROACH away — the vehicle drifts
      // towards the kerb across several bays and clips whatever is parked in
      // them, which was the commonest contact in the model.
      v.kerbTarget = reversing || togo > KERB_EASE_FROM ? 0 : target.offset;
      // Indicating all the way in, as a driver does — this is the signal that
      // the car in front of you is about to stop, and it goes on well before
      // anything happens.
      v.indicate = NEAR_SIDE_TURN;

      // Give the space back rather than keep it at any cost. Overshooting it —
      // pushed past by the queue behind — used to snap the vehicle back to the
      // bay, a visible jump of up to 3.9 m. And a vehicle that reserves a bay
      // and is then held in traffic used to keep it: one was measured holding
      // a space for 356 s without ever reaching it, while cars that could have
      // used it drove past.
      if (togo < -1.2 || this._clock > v.stopTarget.giveUp) {
        this._releaseBays({ stop: v.stopTarget, lane: v.lane });
        if (v.stopTarget.kind === "park") this._parkingSoon--;
        v.stopTarget = null;
        v.kerbTarget = 0;
        return;
      }

      if (togo < 0.5 && v.speed < 0.6 && reversing) {
        // Stopped alongside. Pause, then take it back on the lock.
        v.speed = 0;
        v.manoeuvre = {
          kind: target.kind,
          bay: target.bay,
          bays: target.bays,
          from: (v.axis === "x" ? v.x : v.z) * v.dir,
          angle: 0,
          rising: true,
          waitUntil: this._clock + MANOEUVRE_WAIT,
          base: v.heading,
        };
        v.stopTarget = null;
        return true;
      }

      if (togo < 0.5 && v.speed < 0.6) {
        v.speed = 0;
        // NOT snapping kerbOffset to the target here. The ease at the top of
        // _handleStopping keeps running while the vehicle stands, so it drifts
        // the last few centimetres in; forcing it was a sideways jump of up to
        // 1.3 m at the moment of arrival.
        const kind = v.stopTarget.kind;
        v.stop = {
          kind,
          bay: v.stopTarget.bay,
          bays: v.stopTarget.bays,
          until: this._clock + (kind === "unload"
            ? UNLOAD_MIN + trueRandom() * (UNLOAD_MAX - UNLOAD_MIN)
            : kind === "park"
            // Five minutes to two hours, weighted towards the short end. Drawn
            // flat, the average stay is an hour and the city quietly empties:
            // every car is either parked or on its way to park, and almost
            // nobody is left driving. Squaring the draw keeps the same range
            // and brings the average down to about forty minutes, which is
            // also closer to how kerbside parking actually turns over.
            ? PARK_MIN + trueRandom() ** 2 * (PARK_MAX - PARK_MIN)
            : BUS_DWELL_MIN + trueRandom() * (BUS_DWELL_MAX - BUS_DWELL_MIN)),
        };
        if (kind === "park") { this._parkedCars++; this._parkingSoon--; }
        // Whatever it had decided to do at the next junction is forgotten; it
        // will decide again when it pulls out.
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        v.stopTarget = null;
        this._holdAtKerb(v);
        return;
      }
      desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * v.brakeRate * (togo - 0.2))));
    }

    // Anything part-way round a turn is in no lane at all, but it is very much
    // in the way. Without this it is invisible to the traffic bearing down on
    // the junction, which then drives straight through it — the commonest
    // collision in the whole model, and entirely a perception failure rather
    // than a driving one.
    for (const other of this._turning) {
      if (other === v) continue;
      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const along = dx * heading.x + dz * heading.z;
      if (along <= 0 || along > 40) continue;
      // A turning vehicle sits across the road, so its own LENGTH is what
      // sticks out sideways; assuming its width would badly underestimate a
      // bus halfway round.
      const across = Math.abs(dx * -heading.z + dz * heading.x);
      if (across > (v.width + other.length) / 2 + 0.8) continue;
      const room = along - (v.length + other.length) / 2 - SAFE_GAP;
      desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * v.brakeRate * room)));
    }

    // Keep station behind whoever is in front.
    const ahead = this._leader(v);
    if (ahead) {
      // Travel no faster than lets you pull up in the room you actually have.
      // A flat proportional rule looks fine most of the time and then closes
      // the last metre anyway, because it does not know the vehicle's own
      // braking rate; a bus needs far more warning than a hatchback.
      // Safe-following speed: fast enough only that this vehicle can still
      // pull up in the room it has, plus however far the one in front will
      // travel before IT stops. Taking the leader's speed at face value —
      // "it is doing 8, so I can do 8" — is the optimistic version, and it
      // closes the last couple of metres whenever the leader brakes too.
      const room = ahead.gap - SAFE_GAP - 0.3;
      const leadRoom = ahead.leader.speed * ahead.leader.speed * (v.brakeRate / BRAKE_MAX);
      desired = Math.min(desired, Math.sqrt(Math.max(0, leadRoom + 2 * v.brakeRate * room)));
    }

    // Stop at a red light, and start looking far enough ahead to do it
    // smoothly rather than by slamming on at the line.
    const junction = this._nextJunction(v, this._junctionScratch(v));
    if (junction) {
      this._decideTurn(v, junction);
      // A vehicle lining up for a space is already indicating for the kerb, and
      // that signal outranks the junction's: it is the one that says "I am
      // stopping", which is what the traffic behind actually needs to know.
      if (!v.stopTarget) v.indicate = junction.distance < INDICATE_FROM ? v.turn : 0;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const green = this._isGreen(v.axis, ix, iz, this._clock);
      // Three separate reasons not to enter a junction, all of which look the
      // same from outside — the vehicle waits at the line.
      let mayEnter = green;
      // Both of the checks below are about crossing the junction and coming
      // out the far side. A vehicle that MUST turn is not going to the far
      // side — it is leaving by the arm to its right — and the room it needs
      // is in the lane it is joining, which _beginTurn checks for itself.
      // Applying them here blocked forced turns behind a queue that was never
      // going to clear, and the vehicle followed that queue straight out of
      // the street grid.
      if (green) {
        // Would it still be in the box when the other direction is released?
        // This one applies to a compulsory turn as much as to anything else —
        // MORE so, in fact. Exempting forced turns from it let a slow truck
        // enter on the last of the green, run out of phase mid-manoeuvre, and
        // then find the turn unavailable because the light had changed; it
        // drifted out the far side with a turn it could no longer take.
        const crossSpeed = Math.max(v.speed, v.cruise * 0.55);
        const crossTime = (ROAD_WIDTH + v.length) / crossSpeed;
        if (crossTime > this._timeToCrossGreen(v.axis, ix, iz, this._clock)) mayEnter = false;
        // Is there anywhere to come out into? Stopping in the middle of a
        // junction because the queue beyond it has not moved is the other way
        // traffic ends up across someone else's right of way. A vehicle that
        // is turning is not going to the far side, so this does not apply to
        // it — the room it needs is in the lane it joins, and _beginTurn
        // checks that itself.
        if (mayEnter && ahead && !v.mustTurn) {
          const needed = junction.distance + ROAD_WIDTH + v.length + SAFE_GAP;
          if (ahead.gap < needed) mayEnter = false;
        }
        // A vehicle that means to turn asks the same question of the lane it
        // is turning INTO, and asks it here, at the line — not from inside the
        // junction, where waiting blocks the traffic crossing it.
        if (mayEnter && v.turn !== 0 && junction.distance > -0.5
          && !this._turnExitClear(v, junction)) {
          // Rather than sit on the line holding up everyone behind, go straight
          // on if that way is open — which is what a driver does when the turn
          // they wanted is plainly not happening this phase. In a measured run,
          // queue heads waiting for a turn that had nowhere to go were 17% of
          // everything stopped at a junction, and each one was a whole approach
          // at a standstill behind it.
          //
          // Only ever onto the straight-ahead: it needs no arc and no room in
          // another lane, so it cannot fail halfway. Changing to the OTHER
          // turn at the line is the move that used to strand vehicles part-way
          // round a manoeuvre they had already driven past the start of.
          const last = this.roadX.length - 1;
          const onwards = junction.index + v.dir >= 0 && junction.index + v.dir <= last;
          const room = ahead ? ahead.gap : Infinity;
          const needed = junction.distance + ROAD_WIDTH + v.length + SAFE_GAP;
          // Deliberately NOT gated on the arrows. This is the escape valve for
          // a vehicle that is already at the line and stuck; closing it because
          // the street ahead is busy trades one blocked approach for another,
          // and in a measured run it cost more than the whole manager gained —
          // throughput in the eighth minute fell from 5.4 to 1.0.
          if (!v.mustTurn && onwards && room >= needed) {
            v.turn = 0;
            v.indicate = 0;
          } else {
            mayEnter = false;
          }
        }
      }
      if (!mayEnter && junction.distance > -0.5) {
        // The speed it could still be doing here and stop by the line.
        const room = Math.max(0, junction.distance - 0.5);
        desired = Math.min(desired, Math.sqrt(2 * v.brakeRate * room));
      }
      // A compulsory turn is approached slowly, but only over the last few
      // metres: crawling all the way in makes a long vehicle too slow to clear
      // the junction inside one phase.
      if (v.mustTurn && junction.distance < 2.5) {
        desired = Math.min(desired, City.corneringSpeed(v, TURN_RADIUS));
      }
      // Once it is INSIDE the junction the light no longer decides anything —
      // a manoeuvre already begun gets finished, which is both what a driver
      // does and what stops a vehicle being stranded mid-junction by a phase
      // change with nowhere legal to go.
      const committed = mayEnter || junction.distance < 0;
      if (v.turn !== 0 && committed && junction.distance < TURN_RADIUS + 3) {
        // Slowing for the corner, at the speed the corner allows rather than a
        // number: a vehicle going round a bend of radius R at speed s is being
        // pushed sideways at s squared over R, and there is only so much of
        // that a set of tyres will take — less for something tall, which goes
        // over before it slides. It used to take every corner in the city at a
        // flat 6.5 m/s whatever it was.
        desired = Math.min(desired, City.corneringSpeed(v, TURN_RADIUS));
        this._beginTurn(v, junction);
        if (v.arc) return;
        // A wait inside the junction is bounded. Standing still in the box is
        // what turns a queue into a deadlock — the traffic crossing it is
        // waiting for a gap that this vehicle is the reason nobody has — so
        // after a few seconds it stops waiting and creeps out instead. Under
        // that it holds, which is the safe thing and almost always enough: the
        // decision not to be here at all was made back at the line.
        if (v.mustTurn && v.atTurnPoint) desired = 0;
      }
    } else {
      // No junction ahead at all means this vehicle is past the last one and
      // driving away from the grid for good. Every path that leads here is
      // meant to be closed off — the forced turn at the edge, the crawl on the
      // approach, the near-side choice that needs no gap — but "meant to" is
      // not the same as "cannot", and the failure mode is a car receding into
      // the distance forever. So it turns round and rejoins the network.
      v.indicate = 0;
      const back = this.lanes.get(`${v.axis}|${-v.dir}|${v.lane.roadIndex}`);
      if (back) {
        const from = v.lane.members.indexOf(v);
        if (from >= 0) v.lane.members.splice(from, 1);
        v.lane = back;
        back.members.push(v);
        v.dir = -v.dir;
        v.fixed = back.fixed;
        if (v.axis === "x") v.z = v.fixed; else v.x = v.fixed;
        const forward = City.forwardOf(v.axis, v.dir);
        v.heading = Math.atan2(forward.z, forward.x);
        v.speed = Math.min(v.speed, City.corneringSpeed(v, v.arc ? v.arc.r : TURN_RADIUS));
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        this.strays++;
      }
    }

    desired = Math.max(0, Math.min(desired, v.cruise));
    const was = v.speed;
    if (desired > v.speed) {
      v.speed = Math.min(desired, v.speed + v.accel * dt);
      v.braking = false;
    } else {
      v.speed = Math.max(desired, v.speed - v.brakeRate * dt);
      // Brake lights come on for a real deceleration, and stay on at a
      // standstill, which is what a driver sees in a queue.
      v.braking = desired < v.speed - 0.05 || v.speed < 0.3;
    }
    v.stopped = v.speed < 0.15;
    void was;

    this._considerStopping(v, dt);

    const forward = City.forwardOf(v.axis, v.dir);
    v.x += forward.x * v.speed * dt;
    v.z += forward.z * v.speed * dt;
    // Hold the lane exactly; a hundred frames of floating point otherwise
    // walks a vehicle sideways out of its own carriageway. The kerb offset
    // rides on top of that, so a vehicle pulling in leaves the lane cleanly
    // and comes back to the middle of it.
    this._holdAtKerb(v);
    v.heading = Math.atan2(forward.z, forward.x);

    // No wrapping, and nothing is ever removed. The grid is closed, so a
    // vehicle that keeps driving keeps finding junctions; the only way it
    // leaves a street is by turning into another one.
  },

  /// Puts a vehicle on its lane, offset towards the kerb by however far it has
  /// pulled over.
  _holdAtKerb(v) {
    const kerb = Math.sign(City.laneOffset(v.axis, v.dir)) * v.kerbOffset;
    if (v.axis === "x") v.z = v.fixed + kerb; else v.x = v.fixed + kerb;
  },

  /// Pushes apart any two vehicles that have ended up inside one another.
  ///
  /// The driving model stops a vehicle before it reaches the one in front, and
  /// checks there is room in a lane before turning into it — but a turn takes
  /// time, and a gap that was there at the stop line can be gone by the time
  /// the vehicle comes out of the arc. At ordinary density that is rare and
  /// brief. At twice the density it is neither: measured over fifteen minutes,
  /// one overlap in ten lasted twenty seconds, the worst lasted eight minutes,
  /// and eighteen pairs were still interpenetrated at the end.
  ///
  /// Nothing ever separated them, because nothing was looking. This is that:
  /// walk each lane from the front, and where a vehicle is inside the one
  /// ahead, move it back until it is not. Worked from the front so a push
  /// cascades down the queue rather than shunting one vehicle into the next.
  _separateLanes() {
    for (const [, lane] of this.lanes) {
      const queue = [];
      for (const v of lane.members) {
        if (v.arc || v.manoeuvre || !City.blocksLane(v)) continue;
        queue.push(v);
      }
      if (queue.length < 2) continue;
      queue.sort((a, b) => City.progressOf(b) - City.progressOf(a));
      for (let i = 1; i < queue.length; i++) {
        const front = queue[i - 1];
        const back = queue[i];
        const need = (front.length + back.length) / 2 + NOSE_TO_TAIL;
        const gap = City.progressOf(front) - City.progressOf(back);
        if (gap >= need) continue;
        // Eased apart, never snapped. An unbounded correction moves a vehicle
        // as far as it takes in a single frame, which is a teleport — measured
        // at up to 16 m — and a vehicle that has just come out of a turn can
        // read as deeply overlapped for one frame while its lane and heading
        // catch up. A few centimetres a frame separates a real overlap in well
        // under a second and cannot produce a jump at all.
        const push = Math.min(need - gap, SEPARATE_STEP);
        if (back.axis === "x") back.x -= push * back.dir; else back.z -= push * back.dir;
        // And it is not going faster than what it just ran into.
        if (back.speed > front.speed) back.speed = front.speed;
      }
    }
  }
};
