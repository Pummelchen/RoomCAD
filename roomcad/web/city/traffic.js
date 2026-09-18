// City: traffic.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import * as THREE from "three";
import {
  ARROW_SIZE,
  CABIN_GLOW,
  FLEET_SIZE,
  GRID_RADIUS,
  LIGHT_CYCLE,
  PACE_FASTEST,
  PACE_SLOWEST,
  ROAD_WIDTH,
  SIGNAL_AMBER,
  SIGNAL_GREEN,
  SIGNAL_RED,
  VEHICLE_REF,
} from "./constants.js";
import { makeRandom } from "./helpers.js";
import { _arrowFace, _arrowRoll, _arrowScale, _m } from "./matrices.js";
import {
  buildBusGeometry,
  buildCarGeometry,
  buildTruckGeometry,
  buildVanGeometry,
} from "./vehicle-bodies.js";
import { City } from "../city.js";

export const traffic = {

  // MARK: - Traffic

  /// Every road in the grid, as a coordinate and an index. The paint, the
  /// signals and the traffic all read this, so it is worked out once up front
  /// rather than by each of them separately — three descriptions of the same
  /// street grid is three chances for them to disagree about where a junction
  /// is. Lights are timed off the index, so neighbouring junctions are
  /// deliberately out of step.
  _layoutRoads(cx, cz, span) {
    this.roadX = [];
    this.roadZ = [];
    for (let g = -GRID_RADIUS; g <= GRID_RADIUS + 1; g++) {
      this.roadX.push(cx + (g - 0.5) * span);
      this.roadZ.push(cz + (g - 0.5) * span);
    }
  },

  _buildTraffic(cx, cz, span, reach, rnd) {
    // How far beyond a junction the manager looks when judging whether the
    // street a turn feeds is full: one block and its road, which is exactly
    // the stretch a vehicle taking that turn commits itself to.
    this._turnLookahead = span;
    this._span = span;
    this.turnControl = new Map();
    this.turnLoads = new Map();
    this._turnRevision = 0;
    this._arrowsDrawn = -1;
    this._turnControlAt = 0;
    this._demand = new Map();
    // One key string per junction, interned here rather than rebuilt for every
    // vehicle every frame. The junction key is looked up per-VEHICLE — by the
    // demand picture and by the signal phase — but there are only as many
    // distinct junctions as there are cells, so the strings are made once and
    // indexed by the same road pair they name. `_junctionKey` is the only way
    // in, so the arithmetic index and the string can never disagree.
    this._junctionKeys = new Array(this.roadX.length * this.roadZ.length);
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        this._junctionKeys[ix * this.roadZ.length + iz] = `${ix}|${iz}`;
      }
    }
    // The same treatment for the turn-control keys. `turnsAllowedAt()` asks
    // "may this vehicle go?" for every vehicle every frame, and it used to build
    // `${axis}|${dir}|${ix}|${iz}` to do it — one string per vehicle per frame
    // for an answer that only changes every two seconds. There are two axes, two
    // directions and as many junctions as there are cells, so the whole key space
    // is small and made once. The strings are identical to the ones built by
    // hand in the turn review, so both maps share them and a caller that builds
    // its own still finds the same entry.
    const junctions = this.roadX.length * this.roadZ.length;
    this._turnKeys = new Array(4 * junctions);
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        for (const axis of ["x", "z"]) {
          for (const dir of [1, -1]) {
            this._turnKeys[this._turnKeyIndex(axis, dir, ix, iz)] = `${axis}|${dir}|${ix}|${iz}`;
          }
        }
      }
    }
    this._startSignals();
    // A lane object per road per direction. Every lane exists even where no
    // vehicle starts, because a turn has to have somewhere to turn into.
    this.lanes = new Map();
    const makeLane = (axis, dir, roadIndex) => {
      const road = axis === "x" ? this.roadZ[roadIndex] : this.roadX[roadIndex];
      const fixed = road + City.laneOffset(axis, dir);
      const lane = {
        axis, dir, roadIndex, fixed,
        center: axis === "x" ? cx : cz,
        reach,
        members: [],
      };
      this.lanes.set(`${axis}|${dir}|${roadIndex}`, lane);
      return lane;
    };
    for (let i = 0; i < this.roadZ.length; i++) {
      makeLane("x", 1, i);
      makeLane("x", -1, i);
    }
    for (let i = 0; i < this.roadX.length; i++) {
      makeLane("z", 1, i);
      makeLane("z", -1, i);
    }

    // Every lane in the grid, not just the middle few. Traffic used to be
    // confined to the roads within a block and a half of the room, on the
    // grounds that the rest was lost in fog — but the fog now reaches past the
    // hills, so those streets are plainly visible and were conspicuously
    // empty. Spreading the same fleet over the whole grid also keeps it
    // moving: packed onto four roads, adding vehicles made the traffic slower
    // rather than busier, which is what saturation does.
    const populated = [];
    for (let i = 0; i < this.roadZ.length; i++) {
      populated.push(this.lanes.get(`x|1|${i}`), this.lanes.get(`x|-1|${i}`));
    }
    for (let i = 0; i < this.roadX.length; i++) {
      populated.push(this.lanes.get(`z|1|${i}`), this.lanes.get(`z|-1|${i}`));
    }

    // The fleet, shared out over every lane as evenly as it divides. Sized as
    // a total rather than a per-lane count so that changing how many streets
    // are populated does not silently change how much traffic there is.
    this.cars = [];
    let id = 0;
    for (let li = 0; li < populated.length; li++) {
      const lane = populated[li];
      const share = Math.floor(FLEET_SIZE / populated.length)
        + (li < FLEET_SIZE % populated.length ? 1 : 0);
      if (!share) continue;
      // Somewhere to put them that is not in a junction. Nudging a vehicle out
      // of one is not enough on its own: several in the same lane get nudged
      // to the same side of the same junction and start life on top of each
      // other. So the clear stretches are worked out first, and the vehicles
      // spread along those.
      const crossing = lane.axis === "x" ? this.roadX : this.roadZ;
      const clearOf = ROAD_WIDTH / 2 + 12;
      const slots = [];
      for (let a = lane.center - reach; a <= lane.center + reach; a += 4) {
        if (!crossing.some(road => Math.abs(a - road) < clearOf)) slots.push(a);
      }
      if (!slots.length) continue;
      for (let k = 0; k < share; k++) {
        const pick = Math.floor((k + 0.2 + rnd() * 0.6) * slots.length / share);
        const along = slots[Math.max(0, Math.min(slots.length - 1, pick))];
        const spec = City.pickKind(rnd());
        const length = spec.length[0] + rnd() * (spec.length[1] - spec.length[0]);
        // The kind's base speed, times this driver's own pace. All of the
        // variation within a kind is the pace, so the spread is exactly the
        // one the constants describe.
        const pace = PACE_SLOWEST + rnd() * (PACE_FASTEST - PACE_SLOWEST);
        const cruise = spec.cruise * pace;
        const mass = spec.mass + rnd() * spec.load;
        const forward = City.forwardOf(lane.axis, lane.dir);
        const v = {
          id: id++,
          kind: spec.kind,
          spec,
          lane,
          axis: lane.axis,
          dir: lane.dir,
          fixed: lane.fixed,
          center: lane.center,
          reach,
          x: lane.axis === "x" ? along : lane.fixed,
          z: lane.axis === "x" ? lane.fixed : along,
          heading: Math.atan2(forward.z, forward.x),
          // Everything starts off slowly and works up to its cruising speed,
          // rather than the whole city being at full tilt on frame one.
          pace,
          pitch: 0,
          roll: 0,
          accelNow: 0,
          speed: cruise * (0.15 + rnd() * 0.3),
          cruise,
          // Weight, and what it does. Acceleration is a force divided by a
          // mass, so a loaded van pulls away like a loaded van; braking is
          // mostly the tyres, which do not care how heavy the vehicle is, but
          // not entirely — a heavy one takes longer to stop than the same
          // vehicle empty. Before this, every car in the city accelerated at
          // exactly the same rate and only its top speed differed.
          mass,
          accel: spec.accel * (spec.mass / mass),
          brakeRate: spec.brake * (0.8 + 0.2 * (spec.mass / mass)),
          grip: spec.grip,
          length,
          width: spec.width,
          bodyH: spec.bodyH,
          roofH: spec.roofH,
          roofFrac: spec.roofFrac,
          axles: spec.axles,
          wheelR: spec.kind === "car" ? 0.34 : 0.5,
          color: spec.colors[Math.floor(rnd() * spec.colors.length)],
          braking: false,
          stopped: false,
          indicate: 0,
          turnDecidedAt: -1,
          // Kerbside stopping: how far over towards the kerb it currently is,
          // where it is heading, and what it is doing there.
          kerbOffset: 0,
          kerbTarget: 0,
          stop: null,
          stopTarget: null,
          manoeuvre: null,
          goal: null,
          goalSince: 0,
          busStopAfter: 0,
          turn: 0,
          arc: null,
          rng: makeRandom(Math.floor(rnd() * 0xffffff) + 1),
        };
        lane.members.push(v);
        this.cars.push(v);
      }
    }

    this._allocateVehicleMeshes();
    this._writeCarMatrices();
  },

  /// One InstancedMesh per kind of part, sized for the whole fleet. Vehicles
  /// never change type, so each one owns a fixed slice of every buffer and the
  /// per-frame work is pure matrix writing. The lamps are the exception: they
  /// are packed each frame and the instance count moved, so a lamp that is off
  /// is simply not drawn rather than drawn at zero size.
  /// One InstancedMesh per kind of vehicle, each holding the whole merged
  /// body. A vehicle is then one matrix a frame instead of eight, which is how
  /// the detail pays for itself. The lamps are the exception: they come and go
  /// independently of the body, so they keep their own meshes and their counts
  /// move as lamps light and go out.
  _allocateVehicleMeshes() {
    const n = this.cars.length;
    if (!n) return;

    const geometryFor = {
      car: () => buildCarGeometry(VEHICLE_REF.car.L, VEHICLE_REF.car.W, VEHICLE_REF.car.wheelR),
      van: () => buildVanGeometry(VEHICLE_REF.van.L, VEHICLE_REF.van.W, VEHICLE_REF.van.wheelR),
      truck: () => buildTruckGeometry(VEHICLE_REF.truck.L, VEHICLE_REF.truck.W, VEHICLE_REF.truck.wheelR),
      bus: () => buildBusGeometry(VEHICLE_REF.bus.L, VEHICLE_REF.bus.W, VEHICLE_REF.bus.wheelR),
    };

    const c = new THREE.Color();
    this.vehicleMeshes = {};
    for (const kind of Object.keys(geometryFor)) {
      const list = this.cars.filter(v => v.kind === kind);
      if (!list.length) continue;
      const geo = geometryFor[kind]();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.42, metalness: 0.22,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = "city-vehicles-" + kind;
      // Traffic throws the shadows that move, which is most of what tells you
      // the sun is where it is.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      // One colour write per vehicle, so the buffer exists and has the right
      // size. Which slot a vehicle occupies is decided fresh every frame by the
      // culling, so the colours are rewritten there — see _writeCarMatrices.
      list.forEach((v, i) => {
        v.slot = i;
        // Paint multiplies the body's own vertex colours: white panels take
        // it, glass and tyres are dark enough to stay dark under it.
        mesh.setColorAt(i, c.setHex(v.color));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.vehicleMeshes[kind] = mesh;
    }

    const make = (geo, mat, count) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };
    const lamp = (color, emissive, intensity) => new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity, roughness: 0.4,
    });
    this.carParts = {
      head: make(new THREE.BoxGeometry(1, 1, 1), lamp(0xfff3d0, 0xffe9b8, 0), n * 2),
      tail: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x4a1210, 0xd8241a, 1.1), n * 2),
      brake: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x5a1512, 0xff2a18, 3.0), n * 2),
      indicator: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x5a3a10, 0xffa621, 3.0), n * 2),
      // The cabin: a dim warm panel inside the greenhouse, one per vehicle.
      // Every car on a road at night has something lit inside it — the dash at
      // least — and without it the traffic reads as empty shells with lamps
      // bolted on.
      cabin: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x2a2118, CABIN_GLOW, 0.35), n),
    };
    this.headlights = this.carParts.head;
  },

  /// One mesh per colour, each big enough for every signal in the city, since
  /// nothing stops a whole grid showing red together.
  _buildSignalLamps() {
    const n = this.signals.length;
    if (!n) { this.signalLamps = null; return; }
    const make = (color) => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.6, roughness: 0.35,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };
    this.signalLamps = {
      red: make(SIGNAL_RED),
      amber: make(SIGNAL_AMBER),
      green: make(SIGNAL_GREEN),
    };
    this.signalLamps.red.name = "city-signal-red";
    this.signalLamps.amber.name = "city-signal-amber";
    this.signalLamps.green.name = "city-signal-green";
    this._writeSignalLamps();
  },

  /// The turn arrows: one mesh per colour, each big enough for every arrow in
  /// the city, since nothing stops them all showing the same thing at once.
  ///
  /// An arrow is drawn pointing up and rolled about the face normal to point
  /// left or right, so there is one shape rather than three that could disagree
  /// about size or weight.
  _buildTurnArrows() {
    const n = this.signals.length * 3;
    if (!n) { this.turnArrows = null; return; }

    const shape = new THREE.Shape();
    shape.moveTo(-0.22, -1);
    shape.lineTo(0.22, -1);
    shape.lineTo(0.22, 0.05);
    shape.lineTo(0.62, 0.05);
    shape.lineTo(0, 1);
    shape.lineTo(-0.62, 0.05);
    shape.lineTo(-0.22, 0.05);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);

    const make = (color) => {
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.5, roughness: 0.4,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(mat);
      return mesh;
    };
    this._disposables.push(geo);
    this.turnArrows = { green: make(SIGNAL_GREEN), red: make(SIGNAL_RED) };
    this.turnArrows.green.name = "city-turn-arrows-green";
    this.turnArrows.red.name = "city-turn-arrows-red";
    this._writeTurnArrows();
  },

  /// Shows what the manager has decided, on the pole. Read from the same map
  /// the drivers read, so an arrow cannot show green for a turn the junction is
  /// refusing — the failure that would make the whole thing decoration.
  _writeTurnArrows() {
    const parts = this.turnArrows;
    if (!parts || !this.signals.length) return;
    // Only when the arrows have actually changed. There are three arrows for
    // every signal — one per turn — so rewriting them all every frame cost more
    // than driving the whole fleet did: the single most expensive thing in the
    // simulation, for a picture that was identical 119 frames out of 120.
    if (this._arrowsDrawn === this._turnRevision) return;
    this._arrowsDrawn = this._turnRevision;
    let green = 0;
    let red = 0;
    for (const s of this.signals) {
      const allow = this.turnsAllowedAt(s.axis, s.dir, s.ix, s.iz);
      for (const arrow of s.arrows) {
        // A turn that leads nowhere at all — off the edge of the grid — has no
        // arrow lit rather than a red one: there is no such movement to forbid.
        if (allow && !allow.has(arrow.turn)) continue;
        const on = !allow || allow.get(arrow.turn) === true;
        const mesh = on ? parts.green : parts.red;
        const slot = on ? green++ : red++;
        mesh.setMatrixAt(slot, this._arrowMatrix(s, arrow, _m));
      }
    }
    parts.green.count = green;
    parts.red.count = red;
    parts.green.instanceMatrix.needsUpdate = true;
    parts.red.instanceMatrix.needsUpdate = true;
  },

  /// One arrow's transform: sized, rolled to point its way, turned to face the
  /// traffic, and put on its mount.
  _arrowMatrix(signal, arrow, into) {
    const roll = arrow.turn * Math.PI / 2;
    const face = Math.PI / 2 - signal.heading;
    return into
      .makeTranslation(arrow.x, arrow.y, arrow.z)
      .multiply(_arrowFace.makeRotationY(face))
      .multiply(_arrowRoll.makeRotationZ(roll))
      .multiply(_arrowScale.makeScale(ARROW_SIZE, ARROW_SIZE, 1));
  },

  /// Junction timing. The offset is derived from the road indices so that
  /// neighbouring junctions run out of phase, which is what produces the
  /// stop-start rhythm rather than the whole grid moving as one.
  _junctionOffset(ix, iz) {
    return (((ix * 5 + iz * 3) % 4) + 4) % 4 / 4 * LIGHT_CYCLE;
  }
};
