// The city's constants: the layout, the palette, the terrain, the building
// interiors, the traffic, the signals, the kerbside rules and the weather.
//
// Part of city.js, which is split under roomcad/web/city/.

// Layout, in metres.
export const BLOCK_SIZE = 46;   // one city block
export const ROAD_WIDTH = 13;   // carriageway between two blocks
export const SIDEWALK = 3.2;    // pavement inset around a block
export const KERB_HEIGHT = 0.16;
// The room's own floor slab is this thick (walk3d builds it), and the tower
// underneath has to stop clear of it. Ending the tower level with the slab put
// two horizontal faces at exactly the same depth across the whole room, which
// z-fought and read as a flickering floor.
export const ROOM_SLAB_THICKNESS = 0.06;
export const TOWER_REVEAL = 0.02;
// Height datum. The pavement top is the room's own floor level, so a ground
// floor room opens straight onto the street; the carriageway is one kerb down.
export const PAVEMENT_Y = 0;
export const ROAD_Y = PAVEMENT_Y - KERB_HEIGHT;
// Blocks each way from the room. The room stands on the middle block, so the
// grid is always odd — four each way is nine by nine, which is the nearest a
// centred grid gets to eight.
export const GRID_RADIUS = 4;

export const FLOOR_HEIGHT = 3;         // matches walk3d's per-storey lift
// Every tower is a high rise: fifty, fifty-five or sixty floors. Three heights
// rather than one keeps a skyline — a city of identical towers reads as a
// texture, not as buildings — and rather than a range because these are the
// heights that were asked for.
export const STOREY_CHOICES = [50, 55, 60];
// How far up a building you can see into. Rooms behind the windows are what
// gives a facade depth, and they cost an instance each — a sixty storey tower
// modelled all the way up is thousands of them for floors nobody can see into
// from the street. Above this it is windows only.
export const ROOM_STOREYS = 8;

// Terrain. The streets themselves stay dead flat — a city is levelled ground,
// and the room's own floor sits on it — so the land only starts moving beyond
// the last kerb, and climbs into hills far enough out to read as the horizon.
export const TERRAIN_SEGMENTS = 168;
// Close enough that the fog has not swallowed them — walk3d fogs out at 380 m
// and the camera stops at 400 — and far enough that the whole city sits in
// front of them. Push the ridge further out and it becomes flat fog-coloured
// nothing, which is the problem it exists to solve.
export const HILL_REACH = 105;         // metres from the last street to the ridge
// Tall enough to clear the rooflines. A six-storey building 60 m away hides
// everything below about 60 m at the far side of the city, so a ridge of half
// that height is behind the skyline and might as well not be there — which is
// exactly how the first attempt at this looked from a window.
export const HILL_HEIGHT = 100;
export const TERRAIN_FLAT_MARGIN = 0.35;  // of one block span, kept level

