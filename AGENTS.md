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
can be rebuilt from git. There are no releases and no tags.

**There is no Swift, Xcode or native code anywhere in the tree.** An earlier native
edition was removed, and the comments that still described it as the counterpart
of this code have been corrected. The GitHub description and the repository's own
docs are kept in step with the code — if you change a fact here, change it there
too.

## Layout

- `roomcad/web/` — the app: `plan.js` (room model, grid, snapping, wall geometry and
  joins, auto-layout, the `.rcad` format; pure, no DOM, no network), `store.js`
  (editing state, tools, undo/redo, remote-apply — **it does no I/O**),
  `editor2d.js` (2D canvas), `walk3d.js` (Three.js walkthrough, Rapier physics, sun,
  bloom), `city.js` (the stylised surrounding city), `app.js` (UI glue — **the only
  module besides `login.js` that touches the network**), plus `svg.js`, `audio.js`,
  `login.js`, `version.js`, `index.html`, `serve.sh`, `Caddyfile`, and `lib/`
  (vendored Three.js WebGPU + Rapier, so the page works offline).
- `roomcad/server/` — the API and the production mirror: `server.py`, `schema.sql`
  (documentation; `server.py` builds the schema itself at boot), `rooms.db.sql`
  (**structure only** — it carries no room content), `Caddyfile`, the two systemd
  units, `roomcad.caddy`, `install-caddy.sh`, `deploy.sh`.
- `tests/` — the suite, plus `tests/run.sh` (the runner) and `tests/harness/` with the
  loaders: `load-web-module.mjs` (copies a module only when it has a BARE specifier
  the page's import map resolves, and loads everything else from its real path),
  `three-resolver.mjs` (a `registerHooks` resolver that applies that same map to the
  whole graph, which is what makes `app.js` and `walk3d.js` importable at all),
  `dom-stub.mjs`, `coplanar.mjs`, `overlap.mjs`.
- `.github/workflows/tests.yml` — CI. `.github/traffic.json` is badge data.
- `THIRD_PARTY_NOTICES.md` — the licences for everything vendored under `lib/`.
  Required by `RELEASE.md` §1.6; update it in the same commit as a vendored upgrade.

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

**The suite is slow, not instant.** `city-fuzz` alone runs for over six minutes; the
full sweep is roughly 12–15 minutes. Use `--fast` (about 30 s) while iterating and run
the whole thing before you commit. Each file prints its own `N passed, M failed` and
the runner totals them.

## Identity

`roomcad/web/version.js`, a single line: `export const APP_VERSION = "10.7";`. It is
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
- **`server.py` defaults `ROOMCAD_DB_PATH` to the production path
  `/var/roomcad/rooms.db`.** Both `ROOMCAD_DB_PATH` and `ROOMCAD_PASSWORD` come from
  the environment, so a bare `python3 roomcad/server/server.py` points at the live
  database location — always set both, as the run command above does.
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
  plus `server.py`, then reloads systemd units. It is a production deploy and needs
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
- **`app.js` and `walk3d.js` ARE importable now** — `tests/harness/three-resolver.mjs`
  resolves the page's import map for the whole graph, which rewriting import lines
  cannot do (`walk3d` imports `three/addons/…`, and those vendored addons import the
  bare `three` themselves, so the chain dies a file deeper than any rewrite reaches).
  A test opts in with `registerHooks({ resolve })` before it imports the app. The
  older tests that lift app.js functions with `new Function` still work; new ones
  should drive the real module.

## Releasing

**Read [`RELEASE.md`](RELEASE.md) before cutting a release.** It is this repository's
own release standard — edited here, not deployed from anywhere — and it carries both
the general rules and this repository's own section. Do not improvise a release.

The non-negotiables:

- **Apple Silicon only** — build native `arm64` (M1–M6). Never `--arch x86_64`,
  never `ARCHS=arm64 x86_64`, and never `lipo -create`, which is how a universal
  binary gets made. (Nothing here compiles today; this binds the moment anything does.)
- **Assert it** — `lipo -archs <binary>` must report exactly `arm64`. A build that
  silently produced a fat binary is a release defect, not a build option.
- **Every release carries the artifacts.** A tag alone is not a release.
- **Identity is single-sourced and enforced** — never bump one declaration of the
  version or build number on its own; the build or CI must fail on a mismatch.
- **Dry run first**; publish only on an explicit flag.
- **Never fetch a model, dataset or dependency to make a gate pass.** A check that
  cannot run is reported *not checked*, and the release notes must name it.
