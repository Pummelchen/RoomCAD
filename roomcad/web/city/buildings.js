// City: buildings.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import * as THREE from "three";
import {
  CANOPY_COLORS,
  CITY_GLASS_INSET,
  CITY_GLASS_T,
  CITY_WALL_T,
  CORE_CLEAR,
  CORE_COLOR,
  DIGIT_CELL,
  DIGIT_ROWS,
  ENTRANCE_COLOR,
  FACADE_COLORS,
  FLOOR_HEIGHT,
  GRID_RADIUS,
  LIT_BANDS,
  NUMBER_COLOR,
  NUMBER_PLATE,
  PAVEMENT_Y,
  ROOF_COLOR,
  ROOM_DEPTH,
  ROOM_SLAB_THICKNESS,
  ROOM_STOREYS,
  SIDEWALK,
  STEP_COLOR,
  STOREY_CHOICES,
  SURROUND_COLOR,
  TOWER_REVEAL,
  TREE_KERB_CLEAR,
  TREE_MAX_RADIUS,
  WIN_H,
  WIN_PITCH,
  WIN_SILL,
  WIN_W,
} from "./constants.js";
import { boxMatrix } from "./matrices.js";
import { City } from "../city.js";

export const buildings = {

  // MARK: - Buildings

  /// Two to four buildings per block, set back from the pavement. `detailed`
  /// builds them hollow, with rooms behind the windows; without it they are
  /// solid blocks with windows painted on, which is all the fog lets you see
  /// further out.
  _blockBuildings(sets, bx, bz, block, rnd, detailed, gx, gz) {
    const core = block - SIDEWALK * 2;
    const cols = rnd() < 0.5 ? 1 : 2;
    const rows = rnd() < 0.45 ? 1 : 2;
    const cellW = core / cols;
    const cellD = core / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (cols * rows > 1 && rnd() < 0.18) continue; // leave a gap / courtyard
        const gapW = 2 + rnd() * 3;
        const gapD = 2 + rnd() * 3;
        const w = Math.max(6, cellW - gapW);
        const d = Math.max(6, cellD - gapD);
        const storeys = STOREY_CHOICES[Math.floor(rnd() * STOREY_CHOICES.length)];
        const h = storeys * FLOOR_HEIGHT;
        const x = bx - core / 2 + cellW * (i + 0.5);
        const z = bz - core / 2 + cellD * (j + 0.5);
        const color = FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)];
        if (detailed) {
          // Which way the front door faces: away from the middle of its own
          // block, towards the nearest street.
          const offX = x - bx;
          const offZ = z - bz;
          const street = Math.abs(offX) > Math.abs(offZ)
            ? { nx: Math.sign(offX) || 1, nz: 0 }
            : { nx: 0, nz: Math.sign(offZ) || 1 };
          // Numbered the way Manhattan is: the hundred comes from how far up
          // the grid the block is, and the last digits run along it, odd on
          // one side of the street and even on the other.
          const hundred = (gz + GRID_RADIUS + 1) * 100;
          const parity = ((gx + GRID_RADIUS) % 2 + 2) % 2;
          const number = hundred + (i * 2 + j) * 2 + parity;
          this._hollowBuilding(sets, x, z, w, d, storeys, PAVEMENT_Y, color, rnd, street, number);
        } else {
          sets.facades.add(boxMatrix(x, PAVEMENT_Y + h / 2, z, w, h, d), color);
          this._facadeWindows(sets.darkGlass, sets.litGlass, x, z, w, d, storeys, PAVEMENT_Y, rnd);
        }
        // A parapet reads as a roof without modelling one, and caps the shell
        // of a hollow building so you cannot see down into it from above.
        sets.roofs.add(boxMatrix(x, PAVEMENT_Y + h + 0.25, z, w + 0.5, 0.5, d + 0.5), ROOF_COLOR);
        // And it is solid, so the street outside is a street rather than a
        // painted backdrop you walk straight through.
        this.solids.push({ x, y: PAVEMENT_Y + h / 2, z, w, h, d });
      }
    }
  },

  /// A building with an actual inside. Each wall is built as the masonry
  /// AROUND its windows — piers between them and bands above and below — so a
  /// window is a real hole, and behind every hole sits a room: a box open
  /// towards the street, with a bulb hanging in it if the light is on. That is
  /// where the depth comes from. Looking along a facade, the rooms slide past
  /// their openings exactly the way real ones do, which no amount of painted-on
  /// glass achieves.
  _hollowBuilding(sets, x, z, w, d, storeys, baseY, color, rnd, street, number) {
    const h = storeys * FLOOR_HEIGHT;
    const t = CITY_WALL_T;
    // Rooms are shallower in a small building, so that the ones behind facing
    // walls cannot meet in the middle.
    const depth = Math.min(ROOM_DEPTH, Math.min(w, d) / 4.2);
    const roomW = WIN_W + 0.35;

    // Where the windows sit vertically. The top storey stops short of the
    // parapet so there is always a band of wall under it.
    const rowsY = [];
    for (let s = 0; s < storeys; s++) {
      const y0 = baseY + s * FLOOR_HEIGHT + WIN_SILL;
      const y1 = Math.min(y0 + WIN_H, baseY + h - 0.3);
      if (y1 - y0 > 0.4) rowsY.push([y0, y1]);
    }

    for (const face of [{ nx: 0, nz: 1 }, { nx: 0, nz: -1 }, { nx: 1, nz: 0 }, { nx: -1, nz: 0 }]) {
      const alongX = face.nz !== 0;
      const other = alongX ? d : w;
      // The two side walls stop short of the front and back ones instead of
      // running the full depth. Four walls each taking the whole length all
      // meet in the corners, where their outer faces share a plane and fight
      // over it.
      const span = alongX ? w : d - t * 2;
      if (span <= 0.5) continue;
      // Centre of the wall slab, half a thickness in from the outer face.
      const wallX = alongX ? x : x + face.nx * (other / 2 - t / 2);
      const wallZ = alongX ? z + face.nz * (other / 2 - t / 2) : z;

      // Window centres are confined so that a room never reaches into the
      // depth the return wall's own rooms occupy — two rooms sharing a corner
      // interpenetrate, and their ceilings land on the same plane.
      const half = span / 2 - depth - roomW / 2;
      const centres = [];
      if (half > 0) {
        let count = Math.max(1, Math.floor((half * 2) / WIN_PITCH));
        // And no two rooms along this same wall may touch either.
        while (count > 1 && (half * 2) / (count + 1) < roomW + 0.12) count--;
        const step = (half * 2) / (count + 1);
        for (let i = 1; i <= count; i++) centres.push(-half + step * i);
      }

      // The street door replaces the ground-floor opening of the middle
      // column on the wall that faces the street, and the masonry beneath it
      // is simply not built — which is what makes it a doorway rather than a
      // picture of one.
      const onStreet = street && face.nx === street.nx && face.nz === street.nz;
      const doorAt = onStreet && centres.length && rowsY.length
        ? Math.floor((centres.length - 1) / 2)
        : -1;

      // Piers: the full-height masonry between and beside the window columns.
      let cursor = -span / 2;
      const piers = [];
      for (const c of centres) {
        piers.push([cursor, c - WIN_W / 2]);
        cursor = c + WIN_W / 2;
      }
      piers.push([cursor, span / 2]);
      for (const [a, b] of piers) {
        if (b - a <= 0.02) continue;
        const mid = (a + b) / 2;
        sets.facades.add(boxMatrix(
          alongX ? wallX + mid : wallX,
          baseY + h / 2,
          alongX ? wallZ : wallZ + mid,
          alongX ? b - a : t, h, alongX ? t : b - a
        ), color);
      }

      // Bands: within each window column, the masonry above and below the
      // openings — sill to sill, and the parapet band over the top row.
      for (let ci = 0; ci < centres.length; ci++) {
        const c = centres[ci];
        const segs = [];
        let y = baseY;
        for (const [y0, y1] of rowsY) {
          segs.push([y, y0]);
          y = y1;
        }
        segs.push([y, baseY + h]);
        // Drop the spandrel under the first window of the door column, so the
        // opening runs from the pavement to the head of that window.
        if (ci === doorAt) segs.shift();
        for (const [a, b] of segs) {
          if (b - a <= 0.02) continue;
          sets.facades.add(boxMatrix(
            alongX ? wallX + c : wallX,
            (a + b) / 2,
            alongX ? wallZ : wallZ + c,
            alongX ? WIN_W : t, b - a, alongX ? t : WIN_W
          ), color);
        }
      }

      // The rooms themselves, one per opening. The box starts at the outer
      // face and reaches back, so there is no gap at the reveal, and it is
      // drawn from the inside — its front face is culled, and what you see
      // through the window is its back and side walls.
      const roomH = FLOOR_HEIGHT - 0.35;
      for (let ci = 0; ci < centres.length; ci++) {
        const c = centres[ci];
        for (let r = 0; r < rowsY.length; r++) {
          // The ground floor of the door column is the lobby, not a room.
          if (ci === doorAt && r === 0) continue;
          const lit = rnd() < 0.34;
          const band = lit ? Math.floor(rnd() * LIT_BANDS.length) : -1;
          const [ry0, ry1] = rowsY[r];
          // Only the storeys you could see into from the street get a ROOM
          // behind the glass. A sixty storey tower modelled all the way up is
          // thousands of interiors for floors nobody will ever look into.
          //
          // But the floors above still have windows, and until now they had
          // nothing at all behind them: no room, no glass, no light. So the
          // towers nearest the viewer — the ones filling the screen — stood
          // black from the ninth floor to the sixtieth while the distant ones
          // were lit all the way up. They get what the distant towers get: a
          // pane, lit or dark, in the same proportion and the same bands.
          if (r >= ROOM_STOREYS) {
            const turn = alongX
              ? (face.nz > 0 ? 0 : Math.PI)
              : (face.nx > 0 ? Math.PI / 2 : -Math.PI / 2);
            const paneAt = other / 2 - CITY_GLASS_INSET;
            const pane = boxMatrix(
              alongX ? x + c : x + face.nx * paneAt,
              (ry0 + ry1) / 2,
              alongX ? z + face.nz * paneAt : z + c,
              WIN_W, ry1 - ry0, 1, turn
            );
            if (lit) sets.litGlass[band].add(pane);
            else sets.darkGlass.add(pane);
            continue;
          }
          const roomCY = baseY + r * FLOOR_HEIGHT + roomH / 2 + 0.12;
          const back = other / 2 - depth / 2;
          const rx = alongX ? x + c : x + face.nx * back;
          const rz = alongX ? z + face.nz * back : z + c;
          const box = boxMatrix(
            rx, roomCY, rz,
            alongX ? roomW : depth, roomH, alongX ? depth : roomW
          );
          // The band this room burns at was drawn with the decision to light
          // it, so a room and a window on the same floor of the same building
          // are chosen the same way.
          if (lit) sets.roomsLit[band].add(box); else sets.roomsDark.add(box);

          // The pane, set INTO the opening rather than flush with the facade.
          // Flush puts its outer face in the same plane as the masonry around
          // it, which is two surfaces at one depth all over every building.
          const wy0 = ry0;
          const wy1 = ry1;
          const glassIn = other / 2 - CITY_GLASS_INSET;
          sets.glazing.add(boxMatrix(
            alongX ? x + c : x + face.nx * glassIn,
            (wy0 + wy1) / 2,
            alongX ? z + face.nz * glassIn : z + c,
            alongX ? WIN_W : CITY_GLASS_T, wy1 - wy0, alongX ? CITY_GLASS_T : WIN_W
          ));
          if (lit) {
            // The bulb hangs a little back from the glass, near the ceiling,
            // so it reads as the source of the light rather than as a sticker
            // on the window.
            const bulbIn = other / 2 - depth * 0.55;
            sets.litBulbs[band].add(boxMatrix(
              alongX ? x + c : x + face.nx * bulbIn,
              roomCY + roomH / 2 - 0.34,
              alongX ? z + face.nz * bulbIn : z + c,
              1, 1, 1
            ));
          }
        }
      }

      if (doorAt >= 0) {
        const c = centres[doorAt];
        const outer = other / 2;
        this._entrance(
          sets,
          alongX ? x + c : x + face.nx * outer,
          alongX ? z + face.nz * outer : z + c,
          face.nx, face.nz, alongX,
          baseY, rowsY[0][1], number
        );
      }
    }

    // A solid middle, so the building is not a lantern you can see straight
    // through from one street to the next. It stops clear of the backs of the
    // rooms rather than meeting them exactly.
    const coreW = w - 2 * (depth + CORE_CLEAR);
    const coreD = d - 2 * (depth + CORE_CLEAR);
    if (coreW > 0.2 && coreD > 0.2) {
      sets.facades.add(boxMatrix(x, baseY + h / 2, z, coreW, h, coreD), CORE_COLOR);
    }
  },

  /// A street door, with the number over it. The opening is a real one — the
  /// masonry below the ground-floor window is simply not built for this column
  /// — so the recess behind it has the same depth the windows do, and the
  /// stone surround and canopy stand proud of the facade in front of it.
  ///
  /// (ox, oz) is the middle of the opening, on the plane of the outer wall.
  _entrance(sets, ox, oz, nx, nz, alongX, baseY, openTop, number) {
    const height = openTop - baseY;
    if (height < 1.6) return;
    const wide = alongX ? WIN_W + 0.5 : 1.4;      // extents along / into the wall
    const deep = alongX ? 1.4 : WIN_W + 0.5;
    const midY = baseY + height / 2;
    // Half a step out from the wall, per element, so nothing shares a plane.
    const at = (out) => ({ x: ox + nx * out, z: oz + nz * out });

    // The lobby behind the door, drawn from the inside like the rooms are.
    // Every piece here is deliberately off the wall's own planes. The
    // surround wraps the opening edge rather than starting exactly on it, the
    // lintel overlaps the masonry above instead of butting into it, and the
    // lobby stops short of that masonry — three separate coplanar clashes the
    // first version of this shipped with, all of which flicker.
    const back = at(-0.7);
    // Its floor sits a few centimetres above the pavement rather than exactly
    // on it: the block's paving slab runs on under the buildings, and its top
    // surface is at that same level.
    sets.roomsDark.add(boxMatrix(back.x, midY - 0.06, back.z, wide, height - 0.20, deep));

    // Glazed leaves, set back in the opening.
    const leaf = at(-0.09);
    sets.facades.add(boxMatrix(
      leaf.x, midY - 0.06, leaf.z,
      alongX ? WIN_W - 0.06 : 0.06, height - 0.28, alongX ? 0.06 : WIN_W - 0.06
    ), ENTRANCE_COLOR);

    // Stone surround: two jambs and a lintel, standing proud of the wall.
    const jamb = at(0.06);
    const side = alongX ? WIN_W / 2 + 0.09 : 0;
    const sideZ = alongX ? 0 : WIN_W / 2 + 0.09;
    for (const s of [-1, 1]) {
      sets.facades.add(boxMatrix(
        jamb.x + s * side, midY, jamb.z + s * sideZ,
        alongX ? 0.30 : 0.26, height + 0.2, alongX ? 0.26 : 0.30
      ), SURROUND_COLOR);
    }
    // Wider and deeper than the jambs it sits on, so the two stone pieces
    // meet in a rebate rather than sharing four faces at the corners.
    const lintel = at(0.10);
    sets.facades.add(boxMatrix(
      lintel.x, baseY + height + 0.08, lintel.z,
      alongX ? WIN_W + 0.58 : 0.30, 0.28, alongX ? 0.30 : WIN_W + 0.58
    ), SURROUND_COLOR);

    // Canopy over the door, and a threshold slab under it.
    const canopy = at(0.42);
    sets.roofs.add(boxMatrix(
      canopy.x, baseY + height + 0.34, canopy.z,
      alongX ? WIN_W + 0.8 : 1.0, 0.14, alongX ? 1.0 : WIN_W + 0.8
    ), SURROUND_COLOR);
    const sill = at(0.22);
    sets.facades.add(boxMatrix(
      sill.x, baseY + 0.055, sill.z,
      alongX ? WIN_W + 0.5 : 0.7, 0.09, alongX ? 0.7 : WIN_W + 0.5
    ), STEP_COLOR);

    // The number, over the canopy. Manhattan puts it where you can read it
    // from across the street, so it goes above the door rather than beside it.
    const text = String(number);
    const cells = text.length * 4 - 1;
    const plateW = cells * DIGIT_CELL + 0.14;
    const plateH = 5 * DIGIT_CELL + 0.1;
    const plateY = baseY + height + 0.72;
    const plate = at(0.09);
    sets.facades.add(boxMatrix(
      plate.x, plateY, plate.z,
      alongX ? plateW : 0.04, plateH, alongX ? 0.04 : plateW
    ), NUMBER_PLATE);

    const glyph = at(0.13);
    for (let i = 0; i < text.length; i++) {
      const rows = DIGIT_ROWS[text[i]];
      if (!rows) continue;
      const originCell = -cells / 2 + i * 4;
      for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 3; col++) {
          if (rows[r][col] !== "1") continue;
          const alongOff = (originCell + col + 0.5) * DIGIT_CELL;
          const upOff = (2 - r) * DIGIT_CELL;
          sets.facades.add(boxMatrix(
            alongX ? glyph.x + alongOff : glyph.x,
            plateY + upOff,
            alongX ? glyph.z : glyph.z + alongOff,
            alongX ? DIGIT_CELL * 0.86 : 0.03, DIGIT_CELL * 0.86,
            alongX ? 0.03 : DIGIT_CELL * 0.86
          ), NUMBER_COLOR);
        }
      }
    }
  },

  /// The tower the room sits on, so an upper-floor room has a building beneath
  /// it instead of thin air. Floor 1 gets a low podium instead of a tower.
  /// Deliberately solid: this is the one piece of city geometry that comes
  /// within centimetres of the room's own floor slab, and a hollow shell here
  /// would put more surfaces near that depth for no visible gain — you are
  /// standing on top of it, not looking at it.
  _homeTower(sets, bounds, floorLift, rnd) {
    const w = bounds.width + 1.2;
    const d = bounds.length + 1.2;
    const x = bounds.centerX;
    const z = bounds.centerZ;
    const color = FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)];
    if (floorLift <= 0.01) {
      // Ground floor: the room sits directly on its plot. Adding anything
      // here would rise above the room's own floor.
      return;
    }
    // Stop below the underside of the room's floor slab. The tower is wider
    // than the room, so the small reveal reads as an ordinary floor line
    // rather than a gap.
    const height = Math.max(0.05, floorLift - ROOM_SLAB_THICKNESS - TOWER_REVEAL);
    sets.facades.add(boxMatrix(x, height / 2, z, w, height, d), color);
    const storeys = Math.max(1, Math.round(height / FLOOR_HEIGHT));
    this._facadeWindows(sets.darkGlass, sets.litGlass, x, z, w, d, storeys, 0, rnd);
  },

  /// A grid of windows on all four faces, a few of them lit. Used for the
  /// buildings too far away to be worth hollowing out.
  /// `w` is the extent along X, `d` the extent along Z.
  _facadeWindows(darkGlass, litGlass, x, z, w, d, storeys, baseY, rnd) {
    const winW = 1.0;
    const winH = 1.3;
    const proud = 0.06;
    // Each face: the axis the windows march along, the outward offset, and
    // which way the pane looks. The turn matters because a window is a PANE
    // now, not a box — one face where there were six, which on a city of sixty
    // storey towers is the difference between 1.8 million triangles of window
    // and 300,000. You never see the back or the sides of a window.
    const faces = [
      { along: "x", span: w, offX: 0, offZ: d / 2 + proud, turn: 0 },
      { along: "x", span: w, offX: 0, offZ: -(d / 2 + proud), turn: Math.PI },
      { along: "z", span: d, offX: w / 2 + proud, offZ: 0, turn: Math.PI / 2 },
      { along: "z", span: d, offX: -(w / 2 + proud), offZ: 0, turn: -Math.PI / 2 },
    ];
    for (const face of faces) {
      const count = Math.max(1, Math.floor((face.span - 1.4) / 2.2));
      const step = face.span / (count + 1);
      for (let s = 0; s < storeys; s++) {
        const y = baseY + s * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.55;
        for (let i = 1; i <= count; i++) {
          const along = -face.span / 2 + step * i;
          const px = x + face.offX + (face.along === "x" ? along : 0);
          const pz = z + face.offZ + (face.along === "z" ? along : 0);
          const m = boxMatrix(px, y, pz, winW, winH, 1, face.turn);
          if (rnd() < 0.34) litGlass[Math.floor(rnd() * litGlass.length)].add(m);
          else darkGlass.add(m);
        }
      }
    }
  },

  _blockTrees(sets, bx, bz, block, rnd, laybys = null) {
    // Far enough in that the widest canopy still stops short of the kerb. On
    // the middle of the pavement a big one reached 20 cm past it and hung over
    // the parking space beyond — a tree growing through a parked car.
    //
    // Clamped against the LARGEST canopy rather than each tree's own, so the
    // radius is still drawn in the same order as before and the seed still
    // builds the same city.
    const ring = Math.min(block / 2 - SIDEWALK / 2,
                          block / 2 - (TREE_MAX_RADIUS + TREE_KERB_CLEAR));
    const perSide = 3;
    for (const side of [0, 1, 2, 3]) {
      for (let i = 0; i < perSide; i++) {
        if (rnd() < 0.35) continue;
        const t = (i + 1) / (perSide + 1);
        const along = -block / 2 + block * t + (rnd() - 0.5) * 2;
        let x = bx;
        let z = bz;
        if (side === 0) { x = bx + along; z = bz + ring; }
        else if (side === 1) { x = bx + along; z = bz - ring; }
        else if (side === 2) { x = bx + ring; z = bz + along; }
        else { x = bx - ring; z = bz + along; }
        const trunkH = 1.6 + rnd() * 1.1;
        const r = 1.1 + rnd() * 0.7;
        // Drawn from the sequence first, THEN discarded: taking the numbers in
        // the same order whether or not a tree is planted is what keeps the
        // same seed building the same city.
        if (City._inLayby(laybys, x, z, TREE_MAX_RADIUS)) continue;
        sets.trunks.add(boxMatrix(x, PAVEMENT_Y + trunkH / 2, z, 1, trunkH, 1));
        const canopy = new THREE.Matrix4().compose(
          new THREE.Vector3(x, PAVEMENT_Y + trunkH + r * 0.6, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 3, 0)),
          new THREE.Vector3(r, r * 0.9, r)
        );
        sets.canopies.add(canopy, CANOPY_COLORS[Math.floor(rnd() * CANOPY_COLORS.length)]);
      }
    }
  }
};
