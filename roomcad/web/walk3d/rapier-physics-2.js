// Walk3D: rapier physics, part 2.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import * as RAPIER from "../lib/rapier.mjs";
import * as P from "../plan.js";
import { store } from "../store.js";
import { wallRunBox } from "./wall-box.js";
import {
  CROUCH_HALF_HEIGHT,
  JUMP_SPEED,
  PLAYER_RADIUS,
  STAND_HALF_HEIGHT,
} from "./constants.js";

export const rapier_physics_2 = {

  /// One box of wall, between two offsets along it and two heights up it. Used
  /// for the pieces around a shot-out window: the sill under it, the head over
  /// it, and whatever is left of the wall either side.
  addWallSlab(wall, from, to, baseY, y0, y1) {
    const len = to - from;
    const h = y1 - y0;
    if (len < 0.01 || h < 0.01) return;
    const a = P.wallPointAt(wall, from);
    const b = P.wallPointAt(wall, to);
    const box = wallRunBox(a.x, a.z, b.x, b.z, P.WALL_THICKNESS);
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, h / 2, box.hz);
    if (box.rotation) desc.setRotation(box.rotation);
    desc.setTranslation((a.x + b.x) / 2, baseY + y0 + h / 2, (a.z + b.z) / 2);
    this.world.createCollider(desc);
  },

  /// True when a support surface is within a small margin below the capsule.
  isGrounded() {
    if (!this.playerBody) return false;
    const p = this.playerBody.translation();
    const halfH = this.crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    const reach = halfH + PLAYER_RADIUS + 0.06;
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, reach, true, undefined, undefined, undefined, this.playerBody);
    return hit !== null;
  },

  /// Resizes the player capsule for crouch/stand, keeping the feet planted.
  setCrouch(crouching) {
    if (this.crouching === crouching) return;
    this.crouching = crouching;
    if (!this.playerCollider) return;
    const halfH = crouching ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.playerCollider.setShape(new RAPIER.Capsule(halfH, PLAYER_RADIUS));
    this.playerCollider.setTranslation(0, halfH + PLAYER_RADIUS, 0);
  },

  /// Applies an upward velocity impulse while keeping horizontal velocity.
  jump() {
    if (!this.playerBody) return;
    const v = this.playerBody.linvel();
    this.playerBody.setLinvel({ x: v.x, y: JUMP_SPEED, z: v.z }, true);
    this.onGround = false;
  },

  /// Builds the floor as white 60 × 60 cm marble tiles with thin grey veins
  /// and a ~5 mm grout gap between tiles.
  loadFloorTexture(bounds) {
    this.applyFloorCanvas(this.makeFloorCanvas(bounds));
  },

  applyFloorCanvas(canvas) {
    if (!this.floorMaterial) return;
    if (this.floorMaterial.map) this.floorMaterial.map.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // WebGPU exposes max anisotropy on the renderer, not renderer.capabilities.
    texture.anisotropy = (this.renderer.getMaxAnisotropy && this.renderer.getMaxAnisotropy()) || 8;
    this.floorMaterial.map = texture;
    this.floorMaterial.needsUpdate = true;
  },

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
  },

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
  },

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
  },

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
  },

  /// Breaks a window pane: the glass goes, leaving the opening, and a handful
  /// of shards fall out of it. With the pane gone the next shot passes
  /// straight through — the ray already reaches the city, the glass was simply
  /// the first thing in its way — so the room can be shot out of.
  ///
  /// The wall itself stays standing — it is the pane that goes — but the
  /// opening is recorded and the colliders are rebuilt around it, so a window
  /// that is shot out changes what you can walk through as well as what you can
  /// see through. That is the point of shooting one out.
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
  },

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
  },

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
  },

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
};
