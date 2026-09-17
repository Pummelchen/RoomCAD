// store.js — editing state and operations for RoomCAD web.
// The one place a plan is edited: tools, selection, undo/redo and the remote
// apply all mutate the room here, and the 2D editor reads the result back out.
// It does no I/O — saving, loading and the live channel live in app.js.
//
// Split into roomcad/web/store/ so each concern is navigable, and composed here
// into the one `store` object every caller already imports. Composition rather
// than a rewrite: the methods are exactly as they were, `this` is still the
// store, and the 78 of them are spread over six files instead of one 1436-line
// literal. Nothing outside this file changed.

import { freshState, TOOL_HELP, clockText } from "./store/base.js";
import { notifications } from "./store/notifications.js";
import { walls } from "./store/walls.js";
import { items } from "./store/items.js";
import { editing } from "./store/editing.js";
import { history } from "./store/history.js";

export { TOOL_HELP, clockText };

/// A store of its own, with its own room and its own listeners.
///
/// The app makes one and calls it `store`. Tests make several, because several
/// people editing is the thing being tested, and they must not share a room.
/// Composing from `freshState()` is what makes that true: `Object.assign` would
/// copy a shared object's REFERENCES, so a module-level state object handed to
/// two stores would leave them sharing a room and a listener Set.
///
/// This is deliberately a factory rather than a trick with module caching. The
/// previous way to get a second store was to import `store.js` under a different
/// query string, which works only while the file has no dependencies of its own
/// — and stops working silently, with the stores quietly sharing one room, the
/// moment it does.
export function createStore() {
  return Object.assign(
    {},
    freshState(),
    notifications,
    walls,
    items,
    editing,
    history,
  );
}

export const store = createStore();