// A friendly, slightly sun-bleached palette. Saturated enough to read at a
// distance, muted enough not to fight the room's own materials.
export const FACADE_COLORS = [
  0xe8ddc8, 0xd9a389, 0xa8b89a, 0x8fa9c0, 0xc98d7a,
  0xe4cf9a, 0x9fc4b8, 0xcbb9d4, 0xd7d2c8, 0xb08d76,
];
export const ROOF_COLOR = 0x6f6a63;
export const ASPHALT_COLOR = 0x3a3d44;
export const SIDEWALK_COLOR = 0xb9b6ad;
export const KERB_COLOR = 0x9a978f;
export const GRASS_COLOR = 0x6f9457;
export const MARKING_COLOR = 0xe6e2d4;
// A crossing picks up the light at night the way retroreflective paint does —
// soft, green, and clearly a crossing from the far end of the street.
export const CROSSING_GLOW = 0x39ff9e;
export const CROSSING_GLOW_POWER = 0.5;
export const BAY_LINE_COLOR = 0xd8d3c2;    // the box a car parks inside
export const BUS_BOX_COLOR = 0xb8452f;     // bus stops are painted, and only for buses
export const TRUNK_COLOR = 0x6b4f36;
export const GROUND_DEPTH = 2;         // how thick the walkable ground slab is made
// Damage. A paintball takes a metre square out of a wall, which is enough to
// climb through and small enough that a building still reads as a building.
export const HOLE_SIZE = 1.0;
export const HOLE_MIN_PIECE = 0.06;    // below this a leftover sliver is simply dropped
export const HOLE_REACH_DOWN = 1.7;    // a hit this near the foot of a wall opens it at the foot
export const DAMAGE_SLOTS = 160;       // spare instances to rebuild broken walls from
export const TREE_MAX_RADIUS = 1.8;    // the biggest canopy _blockTrees will draw
export const TREE_KERB_CLEAR = 0.3;    // ... and how far short of the kerb it must stop
export const CANOPY_COLORS = [0x5c8a45, 0x6f9c52, 0x4e7a3b];
export const LAMP_POLE_COLOR = 0x4a4d53;
// City lighting. Every one of these has a REACH, because a light that carries
// forever is a light that has to be considered everywhere — and the only way to
// afford three hundred of them is to know which few can be seen.
export const LAMP_LIGHT_COLOR = 0xffd9a0;
export const LAMP_LIGHT_POWER = 13;   // half strength: a street lamp is not a floodlight
export const LAMP_LIGHT_REACH = 17;
export const HEADLAMP_COLOR = 0xfff4e0;
export const HEADLAMP_POWER = 12;
export const HEADLAMP_THROW = 13;
export const BRAKE_LIGHT_COLOR = 0xff2a18;
export const BRAKE_LIGHT_POWER = 4;
export const BRAKE_LIGHT_REACH = 6;
export const WINDOW_DARK = 0x2d3a4a;
export const WINDOW_LIT = 0xffd9a0;
// Hills: pasture near the bottom, bare rock towards the tops.
export const HILL_GRASS_COLOR = 0x5f8a4c;
export const HILL_ROCK_COLOR = 0x7c7466;

// Building interiors. A room is a box open towards its window, so what you see
// through the opening is its far wall — which is why the windows have depth.
export const CITY_WALL_T = 0.34;       // thickness of a city building's outer wall
export const ROOM_DEPTH = 2.6;         // how far a room reaches back from its window
export const WIN_W = 1.25;
export const WIN_H = 1.55;
export const WIN_SILL = 0.85;
export const WIN_PITCH = 2.1;          // horizontal spacing between window centres
// Clearance between the back of a room and the solid middle of the building.
// Without it the two surfaces land on exactly the same plane, both get drawn —
// the core's face towards the viewer, the room's back wall away from it — and
// the depth buffer cannot choose between them. That is the flicker you see
// through every window of every building.
export const CORE_CLEAR = 0.16;
export const INTERIOR_COLOR = 0x5d564c;
export const INTERIOR_LIT_COLOR = 0x7a6a55;
export const INTERIOR_GLOW = 0xffd9a2;
// How brightly a lit room burns, as a fraction of full. Every room draws one of
// these when the city is built, so no two windows on a facade match — a wall of
// identically lit squares reads as a texture rather than as rooms with people
// in them.
export const LIT_BANDS = [0.10, 0.28, 0.46, 0.64, 0.82, 1.00];
// And they go out. As the night gets deeper a room every so often goes dark, at
// this share of the lit ones per five minutes.
export const LIGHTS_OUT_SHARE = 0.01;
export const LIGHTS_OUT_EVERY = 5 * 60;
export const LIGHTS_OUT_SPARE = 700;   // dark-room instances held back for them
/// The share of a tower's lit windows that can go dark before the night runs
/// out of room to put them. At one per cent every five minutes, a quarter is a
/// couple of hours of night — longer than anyone watches one — and costs a
/// matrix apiece for windows that are mostly never used.
export const LIGHTS_OUT_HEADROOM = 0.25;
export const BULB_COLOR = 0xfff0cc;
// The glow from inside a vehicle: dim, warm, and a little above the lamps.
export const CABIN_GLOW = 0xffc98a;
export const CABIN_HEIGHT = 0.34;
export const CORE_COLOR = 0x241f1b;    // the solid middle, so you cannot see through
// House numbers, drawn as blocks rather than as text. A texture per building
// would mean a canvas and an upload each; a 3x5 block font costs a handful of
// instances and suits a city made of boxes.
export const DIGIT_ROWS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};
export const DIGIT_CELL = 0.062;
export const ENTRANCE_COLOR = 0x2b2622;   // the doorway itself, in shadow
export const SURROUND_COLOR = 0xd8d2c4;   // stone surround and canopy
export const STEP_COLOR = 0xb9b3a6;
export const NUMBER_PLATE = 0x1d1a17;
export const NUMBER_COLOR = 0xe8c46a;     // brass, and bright enough to read at night


