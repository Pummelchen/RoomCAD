// Walk3D: scene building.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as RAPIER from "../lib/rapier.mjs";
import { City } from "../city.js";
import * as P from "../plan.js";
import { store } from "../store.js";
import {
  CEILING_COLOR,
  DAY_BACKGROUND,
  DAY_FOG,
  FLOOR_HEIGHT,
  FOG_FAR,
  FOG_NEAR,
  NIGHT_BACKGROUND,
  NIGHT_FOG,
  ROOM_ONLY_LAYER,
  SUN_HEIGHT,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_MAP,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_REACH,
} from "./constants.js";

export const scene_building = {

  /// The room's lift above the ground floor (one floor = FLOOR_HEIGHT m).
  floorY() {
    return (store.floor - 1) * FLOOR_HEIGHT;
  },

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
  },

  /// How far the city reaches from its own centre.
  ///
  /// The sky dome has to be bigger than this, or the player walks out from
  /// under it and sees its back faces from the wrong side. The arithmetic
  /// belongs to city.js — it is the same grid it lays out — so it is asked for
  /// there rather than repeated here, where it drifted out of step once already.
  cityReach(bounds) {
    return City.reachFor(bounds);
  },

  /// WebGPU + Rapier are async; build the scene and start once both are ready.
  async start() {
    try {
      if (!navigator.gpu) {
        this.show3dError("WebGPU is not supported in this browser — use a recent Chrome, Edge, or Safari 18+.");
        return;
      }
      await Promise.race([
        this.renderer.init(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("WebGPU init timed out")), 20000);
        }),
      ]);
      await RAPIER.init();
      this.physicsReady = true;

      // Image-based lighting (needs an initialised renderer).
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const roomEnvironment = new RoomEnvironment();
      this.environment = pmrem.fromScene(roomEnvironment, 0.04).texture;
      pmrem.dispose();
      // fromScene() renders the environment into the PMREM synchronously and
      // keeps nothing but the texture it returned, so the room scene — and the
      // geometry and materials it built — is dead weight from here. Release it
      // now; nothing holds it for the page's lifetime any more.
      roomEnvironment.dispose();

      this.build(store.room, true);
      this.setupPostProcessing();
      // Only now is a frame worth running: the room was built against a real
      // environment and the pipeline exists. update() refuses to build before
      // this, so the store emit that arrives while the renderer is still
      // initialising can no longer build the room a second time, without the
      // environment, only for this line to discard it and build again.
      this.ready = true;
      this.startFrames();
    } catch (err) {
      console.error("RoomCAD 3D init failed:", err);
      this.show3dError("3D failed to start: " + (err && err.message ? err.message : err));
    }
  },

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
  },

  // MARK: Scene building

  build(room, resetCamera = false) {
    // Nothing to build with yet. The image-based environment is created inside
    // start(), and it is what lights every PBR material in the room; a build
    // before it exists is not merely dim, it is a whole room — geometry,
    // materials and the city's twelve pool lights — that start() would then
    // throw away and build again without a frame of it ever being drawn. The
    // store emits synchronously while start() is still awaiting WebGPU, which
    // is exactly how that happened. start() builds store.room, so skipping here
    // loses nothing.
    if (!this.environment) return;
    // The scene now holds this room. Recorded here rather than in update(),
    // because start() builds without going through update(), and the next
    // store emit must not decide the room is unbuilt and build it again.
    this.lastRoomKey = JSON.stringify(room);
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
    this.roomLightSlots = [];
    for (const item of room.furniture) {
      const kind = P.FURNITURE_KINDS[item.kind];
      // sanitize() drops an unknown kind on load, so this only matters for a
      // room assembled in memory — and it must not throw.
      if (!kind) continue;
      if (kind.category === "fixture") {
        this.addLightFixture(item, room.height);
      } else {
        this.addFurniture(item);
      }
    }
    // One pool for the whole room, sized to the plan and capped. Built after
    // the fixtures, because it is their positions it is handing lights to.
    this.buildRoomLightPool();

    // Everything the room is made of goes on the room-only layer as well as
    // the default one, so the point lights' shadow cameras can be pointed at
    // it and see the room without seeing the city.
    this.roomGroup.traverse(node => node.layers.enable(ROOM_ONLY_LAYER));

    this.buildGun();
    this.syncCity(room);
    this.roomGroup.position.y = this.floorY();
    this.lastFloorY = this.floorY();
    // The scene is new — a fresh sun, sky and cloud decks, and possibly a
    // freshly built city — so nothing the previous applyTimeOfDay() set
    // survives in it. Forget what it was last applied for, or its own
    // no-change guard would skip lighting the room it is now standing in.
    this.invalidateTimeOfDay();
    this.applyTimeOfDay();

    // Refresh the physics colliders for the new room layout.
    if (this.physicsReady) this.buildPhysics(room, resetCamera);
  }
};
