// CityGenerator.js — a self-contained procedural downtown city for RoomCAD.
//
// Generates a modern glass-tower skyline around the buildable canvas: a
// tiled street grid plus instanced office buildings, all confined to a fixed
// radius (default 200 m) so the outside world stays bounded and cheap. The
// returned group is purely visual — no physics colliders are created here,
// which keeps the Rapier simulation limited to the room canvas.

import * as THREE from "three";

// Six downtown facade palettes (mostly glass towers).
const STYLES = [
  { wall: "#3f5c74", frame: "#26384a", glassTop: "#a9cfe8", glassBot: "#1e2f3c" }, // blue glass
  { wall: "#2a3642", frame: "#141c24", glassTop: "#8fb6d4", glassBot: "#0d1620" }, // dark tower
  { wall: "#8a939c", frame: "#5c626a", glassTop: "#c6dcea", glassBot: "#2c3a48" }, // concrete
  { wall: "#5c7a6e", frame: "#354c44", glassTop: "#bce0d2", glassBot: "#1f322b" }, // green glass
  { wall: "#b0a58e", frame: "#7c7462", glassTop: "#d4e6f2", glassBot: "#33424e" }, // stone
  { wall: "#1f2730", frame: "#10161c", glassTop: "#5f8fae", glassBot: "#0a1018" }, // charcoal glass
];

const FACADE_SIZE = 1024;

export class CityGenerator {
  constructor() {
    this.facades = STYLES.map((s, i) => this.makeFacade(s, i));
    this.groundTexture = this.makeGroundTexture();
  }

  /// One tiled city block: sidewalks fill the tile, roads cross through the
  /// middle so that repeating the tile forms a full street grid.
  makeGroundTexture() {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Sidewalk / block base.
    ctx.fillStyle = "#5a5d64";
    ctx.fillRect(0, 0, size, size);

    // Asphalt roads across the centre (vertical + horizontal).
    const road = 96;
    ctx.fillStyle = "#363940";
    ctx.fillRect(size / 2 - road / 2, 0, road, size);
    ctx.fillRect(0, size / 2 - road / 2, size, road);

    // Kerbs.
    ctx.strokeStyle = "#70737b";
    ctx.lineWidth = 3;
    const k = size / 2 - road / 2 - 10;
    ctx.strokeRect(k, k, size - k * 2, size - k * 2);

    // Centre dashed lane lines.
    ctx.strokeStyle = "#c8ccd2";
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /// A modern office facade with lit windows and a ground-floor storefront.
  makeFacade(style, seed) {
    const s = STYLES[style % STYLES.length];
    let r = (seed * 1664525 + 1013904223) >>> 0;
    const rnd = () => {
      r = (r * 1664525 + 1013904223) >>> 0;
      return r / 4294967296;
    };

    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = FACADE_SIZE;
    const cctx = colorCanvas.getContext("2d");
    const emissiveCanvas = document.createElement("canvas");
    emissiveCanvas.width = emissiveCanvas.height = FACADE_SIZE;
    const ectx = emissiveCanvas.getContext("2d");

    cctx.fillStyle = s.wall;
    cctx.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);
    ectx.fillStyle = "#000";
    ectx.fillRect(0, 0, FACADE_SIZE, FACADE_SIZE);

    const groundH = Math.floor(FACADE_SIZE * 0.12);
    const officeBottom = FACADE_SIZE - groundH;
    const cols = 8;
    const rows = 10;
    const margin = 12;
    const gap = 8;
    const cw = (FACADE_SIZE - margin * 2 - gap * (cols - 1)) / cols;
    const ch = (officeBottom - margin - gap * (rows - 1)) / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = margin + col * (cw + gap);
        const y = margin + row * (ch + gap);
        const lit = rnd() < 0.24;
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

    // Ground-floor storefront band.
    const gy = officeBottom;
    cctx.fillStyle = "#26333e";
    cctx.fillRect(0, gy, FACADE_SIZE, groundH);
    const panes = 6;
    const paneW = FACADE_SIZE / panes;
    for (let p = 0; p < panes; p++) {
      const px = p * paneW;
      const g2 = cctx.createLinearGradient(px, gy, px, gy + groundH);
      g2.addColorStop(0, "#56728a");
      g2.addColorStop(1, "#1d2831");
      cctx.fillStyle = g2;
      cctx.fillRect(px + 4, gy + 4, paneW - 8, groundH - 8);
      cctx.strokeStyle = s.frame;
      cctx.lineWidth = 3;
      cctx.strokeRect(px + 4, gy + 4, paneW - 8, groundH - 8);
    }

    const map = new THREE.CanvasTexture(colorCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    emissiveMap.anisotropy = 8;
    return { map, emissiveMap };
  }

  /// Builds the full city group. `clearHalfW/clearHalfL` is the half-size of
  /// the canvas area to leave clear of buildings, so nothing spawns on top of
  /// the room itself.
  generate(cx, cz, clearHalfW, clearHalfL, radius = 200) {
    const group = new THREE.Group();
    group.name = "city";

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: this.groundTexture })
    );
    const blocks = Math.round(radius / 16);
    this.groundTexture.repeat.set(blocks, blocks);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.05, cz);
    ground.receiveShadow = true;
    group.add(ground);

    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const facadeMaterials = this.facades.map((f, i) => {
      const glass = i === 0 || i === 1 || i === 5;
      return new THREE.MeshStandardMaterial({
        map: f.map,
        roughness: glass ? 0.25 : 0.75,
        metalness: glass ? 0.4 : 0.05,
        emissive: 0xffffff,
        emissiveMap: f.emissiveMap,
        emissiveIntensity: 0.9,
      });
    });

    const buckets = this.facades.map(() => []);
    const block = 14;
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let x = cx - radius + block; x <= cx + radius - block; x += block) {
      for (let z = cz - radius + block; z <= cz + radius - block; z += block) {
        const px = x + (rnd() - 0.5) * block * 0.4;
        const pz = z + (rnd() - 0.5) * block * 0.4;
        const halfW = 3.5 + rnd() * 3.5;
        const halfD = 3.5 + rnd() * 3.5;
        // Leave the canvas footprint clear so the room stays visible.
        if (px - halfW < cx + clearHalfW && px + halfW > cx - clearHalfW &&
            pz - halfD < cz + clearHalfL && pz + halfD > cz - clearHalfL) continue;
        const dist = Math.hypot(px - cx, pz - cz);
        const tower = rnd() < 0.22 && dist < 70;
        const height = tower
          ? 60 + rnd() * 70
          : 16 + rnd() * (dist < 70 ? 40 : 24);
        const style = Math.floor(rnd() * this.facades.length);
        const tint = 0.82 + rnd() * 0.36;
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

    return group;
  }
}
