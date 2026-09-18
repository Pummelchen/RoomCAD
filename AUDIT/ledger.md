# AUDIT ledger — RoomCAD pre-production audit

**Generated from `AUDIT/ledger.json`. Do not edit by hand.**

Branch: `audit/2026-09-18` · Base: `dbba4df`

Totals: **46 tasks** — done:0 open:46 blocked:0

Open count (the number that ends the run) = **46**.

| severity | total | done | open | blocked |
| -------- | ----- | ---- | ---- | ------- |
| S0 | 6 | 0 | 6 | 0 |
| S1 | 17 | 0 | 17 | 0 |
| S2 | 20 | 0 | 20 | 0 |
| S3 | 3 | 0 | 3 | 0 |

## Tasks

### S0

#### T0001 — Prototype split dbba4df dropped four runtime imports, so the 3D walkthrough cannot start

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/walk3d/scene-building.js:88; walk3d/sun.js:17,19,33; walk3d/scene-building-3.js:239; walk3d/paintball.js:20`
- **host**: mac-local · **discovered by**: eslint no-undef + git show dbba4df^ + node repro + subagent
- **evidence (before)**: dbba4df re-added THREE but not RoomEnvironment (scene-building.js:88), SG_LON/SG_LAT/SG_UTC_OFFSET (sun.js:17/19/33), seedFromString (scene-building-3.js:239) or playPlop (paintball.js:20). Each is a ReferenceError on the normal 3D path: start() is caught and shows '3D failed to start: RoomEnvironment is not defined'; applyTimeOfDay() throws out of store.emit(); syncCity() aborts the build; every paintball shot throws. Reproduced each with node against the real modules. `./tests/run.sh --fast` is green (31 files, 1492 assertions) while 3D is dead.

#### T0002 — sanitize() is not total on a malformed document: five dereference sites throw a TypeError and the whole room is lost

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/plan/sanitize.js:106-108,120-122,154-155,275-284,288-290`
- **host**: mac-local · **discovered by**: manual Tier A read + node repro + subagent
- **evidence (before)**: Proven with node: walls:[null] / [{}] / a wall with no start -> TypeError at sanitize.js:155 via wallLength (walls.js:13); furniture with a known kind but no/null center -> TypeError at 282; publicAreas:[null] -> TypeError at 289; canvas/origin as a truthy primitive -> TypeError at 107/121 (ES modules are strict). sanitize.js:266-272 states in its own words that losing the whole document over one bad field 'is the one failure a repair pass must not have'.

