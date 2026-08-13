// walk3d.js — first-person 3D walkthrough for RoomCAD web (Three.js).

import * as THREE from "three";
import { RoomEnvironment } from "./lib/RoomEnvironment.js";
import * as RAPIER from "./lib/rapier.mjs";
import { EffectComposer } from "./lib/postprocessing/EffectComposer.js";
import { RenderPass } from "./lib/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./lib/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "./lib/postprocessing/SSAOPass.js";
import { OutputPass } from "./lib/postprocessing/OutputPass.js";
import * as P from "./plan.js";
import { store } from "./store.js";
import { playPlop } from "./audio.js";

// Material palette: light blue-gray walls, white ceiling, glass, and a white
// marble floor (procedural, below).
const WALL_COLOR = 0x6e88a0;
const CEILING_COLOR = 0xd9d9d5;
const GLASS_COLOR = 0x9fc8e0;
const LEAF_COLOR = 0x9a6f45;
const BACKGROUND = 0x141c2c;
const CITY_GROUND = 0x2b2d31;
const BULB_COLOR = 0xfff2cf;
const LIGHT_METAL = 0x33363c;

// Player capsule dimensions (metres).
const PLAYER_RADIUS = 0.20;
const STAND_HALF_HEIGHT = 0.55; // total standing height 1.5 m
const CROUCH_HALF_HEIGHT = 0.25; // total crouch height 0.9 m
const WALK_SPEED = 2.5;
const GRAVITY = 11;
const JUMP_SPEED = 3.8;
const MAX_POINT_LIGHTS = 6;
const FLOOR_HEIGHT = 3; // metres per building floor, for the outside view

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

// Eight distinct office-building facade palettes (ground-floor shops above).
const FACADE_STYLES = [
  { wall: "#45627a", frame: "#2c3e4d", glassTop: "#9fc4de", glassBot: "#2c3a46" }, // blue glass
  { wall: "#4a6e63", frame: "#2e4a42", glassTop: "#a8d8c4", glassBot: "#263a34" }, // green glass
  { wall: "#9a9aa2", frame: "#6e6e76", glassTop: "#bcd3e6", glassBot: "#33404c" }, // concrete
  { wall: "#8a5f45", frame: "#5f3f2e", glassTop: "#bcd3e6", glassBot: "#33404c" }, // brick
  { wall: "#b5a98e", frame: "#8a7f67", glassTop: "#cfe0ee", glassBot: "#3a4650" }, // stone
  { wall: "#2e3640", frame: "#1d2329", glassTop: "#6f8fa8", glassBot: "#101820" }, // dark glass
  { wall: "#d8d8dc", frame: "#a8a8b0", glassTop: "#a8c8e0", glassBot: "#3a4652" }, // white
  { wall: "#a06b4e", frame: "#6e4633", glassTop: "#c0d8e8", glassBot: "#36404a" }, // terracotta
];

