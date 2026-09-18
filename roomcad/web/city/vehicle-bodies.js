// The city's vehicle bodies: one merged geometry per kind of vehicle.
//
// Part of city.js, which is split under roomcad/web/city/.

import * as THREE from "three";
import { _euler, _pos, _q, _scale } from "./matrices.js";

// MARK: - Vehicle bodies
//
// A vehicle is one merged mesh rather than a handful of boxes written
// separately every frame. That buys the detail — a greenhouse that steps in
// from the body, glass, door shut lines, bumpers, mirrors — for LESS per-frame
// work than the old three-box car cost, because the whole thing is a single
// instance with a single matrix. The lamps stay separate: they are the only
// part that changes independently of the body.
//
// Colour comes from the instance, which MULTIPLIES these vertex colours, so
// bodywork is left white to take the vehicle's own paint, and glass and tyres
// are dark enough to stay dark whatever colour is laid over them.
export const PAINT = 0xffffff;      // takes the vehicle's colour
export const GLASS = 0x24282e;
export const TYRE = 0x101114;
export const TRIM = 0x4a4d52;
export const GRILLE = 0x2a2c30;

/// Collects boxes and cylinders into one indexed-free geometry.
export function partBuilder() {
  const position = [];
  const normal = [];
  const color = [];
  const c = new THREE.Color();

  const push = (geo, matrix, hex) => {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const index = g.index;
    c.setHex(hex);
    const count = index ? index.count : p.count;
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      position.push(p.getX(v), p.getY(v), p.getZ(v));
      normal.push(n.getX(v), n.getY(v), n.getZ(v));
      color.push(c.r, c.g, c.b);
    }
    g.dispose();
  };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  // A GPU only ever draws triangles, so "round" is a question of how many and
  // whether they are shaded smoothly. Twelve sides read as a dodecagon at any
  // distance you can see a wheel from; twenty-four does not, and Three.js gives
  // the barrel smooth normals, which the merge preserves.
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 24);

  return {
    /// A box, optionally pitched about Z (for a raked windscreen).
    box(x, y, z, w, h, d, hex, pitch = 0) {
      _pos.set(x, y, z);
      _scale.set(w, h, d);
      _q.setFromEuler(_euler.set(0, 0, pitch));
      push(unitBox, new THREE.Matrix4().compose(_pos, _q, _scale), hex);
    },
    /// A road wheel: a cylinder laid on its side, axle across the vehicle.
    wheel(x, y, z, r, width) {
      _pos.set(x, y, z);
      _scale.set(r, width, r);
      _q.setFromEuler(_euler.set(Math.PI / 2, 0, 0));
      push(wheelGeo, new THREE.Matrix4().compose(_pos, _q, _scale), TYRE);
      // Hub, so a wheel is not a plain black cylinder end-on. It stands clear
      // of the tyre's outer face rather than starting exactly on it — two
      // surfaces at one depth is the whole reason the wheels used to flicker.
      _pos.set(x, y, z + (width / 2 + 0.02) * Math.sign(z || 1));
      _scale.set(r * 0.5, 0.024, r * 0.5);
      push(wheelGeo, new THREE.Matrix4().compose(_pos, _q, _scale), TRIM);
    },
    build() {
      unitBox.dispose();
      wheelGeo.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
      return geo;
    },
  };
}

