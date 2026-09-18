// Server presence and latency, polled, and the footer.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.
// MARK: - Server status (presence + latency), polled every 3 s


import { appState, STATUS_INTERVAL_MS } from "./state.js";

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
// The interval itself lives on `appState`'s module, which owns it because the
// backoff starts at it; status.js re-exports it so the rest of the app keeps one
// import for the poll.
export { STATUS_INTERVAL_MS };
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
// Which local edit a push belongs to. `scheduleLivePush()` numbers every edit,
// and a push remembers the number it went out under, so an answer from an older
// push can tell that a newer edit is still waiting and must not be applied over
// it — `applyRemoteRoom()` clears both undo stacks.
let liveEditGeneration = 0;

/// Is an edit of ours still on its way to the server?
///
/// A teammate's update must not be applied over it: `applyRemoteRoom()` clears
/// both undo stacks, so the local edit would be gone and had never been sent.
/// The stream handler asks this before touching the room; the flags live here
/// because this module owns the push.
export function liveEditPending() {
  return liveUnpublished || livePushTimer !== null;
}

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
  liveEditGeneration += 1;
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
  const generation = liveEditGeneration;
  apiLiveDraft(P.serializeRoom(store.room), store.serverRoomName, CLIENT_ID,
               store.serverRoomVersion, appState.liveSeq)
    .then(answer => {
      if (answer && answer.stale) {
        // A newer local edit was scheduled while this one was in flight. The
        // server's copy predates that edit, so applying it — or adopting its
        // sequence, which would let the newer push win against the work that
        // made this one stale — would lose it. Leave this answer to the newer
        // push, which will be answered on its own terms.
        if (generation !== liveEditGeneration || store.dragTransactionActive) return;
        liveUnpublished = false;
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
      // Only settle this push's own flag: a newer edit owns it while it waits.
      if (generation === liveEditGeneration) liveUnpublished = false;
      if (answer && typeof answer.seq === "number") appState.liveSeq = answer.seq;
    })
    .catch(() => {
      // The edit did not go out, but the flag that says so must not stay set:
      // checkLiveSync refuses to run while it is, so one dropped request would
      // silently switch off the drift check — the exact divergence it exists to
      // catch — until the next edit happened to succeed. Clearing it lets the
      // next check notice and recover, and a later edit re-schedules a push.
      if (generation === liveEditGeneration) liveUnpublished = false;
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
  let data;
  try {
    const json = P.serializeRoom(store.room);
    const res = await fetch("/api/live-check/" + encodeURIComponent(store.serverRoomName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT_ID, digest: await roomDigest(json) }),
    });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    // A failed request is not worth telling anyone about: the next check is two
    // seconds away, and the push path already reports a server it cannot reach.
    return;
  }
  if (data.inSync) {
    // Nothing is applied — the local room already matches — but the server's
    // sequence is authoritative here, so it is safe to adopt.
    if (typeof data.seq === "number" && data.seq > appState.liveSeq) appState.liveSeq = data.seq;
    if (data.version != null) store.serverRoomVersion = data.version;
    return;
  }
  // Drifted. Take the shared state — but not on top of an edit made while
  // this was in flight.
  if (liveUnpublished || livePushTimer || store.dragTransactionActive) return;
  let room;
  try {
    room = P.parseRoom(data.json);
  } catch (err) {
    // The shared copy could not be read. Leave the sequence alone: adopting it
    // would make the next edit look like it was built on a copy we never took,
    // and the server would accept it over the very work that made us drift.
    // Say so rather than swallow it — the client is still out of date.
    store.status = "Live: could not catch up with everyone — the shared update was unreadable";
    store.emit();
    console.warn("Live catch-up ignored:", err);
    return;
  }
  store.applyRemoteRoom(room, data.version != null ? data.version : null);
  if (typeof data.seq === "number" && data.seq > appState.liveSeq) appState.liveSeq = data.seq;
  store.status = "Live: caught up with everyone";
  store.emit();
}

export function startLiveSync() {
  stopLiveSync();
  liveSyncTimer = setInterval(checkLiveSync, LIVE_SYNC_MS);
}

export function stopLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = null;
}
