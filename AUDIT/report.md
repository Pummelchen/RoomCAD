# RoomCAD pre-production audit — report

Generated from `AUDIT/ledger.json` by `AUDIT/report.py`. The ledger is the source of truth; this file is not edited by hand.

Branch `audit/2026-09-18`, base commit `dbba4df`.

## Headline

- **53 tasks, 53 DONE, 0 BLOCKED, 0 open.**
- Findings by severity: S0 6, S1 18, S2 20, S3 9.

| severity | total | done | open | blocked |
| -------- | ----- | ---- | ---- | ------- |
| S0 | 6 | 6 | 0 | 0 |
| S1 | 18 | 18 | 0 | 0 |
| S2 | 20 | 20 | 0 | 0 |
| S3 | 9 | 9 | 0 | 0 |

## The six S0 findings

| id | area | title | commit |
| -- | ---- | ----- | ------ |
| T0001 | `roomcad/web/walk3d/scene-building.js:88; walk3d/sun.js:17,19,33; walk3d/scene-building-3.js:239; walk3d` | Prototype split dbba4df dropped four runtime imports, so the 3D walkthrough cannot start | `b69edfe` |
| T0002 | `roomcad/web/plan` | sanitize() is not total on a malformed document: five dereference sites throw a TypeError and the whole room is lost | `90cc313` |
| T0003 | `roomcad/web/plan` | detectRooms() cache key omits wall identity, so outsideFacingWalls() returns another room's wall ids and outer walls silently unlock | `90cc313` |
| T0004 | `roomcad/web/store` | Widening a door/window from the inspector silently deletes it | `f7c2d26` |
| T0005 | `roomcad/web` | The SVG title block prints the bounding-box area, not the floor area | `f7c2d26` |
| T0006 | `roomcad/web/app` | liveSeq is adopted for live messages that are then dropped, so a stale client's next push overwrites a teammate's accepted work | `b370652` |

## Every task

