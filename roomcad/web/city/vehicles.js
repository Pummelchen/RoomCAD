// City: vehicles.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import * as THREE from "three";
import {
  BLINK_HZ,
  CABIN_HEIGHT,
  LIGHTS_OUT_EVERY,
  LIGHTS_OUT_SHARE,
  ROAD_Y,
  VEHICLE_CONE,
  VEHICLE_KEEP_NEAR,
  VEHICLE_REF,
} from "./constants.js";
import { clamp01 } from "./helpers.js";
import { _m, _paint, bodyMatrix, boxMatrix } from "./matrices.js";

export const vehicles = {

  /// Which vehicle a particular instance of a vehicle mesh is. A raycast
  /// against an InstancedMesh reports the instance it hit but nothing about
  /// what that instance MEANS, so this is the translation — without it a
  /// paintball can tell it hit a car but not which car, and the splat has
  /// nowhere to live except world space, where the car promptly drives out
  /// from under it.
  vehicleForInstance(meshName, instanceId) {
    if (!this.vehicleMeshes || instanceId === undefined || instanceId === null) return null;
    // A vehicle that is not drawn has no slot, and -1 is not one.
    if (instanceId < 0) return null;
    const kind = String(meshName).replace("city-vehicles-", "");
    if (!this.vehicleMeshes[kind]) return null;
    for (const v of this.cars) {
      if (v.kind === kind && v.slot === instanceId) return v;
    }
    return null;
  },

  /// The world transform of one vehicle — the same one its body is drawn with,
  /// composed here rather than reconstructed by the caller so the two cannot
  /// drift apart.
  vehicleMatrix(v, into = null) {
    const ref = VEHICLE_REF[v.kind];
    return bodyMatrix(v.x, ROAD_Y, v.z, v.length / ref.L, 1, 1,
      -v.heading, v.pitch || 0, v.roll || 0, into || new THREE.Matrix4());
  },

  _writeCarMatrices() {
    if (!this.carParts || !this.vehicleMeshes) return;
    const { head, tail, brake, indicator, cabin } = this.carParts;
    // This function decides only which lamp INSTANCES exist; a lamp that is off
    // is simply not written. Headlights exist in daylight as well as at night,
    // because they are running lamps — what the time of day changes is their
    // BRIGHTNESS, and that is a per-material property set in applyTimeOfDay()
    // (`head`, `tail` and `cabin` each get a `0.x + night * y` emissive). The
    // `night` factor that used to sit here was a leftover from when that split
    // was made the other way round; it was dead, and the behaviour it looked
    // like it controlled is pinned by the day/night headlight checks in
    // tests/city-fuzz.test.mjs.
    const blinkOn = ((this._clock * BLINK_HZ) % 1) < 0.55;
    let heads = 0;
    let tails = 0;
    let brakes = 0;
    let indicators = 0;
    let cabins = 0;

    // Only the traffic near enough to be worth drawing.
    //
    // A vehicle is around a thousand triangles and there are FLEET_SIZE of
    // them, so the fleet is hundreds of thousands of triangles — a large share
    // of everything in the city. All of it was drawn every frame, and drawn
    // again into every shadow map, when a quarter of it is within a hundred
    // metres and the rest is behind buildings or lost in the fog. The instances
    // are packed towards the front of the mesh and the count is set to what was
    // written, which is the one thing an InstancedMesh lets you do cheaply.
    const seen = this._viewer;
    const look = this._viewDir;
    for (const mesh of Object.values(this.vehicleMeshes)) mesh.count = 0;

    for (let i = 0; i < this.cars.length; i++) {
      const v = this.cars[i];
      const mesh = this.vehicleMeshes[v.kind];
      if (!mesh) continue;
      const dx = v.x - seen.x;
      const dz = v.z - seen.z;
      const away = dx * dx + dz * dz;
      const behind = look
        && away > VEHICLE_KEEP_NEAR * VEHICLE_KEEP_NEAR
        && (dx * look.x + dz * look.z) < Math.sqrt(away) * VEHICLE_CONE;
      if (behind) {
        // Marked as drawn nowhere. A stale slot would make a paintball that
        // hits one vehicle report a hit on another.
        v.slot = -1;
        continue;
      }
      v.slot = mesh.count++;
      // The colour goes with it. Slots are handed out fresh every frame now
      // that the traffic is culled, so a vehicle rarely sits in the same one
      // twice — and the colours were written once, at build time, per slot.
      // Every car in the city changed colour as the packing shifted under it.
      // The upload is flagged once per mesh below, not once per vehicle: the
      // flag is a flag, and setting it six hundred times a frame bought nothing.
      if (mesh.instanceColor) mesh.setColorAt(v.slot, _paint.setHex(v.color));
      const ref = VEHICLE_REF[v.kind];
      const rotY = -v.heading;
      const fx = Math.cos(v.heading);
      const fz = Math.sin(v.heading);
      const rx = -fz;          // the vehicle's right-hand side
      const rz = fx;

      // The body is modelled at a reference length and stretched to this
      // vehicle's own; everything else about it is already in the mesh.
      mesh.setMatrixAt(v.slot, bodyMatrix(
        v.x, ROAD_Y, v.z, v.length / ref.L, 1, 1, rotY, v.pitch || 0, v.roll || 0, _m
      ));

      // Lamps, arranged the way a real car's are: a cluster at each of the
      // four corners. The white headlight and the red tail light sit outboard
      // where the corner is, and the amber indicator sits immediately inboard
      // of each — one housing, read as one unit. Nothing is drawn at zero
      // size; a lamp that is off is simply not written.
      const L = v.length;
      const W = v.width;
      const nose = L / 2 + 0.02;
      const back = -L / 2 - 0.02;
      const lampY = ROAD_Y + ref.lampY;
      const outer = W * 0.36;
      const inner = W * 0.19;

      // Headlights are ALWAYS lit — running lamps, as on any modern car. What
      // changes with the time of day is how bright they are, not whether they
      // exist.
      for (const s of [-1, 1]) {
        head.setMatrixAt(heads++, boxMatrix(
          v.x + fx * nose + rx * outer * s,
          lampY, v.z + fz * nose + rz * outer * s,
          0.16, 0.17, 0.30, rotY, _m
        ));
      }

      // The rear lamp is one housing at two brightnesses, which is how a real
      // one works: lit at its standard intensity all the time, jumping to the
      // bright filament only while the brakes are applied and dropping
      // straight back afterwards. Exactly one of the two meshes is written per
      // side, so they never stack in the same place.
      for (const s of [-1, 1]) {
        const m = boxMatrix(
          v.x + fx * back + rx * outer * s,
          lampY, v.z + fz * back + rz * outer * s,
          0.13, 0.19, v.braking ? 0.34 : 0.32, rotY, _m
        );
        if (v.braking) brake.setMatrixAt(brakes++, m);
        else tail.setMatrixAt(tails++, m);
      }
      if (v.indicate !== 0 && blinkOn) {
        const s = v.indicate;   // +1 right-hand side, -1 left-hand side
        indicator.setMatrixAt(indicators++, boxMatrix(
          v.x + fx * nose + rx * inner * s,
          lampY, v.z + fz * nose + rz * inner * s,
          0.12, 0.16, 0.20, rotY, _m
        ));
        indicator.setMatrixAt(indicators++, boxMatrix(
          v.x + fx * back + rx * inner * s,
          lampY, v.z + fz * back + rz * inner * s,
          0.12, 0.16, 0.20, rotY, _m
        ));
      }

      // Something lit inside. Sat where the greenhouse is — back from the
      // nose, up at window height — and sized to the vehicle, so a bus glows
      // along its whole length and a car shows a patch above the dash.
      cabin.setMatrixAt(cabins++, boxMatrix(
        v.x - fx * v.length * 0.05, ROAD_Y + ref.lampY + CABIN_HEIGHT,
        v.z - fz * v.length * 0.05,
        v.length * 0.42, 0.16, v.width * 0.62, rotY, _m
      ));
    }

    for (const kind of Object.keys(this.vehicleMeshes)) {
      const mesh = this.vehicleMeshes[kind];
      mesh.instanceMatrix.needsUpdate = true;
      // Every slot this mesh kept had a colour written into it above, so the
      // colour upload is flagged once per mesh that is actually drawing
      // something, rather than once per vehicle.
      if (mesh.instanceColor && mesh.count) mesh.instanceColor.needsUpdate = true;
    }
    head.count = heads;
    tail.count = tails;
    brake.count = brakes;
    indicator.count = indicators;
    cabin.count = cabins;
    head.instanceMatrix.needsUpdate = true;
    tail.instanceMatrix.needsUpdate = true;
    brake.instanceMatrix.needsUpdate = true;
    indicator.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
  },

  /// Advances the traffic and the weather. `viewer` is where the camera is, so
  /// the precipitation can follow it rather than being a fixed block of rain
  /// somewhere over the neighbourhood.
  update(dt, viewer = null, forward = null) {
    // The simulation has a stability limit of its own, independent of whatever
    // the render loop hands it: a single enormous step would carry a vehicle
    // through a junction, past the car in front and out of its lane in one go.
    if (!Number.isFinite(dt)) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    this._clock += step;
    if (viewer) this._viewer.copy(viewer);
    if (forward) {
      const len = Math.hypot(forward.x, forward.z) || 1;
      if (!this._viewDir) this._viewDir = { x: 0, z: 1 };
      this._viewDir.x = forward.x / len;
      this._viewDir.z = forward.z / len;
    }

    // The lights run whether or not anybody is driving, but what they run ON
    // is who is waiting — so the picture is taken first, then the signals, then
    // the turn arrows, and only then does anyone move.
    // Another few windows go out every so often, once it is properly dark.
    if (this._clock >= (this._litOutAt || 0)) {
      this._litOutAt = this._clock + LIGHTS_OUT_EVERY;
      const night = 1 - clamp01(this._dayAmount);
      if (night > 0.6) {
        // A hundredth of EACH population, not a hundredth of the city. Taken
        // from the city as a whole, the towers hold a hundred times more lit
        // glass than the near blocks do, so every window that went out was a
        // tower window and the rooms you are standing next to never changed
        // again.
        for (const group of this._litPopulations()) {
          const stillLit = group.lit.reduce((k, m) => k + (m ? m.count : 0), 0);
          if (stillLit > 0) {
            this._lightsOut(Math.max(1, Math.round(stillLit * LIGHTS_OUT_SHARE)), group);
          }
        }
      } else if (night < 0.3 && this._extinguished.length) {
        // Morning. Everything that went off overnight comes back, all at once
        // because in daylight not one of them is visible either way.
        this._restoreLights(this._extinguished.length);
      }
    }

    this._collectDemand();
    this._updateSignals(step);

    if (this.cars.length) {
      this._updateTurnControl();
      // Who is part-way round a turn. They belong to no lane while they are
      // crossing, so everyone else has to be told about them explicitly.
      this._turning.length = 0;
      for (const v of this.cars) if (v.arc) this._turning.push(v);
      for (const v of this.cars) {
        // Measured around the WHOLE of driving, not inside it. _driveVehicle
        // returns early half a dozen ways — stopped at a kerb, part-way round a
        // turn, reversing into a space — and a vehicle that took one of those
        // paths never reached the suspension at all: its springs were left
        // undefined, and nothing ever leaned into a corner, because leaning
        // into a corner is exactly the case that returns early.
        const was = v.speed;
        this._driveVehicle(v, step);
        v.accelNow = step > 0 ? (v.speed - was) / step : 0;
        this._settleSuspension(v, step);
      }
      this._separateLanes();
      this._writeCarMatrices();
    }
    this._writeSignalLamps();
    this._writeTurnArrows();
    this._updatePrecipitation(step);
  }
};
