// City: ground and blocks.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import * as THREE from "three";
import {
  ASPHALT_COLOR,
  BLOCK_SIZE,
  BULB_COLOR,
  CITY_GLASS_COLOR,
  CROSSING_GLOW,
  DAMAGE_SLOTS,
  GRID_RADIUS,
  GROUND_DEPTH,
  HILL_GRASS_COLOR,
  HILL_HEIGHT,
  HILL_REACH,
  HILL_ROCK_COLOR,
  INTERIOR_COLOR,
  INTERIOR_GLOW,
  INTERIOR_LIT_COLOR,
  LAMP_POLE_COLOR,
  LIGHTS_OUT_EVERY,
  LIGHTS_OUT_HEADROOM,
  LIGHTS_OUT_SPARE,
  LIT_BANDS,
  MARKING_COLOR,
  ROAD_WIDTH,
  ROAD_Y,
  SIDEWALK,
  SIGNAL_DARK,
  SIGNAL_HOUSING_COLOR,
  SIGNAL_POLE_COLOR,
  TERRAIN_FLAT_MARGIN,
  TERRAIN_SEGMENTS,
  TRUNK_COLOR,
  WINDOW_DARK,
  WINDOW_LIT,
} from "./constants.js";
import {
  clamp01,
  fbm,
  makeRandom,
  smootherstep,
  smoothstep,
  valueNoise,
} from "./helpers.js";
import { _color, _colorB } from "./matrices.js";
import { InstanceSet } from "./instance-set.js";
import { City } from "../city.js";