export class Walk3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
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
    this.facades = FACADE_STYLES.map((s, i) => this.makeFacade(i, 0x2f6e2b1 + i * 1000003));
    this.cityGroundTexture = this.makeCityGroundTexture();
    this.reusableTextures = new Set([this.skyTexture, this.cityGroundTexture]);
    for (const f of this.facades) {
      this.reusableTextures.add(f.map);
      this.reusableTextures.add(f.emissiveMap);
    }
    this.pointLights = [];

    // Real-time sun: starts at 15:00 Singapore (3 pm) and advances with the
    // wall clock, so shadows shift if the 3D room is left open for hours.
    this.sunRefMs = Date.now();
    this.sunStartUtc = 15.0 - SG_UTC_OFFSET; // 07:00 UTC = 15:00 SGT
    this.sun = null;
    this.sunTarget = null;

    // Paintball easter egg
    this.paintballMode = false;
    this.paintballs = [];
    this.splats = [];
    this.raycaster = new THREE.Raycaster();
    this.gun = null;
    this.gunRecoil = 0;

    this.build(store.room, true);
    this.setupComposer();
    this.attachInput();
    this.observeSize();
    this.loop();
    this.initPhysics();

    store.onChange(() => {
      if (store.mode !== "3d" && this.paintballMode) {
        this.paintballMode = false;
        this.clearPaintball();
        this.updatePaintballUI();
      }
      // Realtime floor change: raise/lower the whole city outside.
      if (this.city) this.city.position.y = -(store.floor - 1) * FLOOR_HEIGHT;
    });
  }

  // MARK: Scene building

  build(room, resetCamera = false) {
    if (resetCamera) {
      this.position.set(room.width / 2, 1.5, Math.max(0.5, room.length - 0.6));
      this.yaw = 0;
      this.pitch = 0;
      this.crouching = false;
      this.onGround = true;
      this.feetY = 0;
      this.jumpCount = 0;
    }
    this.disposeScene();
    this.paintballs = [];
    this.splats = [];
    if (this.paintballMode) {
      this.paintballMode = false;
      this.updatePaintballUI();
    }
    const scene = this.scene;

    // Daytime sky and atmospheric depth beyond the windows.
    scene.background = new THREE.Color(0x8fb8e0);
    scene.fog = new THREE.Fog(0xcfe0f0, 40, 130);
    this.buildSky(room);

    // Daylight: a bright warm sun, soft sky bounce, image-based lighting for
    // realistic reflections, and real shadow mapping.
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a887e, 0.55));

    const sun = new THREE.DirectionalLight(0xfff2d9, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    const extent = Math.hypot(room.width, room.length) / 2 + 2;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    const sunTarget = new THREE.Object3D();
    sunTarget.position.set(room.width / 2, 0, room.length / 2);
    scene.add(sunTarget);
    sun.target = sunTarget;
    scene.add(sun);
    this.sun = sun;
    this.sunTarget = sunTarget;
    this.updateSun();

    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
    fill.position.set(-3, 4, room.length + 2);
    scene.add(fill);

    // Image-based lighting for PBR reflections.
    scene.environment = this.environment;

    // Floor: white marble tiles with thin grey grout lines.
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0, envMapIntensity: 0 });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(room.width, 0.06, room.length),
      this.floorMaterial
    );
    floor.position.set(room.width / 2, -0.03, room.length / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    this.loadFloorTexture(room);

    // Ceiling
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(room.width, 0.05, room.length),
      new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95 })
    );
    ceiling.position.set(room.width / 2, room.height, room.length / 2);
    ceiling.receiveShadow = true;
    scene.add(ceiling);

    // The virtual city beyond the windows.
    this.buildCity(room);

    // Walls with openings (windows are transparent so the city shows through).
    for (const wall of room.walls) {
      this.addWallPlan(wall, room.doors, room.windows, room.height);
    }

    // Furniture and ceiling fixtures.
    this.pointLights = [];
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

    this.buildGun();

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

  addWallPlan(wall, doors, windows, height) {
    const plan = P.wallBuildPlan(wall, doors, windows, height);
    const sill = Math.min(P.SILL_HEIGHT, height);
    const glassTop = Math.min(sill + P.GLASS_HEIGHT, height);
    const doorTop = Math.min(P.DOOR_HEIGHT, height);

    for (const span of plan.baseSpans) {
      this.addBox(wall, span, 0, sill, P.WALL_THICKNESS, WALL_COLOR);
    }
    for (const span of plan.midSpans) {
      this.addBox(wall, span, sill, doorTop, P.WALL_THICKNESS, WALL_COLOR);
    }
    for (const span of plan.glassSpans) {
      this.addGlass(wall, span, sill, glassTop, P.WALL_THICKNESS * 0.55);
    }
    for (const span of plan.stripSpans) {
      this.addBox(wall, span, glassTop, doorTop, P.WALL_THICKNESS, WALL_COLOR);
    }
    if (doorTop < height) {
      this.addBox(wall, plan.headerSpan, doorTop, height, P.WALL_THICKNESS, WALL_COLOR);
    }
    for (const door of doors.filter(d => d.wallID === wall.id)) {
      this.addDoorLeaf(wall, door, doorTop);
    }
  }

  /// The door leaf: closed (flush in the wall) or open (swung 90° to the
  /// inside or outside of the wall).
  addDoorLeaf(wall, door, doorTop) {
    const thickness = 0.04;
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

    const geometry = new THREE.BoxGeometry(thickness, doorTop, width);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: LEAF_COLOR, roughness: 0.7 }));
    mesh.userData.doorID = door.id;
    mesh.castShadow = true;
    mesh.position.set(centerX, doorTop / 2, centerZ);
    mesh.rotation.y = Math.atan2(leafX, leafZ);
    this.scene.add(mesh);
  }

  addBox(wall, span, h0, h1, thickness, color) {
    const h = h1 - h0;
    if (h <= 0.001 || span.to - span.from <= 0.001) return;
    const geometry = new THREE.BoxGeometry(thickness, h, span.to - span.from);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const center = P.wallPointAt(wall, (span.from + span.to) / 2);
    mesh.position.set(center.x, (h0 + h1) / 2, center.z);
    const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
    mesh.rotation.y = Math.PI / 2 - angle;
    this.scene.add(mesh);
  }

  /// A transparent window pane. It doesn't cast a shadow so daylight passes
  /// through, and the city beyond the window stays visible.
  addGlass(wall, span, h0, h1, thickness) {
    const h = h1 - h0;
    if (h <= 0.001 || span.to - span.from <= 0.001) return;
    const geometry = new THREE.BoxGeometry(thickness, h, span.to - span.from);
    const mesh = new THREE.Mesh(geometry, this.glassMaterial);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const center = P.wallPointAt(wall, (span.from + span.to) / 2);
    mesh.position.set(center.x, (h0 + h1) / 2, center.z);
    const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
    mesh.rotation.y = Math.PI / 2 - angle;
    this.scene.add(mesh);
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
    }

    group.position.set(item.center.x, 0, item.center.z);
    group.rotation.y = -item.rotationDegrees * Math.PI / 180;
    this.scene.add(group);
  }

  /// A 60 W classic bulb with a safety cage, mounted directly under the roof.
  addLightFixture(item, roomHeight, withPointLight) {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: LIGHT_METAL, metalness: 0.7, roughness: 0.35 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: BULB_COLOR,
      emissive: 0xffe6a0,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });

    const hang = 0.24;
    const cy = roomHeight - hang;

    // Ceiling canopy
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 20), metal);
    canopy.position.set(0, roomHeight - 0.015, 0);
    group.add(canopy);

    // Cord
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, hang - 0.02, 8), metal);
    cord.position.set(0, roomHeight - 0.015 - (hang - 0.02) / 2, 0);
    group.add(cord);

    // Classic round bulb (emissive so it glows under bloom).
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 18), bulbMat);
    bulb.position.set(0, cy, 0);
    group.add(bulb);

    // Safety cage: top/bottom rings plus four vertical bars.
    const cageRadius = 0.085;
    const wire = () => new THREE.CylinderGeometry(0.006, 0.006, 1, 6);
    const ring = y => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(cageRadius, 0.006, 8, 20), metal);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, y, 0);
      return m;
    };
    group.add(ring(cy + 0.05));
    group.add(ring(cy - 0.07));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const bar = new THREE.Mesh(wire(), metal);
      bar.position.set(Math.cos(a) * cageRadius, cy - 0.01, Math.sin(a) * cageRadius);
      group.add(bar);
    }

    group.traverse(node => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    bulb.castShadow = false;

    group.position.set(item.center.x, 0, item.center.z);
    this.scene.add(group);

    // A real point light (capped count for performance).
    if (withPointLight) {
      const pl = new THREE.PointLight(0xffe6b8, 40, 10, 2);
      pl.position.set(item.center.x, cy, item.center.z);
      this.scene.add(pl);
      this.pointLights.push(pl);
    }
  }

  disposeScene() {
    this.scene.traverse(node => {
      if (node.isMesh) {
        node.geometry.dispose();
        if (Array.isArray(node.material)) node.material.forEach(m => this.disposeMaterial(m));
        else this.disposeMaterial(node.material);
      }
    });
    this.scene.clear();
    this.floorMaterial = null;
  }

  disposeMaterial(material) {
    if (material === this.glassMaterial) return; // reused across rebuilds
    if (material.map && !this.reusableTextures.has(material.map)) material.map.dispose();
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

  /// A high-quality office facade (1024²): office windows above and a ground
  /// floor with a sign band, awning, storefront and entrance. Returns a colour
  /// map plus an emissive map for lit windows.
  makeFacade(style, seed) {
    const size = 1024;
    const s = FACADE_STYLES[style % FACADE_STYLES.length];
    let r = (seed || 1) >>> 0;
    const rnd = () => {
      r = (r * 1664525 + 1013904223) >>> 0;
      return r / 4294967296;
    };

    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = size;
    const cctx = colorCanvas.getContext("2d");
    const emissiveCanvas = document.createElement("canvas");
    emissiveCanvas.width = emissiveCanvas.height = size;
    const ectx = emissiveCanvas.getContext("2d");

    // Wall base.
    cctx.fillStyle = s.wall;
    cctx.fillRect(0, 0, size, size);
    ectx.fillStyle = "#000";
    ectx.fillRect(0, 0, size, size);

    const groundH = Math.floor(size * 0.15); // ground floor (shops/entrance)
    const officeBottom = size - groundH;

    // ── Office windows (upper part) ──
    const cols = 10;
    const officeRows = 9;
    const margin = 12;
    const gap = 9;
    const cw = (size - margin * 2 - gap * (cols - 1)) / cols;
    const ch = (officeBottom - margin - gap * (officeRows - 1)) / officeRows;
    for (let row = 0; row < officeRows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = margin + col * (cw + gap);
        const y = margin + row * (ch + gap);
        const lit = rnd() < 0.2;
        const g = cctx.createLinearGradient(x, y, x, y + ch);
        if (lit) {
          g.addColorStop(0, "#fff3cc");
          g.addColorStop(1, "#ffd98a");
          ectx.fillStyle = "#ffd080";
          ectx.fillRect(x, y, cw, ch);
        } else {
          g.addColorStop(0, s.glassTop);
          g.addColorStop(1, s.glassBot);
        }
        cctx.fillStyle = g;
        cctx.fillRect(x, y, cw, ch);
        cctx.strokeStyle = s.frame;
        cctx.lineWidth = 2;
        cctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      }
    }

    // ── Ground floor: sign band, awning, storefront + entrance ──
    const gy = officeBottom;
    const signH = Math.floor(groundH * 0.2);
    const awningH = Math.floor(groundH * 0.16);
    const sfY = gy + signH + awningH;
    const sfH = size - sfY;

    // Sign band (a random shop name on a colourful strip).
    cctx.fillStyle = `hsl(${Math.floor(rnd() * 360)}, 52%, 46%)`;
    cctx.fillRect(0, gy, size, signH);
    const signText = ["CAFÉ", "MARKET", "SHOP", "OFFICES", "STORE", "BANK", "DELI", "CLINIC"][Math.floor(rnd() * 8)];
    cctx.fillStyle = "rgba(255,255,255,0.9)";
    cctx.font = `bold ${Math.floor(signH * 0.62)}px sans-serif`;
    cctx.textAlign = "center";
    cctx.textBaseline = "middle";
    cctx.fillText(signText, size / 2, gy + signH / 2);

    // Awning (striped).
    for (let i = 0; i < size; i += 22) {
      cctx.fillStyle = (i / 22) % 2 === 0 ? "#efe8df" : s.frame;
      cctx.fillRect(i, gy + signH, 22, awningH);
    }

    // Storefront glass (large panes) with a central entrance door.
    cctx.fillStyle = "#26333e";
    cctx.fillRect(0, sfY, size, sfH);
    const panes = 6;
    const paneW = size / panes;
    for (let p = 0; p < panes; p++) {
      const px = p * paneW;
      const g2 = cctx.createLinearGradient(px, sfY, px, sfY + sfH);
      g2.addColorStop(0, "#56728a");
      g2.addColorStop(1, "#1d2831");
      cctx.fillStyle = g2;
      cctx.fillRect(px, sfY, paneW, sfH);
      cctx.strokeStyle = s.frame;
      cctx.lineWidth = 3;
      cctx.strokeRect(px + 2, sfY + 2, paneW - 4, sfH - 4);
    }
    // Entrance door (recessed, darker) in the middle.
    const doorW = size * 0.14;
    const doorX = size / 2 - doorW / 2;
    cctx.fillStyle = "#141b22";
    cctx.fillRect(doorX, sfY, doorW, sfH);
    cctx.strokeStyle = "#9aa2aa";
    cctx.lineWidth = 3;
    cctx.strokeRect(doorX + 4, sfY + 4, doorW - 8, sfH - 8);
    // Door handle.
    cctx.fillStyle = "#d4d8dd";
    cctx.fillRect(doorX + doorW - 16, sfY + sfH / 2 - 8, 5, 16);

    const map = new THREE.CanvasTexture(colorCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    emissiveMap.anisotropy = 8;
    return { map, emissiveMap };
  }

  /// A realistic 4K street network: roads with lane markings, sidewalks with
  /// kerbs, crosswalks and pedestrian walk paths between the blocks.
  makeCityGroundTexture() {
    const size = 4096;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Asphalt base with fine noise and slight tone variation.
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 22000; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
    }

    const block = 512;      // city block pitch (px)
    const road = 160;       // road width (two lanes)
    const sidewalk = 26;    // sidewalk width
    const kerb = 4;         // kerb line

    // Sidewalk slabs (light concrete) fill the blocks; roads are cut over them.
    ctx.fillStyle = "#5a5d64";
    ctx.fillRect(0, 0, size, size);

    // Road surface (asphalt) over the sidewalk fill.
    ctx.fillStyle = "#363940";
    for (let i = 0; i <= size; i += block) {
      ctx.fillRect(i - road / 2, 0, road, size);
      ctx.fillRect(0, i - road / 2, size, road);
    }

    // Kerbs: a thin light line on each road edge.
    ctx.strokeStyle = "#70737b";
    ctx.lineWidth = kerb;
    for (let i = 0; i <= size; i += block) {
      ctx.beginPath();
      ctx.moveTo(i - road / 2 - sidewalk, 0); ctx.lineTo(i - road / 2 - sidewalk, size);
      ctx.moveTo(i + road / 2 + sidewalk, 0); ctx.lineTo(i + road / 2 + sidewalk, size);
      ctx.moveTo(0, i - road / 2 - sidewalk); ctx.lineTo(size, i - road / 2 - sidewalk);
      ctx.moveTo(0, i + road / 2 + sidewalk); ctx.lineTo(size, i + road / 2 + sidewalk);
      ctx.stroke();
    }

    // Lane markings: dashed centre line + solid edge lines.
    ctx.strokeStyle = "#c8ccd2";
    ctx.lineWidth = 5;
    ctx.setLineDash([36, 30]);
    for (let i = 0; i <= size; i += block) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, size);
      ctx.moveTo(0, i); ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    for (let i = 0; i <= size; i += block) {
      ctx.beginPath();
      ctx.moveTo(i - road / 2 + 10, 0); ctx.lineTo(i - road / 2 + 10, size);
      ctx.moveTo(i + road / 2 - 10, 0); ctx.lineTo(i + road / 2 - 10, size);
      ctx.moveTo(0, i - road / 2 + 10); ctx.lineTo(size, i - road / 2 + 10);
      ctx.moveTo(0, i + road / 2 - 10); ctx.lineTo(size, i + road / 2 - 10);
      ctx.stroke();
    }

    // Crosswalks (zebra stripes) at every intersection.
    ctx.fillStyle = "#c6cad0";
    for (let i = block; i < size; i += block) {
      for (let j = block; j < size; j += block) {
        const half = road / 2 - 16;
        for (let k = 0; k < 9; k++) {
          ctx.fillRect(i - half + 4, j - road / 2 + 8 + k * 14, road - 40, 7);
          ctx.fillRect(i - road / 2 + 8 + k * 14, j - half + 4, 7, road - 40);
        }
      }
    }

    // Stop lines at intersections.
    ctx.fillStyle = "#e8eaee";
    for (let i = block; i < size; i += block) {
      for (let j = block; j < size; j += block) {
        ctx.fillRect(i - road / 2 + 20, j - road / 2 - 24, road - 40, 8);
        ctx.fillRect(i - road / 2 + 20, j + road / 2 + 16, road - 40, 8);
        ctx.fillRect(i - road / 2 - 24, j - road / 2 + 20, 8, road - 40);
        ctx.fillRect(i + road / 2 + 16, j - road / 2 + 20, 8, road - 40);
      }
    }

    // Pedestrian walk paths through the middle of each block.
    ctx.strokeStyle = "#7c8088";
    ctx.lineWidth = 22;
    ctx.setLineDash([28, 20]);
    for (let i = block / 2; i < size; i += block) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, size);
      ctx.moveTo(0, i); ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
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
    sky.position.set(room.width / 2, 0, room.length / 2);
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  /// Sun direction as a unit vector (North = -Z, azimuth clockwise from North,
  /// matching the 2D editor where the top of the plan is North 0°).
  sunDirection(date) {
    const { altitude, azimuth } = sunAltitudeAzimuth(date);
    const alt = Math.max(altitude, 0.05); // keep it just above the horizon at night
    return new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(alt),  // East  (+X)
      Math.sin(alt),                       // up    (+Y)
      -Math.cos(azimuth) * Math.cos(alt)   // North (-Z)
    );
  }

  /// Positions the sun for the virtual Singapore clock and updates its
  /// intensity as it nears the horizon. Called every frame in the loop.
  updateSun() {
    if (!this.sun || !this.sunTarget) return;
    const now = Date.now();
    const elapsedHours = (now - this.sunRefMs) / 3600000;
    const virtualUtcHours = this.sunStartUtc + elapsedHours;
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + Math.floor(virtualUtcHours / 24));
    const hh = ((virtualUtcHours % 24) + 24) % 24;
    date.setUTCHours(Math.floor(hh), Math.floor((hh % 1) * 60), 0, 0);

    const dir = this.sunDirection(date);
    const room = store.room;
    const cx = room.width / 2;
    const cz = room.length / 2;
    const dist = 40;
    this.sun.position.set(cx + dir.x * dist, dir.y * dist, cz + dir.z * dist);
    this.sunTarget.position.set(cx, 0, cz);
    this.sunTarget.updateMatrixWorld();

    // Fade the sun down toward dusk so the scene never goes fully black.
    const altDeg = Math.asin(Math.max(-0.1, Math.min(1, dir.y))) * 180 / Math.PI;
    this.sun.intensity = 2.8 * Math.max(0.2, Math.min(1, altDeg / 12));
  }

  /// A procedural virtual city (roads + lit buildings) surrounding the room.
  buildCity(room) {
    const group = new THREE.Group();
    group.name = "city";
    const cx = room.width / 2;
    const cz = room.length / 2;
    const extent = 90;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(extent * 2, extent * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: this.cityGroundTexture })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.05, cz);
    ground.receiveShadow = true;
    group.add(ground);

    // One InstancedMesh per facade style (a single draw call each).
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const facadeMaterials = this.facades.map((f, i) => {
      const glass = i === 0 || i === 1 || i === 5; // glass-tower styles
      return new THREE.MeshStandardMaterial({
        map: f.map,
        roughness: glass ? 0.25 : 0.75,
        metalness: glass ? 0.4 : 0.05,
        emissive: 0xffffff,
        emissiveMap: f.emissiveMap,
        emissiveIntensity: 0.9,
      });
    });

    // Downtown: a taller cluster near the centre, mid-rise around the edges.
    const buckets = this.facades.map(() => []);
    const block = 14;
    const roomHalfW = room.width / 2 + 5;
    const roomHalfL = room.length / 2 + 5;
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let x = cx - extent + block; x <= cx + extent - block; x += block) {
      for (let z = cz - extent + block; z <= cz + extent - block; z += block) {
        const px = x + (rnd() - 0.5) * block * 0.4;
        const pz = z + (rnd() - 0.5) * block * 0.4;
        const halfW = 3.5 + rnd() * 3.5;
        const halfD = 3.5 + rnd() * 3.5;
        if (px - halfW < cx + roomHalfW && px + halfW > cx - roomHalfW &&
            pz - halfD < cz + roomHalfL && pz + halfD > cz - roomHalfL) continue;
        const dist = Math.hypot(px - cx, pz - cz);
        const tower = rnd() < 0.18 && dist < 40;
        const height = tower
          ? 55 + rnd() * 45
          : 14 + rnd() * (dist < 40 ? 30 : 18);
        const style = Math.floor(rnd() * this.facades.length);
        const tint = 0.82 + rnd() * 0.36; // per-building brightness variation
        buckets[style].push({ px, pz, halfW, halfD, height, tint });
      }
    }

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const tintColor = new THREE.Color();
    buckets.forEach((list, i) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(buildingGeometry, facadeMaterials[i], list.length);
      list.forEach((b, k) => {
        pos.set(b.px, b.height / 2, b.pz);
        scl.set(b.halfW * 2, b.height, b.halfD * 2);
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(k, matrix);
        tintColor.setRGB(b.tint, b.tint, b.tint);
        mesh.setColorAt(k, tintColor);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });

    group.position.y = -(store.floor - 1) * FLOOR_HEIGHT;
    this.scene.add(group);
    this.city = group;
  }

  // MARK: Post-processing (bloom)

  setupComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Contact shadows: screen-space ambient occlusion darkens where objects
    // meet the floor and walls (soft, localised, "as good as it gets").
    this.ssaoPass = new SSAOPass(this.scene, this.camera, this.container.clientWidth, this.container.clientHeight, 32);
    this.ssaoPass.kernelRadius = 10;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.4;
    this.composer.addPass(this.ssaoPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
      0.55, // strength
      0.5,  // radius
      0.85  // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  // MARK: Rapier physics

  async initPhysics() {
    await RAPIER.init();
    this.physicsReady = true;
    this.buildPhysics(store.room, true);
  }

  buildPhysics(room, resetPlayer = false) {
    if (!this.physicsReady) return;
    // Rebuild the world from scratch so static colliders never accumulate
    // across room changes (which used to wedge the player after a few edits).
    if (this.world) this.world.free();
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.playerBody = null;
    this.playerCollider = null;
    this.physicsBodies = [];

    // Floor.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(room.width / 2, 0.03, room.length / 2)
        .setTranslation(room.width / 2, -0.03, room.length / 2)
    );

    // Ceiling (stops the player jumping through the roof).
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(room.width / 2, 0.05, room.length / 2)
        .setTranslation(room.width / 2, room.height + 0.025, room.length / 2)
    );

    // Walls, split by open doorways so you can walk through them.
    for (const seg of P.wallCollisionSegments(room)) {
      const len = Math.hypot(seg.end.x - seg.start.x, seg.end.z - seg.start.z);
      if (len < 0.01) continue;
      const midX = (seg.start.x + seg.end.x) / 2;
      const midZ = (seg.start.z + seg.end.z) / 2;
      const h = room.height;
      const t = P.WALL_THICKNESS;
      const horizontal = Math.abs(seg.end.z - seg.start.z) < 0.001;
      const desc = horizontal
        ? RAPIER.ColliderDesc.cuboid(len / 2, h / 2, t / 2)
        : RAPIER.ColliderDesc.cuboid(t / 2, h / 2, len / 2);
      desc.setTranslation(midX, h / 2, midZ);
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
      const desc = horizontal
        ? RAPIER.ColliderDesc.cuboid(len / 2, doorTop / 2, 0.03)
        : RAPIER.ColliderDesc.cuboid(0.03, doorTop / 2, len / 2);
      desc.setTranslation(midX, doorTop / 2, midZ);
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
      desc.setTranslation(midX, doorTop + headerH / 2, midZ);
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
          .setTranslation(f.minX + w / 2, stand / 2, f.minZ + d / 2)
      );
    }

    // Player capsule: the body sits at the feet; the capsule rises from it.
    const spawnX = resetPlayer ? room.width / 2 : P.clamp(this.position.x, 0.3, room.width - 0.3);
    const spawnZ = resetPlayer ? Math.max(0.5, room.length - 0.6) : P.clamp(this.position.z, 0.3, room.length - 0.3);
    const spawnY = resetPlayer ? 0.2 : Math.max(0.2, this.feetY);
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
  loadFloorTexture(room) {
    this.applyFloorCanvas(this.makeFloorCanvas(room));
  }

  applyFloorCanvas(canvas) {
    if (!this.floorMaterial) return;
    if (this.floorMaterial.map) this.floorMaterial.map.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.floorMaterial.map = texture;
    this.floorMaterial.needsUpdate = true;
  }

  makeFloorCanvas(room) {
    const layout = P.tileLayout(room);
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
    const canvas = this.renderer.domElement;
    canvas.style.cursor = "crosshair";
    this.toggleWasLocked = false;

    // Left click toggles free-look — unless paintball mode is on, in which
    // case it fires the gun. Track whether the pointer was already locked on
    // mouse-down, so the click that *starts* looking doesn't also end it.
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("mousedown", e => {
      // Right click opens/closes the door you're aiming at.
      if (e.button === 2) {
        this.toggleDoorAtCrosshair();
        e.preventDefault();
        return;
      }
      this.toggleWasLocked = this.locked;
    });
    canvas.addEventListener("click", () => {
      if (this.paintballMode) {
        if (this.locked) this.shoot();
        else canvas.requestPointerLock();
      } else if (this.toggleWasLocked) {
        if (this.locked) document.exitPointerLock();
      } else {
        canvas.requestPointerLock();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.paintballMode) {
        this.paintballMode = false;
        this.clearPaintball();
      }
      this.updatePaintballUI();
    });
    document.addEventListener("mousemove", e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = P.clamp(this.pitch - e.movementY * 0.0025, -1.4, 1.4);
    });

    document.addEventListener("keydown", e => {
      if (store.mode !== "3d") return;
      if (this.isTyping()) return;
      if (e.code === "KeyP") {
        this.togglePaintball();
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
    document.addEventListener("keyup", e => {
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());
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
  }

  updatePaintballUI() {
    const ui = document.getElementById("paintball-ui");
    if (ui) ui.hidden = !this.paintballMode;
    const hint = document.getElementById("walk-hint");
    if (hint) {
      hint.textContent = this.paintballMode
        ? "Paintball! Click to shoot · P or Esc to stop"
        : (this.locked
            ? "Free look on · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch · right-click: door swing"
            : "Click to look · click again to stop · WASD / arrows walk · Space jump (×2 double) · C crouch · right-click: door swing");
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
    const hit = hits.length > 0 ? hits[0] : null;
    const range = 60;
    const to = hit
      ? hit.point.clone()
      : origin.clone().add(direction.clone().multiplyScalar(range));
    const from = origin.clone().add(direction.clone().multiplyScalar(0.35));
    this.spawnPaintball(from, to, hit);
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

  spawnPaintball(from, to, hit) {
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
      ball.mesh.position.lerpVectors(ball.from, ball.to, t);
      // A little arc so the shot has some life.
      ball.mesh.position.y += Math.sin(Math.PI * t) * 0.06;
      if (t >= 1) {
        this.scene.remove(ball.mesh);
        ball.mesh.geometry.dispose();
        ball.mesh.material.dispose();
        if (ball.hit) this.placeSplat(ball.hit);
        this.paintballs.splice(i, 1);
      }
    }
  }

  placeSplat(hit) {
    const radius = 0.05 + Math.random() * 0.04;
    const geometry = new THREE.CircleGeometry(radius, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x2ecc40 });
    const splat = new THREE.Mesh(geometry, material);
    splat.userData.splat = true;

    const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    if (hit.object) normal.transformDirection(hit.object.matrixWorld);
    splat.position.copy(hit.point).add(normal.clone().multiplyScalar(0.006));
    splat.lookAt(hit.point.clone().add(normal));
    splat.rotateZ(Math.random() * Math.PI * 2);

    this.scene.add(splat);
    this.splats.push(splat);
    if (this.splats.length > 250) {
      const old = this.splats.shift();
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
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
      if (this.composer) this.composer.setSize(rect.width, rect.height);
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
    this.disposeScene();
    if (this.world) this.world.free();
    if (this.composer && this.composer.dispose) this.composer.dispose();
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
    this.updateSun();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.loop());
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

    this.world.timestep = Math.max(0, Math.min(dt, 0.05));
    this.world.step();

    // Body sits at the feet; the camera (eyes) is at the capsule top.
    const room = store.room;
    const p = body.translation();
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
        p.y > room.height + 3 || p.y < -10) {
      // The body escaped the room somehow — teleport it back to the floor.
      body.setTranslation({ x: room.width / 2, y: 0.3, z: Math.max(0.5, room.length - 0.6) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const q = body.translation();
      this.feetY = q.y;
      const hh = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
      this.position.set(q.x, q.y + (hh + PLAYER_RADIUS) * 2, q.z);
      this.onGround = false;
      this.camera.position.copy(this.position);
      return;
    }
    this.feetY = p.y;
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
    const offset = new THREE.Vector3(0.22, -0.18, -0.35 + this.gunRecoil * 0.07);
    offset.applyQuaternion(this.camera.quaternion);
    this.gun.position.copy(this.camera.position).add(offset);
    this.gun.quaternion.copy(this.camera.quaternion);
    if (this.gunRecoil > 0.001) {
      this.gun.rotateX(this.gunRecoil * 0.12);
    }
  }
}
