// City: weather.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import * as THREE from "three";
import {
  CROSSING_GLOW_POWER,
  LIT_BANDS,
  PRECIP_HEIGHT,
  PRECIP_RADIUS,
  WEATHER,
  WEATHER_KINDS,
} from "./constants.js";
import { clamp01 } from "./helpers.js";
import { _m, boxMatrix } from "./matrices.js";

export const weather = {

  // MARK: - Weather

  _buildPrecipitation(rnd) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcdd8e6, transparent: true, opacity: 0.5, depthWrite: false, fog: true,
    });
    const most = Math.max(...WEATHER_KINDS.map(k => WEATHER[k].drops));
    const mesh = new THREE.InstancedMesh(geo, mat, most);
    mesh.name = "city-precipitation";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    this._disposables.push(geo, mat);
    this.precipitation = mesh;

    // Offsets from the viewer, so the field travels with whoever is looking.
    this.drops = [];
    for (let i = 0; i < most; i++) {
      this.drops.push({
        ox: (rnd() - 0.5) * PRECIP_RADIUS * 2,
        oy: rnd() * PRECIP_HEIGHT,
        oz: (rnd() - 0.5) * PRECIP_RADIUS * 2,
        rate: 0.75 + rnd() * 0.5,
        phase: rnd() * Math.PI * 2,
      });
    }
  },

  /// Rain and snow fall relative to the viewer and wrap within a box around
  /// them, which is why a few thousand drops are enough to look like weather
  /// from any window in the room.
  _updatePrecipitation(dt) {
    const mesh = this.precipitation;
    if (!mesh) return;
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    if (!cfg.drops) {
      mesh.count = 0;
      return;
    }
    const snow = this._weather === "snow";
    const w = snow ? 0.075 : 0.022;
    const h = snow ? 0.075 : 0.6;
    const vx = this._viewer.x;
    const vy = this._viewer.y;
    const vz = this._viewer.z;
    for (let i = 0; i < cfg.drops; i++) {
      const d = this.drops[i];
      d.oy -= cfg.fall * d.rate * dt;
      if (cfg.sway) {
        d.phase += dt * (snow ? 1.6 : 4.2) * d.rate;
        d.ox += Math.cos(d.phase) * cfg.sway * dt;
        d.oz += Math.sin(d.phase * 0.7) * cfg.sway * dt;
      }
      // Wrap through the box around the viewer.
      if (d.oy < -PRECIP_HEIGHT * 0.35) d.oy += PRECIP_HEIGHT;
      if (d.ox > PRECIP_RADIUS) d.ox -= PRECIP_RADIUS * 2;
      else if (d.ox < -PRECIP_RADIUS) d.ox += PRECIP_RADIUS * 2;
      if (d.oz > PRECIP_RADIUS) d.oz -= PRECIP_RADIUS * 2;
      else if (d.oz < -PRECIP_RADIUS) d.oz += PRECIP_RADIUS * 2;
      mesh.setMatrixAt(i, boxMatrix(vx + d.ox, vy + d.oy, vz + d.oz, w, h, w, 0, _m));
    }
    mesh.count = cfg.drops;
    mesh.instanceMatrix.needsUpdate = true;
  },

  /// Sets the weather for the whole scene. walk3d reads `atmosphere()` back to
  /// pull the fog in and take the edge off the sun to match.
  setWeather(kind) {
    this._weather = WEATHER_KINDS.includes(kind) ? kind : "clear";
    const cfg = WEATHER[this._weather];
    if (this.precipitation) {
      const snow = this._weather === "snow";
      this.precipitation.material.color.setHex(snow ? 0xffffff : 0xcdd8e6);
      this.precipitation.material.opacity = snow ? 0.85 : 0.45;
      this.precipitation.count = 0;   // repopulated on the next frame
    }
    // Wet ground is darker ground. The materials are white and the colour
    // comes from the instances, so scaling the material colour dims the whole
    // street at once — the same trick the day/night code uses on emissives.
    const wetness = 1 - cfg.wet * 0.45;
    for (const mat of this._groundMaterials) {
      if (mat) mat.color.setScalar(wetness);
    }
    this.applyTimeOfDay(this._dayAmount);
  },

  /// What the weather is doing to the air, for walk3d's fog and sun.
  atmosphere() {
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    return { kind: this._weather, haze: cfg.haze, dim: cfg.dim, wet: cfg.wet };
  },

  /// `dayAmount` is 1 in full daylight and 0 at night: windows, street lamps,
  /// room bulbs and headlights come on as it falls. Heavy weather brings them
  /// on a little early, the way a dark afternoon does.
  applyTimeOfDay(dayAmount) {
    this._dayAmount = dayAmount;
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    const night = clamp01(1 - Math.max(0, Math.min(1, dayAmount)) + cfg.dim * 0.5);
    for (let i = 0; i < (this.litWindows || []).length; i++) {
      if (this.litWindows[i]) this.litWindows[i].material.emissiveIntensity = night * 1.7 * LIT_BANDS[i];
    }
    for (let i = 0; i < (this.roomsLit || []).length; i++) {
      if (this.roomsLit[i]) this.roomsLit[i].material.emissiveIntensity = night * 1.15 * LIT_BANDS[i];
      if (this.litBulbs[i]) this.litBulbs[i].material.emissiveIntensity = night * 3.2 * LIT_BANDS[i];
    }
    if (this.bulbs) this.bulbs.material.emissiveIntensity = night * 3.2;
    // Soft, not a light source: it reads as paint catching the street lamps.
    if (this.crossings) this.crossings.material.emissiveIntensity = night * CROSSING_GLOW_POWER;
    if (this.lampHeads) this.lampHeads.material.emissiveIntensity = night * 2.2;
    // Never fully off: these are running lamps. Bright enough to read against
    // daylight, far brighter after dark.
    if (this.headlights) this.headlights.material.emissiveIntensity = 0.6 + night * 2.2;
    if (this.carParts && this.carParts.cabin) {
      this.carParts.cabin.material.emissiveIntensity = 0.12 + night * 0.55;
    }
    if (this.carParts && this.carParts.tail) {
      this.carParts.tail.material.emissiveIntensity = 0.55 + night * 0.95;
    }
  },

  clear() {
    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables = [];
    this.group.clear();
    this.cars = [];
    this.carParts = null;
    this.vehicleMeshes = null;
    this.lanes = new Map();
    this.junctions = [];
    this.strays = 0;
    this._parkedCars = 0;
    this._parkingSoon = 0;
    this.signals = [];
    this.signalLamps = null;
    this.turnArrows = null;
    this.roadX = [];
    this.roadZ = [];
    this.drops = [];
    this._turning = [];
    this.precipitation = null;
    this.terrain = null;
    this.litWindows = null;
    this.darkWindows = null;
    this.roomsLit = null;
    this.roomsDark = null;
    this.crossings = null;
    this.litBulbs = null;
    this.litInBand = null;
    this.bulbs = null;
    this.lampHeads = null;
    this.headlights = null;
    this._groundMaterials = [];
    // What the last build accumulated, and what the next one must not inherit.
    // A phase map or a demand cell carried over would run this city's lights on
    // the last one's traffic; the turn statistics would describe a city that is
    // gone; and `damage` and the facade index belong to geometry that has just
    // been disposed — left alone, the next paintball would look for a hole in a
    // building that is no longer there.
    this.phases = null;
    this._demand = null;
    this._junctionKeys = null;
    this.turnStats = null;
    this.damage = 0;
    this.facadeSet = null;
    this.key = null;
  },

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
};