export const ground_blocks = {

  /// True when the existing city still fits this building and floor.
  matches(bounds, seed, floorLift) {
    return this.key === City.keyFor(bounds, seed, floorLift);
  },

  /// Builds the neighbourhood around `bounds`. `floorLift` is how high the
  /// room sits, so the block it belongs to gets a tower of that height under
  /// it and the room never appears to float.
  build(bounds, seed, floorLift) {
    this.clear();
    this.key = City.keyFor(bounds, seed, floorLift);
    const rnd = makeRandom(seed);

    // The room's own block has to be big enough to hold the building.
    const block = Math.max(BLOCK_SIZE, bounds.width + SIDEWALK * 4, bounds.length + SIDEWALK * 4);
    const span = block + ROAD_WIDTH;
    const cx = bounds.centerX;
    const cz = bounds.centerZ;
    const reach = City.reachFor(bounds);
    // The building's plot, kept clear of paving. The edge tucks a few
    // centimetres under the wall line so the pavement meets the building
    // without either a gap or a slab poking up inside a ground-floor room.
    const tuck = 0.04;
    const plot = {
      x0: bounds.minX + tuck, x1: bounds.maxX - tuck,
      z0: bounds.minZ + tuck, z1: bounds.maxZ - tuck,
    };

    const sets = {
      facades: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
        // Room to blow holes in. Each one turns a piece of wall into as many
        // as four, so this is the budget for how much of the city can be
        // knocked about before it stops taking damage.
        // Everything added here must be UNROTATED — punchHole reads the size
        // back off the matrix diagonal (see City.boxOf).
        { spare: DAMAGE_SLOTS, casts: true, receives: true }
      ),
      roofs: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
        { casts: true, receives: true }
      ),
      flats: new InstanceSet(       // pavements, kerbs, grass, road paint
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
        { casts: false, receives: true }
      ),
      darkGlass: new InstanceSet(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: WINDOW_DARK, roughness: 0.25, metalness: 0.1 }),
        // Room to take the windows that go dark as the night wears on, the way
        // the near blocks' rooms already do.
        { colored: false, spare: LIGHTS_OUT_SPARE }
      ),
      // Glazing for the buildings you can see into. The distant ones get an
      // opaque pane apiece and that is all a window needs at that range; the
      // near ones have real rooms behind them, so their glass has to be glass —
      // a pane you look THROUGH, catching the light at a glance. Without it
      // they read as buildings with the windows left out.
      glazing: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: CITY_GLASS_COLOR, roughness: 0.06, metalness: 0.1,
          transparent: true, opacity: 0.26, depthWrite: false,
        }),
        { colored: false }
      ),
      // A lit window in a tower is a lit ROOM behind it, and rooms are not all
      // lit the same. The near blocks have had bands of brightness since the
      // interiors were built; the towers had one flat value for every window in
      // the city, so a hundred floors of glass all came on at exactly the same
      // brightness at exactly the same moment. Same bands, same night, one set
      // of rules for every tower.
      litGlass: LIT_BANDS.map(() => new InstanceSet(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({
          color: WINDOW_DARK, emissive: WINDOW_LIT, emissiveIntensity: 0, roughness: 0.3,
        }),
        { colored: false }
      )),
      // Interiors are boxes seen from the inside: only their back faces are
      // drawn, so looking through a window opening shows the far wall of the
      // room rather than the outside of a block sitting in the hole.
      // The zebra crossings, on their own set: they are the one piece of paint
      // that lights up after dark, and a material has one emissive term for
      // everything drawn with it.
      crossings: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: MARKING_COLOR, emissive: CROSSING_GLOW, emissiveIntensity: 0,
          roughness: 0.7, metalness: 0,
        }),
        { colored: false, casts: false, receives: true }
      ),
      // With room to take every light that goes out overnight. A room whose
      // light is switched off is still a room: drop the lit instance without
      // adding a dark one and the window shows through to nothing.
      roomsDark: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: INTERIOR_COLOR, roughness: 0.95, metalness: 0, side: THREE.BackSide,
        }),
        { colored: false, spare: LIGHTS_OUT_SPARE }
      ),
      // One set per brightness band. A material has ONE emissive intensity, so
      // rooms of different brightness cannot share a mesh; instance colour
      // multiplies the diffuse term, not the emissive one, so that will not do
      // it either. Six bands from a tenth to full is enough that no two windows
      // on a facade look the same, and it costs five extra draw calls.
      roomsLit: LIT_BANDS.map(() => new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: INTERIOR_LIT_COLOR, emissive: INTERIOR_GLOW, emissiveIntensity: 0,
          roughness: 0.95, metalness: 0, side: THREE.BackSide,
        }),
        { colored: false }
      )),
      litBulbs: LIT_BANDS.map(() => new InstanceSet(
        new THREE.SphereGeometry(0.085, 6, 4),
        new THREE.MeshStandardMaterial({
          color: BULB_COLOR, emissive: BULB_COLOR, emissiveIntensity: 0, roughness: 0.4,
        }),
        { colored: false }
      )),
      bulbs: new InstanceSet(
        new THREE.SphereGeometry(0.085, 6, 4),
        new THREE.MeshStandardMaterial({
          color: BULB_COLOR, emissive: BULB_COLOR, emissiveIntensity: 0, roughness: 0.4,
        }),
        { colored: false }
      ),
      trunks: new InstanceSet(
        new THREE.CylinderGeometry(0.13, 0.18, 1, 6),
        new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 1 }),
        { colored: false, casts: true, receives: true }
      ),
      canopies: new InstanceSet(
        new THREE.IcosahedronGeometry(1, 0),   // low-poly blob reads as stylised
        new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
        { casts: true, receives: true }
      ),
      poles: new InstanceSet(
        new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
        new THREE.MeshStandardMaterial({ color: LAMP_POLE_COLOR, roughness: 0.7, metalness: 0.3 }),
        { colored: false, casts: true, receives: true }
      ),
      signalPoles: new InstanceSet(
        new THREE.CylinderGeometry(0.06, 0.08, 1, 6),
        new THREE.MeshStandardMaterial({ color: SIGNAL_POLE_COLOR, roughness: 0.6, metalness: 0.4 }),
        { colored: false, casts: true, receives: true }
      ),
      signalHousings: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: SIGNAL_HOUSING_COLOR, roughness: 0.7 }),
        { colored: false, casts: true, receives: true }
      ),
      signalDark: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: SIGNAL_DARK, roughness: 0.5 }),
        { colored: false }
      ),
      lampHeads: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0xf6efd8, emissive: 0xffe6b0, emissiveIntensity: 0, roughness: 0.4,
        }),
        { colored: false, casts: true, receives: true }
      ),
    };

    this._groundMaterials = [sets.flats.material];
    this._terrain(cx, cz, reach, span, seed);

    // Roads, lanes and kerbside spaces are laid out BEFORE the pavements,
    // because a bus stop is a layby and a layby is a piece missing from the
    // pavement. The pads cannot be built until it is known where those pieces
    // go.
    this._layoutRoads(cx, cz, span);
    // Its OWN stream, not the one the blocks and buildings are drawing from.
    // Moving this work earlier moved every later draw from `rnd` along with it,
    // which quietly rebuilt the whole city — different buildings in different
    // places, and 1158 surfaces that now happened to land at the same depth as
    // each other. The layout must not care when the traffic is laid out.
    const trafficRnd = makeRandom(seed ^ 0x5bf03635);
    this._buildTraffic(cx, cz, span, reach, trafficRnd);
    this._layoutParking(cx, cz, span, block, trafficRnd);
    const laybys = this._laybyRects();

    // What the player can stand on and walk into, gathered as the city is
    // built rather than worked out again afterwards. Without it there is
    // nothing outside the room at all: step through a broken window and you
    // fall through the pavement you can plainly see.
    this.solids = [];
    // The carriageway, one slab under the whole neighbourhood. Everything else
    // is a step up from it.
    this.solids.push({
      x: cx, y: ROAD_Y - GROUND_DEPTH / 2, z: cz,
      w: reach * 2, h: GROUND_DEPTH, d: reach * 2,
    });

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const home = gx === 0 && gz === 0;
        this._blockPad(sets.flats, bx, bz, block, home ? plot : null, laybys);
        if (home) {
          this._homeTower(sets, bounds, floorLift, rnd);
        } else {
          // Only the ring of blocks you can actually see into gets hollow
          // buildings with rooms behind the windows. Further out the fog has
          // them, and a solid block with flat windows is indistinguishable.
          const near = Math.abs(gx) <= 1 && Math.abs(gz) <= 1;
          this._blockBuildings(sets, bx, bz, block, rnd, near, gx, gz);
        }
        this._blockTrees(sets, bx, bz, block, rnd, laybys);
      }
    }

    this._crossingSet = sets.crossings;
    this._roadMarkings(sets.flats, cx, cz, block, span);
    this._paintKerbside(sets.flats, laybys);
    this._trafficSignals(sets.signalPoles, sets.signalHousings, sets.signalDark, cx, cz);
    this._streetLamps(sets.poles, sets.lampHeads, cx, cz, block, span, laybys);
    // Destinations come after the bays exist, and only for cars: a bus runs a
    // route and a truck stops where the work is.
    for (const v of this.cars) if (v.kind === "car") v.goal = this._pickGoal(v);
    this._parkStartingCars(trafficRnd);
    this._buildSignalLamps();
    this._buildTurnArrows();
    this._buildPrecipitation(rnd);

    sets.facades.build(this.group, "city-facades");
    // Kept, so a paintball can find the piece of wall it hit and rebuild it.
    this.facadeSet = sets.facades;
    sets.roofs.build(this.group, "city-roofs");
    sets.flats.build(this.group, "city-ground-details");
    this.crossings = sets.crossings.build(this.group, "city-crossings");
    // Headroom for the windows that go dark as the night wears on, sized to
    // the city rather than to a number picked in advance: a fixed 700 was a
    // whole night's worth for the near blocks' 1,000 rooms and about seven
    // minutes' worth for a hundred thousand tower windows, so the city stopped
    // getting darker almost as soon as it started.
    const litCount = sets.litGlass.reduce((n, set) => n + set.items.length, 0);
    sets.darkGlass.spare = Math.max(LIGHTS_OUT_SPARE, Math.ceil(litCount * LIGHTS_OUT_HEADROOM));
    sets.darkGlass.build(this.group, "city-windows-dark");
    sets.glazing.build(this.group, "city-window-glass");
    this.litWindows = sets.litGlass.map((set, i) => set.build(this.group, `city-windows-lit-${i}`));
    this.darkWindows = sets.darkGlass.mesh;
    this.roomsDark = sets.roomsDark.build(this.group, "city-rooms-dark");
    this.roomsLit = sets.roomsLit.map((set, i) => set.build(this.group, `city-rooms-lit-${i}`));
    this.litBulbs = sets.litBulbs.map((set, i) => set.build(this.group, `city-bulbs-${i}`));
    // How many rooms each band started with, so turning them off can walk down
    // the counts without having to know which instance is which.
    this.litInBand = this.roomsLit.map(m => (m ? m.count : 0));
    this._litOutAt = LIGHTS_OUT_EVERY;
    this._extinguished = [];
    this.bulbs = sets.bulbs.build(this.group, "city-bulbs");
    sets.trunks.build(this.group, "city-tree-trunks");
    sets.canopies.build(this.group, "city-tree-canopies");
    sets.poles.build(this.group, "city-lamp-poles");
    this.lampHeads = sets.lampHeads.build(this.group, "city-lamp-heads");
    sets.signalPoles.build(this.group, "city-signal-poles");
    sets.signalHousings.build(this.group, "city-signal-housings");
    sets.signalDark.build(this.group, "city-signal-lenses");

    this.group.traverse(node => {
      if (node.isInstancedMesh) {
        this._disposables.push(node.geometry, node.material);
      }
    });
    this.applyTimeOfDay(this._dayAmount);
    this.setWeather(this._weather);
  },

  // MARK: - Ground and blocks

  /// The land the city sits on. Flat under every street — a city is levelled
  /// ground, and the room's own floor sits at the same datum — then rolling
  /// beyond the last kerb and climbing into hills at the far edge, so the
  /// world ends in a horizon rather than fading out into empty fog.
  _terrain(cx, cz, reach, span, seed) {
    const flatTo = reach + span * TERRAIN_FLAT_MARGIN;
    const outer = flatTo + HILL_REACH;
    // The mesh carries on well past the ridge. `t` is clamped, so everything
    // beyond stays at ridge height — a plateau rather than an edge. Without it
    // the world simply stops at the top of the hills, and any dip in the ridge
    // line is a window onto nothing. What is out there is fogged out long
    // before the camera's far plane clips it.
    const size = (outer + 90) * 2;
    const geo = new THREE.PlaneGeometry(size, size, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const ground = new THREE.Color(ASPHALT_COLOR);
    const grass = new THREE.Color(HILL_GRASS_COLOR);
    const rock = new THREE.Color(HILL_ROCK_COLOR);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      // Chebyshev distance, because the city is a square of blocks: this keeps
      // the flat region square with the street grid instead of cutting corners
      // off the outermost blocks.
      const d = Math.max(Math.abs(lx), Math.abs(lz));
      const t = clamp01((d - flatTo) / (outer - flatTo));
      let y = 0;
      if (t > 0) {
        const wx = cx + lx;
        const wz = cz + lz;
        // Gentle undulation that grows with distance, so the join at the last
        // street is seamless rather than a step. It only ever rises: the
        // street datum is also the room's own floor level, and ground that
        // dips below it opens a gap at the edge of the city that you can see
        // straight under the pavement through.
        const roll = fbm(wx / 90, wz / 90, seed);   // 0..1, never negative
        y += smoothstep(clamp01(t * 2.2)) * 9 * roll;
        // The ridge itself. It has to reach full height WELL before the edge
        // of the mesh: ramping all the way out means the only part of it above
        // the city's rooflines is its lowest shoulder, and from a window there
        // is nothing to see. Full height by about 240 m, plateau beyond.
        const ridge = smootherstep(clamp01((t - 0.10) / 0.50));
        y += ridge * HILL_HEIGHT * (0.45 + 0.55 * fbm(wx / 165 + 40, wz / 165 - 25, seed + 7));
        pos.setY(i, y);
      }

      // Asphalt under the streets, blending out to pasture and then to bare
      // rock as the hills rise. The colour turns at the last block rather than
      // where the ground starts to move: keeping it grey out to there leaves a
      // wide apron of asphalt around the city with nothing on it, which reads
      // as a car park the size of the town.
      _color.copy(grass).lerp(rock, clamp01((y - 8) / (HILL_HEIGHT * 0.72)));
      const shade = 0.9 + 0.2 * valueNoise((cx + lx) / 11, (cz + lz) / 11, seed + 3);
      _color.multiplyScalar(shade);
      _colorB.copy(ground).lerp(_color, clamp01((d - (reach - ROAD_WIDTH)) / 16));
      colors[i * 3] = _colorB.r;
      colors[i * 3 + 1] = _colorB.g;
      colors[i * 3 + 2] = _colorB.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const land = new THREE.Mesh(geo, mat);
    land.name = "city-terrain";
    land.position.set(cx, ROAD_Y, cz);
    land.receiveShadow = true;
    land.castShadow = false;
    land.frustumCulled = false;
    this.group.add(land);
    this.terrain = land;
    this._groundMaterials.push(mat);
    this._disposables.push(geo, mat);
  }
};
