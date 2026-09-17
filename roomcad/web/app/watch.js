// Watching a room: the live channel, and what to do with what arrives.
//
// Part of app.js, which is split under roomcad/web/app/ and composed in
// ../app.js — imported there in the order this code used to run in.

import { appState } from "./state.js";

import { resetLiveSequence, startLiveSync, stopLiveSync } from "./status.js";
import * as P from "../plan.js";
import { store } from "../store.js";

// A per-tab identity so a client can ignore its own live-update echo.
export const CLIENT_ID = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
// How often a live client checks it is still looking at the same drawing as
// everyone else. Two seconds is short enough that nobody works for long on a
// stale plan, and long enough that it costs a digest rather than a room.
export const LIVE_SYNC_MS = 2000;

export let eventSource = null;
// What this client's copy of the shared room is based on. The server hands one
// out with every copy it sends and refuses an edit built on an older one, which
// is what stops a client that has fallen behind from republishing its stale
// picture over everyone else's work.
export let liveDetached = false;
// Which room `liveSeq` belongs to. The server numbers live edits PER ROOM, so a
// sequence learned in one room says nothing about another — and carrying it over
// makes the first edit in a newly-opened room look like it was built on a copy
// from the future.
let watchedRoomName = null;

export function stopWatching({ detached = false } = {}) {
  stopLiveSync();
  if (eventSource) eventSource.close();
  eventSource = null;
  appState.pendingLiveDraft = null;
  if (detached) {
    liveDetached = true;
    // We have stopped watching, so we are no longer learning this room's
    // sequence; re-learn it from the stream when we next watch anything.
    resetLiveSequence();
  }
}

/// Subscribes to live updates for a server room (Google-Docs style sharing).
/// What an update from the watcher means for this client.
///
/// Pulled out of the event handler so it can be stated and tested on its own.
/// It is four lines of decision that decide whether a teammate's work appears
/// on your screen, and it was wrong in a way nobody could see: a live draft
/// carries the SENDER's version, and a receiver on any other version dropped it
/// silently. One save by either side and the two versions differ from then on,
/// so live editing worked right up until somebody saved and never again — which
/// is exactly when people start collaborating.
///
/// Returns { action, version }, where action is one of: "ignore", "hold"
/// (remember it in case they join), "live" (apply as a draft), "saved" (apply a
/// teammate's save). `version` is the version to adopt, or null to keep the one
/// we have.
///
/// The version is part of the answer rather than something the caller works out
/// for itself. It is the second half of the same bug — a draft that arrived but
/// left the version behind meant the audience could not see that we had moved
/// to v3 — and a caller that decides it separately is a second copy of the rule
/// that can disagree with this one.
export function liveUpdateAction(data, state) {
  const nothing = { action: "ignore", version: null };
  if (!data || data.name !== state.serverRoomName) return nothing;
  if (data.clientId === state.clientId) return nothing;    // our own echo
  if (state.dragTransactionActive) return nothing;         // never clobber a drag
  const version = data.version != null ? data.version : null;
  if (data.live) {
    // Not gated on the version. While live, the draft IS the shared state, and
    // whoever sent it is by definition further along than we are. It carries
    // the sender's version, and taking it is what keeps the two sides on one
    // baseline instead of drifting apart.
    return { action: state.live ? "live" : "hold", version };
  }
  // A real save from anyone. The watcher sends the current version on connect,
  // so the one we already have is a no-op rather than a teammate's update.
  if (data.version === state.serverRoomVersion) return nothing;
  return { action: "saved", version };
}

export function watchRoom(name) {
  stopWatching();
  liveDetached = false;
  // The sequence is per room on the server. Watching a different room with the
  // previous room's sequence still in hand publishes the first edit here with a
  // baseSeq this room has never reached, so the server refuses it as stale and
  // the person's first edit in every newly-opened room is silently replaced by
  // the server's copy. Forgetting it makes the stream's first message — which
  // carries this room's real sequence — the baseline. re-watching the same room
  // (saving does that) keeps the sequence, which the save itself has moved on.
  if (name !== watchedRoomName) resetLiveSequence();
  watchedRoomName = name;
  // stopWatching stops the sync check; re-watching is not leaving, so a live
  // client keeps checking. Saving re-watches, and that is exactly when a
  // client must not quietly stop noticing it has drifted.
  if (store.live) startLiveSync();
  try {
    eventSource = new EventSource("/api/watch/" + encodeURIComponent(name));
    eventSource.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        const { action, version } = liveUpdateAction(data, {
          serverRoomName: store.serverRoomName,
          serverRoomVersion: store.serverRoomVersion,
          clientId: CLIENT_ID,
          live: store.live,
          dragTransactionActive: store.dragTransactionActive,
        });
        // The sequence travels with every copy of the room, including our own
        // echo: a client that ignores the message still has to know what the
        // shared state is now, or its next edit is refused as stale.
        if (typeof data.seq === "number" && data.seq > appState.liveSeq) appState.liveSeq = data.seq;
        if (action === "ignore") return;
        const room = P.parseRoom(data.json);
        if (action === "hold") {
          // Remembered while the user considers joining, so Join Live adopts
          // the teammate's work instead of overwriting it.
          appState.pendingLiveDraft = { room, version };
          return;
        }
        store.applyRemoteRoom(room, version);
      } catch (err) {
        console.warn("Live update ignored:", err);
      }
    };
  } catch (err) {
    console.warn("Live stream failed to open:", err);
  }
}
