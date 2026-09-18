// The city's module-level helpers: the seeded generator the place is built from,
// the one seam that reaches for real randomness, and the value noise the hills
// are shaped with.
//
// Part of city.js, which is split under roomcad/web/city/.

/// Genuinely unpredictable, for decisions a vehicle makes while the city is
/// running. Everything that BUILDS the city — where the buildings go, how tall
/// they are, which windows are lit, where the hills are — uses the seeded
/// generator below instead, so reopening a room gives back the same place.
/// What the traffic then does in it is not meant to be the same twice: reload
/// the room and the cars take different turnings.
///
/// This is the only place the city reaches for real randomness, which is what
/// lets a test check that the geometry never does.
///
/// It is swappable so that a test which has to WATCH a vehicle over hundreds of
/// frames can make the drive reproducible. Every use below is in code that runs
/// while the traffic is driving (a turn, a pace, a stop, a parking bay) — none
/// of it is reached while the city is being built — so swapping this out cannot
/// change the streets. Consumption of real randomness is what made
/// tests/city-physics.test.mjs flaky: it picks the first eligible bus and asks
/// whether it carried its passenger five metres, and a bus that happened to
/// brake for a light a second in made that inconclusive rather than wrong.
let transportRandom = Math.random;
export function trueRandom() {
  return transportRandom();
}

/// Replaces the traffic's runtime randomness. Pass a seeded generator to make a
/// drive repeatable; pass nothing (or a non-function) to restore Math.random.
/// Production never calls this.
export function setTransportRandom(fn) {
  transportRandom = typeof fn === "function" ? fn : Math.random;
}

/// Deterministic PRNG (mulberry32) so a given room always gets the same city.
export function makeRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Stable 32-bit hash of a string, so a room id maps to one city.
export function seedFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = t => t * t * (3 - 2 * t);
export const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);

/// Hash of a lattice point, for the terrain. Deterministic in the seed, so the
/// same room gets the same hills every time it is opened.
export function latticeHash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/// Value noise in 0..1, smooth enough that the terrain has no visible lattice.
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = smootherstep(x - ix);
  const v = smootherstep(z - iz);
  const a = latticeHash(ix, iz, seed);
  const b = latticeHash(ix + 1, iz, seed);
  const c = latticeHash(ix, iz + 1, seed);
  const d = latticeHash(ix + 1, iz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/// Several octaves of it, which is what turns smooth blobs into landscape.
export function fbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
