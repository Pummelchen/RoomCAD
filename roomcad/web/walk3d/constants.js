// The 3D view's constants: colours, player and physics sizes, the light budget,
// the shadow maps, and the reach of the city's own lights.
//
// Part of walk3d.js, which is split under roomcad/web/walk3d/.


// Material palette: light blue-gray walls, white ceiling, glass, and a white
// marble floor (procedural, below).
import * as THREE from "three";

export const WALL_COLOR = 0x6e88a0;
export const CEILING_COLOR = 0xd9d9d5;
export const GLASS_COLOR = 0x9fc8e0;
export const RUBBLE_COLOR = 0xb9b2a6;   // knocked-out wall, on its way to the pavement
export const LEAF_COLOR = 0x9a6f45;
export const BACKGROUND = 0x141c2c;
export const BULB_COLOR = 0xfff2cf;
export const LIGHT_METAL = 0x33363c;
export const DAY_BACKGROUND = 0x8fb8e0;
export const DAY_FOG = 0xcfe0f0;
export const TWILIGHT_BACKGROUND = 0x6a4a5a; // warm purple-pink dusk sky
export const OVERCAST_SKY = 0x9aa3ad;        // flat grey the sky washes towards in weather
export const NIGHT_BACKGROUND = 0x0a0e1a;
export const NIGHT_FOG = 0x0a0e1a;
// Fog range. This used to end at 130 m, which is inside the city — the outer
// blocks dissolved into flat colour and the world simply stopped. It now
// reaches past the hills the city builds behind itself, so distance reads as
// haze over a horizon instead of as a wall. It stays inside the camera's far
// plane, so the corners of the terrain square are fully fogged before they
// clip. Weather pulls the far edge in; rain closes the view down to a couple
// of streets.
export const FOG_NEAR = 45;
export const FOG_FAR = 380;

// The sky dome has to contain the world under it. It is sized from the city's
// own reach — see cityReach() — because a fixed 200 m sphere is smaller than
// the neighbourhood: city.js lays its grid out to roughly 272 m even for a
// small room, so a player who simply walked to the edge of the streets stood
// OUTSIDE the dome and saw the inside of its back faces from the wrong side.
// The cap is the fog's own far edge, which is also inside the camera's 400 m
// far plane: a larger dome would be clipped away entirely, and past that
// distance the fog has already reduced the world to sky colour anyway.
export const SKY_DOME_MAX = FOG_FAR;

// Player capsule dimensions (metres).
export const PLAYER_RADIUS = 0.20;
export const PLAYER_MASS = 75;         // kilograms
export const PLAYER_FRICTION = 0.6;
export const STAND_HALF_HEIGHT = 0.55; // total standing height 1.5 m
export const CROUCH_HALF_HEIGHT = 0.25; // total crouch height 0.9 m
export const WALK_SPEED = 2.5;
export const GRAVITY = 11;
// The physics runs on a fixed step so it keeps real time whatever the frame
// rate. MAX_SUBSTEPS is how far one frame may catch up — at six a frame the
// world keeps pace down to ten frames a second, and below that it slows down
// rather than spiralling into a catch-up loop it can never win.
export const PHYSICS_STEP = 1 / 60;
export const MAX_SUBSTEPS = 6;
export const MAX_BACKLOG = 0.25;
// Solid traffic. Only what is near enough to touch gets a body; the pool is
// what the solver pays for every frame whether or not it is full.
export const VEHICLE_BODY_POOL = 20;
export const VEHICLE_SOLID_RANGE = 26;
export const VEHICLE_FRICTION = 1.4;   // enough to be carried along on a roof
export const PARKED_FAR_BELOW = -400;  // where an unused pool body waits
// How far above the taller of the room and the street counts as still being in
// the world. Enough to clear the tallest building the city puts up, so standing
// on a roof is not mistaken for having fallen out of the simulation.
export const CITY_HEADROOM = 40;
export const JUMP_SPEED = 3.8;
// How many of the room's own fixtures may hold a real light.
//
// Every one of them casts shadows, on purpose: a point light that does not is a
// light that goes through walls, and stopping that is what the sealed walls and
// the zero shadow bias are for. A shadow-casting point light is six renders of
// the room, so this is the renderer's budget, not a rule about the plan. A plan
// may hold more fixtures than this — they are all drawn, and they all glow —
// and the lights then go to the ones NEAREST THE VIEWER, so no particular lamp
// is the one that is always dead wherever you stand. `roomLightReport()` says
// how many are actually lit, and the inspector shows it, so a lamp that lights
// nothing is never a mystery.
export const MAX_ROOM_LIGHTS = 16;
// The street's own lights. The pool is what the renderer pays for every frame,
// whether or not it is full; the reach is how far away a lamp is still worth
// considering for it.
export const CITY_LIGHT_POOL = 12;
export const CITY_LIGHT_REACH = 55;
// Sunlight shadows. The volume follows the viewer rather than sitting over the
// room, so the resolution goes where it can be seen: 140 m across a 4096 map is
// about 3 cm a texel, which holds up on a kerb.
export const SUN_SHADOW_REACH = 70;
export const SUN_SHADOW_MAP = 4096;
export const SUN_HEIGHT = 120;
// How many of the street lights throw a shadow, and how big a map each gets.
// One, not two. A shadow-casting point light is six renders of the scene, and
// the city it now renders is nine blocks square of sixty storey towers — twelve
// faces of that was 6.5 million triangles a frame. The nearest lamp still casts.
export const CITY_SHADOW_LIGHTS = 1;
export const CITY_SHADOW_MAP = 512;
// The street lamp's shadow bias is ZERO, for the reason written at
// POINT_SHADOW_BIAS below: three.js renders shadow maps from back faces, so a
// closed caster already carries the margin a bias would buy, and a NEGATIVE bias
// does not tighten anything — it lets light through. This one used to set
// -0.004, the exact class of value that comment warns about.
//
// What a 512 map stretched over a lamp's reach does need is a NORMAL bias, which
// moves the sample along the surface normal instead of displacing its depth, and
// is therefore the leak-free way to stop acne. This is the sun's own formula
// applied to this lamp's texel size.
export const CITY_SHADOW_NORMAL_BIAS = (CITY_LIGHT_REACH * 2 / CITY_SHADOW_MAP) * 0.18;
// A layer that only the room's own geometry is on.
//
// A point light shadows its surroundings by rendering the scene six times, once
// per face of a cube. There are up to sixteen of them in a room, so ninety-six
// renders a frame — and once the city started casting shadows, every one of
// those ninety-six drew the whole city: 31 MILLION triangles a frame, for
// lights with a range of fourteen metres that are standing indoors. Their
// shadow cameras are pointed at this layer, which the city is not on.
export const ROOM_ONLY_LAYER = 1;
export const FLOOR_HEIGHT = 3; // metres per building floor

