# RoomCAD 10.8 — release notes

The first release of this repository. It is a **source archive**: nothing here is
compiled, so there is no binary, no architecture to assert and no signature — see
`README-binaries.txt` in the archive for the platform floor and what that means.

Identity is single-sourced. `roomcad/web/version.js` carries
`export const APP_VERSION = "10.8";`, the running app's footer renders that value,
and `tests/version.test.mjs` fails if `app.js` or `index.html` declares a version
of its own. The tag, the archive name and the value in the footer are the same
number by construction, not by care.

Everything below came out of a pre-production audit of the whole tree. Its record
ships in the archive: `AUDIT/ledger.md` (generated from `AUDIT/ledger.json`) lists
all 65 tasks with the evidence before and after, the commit that carries each one,
and the one task that is not done — a deploy, not a defect. `AUDIT/report.md` is
the milestone report and `AUDIT/phase-e.md` is the final verification on an
independent Linux host. Where a section below names a check, that check is the
contract that fails if the fix is undone.

## The gate

`./tests/run.sh` — **41 files, 2405 checks, 0 failures**. CI runs the whole suite,
serially, on every push to `main` and on every pull request, plus GitHub's dynamic
CodeQL. The runner has been seen to fail on an injected assertion and on a
timeout, which is why it is trusted; that evidence is in `AUDIT/phase-e.md`.

## The 3D walkthrough starts at all

- **It did not.** The commit that split `walk3d.js` onto its prototype dropped
  four runtime imports, so `RoomEnvironment` and three other symbols were undefined
  and the walkthrough could not start. Backed by `tests/room-lights.test.mjs` (18),
  `tests/three-environment.test.mjs` (105) and `tests/walk3d-dispose.test.mjs` (21).
- **Ambient occlusion and bloom never ran.** The same split lost the two TSL
  imports, so the post-processing passes were built and never applied. Backed by
  `tests/audit-walk3d.test.mjs` (78).
- **The floor texture could exceed the GPU limit.** The canvas was sized by room
  area with no cap: a legal 60 m plate asked for 9600², about 351 MB. Backed by
  `tests/audit-walk3d.test.mjs`.
- **Paintball hit the sky.** `shootableMeshes()` included the sky dome and the
  weather, so the documented 60 m fallback range was dead and a shot at the
  horizon reported a hit. Backed by `tests/audit-walk3d.test.mjs`.

## Opening and saving a document is safe

- **A malformed document crashed the editor.** `sanitize()` was not total: five
  dereference sites threw a `TypeError` and took the whole room with them. It now
  returns a room or nothing. Backed by `tests/audit-plan.test.mjs` (113).
- **A save whose `json` was not a string killed the request.** `POST /api/save`
  passed a dict straight to SQLite and raised inside the handler; it is now a 400.
  Backed by `tests/server-live.test.py` (138) and `tests/data-safety.test.mjs` (24).
- **Saving reported success when the save had not been verified.** `saveRoom()`
  returned the verification result rather than the save result. Backed by
  `tests/live-mode.test.mjs` (70).
- **The discard guard lied.** It asked "Save changes?" and discarded on OK.
  Backed by `tests/audit-app.test.mjs` (57).
- **Opening a file left the live stream running**, and the `EventSource` had no
  `onerror`, so a refused stream was never noticed or reopened. Backed by
  `tests/live-mode.test.mjs`.
- **The repair report was not faithful** — some repairs were silent and some
  "repairs" were false, so a healthy file could announce work that did not happen.
  Backed by `tests/sanitize-report.test.mjs` (31).

## Editing behaves

- **Widening a door or window from the inspector deleted it.** Backed by
  `tests/audit-plan.test.mjs`.
- **A drag released off-canvas never ended** and the wall or furniture followed the
  pointer. The canvas now captures the pointer. Backed by
  `tests/editor-behaviour.test.mjs` (37).
- **An endpoint drag could snap a wall off-axis**, after which `sanitize()` deleted
  the wall and every opening on it. Backed by `tests/audit-plan.test.mjs`.
- **Clearing the zoom field pinned the zoom at the 20% floor**, and wheel zoom
  ignored `deltaMode`, so a line-mode wheel moved it 100× too far. Backed by
  `tests/audit-app.test.mjs`.
- **Ctrl/Cmd-S from inside a field saved the previous value.** Backed by
  `tests/app-clicks.test.mjs` (32).
- **Undo could be destroyed by the drag it was part of**: a commit while a drag
  transaction was open fused the two and evicted a real entry at the 100-entry cap.
  Backed by `tests/audit-store.test.mjs` (33).
- **`centerRoom()` stranded every label and public area** at its old canvas
  coordinate. Backed by `tests/plan-editing.test.mjs` (198).
- **Duplicate object ids survived sanitize**, so deleting one wall deleted every
  wall sharing its id. Backed by `tests/audit-plan.test.mjs`.
