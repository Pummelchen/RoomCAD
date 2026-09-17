// Server presence and latency, polled, and the footer.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Server status (presence + latency), polled every 3 s


import { appState } from "./state.js";

import { appVersion, toast } from "./ui.js";
import { apiLiveDraft } from "./api.js";
import { CLIENT_ID, LIVE_SYNC_MS } from "./watch.js";
import { renderLiveButton } from "./live.js";
import * as P from "../plan.js";
import { APP_VERSION } from "../version.js";
import { store } from "../store.js";

export function updateVersionBadge() {
  let html = "v" + APP_VERSION;
  if (store.serverLatency != null) {
    const ms = store.serverLatency;
    const cls = ms < 150 ? "lat-green" : ms < 400 ? "lat-orange" : "lat-red";
    html += ` · <span class="latency-dot ${cls}"></span> Server ${ms}ms`;
  } else if (store.serverOffline) {
    html += ` · <span class="latency-dot lat-red"></span> offline`;
  }
  appVersion.innerHTML = html;
}

// The status poll reschedules itself from the moment the previous one FINISHES.
// On a plain setInterval an await that outlives the interval lets the next poll
// start anyway, so a server that has become slow — exactly when this matters —
// collects a growing pile of overlapping requests from every open tab and gets
// slower still. Backing off while the server is unreachable also keeps a
// restart from being met with a request storm from every client at once.
//
// Polling deliberately continues in a hidden tab: the server counts a client as
// present from its requests, so pausing would drop people out of the
// collaborator count whenever they switched tabs. Browsers already throttle
// background timers, which is the right amount of restraint here.
export const STATUS_INTERVAL_MS = 3000;
const STATUS_BACKOFF_MAX_MS = 30000;
let statusTimer = null;

export function scheduleStatus(delay) {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(runStatusPoll, delay);
}

export async function runStatusPoll() {
  statusTimer = null;
  const offline = await pollStatus();
  appState.statusBackoff = offline
    ? Math.min(appState.statusBackoff * 2, STATUS_BACKOFF_MAX_MS)
    : STATUS_INTERVAL_MS;
  scheduleStatus(appState.statusBackoff);
}

/// Polls the server once. Resolves true if the server could not be reached.
async function pollStatus() {
  const t0 = performance.now();
  try {
    const res = await fetch("/api/status");
    const ms = Math.round(performance.now() - t0);
    if (res.status === 401) {
      if (window.__roomcadShowLogin) window.__roomcadShowLogin();
      return false;
    }
    const data = await res.json();
    store.presenceCount = data.count || 1;
    store.serverLatency = ms;
    store.serverOffline = false;
  } catch {
    store.serverLatency = null;
    store.serverOffline = true;
    updateVersionBadge();
    renderLiveButton();
    return true;
  }
  updateVersionBadge();
  renderLiveButton();
  return false;
}

let livePushTimer = null;
let liveSyncTimer = null;
let liveUnpublished = false;

/// Forgets this client's position in the watched room's live sequence. The
/// server numbers edits per room, so everything derived from that number — the
/// sequence itself, whether one of our edits is still waiting to go out, and
/// any timer that would publish it against the old baseline — belongs to the
/// room it was learned in and is dropped when the watched room changes.
export function resetLiveSequence() {
  appState.liveSeq = 0;
  liveUnpublished = false;
  if (livePushTimer) clearTimeout(livePushTimer);
  livePushTimer = null;
}

export function scheduleLivePush() {
  if (livePushTimer) clearTimeout(livePushTimer);
  // Something of ours is not out there yet, so we are not in a position to be
  // told we are out of date.
  liveUnpublished = true;
  livePushTimer = setTimeout(() => {
    livePushTimer = null;
    pushLiveDraft();
  }, 150);
}

function pushLiveDraft() {
  if (!store.live || !store.serverRoomName) return;
  apiLiveDraft(P.serializeRoom(store.room), store.serverRoomName, CLIENT_ID,
               store.serverRoomVersion, appState.liveSeq)
    .then(answer => {
      liveUnpublished = false;
      if (answer && answer.stale) {
        // This edit was made against a copy that had already moved on, so it
        // was refused rather than published — otherwise it would have replaced
        // newer work by other people with this older picture. Take what the
        // room actually is now.
        if (typeof answer.seq === "number") appState.liveSeq = answer.seq;
        if (answer.json) {
          store.applyRemoteRoom(P.parseRoom(answer.json),
            answer.version != null ? answer.version : null);
        }
        store.status = "Live: your copy was out of date — caught up, please make that change again";
        store.emit();
        toast("Someone else had already changed this — you are now on their version", "error");
        return;
      }
      if (answer && typeof answer.seq === "number") appState.liveSeq = answer.seq;
    })
    .catch(() => {
      // The edit did not go out, but the flag that says so must not stay set:
      // checkLiveSync refuses to run while it is, so one dropped request would
      // silently switch off the drift check — the exact divergence it exists to
      // catch — until the next edit happened to succeed. Clearing it lets the
      // next check notice and recover, and a later edit re-schedules a push.
      liveUnpublished = false;
      store.status = "Live: could not reach the server";
      store.emit();
      toast("Live sync lost — reconnecting…", "error");
    });
}

/// A fingerprint of the room, computed the way the server computes it.
async function roomDigest(json) {
  const bytes = new TextEncoder().encode(json);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/// Are we still looking at what everyone else is looking at?
///
/// Publishing an edit and hoping it lands is fine until one does not: a dropped
/// stream, a reconnect, a laptop that was asleep. Nothing corrected that, and
/// the two sides diverged quietly for the rest of the session — which is the
/// worst way for a shared drawing to fail, because everyone believes they are
/// looking at the same thing.
///
/// So every couple of seconds each live client asks, with a digest rather than
/// the whole room, and is handed the current state only if it has drifted. It
/// asks only when it has nothing unpublished of its own: otherwise the answer
/// would be "you differ" for the good reason that we are the ones who changed
/// it, and taking that answer would undo our own work.
async function checkLiveSync() {
  if (!store.live || !store.serverRoomName) return;
  if (liveUnpublished || livePushTimer) return;
  if (store.dragTransactionActive) return;
  try {
    const json = P.serializeRoom(store.room);
    const res = await fetch("/api/live-check/" + encodeURIComponent(store.serverRoomName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT_ID, digest: await roomDigest(json) }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.seq === "number" && data.seq > appState.liveSeq) appState.liveSeq = data.seq;
    if (data.inSync) {
      if (data.version != null) store.serverRoomVersion = data.version;
      return;
    }
    // Drifted. Take the shared state — but not on top of an edit made while
    // this was in flight.
    if (liveUnpublished || livePushTimer || store.dragTransactionActive) return;
    const room = P.parseRoom(data.json);
    store.applyRemoteRoom(room, data.version != null ? data.version : null);
    store.status = "Live: caught up with everyone";
    store.emit();
  } catch {
    // A failed check is not worth telling anyone about: the next one is two
    // seconds away, and the push path already reports a server it cannot reach.
  }
}

export function startLiveSync() {
  stopLiveSync();
  liveSyncTimer = setInterval(checkLiveSync, LIVE_SYNC_MS);
}

export function stopLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = null;
}
