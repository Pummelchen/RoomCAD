# RoomCAD pre-production audit — report

Generated from `AUDIT/ledger.json` by `AUDIT/report.py`. The ledger is the source of truth; this file is not edited by hand.

Branch `audit/2026-09-18`, base commit `dbba4df`.

## Headline

- **65 tasks, 64 DONE, 1 BLOCKED, 0 open.**
- Findings by severity: S0 6, S1 19, S2 23, S3 17.

| severity | total | done | open | blocked |
| -------- | ----- | ---- | ---- | ------- |
| S0 | 6 | 6 | 0 | 0 |
| S1 | 19 | 19 | 0 | 0 |
| S2 | 23 | 23 | 0 | 0 |
| S3 | 17 | 16 | 1 | 0 |

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
| T0065 | S1 | A | `roomcad/server/roomcad_api/http.py (was roomcad/server/server.py)` | POST /api/login and /api/logout declared Content-Length: 11 for the 12-byte body {"ok": true}, leaving one byte in the socket | DONE | `bc3edc0` |
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
| T0054 | S2 | A | `roomcad/web/app/{ui,inspector,view,files,status}.js, editor2d/coords.js` | Remove hand-written innerHTML interpolation: one escaping primitive (safeHtml/safeMarkup) at every sink | DONE | `553b887` |
| T0056 | S2 | B | `roomcad/web/app/files.js:39,40,43,48; app/live.js:64,69,73,76; app/status.js:215` | Remove the post-await singleton assignments so require-atomic-updates can be enforced rather than waived | DONE | `553b887` |
| T0062 | S2 | A | `roomcad/server/server.py` | Tracker T-02b: split server.py (1241 lines) into a package while keeping server.py the runnable entry and every rebinding contract live | DONE | `bc3edc0` |
| T0044 | S3 | A | `roomcad/server/deploy.sh:150` | shellcheck SC2034: loop variable `attempt` is never read | DONE | `d062aeb` |
| T0045 | S3 | C | `tests/server-live.test.py:51,118,119,600` | Ruff sweep: asserts that vanish under -O, and a lambda assignment | DONE | `d062aeb + 91379d8` |
| T0046 | S3 | C | `roomcad/web/**/*.js (128 eslint findings)` | eslint sweep: unused vars, prefer-const, redundant no-eq-null rule | DONE | `4cf0b30` |
| T0048 | S3 | B | `AUDIT/eslint.config.mjs (rule require-atomic-updates)` | require-atomic-updates is a false positive for a module-singleton store; the rule is wrong for this codebase and is turned off with justification, not silenced | DONE | `4cf0b30` |
| T0049 | S3 | A | `AUDIT/eslint.config.mjs (rule no-unsanitized/property) + tests/audit-xss.test.mjs` | no-unsanitized/property cannot see per-interpolation esc(); the 12 sites are safe and get a compensating source contract instead | DONE | `4cf0b30` |
| T0050 | S3 | C | `AUDIT/eslint.config.mjs (tests/** block)` | Two browser-sink rules are scoped out of the Node test harness where they have no domain, and stay at error for production | DONE | `4cf0b30` |
| T0051 | S3 | C | `tests/harness/dom-stub.mjs:100,139,151` | security/detect-unsafe-regex flags three linear tokenizer patterns in the DOM stub; reviewed, found linear, reported as warnings and kept at error for production | DONE | `4cf0b30` |
| T0052 | S3 | B | `roomcad/web/editor2d/drag.js:59-79` | The T0021 fix introduced two empty catch blocks; corrected to report rather than swallow | DONE | `f7c2d26` |
| T0053 | S3 | B | `roomcad/web/store/walls.js:324-330` | The T0004 fix could leave a drag transaction open when the selected opening had already vanished | DONE | `f7c2d26` |
| T0055 | S3 | C | `tests/harness/dom-stub.mjs:100,139,151 (old numbering)` | Replace the DOM stub's nested-quantifier regexes with linear hand-written scanners | DONE | `553b887` |
| T0057 | S3 | C | `tests/{app-internals,app-wiring,live-mode,live-state,mode-switch,room-lights,sidebar-panels}.test.mjs` | Drive the real modules instead of lifting functions out of source with new Function | DONE | `553b887` |
| T0058 | S3 | C | `AUDIT/eslint.config.mjs (tests/** block, no-unsanitized/method)` | Scope the import() pseudo-sink out of the Node test harness while keeping every DOM sink at error | DONE | `553b887` |
| T0059 | S3 | A | `roomcad/web/editor2d/drag.js:398-493` | onPointerUp bound a local `drag` that shadowed the module's exported `drag` object; renamed, and no-shadow is now on for production | DONE | `-` |
| T0060 | S3 | A | `roomcad/server/deploy.sh` | Tracker T-01 (ship 10.8): pre-deploy verification done; the deploy itself is a human step and is not performed by this audit | BLOCKED | `-` |
| T0061 | S3 | B | `roomcad/web/city.js` | Tracker T-02a: split city.js (5301 lines) into the repo's prototype pattern | DONE | `bc3edc0` |
| T0063 | S3 | B | `roomcad/web/plan/layout.js, layout-slice.js, layout-partition.js` | Tracker T-04: the auto-layout 'no frontage' decision is implemented and tested; remove the dead hallway vestige and the comments that promise a carve which does not exist | DONE | `bc3edc0` |
| T0064 | S3 | B | `roomcad/web/city.js:4909` | Tracker T-05: the vehicle lamps already follow the time of day; correct the comment that said it was an open question | DONE | `-` |