#### T0003 — detectRooms() cache key omits wall identity, so outsideFacingWalls() returns another room's wall ids and outer walls silently unlock

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/plan/rooms.js:35-41,56,186,195-198`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: roomSignature() keys on wall coordinates only, while the cached value outsideWalls is a Set of wall IDS. Two door-less rooms with identical geometry but different ids (exactly store.newRoom() twice via freshRoom()+centerRoom()) share a signature. Proven: outsideFacingWalls(A) has 4 ids; outsideFacingWalls(B) returns A's ids, wallDragLocked(B, B.walls[0]) is false, 0 of B's 4 outer walls locked.

#### T0004 — Widening a door/window from the inspector silently deletes it

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/store/walls.js:314-327`
- **host**: mac-local · **discovered by**: subagent (store audit), node repro
- **evidence (before)**: updateOpeningWidth() clamps only to MIN/MAX_OPENING_WIDTH, never to what the wall can hold. A 1.10 m wall legally holds a 0.90 m door; dragging the Width slider to 1.00 (inside the slider's own [0.6,1.4]) makes endDrag run sanitize(), whose doorsWallShort filter (sanitize.js:237) drops the door. Proven: doors 1 -> 0, status still 'Set width', selectedDoorID dangling.

#### T0005 — The SVG title block prints the bounding-box area, not the floor area

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/svg.js:221-234`
- **host**: mac-local · **discovered by**: subagent (editor2d/svg audit), node repro
- **evidence (before)**: `const area = (room.width * room.length).toFixed(2)` while syncExtent() sets width/length to the overall wall extent and its own comment says the enclosed floor is floorArea(). Proven on an L-shaped 6x6 plan: the sheet says 36.00 m2 while P.floorArea(room) is 27.00 m2; tests/live-mode.test.mjs:76 already forbids (room.width*room.length) for the inspector.

#### T0006 — liveSeq is adopted for live messages that are then dropped, so a stale client's next push overwrites a teammate's accepted work

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: concurrency
- **where**: `roomcad/web/app/watch.js:105-124`
- **host**: mac-local · **discovered by**: subagent (app audit), node + end-to-end repro
- **evidence (before)**: watch.js:115 advances appState.liveSeq before line 116 drops the message on a drag and before line 117 can throw on parseRoom. The server's only stale guard is baseSeq (server.py:1087). Proven both ways: (a) a teammate draft ignored mid-drag still advances the seq, so the release push is accepted and replaces it; (b) an unparseable payload advances the seq, the throw is swallowed at 125, and the client's next push (baseSeq = current) is accepted over a peer's work, clearing the peer's undo stack via applyRemoteRoom.

### S1

#### T0007 — POST /api/save does not validate the json field: a dict or list kills the request with an unhandled sqlite3 error

- **status**: OPEN
- **tier**: A · **project**: P2 roomcad/server · **category**: input-validation
- **where**: `roomcad/server/server.py:1123-1130`
- **host**: mac-local · **discovered by**: manual Tier A read + live repro
- **evidence (before)**: `room_json = data.get("json", "")` is passed straight to save_room(), unlike client_id which is str()-coerced. POSTing {"json":{"a":1}} or [1,2] to a throwaway server yields no response (client sees RemoteDisconnected) and `sqlite3.ProgrammingError: Error binding parameter 3: type 'dict' is not supported` in the journal; {"json":5} is accepted and stored.

#### T0008 — SSAO and bloom silently never run: the TSL imports were dropped by the split

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/walk3d/environment-builders.js:194-212`
- **host**: mac-local · **discovered by**: subagent (3D audit) + eslint no-undef
- **evidence (before)**: setupSaoBloom() uses pass/mrt/output/emissive/normalView (three/tsl), ssao (addons SSAONode) and bloom (addons BloomNode), none of which is imported. setupPostProcessing() catches the ReferenceError, logs, and sets renderPipeline=null, so the shipped post-processing never appears and only a console line says so.

#### T0009 — The floor texture canvas is sized by room area with no cap: a legal 60 m plate is 9600² (351 MB) and exceeds the WebGPU 8192 texture limit

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: numeric
- **where**: `roomcad/web/walk3d/rapier-physics-2.js:82-90`
- **host**: mac-local · **discovered by**: subagent (3D audit), measured
- **evidence (before)**: makeFloorCanvas() derives canvas.width/height from tileLayout(width,length) at 96 px per tile. Measured: 20 m -> 3264²; 50 m -> 8064² (248 MB); 60 m -> 9600² (351 MB), redrawn per build. sanitize() allows a 60 m plate (sanitize.js:100) and the vendored renderer requests no raised maxTextureDimension2D.

#### T0010 — Stub walls are dropped before clamping, so clamping can create a new stub that only disappears on the next load

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/plan/sanitize.js:154-171,186-193`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: The 15 cm length test runs on the raw wall and only then are both endpoints clamped into the plate. A wall entirely off the plate clamps to a zero-length wall and survives the pass; serializeRoom->parseRoom is not idempotent (pass 2 reports 'dropped 1 wall'). heal.js states a plan may never change on its way through a save.

#### T0011 — centerRoom() shifts walls and furniture but strands every label and public area at its old canvas coordinate

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/plan/room.js:62-73; store/editing.js:138-141`
- **host**: mac-local · **discovered by**: subagent (plan + store audits), node repro
- **evidence (before)**: updateCanvasSize() replaces the plate and calls centerRoom(), which moves only room.walls and room.furniture; labels[].center and publicAreas[].x/z are canvas-absolute and stay put. Proven: canvas 25->40 moves the bed by (7.5,7.5) while its label and the green public floor do not move, leaving them ~17 m from what they annotate.

#### T0012 — sliceByWeights() drops the documented frontage check in its one-room base case, so a generated room can be given a door onto the street

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/plan/layout-slice.js:59-62 (layout.js:202,265-276)`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: The block comment says the door-frontage test is asked of a piec about to become ONE room as well as of the two halves of a cut, but `if (weights.length <= 1) return [cells];` returns unconditionally and fronting() is only called for candidate cuts. Proven: plate 8x6, divider at x=4, autoLayoutRooms(count 2) gives the right room a door in the OUTER wall plus a second door through the divider.

#### T0013 — Grid validation uses a prototype-chain lookup, so "constructor"/"__proto__" pass and collapse all snapping to the origin

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/plan/rcad.js:65; plan/grid.js:14`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: GRID_STEPS[room.grid] is truthy for inherited Object.prototype members, so the field is accepted while .meters is undefined. Proven: grid:"constructor" loads and gridSnap/snapPoint return {0,0} (step NaN); resizeOpeningEnd/resizePublicArea/equalizeRooms then produce NaN offsets and boundaries.

#### T0014 — Furniture-kind validation uses a prototype-chain lookup, so "constructor"/"__proto__" bypass the drop and leave NaN geometry

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/plan/sanitize.js:273-284; plan/core.js:52; plan/hit.js:112; plan/furniture.js:99,108,149`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: FURNITURE_KINDS[item.kind] is truthy for inherited members, so the unknown-kind drop never fires; kind.w/kind.d are undefined, w/2 is NaN, fit() returns NaN. Proven: furniture:[{kind:"constructor",center:{x:2,z:2}}] is kept with center NaN, serializeRoom writes nulls, the report says nothing and isFurniturePlacementValid returns true.

#### T0015 — An endpoint drag can snap a wall off-axis; sanitize() then deletes the wall and every opening on it

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/store/walls.js:44-61; plan/grid.js:102-116`
- **host**: mac-local · **discovered by**: subagent (store audit), node repro
- **evidence (before)**: snapWallEndpoint()'s consider() accepts any wall start/end/midpoint within tolerance with no shared-axis guard, and the store guards only the resulting LENGTH. Proven: wall A (0,3)-(4,3) dragged toward a neighbour endpoint at (2,3.05) becomes (2,3.05)-(4,3); on release sanitize drops the diagonal, taking its doors/windows with it, with no warning.

#### T0016 — A commit while a drag transaction is open fuses the drag with the previous committed edit and destroys that edit's undo boundary

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: history-undo
- **where**: `roomcad/web/store/history.js:85-89`
- **host**: mac-local · **discovered by**: subagent (store audit), node repro
- **evidence (before)**: commit() pops the pre-drag snapshot beginDrag pushed and then pushes the new state, so the intermediate state never enters the stack. Proven: commit A, beginDrag, drag, then an arrow key/Delete (both commit) -> stack ['T','A+drag']; undo twice skips A entirely.

#### T0017 — applyRemoteRoom clobbers a local edit that is still unpublished and clears both undo stacks, making the edit unrecoverable

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: concurrency
- **where**: `roomcad/web/store/history.js:209-221; app/watch.js:124; app/status.js:118`
- **host**: mac-local · **discovered by**: subagent (store + app audits), node repro
- **evidence (before)**: The stream path (watch.js:124) and the stale-push branch (status.js:118) apply a remote room unconditionally, while the drift branch 70 lines below guards on liveUnpublished/livePushTimer/dragTransactionActive. Proven both ways: a teammate draft arriving inside the 150 ms publish window (or while a push is in flight) replaces the local room and empties the undo stacks; the pending push then serialises the clobbered room.

#### T0018 — Poll backoff starts at 0, so an unreachable server is retried in a tight loop instead of backing off

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: concurrency
- **where**: `roomcad/web/app/state.js:20; app/status.js:53-56`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: statusBackoff: 0 in freshState() makes Math.min(0*2, 30000) 0 forever, so scheduleStatus(0) re-polls immediately. Proven: with fetch failing, 95 requests in 120 ms while statusBackoff stayed 0. Pre-split it was `let statusBackoff = STATUS_INTERVAL_MS;`.

#### T0019 — The drift check adopts the server sequence before parsing; the parse failure is swallowed, leaving the client 'current' on a stale room

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: error-handling
- **where**: `roomcad/web/app/status.js:180-194`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: status.js:181 advances appState.liveSeq, then line 189 P.parseRoom(data.json) can throw and the empty catch at 193 hides it, so the client believes it is current and its next push is accepted with a current baseSeq. Proven: liveSeq=42 while the room was not adopted.

#### T0020 — Resuming the last server design at boot replaces the room with no confirmDiscard() and no check on store.edited

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/app/resume (files.js:305-317)`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: resumeLastRoom() runs at boot without awaiting while the app is already usable; anything drawn during the request is silently replaced by store.loadRoom(), which clears both undo stacks. Proven: with the reply held open, an edit made meanwhile ends as the server copy with edited=false and zero confirm() calls.

#### T0021 — The canvas never captures the pointer, so a drag released off-canvas never ends and the wall/furniture follows a plain hover

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: error-handling
- **where**: `roomcad/web/editor2d/view.js:29-33; editor2d/drag.js:274-300`
- **host**: mac-local · **discovered by**: subagent (editor2d audit), node repro
- **evidence (before)**: pointerup/pointercancel are bound on the canvas only and pointerdown never calls setPointerCapture(), so a release outside the canvas leaves this.drag, this.pointers and store.dragTransactionActive set. Proven: after an off-canvas release a button-less pointermove still moved a wall, live updates are ignored (dragTransactionActive), the drag's undo boundary is consumed, and two such releases leave pointers.size>1 so every later press is ignored.

#### T0022 — ensureCtx() does not guard AudioContext construction, so a blocked browser throws out of the edit that played the sound

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: error-handling
- **where**: `roomcad/web/audio.js:5-14`
- **host**: mac-local · **discovered by**: subagent (editor2d audit), node repro
- **evidence (before)**: 'no WebAudio at all' is handled, the documented NotSupportedError from `new AudioContext()` is not, and playPlop/playDoorSound call ensureCtx() with no try/catch. Proven: with a throwing constructor, store.toggleDoorOpen threw AFTER commit applied the change, so the door closed but the selection state the rest of the handler sets never ran, and the exception escaped into the canvas handler. ctx.resume() is the same hole on the promise side.

#### T0023 — No test runs the 3D path, and the solar test re-adds by hand the very constants sun.js fails to import

- **status**: OPEN
- **tier**: A · **project**: P3 tests · **category**: test-gap
- **where**: `tests/three-environment.test.mjs:36; tests/harness/walk3d-source.mjs:23-28`
- **host**: mac-local · **discovered by**: manual + subagents (3D audit)
- **evidence (before)**: walk3dSolarSource() splices the SG_* constants from constants.js in front of sun.js and the test strips import lines before loading it as a data: URL, so it supplies exactly the bindings sun.js never imports and can only pass. Every other walk3d assertion reads concatenated SOURCE text. Measured: ./tests/run.sh --fast is 31 files / 1492 assertions / 0 failed while T0001 makes 3D unusable.

### S2

#### T0024 — CI actions are pinned to mutable major tags and no GITHUB_TOKEN permissions are declared

- **status**: OPEN
- **tier**: A · **project**: P4 ops · **category**: security
- **where**: `.github/workflows/tests.yml:1-45`
- **host**: mac-local · **discovered by**: manual L0 pass
- **evidence (before)**: actions/checkout@v5, actions/setup-node@v5 and actions/setup-python@v6 are tags, not commit SHAs, so the repository's only gate can be changed under it by a moved tag; no permissions: block, so the token gets the repository default.

#### T0025 — 56 imports in walk3d.js are dead after the split

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: maintainability
- **where**: `roomcad/web/walk3d.js:24-85`
- **host**: mac-local · **discovered by**: eslint no-unused-vars
- **evidence (before)**: `eslint roomcad/web` reports 56 no-unused-vars in walk3d.js (the constants block and the walk3d/*.js method objects). Dead imports are how T0001/T0008 stayed invisible.

#### T0026 — Walk3D.dispose() leaks resources and leaves a live store subscription and ResizeObserver

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: resource-lifecycle
- **where**: `roomcad/web/walk3d/loop.js:293-314; walk3d.js:194; walk3d/paintball.js:268-277`
- **host**: mac-local · **discovered by**: subagent (3D audit), Rapier + three repro
- **evidence (before)**: dispose() frees no skyTexture/cloudTexture, no PMREM environment texture and no RoomEnvironment scene; the store.onChange unsubscribe is discarded and world/physicsReady stay live, so a later store change calls buildPhysics() which frees an already-freed Rapier world (proven TypeError); the ResizeObserver handle is discarded so it cannot be disconnected and later calls setSize on a disposed renderer.

#### T0027 — shootableMeshes() includes the sky dome (and clouds/rain), so the documented 60 m fallback range is dead and splats land on the sky

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/walk3d/paintball.js:119-127`
- **host**: mac-local · **discovered by**: subagent (3D audit), three repro
- **evidence (before)**: The sky dome is an ordinary Mesh in this.scene and the raycaster's far is Infinity, so a shot that hits nothing solid reports the dome at ~380 m. Proven with the vendored three: ray from (0,1.5,0) along +X hits the BackSide dome at 379.9 m, so `to = hit.point` throws the ball 380 m and paints the sky instead of the intended 60 m mark.

#### T0028 — The detectRooms memory cap bounds only the owner array; peak allocation is ~35x the documented ~4 MB

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: memory
- **where**: `roomcad/web/plan/rooms.js:23,120-151,186`
- **host**: mac-local · **discovered by**: subagent (plan audit), measured
- **evidence (before)**: Each of up to MAX_ROOM_CELLS (1,000,000) cells is also materialised as a new two-element array in region.cells. Measured: a 999x999-line plan peaked at +139.7 MB heap while the Int32Array owner is 3.81 MB, and the result stays in the module-global cache.

#### T0029 — The repair report is not faithful: some repairs are silent and some 'repairs' are false

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: contract
- **where**: `roomcad/web/plan/sanitize.js:72-88,288-318`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: (a) A door with no offset/width is materialised while reportIsEmpty() is true (Math.abs(0.6-undefined) is NaN). (b) turn(undefined) returns 0 and 0 !== undefined, so a piece that merely omits rotationDegrees reports 'repaired rotation'. (c) labels/publicAreas get ids via bare uid() without counting, while `named` counts ids for objects that are then dropped.

#### T0030 — Duplicate object ids survive sanitize, and deleting one wall then deletes every wall sharing its id

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/plan/sanitize.js:130-140`
- **host**: mac-local · **discovered by**: subagent (plan audit), node repro
- **evidence (before)**: name() only fills a missing id and never checks uniqueness, so two walls with id 'same' both load and every lookup acts on the first; store/editing.js removes walls with filter(w => w.id !== id), so one delete removes both. Proven by replaying that filter over the sanitized room.

#### T0031 — publicFeedback is never cleared by discardDrag/endDrag/clearSelection, so an aborted public-floor drag leaves the area drawn permanently red

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: state
- **where**: `roomcad/web/store/history.js:138-145; store/notifications.js:121-130`
- **host**: mac-local · **discovered by**: subagent (store audit), node repro
- **evidence (before)**: The only clear is inside settleDraggedPublicArea; discardDrag clears furnitureFeedback but not publicFeedback. Proven: after an invalid movePublicArea followed by discardDrag the area is restored but publicFeedback stays invalid, and editor2d/draw-core.js paints it red indefinitely.

#### T0032 — An aborted drag at the 100-entry cap permanently evicts one real undo entry

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: history-undo
- **where**: `roomcad/web/store/history.js:111-116,142`
- **host**: mac-local · **discovered by**: subagent (store audit), node repro
- **evidence (before)**: beginDrag() shifts the oldest entry when the stack exceeds 100, and discardDrag() pops only the drag's own snapshot, so the shift is never compensated. Proven: 100 commits, then one beginDrag/discardDrag (a click-select), loses the pre-first-edit state for good.

#### T0033 — Clearing the zoom field commits 0 and pins the zoom at the 20% floor

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: input-validation
- **where**: `roomcad/web/editor2d/coords.js:217-222`
- **host**: mac-local · **discovered by**: subagent (editor2d audit), node repro
- **evidence (before)**: Number("") is 0 and isNaN(0) is false, so an emptied field (select-all + Delete, or just clicking away, since blur also calls finish) commits zoomTo(0) -> clamp(0,20,400) -> 20. Proven: scale 150 -> 20 and the readout says 20%.

#### T0034 — Wheel zoom assumes pixel deltas and ignores deltaMode

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/editor2d/view.js:34-39`
- **host**: mac-local · **discovered by**: subagent (editor2d audit), spec-derived (labelled)
- **evidence (before)**: The factor is Math.exp(-e.deltaY * 0.0015) with e.deltaMode never read, so a user agent reporting DOM_DELTA_LINE (deltaY ~3 per notch) changes the zoom by 0.45% per notch while a pixel-reporting wheel gives 14%. Labelled as spec/UA-derived, not browser-reproduced.

#### T0035 — options.scale is interpolated into the SVG without escaping, unlike every other text

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: security
- **where**: `roomcad/web/svg.js:57,235`
- **host**: mac-local · **discovered by**: subagent (editor2d/svg audit), node repro
- **evidence (before)**: Every room-derived string goes through esc(), but the caller-supplied options.scale is spliced raw into <text>. Proven: roomToSVG(room,{scale:'50</text><script>alert(2)</script>'}) emits the script element. No in-repo caller passes scale today, so it is latent rather than live.

#### T0036 — New Room and importing a local file leave the SSE watch stream open and the live-sync timer running

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: resource-lifecycle
- **where**: `roomcad/web/app/api.js:13-16,44-61`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: Neither handler calls stopWatching()/stopLiveSync()/resetLiveSequence(), while newRoom()/loadRoom() null serverRoomName and live. Proven: after watchRoom() then New Room, EventSource.closed is false and eventSource is non-null while serverRoomName is null; the socket and a server watcher slot are held for a room the user left.

#### T0037 — The EventSource has no onerror, so a refused stream is never noticed or reopened

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: resource-lifecycle
- **where**: `roomcad/web/app/watch.js:100-131`
- **host**: mac-local · **discovered by**: subagent (app audit)
- **evidence (before)**: Only a thrown constructor reaches the try/catch; a non-200 (401 after session expiry, 503 at the watcher cap) fails the stream permanently per spec and nothing listens. eventSource stays non-null so toggleLive will not reopen it and the UI keeps claiming Live.

#### T0038 — announceRepairs() sets the status line without emitting, so two of the three load paths never render it

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: contract
- **where**: `roomcad/web/app/ui.js:81-86`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: openStoredRoom() and the local-file import set the status after their last store.emit(); only resumeLastRoom() emits afterwards. Proven by driving the real openRoomModal: store.status carries the repair sentence while #status-message still shows the old text, and a repair-only load shows no toast.

#### T0039 — saveRoom() returns the verification result, not the save result, so a saved-but-unverified save is treated as 'not saved'

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/app/files.js:30-58`
- **host**: mac-local · **discovered by**: subagent (app audit)
- **evidence (before)**: The verification is a second request; if the POST succeeded and the follow-up GET failed, store.edited is false and the version exists, yet leaveLiveMode overwrites the status with 'Could not save for everyone' and refuses to leave, so the user retries and creates a duplicate version.

#### T0040 — FileReader.onerror is unhandled on the local-file open path

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: error-handling
- **where**: `roomcad/web/app/api.js:44-62`
- **host**: mac-local · **discovered by**: subagent (app audit)
- **evidence (before)**: If the read fails no onload and no onerror runs: no message, and fileInput.value keeps the stale name (every other path resets it), so the picker looks inert and re-selecting the same file need not fire change.

#### T0041 — The discard guard asks 'Save changes?' but OK discards without saving

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/app/ui.js:59-62`
- **host**: mac-local · **discovered by**: subagent (app audit)
- **evidence (before)**: confirmDiscard() returns true when the user answers a SAVE prompt, and every caller then destroys the edits (newRoom/loadRoom clear both undo stacks) without ever calling saveRoom(). tests/data-safety.test.mjs pins only that a guard exists.

#### T0042 — Cmd/Ctrl-S from inside a field saves the previous value

- **status**: OPEN
- **tier**: B · **project**: P1 roomcad/web · **category**: logic
- **where**: `roomcad/web/app/keys.js:24-30; app/inspector.js:309-312`
- **host**: mac-local · **discovered by**: subagent (app audit), node repro
- **evidence (before)**: The inspector commits rename/height/size on `change` only, so saving with the field still focused serialises the pre-edit value. Proven: with the Room Name field showing 'Kitchen Extension', Cmd-S posts a room named '7-Room Demo'.

#### T0043 — Every non-OK login response is reported as 'Wrong password.', including the 429 lockout and a 500

- **status**: OPEN
- **tier**: A · **project**: P1 roomcad/web · **category**: error-handling
- **where**: `roomcad/web/login.js:38-47`
- **host**: mac-local · **discovered by**: subagent (app audit)
- **evidence (before)**: server.py answers 429 'too many attempts' after 10 failures and 500 'auth not configured'; the form shows 'Wrong password.' for both, so a correct password during the lockout window reads as wrong with no hint to wait.

### S3

#### T0044 — shellcheck SC2034: loop variable `attempt` is never read

- **status**: OPEN
- **tier**: A · **project**: P4 ops · **category**: style
- **where**: `roomcad/server/deploy.sh:150`
- **host**: mac-local · **discovered by**: shellcheck 0.11.0
- **evidence (before)**: shellcheck: 'roomcad/server/deploy.sh:150:3: warning: attempt appears unused. [SC2034]'. The other two shellcheck notes are SC2029 client-side-expansion notes on intentional remote commands.

#### T0045 — Ruff sweep: asserts that vanish under -O, and a lambda assignment

- **status**: OPEN
- **tier**: C · **project**: P3 tests · **category**: style
- **where**: `tests/server-live.test.py:51,118,119,600`
- **host**: mac-local · **discovered by**: ruff 0.16.7
- **evidence (before)**: `ruff check --select E4,E7,E9,F,B,S101,PT` -> 4 errors: S101 at 51:13, 118:5, 119:5 and E731 at 600:5. server.py itself is clean. Asserts in test code disappear under python -O, which is the §1 pitfall.

#### T0046 — eslint sweep: unused vars, prefer-const, redundant no-eq-null rule

- **status**: OPEN
- **tier**: C · **project**: P1 roomcad/web · **category**: style
- **where**: `roomcad/web/**/*.js (128 eslint findings)`
- **host**: mac-local · **discovered by**: eslint 10.10.0
- **evidence (before)**: 128 findings in roomcad/web: 81 no-unused-vars, 13 no-undef (all T0001/T0008), 12 no-unsanitized/property (all mitigated by esc()), 9 require-atomic-updates, 9 no-eq-null, 3 prefer-const, 1 no-promise-executor-return. no-eq-null is redundant with the chosen eqeqeq:smart mode and is removed rather than 'fixed'.
