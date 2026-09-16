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

**The GitHub description ("Shophouse room planner for macOS") is stale** — there is
no Swift, Xcode or native code anywhere in the tree. The only macOS-specific
artefacts left are `.build/` and `.swiftpm/` entries in `.gitignore`, from a removed
native edition.

## Layout

- `roomcad/web/` — the app: `plan.js` (room model, grid, snapping, wall geometry and
  joins, auto-layout, the `.rcad` format), `store.js` (editing state, tools,
  undo/redo, save/open, remote-apply), `editor2d.js` (2D canvas), `walk3d.js`
  (Three.js walkthrough, Rapier physics, sun, bloom), `city.js` (the stylised
  surrounding city), `app.js` (UI glue), plus `svg.js`, `audio.js`, `login.js`,
  `version.js`, `index.html`, `serve.sh`, `Caddyfile`, and `lib/` (vendored Three.js
  WebGPU + Rapier, so the page works offline).
- `roomcad/server/` — the API and the production mirror: `server.py`, `schema.sql`,
  `rooms.db.sql`, `Caddyfile`, the two systemd units, `roomcad.caddy`,
  `install-caddy.sh`, `deploy.sh`.
- `tests/` — the suite, and `tests/harness/` with the loaders
  (`load-web-module.mjs` rewrites only the bare `three` specifier and loads
  everything else from its real path, plus `dom-stub.mjs`, `coplanar.mjs`,
  `overlap.mjs`).
- `.github/` contains only `traffic.json` (badge data) — **there is no CI workflow.**

## Build, test, run

No build step. The app is loaded through the inline import map in
`roomcad/web/index.html` (`"three": "./lib/three.webgpu.js"`), and the API is stdlib
Python with no `requirements.txt`, `pyproject.toml` or `setup.py`.

```bash
for t in tests/*.mjs; do node "$t"; done    # no runner, no aggregator, no npm test
python3 tests/server-live.test.py           # 82 passed, 0 failed

ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=ternak \
  python3 roomcad/server/server.py &        # API on 127.0.0.1:8078
cd roomcad/web && ./serve.sh                # app on http://localhost:8080
```

**The `.mjs` suites are slow, not instant** — the full sweep took roughly 12 minutes
here, dominated by `city-fuzz` at over 6 minutes alone. Run individual files while
iterating.

## Identity

`roomcad/web/version.js`, a single line: `export const APP_VERSION = "10.4";`. It is
the only release source, and it is **enforced** by `tests/version.test.mjs` — the
footer must render it, `app.js` must import it, and `app.js`/`index.html` must not
hard-code a `vX.Y` tag.

## Gates

No CI beyond GitHub's dynamic CodeQL code scanning; the test suite is the local
gate. **Two of those tests are deployment contracts, not feature tests:**

- `tests/deploy-config.test.mjs` recomputes the CSP `sha256-…` hash of the inline
  import map from `index.html` and compares it against both Caddyfiles, and refuses a
  header directive prefixed with `-` (which makes Caddy *delete* the header).
- `roomcad/server/deploy.sh` validates the candidate Caddyfile with the VPS's own
  Caddy binary and aborts before installing anything if it is invalid.

## Traps

- **`serve.sh` downloads the Caddy binary into `roomcad/web/bin/` on first run**
  (picking the asset from `uname -m`), so it needs network. `roomcad/README.md` calls
  `web/bin/` "git-ignored" — **it is not**: the root `.gitignore` has no `bin` entry
  and `git check-ignore roomcad/web/bin/caddy` exits 1, so a downloaded Caddy is
  stageable.
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
- **Editing the inline import map in `index.html` breaks the CSP hash**, and with it
  both the deploy-config test and the deployed page. The hash must be recomputed.
- **`deploy.sh` defaults to `root@91.99.176.243`** and rsyncs `web/` with `--delete`
  plus `server.py`, then reloads systemd units. It is a production deploy and needs
  SSH key access. It deliberately never touches the live `rooms.db`.
- `.gitignore` still lists Swift/SwiftPM artefacts (`.build/`, `.swiftpm/`) from the
  removed native edition; nothing in the tree produces them.

## Releasing

**Read [`RELEASE.md`](RELEASE.md) before cutting a release.** It is this repository's
own release standard — edited here, not deployed from anywhere — and it carries both
the general rules and this repository's own section. Do not improvise a release.

The non-negotiables:

- **Apple Silicon only** — build native `arm64` (M1–M6). Never `--arch x86_64`,
  never `ARCHS=arm64 x86_64`, and never `lipo -create`, which is how a universal
  binary gets made.
- **Assert it** — `lipo -archs <binary>` must report exactly `arm64`. A build that
  silently produced a fat binary is a release defect, not a build option.
- **Every release carries the artifacts.** A tag alone is not a release.
- **Identity is single-sourced and enforced** — never bump one declaration of the
  version or build number on its own; the build or CI must fail on a mismatch.
- **Dry run first**; publish only on an explicit flag.
- **Never fetch a model, dataset or dependency to make a gate pass.** A check that
  cannot run is reported *not checked*, and the release notes must name it.