export const CAR_COLORS = [
  0xd94f4f, 0x4f7fd9, 0xe0c04a, 0x53b06a, 0xdedede,
  0x2f3238, 0xd98a4f, 0x8f6fd0,
];
export const TRUCK_COLORS = [0xdfe2e6, 0x3f6fa8, 0xc8563c, 0x4a4f57, 0xd9c89a];
export const BUS_COLORS = [0xd23f36, 0x2f6f3f, 0xe0a52c, 0x3a5f9e];
export const VAN_COLORS = [0xf2f4f7, 0xdfe3e8, 0xc8ced6, 0x8d9aa8, 0x3f6fae];
export const CITY_GLASS_COLOR = 0xcfe2ee;  // the pane in a near building's window
export const CITY_GLASS_T = 0.04;
export const CITY_GLASS_INSET = 0.07;      // set back from the face, so it is in a reveal

// Traffic.
export const LANE_OFFSET = 2.9;        // lane centre from the road centreline
export const LIGHT_CYCLE = 30;         // the nominal cycle, and what a balanced junction still runs
export const GREEN_MIN = 6;            // never shorter, however empty the approach
export const GREEN_MAX = 26;           // never longer, however long the queue
export const GREEN_EXTEND = 2;         // held on, while vehicles are still coming through
export const QUEUE_REACH = 45;         // how far back from a junction a vehicle counts as queueing
export const QUEUE_SLOW = 1.5;         // ... and how slow it has to be to count as waiting rather than arriving
export const LIGHT_AMBER = 2.0;
// All-red after the amber. A bus entering on the last of the green needs
// several seconds to drag twelve metres of itself out of a thirteen-metre
// box; without this interval the crossing traffic is released while it is
// still in there.
// Two seconds, not the three and a half it started at. Nothing enters a
// junction it cannot clear before the crossing direction is released — that is
// checked per vehicle, against its own length and speed — so this interval is
// a margin rather than the thing keeping the junction safe, and every second of
// it is a second in which nobody moves.
export const LIGHT_CLEAR = 2.0;
export const TURN_RADIUS = 5.4;
export const INDICATE_FROM = 24;       // metres before a junction the indicator starts
export const TURN_REVIEW_FROM = 14;    // ... and the last point one can be reconsidered
// Which way round a turn is, given traffic keeps right: turning right stays on
// your own side of the road, turning left cuts across the oncoming lane and has
// to give way to it. Reversed from what these were when traffic kept left.
export const NEAR_SIDE_TURN = 1;
export const CROSSING_TURN = -1;
export const BLINK_HZ = 1.5;
// Suspension. Small angles — a car under heavy braking dips a couple of
// degrees, not ten — but the eye reads them immediately.
export const PITCH_PER_G = 0.012;      // radians per m/s2 of acceleration
export const PITCH_MAX = 0.055;
export const ROLL_PER_G = 0.016;       // radians per m/s2 of sideways push
export const ROLL_MAX = 0.075;
export const SUSPENSION_RATE = 5;      // how fast it settles, per second
export const SAFE_GAP = 2.4;
export const NOSE_TO_TAIL = 0.12;      // the least space two vehicles may share a lane with
export const SEPARATE_STEP = 0.06;     // how far one may be nudged back in a frame           // bumper-to-bumper metres at a standstill
// Every driver has their own pace. The kind of vehicle sets the base speed —
// a bus is not a hatchback — and this is the multiplier on top of it, so some
// press on and some dawdle. Without it a lane of the same kind moves as one
// block, which is the thing that makes model traffic look modelled.
export const PACE_SLOWEST = 0.90;
export const PACE_FASTEST = 1.20;
// How many vehicles are on the streets altogether, spread over every lane.
export const FLEET_SIZE = 680;
// Which traffic is worth drawing. A vehicle is around a thousand triangles and
// the fleet is FLEET_SIZE of them, so it costs hundreds of thousands — enough
// that not drawing the ones behind you is worth the bookkeeping.
//
// Culled on DIRECTION rather than distance. A distance cut has to be set past
// where a car is still several pixels across — 150 m — which only removes about
// two fifths of the fleet, and whatever it does remove pops out of existence in
// plain view. Anything behind you is not visible at any distance, so that is
// what goes: a generous cone, wider than the field of view so nothing vanishes
// at the edge of the frame, and everything close kept regardless of where you
// happen to be looking.
export const VEHICLE_KEEP_NEAR = 40;   // drawn whichever way you are facing
export const VEHICLE_CONE = Math.cos(70 * Math.PI / 180);

