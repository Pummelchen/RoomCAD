// Walk3D: scene building, part 2.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import * as P from "../plan.js";
import {
  CLOSED_DOOR_SEAL,
  LEAF_COLOR,
  WALL_COLOR,
  WALL_VERTICAL_SEAL,
} from "./constants.js";

export const scene_building_2 = {

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
  },

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
  },

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
  },

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
    // Hinged at whichever end of the opening the plan says, so a door turned
    // round in 2D opens the same way here.
    const swingAt = P.doorHinge(wall, door);
    const hinge = swingAt.point;
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const len = Math.max(Math.hypot(dx, dz), 0.0001);
    // Along the wall FROM THE HINGE: a closed leaf reaches across the opening
    // that way, and an open one swings a quarter turn from it.
    const ux = swingAt.along.x;
    const uz = swingAt.along.z;

    let leafX;
    let leafZ;
    let centerX;
    let centerZ;
    if (door.open) {
      const sign = swingAt.swingSign;
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
  },

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
  },

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
};
