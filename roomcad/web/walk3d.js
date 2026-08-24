// walk3d.js — first-person 3D walkthrough for RoomCAD web (Three.js).

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as RAPIER from "./lib/rapier.mjs";
import * as P from "./plan.js";
import { store } from "./store.js";
import { City, seedFromString } from "./city.js";
import { playPlop } from "./audio.js";

// WebGPU post-processing (TSL nodes).
import { pass, mrt, output, emissive, normalView } from "three/tsl";
import { ssao } from "three/addons/tsl/display/SSAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

// Material palette: light blue-gray walls, white ceiling, glass, and a white
// marble floor (procedural, below).
const WALL_COLOR = 0x6e88a0;
const CEILING_COLOR = 0xd9d9d5;
const GLASS_COLOR = 0x9fc8e0;
const RUBBLE_COLOR = 0xb9b2a6;   // knocked-out wall, on its way to the pavement
const LEAF_COLOR = 0x9a6f45;
const BACKGROUND = 0x141c2c;
const BULB_COLOR = 0xfff2cf;
const LIGHT_METAL = 0x33363c;
const DAY_BACKGROUND = 0x8fb8e0;
const DAY_FOG = 0xcfe0f0;
const TWILIGHT_BACKGROUND = 0x6a4a5a; // warm purple-pink dusk sky
const OVERCAST_SKY = 0x9aa3ad;        // flat grey the sky washes towards in weather
const NIGHT_BACKGROUND = 0x0a0e1a;
const NIGHT_FOG = 0x0a0e1a;
// Fog range. This used to end at 130 m, which is inside the city — the outer
// blocks dissolved into flat colour and the world simply stopped. It now
// reaches past the hills the city builds behind itself, so distance reads as
// haze over a horizon instead of as a wall. It stays inside the camera's far
// plane, so the corners of the terrain square are fully fogged before they
// clip. Weather pulls the far edge in; rain closes the view down to a couple
// of streets.
const FOG_NEAR = 45;
const FOG_FAR = 380;

// Player capsule dimensions (metres).
const PLAYER_RADIUS = 0.20;
const STAND_HALF_HEIGHT = 0.55; // total standing height 1.5 m
const CROUCH_HALF_HEIGHT = 0.25; // total crouch height 0.9 m
const WALK_SPEED = 2.5;
const GRAVITY = 11;
// The physics runs on a fixed step so it keeps real time whatever the frame
// rate. MAX_SUBSTEPS is how far one frame may catch up — at six a frame the
// world keeps pace down to ten frames a second, and below that it slows down
// rather than spiralling into a catch-up loop it can never win.
const PHYSICS_STEP = 1 / 60;
const MAX_SUBSTEPS = 6;
const MAX_BACKLOG = 0.25;
// How far above the taller of the room and the street counts as still being in
// the world. Enough to clear the tallest building the city puts up, so standing
// on a roof is not mistaken for having fallen out of the simulation.
const CITY_HEADROOM = 40;
const JUMP_SPEED = 3.8;
const MAX_POINT_LIGHTS = 16;
// The street's own lights. The pool is what the renderer pays for every frame,
// whether or not it is full; the reach is how far away a lamp is still worth
// considering for it.
const CITY_LIGHT_POOL = 12;
const CITY_LIGHT_REACH = 55;
// Sunlight shadows. The volume follows the viewer rather than sitting over the
// room, so the resolution goes where it can be seen: 140 m across a 4096 map is
// about 3 cm a texel, which holds up on a kerb.
const SUN_SHADOW_REACH = 70;
const SUN_SHADOW_MAP = 4096;
const SUN_HEIGHT = 120;
// How many of the street lights throw a shadow, and how big a map each gets.
const CITY_SHADOW_LIGHTS = 2;
const CITY_SHADOW_MAP = 512;
// A layer that only the room's own geometry is on.
//
// A point light shadows its surroundings by rendering the scene six times, once
// per face of a cube. There are up to sixteen of them in a room, so ninety-six
// renders a frame — and once the city started casting shadows, every one of
// those ninety-six drew the whole city: 31 MILLION triangles a frame, for
// lights with a range of fourteen metres that are standing indoors. Their
// shadow cameras are pointed at this layer, which the city is not on.
const ROOM_ONLY_LAYER = 1;
const FLOOR_HEIGHT = 3; // metres per building floor

// Room construction uses closed, overlapping solids. The values below are
// deliberate physical construction tolerances (centimetres), not a shadow-map
// trick: walls bite into the slab and ceiling, and wall ends cross their
// neighbours at a join (P.WALL_JOIN_SEAL). That leaves no route for either
// light or the player capsule through a join.
const WALL_VERTICAL_SEAL = 0.04;
const CLOSED_DOOR_SEAL = 0.02;
const POINT_SHADOW_MAP_SIZE = 1024;

// Shadow depth bias must stay at zero. Three.js renders shadow maps from back
// faces (material.shadowSide defaults to BackSide), so the depth recorded for
// a caster is its *far* surface — a whole wall thickness of natural margin
// against acne. A negative bias on top of that is pure light leak: the point
// shadow compares in a non-linear perspective buffer, so a constant -0.0015
// let light through occluders up to 27 cm away at 3 m and 1.9 m away at 8 m,
// which at grazing incidence painted the metre-wide bright bands along every
// floor, ceiling and wall join. Fixing that is what closed the leak; do not
// reintroduce a bias to chase acne.
const POINT_SHADOW_BIAS = 0;
const SUN_SHADOW_BIAS = 0;
// Sunlight uses one orthographic map, so it keeps a little normal offset
// against grazing acne — small enough never to read as a gap.
//
// Derived from how big a shadow texel actually is on the ground rather than
// written down. The offset only has to cover the depth error across one texel,
// so it scales with the texel: the old 2 mm was tuned against a map that
// covered the room and nothing else, and a volume that covers the street has
// texels three times the size. Left at 2 mm it would have brought back the
// grazing acne it was put there to stop.
const SUN_SHADOW_TEXEL = (SUN_SHADOW_REACH * 2) / SUN_SHADOW_MAP;
const SUN_SHADOW_NORMAL_BIAS = SUN_SHADOW_TEXEL * 0.18;

// Scratch vector for the viewmodel, which is positioned every frame.
const _gunOffset = new THREE.Vector3();
const _viewForward = new THREE.Vector3();
// Scratch for putting paint back onto a moving vehicle. Reused because it runs
// once per carried splat per frame.
const _carrierMatrix = new THREE.Matrix4();
const _carrierNormal = new THREE.Vector3();
const _carrierPoint = new THREE.Vector3();

// Singapore solar position. In the 2D editor the top of the plan is North (0°),
// so azimuth is measured clockwise from North: 0=N, 90=E, 180=S, 270=W.
const SG_LAT = 1.3521;
const SG_LON = 103.8198;
const SG_UTC_OFFSET = 8; // Singapore is UTC+8

function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date - start) / 86400000);
}