- **`"constructor"` and `"__proto__"` passed validation.** The grid-step and
  furniture-kind checks used a prototype-chain lookup; both now own-property
  checks. Backed by `tests/audit-plan.test.mjs`.
- **A blocked `AudioContext` threw out of the edit** that played the sound.
  Backed by `tests/audit-app.test.mjs`.

## Working together on one room

- **A stale client could overwrite a teammate's edit.** The live sequence was
  adopted before the message was parsed, so a dropped message still advanced the
  client's position. Backed by `tests/live-multi.test.mjs` (44).
- **A remote update clobbered a local edit that had not been published yet** and
  cleared both undo stacks. Backed by `tests/live-state.test.mjs` (10).
- **An unreachable server was retried in a tight loop**: the backoff started at
  zero. Backed by `tests/live-mode.test.mjs`.
- **One throwing listener disabled every later one** — a single subsystem failure
  turned off the rest of the app. Backed by `tests/audit-store.test.mjs`.
- **The login framing was wrong.** `POST /api/login` and `/api/logout` hand-wrote
  `Content-Length: 11` for the 12-byte body `{"ok": true}`. One byte stayed in the
  socket, and because the API keeps the connection alive, the *next* response on it
  began with a stray `}` — which desynchronises Caddy and any client that trusts the
  header. Both now go through one sender, so the body and its length come from the
  same call. The old suite could not see this (`http.client` reads the declared
  length and discards the rest), so the new checks count the bytes on a raw socket,
  and both were proved to fail on the old code first. Backed by
  `tests/server-live.test.py`.
- **Every login failure said "Wrong password."**, including a lockout (429) and a
  server error (500). Backed by `tests/login.test.mjs` (23).

## Rendering user text is safe

- **Twelve `innerHTML` sinks built markup by hand-written interpolation**, which is
  stored XSS through a room name, a label or an SVG title. They now go through one
  escaping primitive (`safeMarkup`/`safeHtml`), and `options.scale` — the one value
  interpolated into the SVG without escaping — is escaped like every other. Backed
  by `tests/audit-xss.test.mjs` (51), which renders a hostile name and label through
  the real builders. Every `no-unsanitized` rule is back at `error` with no waiver.

## The city outside the window

- **The city's lamps follow the time of day**: lit in daylight as running lamps,
  brighter after dark, brakes brighter than tail lights. This was already true; the
  comment claiming it was an open question was not. Backed by
  `tests/city-fuzz.test.mjs` (369).
- **A generated room can no longer be given no door.** The one-room base case of
  the auto-layout partition now performs the frontage check its comment always
  claimed, and a piece with no frontage becomes open floor rather than a room
  nobody can enter. Backed by `tests/auto-layout.test.mjs` (96) and
  `tests/layout-fuzz.test.mjs` (35).

## Internal changes worth knowing

- **`city.js` (5301 lines) and `server/server.py` (1241 lines) are split** into a
  facade plus modules, the way `walk3d.js` and `editor2d.js` already were. Both
  are byte-identical moves: 103 class members and 212 declarations for the city,
  45 AST-identical functions for the API. `server.py` stays the runnable entry
  point, and `state.py` owns the configuration — with a loud guard in the API's
  test, because a rebind that silently missed would have pointed the suite at the
  production database.
- **Bandit now scans `roomcad/server` rather than `server.py`**, which after the
  split would have been scanning a facade and almost nothing else.

## Checks that did not run

Named rather than left to be assumed, because "not checked, no input" and "checked
and identical" are different sentences:

- **No browser, WebGPU or otherwise, was driven against this release.** The 3D
  code is exercised by driving the real prototypes with fake resources and by
  resolving every shadow bias, but nothing in this repository renders a frame, and
  `tests/boot.test.mjs` deliberately stops at the module graph. "It looks right
  after dark" is **not** claimed.
- **No architecture assertion.** §1.2.1–§1.2.4 ask for a native `arm64` build and a
  `lipo -archs` check; nothing in this repository compiles, so there is no binary to
  assert. This is a source release and those rules have no input.
- **Semgrep and bandit were run on the primary host, not in the Phase E container.**
  Ruff, shellcheck, eslint and gitleaks were re-run there. Scanning the same commit
  with the same pinned rules on a second host would not change the result.
- **Coverage is reported, not gated.** It is not a threshold that can fail a build.
- **The production deploy has not run.** The live site still serves 10.8's
  predecessor; deploying is a separate, manual act that this release does not
  perform (`RELEASE.md` §1.5: a deploy is not a release).
- **CodeQL is GitHub's dynamic scan** and runs on GitHub, not here.

## Checksums

    SHA256_PENDING  roomcad-10.8-src.tar.gz
    ARCHIVE_BYTES_PENDING  bytes

Both lines are substituted at publish time from the archive actually uploaded, and
the same digest is published beside it as `roomcad-10.8-src.tar.gz.sha256`. Verify
with:

    shasum -a 256 -c roomcad-10.8-src.tar.gz.sha256