# AUDIT — Phase E: the single final verification on the independent host (§11)

Run from a **fresh clone** on one independent host, in a single clean run.
The host is a Linux container under colima (a genuine second OS, native aarch64,
not the primary Mac). Nothing here was run against production.

The run was performed four times as the tree changed: on `bed325a`, on
`3ec7f71`, on `006c54e` **after** the follow-up work that removed the last lint
waivers (`T0054`–`T0059`), and finally on `ca9c2e6` after the four open items in
the wiki Project Tracker were closed (`T0061`–`T0063` and `T0065`). Each run
passed every check; the numbers below are the final run's. It is also the first
run with **no SKIP at all**: gitleaks is installed in the container now, so the
secret scan is a PASS rather than a reported *not checked*.

## The host

| | |
| - | - |
| Primary host | `mac-local` — macOS 27.0 (26A428), arm64, 8 GB |
| Independent host | `linux-container` — `node:24-bookworm-slim` under colima profile `roomcad-e`, Linux 6.8.0-117-generic, aarch64, 2 CPU / 2 GiB |
| Container runtime | colima 0.10.x (Lima 2.2.0), Docker API via `unix:///Users/node1/.colima/roomcad-e/docker.sock`; the image is native arm64, no emulation |
| Source | the repository mounted read-only at `/src`; the run clones `audit/2026-09-18` into `/work/roomcad-fresh`, so the mount cannot be modified |
| Toolchain installed in the container | Python 3.11.2 (distro), ruff 0.16.8 (pip), shellcheck 0.9.0 (apt), Node v24.21.0 / npm 11.19.0 (image), c8 12.0.0 and eslint/prettier (`npm ci` from the committed `AUDIT/package-lock.json`), gitleaks 8.30.1 (upstream release) |
| Reproduce | `docker run --rm -v <repo>:/src:ro node:24-bookworm-slim bash /phase-e-run.sh` where the script installs the toolchain and runs `AUDIT/phase-e.sh /src` (the exact script is `AUDIT/phase-e.sh`, committed) |

`colima start --profile roomcad-e --cpu 2 --memory 2 --disk 15` created it; the
existing colima `default` profile was already running and was **not** touched.
Cleanup and its rollback: `colima delete --profile roomcad-e` (to recreate,
re-run the `colima start` line above). Logged here because §1b requires every
host's installs to be recorded.