/// Sun altitude + azimuth (radians) for Singapore at a given UTC Date.
function sunAltitudeAzimuth(date) {
  const N = dayOfYear(date);
  const declDeg = -23.44 * Math.cos((2 * Math.PI / 365) * (N + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTime = utcHours + SG_LON / 15;
  const hourAngleDeg = (solarTime - 12) * 15;
  const lat = SG_LAT * Math.PI / 180;
  const dec = declDeg * Math.PI / 180;
  const h = hourAngleDeg * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(dec) - Math.sin(lat) * Math.sin(altitude)) / (Math.cos(lat) * Math.cos(altitude));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (h > 0) azimuth = 2 * Math.PI - azimuth; // afternoon → west
  return { altitude, azimuth };
}

/// Solar position for a Singapore clock hour (24 h, fractional allowed).
function sunForHour(hour) {
  const utc = hour - SG_UTC_OFFSET;
  const date = new Date();
  const wrapped = ((utc % 24) + 24) % 24;
  date.setUTCDate(date.getUTCDate() + Math.floor(utc / 24));
  date.setUTCHours(Math.floor(wrapped), Math.floor((wrapped % 1) * 60), 0, 0);
  return sunAltitudeAzimuth(date);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep01(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

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
        if (this.physicsReady) this.buildPhysics(store.room, false);
      }
    });
  }

  /// The room's lift above the ground floor (one floor = FLOOR_HEIGHT m).
  floorY() {
    return (store.floor - 1) * FLOOR_HEIGHT;
  }

  /// Bounds of the actual constructed building, distinct from the larger 2D
  /// editing canvas. Existing projects start with their declared room bounds;
  /// any wall drawn beyond them expands the envelope automatically.
  buildingBounds(room) {
    const origin = P.roomOrigin(room);
    let minX = origin.x;
    let maxX = origin.x + room.width;
    let minZ = origin.z;
    let maxZ = origin.z + room.length;
    for (const wall of room.walls) {
      minX = Math.min(minX, wall.start.x, wall.end.x);
      maxX = Math.max(maxX, wall.start.x, wall.end.x);
      minZ = Math.min(minZ, wall.start.z, wall.end.z);
      maxZ = Math.max(maxZ, wall.start.z, wall.end.z);
    }
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      width: Math.max(0.1, maxX - minX),
      length: Math.max(0.1, maxZ - minZ),
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
    };
  }

  /// WebGPU + Rapier are async; build the scene and start once both are ready.
  async start() {
    try {
      if (!navigator.gpu) {
        this.show3dError("WebGPU is not supported in this browser — use a recent Chrome, Edge, or Safari 18+.");
        return;
      }
      await Promise.race([
        this.renderer.init(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("WebGPU init timed out")), 20000)),
      ]);
      await RAPIER.init();
      this.physicsReady = true;

      // Image-based lighting (needs an initialised renderer).
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();

      this.build(store.room, true);
      this.setupPostProcessing();
      this.loop();
    } catch (err) {
      console.error("RoomCAD 3D init failed:", err);
      this.show3dError("3D failed to start: " + (err && err.message ? err.message : err));
    }
  }

  /// Shows a visible error in the 3D top-left readout (reused for the FPS).
  show3dError(message) {
    if (this.fpsEl) {
      this.fpsEl.textContent = message;
      this.fpsEl.style.color = "#ff6b5e";
      this.fpsEl.style.background = "rgba(40, 12, 10, 0.88)";
      this.fpsEl.style.maxWidth = "92%";
      this.fpsEl.style.whiteSpace = "normal";
      this.fpsEl.style.pointerEvents = "auto";
    }
  }

  // MARK: Scene building

  build(room, resetCamera = false) {
    if (resetCamera) {
      const origin = P.roomOrigin(room);
      this.position.set(origin.x + room.width / 2, 1.5, origin.z + Math.max(0.5, room.length - 0.6));
      this.yaw = 0;
      this.pitch = 0;
      this.crouching = false;
      this.onGround = true;
      this.feetY = 0;
      this.jumpCount = 0;
    }
    this.disposeScene();
    this.paintballs = [];
    this.shards = [];
    this.splats = [];
    if (this.paintballMode) {
      this.paintballMode = false;
      this.updatePaintballUI();
    }
    const scene = this.scene;
    const canvas = P.canvasOf(room);
    const building = this.buildingBounds(room);
    this.currentBuildingBounds = building;

    // Sky and atmospheric depth (switches to night when placed-lights mode).
    scene.background = new THREE.Color(this.lightsOn ? DAY_BACKGROUND : NIGHT_BACKGROUND);
    scene.fog = new THREE.Fog(this.lightsOn ? DAY_FOG : NIGHT_FOG, FOG_NEAR, FOG_FAR);
    this.buildSky(room);

    // Daylight: a bright warm sun, soft sky bounce, image-based lighting for
    // realistic reflections, and real shadow mapping.
    this.hemisphere = new THREE.HemisphereLight(0xcfe0ff, 0x8a887e, 0.55);
    scene.add(this.hemisphere);

    const sun = new THREE.DirectionalLight(0xfff2d9, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SUN_SHADOW_MAP, SUN_SHADOW_MAP);
    sun.shadow.camera.near = 1;
    // Reaches from well above the tallest building down past the street. The
    // volume no longer sits over the room — it follows the viewer, so what is
    // in shadow is whatever is near enough to see it.
    sun.shadow.camera.far = SUN_HEIGHT * 2 + SUN_SHADOW_REACH * 2;
    sun.shadow.camera.left = -SUN_SHADOW_REACH;
    sun.shadow.camera.right = SUN_SHADOW_REACH;
    sun.shadow.camera.top = SUN_SHADOW_REACH;
    sun.shadow.camera.bottom = -SUN_SHADOW_REACH;
    sun.shadow.bias = SUN_SHADOW_BIAS;
    // Keep the sunlight shadow receiver essentially on the surface. A large
    // normal bias makes daylight visibly detach from wall, floor and ceiling
    // edges, which reads as light leaking through a closed room.
    sun.shadow.normalBias = SUN_SHADOW_NORMAL_BIAS;
    const sunTarget = new THREE.Object3D();
    sunTarget.position.set(building.centerX, 0, building.centerZ);
    scene.add(sunTarget);
    sun.target = sunTarget;
    scene.add(sun);
    this.sun = sun;
    this.sunTarget = sunTarget;

    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
    this.fill.position.set(-3, 4, canvas.length + 2);
    scene.add(this.fill);

    this.buildCityLightPool(scene);

    // Image-based lighting for PBR reflections.
    scene.environment = this.lightsOn ? this.environment : null;

    // All room content lives in one group so the floor lift only translates it.
    this.roomGroup = new THREE.Group();
    scene.add(this.roomGroup);

    // The editor canvas is deliberately larger than the building so users can
    // draw new rooms. It must not become visible concrete outside a window:
    // only the actual wall envelope receives a floor and roof.
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0, envMapIntensity: 0 });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(building.width, 0.06, building.length),
      this.floorMaterial
    );
    floor.position.set(building.centerX, -0.03, building.centerZ);
    floor.receiveShadow = true;
    this.roomGroup.add(floor);
    this.loadFloorTexture(building);

    // Roof follows the same real envelope, never the larger editable canvas.
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(building.width, 0.05, building.length),
      new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95 })
    );
    ceiling.position.set(building.centerX, room.height, building.centerZ);
    ceiling.receiveShadow = true;
    this.roomGroup.add(ceiling);

    // Walls are single sealed solids with real cut-outs. The panes are built
    // fresh here, so whatever was shot out before belongs to glass that no
    // longer exists — the openings go with it.
    this.brokenGlass = [];
    for (const wall of room.walls) {
      this.addWallPlan(room, wall, room.doors, room.windows, room.height);
    }

    // Furniture and ceiling fixtures.
    this.pointLights = [];
    this.fixtureEmissives = [];
    let lightCount = 0;
    for (const item of room.furniture) {
      const kind = P.FURNITURE_KINDS[item.kind];
      if (kind.category === "fixture") {
        this.addLightFixture(item, room.height, lightCount < MAX_POINT_LIGHTS);
        lightCount++;
      } else {
        this.addFurniture(item);
      }
    }

    // Everything the room is made of goes on the room-only layer as well as
    // the default one, so the point lights' shadow cameras can be pointed at
    // it and see the room without seeing the city.
    this.roomGroup.traverse(node => node.layers.enable(ROOM_ONLY_LAYER));

    this.buildGun();
    this.syncCity(room);
    this.roomGroup.position.y = this.floorY();
    this.lastFloorY = this.floorY();
    this.applyTimeOfDay();

    // Refresh the physics colliders for the new room layout.
    if (this.physicsReady) this.buildPhysics(room, resetCamera);
  }

  /// A high-detail "pro" paintball marker built from primitives, attached to
  /// the camera like a viewmodel. The bullet container is a tube (capsule)
  /// with two rounded ends.
  buildGun() {
    const group = new THREE.Group();
    const mat = (color, metalness = 0.55, roughness = 0.35) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });

    const graphite = mat(0x2b2d31);
    const graphiteLight = mat(0x41444b);
    const black = mat(0x16171a, 0.5, 0.5);
    const cyan = mat(0x31c8e0, 0.25, 0.26);
    const cyanDark = mat(0x1d9db3, 0.4, 0.3);
    const green = mat(0x2ecc40, 0.2, 0.35);
    const steel = mat(0x8a8d94, 0.9, 0.22);

    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
    };
    const cyl = (rTop, rBottom, height, radial) =>
      new THREE.CylinderGeometry(rTop, rBottom, height, radial);

    // ── Barrel assembly ──
    // Polished steel barrel
    add(cyl(0.016, 0.016, 0.42, 28), steel, 0, 0.02, -0.52, Math.PI / 2, 0, 0);
    // Graphite barrel shroud (thicker rear section)
    add(cyl(0.025, 0.025, 0.14, 24), graphite, 0, 0.02, -0.38, Math.PI / 2, 0, 0);
    // Ported muzzle brake
    add(cyl(0.027, 0.027, 0.09, 24), graphite, 0, 0.02, -0.74, Math.PI / 2, 0, 0);
    // Green muzzle ring
    add(cyl(0.028, 0.028, 0.02, 24), green, 0, 0.02, -0.79, Math.PI / 2, 0, 0);

    // ── Receiver ──
    add(new THREE.BoxGeometry(0.05, 0.07, 0.36), graphite, 0, -0.02, -0.26);
    // Picatinny rail with notches
    add(new THREE.BoxGeometry(0.042, 0.03, 0.36), graphiteLight, 0, 0.035, -0.26);
    for (let i = 0; i < 6; i++) {
      add(new THREE.BoxGeometry(0.044, 0.01, 0.02), black, 0, 0.052, -0.38 + i * 0.05);
    }

    // ── Bullet container: a tube with two round endings ──
    // Capsule (cylinder + hemispherical ends), mounted along the barrel.
    add(new THREE.CapsuleGeometry(0.042, 0.22, 8, 24), cyan, 0, 0.115, -0.18, Math.PI / 2, 0, 0);
    // Green bands where each round end meets the tube
    add(cyl(0.044, 0.044, 0.024, 24), green, 0, 0.115, -0.07, Math.PI / 2, 0, 0);
    add(cyl(0.044, 0.044, 0.024, 24), green, 0, 0.115, -0.29, Math.PI / 2, 0, 0);
    // Feed neck connecting the tube to the receiver
    add(cyl(0.022, 0.022, 0.06, 16), cyanDark, 0, 0.06, -0.18, 0, 0, 0);

    // ── Grip, trigger, and guard ──
    add(new THREE.BoxGeometry(0.042, 0.16, 0.055), graphite, 0, -0.15, -0.12, 0.42, 0, 0);
    add(new THREE.BoxGeometry(0.044, 0.10, 0.058), cyanDark, 0, -0.145, -0.118, 0.42, 0, 0);
    add(new THREE.TorusGeometry(0.048, 0.008, 8, 24), graphite, 0, -0.105, -0.24);
    add(new THREE.BoxGeometry(0.012, 0.05, 0.014), steel, 0, -0.09, -0.25);

    // ── Rear air tank (bottle) with a rounded cap ──
    add(cyl(0.034, 0.034, 0.16, 24), graphite, 0, -0.05, 0.12, Math.PI / 2, 0, 0);
    add(new THREE.SphereGeometry(0.034, 20, 16), graphite, 0, -0.05, 0.205);

    // ── Foregrip under the barrel ──
    add(new THREE.BoxGeometry(0.03, 0.11, 0.05), graphite, 0, -0.10, -0.55, 0.28, 0, 0);

    // ── Red-dot sight on the rail ──
    add(new THREE.BoxGeometry(0.022, 0.024, 0.05), black, 0, 0.07, -0.06);
    add(cyl(0.008, 0.008, 0.02, 16), cyan, 0, 0.075, -0.035, Math.PI / 2, 0, 0);

    group.visible = false;
    group.traverse(node => { node.userData.gun = true; });
    this.scene.add(group);
    this.gun = group;
  }

  addWallPlan(room, wall, doors, windows, height) {
    const plan = P.wallBuildPlan(wall, doors, windows, height);
    const sill = Math.min(P.SILL_HEIGHT, height);
    const glassTop = Math.min(sill + P.GLASS_HEIGHT, height);
    const doorTop = Math.min(P.DOOR_HEIGHT, height);
    this.addSealedWall(wall, plan, sill, glassTop, doorTop, height, P.wallEndSeals(room, wall));
    for (const span of plan.glassSpans) {
      this.addGlass(wall, span, sill, glassTop, P.WALL_THICKNESS * 0.55);
    }
    for (const door of doors.filter(d => d.wallID === wall.id)) {
      this.addDoorLeaf(wall, door, doorTop);
    }
  }

  /// Builds one watertight wall volume with actual door/window cut-outs.
  /// Previous versions assembled a plain wall from three stacked boxes. Even
  /// though the boxes overlapped, point-light cube maps could still rasterize
  /// their shared faces as separate shadow edges. A single extruded solid has
  /// no internal faces, so snapped rooms stay dark outside their openings.
  addSealedWall(wall, plan, sill, glassTop, doorTop, height, seals) {
    const length = P.wallLength(wall);
    if (length <= 0.001) return;
    const bottom = -WALL_VERTICAL_SEAL;
    const top = height + WALL_VERTICAL_SEAL;
    // Each end reaches across its neighbour only where it actually joins one,
    // so corners and T-junctions close while free-standing ends keep the
    // length the user drew.
    const back = -seals.start;
    const front = length + seals.end;
    const shape = new THREE.Shape();
    shape.moveTo(back, bottom);
    shape.lineTo(front, bottom);
    shape.lineTo(front, top);
    shape.lineTo(back, top);
    shape.closePath();

    const addOpening = (span, y0, y1) => {
      const from = Math.max(0, span.from);
      const to = Math.min(length, span.to);
      if (to - from <= 0.001 || y1 - y0 <= 0.001) return;
      // Reverse winding marks this rectangle as a hole in the solid wall.
      const hole = new THREE.Path();
      hole.moveTo(from, y0);
      hole.lineTo(from, y1);
      hole.lineTo(to, y1);
      hole.lineTo(to, y0);
      hole.closePath();
      shape.holes.push(hole);
    };

    // Doors go to the floor; windows are only cut from sill to lintel.
    for (const span of plan.doorSpans) addOpening(span, bottom, doorTop);
    for (const span of plan.windowSpans) addOpening(span, sill, glassTop);

    const depth = P.WALL_THICKNESS;
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: false,
    });
    // Centre the thickness on the snapped wall centreline.
    geometry.translate(-length / 2, 0, -depth / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.85 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const center = P.wallPointAt(wall, length / 2);
    mesh.position.set(center.x, 0, center.z);
    const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
    mesh.rotation.y = -angle;
    this.roomGroup.add(mesh);
  }

  /// The door leaf: closed (flush in the wall) or open (swung 90° to the
  /// inside or outside of the wall).
  addDoorLeaf(wall, door, doorTop) {
    // An open leaf stays a realistic 4 cm slab. A closed leaf has to fill the
    // whole wall depth (and overlap it slightly), otherwise the point shadow
    // can travel through the unused depth on either side of the thin leaf.
    const closed = door.open === false;
    const thickness = closed ? P.WALL_THICKNESS + CLOSED_DOOR_SEAL * 2 : 0.04;
    const leafHeight = closed ? doorTop + CLOSED_DOOR_SEAL * 2 : doorTop;
    const width = door.width;
    const hinge = P.wallPointAt(wall, door.offset);
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const len = Math.max(Math.hypot(dx, dz), 0.0001);
    const ux = dx / len;
    const uz = dz / len;

    let leafX;
    let leafZ;
    let centerX;
    let centerZ;
    if (door.open) {
      const sign = door.swingInside ? 1 : -1;
      leafX = sign * -uz;
      leafZ = sign * ux;
      centerX = hinge.x + leafX * (width / 2);
      centerZ = hinge.z + leafZ * (width / 2);
    } else {
      leafX = ux;
      leafZ = uz;
      const center = P.wallPointAt(wall, door.offset + width / 2);
      centerX = center.x;
      centerZ = center.z;
    }

    const geometry = new THREE.BoxGeometry(thickness, leafHeight, width);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: LEAF_COLOR, roughness: 0.7 }));
    mesh.userData.doorID = door.id;
    mesh.castShadow = true;
    mesh.position.set(centerX, doorTop / 2, centerZ);
    mesh.rotation.y = Math.atan2(leafX, leafZ);
    this.roomGroup.add(mesh);
  }

  /// A transparent window pane. It doesn't cast a shadow so daylight passes
  /// through without an artificial exterior surface behind it.
  addGlass(wall, span, h0, h1, thickness) {
    const h = h1 - h0;
    if (h <= 0.001 || span.to - span.from <= 0.001) return;
    const geometry = new THREE.BoxGeometry(thickness, h, span.to - span.from);
    const mesh = new THREE.Mesh(geometry, this.glassMaterial);
    // Marked so a paintball can tell glass from wall and break it — and which
    // opening it is, so breaking it can be turned into a hole you climb through
    // rather than only a hole you can see.
    mesh.userData.glass = true;
    mesh.userData.wallID = wall.id;
    mesh.userData.spanFrom = span.from;
    mesh.userData.spanTo = span.to;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const center = P.wallPointAt(wall, (span.from + span.to) / 2);
    mesh.position.set(center.x, (h0 + h1) / 2, center.z);
    const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
    mesh.rotation.y = Math.PI / 2 - angle;
    this.roomGroup.add(mesh);
  }

  /// Realistic furniture built from detailed primitives in the item's local
  /// frame (natural width along X, length along Z, front toward -Z), then
  /// rotated into place.
  addFurniture(item) {
    const kind = P.FURNITURE_KINDS[item.kind];
    const W = kind.w;
    const D = kind.d;
    const H = kind.h;
    const group = new THREE.Group();

    const M = {
      wood: new THREE.MeshStandardMaterial({ color: 0x9c6b3f, metalness: 0.06, roughness: 0.6 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x7a4f2a, metalness: 0.06, roughness: 0.65 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x5a5a60, metalness: 0.85, roughness: 0.3 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, metalness: 0, roughness: 0.95 }),
      blanket: new THREE.MeshStandardMaterial({ color: 0x3f8fa8, metalness: 0, roughness: 0.9 }),
      cushion: new THREE.MeshStandardMaterial({ color: 0xb0523f, metalness: 0, roughness: 0.9 }),
    };
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
    };
    const legs = (lx, lz, height, radius) => {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          add(new THREE.CylinderGeometry(radius, radius, height, 12), M.metal, sx * lx, height / 2, sz * lz);
        }
      }
    };

    switch (item.kind) {
      case "bed": {
        // Frame
        add(new THREE.BoxGeometry(W, 0.28, D), M.woodDark, 0, 0.14, 0);
        // Mattress
        add(new THREE.BoxGeometry(W - 0.04, 0.16, D - 0.04), M.fabric, 0, 0.36, 0);
        // Headboard (front / head end)
        add(new THREE.BoxGeometry(W, 0.55, 0.06), M.wood, 0, 0.555, -D / 2 + 0.03);
        // Pillows
        add(new THREE.BoxGeometry(0.34, 0.09, 0.42), M.fabric, -0.20, 0.485, -D / 2 + 0.25);
        add(new THREE.BoxGeometry(0.34, 0.09, 0.42), M.fabric, 0.20, 0.485, -D / 2 + 0.25);
        // Blanket (toward the foot)
        add(new THREE.BoxGeometry(W - 0.06, 0.05, D * 0.60), M.blanket, 0, 0.465, D * 0.20);
        // Legs
        legs(W / 2 - 0.06, D / 2 - 0.06, 0.12, 0.02);
        break;
      }
      case "table": {
        add(new THREE.BoxGeometry(W, 0.05, D), M.wood, 0, H - 0.025, 0);
        add(new THREE.BoxGeometry(W - 0.10, 0.08, D - 0.10), M.woodDark, 0, H - 0.09, 0);
        const legHeight = H - 0.09;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            add(new THREE.BoxGeometry(0.05, legHeight, 0.05), M.woodDark, sx * (W / 2 - 0.05), legHeight / 2, sz * (D / 2 - 0.05));
          }
        }
        break;
      }
      case "chair": {
        // Seat cushion
        add(new THREE.BoxGeometry(W - 0.05, 0.08, D - 0.05), M.cushion, 0, 0.46, 0);
        // Backrest (back = +Z)
        add(new THREE.BoxGeometry(W - 0.05, 0.42, 0.05), M.cushion, 0, 0.62, D / 2 - 0.05);
        // Legs
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            add(new THREE.BoxGeometry(0.035, 0.45, 0.035), M.woodDark, sx * (W / 2 - 0.05), 0.225, sz * (D / 2 - 0.05));
          }
        }
        break;
      }
      case "wardrobe": {
        const doorW = W / 2 - 0.05;
        const doorH = H - 0.30;
        const doorY = 0.15 + doorH / 2;
        // Body
        add(new THREE.BoxGeometry(W - 0.02, H - 0.16, D - 0.02), M.wood, 0, 0.12 + (H - 0.16) / 2, 0);
        // Plinth
        add(new THREE.BoxGeometry(W - 0.04, 0.10, D - 0.04), M.woodDark, 0, 0.05, 0);
        // Top cornice
        add(new THREE.BoxGeometry(W, 0.04, D), M.woodDark, 0, H - 0.02, 0);
        // Two doors, each with a raised ornamental panel and a round knob.
        for (const sx of [-1, 1]) {
          const doorX = sx * W / 4;
          // Door (offset forward so it never z-fights the body).
          add(new THREE.BoxGeometry(doorW, doorH, 0.02), M.woodDark, doorX, doorY, -D / 2 + 0.03);
          // Ornamental raised panel in lighter wood.
          add(new THREE.BoxGeometry(doorW - 0.10, doorH - 0.16, 0.012), M.wood, doorX, doorY, -D / 2 + 0.044);
          // Round knob near the inner edge of each door.
          add(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 14), M.metal, sx * 0.055, H * 0.52, -D / 2 + 0.058, Math.PI / 2, 0, 0);
        }
        break;
      }
      case "desk": {
        add(new THREE.BoxGeometry(W, 0.04, D), M.wood, 0, H - 0.02, 0);
        for (const sx of [-1, 1]) {
          add(new THREE.BoxGeometry(0.06, H - 0.05, 0.06), M.woodDark, sx * (W / 2 - 0.05), (H - 0.05) / 2, 0);
        }
        // Monitor on a small stand toward the back (+Z).
        add(new THREE.BoxGeometry(0.06, 0.12, 0.16), M.metal, 0, H + 0.06, D / 2 - 0.1);
        add(new THREE.BoxGeometry(W * 0.45, 0.3, 0.04), M.metal, 0, H + 0.26, D / 2 - 0.14);
        break;
      }
      case "sofa": {
        add(new THREE.BoxGeometry(W, 0.28, D), M.fabric, 0, 0.2, 0);
        add(new THREE.BoxGeometry(W - 0.12, 0.16, D - 0.16), M.cushion, 0, 0.42, 0);
        add(new THREE.BoxGeometry(W - 0.12, 0.5, 0.16), M.cushion, 0, 0.66, D / 2 - 0.1); // backrest (+Z)
        for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.16, 0.24, D), M.cushion, sx * (W / 2 - 0.05), 0.56, 0);
        legs(W / 2 - 0.05, D / 2 - 0.05, 0.12, 0.025);
        break;
      }
      case "shelf": {
        add(new THREE.BoxGeometry(W - 0.04, H, D - 0.04), M.woodDark, 0, H / 2, 0);
        const rows = 4;
        for (let i = 1; i < rows; i++) {
          add(new THREE.BoxGeometry(W - 0.08, 0.03, D - 0.06), M.wood, 0, (H / rows) * i, 0);
        }
        break;
      }
      case "nightstand": {
        add(new THREE.BoxGeometry(W - 0.03, H - 0.08, D - 0.03), M.wood, 0, 0.04 + (H - 0.08) / 2, 0);
        add(new THREE.BoxGeometry(W, 0.04, D), M.woodDark, 0, H - 0.02, 0);
        add(new THREE.BoxGeometry(0.06, 0.1, 0.02), M.woodDark, 0, H - 0.28, -D / 2 + 0.02); // drawer front (-Z)
        legs(W / 2 - 0.04, D / 2 - 0.04, 0.06, 0.018);
        break;
      }
      case "dresser": {
        add(new THREE.BoxGeometry(W - 0.03, H - 0.08, D - 0.03), M.wood, 0, 0.04 + (H - 0.08) / 2, 0);
        add(new THREE.BoxGeometry(W, 0.05, D), M.woodDark, 0, H - 0.025, 0);
        const rows = 3;
        for (let i = 0; i < rows; i++) {
          const y = 0.10 + (H - 0.2) * (i + 0.5) / rows;
          add(new THREE.BoxGeometry(W - 0.1, 0.06, 0.015), M.woodDark, 0, y, -D / 2 + 0.02);
        }
        legs(W / 2 - 0.04, D / 2 - 0.04, 0.08, 0.02);
        break;
      }
      case "armchair": {
        add(new THREE.BoxGeometry(W - 0.05, 0.24, D - 0.05), M.fabric, 0, 0.18, 0);
        add(new THREE.BoxGeometry(W - 0.05, 0.12, D - 0.15), M.cushion, 0, 0.36, 0);
        add(new THREE.BoxGeometry(W - 0.1, 0.5, 0.14), M.cushion, 0, 0.62, D / 2 - 0.07); // backrest (+Z)
        for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.13, 0.22, D - 0.05), M.cushion, sx * (W / 2 - 0.04), 0.5, 0);
        legs(W / 2 - 0.05, D / 2 - 0.05, 0.15, 0.022);
        break;
      }
    }

    group.position.set(item.center.x, 0, item.center.z);
    group.rotation.y = -item.rotationDegrees * Math.PI / 180;
    this.roomGroup.add(group);
  }

  /// A ceiling-mounted light: a bare 60 W bulb on a cord, or a 200 W
  /// 60×60 cm office panel. Both are emissive and (when enabled) cast a point
  /// light; `applyTimeOfDay` decides whether that light is actually used.
  addLightFixture(item, roomHeight, withPointLight) {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: LIGHT_METAL, metalness: 0.7, roughness: 0.35 });
    const isPanel = item.kind === "lightPanel";

    let emissiveMat;
    let onIntensity;
    let lightY;
    let pointColor;
    let pointIntensity;
    let pointDistance;

    if (isPanel) {
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 2.5,
        roughness: 0.25,
      });
      emissiveMat = panelMat;
      onIntensity = 2.5;

      // Slim recessed frame plus the 60×60 cm diffuser panel.
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.03, 0.64), metal);
      frame.position.set(0, roomHeight - 0.015, 0);
      group.add(frame);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.015, 0.60), panelMat);
      panel.position.set(0, roomHeight - 0.035, 0);
      group.add(panel);

      lightY = roomHeight - 0.05;
      pointColor = 0xffffff;
      pointIntensity = 80;
      pointDistance = 14;
    } else {
      const bulbMat = new THREE.MeshStandardMaterial({
        color: BULB_COLOR,
        emissive: 0xffe6a0,
        emissiveIntensity: 2.2,
        roughness: 0.3,
      });
      emissiveMat = bulbMat;
      onIntensity = 2.2;

      const hang = 0.24;
      const cy = roomHeight - hang;

      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 20), metal);
      canopy.position.set(0, roomHeight - 0.015, 0);
      group.add(canopy);

      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, hang - 0.02, 8), metal);
      cord.position.set(0, roomHeight - 0.015 - (hang - 0.02) / 2, 0);
      group.add(cord);

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 18), bulbMat);
      bulb.position.set(0, cy, 0);
      group.add(bulb);

      lightY = cy;
      pointColor = 0xffe6b8;
      pointIntensity = 40;
      pointDistance = 10;
    }

    // The fixture is a light source, so its own parts must not cast shadows —
    // otherwise the bulb, cord and canopy would darken the walls and floor
    // around it (a bare bulb has nothing occluding it). They still receive
    // shadows from furniture and walls.
    group.traverse(node => {
      if (node.isMesh) { node.receiveShadow = true; }
    });
    this.fixtureEmissives.push({ mat: emissiveMat, on: onIntensity });

    group.position.set(item.center.x, 0, item.center.z);
    this.roomGroup.add(group);

    if (withPointLight) {
      const pl = new THREE.PointLight(pointColor, pointIntensity, pointDistance, 2);
      pl.position.set(item.center.x, lightY, item.center.z);
      // Cast shadows so walls actually block the light and it only reaches the
      // neighbouring rooms through open doorways, instead of leaking through.
      pl.castShadow = true;
      pl.shadow.mapSize.set(POINT_SHADOW_MAP_SIZE, POINT_SHADOW_MAP_SIZE);
      // Both biases stay at zero: either one displaces the shadow off the
      // surface exactly where walls, floor and ceiling meet, which is what
      // produced the bright outlines in dark rooms. Back-face shadow
      // rendering already supplies the margin that a bias would buy.
      pl.shadow.bias = POINT_SHADOW_BIAS;
      pl.shadow.normalBias = 0;
      pl.shadow.camera.near = 0.05;
      pl.shadow.camera.far = pointDistance;
      // The room, and nothing else. A lamp on a ceiling cannot see the street
      // and has no business rendering it six times a frame.
      pl.shadow.camera.layers.set(ROOM_ONLY_LAYER);
      this.roomGroup.add(pl);
      this.pointLights.push(pl);
    }
  }

  disposeScene() {
    // Persistent subtrees (the city) own their own resources and are far too
    // expensive to rebuild every time a wall moves, so lift them out first.
    const persistent = this.scene.children.filter(c => c.userData && c.userData.persistent);
    for (const node of persistent) this.scene.remove(node);
    this.scene.traverse(node => {
      if (node.isMesh) {
        node.geometry.dispose();
        if (Array.isArray(node.material)) node.material.forEach(m => this.disposeMaterial(m));
        else this.disposeMaterial(node.material);
      }
    });
    this.scene.clear();
    for (const node of persistent) this.scene.add(node);
    this.floorMaterial = null;
  }

  /// Builds or reuses the surrounding city for this room and floor. The city
  /// only depends on the building envelope, so ordinary editing never
  /// regenerates it.
  syncCity(room) {
    const bounds = this.currentBuildingBounds || this.buildingBounds(room);
    const seed = seedFromString(String(room.id || room.name || "roomcad"));
    const lift = this.floorY();
    if (!this.city.matches(bounds, seed, lift)) this.city.build(bounds, seed, lift);
    if (this.city.group.parent !== this.scene) this.scene.add(this.city.group);
  }

  disposeMaterial(material) {
    if (material === this.glassMaterial) return; // reused across rebuilds
    if (material.map && !this.reusableTextures.has(material.map)) material.map.dispose();
    if (material.emissiveMap && !this.reusableTextures.has(material.emissiveMap)) material.emissiveMap.dispose();
    material.dispose();
  }

  // MARK: Environment builders

  makeGlassMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: GLASS_COLOR,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    });
  }

  /// A soft vertical sky gradient (blue → pale horizon).
  makeSkyTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, "#4a86c8");
    g.addColorStop(0.45, "#8fb8e0");
    g.addColorStop(0.75, "#d6e6f2");
    g.addColorStop(1.0, "#eef4fa");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /// A tileable soft-noise texture used as cloud density. Built once and
  /// cloned per layer, since each layer needs its own scroll offset.
  makeCloudTexture(size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);

    // A wrapping value-noise lattice, so the texture tiles seamlessly.
    const lattice = (n, seed) => {
      const g = new Float32Array(n * n);
      let st = (seed >>> 0) || 1;
      for (let i = 0; i < g.length; i++) {
        st = (st + 0x6D2B79F5) | 0;
        let t = Math.imul(st ^ (st >>> 15), 1 | st);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        g[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
      return g;
    };
    const fade = t => t * t * (3 - 2 * t);
    const sample = (g, n, x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = fade(x - xi);
      const yf = fade(y - yi);
      const x0 = ((xi % n) + n) % n;
      const y0 = ((yi % n) + n) % n;
      const x1 = (x0 + 1) % n;
      const y1 = (y0 + 1) % n;
      const a = g[y0 * n + x0];
      const b = g[y0 * n + x1];
      const c = g[y1 * n + x0];
      const d = g[y1 * n + x1];
      return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
    };

    const octaves = [
      { n: 4, w: 0.50, seed: 7 },
      { n: 8, w: 0.28, seed: 19 },
      { n: 16, w: 0.15, seed: 53 },
      { n: 32, w: 0.07, seed: 91 },
    ];
    const grids = octaves.map(o => lattice(o.n, o.seed));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (let i = 0; i < octaves.length; i++) {
          const o = octaves[i];
          v += sample(grids[i], o.n, (x / size) * o.n, (y / size) * o.n) * o.w;
        }
        // Lift the threshold so the result is distinct puffs rather than an
        // even grey wash across the whole sky.
        const a = clamp01((v - 0.42) / 0.34);
        const i4 = (y * size + x) * 4;
        img.data[i4] = 255;
        img.data[i4 + 1] = 255;
        img.data[i4 + 2] = 255;
        img.data[i4 + 3] = Math.round(a * a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /// Three cloud decks at different heights, each drifting at its own speed and
  /// direction. Nothing morphs on its own — the shapes change because the
  /// layers slide across each other, which is cheap and reads as weather.
  buildClouds(room) {
    this.cloudLayers = [];
    const building = this.currentBuildingBounds || this.buildingBounds(room);
    const span = 900;
    const specs = [
      { y: 74,  repeat: 1.8, opacity: 0.62, dx:  0.0042, dy:  0.0023, phase: [0.00, 0.00] },
      { y: 92,  repeat: 1.2, opacity: 0.46, dx: -0.0029, dy:  0.0036, phase: [0.37, 0.61] },
      { y: 112, repeat: 0.8, opacity: 0.30, dx:  0.0018, dy: -0.0015, phase: [0.72, 0.19] },
    ];
    const geo = new THREE.PlaneGeometry(span, span);
    for (const spec of specs) {
      const map = this.cloudTexture.clone();
      map.needsUpdate = true;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(spec.repeat, spec.repeat);
      // Fixed, distinct phases so the decks never start stacked on top of one
      // another (and so the sky looks the same every time you open a design).
      map.offset.set(spec.phase[0], spec.phase[1]);
      const mat = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(building.centerX, this.floorY() + spec.y, building.centerZ);
      mesh.renderOrder = -9;   // after the sky dome, before everything solid
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      mesh.userData.altitude = spec.y;
      this.cloudLayers.push({ mesh, mat, map, base: spec.opacity, dx: spec.dx, dy: spec.dy });
    }
    geo.dispose();
  }

  /// Drifts the cloud decks. Called from the render loop.
  updateClouds(dt) {
    if (!this.cloudLayers) return;
    for (const layer of this.cloudLayers) {
      layer.map.offset.x += layer.dx * dt;
      layer.map.offset.y += layer.dy * dt;
    }
  }

  /// A large unlit sky dome so the gradient rotates naturally with the camera.
  buildSky(room) {
    const geo = new THREE.SphereGeometry(200, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: this.skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    const building = this.currentBuildingBounds || this.buildingBounds(room);
    sky.position.set(building.centerX, this.floorY(), building.centerZ);
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.skyMesh = sky;
    this.buildClouds(room);
  }

  /// Sun direction as a unit vector (North = -Z, azimuth clockwise from North,
  /// matching the 2D editor where the top of the plan is North 0°).
  sunDirectionVec(altitude, azimuth) {
    const alt = Math.max(altitude, 0.05); // keep it just above the horizon at night
    return new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(alt),  // East  (+X)
      Math.sin(alt),                       // up    (+Y)
      -Math.cos(azimuth) * Math.cos(alt)   // North (-Z)
    );
  }

  /// Positions the sun, sky and ambient light for the current store.timeOfDay
  /// hour (24 h clock). Called after a build and whenever the time (or the L
  /// lighting mode) changes.
  applyTimeOfDay() {
    if (!this.sun || !this.sunTarget) return;
    const hour = store.timeOfDay;
    const { altitude, azimuth } = sunForHour(hour);
    const altDeg = altitude * 180 / Math.PI;

    // dayAmount ramps 0 (deep night) → 1 (full day) through civil twilight;
    // twilight peaks as the sun crosses the horizon (sunrise/sunset tint).
    const dayAmount = smoothstep01(-6, 3, altDeg);
    const nightAmount = 1 - dayAmount;
    const twilight = clamp01(1 - Math.abs(altDeg + 1.5) / 7);

    // Sun position + intensity (the L toggle still switches the room to
    // placed-lights-only, which turns the sun off).
    this.sunDir = this.sunDirectionVec(altitude, azimuth);
    this.aimSun();

    const day = this.lightsOn;
    // Weather first: the city owns it, and the sun, fog and cloud deck all
    // have to agree with what is falling out of the sky.
    this.city.setWeather(store.weather);
    const air = this.city.atmosphere();
    this.sun.intensity = 2.8 * dayAmount * (day ? 1 : 0) * (1 - air.dim);
    // Ambient sky keeps the interior readable at twilight and night.
    // Overcast loses the sun but gains bounced light off the cloud base, which
    // is why a grey day is flat rather than simply dark.
    if (this.hemisphere) {
      this.hemisphere.intensity = 0.55 * (0.06 + 0.94 * dayAmount) * (1 + air.dim * 0.5);
    }
    if (this.fill) this.fill.intensity = 0.35 * dayAmount * (day ? 1 : 0);

    // Sky + fog colour: day → warm twilight → deep night.
    const sky = new THREE.Color(DAY_BACKGROUND)
      .lerp(new THREE.Color(TWILIGHT_BACKGROUND), twilight)
      .lerp(new THREE.Color(NIGHT_BACKGROUND), nightAmount * (1 - twilight * 0.5));
    // Weather washes the colour out of the sky towards flat grey, and closes
    // the fog in around the viewer.
    if (air.haze > 0) sky.lerp(new THREE.Color(OVERCAST_SKY), air.haze * 0.55 * dayAmount);
    this.scene.background = sky;
    if (this.scene.fog) {
      this.scene.fog.color.copy(sky);
      this.scene.fog.near = FOG_NEAR * (1 - air.haze * 0.5);
      this.scene.fog.far = FOG_FAR * (1 - air.haze * 0.62);
    }
    if (this.skyMesh) this.skyMesh.visible = dayAmount > 0.3;

    // Clouds stay in the sky after dark, but as dim silhouettes rather than
    // bright white, and they catch the twilight tint as it passes.
    const cloudColor = new THREE.Color(0xffffff)
      .lerp(new THREE.Color(0xffc9a6), twilight * 0.8)
      .lerp(new THREE.Color(0x2a3346), nightAmount * (1 - twilight * 0.6));
    for (const layer of this.cloudLayers || []) {
      layer.mat.color.copy(cloudColor);
      layer.mat.opacity = Math.min(1, layer.base * (0.30 + 0.70 * dayAmount) * (1 + air.haze * 1.4));
    }

    // Image-based lighting only while the sun is actually up.
    this.scene.environment = (day && dayAmount > 0.05) ? this.environment : null;

    // The city follows the same effective daylight as the sun, so the L
    // toggle darkens the whole world rather than just the room.
    this.city.applyTimeOfDay(dayAmount * (day ? 1 : 0));

    // Room fixtures only light in placed-lights mode (the L toggle).
    for (const l of this.pointLights) l.visible = !day;
    for (const e of this.fixtureEmissives) e.mat.emissiveIntensity = day ? 0 : e.on;

  }

  /// Applies the current lighting: uniform daylight (placed lights off) or
  /// placed-lights-only, further shaped by the time of day (sun and sky).
  toggleLights() {
    this.lightsOn = !this.lightsOn;
    this.applyTimeOfDay();
  }

  // MARK: Post-processing (SSAO + bloom, WebGPU TSL)

  setupPostProcessing() {
    try {
      this.setupSaoBloom();
    } catch (err) {
      console.error("SSAO/bloom failed, falling back to direct render:", err);
      this.renderPipeline = null;
    }
  }

  setupSaoBloom() {
    this.renderPipeline = new THREE.RenderPipeline(this.renderer);

    // One scene pass that also writes view-space normals (for SSAO) and the
    // emissive term (for a selective bloom that ignores the white floor).
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive, normal: normalView }));

    const scenePassColor = scenePass.getTextureNode('output');
    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');

    // Soft-contact shadows: screen-space ambient occlusion.
    const ssaoPass = ssao(scenePassDepth, scenePassNormal, this.camera);
    ssaoPass.samples.value = 16;
    ssaoPass.radius.value = 0.5;
    ssaoPass.intensity.value = 1.2;
    ssaoPass.bias.value = 0.025;
    ssaoPass.resolutionScale = 0.5;

    // Bloom only the emissive surfaces (room lights), so the
    // white marble tiles stay flat instead of glowing.
    const emissivePass = scenePass.getTextureNode('emissive');
    const bloomPass = bloom(emissivePass, 0.55, 0.5, 0.85);

    this.renderPipeline.outputNode = scenePassColor.mul(ssaoPass.r).add(bloomPass);
  }

  // MARK: Rapier physics

  buildPhysics(room, resetPlayer = false) {
    if (!this.physicsReady) return;
    // Rebuild the world from scratch so static colliders never accumulate
    // across room changes (which used to wedge the player after a few edits).
    if (this.world) this.world.free();
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.playerBody = null;
    this.playerCollider = null;
    this.physicsBodies = [];
    const baseY = this.floorY(); // physics lives at the room's current floor lift

    // Floor and ceiling, over the ROOM rather than over the whole plan canvas.
    //
    // The canvas is the drawing area and is usually much bigger than the room
    // in it. Run out that far, the floor is an invisible platform hanging over
    // the street — walk out of a ground-floor room and you are standing on
    // nothing, and from an upper floor you walk out into the air and stay
    // there. The ceiling is worse: it caps the sky for several metres in every
    // direction outside the front door.
    // Sized to the BUILDING ENVELOPE, which is the declared room together with
    // every wall drawn beyond it — not the declared room on its own. A plan of
    // seven rooms is mostly outside its own nominal width, and a floor cut to
    // that leaves the rest of the building standing over nothing: you walk
    // through the floor and sink to the street. Nor the whole editing canvas,
    // which is bigger again and hangs an invisible slab over the pavement.
    const canvas = P.canvasOf(room);
    const envelope = this.currentBuildingBounds || this.buildingBounds(room);
    const pad = P.WALL_THICKNESS + 0.2;      // far enough out to carry the walls
    const fx = envelope.centerX;
    const fz = envelope.centerZ;
    const fw = envelope.width / 2 + pad;
    const fl = envelope.length / 2 + pad;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(fw, 0.03, fl).setTranslation(fx, baseY - 0.03, fz)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(fw, 0.05, fl).setTranslation(fx, baseY + room.height + 0.025, fz)
    );
    void canvas;

    // The city. Pavements, kerbs, the carriageway and every building, as the
    // city itself laid them out — so the ground you can see through a broken
    // window is ground you can stand on.
    //
    // This replaces four invisible walls that used to run round the edge of the
    // plan area. They were there because there was nothing outside it: without
    // them the player walked off the end of the world. There is a whole city
    // out there now, so the cage comes down.
    for (const solid of this.city.solids || []) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(solid.w / 2, solid.h / 2, solid.d / 2)
          .setTranslation(solid.x, solid.y, solid.z)
      );
    }

    // Walls, split by open doorways so you can walk through them.
    // A shot-out window is a hole you can climb through: the wall keeps its
    // sill below and its head above, and the glass band between them is open.
    // Without this the pane shatters, you can see straight out, and the wall is
    // as solid as it ever was.
    const sillH = Math.min(P.SILL_HEIGHT, room.height);
    const headH = Math.min(sillH + P.GLASS_HEIGHT, room.height);
    const openingsOn = (wallID) => this.brokenGlass.filter(g => g.wallID === wallID);

    for (const seg of P.wallCollisionSegments(room)) {
      const dx = seg.end.x - seg.start.x;
      const dz = seg.end.z - seg.start.z;
      const rawLength = Math.hypot(dx, dz);
      if (rawLength < 0.01) continue;

      // Where this piece of wall sits along its own wall, so it can be compared
      // with the openings, which are measured that way.
      const wall = room.walls.find(w => w.id === seg.wallID);
      const broken = wall ? openingsOn(wall.id) : [];
      if (broken.length && wall) {
        const wx = wall.end.x - wall.start.x;
        const wz = wall.end.z - wall.start.z;
        const wlen = Math.hypot(wx, wz) || 1;
        const at = (pt) => ((pt.x - wall.start.x) * wx + (pt.z - wall.start.z) * wz) / wlen;
        let solid = [{ from: at(seg.start), to: at(seg.end) }];
        for (const hole of broken) {
          const next = [];
          for (const piece of solid) {
            const lo = Math.max(piece.from, Math.min(piece.to, hole.from));
            const hi = Math.max(piece.from, Math.min(piece.to, hole.to));
            if (hi - lo <= 0.01) { next.push(piece); continue; }
            if (lo - piece.from > 0.01) next.push({ from: piece.from, to: lo });
            if (piece.to - hi > 0.01) next.push({ from: hi, to: piece.to });
            // The sill under the opening and the head above it stay solid, so
            // you step up and through rather than walking out at floor level.
            this.addWallSlab(wall, lo, hi, baseY, 0, sillH);
            this.addWallSlab(wall, lo, hi, baseY, headH, room.height + WALL_VERTICAL_SEAL);
          }
          solid = next;
        }
        for (const piece of solid) {
          this.addWallSlab(wall, piece.from, piece.to, baseY, 0, room.height + WALL_VERTICAL_SEAL);
        }
        continue;
      }
      // Extend only true wall ends, never the edge of a doorway. This makes
      // snapped wall colliders interpenetrate at corners without narrowing a
      // usable doorway.
      const before = seg.startSeal;
      const after = seg.endSeal;
      const ux = dx / rawLength;
      const uz = dz / rawLength;
      const startX = seg.start.x - ux * before;
      const startZ = seg.start.z - uz * before;
      const endX = seg.end.x + ux * after;
      const endZ = seg.end.z + uz * after;
      const len = rawLength + before + after;
      if (len < 0.01) continue;
      const midX = (startX + endX) / 2;
      const midZ = (startZ + endZ) / 2;
      const h = room.height / 2 + WALL_VERTICAL_SEAL;
      const t = P.WALL_THICKNESS;
      const horizontal = Math.abs(dz) < 0.001;
      const desc = horizontal
        ? RAPIER.ColliderDesc.cuboid(len / 2, h, t / 2)
        : RAPIER.ColliderDesc.cuboid(t / 2, h, len / 2);
      desc.setTranslation(midX, baseY + room.height / 2, midZ);
      this.world.createCollider(desc);
    }

    // Closed doors block their gap.
    for (const door of room.doors) {
      if (door.open !== false) continue;
      const wall = room.walls.find(w => w.id === door.wallID);
      if (!wall) continue;
      const a = P.wallPointAt(wall, door.offset);
      const b = P.wallPointAt(wall, door.offset + door.width);
      const len = P.distance(a, b);
      if (len < 0.01) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const doorTop = Math.min(P.DOOR_HEIGHT, room.height);
      const horizontal = Math.abs(b.z - a.z) < 0.001;
      const halfDoorDepth = P.WALL_THICKNESS / 2 + CLOSED_DOOR_SEAL;
      const desc = horizontal
        ? RAPIER.ColliderDesc.cuboid(len / 2, doorTop / 2 + CLOSED_DOOR_SEAL, halfDoorDepth)
        : RAPIER.ColliderDesc.cuboid(halfDoorDepth, doorTop / 2 + CLOSED_DOOR_SEAL, len / 2);
      desc.setTranslation(midX, baseY + doorTop / 2, midZ);
      this.world.createCollider(desc);
    }

    // Wall header above each doorway (so you can't jump over a door).
    for (const door of room.doors) {
      const wall = room.walls.find(w => w.id === door.wallID);
      if (!wall) continue;
      const doorTop = Math.min(P.DOOR_HEIGHT, room.height);
      if (doorTop >= room.height - 0.01) continue;
      const a = P.wallPointAt(wall, door.offset);
      const b = P.wallPointAt(wall, door.offset + door.width);
      const len = P.distance(a, b);
      if (len < 0.01) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const headerH = room.height - doorTop;
      const horizontal = Math.abs(b.z - a.z) < 0.001;
      const desc = horizontal
        ? RAPIER.ColliderDesc.cuboid(len / 2, headerH / 2, P.WALL_THICKNESS / 2)
        : RAPIER.ColliderDesc.cuboid(P.WALL_THICKNESS / 2, headerH / 2, len / 2);
      desc.setTranslation(midX, baseY + doorTop + headerH / 2, midZ);
      this.world.createCollider(desc);
    }

    // Climbable furniture.
    for (const item of room.furniture) {
      const stand = P.FURNITURE_KINDS[item.kind].standHeight || 0;
      if (stand <= 0) continue;
      const f = P.furnitureFootprint(item);
      const w = f.maxX - f.minX;
      const d = f.maxZ - f.minZ;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, stand / 2, d / 2)
          .setTranslation(f.minX + w / 2, baseY + stand / 2, f.minZ + d / 2)
      );
    }

    // Player capsule: the body sits at the feet; the capsule rises from it.
    // A fresh reset spawns inside the main room; an in-place rebuild keeps the
    // player wherever they are across the full canvas.
    // Kept where they are on a rebuild, NOT dragged back inside the plan area.
    // The colliders are rebuilt the moment a window is shot out, so clamping to
    // the canvas here teleported the player back indoors at exactly the moment
    // they had made themselves a way out.
    const origin = P.roomOrigin(room);
    const spawnX = resetPlayer ? origin.x + room.width / 2 : this.position.x;
    const spawnZ = resetPlayer ? origin.z + Math.max(0.5, room.length - 0.6) : this.position.z;
    const spawnY = baseY + (resetPlayer ? 0.2 : Math.max(0.2, this.feetY));
    const halfH = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnX, spawnY, spawnZ)
        .lockRotations()
        .setLinearDamping(0)
        .setCanSleep(false)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, PLAYER_RADIUS)
        .setTranslation(0, halfH + PLAYER_RADIUS, 0)
        .setFriction(0.1),
      body
    );
    this.playerBody = body;
    this.playerCollider = collider;
    this.physicsBodies.push(body);
    this.onGround = false;
  }

  /// Points the sun's shadow volume at wherever the viewer is standing.
  ///
  /// A directional light shadows an orthographic box, and the box has to be
  /// somewhere. It used to sit over the room, which is why nothing outside the
  /// room had a shadow: the whole city was outside the box. It now follows the
  /// viewer, so the resolution is spent where it can be seen and the street
  /// two hundred metres away — which is fogged anyway — costs nothing.
  ///
  /// The position is snapped to whole shadow texels. Without that the sampling
  /// grid slides under the geometry as you walk and every shadow edge in the
  /// scene crawls, which reads as the whole world shimmering.
  aimSun() {
    if (!this.sun || !this.sunTarget || !this.sunDir) return;
    const dir = this.sunDir;
    const texel = (SUN_SHADOW_REACH * 2) / SUN_SHADOW_MAP;
    const cx = Math.round(this.position.x / texel) * texel;
    const cz = Math.round(this.position.z / texel) * texel;
    const cy = this.floorY();
    this.sun.position.set(cx + dir.x * SUN_HEIGHT, cy + dir.y * SUN_HEIGHT, cz + dir.z * SUN_HEIGHT);
    this.sunTarget.position.set(cx, cy, cz);
    this.sunTarget.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    if (this.sun.shadow && this.sun.shadow.camera) this.sun.shadow.camera.updateProjectionMatrix();
  }

  /// A fixed pool of lights for the street, moved to wherever the light
  /// actually is this frame.
  ///
  /// The city has a hundred street lamps and a headlamp on the nose of every
  /// vehicle. Nothing will light a scene with three hundred lights — but a
  /// dozen is ordinary, and from any one place only about a dozen can be seen.
  /// So the pool is fixed and the lamps take turns in it.
  ///
  /// Fixed is the important part. The renderer compiles its shaders around the
  /// number of lights in the scene, so adding and removing them as you walk
  /// down a street recompiles on the move. The pool is created once and always
  /// present; a slot with nothing to do is turned down to nothing instead.
  buildCityLightPool(scene) {
    this.cityLights = [];
    for (let i = 0; i < CITY_LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      // The first few slots cast; the rest only light. A shadow-casting point
      // light is six renders of the scene, so twelve of them is seventy-two and
      // nobody can afford that — but the two or three nearest lamps are the
      // ones whose shadows you would actually notice, and the pool fills from
      // the front, so those slots always hold the nearest lights.
      //
      // Which slots cast is fixed for the life of the pool. Turning it on and
      // off as lamps come and go reallocates shadow maps and recompiles, which
      // is exactly the stutter the fixed pool exists to avoid.
      light.castShadow = i < CITY_SHADOW_LIGHTS;
      if (light.castShadow) {
        light.shadow.mapSize.set(CITY_SHADOW_MAP, CITY_SHADOW_MAP);
        light.shadow.camera.near = 0.4;
        light.shadow.bias = -0.004;
      }
      scene.add(light);
      this.cityLights.push(light);
    }
    this.lightCandidates = [];
    this.lightFrustum = new THREE.Frustum();
    this.lightProjection = new THREE.Matrix4();
    this.lightSphere = new THREE.Sphere();
    this.litCount = 0;
  }

  /// Hands the pool to the nearest lights that can be seen from here.
  ///
  /// "Can be seen" is the light's REACH against the view, not the lamp itself:
  /// a lamp behind your shoulder still lights the wall you are looking at, and
  /// culling on the lamp's own position would switch it off while you watched
  /// its light go out.
  updateCityLights() {
    const pool = this.cityLights;
    if (!pool || !this.city) return;
    this.city.collectLights(this.lightCandidates, this.camera.position, CITY_LIGHT_REACH);

    this.camera.updateMatrixWorld();
    this.lightProjection.multiplyMatrices(
      this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.lightFrustum.setFromProjectionMatrix(this.lightProjection);

    if (!this.lightChosen) this.lightChosen = [];
    City.selectLights(this.lightCandidates, (e) => {
      this.lightSphere.center.set(e.x, e.y, e.z);
      this.lightSphere.radius = e.distance;
      return this.lightFrustum.intersectsSphere(this.lightSphere);
    }, pool.length, this.lightChosen);

    let used = 0;
    for (const e of this.lightChosen) {
      const light = pool[used++];
      light.position.set(e.x, e.y, e.z);
      light.color.setHex(e.color);
      light.intensity = e.intensity;
      light.distance = e.distance;
      // The shadow frustum ends where the light does, so the map is spent on
      // the ground the light actually reaches.
      if (light.castShadow) {
        light.shadow.camera.far = e.distance;
        light.shadow.camera.updateProjectionMatrix();
      }
    }
    // Whatever is left over is turned off rather than removed. A shadow slot
    // with nothing in it is pulled in to almost nothing as well, so its six
    // faces render an empty metre instead of the street.
    for (let i = used; i < pool.length; i++) {
      pool[i].intensity = 0;
      pool[i].distance = 1;
      if (pool[i].castShadow) {
        pool[i].shadow.camera.far = 1;
        pool[i].shadow.camera.updateProjectionMatrix();
      }
    }
    this.litCount = used;
  }

  /// One box of wall, between two offsets along it and two heights up it. Used
  /// for the pieces around a shot-out window: the sill under it, the head over
  /// it, and whatever is left of the wall either side.
  addWallSlab(wall, from, to, baseY, y0, y1) {
    const len = to - from;
    const h = y1 - y0;
    if (len < 0.01 || h < 0.01) return;
    const a = P.wallPointAt(wall, from);
    const b = P.wallPointAt(wall, to);
    const horizontal = Math.abs(b.z - a.z) < 0.001;
    const t = P.WALL_THICKNESS;
    const desc = horizontal
      ? RAPIER.ColliderDesc.cuboid(len / 2, h / 2, t / 2)
      : RAPIER.ColliderDesc.cuboid(t / 2, h / 2, len / 2);
    desc.setTranslation((a.x + b.x) / 2, baseY + y0 + h / 2, (a.z + b.z) / 2);
    this.world.createCollider(desc);
  }

  /// True when a support surface is within a small margin below the capsule.
  isGrounded() {
    if (!this.playerBody) return false;
    const p = this.playerBody.translation();
    const halfH = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    const reach = halfH + PLAYER_RADIUS + 0.06;
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, reach, true, undefined, undefined, undefined, this.playerBody);
    return hit !== null;
  }

  /// Resizes the player capsule for crouch/stand, keeping the feet planted.
  setCrouch(crouching) {
    if (this.crouching === crouching) return;
    this.crouching = crouching;
    if (!this.playerCollider) return;
    const halfH = crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.playerCollider.setShape(new RAPIER.Capsule(halfH, PLAYER_RADIUS));
    this.playerCollider.setTranslation(0, halfH + PLAYER_RADIUS, 0);
  }

  /// Applies an upward velocity impulse while keeping horizontal velocity.
  jump() {
    if (!this.playerBody) return;
    const v = this.playerBody.linvel();
    this.playerBody.setLinvel({ x: v.x, y: JUMP_SPEED, z: v.z }, true);
    this.onGround = false;
  }

  /// Builds the floor as white 60 × 60 cm marble tiles with thin grey veins
  /// and a ~5 mm grout gap between tiles.
  loadFloorTexture(bounds) {
    this.applyFloorCanvas(this.makeFloorCanvas(bounds));
  }

  applyFloorCanvas(canvas) {
    if (!this.floorMaterial) return;
    if (this.floorMaterial.map) this.floorMaterial.map.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // WebGPU exposes max anisotropy on the renderer, not renderer.capabilities.
    texture.anisotropy = (this.renderer.getMaxAnisotropy && this.renderer.getMaxAnisotropy()) || 8;
    this.floorMaterial.map = texture;
    this.floorMaterial.needsUpdate = true;
  }

  makeFloorCanvas(bounds) {
    const layout = P.tileLayout(bounds.width, bounds.length);
    const tilePx = 96; // 60 cm → 5 mm grout ≈ 1 px
    const width = Math.max(1, Math.round(layout.columns * tilePx));
    const height = Math.max(1, Math.round(layout.rows * tilePx));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Deterministic per-tile pseudo-random so the marble doesn't reshuffle
    // every time the room is rebuilt.
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let col = 0; col < layout.columns; col++) {
      for (let row = 0; row < layout.rows; row++) {
        this.drawMarbleTile(ctx, col * tilePx, row * tilePx, tilePx, rnd);
      }
    }
    return canvas;
  }

  drawMarbleTile(ctx, x, y, size, rnd) {
    // White marble base with a whisper of tone variation per tile.
    const shade = 232 + Math.floor(rnd() * 6);
    ctx.fillStyle = `rgb(${shade},${shade},${shade - 1})`;
    ctx.fillRect(x, y, size, size);

    // Thin grey marble veins.
    ctx.lineCap = "round";
    const veins = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < veins; i++) {
      ctx.strokeStyle = `rgba(150,152,156,${0.10 + rnd() * 0.14})`;
      ctx.lineWidth = 0.5 + rnd() * 1.2;
      ctx.beginPath();
      let vx = x + rnd() * size;
      let vy = y + rnd() * size;
      ctx.moveTo(vx, vy);
      const segs = 4 + Math.floor(rnd() * 4);
      for (let s = 0; s < segs; s++) {
        vx += (rnd() - 0.5) * size * 0.7;
        vy += (rnd() - 0.5) * size * 0.7;
        ctx.quadraticCurveTo(
          vx, vy,
          vx + (rnd() - 0.5) * size * 0.3,
          vy + (rnd() - 0.5) * size * 0.3
        );
      }
      ctx.stroke();
    }

    // Thin grey grout gap (~5 mm).
    ctx.strokeStyle = "rgba(128,130,134,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  // MARK: Input

  attachInput() {
    // Every listener is recorded so dispose() can detach it. Without this a
    // disposed Walk3D stays reachable from document and keeps handling keys.
    this._listeners = [];
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this._listeners.push([target, type, handler, options]);
    };

    const canvas = this.renderer.domElement;
    canvas.style.cursor = "crosshair";
    this.toggleWasLocked = false;

    // Left click toggles free-look — unless paintball mode is on, in which
    // case it fires the gun. Track whether the pointer was already locked on
    // mouse-down, so the click that *starts* looking doesn't also end it.
    on(canvas, "contextmenu", e => e.preventDefault());
    on(canvas, "mousedown", e => {
      // Right click opens/closes the door you're aiming at.
      if (e.button === 2) {
        this.toggleDoorAtCrosshair();
        e.preventDefault();
        return;
      }
      this.toggleWasLocked = this.locked;
    });
    on(canvas, "click", () => {
      if (this.paintballMode) {
        if (this.locked) this.shoot();
        else canvas.requestPointerLock();
      } else if (this.toggleWasLocked) {
        if (this.locked) document.exitPointerLock();
      } else {
        canvas.requestPointerLock();
      }
    });
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.paintballMode) {
        this.paintballMode = false;
        this.clearPaintball();
      }
      this.updatePaintballUI();
    });
    on(document, "mousemove", e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = P.clamp(this.pitch - e.movementY * 0.0025, -1.4, 1.4);
    });

    on(document, "keydown", e => {
      if (store.mode !== "3d") return;
      if (this.isTyping()) return;
      if (e.code === "KeyP") {
        this.togglePaintball();
        e.preventDefault();
        return;
      }
      if (e.code === "KeyL") {
        if (!e.repeat) this.toggleLights();
        e.preventDefault();
        return;
      }
      if (e.code === "KeyC" || e.code === "Space") {
        if (!e.repeat) {
          if (e.code === "KeyC") {
            this.setCrouch(!this.crouching);
          } else if (e.code === "Space") {
            if (this.crouching) {
              this.setCrouch(false);
            } else if (this.isGrounded()) {
              this.jump();
              this.jumpCount = 1;
            } else if (this.jumpCount < 2) {
              // Double jump to reach taller furniture.
              this.jump();
              this.jumpCount = 2;
            }
          }
        }
        e.preventDefault();
        return;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    on(document, "keyup", e => {
      this.keys.delete(e.code);
    });
    on(window, "blur", () => this.keys.clear());
  }

  // MARK: Paintball

  togglePaintball() {
    this.paintballMode = !this.paintballMode;
    if (this.paintballMode) {
      this.renderer.domElement.requestPointerLock();
    } else {
      this.clearPaintball();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.updatePaintballUI();
  }

  /// Breaks a window pane: the glass goes, leaving the opening, and a handful
  /// of shards fall out of it. With the pane gone the next shot passes
  /// straight through — the ray already reaches the city, the glass was simply
  /// the first thing in its way — so the room can be shot out of.
  ///
  /// The wall's collider is unaffected: physics treats a wall as solid whether
  /// or not it has openings, so this changes what you can SEE and SHOOT
  /// through, not what you can walk through.
  breakGlass(pane) {
    if (!pane || pane.userData.broken) return;
    pane.userData.broken = true;

    // The wall is still solid where the glass was. Record the opening and
    // rebuild the colliders so it becomes something to climb through — the
    // point of shooting a window out is to be able to leave by it.
    if (pane.userData.wallID) {
      this.brokenGlass.push({
        wallID: pane.userData.wallID,
        from: pane.userData.spanFrom,
        to: pane.userData.spanTo,
      });
      if (this.physicsReady && store.room) this.buildPhysics(store.room, false);
    }

    pane.geometry.computeBoundingBox();
    const box = pane.geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);

    for (let i = 0; i < 12; i++) {
      // Splinters of the pane, in its own frame, then carried into the world
      // by the pane's transform — so they start exactly where the glass was.
      const w = size.z * (0.12 + Math.random() * 0.22);
      const h = size.y * (0.12 + Math.random() * 0.26);
      const geometry = new THREE.BoxGeometry(size.x * 0.9, h, w);
      const material = this.glassMaterial.clone();
      material.transparent = true;
      const shard = new THREE.Mesh(geometry, material);
      shard.castShadow = false;
      shard.receiveShadow = false;
      shard.position.set(
        0,
        (Math.random() - 0.5) * (size.y - h),
        (Math.random() - 0.5) * (size.z - w)
      );
      pane.localToWorld(shard.position);
      shard.quaternion.copy(pane.quaternion);
      this.scene.add(shard);

      // Outward, along the pane's own normal, plus a little scatter.
      const out = new THREE.Vector3(1, 0, 0).applyQuaternion(pane.quaternion);
      out.multiplyScalar((Math.random() * 1.6 + 0.4) * (Math.random() < 0.5 ? 1 : -1));
      this.shards.push({
        mesh: shard,
        velocity: out.add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.8, Math.random() * 1.2, (Math.random() - 0.5) * 0.8
        )),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(7),
        life: 1.4 + Math.random() * 0.7,
        age: 0,
      });
    }

    if (pane.parent) pane.parent.remove(pane);
    pane.geometry.dispose();   // the material is shared; only the pane is ours
  }

  /// Falling glass. Cheap ballistics — there is nothing for a shard to collide
  /// with that matters, and they are gone in under two seconds.
  updateShards(dt) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i];
      shard.age += dt;
      shard.velocity.y -= 9.8 * dt;
      shard.mesh.position.addScaledVector(shard.velocity, dt);
      shard.mesh.rotation.x += shard.spin.x * dt;
      shard.mesh.rotation.y += shard.spin.y * dt;
      shard.mesh.rotation.z += shard.spin.z * dt;
      const left = 1 - shard.age / shard.life;
      shard.mesh.material.opacity = Math.max(0, left);
      if (left <= 0) {
        this.scene.remove(shard.mesh);
        shard.mesh.geometry.dispose();
        shard.mesh.material.dispose();
        this.shards.splice(i, 1);
      }
    }
  }

  /// Removes every paintball and splat from the scene.
  clearPaintball() {
    for (const ball of this.paintballs) {
      this.scene.remove(ball.mesh);
      ball.mesh.geometry.dispose();
      ball.mesh.material.dispose();
    }
    this.paintballs = [];
    for (const splat of this.splats) {
      this.scene.remove(splat);
      splat.geometry.dispose();
      splat.material.dispose();
    }
    this.splats = [];
    // Shards belong to the same mess. The broken panes themselves are not
    // restored — the glass is gone until the room is rebuilt, which is what
    // breaking it means.
    for (const shard of this.shards) {
      this.scene.remove(shard.mesh);
      shard.mesh.geometry.dispose();
      shard.mesh.material.dispose();
    }
    this.shards = [];
  }

  updatePaintballUI() {
    const ui = document.getElementById("paintball-ui");
    if (ui) ui.hidden = !this.paintballMode;
    const hint = document.getElementById("walk-hint");
    if (hint) {
      hint.textContent = this.paintballMode
        ? "Paintball! Click to shoot · P or Esc to stop"
        : (this.locked
            ? "Free look on · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch (to get through a hole) · L lights · right-click: door swing"
            : "Click to look · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch (to get through a hole) · L lights · right-click: door swing");
    }
  }

  /// Fires a green paintball straight ahead from the camera.
  shoot() {
    playPlop();
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(origin, direction);
    const targets = this.shootableMeshes();
    const hits = this.raycaster.intersectObjects(targets, false);
    let hit = hits.length > 0 ? hits[0] : null;
    // A pane is broken by the shot rather than splattered: the glass falls out
    // and the ball carries on to whatever was behind it, which out of a window
    // is the city.
    if (hit && hit.object.userData.glass) {
      const pane = hit.object;
      this.breakGlass(pane);
      hit = hits.find(h => h.object !== pane && !h.object.userData.glass) || null;
    }
    // A hit on a city building takes a metre square out of it, in the wall and
    // in what holds you up, and the ball carries on through the hole it made.
    // Only buildings: the room's own walls are the drawing, and knocking those
    // about would be editing the plan with a paintball gun.
    if (hit && hit.object.name === "city-facades") {
      const wall = hit.object;
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(wall.matrixWorld)
        : direction.clone().negate();
      const hole = this.city.punchHole(hit.point, normal);
      if (hole) {
        if (hole.brokeCollision && this.physicsReady && store.room) {
          this.buildPhysics(store.room, false);
        }
        this.spawnRubble(hit.point, normal);
        hit = hits.find(h => h.object !== wall) || null;
      }
    }

    const range = 60;
    const to = hit
      ? hit.point.clone()
      : origin.clone().add(direction.clone().multiplyScalar(range));
    const from = origin.clone().add(direction.clone().multiplyScalar(0.35));
    this.spawnPaintball(from, to, hit, this.carrierFor(hit));
  }

  /// Chunks of the wall that was just knocked out, thrown into the street.
  ///
  /// Reuses the glass shards' own update, which already tumbles a thing under
  /// gravity and fades it out — a wall that simply vanishes reads as a bug.
  spawnRubble(point, normal) {
    for (let i = 0; i < 10; i++) {
      const size = 0.07 + Math.random() * 0.16;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * (0.6 + Math.random()), size * (0.6 + Math.random())),
        new THREE.MeshStandardMaterial({ color: RUBBLE_COLOR, roughness: 0.95, transparent: true })
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.position.copy(point).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
      this.scene.add(mesh);
      const out = normal.clone().multiplyScalar(1.2 + Math.random() * 2.2);
      this.shards.push({
        mesh,
        velocity: out.add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.2, Math.random() * 2.2, (Math.random() - 0.5) * 1.2)),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(9),
        life: 1.8 + Math.random() * 0.8,
        age: 0,
      });
    }
  }

  /// If a shot hit a vehicle, work out WHERE on that vehicle — the hit point
  /// and normal in its own frame, rather than in the world. A vehicle is one
  /// instance of an instanced mesh and moves every frame, so a world position
  /// is only true for the instant it was measured: paint recorded that way
  /// hangs in the air while the car drives out from under it.
  carrierFor(hit) {
    if (!hit || !hit.object || !hit.object.name) return null;
    if (!hit.object.name.startsWith("city-vehicles-")) return null;
    const vehicle = this.city.vehicleForInstance(hit.object.name, hit.instanceId);
    if (!vehicle) return null;

    const toWorld = this.city.vehicleMatrix(vehicle);
    const toLocal = toWorld.clone().invert();
    const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    normal.transformDirection(toWorld);   // instance space to world
    return {
      vehicle,
      // Which city this vehicle belongs to. Rebuilding the neighbourhood
      // replaces the whole fleet, and paint left pointing at a vehicle from
      // the previous one would hang in mid-air on an object nothing is
      // driving any more.
      key: this.city.key,
      point: hit.point.clone().applyMatrix4(toLocal),
      normal: normal.applyMatrix4(new THREE.Matrix4().extractRotation(toLocal)).normalize(),
    };
  }

  shootableMeshes() {
    const meshes = [];
    this.scene.traverse(node => {
      if (node.isMesh && !node.userData.splat && !node.userData.ball && !node.userData.gun) {
        meshes.push(node);
      }
    });
    return meshes;
  }

  spawnPaintball(from, to, hit, carrier = null) {
    const geometry = new THREE.SphereGeometry(0.045, 16, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0x2ecc40, roughness: 0.35, emissive: 0x14a828, emissiveIntensity: 0.6 });
    const ball = new THREE.Mesh(geometry, material);
    ball.userData.ball = true;
    ball.castShadow = true; // the bullet casts a shadow from the sun as it flies
    ball.position.copy(from);
    this.scene.add(ball);
    this.paintballs.push({
      mesh: ball,
      from,
      to,
      hit,
      carrier,
      t: 0,
      duration: 0.12 + Math.random() * 0.05,
    });
    this.recoil();
  }

  updatePaintballs(dt) {
    for (let i = this.paintballs.length - 1; i >= 0; i--) {
      const ball = this.paintballs[i];
      ball.t += dt / ball.duration;
      const t = Math.min(ball.t, 1);
      // A shot at a moving car has to lead it. The flight is short, but at
      // thirteen metres a second the target is a metre away by the time the
      // ball arrives, and the splat would land in the road behind it.
      if (ball.carrier) {
        this.city.vehicleMatrix(ball.carrier.vehicle, _carrierMatrix);
        ball.to.copy(ball.carrier.point).applyMatrix4(_carrierMatrix);
      }
      ball.mesh.position.lerpVectors(ball.from, ball.to, t);
      // A little arc so the shot has some life.
      ball.mesh.position.y += Math.sin(Math.PI * t) * 0.06;
      if (t >= 1) {
        this.scene.remove(ball.mesh);
        ball.mesh.geometry.dispose();
        ball.mesh.material.dispose();
        if (ball.hit) this.placeSplat(ball.hit, ball.carrier);
        this.paintballs.splice(i, 1);
      }
    }
  }

  placeSplat(hit, carrier = null) {
    const radius = 0.05 + Math.random() * 0.04;
    const geometry = new THREE.CircleGeometry(radius, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x2ecc40 });
    const splat = new THREE.Mesh(geometry, material);
    splat.userData.splat = true;
    splat.userData.spin = Math.random() * Math.PI * 2;

    if (carrier) {
      // Paint on a vehicle is stored in that vehicle's frame and put back into
      // the world every frame, so it travels with the car it landed on.
      splat.userData.carrier = carrier;
      this.positionSplat(splat);
    } else {
      const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      if (hit.object) normal.transformDirection(hit.object.matrixWorld);
      splat.position.copy(hit.point).add(normal.clone().multiplyScalar(0.006));
      splat.lookAt(hit.point.clone().add(normal));
      splat.rotateZ(splat.userData.spin);
    }

    this.scene.add(splat);
    this.splats.push(splat);
    if (this.splats.length > 250) {
      const old = this.splats.shift();
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  /// Puts one carried splat back where it belongs on its vehicle.
  positionSplat(splat) {
    const carrier = splat.userData.carrier;
    if (!carrier) return;
    this.city.vehicleMatrix(carrier.vehicle, _carrierMatrix);
    splat.position.copy(carrier.point).applyMatrix4(_carrierMatrix);
    _carrierNormal.copy(carrier.normal).transformDirection(_carrierMatrix);
    splat.position.addScaledVector(_carrierNormal, 0.006);
    splat.lookAt(_carrierPoint.copy(splat.position).add(_carrierNormal));
    splat.rotateZ(splat.userData.spin);
  }

  /// Splats on moving vehicles, carried along with them. The rest are on walls
  /// and roads and never move, so they are left alone.
  updateSplats() {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      const carrier = splat.userData.carrier;
      if (!carrier) continue;
      if (carrier.key !== this.city.key) {
        // Its vehicle belongs to a city that no longer exists.
        this.scene.remove(splat);
        splat.geometry.dispose();
        splat.material.dispose();
        this.splats.splice(i, 1);
        continue;
      }
      this.positionSplat(splat);
    }
  }

  recoil() {
    this.gunRecoil = 1;
  }

  /// Flips the swing direction of the door under the crosshair (within reach).
  toggleDoorAtCrosshair() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(origin, direction);

    const doorMeshes = [];
    this.scene.traverse(node => {
      if (node.isMesh && node.userData.doorID) doorMeshes.push(node);
    });
    const hits = this.raycaster.intersectObjects(doorMeshes, false);
    const hit = hits.find(h => h.distance <= 3.0);
    if (hit && hit.object.userData.doorID) {
      store.toggleDoorSwing(hit.object.userData.doorID);
    }
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  }

  observeSize() {
    const resize = () => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      this.renderer.setSize(rect.width, rect.height, false);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(this.container);
    resize();
  }

  // MARK: Update

  update(room) {
    const key = JSON.stringify(room);
    if (key === this.lastRoomKey) return;
    const sameRoom = this.lastRoomKey !== null;
    const previous = this.lastRoomKey ? JSON.parse(this.lastRoomKey) : null;
    const keepCamera = sameRoom
      && previous && previous.id === room.id
      && previous.width === room.width && previous.length === room.length;
    this.lastRoomKey = key;
    this.build(room, !keepCamera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const [target, type, handler, options] of this._listeners || []) {
      target.removeEventListener(type, handler, options);
    }
    this._listeners = [];
    this.city.dispose();
    this.disposeScene();
    if (this.world) this.world.free();
    if (this.renderPipeline && this.renderPipeline.dispose) this.renderPipeline.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // MARK: Loop

  loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.tick(dt);
    this.updatePaintballs(dt);
    this.updateShards(dt);
    this.updateSplats();
    // The direction as well as the position: the city draws the traffic it can
    // be seen from here, and most of the fleet is behind you.
    this.camera.getWorldDirection(_viewForward);
    this.city.update(dt, this.camera.position, _viewForward);
    this.updateClouds(dt);

    const now = performance.now();
    if (this.renderPipeline) this.renderPipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.updateFps(now);
    this.raf = requestAnimationFrame(() => this.loop());
  }

  /// Updates the small FPS readout in the top-left corner twice a second.
  updateFps(now) {
    this.fpsFrames++;
    const elapsed = now - this.fpsLastSample;
    if (elapsed >= 500) {
      const fps = Math.round((this.fpsFrames * 1000) / elapsed);
      if (this.fpsEl) this.fpsEl.textContent = fps + " FPS";
      this.fpsFrames = 0;
      this.fpsLastSample = now;
    }
  }

  tick(dt) {
    let forward = 0;
    let right = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) right -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) right += 1;

    if (this.physicsReady) this.tickPhysics(dt, forward, right);

    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.aimSun();
    this.updateCityLights();
    this.updateGun(dt);
  }

  /// Drives the player capsule with Rapier and reads the camera position back.
  tickPhysics(dt, forward, right) {
    const body = this.playerBody;
    if (!body || !this.world) return;

    const len = Math.max(1, Math.hypot(forward, right));
    // Camera basis (looking down -Z, rotated by yaw about Y):
    //   forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const vx = (fx * (forward / len) + rx * (right / len)) * WALK_SPEED;
    const vz = (fz * (forward / len) + rz * (right / len)) * WALK_SPEED;
    const vel = body.linvel();
    body.setLinvel({ x: vx, y: vel.y, z: vz }, true);

    // A fixed step, run as many times as the frame was long — not one step of
    // however long the frame happened to be.
    //
    // A single step capped at 50 ms means the world advances at most 50 ms per
    // frame, so at ten frames a second it runs at half speed and at five frames
    // a second at a quarter. Stepping out of a window then takes several real
    // seconds to fall three metres: you hover down. The physics was never
    // wrong — it was being given a fraction of the time that had actually
    // passed.
    //
    // The cap on how many steps one frame may run is what stops the spiral: if
    // catching up costs more than the frame that fell behind, the next frame
    // falls further behind still. Past that point the world does run slow, and
    // slow is better than locked solid.
    this.physicsBacklog = Math.min((this.physicsBacklog || 0) + Math.max(0, dt), MAX_BACKLOG);
    let steps = 0;
    while (this.physicsBacklog >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
      this.world.timestep = PHYSICS_STEP;
      this.world.step();
      this.physicsBacklog -= PHYSICS_STEP;
      steps++;
    }
    if (steps === 0) {
      // A frame shorter than one step: nothing to do but keep the leftover.
      this.world.timestep = PHYSICS_STEP;
    }

    // Body sits at the feet; the camera (eyes) is at the capsule top.
    const room = store.room;
    const baseY = this.floorY();
    const p = body.translation();
    // The safety net, measured against the CITY rather than against the room.
    // It used to fire the moment the player left the room's own height band,
    // which is now an ordinary thing to do: step out of a ground-floor window
    // and the street is a kerb below you, and from an upper floor it is a long
    // way below. Being outside is not being lost — only leaving the world is.
    const cityFloor = this.city.groundY();
    const cityRoof = Math.max(baseY + room.height, cityFloor) + CITY_HEADROOM;
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
        p.y > cityRoof || p.y < cityFloor - 10) {
      // The body escaped the world somehow — teleport it back to the floor.
      const origin = P.roomOrigin(room);
      body.setTranslation({ x: origin.x + room.width / 2, y: baseY + 0.3, z: origin.z + Math.max(0.5, room.length - 0.6) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const q = body.translation();
      this.feetY = q.y - baseY;
      const hh = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
      this.position.set(q.x, q.y + (hh + PLAYER_RADIUS) * 2, q.z);
      this.onGround = false;
      this.camera.position.copy(this.position);
      return;
    }
    this.feetY = p.y - baseY;
    const halfH = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    const eyeHeight = (halfH + PLAYER_RADIUS) * 2;
    this.position.set(p.x, p.y + eyeHeight, p.z);

    this.onGround = this.isGrounded();
    if (this.onGround) this.jumpCount = 0;

    this.camera.position.copy(this.position);
  }

  /// Positions the 3D gun in front of the camera and settles its recoil.
  updateGun(dt) {
    if (!this.gun) return;
    this.gun.visible = this.paintballMode;
    if (!this.paintballMode) return;
    this.gunRecoil = Math.max(0, this.gunRecoil - dt * 6);
    const offset = _gunOffset.set(0.22, -0.18, -0.35 + this.gunRecoil * 0.07);
    offset.applyQuaternion(this.camera.quaternion);
    this.gun.position.copy(this.camera.position).add(offset);
    this.gun.quaternion.copy(this.camera.quaternion);
    if (this.gunRecoil > 0.001) {
      this.gun.rotateX(this.gunRecoil * 0.12);
    }
  }
}