// Kerbside stopping.
//
// A thirteen-metre street will not take a parked bus AND passing buses: at any
// offset that clears the running lane the bus is up on the pavement, and at any
// offset inside the kerb something wide clips it. So only cars use the bays as
// parking. A bus at a stop pulls over as far as it fits and the traffic behind
// it waits, which is what a kerbside stop without a layby does; a truck loading
// stops in the lane outright, which is what they do everywhere.
export const PARK_OFFSET = 2.5;        // a parked car, clear of the running lane
export const VAN_OFFSET = 2.6;         // a van at the kerb, offloading
// How much room a stopped vehicle has to leave beside it before the traffic
// stops having to go round: half the widest vehicle, and a little.
export const LANE_CLEAR = 1.5;
export const BUS_STOP_OFFSET = 3.4;    // right into the layby, out of the running lane
export const BAY_PITCH = 7.0;          // one parking space
export const RESERVE_TTL = 40;         // how long a vehicle may hold a space it has not reached
// No bay within this of a junction centre. The stop line is at ten metres and
// the crossing just inside it, so this leaves several metres of clear kerb
// before either.
export const PARK_CLEAR = 16;
export const PARK_SHARE = 0.5;         // at most this fraction of the fleet parked at once
export const PARK_MIN = 5 * 60;        // five minutes
export const PARK_MAX = 120 * 60;      // two hours
export const PARK_APPROACH = 26;       // how far off a vehicle starts lining up for its space
export const KERB_EASE_FROM = 7;       // ... and how close before it starts pulling over
export const PARK_PATIENCE = 15 * 60;  // how long it holds out for the space it set off for
export const START_PARKED = 0.9;       // of the parking cap, filled before the city starts
// Reversing into a space, as two arcs of opposite lock: swing the tail in, then
// straighten. The geometry is fixed by the two of them having to add up to the
// distance from the running lane to the kerb — 2R(1-cos t) across, 2R sin t
// along — so choosing the angle chooses the radius and the run-up.
export const REVERSE_ANGLE = 35 * Math.PI / 180;
export const REVERSE_RADIUS = PARK_OFFSET / (2 * (1 - Math.cos(REVERSE_ANGLE)));
export const REVERSE_RUN = 2 * REVERSE_RADIUS * Math.sin(REVERSE_ANGLE);
export const REVERSE_SPEED = 1.1;      // walking pace, backwards
export const REVERSE_SLACK = 1.8;      // the room a gap needs beyond the vehicle itself
export const MANOEUVRE_WAIT = 1.2;     // the pause between stopping and selecting reverse
export const UNLOAD_MIN = 5 * 60;      // a van at the kerb, offloading
export const UNLOAD_MAX = 15 * 60;
export const UNLOAD_CHANCE = 0.02;     // per free bay a van passes
export const BUS_DWELL_MIN = 60;       // a bus calls for a minute
export const BUS_DWELL_MAX = 300;      // ... and at most five
export const BUS_STOP_COOLDOWN = 90;   // it does not call at two stops in a row
export const BUS_STOPS_PER_BLOCK = 2;  // out of the block's four sides
export const LAYBY_DEPTH = 2.6;        // how far a bus stop is cut back into the pavement
// How much kerb a vehicle needs beyond its own length. Parallel parking wants
// about half a vehicle of slack, and at 2.5 m a 6.6 m van claimed a single 7 m
// bay — four centimetres of room at each end. It reversed into it and clipped
// whatever was parked in front: 18 contacts in fifteen minutes. At 4 m a van
// takes two bays and simply pulls in, and a car still takes one.
export const BAY_CLEARANCE = 4.0;
export const BAY_LINE_W = 0.12;        // painted bay markings
export const BAY_LENGTH = 5.6;         // the box itself, inside the pitch
export const PARK_BOX_DEPTH = 2.3;     // how far the painted box reaches into the road
export const BUS_LAYBY_LENGTH = 17;    // room for a bus and a little clear at each end
// Junction furniture. A driver meets the stop line, then the crossing, then
// the carriageway, so the crossing sits between the line and the junction.
export const CROSS_GAP = 0.6;          // carriageway edge to the near edge of the crossing
export const CROSS_DEPTH = 2.6;        // how deep the crossing is, along the road
export const CROSS_BAR = 0.55;         // one white bar, across the road
export const CROSS_BAR_GAP = 0.45;
export const STOP_LINE_W = 0.35;
// Where a vehicle's nose comes to rest, measured out from the junction centre:
// the far side of the crossing, which is what the stop line is painted on.
export const STOP_LINE_AT = ROAD_WIDTH / 2 + CROSS_GAP + CROSS_DEPTH + STOP_LINE_W;
// ── Turn control ──────────────────────────────────────────────────────────
// Each approach carries three turn arrows on top of its main signal, and the
// manager reds out the ones that would feed a street which is already full.
// This is what keeps the grid from seizing: the jam is not caused by too many
// vehicles but by spillback — a vehicle waiting at the line for room in the
// lane it wants to turn into blocks everyone behind it, including the ones
// who were going somewhere empty. A measured run had 26 held at stop lines
// with nowhere to turn into and 129 more queued behind them.
export const TURN_CONTROL_PERIOD = 2;   // seconds between reviews
export const TURN_SLOT = 8;            // road length one vehicle and its gap occupy
export const TURN_LOAD_FLOOR = 0.5;    // never red-out a street emptier than this
export const TURN_LOAD_FACTOR = 1.35;  // ... nor one within this much of the average
export const ROUTE_CONGESTION = 2.5;   // how many junctions of detour a full street is worth