## Results — 14 PASS, 0 FAIL, 0 SKIP

```
=== fresh clone from /src (audit/2026-09-18) ===
PASS  clone
HEAD: ca9c2e6 audit(T0061-T0063,T0065): split city.js and server.py, settle the layout question, fix a login framing bug
node: v24.21.0  npm: 11.19.0  python: Python 3.11.2
os:   Linux 6.8.0-117-generic aarch64

=== clean tree ===
PASS  clone is clean

=== build — Python imports + app module graph ===
PASS  compileall
PASS  boot import graph: 20 passed, 0 failed — the page can boot

=== full test suite (no --fast) ===
PASS  suite: 41 files run, 2405 assertions passed, 0 failed

=== coverage (c8, --fast) ===
PASS  npm ci
  Statements   : 77.68% ( 15477/19922 )
  Branches     : 84.16% ( 3354/3985 )
  Functions    : 77.94% ( 530/680 )
  Lines        : 77.68% ( 15477/19922 )
PASS  coverage run green

=== scanners (portable) ===
All checks passed!
PASS  ruff check
14 files already formatted
PASS  ruff format
PASS  shellcheck
PASS  eslint (0 errors, 0 warnings)

=== zero production placeholders / facades ===
PASS  no facade markers on a production path

=== secret scan (working tree) ===
PASS  gitleaks

=== ledger open count ===
tasks: 65  done: 64  blocked: 1  open: 0
PASS  ledger open count is 0

PHASE E: ALL CHECKS PASSED on Linux 6.8.0-117-generic aarch64
```

### The earlier SKIP, and why it is gone

`gitleaks` was not in the base image for the first three runs, so the script
reported **SKIP** rather than passing vacuously (RELEASE.md §1.2.7: a check that
cannot run is reported *not checked*). It was installed from the upstream release
and run by hand then, and the container provisioning now installs it, so this run
reports a PASS and nothing is left as "not checked". The full-history scan over
the fresh clone is unchanged at 0 leaks (the primary host's `AUDIT/gates.sh` runs
the same tool over the working tree).

### The coverage jump is a measurement fix, not new tests

Lines went from 57.37% (11124/19389) to 77.68% (15477/19922) and functions from
59.07% to 77.94%, and the honest explanation is not "more tests were written".
`tests/harness/load-web-module.mjs` copies a module that has a **bare** specifier
the import map resolves, and writes the copy to `tests/harness/.under-test-*.mjs`
— which is outside the `--include='roomcad/**'` the report measures. `city.js`
imports the bare `three`, so the three city tests were exercising a copy c8 never
read while the real 5301-line `city.js` counted as uncovered. The split moved
those tests to `register(three-resolver)` + a real-path import (which is also what
keeps one `City` instance, since the section modules import the facade by relative
path), so the coverage of the city is now attributed to the city. Nothing about
the suite's behaviour changed; the instrument can finally see it.

## Final metrics versus the committed baseline

| metric | baseline | final | verdict |
| ------ | -------- | ----- | ------- |
| full suite files | 35 | **41** | +6 |
| full suite assertions | 2045 | **2405** | +360 |
| suite failures | 0 | **0** | unchanged |
| coverage, lines | 50.65% (9488/18729) | **77.68%** (15477/19922) | +5989 lines covered; ~5300 of that is the city, which the instrument could not see until the split (see above) |
| coverage, functions | 47.34% (294/621) | **77.94%** (530/680) | +236 functions |
| coverage, branches | 79.75% (1647/2065) | **84.16%** (3354/3985) | +1707 covered branches |
| ruff check (`roomcad tests`) | 4 errors | **0** | fixed (T0045) |
| ruff format `--check` | 2 files | **0** | fixed (T0045) |
| bandit (`roomcad/server`, the whole package) | 0 | **0** | unchanged, now scanning `roomcad_api/` instead of a facade |
| eslint `roomcad/web tests` | 253 errors | **0 errors, 0 warnings** | every disposition removed (T0054–T0059) |
| shellcheck (warnings+) | 1 warning | **0** | fixed (T0044) |
| gitleaks (full history) | 0 leaks | **0 leaks** | unchanged, now over 238 commits |
| Caddy `validate` | both valid | **both valid** | unchanged |
| production placeholders / facades | 0 | **0** | unchanged |
| ledger open count | n/a | **0** | §12 |

