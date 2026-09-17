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
// app.js cannot be imported (it pulls in the bare `three` specifier through
// walk3d.js), so the real function is lifted out of the source, as
// sidebar-panels.test.mjs and mode-switch.test.mjs do.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appLiftable } from "./harness/app-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const app = appLiftable();

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

  const code = app.slice(start, end + 2);
  const cleared = [];
  // The live-channel counters are shared mutable state on appState now, so the
  // lifted function writes THOSE rather than locals declared here.
  const api = new Function("clearTimeout", "appState", `
    let liveUnpublished = true;
    let livePushTimer = 7;
    ${code}
    return {
      resetLiveSequence,
      state: () => ({ liveSeq: appState.liveSeq, liveUnpublished, livePushTimer }),
    };
  `)((t) => cleared.push(t), { liveSeq: 42 });

  check("before the reset the state is dirty",
    api.state().liveSeq === 42 && api.state().liveUnpublished === true);

  api.resetLiveSequence();
  const after = api.state();
  check("the sequence is forgotten", after.liveSeq === 0);
  check("an unpublished push is forgotten", after.liveUnpublished === false);
  check("a pending push timer is cancelled", cleared.length === 1 && cleared[0] === 7);
  check("and cleared, not left dangling", after.livePushTimer === null);

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
