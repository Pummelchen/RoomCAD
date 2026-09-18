# AUDIT — RoomCAD inventory, trust boundaries and risk tiers (Phase A, §2)

Audit branch: `audit/2026-09-18`. Base commit at discovery: `dbba4df`.
This document is the §2.1–§2.4 deliverable. It is committed **before** any fix.

## 1. Projects, languages, build systems, entry points, hosts

| # | Project | Language(s) | Build system | Entry point(s) | Primary host |
| - | ------- | ----------- | ------------ | -------------- | ------------ |
| P1 | RoomCAD web app (`roomcad/web/`) | JavaScript (browser ES modules, no bundler) | none — inline import map in `index.html`; served by Caddy | `roomcad/web/index.html` → `login.js`, `app.js` | Mac (macOS 27.0, arm64) |
| P2 | RoomCAD API (`roomcad/server/server.py`) | Python 3, stdlib only, SQLite | none | `python3 roomcad/server/server.py` (systemd `roomcad.service`) | Mac for baseline/tests; production is the VPS (`91.99.176.243`) — **never touched by this audit** |
| P3 | Test suite (`tests/`) | JavaScript (Node ESM) + 1 Python file | `tests/run.sh` (hand-rolled runner) | `./tests/run.sh` | Mac (primary) |
| P4 | Ops / deploy (`roomcad/server/deploy.sh`, `install-caddy.sh`, both `Caddyfile`s, `roomcad.caddy`, `*.service`, `roomcad/web/serve.sh`) | Bash + Caddyfile + systemd units | none | `deploy.sh`, `serve.sh` | Mac (review only; **no deploy is executed — §0**) |

Vendored third-party code: `roomcad/web/lib/` (Three.js WebGPU `REVISION 186dev`, Rapier WASM,
TSL addons, `RoomEnvironment`, `ImprovedNoise`, `BufferGeometryUtils`). Integrity is already
pinned by SHA-256 in `THIRD_PARTY_NOTICES.md` and enforced by `tests/vendored-pins.test.mjs`.

**No Swift, Xcode or native (C/C++/Objective-C) source exists anywhere in the tree.**
`find -name '*.swift' -o -name '*.c' -o -name '*.h' -o -name '*.m' -o -name '*.mm' -o -name '*.cpp'`
returns nothing. Xcode 27.0 / Swift 6.4 *is* installed on the primary host, but with no Swift
target the §1 Swift language standard and its proof have nothing to bind to. There is likewise no
C target, so the strict-C99 standard and the ASan/UBSan requirement have nothing to bind to.
This is recorded as **N/A (no target)**, not as a waiver and not as BLOCKED: the toolchain the
standard requires is present; the target is absent. See `environment.md` and `tool-coverage.md`.

## 2. Dependency graph (direct module deps, depth cap 2)

```
index.html ──> login.js ──────────────> fetch /api/login, /api/rooms
           └─> app.js (composes app/*.js)
                 ├─> plan.js  (facade over plan/*.js)      [pure, no DOM/IO]
                 │     ├─ core, room, grid, walls, hit, openings, furniture,
                 │     │  labels, rooms, captions, sanitize, heal
                 │     └─ layout-grid, layout-slice, layout-partition, layout,
                 │        demo, rcad
                 ├─> store.js (composes store/*.js)
                 │     ├─ base, notifications, walls, items, editing, history
                 │     └─> plan.js, audio.js
                 ├─> svg.js ──> plan.js
                 ├─> editor2d.js (+ editor2d/*.js) ──> plan.js, store.js, svg.js
                 ├─> walk3d.js (+ walk3d/*.js) ──> plan.js, lib/three.webgpu.js,
                 │                                  lib/rapier.mjs, city.js
                 ├─> city.js ──> lib/three.webgpu.js
                 └─> app/api.js ──> fetch /api/*          [the only other network module]
server.py ──> sqlite3 (rooms.db), stdlib http.server, SSE
tests/*  ──> every one of the above, plus spawn/import server.py
ops:  Caddyfile ──(CSP sha256 of the inline import map)──> index.html
      deploy.sh ──> server.py, Caddyfile, roomcad.caddy, *.service
```

### Cross-project contracts (a contract with >1 consumer is automatically Tier A)

| Contract | Producers | Consumers |
| -------- | --------- | --------- |
| HTTP `/api/*` JSON envelope + status codes | `server.py` | `app/api.js`, `app/watch.js`, `app/status.js`, `tests/server-live.test.py`, `tests/live-multi.test.mjs`, `tests/live-mode.test.mjs`, `tests/login.test.mjs` |
| Live-edit sequence protocol (`seq`/`baseSeq`/stale refusal) | `server.py` | `app/status.js`, `app/watch.js`, `app/live.js`, `tests/live-multi.test.mjs` |
| `.rcad` document format (`ROOM_FILE_FORMAT`/`ROOM_FILE_VERSION`) | `plan/rcad.js` | `plan/sanitize.js`, `app/files.js`, `app/watch.js`, `app/status.js`, the whole test suite |
| Session cookie + same-origin rule | `server.py` | `login.js`, `app/watch.js` (EventSource), `app/status.js` |
| CSP `sha256-…` of the inline import map | `index.html` | `roomcad/web/Caddyfile`, `roomcad/server/Caddyfile`, `tests/deploy-config.test.mjs`, the deployed page |
| `APP_VERSION` identity | `roomcad/web/version.js` | `app/status.js`, footer, `tests/version.test.mjs` |
| Stylesheet link order = cascade | `roomcad/web/styles/*.css` + `index.html` | `tests/harness/page-css.mjs`, `tests/styles-split.test.mjs` |