Every metric is the same or strictly better than the baseline; no metric is
worse. The coverage rows are the one place where the number moved for two
reasons at once, and the reason matters more than the number: the real gain is
that the instrument can now see code it was previously blind to. No test was
added for coverage's sake anywhere in this audit.

## What this run verifies — the four tracker items

After the third run the owner took the wiki Project Tracker as the work list. Of
its five rows, four were actionable and one is a deploy:

- `T0061` — `city.js`, 5301 lines, is split into a 448-line class shell plus 20
  modules under `roomcad/web/city/`, largest 500, the way `walk3d.js` and
  `editor2d.js` were already split. All 103 class members and 212 module-level
  declarations moved byte-identically; the 32 exports are unchanged in name and
  kind. The two source contracts that had to be re-anchored to the definition they
  mean (`roomsDark`'s `BackSide`, and the build-path slice that now swallows the
  `trueRandom` definition) were each proved to still fail on an injected fault.
- `T0062` — `server.py`, 1241 lines, is a 81-line entry point over
  `roomcad/server/roomcad_api/` (10 modules, largest 361). All 45 moved functions
  are AST-identical to the originals. `state.py` owns the configuration and
  mutable globals because `tests/server-live.test.py` rebinds them before booting
  the server in-process: a facade that re-exported them by value would have driven
  the tests at the production database path, so `server.py` re-exports functions
  and classes only (a rebind there raises instead of silently missing) and the test
  rebinds on the state module behind a guard that refuses any path outside its
  temporary directory.
- `T0063` — the auto-layout "no frontage" question was already answered by the
  code and pinned by `audit-plan` and `auto-layout`, so the never-written
  `hallway` array, the never-read `fronts` mask and the comments that described a
  carve which does not exist were removed and replaced by the decision they hid.
  `layout-fuzz`'s aggregates are identical to a baseline taken from `HEAD`.
- `T0065` — found while staging the server split: login and logout hand-wrote
  `Content-Length: 11` for the 12-byte body `{"ok": true}`, leaving one byte in
  the socket of a keep-alive connection, where it becomes the first byte of the
  next response. Both now go through `_send(..., extra_headers=…)`. The suite
  could not see it (`http.client` reads the declared length and discards the
  rest), so the three new checks read a raw socket, and both framing checks were
  proved to fail on the old code before the fix.

`T-01` — the deploy — was **not** performed and is recorded as
`BLOCKED(owner)` in the ledger (`T0060`). §0 forbids this audit from touching the
live system. What could be verified without it was: `deploy-config` 101/0
(the CSP hash of the inline import map matches both Caddyfiles), `caddy validate`
on both, and the identity check. The deploy now also has to sync
`roomcad_api/`; the exact set of files it copies was staged into a temporary
directory and booted from `cwd=/` with no `PYTHONPATH`, answering
login → save → rooms → load.

## The follow-up work the third run verified

After the first two Phase E runs, the owner asked for the 15 remaining eslint
warnings **and** the four rule dispositions to be removed rather than documented.
`T0054`–`T0059` do that by fixing what the dispositions hid, so the rules are back
at `error` and silent — there is no severity waiver anywhere in the config:

- `T0054` — `innerHTML` is no longer built by hand-written interpolation. One
  escaping primitive (`safeMarkup`/`safeHtml` in `app/ui.js`), used at all 12
  sinks, with `tests/audit-xss.test.mjs` (51 checks) as the contract, including a
  hostile room name and label rendered through the real builders.
