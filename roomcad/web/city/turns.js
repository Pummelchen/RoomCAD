// City: turn control.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  CROSSING_TURN,
  NEAR_SIDE_TURN,
  SAFE_GAP,
  TURN_CONTROL_PERIOD,
  TURN_LOAD_FACTOR,
  TURN_LOAD_FLOOR,
  TURN_RADIUS,
  TURN_REVIEW_FROM,
  TURN_SLOT,
} from "./constants.js";
import { trueRandom } from "./helpers.js";
import { City } from "../city.js";

export const turns = {

  // MARK: - Turn control

  /// Which turns each approach is currently allowing.
  ///
  /// The point is not to ration the traffic but to spread it: a turn is only
  /// forbidden when the stretch of road it feeds is markedly fuller than the
  /// city's average, so vehicles are steered off the streets that are filling
  /// and onto the ones that are not. Reviewed a few times a minute rather than
  /// every frame — a vehicle picks its turn two junctions in advance, so an
  /// arrow that flickered would decide nothing.
  _updateTurnControl() {
    if (!this.lanes || !this.lanes.size || this._clock < this._turnControlAt) return;
    this._turnControlAt = this._clock + TURN_CONTROL_PERIOD;

    const room = this._turnLookahead / TURN_SLOT;
    const last = this.roadX.length - 1;
    const laneKey = lane => `${lane.axis}|${lane.dir}|${lane.roadIndex}`;

    // ── 1. Where every vehicle is, right now ──────────────────────────────
    const positions = new Map();
    let standing = 0;
    let capacity = 0;
    for (const [key, lane] of this.lanes) {
      const at = [];
      for (const v of lane.members) {
        if (v.arc || !City.blocksLane(v)) continue;
        at.push(City.progressOf(v));
      }
      at.sort((a, b) => a - b);
      positions.set(key, at);
      standing += at.length;
      capacity += (lane.reach * 2) / TURN_SLOT;
    }
    const average = capacity > 0 ? standing / capacity : 0;
    const limit = Math.max(TURN_LOAD_FLOOR, average * TURN_LOAD_FACTOR);

    const countBeyond = (lane, from) => {
      const at = positions.get(laneKey(lane));
      if (!at) return 0;
      let n = 0;
      for (const p of at) {
        if (p < from) continue;
        if (p >= from + this._turnLookahead) break;
        n++;
      }
      return n;
    };

    // ── 2. Every junction, every approach, and where each turn leads ──────
    //
    // A segment is one stretch of one lane beyond one junction, and it is what
    // the manager actually protects. Two different approaches can pour into
    // the same stretch — the traffic going straight through, and the traffic
    // turning in off the cross street — so they have to be recognised as the
    // same place or each would be judged as though the other were not there.
    const segments = new Map();
    const segmentFor = (lane, from, entryIndex) => {
      const key = `${laneKey(lane)}@${entryIndex}`;
      let seg = segments.get(key);
      if (!seg) {
        seg = { key, standing: countBeyond(lane, from), inbound: 0 };
        segments.set(key, seg);
      }
      return seg;
    };

    const approaches = new Map();
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        for (const axis of ["x", "z"]) {
          for (const dir of [1, -1]) {
            const roadIndex = axis === "x" ? iz : ix;
            const index = axis === "x" ? ix : iz;
            const lane = this.lanes.get(`${axis}|${dir}|${roadIndex}`);
            if (!lane) continue;
            const coord = axis === "x" ? this.roadX[ix] : this.roadZ[iz];

            const moves = [];
            if (index + dir >= 0 && index + dir <= last) {
              // Carrying on enters this same lane's next stretch.
              moves.push({ turn: 0, demand: 0, seg: segmentFor(lane, coord * dir, index) });
            }
            for (const turn of [NEAR_SIDE_TURN, CROSSING_TURN]) {
              const target = this._turnTarget({ axis, dir, fixed: lane.fixed, turn },
                                              { index, coord });
              if (!target) continue;
              if (roadIndex + target.newDir < 0 || roadIndex + target.newDir > last) continue;
              // Turning enters the new lane at the road it is turning off, so
              // along THAT lane the entry is at this approach's road index.
              moves.push({
                turn, demand: 0,
                seg: segmentFor(target.lane, target.exitProgress, roadIndex),
              });
            }
            if (!moves.length) continue;
            approaches.set(this._turnKey(axis, dir, ix, iz), { axis, dir, ix, iz, moves });
          }
        }
      }
    }

    // ── 3. What every vehicle intends to do next ─────────────────────────
    //
    // The occupancy above is where the traffic IS; this is where it is about
    // to be, which is the half that matters. A stretch with room for three
    // more vehicles and eleven already committed to entering it is full, and
    // waiting until they arrive to notice is waiting until the approach behind
    // them has already backed up.
    for (const v of this.cars) {
      if (v.arc || v.stop) continue;
      const junction = this._nextJunction(v);
      if (!junction) continue;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const approach = approaches.get(`${v.axis}|${v.dir}|${ix}|${iz}`);
      if (!approach) continue;
      if (v.turnDecidedAt === this._junctionId(v.axis, v.dir, junction.index)) {
        const move = approach.moves.find(m => m.turn === v.turn);
        if (move) { move.demand++; move.seg.inbound++; }
        continue;
      }
      // Undecided. It will choose among whatever is green when it decides, so
      // it is counted as a share of each rather than not at all.
      const open = approach.moves.filter(m => this._permits(approach, m.turn));
      const spread = open.length ? open : approach.moves;
      for (const m of spread) {
        m.demand += 1 / spread.length;
        m.seg.inbound += 1 / spread.length;
      }
    }

    // ── 4. The decision, for all four sides of every junction ────────────
    const projected = seg => (seg.standing + seg.inbound) / room;
    let forbidden = 0;

    const settle = approach => {
      const allow = new Map();
      for (const m of approach.moves) allow.set(m.turn, projected(m.seg) <= limit);
      // Never all four sides of a junction closed to a vehicle at once: an
      // approach showing nothing but red is a deadlock the manager caused
      // rather than one it prevented. The emptiest way out always stays open.
      if (![...allow.values()].some(Boolean)) {
        let best = approach.moves[0];
        for (const m of approach.moves) if (projected(m.seg) < projected(best.seg)) best = m;
        allow.set(best.turn, true);
      }
      return allow;
    };

    for (const approach of approaches.values()) approach.allow = settle(approach);

    // Traffic turned away from a full stretch does not evaporate — it takes
    // one of the other exits from the same approach. Crediting it there before
    // deciding is what stops the manager solving one street by filling its
    // neighbour and only noticing at the next review.
    for (const approach of approaches.values()) {
      const shed = approach.moves.filter(m => approach.allow.get(m.turn) === false);
      const open = approach.moves.filter(m => approach.allow.get(m.turn) === true);
      if (!shed.length || !open.length) continue;
      let moved = 0;
      for (const m of shed) { moved += m.demand; m.seg.inbound -= m.demand; }
      for (const m of open) m.seg.inbound += moved / open.length;
    }

    for (const [key, approach] of approaches) {
      const allow = settle(approach);
      for (const [, ok] of allow) if (!ok) forbidden++;
      this.turnControl.set(key, allow);
      // How full each way out is, kept for the routing. A vehicle picking the
      // shortest way to its destination and nothing else pours every journey
      // that shares a direction onto the same streets; with this it can weigh
      // a longer way round against a queue, which is what a driver does.
      const loads = new Map();
      for (const m of approach.moves) loads.set(m.turn, projected(m.seg));
      this.turnLoads.set(key, loads);
    }

    this._turnRevision = (this._turnRevision || 0) + 1;
    this.turnStats = {
      average, limit, forbidden,
      approaches: approaches.size,
      busiest: Math.max(0, ...[...segments.values()].map(projected)),
    };
  },

  /// Whether an approach was allowing a turn at the last review. Used while
  /// building the next one, so an undecided vehicle is credited to the turns it
  /// could actually take.
  _permits(approach, turn) {
    const allow = this.turnControl.get(this._turnKey(approach.axis, approach.dir, approach.ix, approach.iz));
    if (!allow || !allow.has(turn)) return true;
    return allow.get(turn) === true;
  },

  /// What the arrows are showing one approach. Vehicles and the arrows on the
  /// pole both read this, so what a driver is allowed to do and what the
  /// signal says cannot drift apart.
  turnsAllowedAt(axis, dir, ix, iz) {
    return this.turnControl.get(this._turnKey(axis, dir, ix, iz)) || null;
  },

  _turnPermitted(v, junction, turn) {
    const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
    const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
    const allow = this.turnsAllowedAt(v.axis, v.dir, ix, iz);
    if (!allow || !allow.has(turn)) return true;
    return allow.get(turn) === true;
  },

  /// Chooses whether this vehicle turns at the junction it is approaching.
  /// Decided once, well before the junction, so the indicator has time to run
  /// before anything actually happens — which is the whole point of one.
  /// Straight on, or left, or right — chosen fresh at every junction, and
  /// constrained so the choice always leads somewhere. The street grid is a
  /// CLOSED network: a vehicle that reaches the outermost road must turn along
  /// it rather than carry on into nothing, so traffic circulates indefinitely
  /// and no vehicle is ever removed or teleported. Before this, a vehicle ran
  /// to the edge and was wrapped round to the far side, which is a car
  /// vanishing from one street and appearing in another.
  _decideTurn(v, junction) {
    // Already pulling in somewhere. Its space is on THIS street, a few metres
    // ahead — taking a turn now carries it onto another one still holding a
    // reservation it can no longer reach, and the turn arc moves it sideways
    // out of the approach it was lined up on.
    //
    // Except at the edge of the grid, where carrying straight on is not a
    // choice: there is no road there. Holding a vehicle straight anyway drove
    // it off the end of the street network and into the safety net.
    if (v.stopTarget) {
      const last = this.roadX.length - 1;
      const onwards = junction.index + v.dir >= 0 && junction.index + v.dir <= last;
      if (onwards) {
        // Carrying straight on, to the space it is pulling into.
        //
        // The junction decision it was holding is GONE, not merely overridden,
        // which is why this clears `turnDecidedAt` as well. Leaving it recorded
        // let a bus that had decided a compulsory turn at the edge of the grid
        // pull in somewhere further in, keep the stale record, and then be told
        // "already decided" when it came back to that same edge junction — where
        // the stale decision was to carry straight on, and straight on is not a
        // road. It went past the last junction and off the grid at full cruise
        // until the safety net turned it round. Reproduced by fuzzing; the seed
        // is recorded in the tracker.
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        return;
      }
    }

    if (v.turnDecidedAt === this._junctionId(v.axis, v.dir, junction.index)) {
      // Already chosen — but the arrows are reviewed while it approaches, and a
      // driver whose exit has gone red picks another rather than queueing for a
      // turn they are not going to be allowed to make. Only while there is
      // still room to line up: changing your mind on the line is how a vehicle
      // ends up committed to a turn it has already driven past.
      //
      // A record is only worth keeping if it is a decision this junction can
      // still act on, and "carry straight on" is not a decision anywhere there
      // is no road straight on. A vehicle that arrives at the outermost
      // junction holding one has nothing to act on, so it is treated as
      // undecided and decides again below, where the compulsory turn is.
      //
      // Every writer clears the record when it overrides the decision — see the
      // stop-for-a-space path, which is where this went wrong — but this is the
      // reader's own guard, so the invariant holds here whatever a future
      // writer forgets.
      const lastRoad = this.roadX.length - 1;
      const canCarryOn = junction.index + v.dir >= 0 && junction.index + v.dir <= lastRoad;
      if (v.turn !== 0 || canCarryOn) {
        if (junction.distance < TURN_REVIEW_FROM) return;
        if (this._turnPermitted(v, junction, v.turn)) return;
      }
      v.turnDecidedAt = -1;
    }
    v.turnDecidedAt = this._junctionId(v.axis, v.dir, junction.index);
    v.turn = 0;
    v.mustTurn = false;

    const last = this.roadX.length - 1;   // both road lists are the same length
    // Is there another junction beyond this one, on this road?
    const straightOn = junction.index + v.dir >= 0 && junction.index + v.dir <= last;

    // Which turns lead to a road that itself has somewhere to go. After
    // turning, the vehicle travels along the new axis starting from the road
    // it is on now, so the next junction it would meet is one step from its
    // CURRENT road index.
    const forward = City.forwardOf(v.axis, v.dir);
    const legal = [];
    for (const t of [NEAR_SIDE_TURN, CROSSING_TURN]) {
      const side = t === NEAR_SIDE_TURN
        ? { x: -forward.z, z: forward.x }
        : { x: forward.z, z: -forward.x };
      const newDir = Math.abs(side.x) > 0.5 ? Math.sign(side.x) : Math.sign(side.z);
      const next = v.lane.roadIndex + newDir;
      if (next >= 0 && next <= last) legal.push(t);
    }
    if (!legal.length) return;

    // Not the vehicle's seeded stream: which way it goes at a junction is
    // meant to differ every time the room is opened.
    const r = trueRandom();
    if (!straightOn) {
      // The edge of the grid. Turning is not optional here, so it takes the
      // NEAR-SIDE turn whenever that is available — always, if both are. The
      // crossing turn has to give way to oncoming traffic, and a compulsory
      // move that can be blocked is one the vehicle can be carried past while
      // it waits, leaving it driving away from the last junction it will ever
      // meet. Free choices further in are where the variety comes from.
      // The arrows deliberately do not apply here. This turn is compulsory, and
      // the near-side one is the only one that needs no gap in oncoming traffic
      // — sending a vehicle across the far side because an arrow was red is
      // sending it into a move it can be held out of indefinitely, at the last
      // junction it will ever meet.
      v.turn = legal.includes(NEAR_SIDE_TURN) ? NEAR_SIDE_TURN : legal[0];
      v.mustTurn = true;
      return;
    }

    // Otherwise it is a free choice, taken evenly between the options that
    // exist: carry on, turn left, turn right.
    //
    // It used to be weighted heavily towards carrying on — a car turned at
    // only one junction in three, a bus at one in six — and that quietly
    // pushed the whole fleet onto the ring road. A vehicle that does not turn
    // runs the length of the street, and the turn at the END of a street is
    // compulsory; turning at the outermost junction is, by construction, what
    // puts a vehicle ON the outermost road. The ring is then closed under
    // those same compulsory turns, because the only legal turn at a corner is
    // onto the other outer road. Easy to fall into, one chance in three per
    // junction to leave: with 40 vehicles and no congestion at all, half of
    // them ended up circling the edge of the city.
    //
    // An even choice means a vehicle almost never reaches the boundary by
    // default — three junctions of carrying on is one chance in twenty-seven —
    // and any that does has an even chance of turning back in at the next one.
    const options = [0];
    for (const t of legal) options.push(t);
    // ... and only among the ones the junction is currently allowing. The
    // manager guarantees at least one, so this never empties the list.
    const green = options.filter(t => this._turnPermitted(v, junction, t));
    const from = green.length ? green : options;

    // A vehicle with somewhere to be takes the way that gets it closer. Ties
    // are broken at random and so is the choice when nothing helps, which is
    // what keeps identical journeys from becoming a single worn path.
    if (v.goal && v.goal.lane) {
      // Already on the right street with the space still ahead: carry straight
      // on to it. Left to the cost function, a vehicle one junction short of
      // its space scores every movement the same and turns off at the last
      // corner before arriving.
      if (v.lane === v.goal.lane) {
        const along = v.axis === "x" ? v.x : v.z;
        if ((v.goal.at - along) * v.dir > 0 && straightOn
          && this._turnPermitted(v, junction, 0)) { v.turn = 0; return; }
      }
      const goalCell = City.cellOf(v.goal, this.roadX, this.roadZ);
      let best = Infinity;
      const ties = [];
      for (const t of from) {
        const cost = this._costAfter(v, junction, t, goalCell, v.goal.lane);
        if (cost < best - 1e-6) { best = cost; ties.length = 0; }
        if (cost <= best + 1e-6) ties.push(t);
      }
      if (ties.length && best < Infinity) {
        v.turn = ties[Math.floor(r * ties.length) % ties.length];
        return;
      }
    }
    v.turn = from[Math.floor(r * from.length) % from.length];
  },

  /// Sets up the quarter-circle a turning vehicle follows. The arc is tangent
  /// to both lane centrelines, so the vehicle leaves its lane and joins the
  /// next one without a kink at either end.
  /// Where a turn at this junction would put the vehicle: which lane, where
  /// the two lane centrelines cross, and where on the new lane it would come
  /// out. Shared, because the decision to ENTER the junction and the act of
  /// turning inside it must agree about the answer — the first is made at the
  /// stop line and the second several metres later.
  _turnTarget(v, junction) {
    const forward = City.forwardOf(v.axis, v.dir);
    // right(ax, az) = (-az, ax); left is its negative.
    const side = v.turn === 1
      ? { x: -forward.z, z: forward.x }
      : { x: forward.z, z: -forward.x };
    const newAxis = Math.abs(side.x) > 0.5 ? "x" : "z";
    const newDir = newAxis === "x" ? Math.sign(side.x) : Math.sign(side.z);
    // The road being turned onto is the one that makes this junction, so its
    // index is the junction's own index.
    const lane = this.lanes.get(`${newAxis}|${newDir}|${junction.index}`);
    if (!lane) return null;
    // The two lane centrelines cross here.
    const P = newAxis === "z"
      ? { x: lane.fixed, z: v.fixed }
      : { x: v.fixed, z: lane.fixed };
    const exitProgress = newAxis === "x"
      ? (P.x + TURN_RADIUS * side.x) * newDir
      : (P.z + TURN_RADIUS * side.z) * newDir;
    return { forward, side, newAxis, newDir, lane, P, exitProgress };
  },

  /// Is there somewhere to come OUT into? Asked at the stop line, before the
  /// vehicle commits to entering the junction.
  ///
  /// This is the difference between a queue and a deadlock. Held inside the
  /// box, a vehicle waiting for a gap blocks the traffic crossing it, which is
  /// waiting for the same kind of gap somewhere else — and in a measured run
  /// the whole grid stopped, permanently, with 24 held mid-turn and 184 queued
  /// behind them. A driver decides before entering, and waits on the line,
  /// where waiting costs nobody else their right of way.
  _turnExitClear(v, junction) {
    const target = this._turnTarget(v, junction);
    if (!target) return true;
    const need = v.length / 2 + SAFE_GAP + 2.5;
    for (const other of target.lane.members) {
      if (other === v || other.arc) continue;
      const gap = Math.abs(City.progressOf(other) - target.exitProgress);
      if (gap < need + other.length / 2) return false;
    }
    return true;
  }
};
