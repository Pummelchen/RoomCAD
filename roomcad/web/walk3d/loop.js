// Walk3D: loop.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";
import {
  CITY_HEADROOM,
  CROUCH_HALF_HEIGHT,
  MAX_BACKLOG,
  MAX_SUBSTEPS,
  PHYSICS_STEP,
  PLAYER_RADIUS,
  STAND_HALF_HEIGHT,
  WALK_SPEED,
  _gunOffset,
} from "./constants.js";

export const loop = {

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
  },

  tick(dt) {
    let forward = 0;
    let right = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) right -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) right += 1;

    if (this.physicsReady) this.tickPhysics(dt, forward, right);

    this.aimSun();
    this.followSky();
    this.updateCityLights();
    this.updateGun(dt);
  },

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
    // The traffic's colliders follow the traffic, and must be where the model
    // says before the solver looks at them.
    this.updateVehicleBodies();

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
  },

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
};
