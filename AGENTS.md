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
edition was removed; the only traces left are a few comments in `plan.js`/`store.js`
that predate the web port. The GitHub description and the repository's own docs are
kept in step with the code — if you change a fact here, change it there too.

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
  loaders (`load-web-module.mjs` rewrites only the bare `three` specifier and loads
  everything else from its real path, plus `dom-stub.mjs`, `coplanar.mjs`,
  `overlap.mjs`).
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
ROOMCAD_TEST_TIMEOUT=300 ./tests/run.sh   # seconds per file (default 900)

ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=ternak \
  python3 roomcad/server/server.py &        # API on 127.0.0.1:8078
cd roomcad/web && ./serve.sh                # app on http://localhost:8080
```

**The suite is slow, not instant.** `city-fuzz` alone runs for over six minutes; the
full sweep is roughly 12–15 minutes. Use `--fast` (about 30 s) while iterating and run
the whole thing before you commit. Each file prints its own `N passed, M failed` and
the runner totals them.

## Identity

`roomcad/web/version.js`, a single line: `export const APP_VERSION = "10.5";`. It is
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

## Traps

- **`serve.sh` downloads the Caddy binary into `roomcad/web/bin/` on first run**, so it
  needs network. That path is now genuinely git-ignored. The script matches the
  GitHub release JSON **in the shell, not through `grep … | head -1`** — `head` exits
  early, `grep` takes SIGPIPE, and `set -o pipefail` then aborts the first run before
  anything is downloaded. `install-caddy.sh` documents the same trap.
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
- **Bodies go through `_read_json_object()`, never `_read_json()`.** The latter
  happily returns a list or a scalar, and every caller then reached for `.get(...)`.

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