/// How far a street lamp keeps from a signal pole.
///
/// A signal head is 3.4 m up and read from tens of metres back along the arm;
/// a lamp post 2 m in front of one hides it from exactly the traffic it is
/// telling to stop. Measured as a box rather than a radius because the thing
/// being kept clear is the sight line down the street, not a circle.
export const SIGNAL_CLEAR = 3.2;
/// How close two street lamps may stand. They are 23 m apart by design; this is
/// only a floor to stop one that has been moved out of the way of a signal
/// ending up beside its neighbour.
export const LAMP_MIN_GAP = 9;
/// How close two lamps may stand when there is nowhere else to put one.
///
/// Still far enough apart that they light different stretches of pavement —
/// two posts a few metres apart light the same patch twice — but close enough
/// that a lamp squeezed between a signal and a bus stop can stand somewhere
/// rather than not at all.
export const LAMP_CROWDED_GAP = 8.5;
export const SIGNAL_HEIGHT = 3.4;
export const SIGNAL_HEAD_H = 0.86;
export const SIGNAL_POLE_COLOR = 0x33363b;
export const SIGNAL_HOUSING_COLOR = 0x24272b;
export const SIGNAL_DARK = 0x15171a;
export const SIGNAL_RED = 0xff2a1e;
export const SIGNAL_AMBER = 0xffa617;
export const SIGNAL_GREEN = 0x2ce05a;
export const ARROW_PITCH = 0.17;       // sideways spacing of the three turn arrows
export const ARROW_DROP = 0.11;        // how far the arrow bar hangs below the main head
export const ARROW_SIZE = 0.115;
// The hardest any vehicle on these streets can brake. A follower has to assume
// the one in front might stop as fast as that, which is what keeps a truck —
// which cannot — far enough back from a car that can.
export const BRAKE_MAX = 5.6;