/// A wedge: low, wide, cab-forward, with the roofline falling straight into the
/// rear deck. Everything about it is angled — there is no horizontal bonnet and
/// no upright screen — which is what separates a supercar silhouette from a
/// saloon at the distance you actually see these from.
///
/// The wheels sit PROUD of the bodywork. They used to end exactly on the body's
/// side plane, which put two surfaces at one depth and made them flicker.
export function buildCarGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.42;
  const sill = floor + 0.10;

  // Lower body: a shallow slab, with the rear third flared out over the back
  // wheels the way a mid-engined car is.
  b.box(L * 0.02, floor + 0.34, 0, L * 0.94, 0.50, W * 0.92, PAINT);
  b.box(-L * 0.24, floor + 0.36, 0, L * 0.42, 0.52, W, PAINT);          // haunches
  // Nose: a low wedge running down to the splitter.
  b.box(L * 0.40, floor + 0.26, 0, L * 0.22, 0.26, W * 0.86, PAINT, -0.12);
  b.box(L * 0.485, floor + 0.13, 0, 0.16, 0.09, W * 0.9, TRIM);          // splitter

  // The wedge: a raked upper surface from the nose to the base of the screen,
  // then the roof, then the deck falling away behind it.
  const cowlY = floor + 0.60;
  b.box(L * 0.24, cowlY, 0, L * 0.30, 0.10, W * 0.84, PAINT, -0.16);
  const roofY = floor + 0.92;
  b.box(-L * 0.06, roofY, 0, L * 0.30, 0.06, W * 0.62, PAINT);           // roof
  b.box(-L * 0.30, cowlY + 0.16, 0, L * 0.26, 0.09, W * 0.80, PAINT, 0.20); // rear deck

  // Glass. A steeply raked screen, a short backlight over the engine, and a
  // side window that tapers into the C-pillar.
  b.box(L * 0.10, floor + 0.80, 0, 0.07, 0.46, W * 0.72, GLASS, -0.62);
  b.box(-L * 0.21, floor + 0.86, 0, 0.06, 0.30, W * 0.64, GLASS, 0.66);
  for (const s of [-1, 1]) {
    b.box(-L * 0.05, floor + 0.80, s * W * 0.34, L * 0.26, 0.24, 0.05, GLASS);
    // Buttress from the roof down to the haunch — the shape that makes the
    // profile read as mid-engined rather than as a fastback.
    b.box(-L * 0.19, floor + 0.80, s * W * 0.33, L * 0.16, 0.26, 0.10, PAINT, 0.30);
  }

  // Side intake ahead of the rear wheel, door shut line, mirror on a stalk.
  for (const s of [-1, 1]) {
    b.box(-L * 0.10, floor + 0.34, s * W * 0.465, L * 0.20, 0.20, 0.06, GRILLE);
    b.box(L * 0.05, floor + 0.34, s * W * 0.463, 0.04, 0.44, 0.04, TRIM);
    b.box(L * 0.14, floor + 0.66, s * W * 0.52, 0.16, 0.05, 0.11, TRIM);
  }

  // Tail: a fixed wing on two uprights, a diffuser and quad exhausts.
  for (const s of [-1, 1]) b.box(-L * 0.40, floor + 0.72, s * W * 0.30, 0.06, 0.20, 0.06, TRIM);
  b.box(-L * 0.41, floor + 0.84, 0, 0.26, 0.05, W * 0.74, TRIM);
  b.box(-L * 0.47, floor + 0.16, 0, 0.14, 0.16, W * 0.7, GRILLE);
  for (const s of [-1, 1]) {
    b.box(-L * 0.475, floor + 0.30, s * W * 0.16, 0.10, 0.07, 0.07, TRIM);
  }

  for (const s of [-1, 1]) b.box(L * 0.02, sill, s * W * 0.47, L * 0.5, 0.06, 0.05, TRIM);

  // Rear wheels wider than the front, and both standing proud of the body.
  for (const s of [-1, 1]) b.wheel(L * 0.32, wheelR, s * W * 0.46, wheelR, W * 0.12);
  for (const s of [-1, 1]) b.wheel(-L * 0.30, wheelR * 1.06, s * W * 0.46, wheelR * 1.06, W * 0.15);
  return b.build();
}

