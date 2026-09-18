// audio.js — tiny procedural sound effects (no asset files).
//
// A sound is a garnish: it must never be able to abort the edit that asked for
// it. Creating the context can throw the documented NotSupportedError where
// WebAudio exists but cannot start, `resume()` can reject, and a node or param
// call can throw for a state the platform has moved on from — so the context is
// guarded and every sound is built behind one boundary that turns any of it
// into silence.

let ctx = null;

function ensureCtx() {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      // A rejected resume() is an unhandled rejection, which is a throw by
      // another name — the promise has no other handler.
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
    }
    return ctx;
  } catch {
    // `new AudioContext()` raises NotSupportedError where the platform cannot
    // start one. The sound is a garnish, so the edit carries on in silence.
    ctx = null;
    return null;
  }
}

/// Builds and starts one sound through `build(ac)`. Anything it throws is
/// reduced to silence: the alternative is an exception escaping into the
/// pointer or key handler that made the edit.
function play(build) {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    build(ac);
  } catch {
    // Deliberate, and the whole point: a failed sound is silence. There is
    // nothing to report and nothing to undo — the edit itself has already
    // landed.
  }
}

/// A short "plop" — a quick low pop, like a paintball leaving the barrel.
export function playPlop() {
  play(ac => {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  });
}

/// An old heavy wooden door — a low creak, then a dull thud.
export function playDoorSound() {
  play(ac => {
    const t = ac.currentTime;

    // Creak (descending sawtooth through a narrow band-pass).
    const creak = ac.createOscillator();
    const creakGain = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(240, t);
    filter.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    filter.Q.value = 8;
    creak.type = "sawtooth";
    creak.frequency.setValueAtTime(180, t);
    creak.frequency.exponentialRampToValueAtTime(95, t + 0.25);
    creakGain.gain.setValueAtTime(0.0001, t);
    creakGain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    creakGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    creak.connect(filter).connect(creakGain).connect(ac.destination);
    creak.start(t);
    creak.stop(t + 0.3);

    // Thud (low sine, fast decay).
    const thud = ac.createOscillator();
    const thudGain = ac.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(95, t + 0.18);
    thud.frequency.exponentialRampToValueAtTime(50, t + 0.35);
    thudGain.gain.setValueAtTime(0.0001, t + 0.18);
    thudGain.gain.exponentialRampToValueAtTime(0.4, t + 0.2);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    thud.connect(thudGain).connect(ac.destination);
    thud.start(t + 0.18);
    thud.stop(t + 0.52);
  });
}
