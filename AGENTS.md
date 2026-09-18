# RoomCAD

<!-- agent-harnesses:begin -->
> **One instruction file.** This is it. Codex, DeepSeek Harness, OpenCode,
> Qwen Code, Qoder and Zed read `AGENTS.md` directly, and Claude Code reads it
> through the committed `CLAUDE.md`, which contains nothing but `@AGENTS.md`.
> **Edit only this file** — do not add a second set of instructions anywhere.
>
> Do **not** add `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`,
> `.github/copilot-instructions.md` or `AGENT.md`. Zed takes the *first match*
> from that list, **ahead of `AGENTS.md`**, so any one of them silently
> replaces this file for every Zed user.
<!-- agent-harnesses:end -->

A browser-based, kid-friendly room planner: centimetre-accurate 2D plan editing plus
a WebGPU 3D walkthrough, backed by a Python/SQLite save-and-live-collaboration API.
The app is plain ES modules with vendored Three.js WebGPU and Rapier WASM — **no
bundler, no `package.json`** — served by Caddy; the API is stdlib-only Python that
stores versioned rooms in SQLite and streams live edits over SSE. It is complete and
in production: the deployed entry point is
`https://roomcad.91.99.176.243.nip.io/`, and `roomcad/server/` mirrors the VPS so it
can be rebuilt from git. The first release is `v10.8`, cut from `main` with
`./release.sh`.

**There is no Swift, Xcode or native code anywhere in the tree.** An earlier native
edition was removed, and the comments that still described it as the counterpart
of this code have been corrected. The GitHub description and the repository's own
docs are kept in step with the code — if you change a fact here, change it there
too.

## Layout

- `roomcad/web/store/` — the editing store, split by concern: `base` (the initial
  state, `TOOL_HELP`, `clockText`), `notifications`, `walls`, `items`, `editing`,
  `history`. `store.js` composes them with `Object.assign` into the one `store`
  object the app imports, so `this` is still the store and nothing outside
  changed. **Use `createStore()` for a second store**, never a query string.
- `roomcad/web/` — the app: `plan.js` (**the facade** over `plan/`: room model, grid,
  snapping, wall geometry and joins, room detection, auto-layout, the `.rcad` format;
  pure, no DOM, no network), `store.js`
  (editing state, tools, undo/redo, remote-apply — **it does no I/O**),
  `editor2d.js` (2D canvas), `walk3d.js` (Three.js walkthrough, Rapier physics, sun,
  bloom), `city.js` (the stylised surrounding city), `app.js` (UI glue — **the only
  module besides `login.js` that touches the network**), plus `svg.js`, `audio.js`,
  `login.js`, `version.js`, `index.html`, `serve.sh`, `Caddyfile`, `styles/`
  (six stylesheets; see below), and `lib/` (vendored Three.js WebGPU + Rapier, so
  the page works offline).
- `roomcad/web/styles/` — the CSS, split at the section markers into `shell`,
  `palette`, `dialogs`, `inspector`, `overlays`, `controls`, linked from
  `index.html` **in that order**. They are CONTIGUOUS CUTS of what used to be one
  `styles.css`, so **the link order IS the cascade**: a rule in a later sheet wins
  a specificity tie exactly as it used to win by coming later in the one file.
  Reordering the links, or moving a rule to a differently-ordered sheet, changes
  which rule wins and nothing will report it — a control is just the wrong size.
  `tests/styles-split.test.mjs` checks the links resolve, are brace-balanced, are
  in the declared order, and that no rule from before the split has gone missing.
- `roomcad/web/plan/` — that model, split by subject: `core`, `room`, `grid`, `walls`,
  `hit`, `openings`, `furniture`, `labels`, `rooms`, `captions`, `sanitize`,
  `layout-grid`, `layout-slice`, `layout-partition`, `layout`, `demo`, `rcad`.
  **Import from `plan.js`, never from these** — it re-exports every one of them, and
  five modules plus every test import it as a namespace.
- `roomcad/server/` — the API and the production mirror: `server.py` (the runnable
  entry point and facade), `roomcad_api/` (the implementation as a package — `state.py`
  owns every configuration value and mutable global and is where a caller must rebind
  them), `schema.sql`
  (documentation; the API builds the schema itself at boot), `rooms.db.sql`
  (**structure only** — it carries no room content), `Caddyfile`, the two systemd
  units, `roomcad.caddy`, `install-caddy.sh`, `deploy.sh`.
