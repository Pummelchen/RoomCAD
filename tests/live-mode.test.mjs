// Source contracts for the deliberate Join Live / Leave Live Mode flow.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");
const css = readFileSync(join(root, "roomcad", "web", "styles.css"), "utf8");

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

check("toolbar exposes a Join Live button", html.includes('id="live-room"') && html.includes(">Join Live</button>"));
check("toolbar exposes the red leave action", html.includes('id="leave-live-room"') && html.includes(">Leave Live Mode</button>"));
check("second-session invitation uses Join Live text", app.includes('liveButton.textContent = store.live ? "Live Active" : "Join Live";'));
check("live drafts wait safely for an explicit join", app.includes("let pendingLiveDraft = null;") && app.includes("pendingLiveDraft = { room, version: data.version }"));
check("joining never pushes stale local data immediately", !app.includes("pushLiveDraft(); // publish our current state right away"));
check("leave saves before detaching the watcher", app.includes("const saved = await saveRoom({ watch: false });") && app.includes("stopWatching({ detached: true });"));
check("leave failure keeps the editor live", app.includes("still in Live Active"));
check("Join Live has a slow neon pulse", css.includes("#live-room.join-live") && css.includes("@keyframes roomcad-live-pulse"));
check("leave action is styled red", css.includes("#toolbar #leave-live-room.live-leave"));

// Status polling. setInterval around an await lets a slow server collect
// overlapping requests from every open tab, which makes it slower still.
check("status polls are scheduled one at a time, not on a fixed interval",
  !app.includes("setInterval(pollStatus") && app.includes("scheduleStatus(statusBackoff)"));
check("the next poll is scheduled only after the previous one resolves",
  app.includes("const offline = await pollStatus();"));
check("pollStatus reports whether the server could be reached",
  app.includes("/// Polls the server once. Resolves true if the server could not be reached."));
check("an unreachable server is backed off from rather than hammered",
  app.includes("Math.min(statusBackoff * 2, STATUS_BACKOFF_MAX_MS)"));
check("backoff is bounded",
  /STATUS_BACKOFF_MAX_MS\s*=\s*\d+/.test(app));
check("returning to the tab refreshes immediately",
  app.includes('addEventListener("visibilitychange"') && app.includes("scheduleStatus(0)"));
check("a hidden tab keeps counting as present",
  !app.includes("if (document.hidden) {\n    scheduleStatus"));

console.log(`${passed} passed, ${failed} failed — live collaboration UI contracts`);
if (failed) process.exit(1);
