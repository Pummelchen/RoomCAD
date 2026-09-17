// walk3d.js — the first-person 3D walkthrough: Three.js WebGPU, Rapier physics,
// the sun and sky, the city's street lamps, and the paintball gun.
//
// The class is declared here with its constructor, and its methods are applied
// from roomcad/web/walk3d/. They live on the prototype, so `this` is the viewer
// and every method reaches every other one exactly as it did inside one class
// body — which is why no group imports another. The constants are in
// walk3d/constants.js and the two module-level helpers have their own modules.
//
// A prototype split is what makes this possible: JavaScript cannot spread a class
// declaration over several files. It is behaviour-preserving here because nothing
// in this class is private — no `#field`, no `super`, no static member.

import * as THREE from "three";
import * as RAPIER from "./lib/rapier.mjs";
import * as P from "./plan.js";
import { City } from "./city.js";
import { store } from "./store.js";
import { wallRunBox } from "./walk3d/wall-box.js";

// The one module-level helper this file exported before the split, re-exported so
// callers and tests keep importing it from walk3d.js.
export { wallRunBox };
import {
  AXIS_EPS,
  BACKGROUND,
  BULB_COLOR,
  CEILING_COLOR,
  CITY_HEADROOM,
  CITY_LIGHT_POOL,
  CITY_LIGHT_REACH,
  CITY_SHADOW_LIGHTS,
  CITY_SHADOW_MAP,
  CITY_SHADOW_NORMAL_BIAS,
  CLOSED_DOOR_SEAL,
  CROUCH_HALF_HEIGHT,
  DAY_BACKGROUND,
  DAY_FOG,
  FLOOR_HEIGHT,
  FOG_FAR,
  FOG_NEAR,
  GLASS_COLOR,
  GRAVITY,
  JUMP_SPEED,
  LEAF_COLOR,
  LIGHT_METAL,
  MAX_BACKLOG,
  MAX_ROOM_LIGHTS,
  MAX_SUBSTEPS,
  NIGHT_BACKGROUND,
  NIGHT_FOG,
  OVERCAST_SKY,
  PARKED_FAR_BELOW,
  PHYSICS_STEP,
  PLAYER_FRICTION,
  PLAYER_MASS,
  PLAYER_RADIUS,
  POINT_SHADOW_BIAS,
  POINT_SHADOW_MAP_SIZE,
  ROOM_ONLY_LAYER,
  RUBBLE_COLOR,
  SG_LAT,
  SG_LON,
  SG_UTC_OFFSET,
  SKY_DOME_MAX,
  STAND_HALF_HEIGHT,
  SUN_HEIGHT,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_MAP,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_REACH,
  SUN_SHADOW_TEXEL,
  TWILIGHT_BACKGROUND,
  VEHICLE_BODY_POOL,
  VEHICLE_FRICTION,
  VEHICLE_SOLID_RANGE,
  WALK_SPEED,
  WALL_COLOR,
  WALL_VERTICAL_SEAL,
  _carrierMatrix,
  _carrierNormal,
  _carrierPoint,
  _gunOffset,
  _viewForward,
} from "./walk3d/constants.js";
import { scene_building } from "./walk3d/scene-building.js";
import { scene_building_2 } from "./walk3d/scene-building-2.js";
import { scene_building_3 } from "./walk3d/scene-building-3.js";
import { environment_builders } from "./walk3d/environment-builders.js";
import { rapier_physics } from "./walk3d/rapier-physics.js";
import { rapier_physics_2 } from "./walk3d/rapier-physics-2.js";
import { paintball } from "./walk3d/paintball.js";
import { loop } from "./walk3d/loop.js";