// Weather is drawn as a box of drops around the viewer rather than over the
// whole city: a few thousand is then enough to fill any window in the room.
export const PRECIP_RADIUS = 26;
export const PRECIP_HEIGHT = 30;

/// The kinds of vehicle on the streets. `share` is how common each is; the
/// rest is what makes them behave differently — a bus pulls away from a light
/// far more slowly than a hatchback, and needs a great deal more room to stop.
///
/// `cruise` is the base speed for the KIND, in metres per second. The spread
/// within a kind comes entirely from each driver's own pace, so the two do not
/// compound: a range here multiplied by a range there gave cars anything from
/// 34 to 58 km/h, which is a wider gap than the streets should have.
export const VEHICLE_REF = {
  car: { L: 4.45, W: 1.78, wheelR: 0.34, lampY: 0.62 },
  van: { L: 6.0, W: 1.9, wheelR: 0.38, lampY: 0.70 },
  truck: { L: 9.7, W: 2.42, wheelR: 0.5, lampY: 0.86 },
  bus: { L: 11.35, W: 2.5, wheelR: 0.5, lampY: 0.72 },
};

export const VEHICLE_KINDS = [
  {
    kind: "car", share: 0.66, length: [4.0, 4.9], width: 1.78,
    bodyH: 0.70, roofH: 0.58, roofFrac: 0.52, axles: 2,
    cruise: 11.5, accel: 2.8, brake: 5.6, colors: CAR_COLORS,
    mass: 1350, load: 350, grip: 3.6,
  },
  {
    // The delivery van: short enough to pull into a parking bay, which is the
    // whole point of it. Loading used to be done by the artics, standing in the
    // running lane for ten minutes at a time — a lane closed, on a grid with
    // one lane each way.
    kind: "van", share: 0.12, length: [5.4, 6.6], width: 1.9,
    bodyH: 1.02, roofH: 0.72, roofFrac: 0.62, axles: 2,
    cruise: 10.0, accel: 2.2, brake: 5.0, colors: VAN_COLORS,
    // A van's load is most of its weight, which is why an empty one drives
    // like a car and a full one does not.
    mass: 2100, load: 1400, grip: 3.0,
  },
  {
    kind: "truck", share: 0.08, length: [8.4, 11.0], width: 2.42,
    bodyH: 1.18, roofH: 1.25, roofFrac: 0.3, axles: 3,
    cruise: 8.8, accel: 1.5, brake: 4.2, colors: TRUCK_COLORS,
    mass: 9000, load: 16000, grip: 2.3,
  },
  {
    kind: "bus", share: 0.14, length: [10.5, 12.2], width: 2.5,
    bodyH: 2.05, roofH: 0.5, roofFrac: 0.9, axles: 3,
    cruise: 8.5, accel: 1.4, brake: 4.0, colors: BUS_COLORS,
    // Tall and heavy: the limit on how fast it can corner is the risk of going
    // over, not of sliding.
    mass: 11000, load: 6000, grip: 2.2,
  },
];

// Weather. `wet` darkens the ground the way rain does; `haze` is how much the
// air itself closes in, which walk3d reads to pull the fog in around the
// viewer. Snow settles as a pale wash rather than a dark one.
export const WEATHER_KINDS = ["clear", "cloudy", "rain", "snow"];
export const WEATHER = {
  clear: { drops: 0, wet: 0, haze: 0, fall: 0, sway: 0, dim: 0 },
  cloudy: { drops: 0, wet: 0.12, haze: 0.35, fall: 0, sway: 0, dim: 0.25 },
  rain: { drops: 2600, wet: 0.62, haze: 0.75, fall: 17, sway: 0.7, dim: 0.45 },
  snow: { drops: 1700, wet: 0.30, haze: 0.6, fall: 1.5, sway: 1.5, dim: 0.35 },
};
