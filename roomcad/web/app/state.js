// The few values that more than one part of the app both reads and writes.
//
// These were module-level `let`s in app.js, which was fine while app.js was one
// file. Split into modules, an imported binding CANNOT be assigned to: writing
// `leavingLive = true` in live.js against a `let` declared in watch.js is a link
// error — "Assignment to constant variable" — not a stale read, and it is the one
// thing that made this split more than mechanical. Five of them are written from
// two or three different sections.
//
// A property of a shared object is writable from anywhere the object is
// imported, and that is what these honestly are: app-wide flags rather than one
// section's private state. Putting them in one place also makes the sharing
// visible, which it was not when they were five `let`s scattered down a
// two-thousand-line file.

// How often the server is polled for presence and latency. It lives here rather
// than in status.js because `statusBackoff` has to START at it, and status.js
// cannot supply it: status.js reads this object while it evaluates, so an import
// the other way is a cycle, and the constant would be in its temporal dead zone.
export const STATUS_INTERVAL_MS = 3000;

export const appState = {
  walk3d: null,   // the 3D walkthrough, built on first use
  liveSeq: 0,   // the server's sequence number for live edits
  leavingLive: false,   // true while leaving, so the buttons cannot double-fire
  pendingLiveDraft: null,   // a teammate's unsaved draft, held while the user decides
  // The current poll interval, backing off while offline. It starts at the
  // interval, not at 0: `Math.min(0 * 2, …)` is 0 forever, which re-polls an
  // unreachable server as fast as it can refuse.
  statusBackoff: STATUS_INTERVAL_MS,
};