export class Walk3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
    // Cap the pixel ratio so Retina displays stay sharp without rendering the
    // full 2x everywhere (the biggest single FPS lever on an M-series Mac).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);

    this.yaw = 0;
    this.pitch = 0;
    this.position = new THREE.Vector3(3, 1.5, 3);
    this.keys = new Set();
    this.clock = new THREE.Clock();
    this.lastRoomKey = null;
    this.locked = false;
    this.raf = 0;
    // The frame chain, as three separate things. `running` is whether frames
    // are wanted at all (pause()/resume()), `ready` is whether start() has
    // finished enough for a frame to mean anything, and `raf` is the one
    // pending callback. Keeping them apart is what lets pause() and resume()
    // be idempotent: the chain begins only where all three agree, never twice.
    // It starts wanted, because start() has always begun the loop itself as
    // soon as the renderer was up.
    this.running = true;
    this.ready = false;

    // Crouch and jump (Rapier drives the actual body once it's ready).
    this.crouching = false;
    this.jumpCount = 0;
    // Windows shot out, as spans along their wall. Openings, not decorations.
    this.brokenGlass = [];
    this.feetY = 0;
    this.onGround = true;

    // Rapier physics state.
    this.physicsReady = false;
    this.world = null;
    this.playerBody = null;
    this.playerCollider = null;
    this.physicsBodies = [];

    // Reusable scene resources (never disposed between rebuilds).
    this.glassMaterial = this.makeGlassMaterial();
    this.skyTexture = this.makeSkyTexture();
    this.cloudTexture = this.makeCloudTexture();
    this.cloudLayers = [];
    this.reusableTextures = new Set([this.skyTexture, this.cloudTexture]);
    this.pointLights = [];
    this.fixtureEmissives = []; // { mat, on } for the L lighting toggle
    this.roomLightSlots = [];   // where a fixture is, for the light pool
    this.roomLightsAssigned = -1;
    this.skyMesh = null;
    this.hemisphere = null;
    this.fill = null;
    this.environment = null;

    // Lighting mode: true = uniform daylight (placed lights ignored),
    // false = placed lights only (L toggles).
    this.lightsOn = true;

    // FPS counter state.
    this.fpsFrames = 0;
    this.fpsLastSample = performance.now();
    this.fpsEl = document.getElementById("fps-counter");
    this.lastSunUpdate = 0;

    // The hour of day is a user setting (store.timeOfDay, default 15:00 SGT);
    // the sun and sky follow it.
    this.sun = null;
    this.sunTarget = null;

    // Paintball easter egg
    this.paintballMode = false;
    this.paintballs = [];
    this.shards = [];
    this.splats = [];
    this.raycaster = new THREE.Raycaster();
    this.gun = null;
    this.gunRecoil = 0;

    // The surrounding city. It lives directly in the scene (never in
    // roomGroup, which lifts with the floor) and survives room rebuilds.
    this.city = new City();

    this.roomGroup = null;   // all room meshes; lifted together per floor
    this.lastFloorY = null;  // last applied floor lift, so we only rebuild physics on change

    this.attachInput();
    this.observeSize();
    this.start();

    store.onChange(() => {
      if (store.mode !== "3d" && this.paintballMode) {
        this.paintballMode = false;
        this.clearPaintball();
        this.updatePaintballUI();
      }
      // Lift the whole room (visual + physics) between floors.
      const baseY = this.floorY();
      if (this.roomGroup && baseY !== this.lastFloorY) {
        this.lastFloorY = baseY;
        this.roomGroup.position.y = baseY;
        if (this.skyMesh) this.skyMesh.position.y = baseY;
        for (const layer of this.cloudLayers || []) {
          layer.mesh.position.y = baseY + layer.mesh.userData.altitude;
        }
        this.syncCity(store.room);
        // Changing floor is a different city — it gets its own tower and its
        // own lift — and a rebuilt city comes up at its own defaults. Whoever
        // asked for the lift has already run applyTimeOfDay() against the city
        // that is now gone, so re-run it here; its guard sees a new city key
        // and does the whole job.
        this.applyTimeOfDay();
        if (this.physicsReady) this.buildPhysics(store.room, false);
      }
    });
  }
}

Object.assign(
  Walk3D.prototype,
  scene_building,
  scene_building_2,
  scene_building_3,
  environment_builders,
  rapier_physics,
  rapier_physics_2,
  paintball,
  loop,
);
