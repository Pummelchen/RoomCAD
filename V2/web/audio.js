// audio.js — tiny procedural sound effects (no asset files).

let ctx = null;

function ensureCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/// A short "plop" — a quick low pop, like a paintball leaving the barrel.
export function playPlop() {
  const ac = ensureCtx();
  if (!ac) return;
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
}

/// An old heavy wooden door — a low creak, then a dull thud.
export function playDoorSound() {
  const ac = ensureCtx();
  if (!ac) return;
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
}