- `tests/` — the suite, plus `tests/run.sh` (the runner) and `tests/harness/` with the
  loaders: `load-web-module.mjs` (copies a module only when it has a BARE specifier
  the page's import map resolves, and loads everything else from its real path),
  `three-resolver.mjs` (a `registerHooks` resolver that applies that same map to the
  whole graph, which is what makes `app.js` and `walk3d.js` importable at all),
  `plan-source.mjs`, `store-source.mjs` and `server-source.mjs` (a package's source as
  one string, for the tests that grep it), `page-css.mjs` (the same idea for the
  stylesheets, in
  cascade order), `dom-stub.mjs`, `coplanar.mjs`, `overlap.mjs`. `installDOM({ page: true })` parses
  the real `roomcad/web/index.html` into the stub, which is what makes the app's
  BUTTONS testable: they are static markup, and `app.js` binds their clicks by
  querying for them as it loads.
- `.github/workflows/tests.yml` — CI. `.github/traffic.json` is badge data.
- `release.sh` — cuts a release: a dry run by default, and it tags and publishes
  only with `--publish`. It reads the version out of `roomcad/web/version.js`, so
  the tag cannot disagree with the app, and it refuses a dirty tree or a branch
  that is not `main`. `docs/release-notes-vX.Y.md` is the notes it publishes;
  `RELEASE.md` is the standard it implements.
- `THIRD_PARTY_NOTICES.md` — the licences for everything vendored under `lib/`, plus
  a SHA-256 for every file there and the version of each. Required by `RELEASE.md`
  §1.6, and **enforced** by `tests/vendored-pins.test.mjs`: update the file in the
  same commit as a vendored upgrade, or the suite fails. The pin is the point — a
  vendored dependency is one whose contents nobody checks.

## Build, test, run

No build step. The app is loaded through the inline import map in
`roomcad/web/index.html` (`"three": "./lib/three.webgpu.js"`), and the API is stdlib
Python with no `requirements.txt`, `pyproject.toml` or `setup.py`.

```bash
./tests/run.sh                # the whole suite; the real gate, exits non-zero on failure
./tests/run.sh --fast         # skips the four slow fuzz files, for iterating
./tests/run.sh plan-editing   # just the files whose name matches
ROOMCAD_TEST_TIMEOUT=300 ./tests/run.sh   # seconds per file (default 1800)

ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=ternak \
  python3 roomcad/server/server.py &        # API on 127.0.0.1:8078
cd roomcad/web && ./serve.sh                # app on http://localhost:8080
```

**The suite is slow, not instant.** `city-fuzz` alone has been measured at 705 s and
runs for over ten minutes on a busy machine; the full sweep is roughly 13–15 minutes.
Use `--fast` (about 45 s) while iterating and run the whole thing before you commit.
Each file prints its own `N passed, M failed` and the runner totals them. The
per-file timeout is 30 minutes, deliberately generous: a timeout is there to catch a
hang, and a cap tight enough to fail an honest run on a shared machine is worse than
no cap at all.

## Identity

`roomcad/web/version.js`, a single line: `export const APP_VERSION = "10.8";`. It is
the only release source, and it is **enforced** by `tests/version.test.mjs` — the
footer must render it, `app.js` must import it, and `app.js`/`index.html` must not
hard-code a `vX.Y` tag.

## Gates

CI runs the full suite on every push and pull request
(`.github/workflows/tests.yml`), on top of GitHub's dynamic CodeQL code scanning.
Locally, `./tests/run.sh` is the gate — and it is a real one: it has been seen to
fail on both an injected assertion and a timeout.

**Two of the tests are deployment contracts, not feature tests:**

- `tests/deploy-config.test.mjs` recomputes the CSP `sha256-…` hash of the inline
  import map from `index.html` and compares it against both Caddyfiles, and refuses a
  header directive prefixed with `-` (which makes Caddy *delete* the header).
- `roomcad/server/deploy.sh` validates the candidate Caddyfile with the VPS's own
  Caddy binary and aborts before installing anything if it is invalid.

Several other tests make **source contracts** — assertions that grep for exact
strings in the source. A rename can fail one without any behaviour changing, so read
the assertion before "fixing" it.

**`tests/boot.test.mjs` is a boot contract.** It walks the app's real import graph
from the two entry modules, resolves every specifier through the import map in
`index.html`, checks that every element id the code looks up exists in the page, and
refuses a module nothing loads. Those are the failures that leave every other test
green and the site a blank page. It needs no browser and no dependencies — deliberately,
because this repository has no `package.json` and a headless browser would change that.
It is **not** a substitute for loading the page: it proves the graph and the DOM
contract, not that anything renders.

## Traps

- **`serve.sh` downloads the Caddy binary into `roomcad/web/bin/` on first run**, so it
  needs network. That path is now genuinely git-ignored. The script matches the
  GitHub release JSON **in the shell, not through `grep … | head -1`** — `head` exits
  early, `grep` takes SIGPIPE, and `set -o pipefail` then aborts the first run before
  anything is downloaded. `install-caddy.sh` documents the same trap.
- **Neither installer runs an unverified download.** Both fetch the `*_checksums.txt`
  Caddy publishes for the release they resolved and check the archive's published
  SHA-512 before extracting it. A mismatch, a missing entry, or a machine with no
  hash tool **aborts without executing anything** — the check never degrades into a
  skip. `install-caddy.sh` also defaults to installing for RoomCAD only: it must not
  write into another project's directory, which is why the default is a single path.
- Start only `serve.sh` and the app still loads, but every server-side feature
  reports "server not reachable": `web/Caddyfile` proxies `/api/*` to
  `127.0.0.1:8078`.
- **The API defaults `ROOMCAD_DB_PATH` to the production path
  `/var/roomcad/rooms.db`** (`roomcad_api/state.py`). Both `ROOMCAD_DB_PATH` and
  `ROOMCAD_PASSWORD` come from the environment, so a bare
  `python3 roomcad/server/server.py` points at the live database location — always
  set both, as the run command above does. Because every module reads them as
  `state.NAME` at call time, **a test or caller must rebind them on
  `roomcad_api.state`, never on the `server` facade** — a rebind there is a silent
  no-op, and `tests/server-live.test.py` guards its temp paths so a missed rebind
  aborts instead of touching production.
- **The 3D view requires a WebGPU-capable browser.** `lib/` vendors Three.js WebGPU
  (`lib/three.core.js` carries `REVISION = '186dev'`) plus Rapier's WASM build, and
  **no CDN fallback exists**.
- Both Caddyfiles send `Cache-Control "no-cache"` deliberately — without it the
  browser applies heuristic freshness and keeps serving the previous build of an
  edited module.
- **`encode gzip` belongs on the static `handle`, not the site block.** At site level
  it also wraps the `/api/*` proxy, and that is the unbuffered SSE stream.
- **Editing the inline import map in `index.html` breaks the CSP hash**, and with it
  both the deploy-config test and the deployed page. The hash must be recomputed.
- **`deploy.sh` defaults to `root@91.99.176.243`** and rsyncs `web/` with `--delete`
  plus `server.py` and its `roomcad_api/` package, then reloads systemd units. It is a
  production deploy and needs
  SSH key access. It never rewrites `rooms.db` **contents** — but it does create the
  `roomcadapp` service account and `chown` the database, its WAL sidecars and the
  legacy `.rcad` directory, because the API no longer runs as root. A root-owned
  legacy directory would make the one-shot migration fail at boot.
- **The API runs as an unprivileged user in a sandbox** (`roomcad.service`:
  `User=roomcadapp`, `ProtectSystem=strict`, `ReadWritePaths=/var/roomcad`). It is the
  process that parses untrusted bodies and holds the database, so it is the one that
  needs it most. `systemd-analyze security` scores it 5.3 MEDIUM; the previous
  root-and-unsandboxed unit scored 9.4 UNSAFE. Verify a unit change with
  `systemd-analyze verify` before shipping it.
- **The service user must own `/var/roomcad` ITSELF, not just `rooms.db`.** SQLite in
  WAL mode creates `rooms.db-wal` and `rooms.db-shm` *beside* the database, so a
  root-owned directory that merely holds a writable file still fails at boot with
  `sqlite3.OperationalError: unable to open database file` — and it fails on the
  `PRAGMA journal_mode=WAL` line, before serving anything. `deploy.sh` does this with
  `install -d -o roomcadapp -g roomcadapp /var/roomcad`; do not replace it with a
  `chown` of the three files. Rehearsed: the unit started under the full sandbox as an
  unprivileged user against a copy of the live database and answered 401 → login →
  room list → save, which is also what proves `ReadWritePaths` lets it write.
- **`password_matches()` compares UTF-8 bytes, not str.** `secrets.compare_digest`
  raises `TypeError` on a non-ASCII `str`, which used to kill the login handler
  *before* the failure was counted — so those attempts escaped the throttle entirely.
- **State-changing requests are refused unless they are same-origin, and live streams
  are capped.** `SameSite=Lax` already stops the cookie riding a cross-site POST, so
  the `Origin`/`Referer` check in `_require_same_origin()` is a second line rather
  than the only one — but a request with **no** `Origin` at all must still be allowed,
  because curl and the test suite send none. `MAX_WATCHERS_TOTAL` and
  `MAX_WATCHERS_PER_SESSION` bound the SSE streams: a stream pins a thread, a socket
  and a queue, so the global cap protects the process and the per-session cap stops
  one client starving the rest. A refused stream answers 503 with the usual JSON
  envelope, before the SSE headers go out, and registers nothing.
- **Bodies go through `_read_json_object()`, never `_read_json()`.** The latter
  happily returns a list or a scalar, and every caller then reached for `.get(...)`.
- **Every response goes through `_send`.** Login and logout used to build their own
  because they carry a `Set-Cookie`, and both hand-wrote `Content-Length: 11` for the
  12-byte body `{"ok": true}`: one byte stayed in the socket, and with
  `protocol_version = "HTTP/1.1"` the *next* response on that connection began with a
  stray `}`, which desynchronises Caddy and anything else that trusts the header. The
  suite did not see it because `http.client` reads the declared length and discards
  what follows — so `tests/server-live.test.py` now counts the bytes on a raw socket
  instead. If a handler needs an extra header, pass `extra_headers`: the body and its
  `Content-Length` must come from one `json.dumps`.
- **No shadow caster may be given a negative depth bias** — not the room's point
  lights, not the sun, not the street lamp. Three.js renders shadow maps from back
  faces, so a closed caster already supplies the margin a bias would buy, and a
  negative one does not tighten anything: it lets light through. A 512 map over a
  wide reach needs a *normal* bias derived from its texel size instead.
  `tests/plan-seal.test.mjs` resolves every `shadow.bias` in `walk3d.js`, literal or
  named, and refuses a negative one.
- **There are two wall-length floors and they are different rules.**
  `MIN_WALL_LENGTH` (30 cm) is what the editor lets a user make — drawing and
  dragging both use it; `MIN_WALL_LENGTH_KEPT` (15 cm) is what a file may keep, so
  an older document with a 20 cm wall still opens. Using the file's threshold for
  the editor's is how 20 cm became legal to hold and impossible to make.
- **The room's light budget is spent on what the viewer can see.** More ceiling
  fixtures than `MAX_ROOM_LIGHTS` is legal; the pool goes to the nearest and
  follows the camera, and `roomLightReport()` is surfaced in the inspector rather
  than leaving a lamp that lights nothing unexplained.
- **`detectRooms()` has a memory cap and a `roomDetectionSkipped()` flag.** It
  decomposes the plan on a grid built from wall endpoints, so cost grows with the
  square of the distinct coordinates. When it gives up it returns no rooms — which
  silently turns the floor area into a bounding box and unlocks every wall — so
  anything that shows a measurement must read that flag.
- **A recorded junction decision names a junction, and an index is not one.**
  `turnDecidedAt` holds `_junctionId(axis, dir, index)` — the road **and the
  direction the vehicle is crossing it** — because with ten roads and two axes,
  index 0 names four different junctions. Holding the bare index meant a decision
  to carry straight on through index 0 one way still counted as "already decided"
  when the vehicle came back to index 0 the other way, where carrying on is not a
  road: a bus drove 13 m off the edge of the city at full cruise. Anything that
  overrides `turn`/`mustTurn` **must clear `turnDecidedAt`** — the
  stop-for-a-space path did not — and `_decideTurn` refuses to act on a "carry
  on" record at a junction with no road ahead. `tests/city-turns.test.mjs` pins
  all three, and its last section drives the real city.
- **A rewritten module is a different module instance, and that is load-bearing.**
  `load-web-module.mjs` copies a module ONLY when it has a bare specifier the import
  map resolves; a module whose imports are all relative is imported from its REAL
  path. Copying one that did not need it gave editor-fuzz a `store` the editor had
  never heard of — 133 checks became 118 passed and 13 failed with every gesture
  doing nothing. And the yes/no decision must not be a `.test()` on a global regex:
  a `g` regex carries `lastIndex` between calls, so the answer depends on how much
  of the previous module was scanned.
- **`plan.js` is a facade, and a source contract must read the whole package.**
  The model lives in `roomcad/web/plan/*.js` and `plan.js` only re-exports it, so a
  test that greps `plan.js` for a line of code is reading a file that contains no
  code — it will pass while the thing it means to pin moves, and fail the day it
  does. `tests/harness/plan-source.mjs` returns the facade and every module
  concatenated; use it, so the contract means "this appears somewhere in the model"
  rather than "in this particular file".
- **Compute a module's imports from its code, never from its text.** The split of the
  model was first generated by scanning whole files, comments included, and a doc
  comment saying "sanitize() is built on this" made `core.js` import `sanitize.js`.
  That invented cycle reordered module evaluation until a `const` read across
  modules came back `undefined` — which silently changed generated floor plans and
  failed a fuzz check on every run, with no error anywhere. Strip comments before
  looking for identifiers, and keep the leaf modules (`core.js`) dependency-free.
- **The store is composed, and a second store comes from `createStore()`.** The
  methods are spread over `roomcad/web/store/*.js` and `Object.assign`ed in
  `store.js`; `this` is still the store, and every method is an own property as
  before. Two consequences worth knowing. **A duplicate method name in two files
  would silently win**, with no error and no test failure that names it — check for
  collisions when moving a method between files. And **the old way to get a second
  store, importing `store.js` under a different query string, no longer works**:
  the query string gives a new FACADE while the state it composes stays the one
  instance, so several "clients" quietly share one room. That is exactly what
  `tests/live-multi.test.mjs` caught — one check of forty-four, and the rest would
  have gone on passing. `createStore()` builds one from `freshState()`.
- **A stylesheet is not a file any more, and the link order is part of the CSS.**
  Six sheets under `roomcad/web/styles/` replaced `styles.css`, cut at the
  section markers and linked in the original order. A test that greps the CSS must
  read the whole page through `tests/harness/page-css.mjs`, or it is asking about
  one sheet out of six. Byte-for-byte equality with the pre-split file was verified
  when the split landed; `tests/fixtures/styles-before-split.css` is kept so the
  permanent check can be "no rule was lost" rather than "nothing changed", because
  the second fails on the next legitimate edit and a gate that has to be edited
  away is one nobody trusts.
- **A stubbed module goes in the resolver, not in a rewritten source.** Four tests
  used to read `store.js` as text, replace its plan import and stub its audio
  import, and load the result as a `data:` URL — which stopped working the moment
  `store.js` became a facade, because the line being replaced was no longer in that
  file. They call `stubModule("audio.js", …)` from
  `tests/harness/three-resolver.mjs` instead, which replaces the SPECIFIER and so
  does not care which file says it or how it is spelled. The same applies to any
  module that needs a browser: stub the specifier, load the real code.
- **A module whose imports are all local is loadable as a `data:` URL; one that
  re-exports is not.** Seven tests used to read `plan.js` into a data URL, which
  worked only while it had no imports. A data URL cannot resolve a relative one.
- **`app.js` and `walk3d.js` ARE importable now** — `tests/harness/three-resolver.mjs`
  resolves the page's import map for the whole graph, which rewriting import lines
  cannot do (`walk3d` imports `three/addons/…`, and those vendored addons import the
  bare `three` themselves, so the chain dies a file deeper than any rewrite reaches).
  A test opts in by registering the hook before it imports:
  `import { register } from "node:module"; register("./harness/three-resolver.mjs", import.meta.url);`
  then a dynamic `await import("../roomcad/web/app.js")`. Registering affects only the
  imports made after it, so a test's own static imports and every other test file are
  untouched. The older tests that lift app.js functions with `new Function` still work;
  new ones should drive the real module. `walk3d.js` needs `await RAPIER.init()` before
  it will build a physics world.
- **A load that repaired or dropped something says so.** `sanitize()` returns
  `{ dropped, repaired }` and `parseRoom()` fills an optional sink with it, which
  the three paths that open a document (a local file, a stored design, the resumed
  last design) turn into a status line and — for DROPS only — a warning toast.
  Two halves matter and the second is the one that rots: it must report a wall it
  discarded, **and it must report nothing when nothing happened**. A repair pass
  that announces "repaired 2 openings" every time you open a healthy file teaches
  the user to ignore the message that exists to tell them a wall is gone. That
  nearly shipped — casting a coordinate through `clamp` can move it by 1e-17 and
  the demo room's own doors do it on one wall — which is why `fit()` ignores
  changes at rounding level (`NOISE`), and why `tests/sanitize-report.test.mjs`
  asserts a clean room and a second pass both report nothing. The report is passed
  to a sink and **never hung on the room**: `serializeRoom()` writes the whole
  object, so anything attached would travel into the next save as part of the
  document.
- **A wall's collider is oriented to the wall, not to a horizontal/vertical guess.**
  `wallRunBox()` returns the half-extents and the rotation for a run of wall, and all
  four collider sites — the wall itself, a closed door's panel, the header over a
  doorway, and `addWallSlab()` — go through it. It replaced
  `const horizontal = Math.abs(dz) < 0.001` choosing between two axis-aligned boxes,
  which read as a guard and was an **assumption**: anything not horizontal was treated
  as vertical, so a run at any other angle got a box pointing the wrong way — solid
  where the wall is not, and passable where it is. `sanitize()` drops a diagonal wall,
  so nothing in this app could reach that; which is why it was never noticed, and not a
  reason for the collider to depend on another module's filter. The two axis-aligned
  cases are deliberately left unrotated, so no wall's geometry changed;
  `tests/wall-collider.test.mjs` walks a capsule into a 45° wall, and into the box the
  old code built, so the assertion is about which one the solver stops.
- **`Walk3D.dispose()` has no caller, and is tested anyway.** The walkthrough lives for
  the page's lifetime, so teardown only ever runs on a reload — the worst state for a
  method whose whole job is releasing a renderer, a Rapier world, a 4096² shadow map
  and a cube map per lit fixture. `tests/walk3d-dispose.test.mjs` drives the real
  method on an object built from the real prototype with fake resources and checks
  every release it claims. A failure there is GPU memory that never comes back, and
  nothing else would report it.

## Task tracker

Open work lives in exactly one place: the wiki's **[Project Tracker](https://github.com/Pummelchen/RoomCAD/wiki/Project-Tracker)**.
It is a single table under `## Tasks`, and it is the only backlog — no Open/Blocked/
Parked sections, no second list, status is a column rather than a heading.

The rules that govern the table — the columns, the four types, the three statuses, the
S/M/L sizes, ownership, and the ordering that *is* the priority — are defined once in
[`docs/task-table-standard.md`](docs/task-table-standard.md). Read it before adding,
changing or closing a row.

- **An epic is a project, not a row.** Split it until each row is one independently
  closable outcome.
- **IDs are stable and never reused.** Closing deletes the row; the gap is correct.
- **Every row has a next step.** If you cannot name one, split it, block it or park it.
- **History does not live in the table.** What was tried, measured or rejected goes to
  `CHANGELOG.md` and the closing commit; the open row links to the evidence.
- **Update a row the moment its state changes**, and read the table top to bottom
  before starting work — the top Open row is the default next task.

## Releasing

**Read [`RELEASE.md`](RELEASE.md) before cutting a release.** It is this repository's
own release standard — edited here, not deployed from anywhere — and it carries both
the general rules and this repository's own section (**Part 2 wins** where the two
disagree). Do not improvise a release.

