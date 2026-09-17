// Walk3D: scene building, part 3.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import {
  BULB_COLOR,
  GLASS_COLOR,
  LIGHT_METAL,
  MAX_ROOM_LIGHTS,
  POINT_SHADOW_BIAS,
  POINT_SHADOW_MAP_SIZE,
  ROOM_ONLY_LAYER,
} from "./constants.js";
import { clamp01 } from "./sun.js";

export const scene_building_3 = {

  /// A ceiling-mounted light: a bare 60 W bulb on a cord, or a 200 W
  /// 60×60 cm office panel. Both are emissive and (when enabled) cast a point
  /// light; `applyTimeOfDay` decides whether that light is actually used.
  addLightFixture(item, roomHeight) {
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

    // Where this fixture is and what its light would be. The light itself comes
    // from the room's own pool (buildRoomLightPool), so that a plan holding more
    // fixtures than the renderer will light is not served in arbitrary plan
    // order.
    this.roomLightSlots.push({
      x: item.center.x, y: lightY, z: item.center.z,
      color: pointColor, intensity: pointIntensity, distance: pointDistance,
    });
  },

  /// Builds the room's pool of fixture lights: fixed size, one per fixture up to
  /// the cap, all of them casting shadows.
  ///
  /// Sized to the plan, so a room with one bulb pays for one — a fixed pool of
  /// sixteen would make every small room cost sixteen cube maps. The count is
  /// fixed for the life of the pool (until the next rebuild), because turning a
  /// shadow-casting light on and off reallocates its map and recompiles, which
  /// is the stutter the city's pool exists to avoid too.
  buildRoomLightPool() {
    this.pointLights = [];
    const count = Math.min(this.roomLightSlots.length, MAX_ROOM_LIGHTS);
    for (let i = 0; i < count; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 1, 2);
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
      // The room, and nothing else. A lamp on a ceiling cannot see the street
      // and has no business rendering it six times a frame.
      pl.shadow.camera.layers.set(ROOM_ONLY_LAYER);
      this.roomGroup.add(pl);
      this.pointLights.push(pl);
    }
    this.roomLightsAssigned = -1;
    this.updateRoomLights();
  },

  /// Points the pool at the fixtures nearest the viewer.
  ///
  /// This pool used to be dealt out in plan order at build time — the first
  /// sixteen fixtures won, and the seventeenth was dead for the life of the
  /// room no matter where you stood. Nearest-first means the lights you can see
  /// are the ones that work, and it is how the street lamps are pooled as well.
  ///
  /// A pool at least as large as the fixture list needs no choosing, and is
  /// assigned once. More fixtures than lights means a sort per frame, over the
  /// fixtures in one room — a handful, not the city's six hundred and eighty.
  updateRoomLights() {
    const pool = this.pointLights;
    if (!pool || !pool.length) return;
    const slots = this.roomLightSlots;

    if (slots.length <= pool.length) {
      if (this.roomLightsAssigned === slots.length) return;
      for (let i = 0; i < pool.length; i++) this.assignRoomLight(pool[i], slots[i]);
      this.roomLightsAssigned = slots.length;
      return;
    }

    const cam = this.camera.position;
    const order = slots.map((s, i) => i);
    order.sort((a, b) => {
      const da = (slots[a].x - cam.x) ** 2 + (slots[a].z - cam.z) ** 2;
      const db = (slots[b].x - cam.x) ** 2 + (slots[b].z - cam.z) ** 2;
      return da - db;
    });
    for (let i = 0; i < pool.length; i++) this.assignRoomLight(pool[i], slots[order[i]]);
    this.roomLightsAssigned = pool.length;
  },

  /// Moves one pool light onto one fixture, or switches it off when there is no
  /// fixture to hold it.
  assignRoomLight(light, slot) {
    if (!slot) {
      light.visible = false;
      light.intensity = 0;
      light.distance = 1;
      if (light.shadow) light.shadow.camera.far = 1;
      return;
    }
    light.position.set(slot.x, slot.y, slot.z);
    light.color.setHex(slot.color);
    light.intensity = slot.intensity;
    light.distance = slot.distance;
    if (light.shadow) light.shadow.camera.far = slot.distance;
  },

  /// How the room's fixtures are lit, for the inspector to report.
  ///
  /// { fixtures, lit } — `lit` is below `fixtures` only when the plan holds more
  /// ceiling lights than the renderer will light, which the user is told about
  /// rather than left to discover as a lamp that does nothing.
  roomLightReport() {
    return { fixtures: this.roomLightSlots.length, lit: this.pointLights.length };
  },

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
      // Lights are not meshes and clear() does not free them. A shadow-casting
      // point light owns a 1024² cube map, the sun a single 4096² one and a
      // shadow-casting street lamp its own, and three.js only releases a map
      // when its light's shadow is disposed. build() runs on every room edit,
      // so clearing the scene dropped those render targets on the floor with
      // the lights that owned them and leaked the GPU memory.
      if (node.isLight) this.disposeLight(node);
    });
    this.scene.clear();
    for (const node of persistent) this.scene.add(node);
    this.floorMaterial = null;
  },

  /// Releases one light's shadow map. The light itself holds no other GPU
  /// resource, and the city's persistent subtrees never come through here.
  disposeLight(light) {
    if (light.shadow && typeof light.shadow.dispose === "function") light.shadow.dispose();
    if (typeof light.dispose === "function") light.dispose();
  },

  /// Builds or reuses the surrounding city for this room and floor. The city
  /// only depends on the building envelope, so ordinary editing never
  /// regenerates it.
  syncCity(room) {
    const bounds = this.currentBuildingBounds || this.buildingBounds(room);
    const seed = seedFromString(String(room.id || room.name || "roomcad"));
    const lift = this.floorY();
    if (!this.city.matches(bounds, seed, lift)) this.city.build(bounds, seed, lift);
    if (this.city.group.parent !== this.scene) this.scene.add(this.city.group);
  },

  disposeMaterial(material) {
    if (material === this.glassMaterial) return; // reused across rebuilds
    if (material.map && !this.reusableTextures.has(material.map)) material.map.dispose();
    if (material.emissiveMap && !this.reusableTextures.has(material.emissiveMap)) material.emissiveMap.dispose();
    material.dispose();
  },

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
  },

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
  },

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
  },

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
  },

  /// Drifts the cloud decks. Called from the render loop.
  updateClouds(dt) {
    if (!this.cloudLayers) return;
    for (const layer of this.cloudLayers) {
      layer.map.offset.x += layer.dx * dt;
      layer.map.offset.y += layer.dy * dt;
    }
  }
};
