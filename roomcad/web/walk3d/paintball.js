// Walk3D: paintball.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import { store } from "../store.js";
import {
  RUBBLE_COLOR,
  _carrierMatrix,
  _carrierNormal,
  _carrierPoint,
  _viewForward,
} from "./constants.js";

export const paintball = {

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
  },

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
  },

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
  },

  shootableMeshes() {
    const meshes = [];
    this.scene.traverse(node => {
      if (node.isMesh && !node.userData.splat && !node.userData.ball && !node.userData.gun) {
        meshes.push(node);
      }
    });
    return meshes;
  },

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
  },

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
  },

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
  },

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
  },

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
      // Paint on a vehicle that is not being drawn is not drawn either. The
      // traffic is culled to what can be seen, and a splat carried by a vehicle
      // that has been culled would otherwise hang in the air where the
      // invisible car is.
      splat.visible = !carrier.vehicle || carrier.vehicle.slot >= 0;
      if (splat.visible) this.positionSplat(splat);
    }
  },

  recoil() {
    this.gunRecoil = 1;
  },

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
  },

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  },

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
  },

  // MARK: Update

  update(room) {
    const key = JSON.stringify(room);
    if (key === this.lastRoomKey) return;
    const sameRoom = this.lastRoomKey !== null;
    const previous = this.lastRoomKey ? JSON.parse(this.lastRoomKey) : null;
    const keepCamera = sameRoom
      && previous && previous.id === room.id
      && previous.width === room.width && previous.length === room.length;
    this.build(room, !keepCamera);
  },

  dispose() {
    // Frames off before anything is torn down: a callback that landed after
    // the renderer was disposed would try to draw into it.
    this.running = false;
    this.ready = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
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
  },

  // MARK: Loop

  /// Stops the frame chain. Nothing is torn down: the scene, the player, the
  /// traffic and the weather are all exactly where they were, so resume() puts
  /// the user back where they left off — but while the 3D view is hidden the
  /// renderer, Rapier and the traffic model stop costing anything. Without this
  /// the chain ran forever: setMode() only hid the container, so after a single
  /// visit to 3D the whole world kept rendering at 60 fps behind the 2D editor.
  pause() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  },

  /// Starts the chain again, exactly once. Idempotent: while frames are already
  /// wanted this does nothing, so a setMode() that both resumes the view and
  /// creates it cannot leave two chains rescheduling each other.
  ///
  /// Safe before start() has finished and after dispose(): startFrames() only
  /// schedules once there is a ready scene, and start() calls it itself when
  /// its build is done.
  resume() {
    if (this.running) return;
    this.running = true;
    this.startFrames();
  },

  /// Schedules the next frame if frames are wanted, the scene is ready and none
  /// is already pending — the single place a chain may begin.
  ///
  /// The clock is read and thrown away immediately before the chain starts.
  /// getDelta() measures from the last read, so the first frame after a pause
  /// would otherwise see all the time the user spent in the 2D editor; dt is
  /// clamped to 50 ms, but the physics accumulator and the cloud scroll would
  /// still take the jump.
  startFrames() {
    if (!this.running || !this.ready || this.raf) return;
    this.clock.getDelta();
    // The FPS readout measures from its own sample time, which has the same
    // gap in it; without this the first window after a pause reports the whole
    // pause as one frame.
    this.fpsFrames = 0;
    this.fpsLastSample = performance.now();
    this.raf = requestAnimationFrame(() => this.loop());
  },

  loop() {
    // This callback is no longer pending. Cleared first, so a pause() landing
    // inside the frame has nothing to cancel, and the tail below can tell
    // whether something else has already restarted the chain.
    this.raf = 0;
    if (!this.running) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);

    // The traffic advances BEFORE the physics that consumes it.
    //
    // updateVehicleBodies() lends the nearest cars their kinematic bodies from
    // the traffic model's own positions, and those bodies are what shove the
    // player. Stepping physics first drove every collider from where the
    // traffic was the frame before, so the car that hit you was always one
    // frame behind the car that was drawn.
    //
    // The direction as well as the position: the city draws the traffic it can
    // be seen from here, and most of the fleet is behind you. The camera's
    // orientation is refreshed first, so the direction handed over is this
    // frame's rather than the last one's.
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.getWorldDirection(_viewForward);
    this.city.update(dt, this.camera.position, _viewForward);

    // Which of the room's fixtures hold a light, after the camera has moved.
    // A no-op unless the plan has more ceiling lights than the pool can light.
    this.updateRoomLights();

    this.tick(dt);
    this.updatePaintballs(dt);
    this.updateShards(dt);
    this.updateSplats();
    this.updateClouds(dt);

    const now = performance.now();
    if (this.renderPipeline) this.renderPipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.updateFps(now);
    // Rescheduled from the tail. A pause() during the frame stops the chain; a
    // resume() during it has already scheduled the one callback; either way
    // there is exactly one pending frame.
    if (this.running && !this.raf) this.raf = requestAnimationFrame(() => this.loop());
  }
};