// Room construction uses closed, overlapping solids. The values below are
// deliberate physical construction tolerances (centimetres), not a shadow-map
// trick: walls bite into the slab and ceiling, and wall ends cross their
// neighbours at a join (P.WALL_JOIN_SEAL). That leaves no route for either
// light or the player capsule through a join.
export const WALL_VERTICAL_SEAL = 0.04;
export const CLOSED_DOOR_SEAL = 0.02;
export const POINT_SHADOW_MAP_SIZE = 1024;

// Shadow depth bias must stay at zero. Three.js renders shadow maps from back
// faces (material.shadowSide defaults to BackSide), so the depth recorded for
// a caster is its *far* surface — a whole wall thickness of natural margin
// against acne. A negative bias on top of that is pure light leak: the point
// shadow compares in a non-linear perspective buffer, so a constant -0.0015
// let light through occluders up to 27 cm away at 3 m and 1.9 m away at 8 m,
// which at grazing incidence painted the metre-wide bright bands along every
// floor, ceiling and wall join. Fixing that is what closed the leak; do not
// reintroduce a bias to chase acne.
export const POINT_SHADOW_BIAS = 0;
export const SUN_SHADOW_BIAS = 0;
// Sunlight uses one orthographic map, so it keeps a little normal offset
// against grazing acne — small enough never to read as a gap.
//
// Derived from how big a shadow texel actually is on the ground rather than
// written down. The offset only has to cover the depth error across one texel,
// so it scales with the texel: the old 2 mm was tuned against a map that
// covered the room and nothing else, and a volume that covers the street has
// texels three times the size. Left at 2 mm it would have brought back the
// grazing acne it was put there to stop.
export const SUN_SHADOW_TEXEL = (SUN_SHADOW_REACH * 2) / SUN_SHADOW_MAP;
export const SUN_SHADOW_NORMAL_BIAS = SUN_SHADOW_TEXEL * 0.18;

// How square a run has to be before it counts as axis-aligned. A tenth of a
// millimetre: the editor's own walls are exactly axis-locked, so this is only
// ever asked about a document that came from somewhere else.
export const AXIS_EPS = 0.0001;


// Scratch vector for the viewmodel, which is positioned every frame.
export const _gunOffset = new THREE.Vector3();
export const _viewForward = new THREE.Vector3();
// Scratch for putting paint back onto a moving vehicle. Reused because it runs
// once per carried splat per frame.
export const _carrierMatrix = new THREE.Matrix4();
export const _carrierNormal = new THREE.Vector3();
export const _carrierPoint = new THREE.Vector3();

// Singapore solar position. In the 2D editor the top of the plan is North (0°),
// so azimuth is measured clockwise from North: 0=N, 90=E, 180=S, 270=W.
export const SG_LAT = 1.3521;
export const SG_LON = 103.8198;
export const SG_UTC_OFFSET = 8; // Singapore is UTC+8