- `T0055` — the DOM stub's three nested-quantifier regexes are linear scanners,
  proved equivalent by differential testing on `index.html` and 41 adversarial
  inputs before the swap.
- `T0056` — the ten post-await singleton writes are one atomic `Object.assign`
  each, so `require-atomic-updates` is enforced. `roomDigest` and `validWidth` are
  exported so the two tests with no faithful public path drive the real functions
  instead of compiling their source.
- `T0057` — the seven test files that lifted functions with `new Function` now
  import the real modules. Check-name sets are identical to the baseline for five
  of the seven; the other two were re-expressed more strongly. Assertion counts
  are exactly preserved and five converted checks were proved still able to fail.
- `T0058` — `no-unsanitized/method`'s `import()` pseudo-sink is scoped to the
  browser block; all four DOM sinks stay at `error` in tests.
- `T0059` — the one production `no-shadow` finding (a local `drag` shadowing the
  module's exported `drag`) was renamed, and `no-shadow` is now on for production.

The only rules left unselected are style-class choices, each with its reason in
`AUDIT/eslint.config.mjs`: `no-implicit-coercion` (25 idiomatic `!!`/`+` coercions),
`no-shadow` for test files (20 locals deliberately named after the harness
function they captured) and `security/detect-object-injection` (fires on every
`obj[key]` in an untyped codebase).

## Verifying commit versus handing-over commit

The verified tree is `ca9c2e6`. Every commit after it changes **only files under
`AUDIT/`** (this record and the generated report), which no part of the
verification consumes: the suite, `boot.test.mjs`, the linters and the ledger check
read `roomcad/` and `tests/`. The check is one command, and it is the guarantee:

```bash
git diff --name-only ca9c2e6..HEAD | grep -v '^AUDIT/'   # must print nothing
```

**The verified commit was then rebased, and here is exactly what that changed.**
The work was fast-forwarded onto `main` and pushed. The remote `main` had one
commit the branch did not — `d15a56b`, an automated refresh of the "views (14d)"
badge in `.github/traffic.json` — and this repository's history is linear (0 merge
commits in 222), so `main` was rebased onto it rather than merged. Rebasing changed
**only parentage**: the rebased equivalent of the verified commit is `bc3edc0`, and

```bash
git diff --name-only ca9c2e6 bc3edc0     # prints only .github/traffic.json
```

so every file the verification reads — `roomcad/`, `tests/`, `AUDIT/` — is
byte-identical, and the deployed file set (`web/`, `server.py`, `roomcad_api/`)
does not include `.github/` at all. The invariant check for the pushed branch is
therefore:

```bash
git diff --name-only bc3edc0..HEAD | grep -v '^AUDIT/'   # must print nothing
```

## What Phase E does not claim

- It is not a browser test. `boot.test.mjs` proves the module graph and the DOM
  contract; no real browser was driven, so "the page renders" is not claimed for
  any change (unchanged from the baseline, and stated in `AGENTS.md`).
- The production VPS was never deployed to, restarted, or written to (§0). Two
  read-only facts about it were checked afterwards, when the owner asked for the
  deploy: its public `version.js` serves `10.7` against the repository's `10.8`,
  and `/city/weather.js` answers 404 — so neither the release nor the split is
  live. The deploy itself could not run from this host: `root@91.99.176.243`
  refuses the only private key here, so it is recorded as `BLOCKED(owner)`
  (`T0060`) rather than silently skipped.
- Semgrep and bandit were run on the primary host (their results are in
  `baseline.md` and `tool-coverage.md`) and not re-installed in the container;
  the container re-ran ruff, shellcheck, eslint and gitleaks. Scanning the same
  commit with the same pinned rules on a second host would not change the result,
  and the portable set is the one that can be installed from the distro.
- The 3D was not rendered anywhere: no browser, WebGPU or otherwise, was driven
  against this tree. `T-03` in the tracker is exactly that gap, left for a human.