/// A rigid truck: cab, chassis, and a box body sitting above the frame.
/// A delivery van: one body, a raked nose, a tall box behind the cab, and the
/// sliding door and rear shutter that say what it is for. Short enough to fit a
/// parking bay, which is the point — the loading it does used to be done by the
/// artics, standing in the running lane.
export function buildVanGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.55;
  const bodyH = 1.34;
  const bodyY = floor + bodyH / 2;

  // The box: the whole length behind the nose, full height.
  b.box(-L * 0.08, bodyY, 0, L * 0.78, bodyH, W, PAINT);
  // Roof, slightly inset, so the top edge reads as an edge.
  b.box(-L * 0.08, floor + bodyH, 0, L * 0.74, 0.09, W * 0.94, PAINT);

  // Nose: short bonnet and a raked screen up to the cab roof.
  const noseX = L * 0.38;
  b.box(noseX, floor + 0.42, 0, L * 0.2, 0.62, W * 0.96, PAINT);
  b.box(L * 0.25, floor + bodyH * 0.78, 0, L * 0.13, 0.82, W * 0.92, GLASS, -0.34);
  // Cab side glass, one pane each side, and the door line under it.
  for (const side of [-1, 1]) {
    b.box(L * 0.14, floor + bodyH * 0.74, side * W * 0.49, L * 0.18, 0.5, 0.03, GLASS);
    // The cab door line and the sliding door stand off the flank by DIFFERENT
    // amounts. At the same one they shared both of their faces, which is two
    // surfaces at one depth down the side of the van.
    b.box(L * 0.13, floor + bodyH * 0.36, side * (W * 0.5 + 0.012), L * 0.22, 0.5, 0.02, TRIM);
    // The sliding side door, the panel a delivery van is recognised by.
    b.box(-L * 0.04, bodyY, side * (W * 0.5 + 0.030), L * 0.24, bodyH * 0.82, 0.02, TRIM);
  }
  // Rear shutter and bumpers.
  b.box(-L * 0.47, bodyY, 0, 0.04, bodyH * 0.86, W * 0.9, TRIM);
  b.box(L * 0.47, floor + 0.2, 0, 0.1, 0.24, W * 0.94, TRIM);
  b.box(-L * 0.49, floor + 0.22, 0, 0.08, 0.22, W * 0.94, TRIM);

  // Two axles, wheels proud of the flanks so the two never share a plane.
  const wheelW = 0.2;
  const track = W * 0.5 + 0.03;
  for (const ax of [L * 0.3, -L * 0.28]) {
    for (const side of [-1, 1]) b.wheel(ax, wheelR, side * track, wheelR, wheelW);
    // Arches, so a wheel is not simply stuck to a flat side.
    for (const side of [-1, 1]) {
      b.box(ax, wheelR + 0.3, side * (W * 0.5 - 0.02), wheelR * 2.3, 0.1, 0.06, TRIM);
    }
  }
  return b.build();
}

