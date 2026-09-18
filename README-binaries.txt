RoomCAD — what is in this archive
=================================

This is a SOURCE archive. It contains no compiled binaries, and there is nothing
in it to code-sign, notarise or quarantine. Read the rest of this file for the
platform floor it does have.

Identity
--------

The version is in `roomcad/web/version.js` — a single line,
`export const APP_VERSION = "10.8";`. It is the only version source in the
project: the footer of the running app renders that value, and
`tests/version.test.mjs` fails if anything else declares one. If the version you
see in the footer is not the version in this file's name, you are not running
this archive.

Platform floor
--------------

Nothing here is compiled, so there is no CPU architecture requirement and no
Apple-Silicon build to assert. What the archive does need:

  * The 2D planner and the editing app: any current browser (ES modules, no
    bundler, no build step). No network access is needed — Three.js WebGPU and
    Rapier's WASM build are vendored under `roomcad/web/lib/`.

  * The 3D walkthrough: a browser with WebGPU. This is a real floor, not a
    preference — `Walk3D` cannot start without it, and there is no WebGL
    fallback and no CDN fallback. On Safari, WebGPU must be enabled.

  * The save/live-collaboration API: Python 3 with the standard library only.
    No `pip install`, no `requirements.txt`, no virtualenv. It is developed
    against 3.11–3.14 and run in CI on 3.12.

  * Serving the app: Caddy, or any static file server. `roomcad/web/serve.sh`
    downloads a Caddy for local use on first run, which needs network once.

Signing
-------

There are no binaries, so this archive is neither code-signed nor notarised —
there is no signature to verify and no Gatekeeper prompt to clear. If you build
something from it yourself, that artifact's signing status is your own.

Because there is nothing executable in the archive, the usual
`xattr -dr com.apple.quarantine <path>` step does not apply here and is not
needed. Do not treat the absence of that instruction as a claim that anything in
this archive is signed: nothing is.

Verify what you downloaded
--------------------------

Fetch the `.sha256` file published beside this archive and check it:

    shasum -a 256 -c roomcad-10.8-src.tar.gz.sha256

The digest is also quoted in the release's notes. A digest that does not match
means the download is not the archive that was published.

Where the rest of the documentation is
--------------------------------------

  * `README.md` — what the project is and how to run it.
  * `AGENTS.md` — the repository's one instruction file: layout, gates, traps.
  * `RELEASE.md` — this project's release standard, including why this archive
    is a source archive (§1.6 is the rule that asks for this file).
  * `THIRD_PARTY_NOTICES.md` — the licence and a SHA-256 for every vendored file
    under `roomcad/web/lib/`. Required by `RELEASE.md` §1.6, and enforced by
    `tests/vendored-pins.test.mjs`.
  * `LICENSE` — the project's own licence.