There is no compiled artifact, so §1.2.1–§1.2.4 (an `arm64` build and a `lipo`
check) have no input. Everything else applies: a release is a **source archive**
with a digest beside it, notes in `docs/`, and a published GitHub Release — cut
with **`./release.sh`**, which is a dry run until it is given `--publish`. Part 2
has the naming and the packaging details. The non-negotiables below are the ones
that bind:

- **Apple Silicon only** — build native `arm64` (M1–M6). Never `--arch x86_64`,
  never `ARCHS=arm64 x86_64`, and never `lipo -create`, which is how a universal
  binary gets made. (Nothing here compiles today; this binds the moment anything does.)
- **Assert it** — `lipo -archs <binary>` must report exactly `arm64`. A build that
  silently produced a fat binary is a release defect, not a build option.
- **Every release carries the artifacts.** A tag alone is not a release.
- **Identity is single-sourced and enforced** — never bump one declaration of the
  version or build number on its own; the build or CI must fail on a mismatch. Here
  that single source is `roomcad/web/version.js`, and `tests/version.test.mjs` is the
  enforcement.
- **Dry run first**; publish only on an explicit flag.
- **Never fetch a model, dataset or dependency to make a gate pass.** A check that
  cannot run is reported *not checked*, and the release notes must name it.
- **A deploy is not a release.** `deploy.sh` ships `main` to production; it creates no
  tag, no archive and no notes, and passing it does not satisfy this section.
