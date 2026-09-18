// The per-room live-collaboration state.
//
// The live sequence is kept PER ROOM by the server: `POST /api/live/<name>`
// refuses a publish whose `baseSeq` is not the room's current sequence. The
// client's counter was module-global and never reset, so after being live in
// one room (sequence now high) and joining live in another (sequence low), the
// first edit there was published with an inflated baseSeq — refused as stale,
// the local edit discarded, and the person told to make the change again. Every
// newly-opened room silently ate its first edit.
//
// app.js is importable now, and so is the module that owns this state:
// roomcad/web/app/status.js. `resetLiveSequence` is imported and called for
// real; the flags it clears are private, so they are observed through the
// exported `liveEditPending()` and through the timers the module schedules.

import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { appSource } from "./harness/app-source.mjs";

// Before anything from the app is imported: a bare specifier inside
// roomcad/web/ resolves through the page's own import map.
registerHooks({ resolve });
installDOM({ page: true });

const { resetLiveSequence, scheduleLivePush, liveEditPending } =
  await import("../roomcad/web/app/status.js");
const { appState } = await import("../roomcad/web/app/state.js");

// The source, for the contracts at the bottom that are about the source.
const app = appSource();

let failed = 0;
let passed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
    return;
  }
  passed++;
}

// ── resetLiveSequence() clears everything the room owned ──────────────────
{
  const start = app.indexOf("function resetLiveSequence()");
  const end = app.indexOf("\n}", start);
  check("the reset can be located", start > 0 && end > start);

  // The module schedules its push through the global timer functions, so they
  // are handed in here: a real id back, and every cancel recorded.
  const realTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const cleared = [];
  const timers = new Map();
  let nextTimer = 7;
  globalThis.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => { cleared.push(id); timers.delete(id); };

  // The live-channel counters are module-private now, so the dirty state is
  // established the way the app establishes it — a scheduled push — and read
  // back through liveEditPending(), which is the module's own answer to "is
  // one of ours still on its way?".
  appState.liveSeq = 42;
  scheduleLivePush();
  check("before the reset the state is dirty",
    appState.liveSeq === 42 && liveEditPending() === true);

  resetLiveSequence();
  check("the sequence is forgotten", appState.liveSeq === 0);
  check("an unpublished push is forgotten", liveEditPending() === false);
  check("a pending push timer is cancelled", cleared.length === 1 && cleared[0] === 7);
  check("and cleared, not left dangling", !timers.has(7));

  globalThis.setTimeout = realTimeout;
  globalThis.clearTimeout = realClearTimeout;

  // The un-wedge half: a FAILED push used to leave liveUnpublished set, and the
  // drift check early-returns while it is set — one dropped request and the
  // client stopped noticing it had diverged from its teammates for the rest of
  // the session.
  const pushed = app.slice(app.indexOf("function pushLiveDraft"));
  const catchBlock = pushed.slice(pushed.indexOf(".catch("), pushed.indexOf(".catch(") + 500);
  check("a failed live push un-wedges the drift check",
    /liveUnpublished = false/.test(catchBlock));
}

// ── The reset is wired to a room CHANGE, not to every watch ───────────────
//
// Saving re-watches the same room, and the save itself has just moved that
// room's sequence on — forgetting it there would refuse the very next edit.
{
  check("watching a different room resets the sequence",
    /if \(name !== watchedRoomName\) resetLiveSequence\(\);/.test(app));
  check("the watched room is remembered",
    /watchedRoomName = name;/.test(app));
  // stopWatching() re-stops the sync interval; re-watching must start it again
  // or a live client quietly stops checking whether it has drifted.
  check("re-watching restarts the drift check for a live client",
    /if \(store\.live\) startLiveSync\(\);/.test(app));
}

console.log(`${passed} passed, ${failed} failed — live collaboration state`);
if (failed) process.exit(1);