| id | sev | tier | file:line | title | status | commit |
| -- | --- | ---- | --------- | ----- | ------ | ------ |
| T0001 | S0 | A | `roomcad/web/walk3d/scene-building.js:88; walk3d/sun.js:17,19,33; walk3d/scene-building-3.js:239; walk3d/paintball.js:20` | Prototype split dbba4df dropped four runtime imports, so the 3D walkthrough cannot start | DONE | `b69edfe` |
| T0002 | S0 | A | `roomcad/web/plan/sanitize.js:106-108,120-122,154-155,275-284,288-290` | sanitize() is not total on a malformed document: five dereference sites throw a TypeError and the whole room is lost | DONE | `90cc313` |
| T0003 | S0 | A | `roomcad/web/plan/rooms.js:35-41,56,186,195-198` | detectRooms() cache key omits wall identity, so outsideFacingWalls() returns another room's wall ids and outer walls silently unlock | DONE | `90cc313` |
| T0004 | S0 | A | `roomcad/web/store/walls.js:314-327` | Widening a door/window from the inspector silently deletes it | DONE | `f7c2d26` |
| T0005 | S0 | A | `roomcad/web/svg.js:221-234` | The SVG title block prints the bounding-box area, not the floor area | DONE | `f7c2d26` |
| T0006 | S0 | A | `roomcad/web/app/watch.js:105-124` | liveSeq is adopted for live messages that are then dropped, so a stale client's next push overwrites a teammate's accepted work | DONE | `b370652` |
| T0007 | S1 | A | `roomcad/server/server.py:1123-1130` | POST /api/save does not validate the json field: a dict or list kills the request with an unhandled sqlite3 error | DONE | `d062aeb` |
| T0008 | S1 | B | `roomcad/web/walk3d/environment-builders.js:194-212` | SSAO and bloom silently never run: the TSL imports were dropped by the split | DONE | `b69edfe` |
| T0009 | S1 | B | `roomcad/web/walk3d/rapier-physics-2.js:82-90` | The floor texture canvas is sized by room area with no cap: a legal 60 m plate is 9600² (351 MB) and exceeds the WebGPU 8192 texture limit | DONE | `b69edfe` |
| T0010 | S1 | A | `roomcad/web/plan/sanitize.js:154-171,186-193` | Stub walls are dropped before clamping, so clamping can create a new stub that only disappears on the next load | DONE | `90cc313` |
| T0011 | S1 | A | `roomcad/web/plan/room.js:62-73; store/editing.js:138-141` | centerRoom() shifts walls and furniture but strands every label and public area at its old canvas coordinate | DONE | `90cc313` |
| T0012 | S1 | B | `roomcad/web/plan/layout-slice.js:59-62 (layout.js:202,265-276)` | sliceByWeights() drops the documented frontage check in its one-room base case, so a generated room can be given a door onto the street | DONE | `90cc313` |
| T0013 | S1 | A | `roomcad/web/plan/rcad.js:65; plan/grid.js:14` | Grid validation uses a prototype-chain lookup, so "constructor"/"__proto__" pass and collapse all snapping to the origin | DONE | `90cc313` |
| T0014 | S1 | A | `roomcad/web/plan/sanitize.js:273-284; plan/core.js:52; plan/hit.js:112; plan/furniture.js:99,108,149` | Furniture-kind validation uses a prototype-chain lookup, so "constructor"/"__proto__" bypass the drop and leave NaN geometry | DONE | `90cc313` |
| T0015 | S1 | A | `roomcad/web/store/walls.js:44-61; plan/grid.js:102-116` | An endpoint drag can snap a wall off-axis; sanitize() then deletes the wall and every opening on it | DONE | `f7c2d26` |
| T0016 | S1 | A | `roomcad/web/store/history.js:85-89` | A commit while a drag transaction is open fuses the drag with the previous committed edit and destroys that edit's undo boundary | DONE | `f7c2d26` |
| T0017 | S1 | A | `roomcad/web/store/history.js:209-221; app/watch.js:124; app/status.js:118` | applyRemoteRoom clobbers a local edit that is still unpublished and clears both undo stacks, making the edit unrecoverable | DONE | `b370652` |
| T0018 | S1 | B | `roomcad/web/app/state.js:20; app/status.js:53-56` | Poll backoff starts at 0, so an unreachable server is retried in a tight loop instead of backing off | DONE | `b370652` |
| T0019 | S1 | A | `roomcad/web/app/status.js:180-194` | The drift check adopts the server sequence before parsing; the parse failure is swallowed, leaving the client 'current' on a stale room | DONE | `b370652` |
| T0020 | S1 | A | `roomcad/web/app/resume (files.js:305-317)` | Resuming the last server design at boot replaces the room with no confirmDiscard() and no check on store.edited | DONE | `b370652` |
| T0021 | S1 | A | `roomcad/web/editor2d/view.js:29-33; editor2d/drag.js:274-300` | The canvas never captures the pointer, so a drag released off-canvas never ends and the wall/furniture follows a plain hover | DONE | `f7c2d26` |
| T0022 | S1 | B | `roomcad/web/audio.js:5-14` | ensureCtx() does not guard AudioContext construction, so a blocked browser throws out of the edit that played the sound | DONE | `f7c2d26` |
| T0023 | S1 | A | `tests/three-environment.test.mjs:36; tests/harness/walk3d-source.mjs:23-28` | No test runs the 3D path, and the solar test re-adds by hand the very constants sun.js fails to import | DONE | `b69edfe` |
| T0047 | S1 | A | `roomcad/web/store/notifications.js:22` | store.emit() aborts every later listener when one throws, so a single subsystem failure disables the rest of the app's change handling | DONE | `f7c2d26` |
| T0024 | S2 | A | `.github/workflows/tests.yml:1-45` | CI actions are pinned to mutable major tags and no GITHUB_TOKEN permissions are declared | DONE | `d062aeb` |
| T0025 | S2 | B | `roomcad/web/walk3d.js:24-85` | 56 imports in walk3d.js are dead after the split | DONE | `b69edfe` |
| T0026 | S2 | B | `roomcad/web/walk3d/loop.js:293-314; walk3d.js:194; walk3d/paintball.js:268-277` | Walk3D.dispose() leaks resources and leaves a live store subscription and ResizeObserver | DONE | `b69edfe` |
| T0027 | S2 | B | `roomcad/web/walk3d/paintball.js:119-127` | shootableMeshes() includes the sky dome (and clouds/rain), so the documented 60 m fallback range is dead and splats land on the sky | DONE | `b69edfe` |
| T0028 | S2 | B | `roomcad/web/plan/rooms.js:23,120-151,186` | The detectRooms memory cap bounds only the owner array; peak allocation is ~35x the documented ~4 MB | DONE | `90cc313` |
| T0029 | S2 | B | `roomcad/web/plan/sanitize.js:72-88,288-318` | The repair report is not faithful: some repairs are silent and some 'repairs' are false | DONE | `90cc313` |
| T0030 | S2 | B | `roomcad/web/plan/sanitize.js:130-140` | Duplicate object ids survive sanitize, and deleting one wall then deletes every wall sharing its id | DONE | `90cc313` |
| T0031 | S2 | B | `roomcad/web/store/history.js:138-145; store/notifications.js:121-130` | publicFeedback is never cleared by discardDrag/endDrag/clearSelection, so an aborted public-floor drag leaves the area drawn permanently red | DONE | `f7c2d26` |
| T0032 | S2 | B | `roomcad/web/store/history.js:111-116,142` | An aborted drag at the 100-entry cap permanently evicts one real undo entry | DONE | `f7c2d26` |
| T0033 | S2 | B | `roomcad/web/editor2d/coords.js:217-222` | Clearing the zoom field commits 0 and pins the zoom at the 20% floor | DONE | `f7c2d26` |
| T0034 | S2 | B | `roomcad/web/editor2d/view.js:34-39` | Wheel zoom assumes pixel deltas and ignores deltaMode | DONE | `f7c2d26` |
| T0035 | S2 | B | `roomcad/web/svg.js:57,235` | options.scale is interpolated into the SVG without escaping, unlike every other text | DONE | `f7c2d26` |
| T0036 | S2 | B | `roomcad/web/app/api.js:13-16,44-61` | New Room and importing a local file leave the SSE watch stream open and the live-sync timer running | DONE | `b370652` |
| T0037 | S2 | B | `roomcad/web/app/watch.js:100-131` | The EventSource has no onerror, so a refused stream is never noticed or reopened | DONE | `b370652` |
| T0038 | S2 | B | `roomcad/web/app/ui.js:81-86` | announceRepairs() sets the status line without emitting, so two of the three load paths never render it | DONE | `b370652` |
| T0039 | S2 | B | `roomcad/web/app/files.js:30-58` | saveRoom() returns the verification result, not the save result, so a saved-but-unverified save is treated as 'not saved' | DONE | `b370652` |
| T0040 | S2 | B | `roomcad/web/app/api.js:44-62` | FileReader.onerror is unhandled on the local-file open path | DONE | `b370652` |
| T0041 | S2 | B | `roomcad/web/app/ui.js:59-62` | The discard guard asks 'Save changes?' but OK discards without saving | DONE | `b370652` |
| T0042 | S2 | B | `roomcad/web/app/keys.js:24-30; app/inspector.js:309-312` | Cmd/Ctrl-S from inside a field saves the previous value | DONE | `b370652` |
| T0043 | S2 | A | `roomcad/web/login.js:38-47` | Every non-OK login response is reported as 'Wrong password.', including the 429 lockout and a 500 | DONE | `b370652` |
| T0044 | S3 | A | `roomcad/server/deploy.sh:150` | shellcheck SC2034: loop variable `attempt` is never read | DONE | `d062aeb` |
| T0045 | S3 | C | `tests/server-live.test.py:51,118,119,600` | Ruff sweep: asserts that vanish under -O, and a lambda assignment | DONE | `d062aeb + 91379d8` |
| T0046 | S3 | C | `roomcad/web/**/*.js (128 eslint findings)` | eslint sweep: unused vars, prefer-const, redundant no-eq-null rule | DONE | `4cf0b30` |
| T0048 | S3 | B | `AUDIT/eslint.config.mjs (rule require-atomic-updates)` | require-atomic-updates is a false positive for a module-singleton store; the rule is wrong for this codebase and is turned off with justification, not silenced | DONE | `4cf0b30` |
| T0049 | S3 | A | `AUDIT/eslint.config.mjs (rule no-unsanitized/property) + tests/audit-xss.test.mjs` | no-unsanitized/property cannot see per-interpolation esc(); the 12 sites are safe and get a compensating source contract instead | DONE | `4cf0b30` |
| T0050 | S3 | C | `AUDIT/eslint.config.mjs (tests/** block)` | Two browser-sink rules are scoped out of the Node test harness where they have no domain, and stay at error for production | DONE | `4cf0b30` |
| T0051 | S3 | C | `tests/harness/dom-stub.mjs:100,139,151` | security/detect-unsafe-regex flags three linear tokenizer patterns in the DOM stub; reviewed, found linear, reported as warnings and kept at error for production | DONE | `4cf0b30` |
| T0052 | S3 | B | `roomcad/web/editor2d/drag.js:59-79` | The T0021 fix introduced two empty catch blocks; corrected to report rather than swallow | DONE | `f7c2d26` |
| T0053 | S3 | B | `roomcad/web/store/walls.js:324-330` | The T0004 fix could leave a drag transaction open when the selected opening had already vanished | DONE | `f7c2d26` |