Nothing couples at 2 hops beyond these; the enumeration stops there per the depth cap.

## 3. Trust boundaries

| Boundary | Surface | Untrusted input | Tier |
| -------- | ------- | --------------- | ---- |
| B1 | HTTP API (`server.py`, reachable through two Caddy proxies) | request line, headers (`Host`, `Origin`, `Referer`, `Cookie`, `X-Forwarded-*`, `Transfer-Encoding`), body (bounded JSON), SSE registration | A |
| B2 | `.rcad` document parse (`plan/rcad.js` → `plan/sanitize.js`) | a local file the user picked, a server-stored room, **and a peer's room over SSE** — all three reach the same parser | A |
| B3 | SSE peer data (`app/watch.js`) | `data.json` from any other authenticated collaborator | A |
| B4 | Browser DOM: `innerHTML` built from room names / label text | `app/files.js`, `app/sidebar.js`, `svg.js` (SVG/XML output) | A |
| B5 | Caddy config / CSP / systemd sandbox | operator-owned, but a wrong directive silently removes a protection | A |
| B6 | SQLite (`rooms.db`) | written only through parameterised statements in `server.py` | A |

There is **no native-interop seam** (no module map / bridging header / `UnsafePointer` / `String(cString:)`),
because there is no native code. The nearest analogue is the vendored Rapier WASM boundary,
which is Tier C (vendored) and integrity-pinned.

## 4. Module tier table

`Tier A` = deep manual. `Tier B` = tool-first, manual only on tool findings / coverage gaps /
hotspots. `Tier C` = scanner-only. Unsure ⇒ A.

| Module | Tier | Why |
| ------ | ---- | --- |
| `server.py` | **A** | B1: network-facing, untrusted parsing, credential holder, persistent-data mutation, rate limiting, irreversible legacy migration |
| `plan/rcad.js`, `plan/sanitize.js`, `plan/core.js` | **A** | B2: untrusted document parsing; `clamp`/`quarterTurn` underpin every repair |
| `plan/rooms.js` (`detectRooms`) | **A** | memory cap + `roomDetectionSkipped()` flag drive measurements and wall unlocking |
| `plan/walls.js`, `plan/heal.js` | **A** | geometry that decides what a wall encloses; feeds physics + room detection |
| `plan/room.js`, `plan/openings.js`, `plan/furniture.js`, `plan/hit.js` | **A** | read untrusted room fields; placements decide collisions |
| `plan/labels.js`, `plan/captions.js` | B | text/dimension rendering |
| `plan/grid.js` | B | snapping maths |
| `plan/layout*.js`, `plan/demo.js` | B | generator; fuzz-covered |
| `store/history.js`, `store/editing.js` | **A** | undo/redo and edit application are the user's work; a wrong snapshot loses it |
| `store/walls.js`, `store/items.js`, `store/base.js`, `store/notifications.js` | B | edit helpers, tool state |
| `app/api.js`, `app/watch.js`, `app/live.js`, `app/status.js`, `app/files.js` | **A** | B1/B3: network, SSE, save/load lifecycle, destructive-delete guard |
| `app/ui.js` | **A** | B4: `esc()` / `innerHTML` — the escaping gate for room-controlled text |
| `app/main.js`, `app/view.js`, `app/keys.js`, `app/toolbar.js`, `app/sidebar.js`, `app/inspector.js`, `app/state.js` | B | UI glue |
| `login.js` | **A** | credential entry path (B1) |
| `svg.js` | **A** | B4: generates XML from room text — injection boundary |
| `editor2d.js` + `editor2d/*` | B | canvas drawing/input; no untrusted parse |
| `walk3d.js` + `walk3d/*`, `city.js` | B | rendering/physics over already-sanitised data; GPU resource lifecycle |
| `audio.js`, `version.js` | B/C | trivial / identity |
| `styles/*.css` | C | scanner-only (cascade order is Tier A but is pinned by a test, not read by eye) |
| `tests/**` | **C** | §2.4: tests are scanner-only. The *contracts they pin* live in Tier A modules |
| `roomcad/web/lib/**` | C | vendored + generated, SHA-256-pinned |
| `roomcad/server/*.sh`, `Caddyfile`, `roomcad.caddy`, `*.service` | **A** | B5 + irreversible production operations (deploy/migration); reviewed, never executed |
| `README.md`, `AGENTS.md`, `RELEASE.md`, `THIRD_PARTY_NOTICES.md`, `roomcad/**/README.md` | C | docs |
| `.github/workflows/tests.yml`, `.github/traffic.json` | **A/B** | CI is the only gate; its pins are a supply-chain surface (Tier A for L0), traffic.json is badge data (C) |

## 5. Tier coverage disclosure

- **Tier A**: read by a human in full (L2/L3/L4), plus SAST and the language gate.
- **Tier B**: gated by eslint/ruff/shellcheck/bandit/semgrep + the test suite; a human reads only
  tool findings, coverage gaps, and complexity/change hotspots.
- **Tier C**: formatter/linter/secret-scan only, except that `tests/run.sh` and CI are the gate and
  are exercised for real.

This reduced inspection is disclosed here and repeated in the final report; it is never hidden.