export function buildTruckGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.62;
  const frameY = floor + 0.28;

  // Chassis rails, visible under the box body.
  for (const s of [-1, 1]) b.box(-L * 0.06, frameY, s * W * 0.3, L * 0.86, 0.16, 0.12, TRIM);

  // Cab: body, roof, deep screen, side glass, mirrors.
  const cabL = L * 0.28;
  const cabX = L * 0.33;
  const cabY = frameY + 0.72;
  b.box(cabX, cabY, 0, cabL, 1.36, W * 0.98, PAINT);
  b.box(cabX, cabY + 0.74, 0, cabL * 0.94, 0.12, W * 0.94, PAINT);
  b.box(cabX + cabL * 0.5, cabY + 0.30, 0, 0.07, 0.62, W * 0.86, GLASS, -0.16);
  for (const s of [-1, 1]) {
    b.box(cabX - cabL * 0.1, cabY + 0.26, s * W * 0.495, cabL * 0.5, 0.42, 0.05, GLASS);
    b.box(cabX + cabL * 0.42, cabY + 0.34, s * W * 0.60, 0.08, 0.34, 0.10, TRIM);   // mirror
    b.box(cabX - cabL * 0.28, cabY - 0.1, s * W * 0.5, 0.04, 1.0, 0.04, TRIM);      // door line
  }
  b.box(cabX + cabL * 0.48, frameY + 0.16, 0, 0.10, 0.28, W * 0.95, TRIM);          // bumper
  b.box(cabX + cabL * 0.46, cabY - 0.42, 0, 0.07, 0.34, W * 0.7, GRILLE);

  // Box body, with a ribbed side and rear doors.
  const boxL = L * 0.60;
  const boxX = -L * 0.145;
  const boxY = frameY + 0.95;
  b.box(boxX, boxY, 0, boxL, 1.82, W, PAINT);
  b.box(boxX, boxY + 0.95, 0, boxL * 0.99, 0.09, W * 0.99, TRIM);      // roof cap
  for (const s of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      b.box(boxX + i * boxL * 0.19, boxY, s * W * 0.503, 0.05, 1.7, 0.03, TRIM);
    }
  }
  b.box(boxX - boxL * 0.502, boxY, 0, 0.04, 1.7, W * 0.9, TRIM);       // rear doors
  b.box(boxX - boxL * 0.505, boxY, 0, 0.04, 1.7, 0.06, GRILLE);        // door seam

  for (const ax of [L * 0.34, -L * 0.16, -L * 0.34]) {
    for (const s of [-1, 1]) b.wheel(ax, wheelR, s * W * 0.44, wheelR, W * 0.13);
  }
  return b.build();
}

/// A city bus: a long slab of glass with a roof, doors and wheel arches.
export function buildBusGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.55;
  const bodyH = 2.1;
  const bodyY = floor + bodyH / 2 + 0.18;

  b.box(0, bodyY, 0, L * 0.98, bodyH, W, PAINT);
  b.box(0, bodyY + bodyH / 2 + 0.06, 0, L * 0.94, 0.14, W * 0.96, PAINT);   // roof
  b.box(0, floor + 0.16, 0, L * 0.9, 0.22, W * 0.94, TRIM);                 // skirt

  // Doorways first: they run the full height of the side, so the window bays
  // have to give way to them rather than being drawn across them.
  const doors = [L * 0.28, -L * 0.18];
  const doorW = 1.04;
  const bays = 7;
  const bayW = (L * 0.84 / bays) * 0.82;
  for (const s of [-1, 1]) {
    for (const at of doors) {
      b.box(at, bodyY + 0.06, s * W * 0.502, doorW, 1.94, 0.05, GLASS);
      b.box(at, bodyY + 0.06, s * W * 0.507, 0.06, 1.94, 0.04, TRIM);   // leaf split
    }
    for (let i = 0; i < bays; i++) {
      const at = -L * 0.42 + (L * 0.84) * ((i + 0.5) / bays);
      if (doors.some(d => Math.abs(d - at) < (doorW + bayW) / 2 + 0.1)) continue;
      b.box(at, bodyY + 0.42, s * W * 0.5, bayW, 0.82, 0.05, GLASS);
    }
  }
  // Windscreen and rear window, full width.
  b.box(L * 0.49, bodyY + 0.34, 0, 0.07, 1.0, W * 0.9, GLASS);
  b.box(-L * 0.49, bodyY + 0.34, 0, 0.07, 0.9, W * 0.9, GLASS);
  b.box(L * 0.5, floor + 0.34, 0, 0.09, 0.3, W * 0.95, TRIM);
  b.box(-L * 0.5, floor + 0.34, 0, 0.09, 0.3, W * 0.95, TRIM);
  for (const s of [-1, 1]) b.box(L * 0.44, bodyY + 0.78, s * W * 0.57, 0.09, 0.3, 0.1, TRIM);

  for (const ax of [L * 0.33, -L * 0.24, -L * 0.38]) {
    for (const s of [-1, 1]) b.wheel(ax, wheelR, s * W * 0.45, wheelR, W * 0.13);
  }
  return b.build();
}
