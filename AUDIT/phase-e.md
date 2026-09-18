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
