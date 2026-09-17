// Walk3D: rapier physics.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import * as RAPIER from "../lib/rapier.mjs";
import { City } from "../city.js";
import * as P from "../plan.js";
import { wallRunBox } from "./wall-box.js";
import {
  CITY_LIGHT_POOL,
  CITY_LIGHT_REACH,
  CITY_SHADOW_LIGHTS,
  CITY_SHADOW_MAP,
  CITY_SHADOW_NORMAL_BIAS,
  CLOSED_DOOR_SEAL,
  CROUCH_HALF_HEIGHT,
  GRAVITY,
  PARKED_FAR_BELOW,
  PLAYER_FRICTION,
  PLAYER_MASS,
  PLAYER_RADIUS,
  STAND_HALF_HEIGHT,
  SUN_HEIGHT,
  SUN_SHADOW_MAP,
  SUN_SHADOW_REACH,
  VEHICLE_BODY_POOL,
  VEHICLE_FRICTION,
  VEHICLE_SOLID_RANGE,
  WALL_VERTICAL_SEAL,
} from "./constants.js";

export const rapier_physics = {

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
      const box = wallRunBox(startX, startZ, endX, endZ, P.WALL_THICKNESS);
      const desc = RAPIER.ColliderDesc.cuboid(box.hx, h, box.hz);
      if (box.rotation) desc.setRotation(box.rotation);
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
      const doorThickness = P.WALL_THICKNESS + 2 * CLOSED_DOOR_SEAL;
      const box = wallRunBox(a.x, a.z, b.x, b.z, doorThickness);
      const desc = RAPIER.ColliderDesc.cuboid(box.hx, doorTop / 2 + CLOSED_DOOR_SEAL, box.hz);
      if (box.rotation) desc.setRotation(box.rotation);
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
      const box = wallRunBox(a.x, a.z, b.x, b.z, P.WALL_THICKNESS);
      const desc = RAPIER.ColliderDesc.cuboid(box.hx, headerH / 2, box.hz);
      if (box.rotation) desc.setRotation(box.rotation);
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
        // Seventy-five kilograms. Rapier works a body's mass out from its
        // collider's volume and density, and a capsule this size at the default
        // density weighs about 170 GRAMS — which did not matter while the only
        // thing the player touched was a wall that never moves, and matters
        // very much now that a car can hit them.
        .setMass(PLAYER_MASS)
        // Enough grip to be carried by something moving under you, not so much
        // that you stick to a wall you brush past. Rapier averages the two
        // surfaces, and the vehicles bring the rest.
        .setFriction(PLAYER_FRICTION),
      body
    );
    this.playerBody = body;
    this.playerCollider = collider;
    this.physicsBodies.push(body);
    this.onGround = false;

    this.buildVehicleBodies();
  },

  /// A pool of solid bodies lent to whichever vehicles are nearest.
  ///
  /// The traffic was scenery you walked through. It cannot simply be given
  /// colliders — there are 680 of them (city.js's FLEET_SIZE) and their
  /// positions come from the traffic model, not from the solver — so each frame
  /// the nearest few are lent a KINEMATIC body: one the traffic drives and the
  /// solver respects. Standing on one, you are carried along by it; standing in
  /// front of one, it shoves you out of the way.
  ///
  /// A pool rather than one each, because only what is within a few metres can
  /// possibly be touched, and a body for every vehicle in the city is 680
  /// bodies stepped every frame to no purpose.
  buildVehicleBodies() {
    this.vehicleBodies = [];
    for (let i = 0; i < VEHICLE_BODY_POOL; i++) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PARKED_FAR_BELOW, 0)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(1, 1, 1).setFriction(VEHICLE_FRICTION), body
      );
      this.vehicleBodies.push({ body, collider, vehicle: null });
    }
  },

  /// Hands the pool to the vehicles nearest the player, and drives them.
  updateVehicleBodies() {
    const pool = this.vehicleBodies;
    if (!pool || !this.city || !this.city.cars) return;
    const me = this.position;
    // Nearest first, and only what is close enough to be stood on or run into.
    const near = [];
    for (const v of this.city.cars) {
      const dx = v.x - me.x;
      const dz = v.z - me.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > VEHICLE_SOLID_RANGE * VEHICLE_SOLID_RANGE) continue;
      near.push({ v, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      const pick = near[i];
      if (!pick) {
        // Parked well below the world rather than removed: adding and removing
        // colliders every frame churns the broad phase for no reason.
        if (slot.vehicle !== null) {
          slot.vehicle = null;
          slot.body.setNextKinematicTranslation({ x: 0, y: PARKED_FAR_BELOW, z: 0 });
        }
        continue;
      }
      const v = pick.v;
      const body = v.bodyH + v.roofH;
      if (slot.vehicle !== v) {
        slot.vehicle = v;
        slot.collider.setShape(new RAPIER.Cuboid(v.length / 2, body / 2, v.width / 2));
      }
      slot.body.setNextKinematicTranslation({
        x: v.x, y: this.city.groundY() + body / 2, z: v.z,
      });
      // Heading only: a vehicle leans and dips on its springs, but a collider
      // that rolled with it would tip the player off a car that is merely
      // braking.
      const half = -v.heading / 2;
      slot.body.setNextKinematicRotation({
        x: 0, y: Math.sin(half), z: 0, w: Math.cos(half),
      });
    }
  },

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
  },

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
        light.shadow.bias = 0;
        light.shadow.normalBias = CITY_SHADOW_NORMAL_BIAS;
      }
      scene.add(light);
      this.cityLights.push(light);
    }
    this.lightCandidates = [];
    this.lightFrustum = new THREE.Frustum();
    this.lightProjection = new THREE.Matrix4();
    this.lightSphere = new THREE.Sphere();
    this.litCount = 0;
  },

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
};
