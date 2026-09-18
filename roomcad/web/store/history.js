// Undo, redo, transactions, and the room list.
//
// The undo stack, the transaction that makes a drag one undo step, and
//   replacing the whole room.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";

export const history = {
  // MARK: Undo, redo, transactions
  //
  // These three fields are one thing, not three. `dragTransactionActive` means
  // the TOP of `undoStack` is the pre-drag snapshot `beginDrag` pushed, and
  // while it is true that one entry belongs to the drag: `commit` ends the
  // transaction but KEEPS the snapshot — the drag stays its own undo step — and
  // then pushes the state before its own mutation, `endDrag` keeps it as the
  // drag's own undo step, `discardDrag` throws it away. No other path may pop
  // it. Undo and redo used to pop it and leave the flag set, so the next
  // commit popped the entry UNDERNEATH — the user's most recent real change,
  // silently destroyed. Every path here either owns that snapshot or cancels
  // the transaction that does.

  canUndo() {
    return this.undoStack.length > 0;
  },

  canRedo() {
    return this.redoStack.length > 0;
  },

  undo() {
    // A drag in flight owns the top snapshot and has not been committed, so it
    // is cancelled first: the room goes back to where the drag picked it up and
    // the transaction's snapshot stops being history's business. This ⌘Z then
    // undoes the last committed change, which is what undo means.
    const cancelled = this.discardDrag();
    const previous = this.undoStack.pop();
    if (!previous) {
      // Nothing committed is left to undo. A cancelled drag still moved the room
      // back, so the view has to hear about it even though history did not move.
      if (cancelled) {
        this.clearSelection();
        this.status = "Cancelled the drag";
        this.emit();
      }
      return;
    }
    this.redoStack.push(this.cloneRoom());
    this.room = previous;
    this.clearSelection();
    this.edited = true;
    this.status = "Undid change";
    this.emit();
  },

  redo() {
    // Same cancellation, for the same reason: redo must not run on top of a
    // transaction whose snapshot is still sitting on the undo stack.
    const cancelled = this.discardDrag();
    const next = this.redoStack.pop();
    if (!next) {
      if (cancelled) {
        this.clearSelection();
        this.status = "Cancelled the drag";
        this.emit();
      }
      return;
    }
    this.undoStack.push(this.cloneRoom());
    this.room = next;
    this.clearSelection();
    this.edited = true;
    this.status = "Redid change";
    this.emit();
  },

  commit(message, mutation) {
    // A drag in flight owns the top snapshot: beginDrag parked the pre-drag
    // room there. It is KEPT — this commit does not take it over. Popping it
    // here folded the drag into the commit, so the state the drag started from
    // never entered the history and two undos skipped straight past it. Ending
    // the transaction leaves the drag as its own undo step; the push below
    // records the room as it is now, which is this commit's own step.
    if (this.dragTransactionActive) {
      this.dragTransactionActive = false;
      // The eviction beginDrag did now belongs to a real step, so it stands.
      this.dragDroppedEntry = null;
    }
    this.undoStack.push(this.cloneRoom());
    if (this.undoStack.length > 100) this.undoStack.shift();
    mutation(this.room);
    P.sanitize(this.room);
    // One wall per room, decided as the edit lands.
    //
    // A plan gets drawn as one long wall to set the shape and then dividers to
    // make rooms of it, and the long wall stayed a single wall — so a door in
    // the middle room belonged to a wall spanning all three, measured its
    // position from the far end of the building, and slid the length of the
    // floor. Cutting it where the dividers meet it costs nothing on screen and
    // makes every measurement afterwards belong to the room it is in.
    //
    // Here rather than in sanitize because sanitize also runs on load, and a
    // load that changes the plan means what you saved is not what you get back.
    P.splitWallsAtJunctions(this.room);
    this.redoStack.length = 0;
    this.edited = true;
    this.status = message;
    this.emit();
  },

  beginDrag() {
    if (this.dragTransactionActive) return;
    this.undoStack.push(this.cloneRoom());
    // At the cap the oldest entry has to go, but a drag that is discarded has
    // to leave the stack exactly as it was — so what was evicted is remembered
    // and put back by discardDrag.
    this.dragDroppedEntry = this.undoStack.length > 100 ? this.undoStack.shift() : null;
    this.dragTransactionActive = true;
  },

  endDrag(message) {
    if (!this.dragTransactionActive) return;
    this.dragTransactionActive = false;
    this.dragDroppedEntry = null;
    this.furnitureFeedback = null;
    this.publicFeedback = null;
    P.sanitize(this.room);
    // The same at the end of a drag: a wall dragged up to another one has just
    // made a junction, and this is where that becomes two walls. Not during the
    // drag — a wall would come apart in your hand as it passed things.
    P.splitWallsAtJunctions(this.room);
    this.redoStack.length = 0;
    this.edited = true;
    this.status = message;
    this.emit();
  },

  /// Abandons the drag in flight, and reports whether there was one. The
  /// pre-drag snapshot `beginDrag` pushed is removed from the undo stack, the
  /// room goes back to it — so nothing an uncommitted drag did leaks into the
  /// document — and the flag is cleared, so `dragTransactionActive` can never be
  /// left naming a snapshot that is gone.
  discardDrag() {
    if (!this.dragTransactionActive) return false;
    this.dragTransactionActive = false;
    this.furnitureFeedback = null;
    // A drag carried over another area reads red; abandoning the drag must not
    // leave the canvas painting it red for good.
    this.publicFeedback = null;
    const before = this.undoStack.pop();
    if (before) this.room = before;
    // Put back what beginDrag evicted, so a discarded drag — a click-select is
    // one — leaves the history exactly as it found it.
    if (this.dragDroppedEntry) {
      this.undoStack.unshift(this.dragDroppedEntry);
      this.dragDroppedEntry = null;
    }
    return true;
  },

  cloneRoom() {
    return JSON.parse(JSON.stringify(this.room));
  },

  // MARK: Rooms

  newRoom() {
    // A button called "New Room" has to give a new room. It used to reload the
    // seven-room demo, which meant the one obvious way to start something of
    // your own handed you somebody else's flat. The demo is still what a brand
    // new browser sees when the project has nothing saved.
    this.room = P.freshRoom("My Room", 6, 4, 2.6);
    P.centerRoom(this.room);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    // The room is replaced, so any drag in flight is over; leaving the flag set
    // would have it naming a snapshot that has just been thrown away.
    this.dragTransactionActive = false;
    this.clearSelection();
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.mode = "2d";
    this.rotation = 0;
    this.documentName = null;
    this.serverRoomName = null;
    this.serverRoomVersion = null;
    this.live = false;
    this.timeOfDay = 15;
    this.edited = false;
    this.status = "New room · 600 × 400 cm — drag its walls or set the size on the right";
    this.emit();
  },

  loadRoom(room, name, fromServer = false) {
    this.room = room;
    // A plan drawn before walls were cut at their junctions is brought up to
    // date as it is opened. Reading a file does not change it — sanitize leaves
    // the walls alone — but opening one to work on it is the moment to make the
    // model match the drawing, and the undo history starts here anyway.
    P.splitWallsAtJunctions(this.room);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    // The room is replaced, so any drag in flight is over; leaving the flag set
    // would have it naming a snapshot that has just been thrown away.
    this.dragTransactionActive = false;
    this.clearSelection();
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.mode = "2d";
    this.rotation = 0;
    this.documentName = name || room.name;
    this.serverRoomName = fromServer ? name : null;
    this.serverRoomVersion = null;
    this.live = false;
    this.timeOfDay = 15;
    this.edited = false;
    this.status = "Opened " + this.documentName;
    this.emit();
  },

  /// Applies a room pushed from a teammate over the live channel, without
  /// resetting the current view mode or tool.
  applyRemoteRoom(room, version) {
    this.room = room;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    // The room is replaced, so any drag in flight is over; leaving the flag set
    // would have it naming a snapshot that has just been thrown away.
    this.dragTransactionActive = false;
    this.clearSelection();
    if (version != null) this.serverRoomVersion = version;   // v0 is a real version
    this.edited = false;
    this.status = "Room updated by teammate";
    this.emit();
  },
};
