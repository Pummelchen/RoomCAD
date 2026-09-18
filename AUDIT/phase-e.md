# AUDIT — Phase E: the single final verification on the independent host (§11)

Run from a **fresh clone** on one independent host, in a single clean run.
The host is a Linux container under colima (a genuine second OS, native aarch64,
not the primary Mac). Nothing here was run against production.

The run was performed three times as the tree changed: on `bed325a`, on
`3ec7f71`, and finally on `006c54e` **after** the follow-up work that removed the
last lint waivers (`T0054`–`T0059`). Each run passed every check; the numbers
below are the final run's.

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

## Results — 13 PASS, 0 FAIL, 1 SKIP (since closed)

```
=== fresh clone from /src (audit/2026-09-18) ===
HEAD: 006c54e audit(T0059): rename the local that shadowed the exported drag object, and enable no-shadow for production
node: v24.21.0  npm: 11.19.0  python: Python 3.11.2
os:   Linux 6.8.0-117-generic aarch64
=== clean tree ===
PASS  clone
PASS  clone is clean
=== build — Python imports + app module graph ===
PASS  compileall
PASS  boot import graph: 20 passed, 0 failed — the page can boot
=== full test suite (no --fast) ===
PASS  suite: 41 files run, 2401 assertions passed, 0 failed
=== coverage (c8, --fast) ===
PASS  npm ci
  Statements   : 57.37% ( 11124/19389 )
  Branches     : 80.91% ( 2150/2657 )
  Functions    : 59.07% ( 384/650 )
  Lines        : 57.37% ( 11124/19389 )
PASS  coverage run green
=== scanners (portable) ===
PASS  ruff check
PASS  ruff format
PASS  shellcheck
PASS  eslint (0 errors, 0 warnings)
=== zero production placeholders / facades ===
PASS  no facade markers on a production path
=== secret scan (working tree) ===
SKIP  gitleaks not installed
=== ledger open count ===
tasks: 59  done: 59  blocked: 0  open: 0
PASS  ledger open count is 0

PHASE E: ALL CHECKS PASSED on Linux 6.8.0-117-generic aarch64
```

### The one SKIP, closed in a second run

`gitleaks` was not in the base image, so the script reported **SKIP** rather than
passing vacuously (RELEASE.md §1.2.7: a check that cannot run is reported *not
checked*). It was installed from the upstream release in the same container and
the check was then run over the fresh clone's full history:

```
$ /tmp/gitleaks detect --source . --log-opts="--all" --redact
237 commits scanned.
scanned ~11892810 bytes (11.89 MB) in 2.71s
no leaks found
final gitleaks findings: 0
```

So every Phase E check ran and passed; the SKIP is closed and nothing is
reported as "not checked" in the final run.

## Final metrics versus the committed baseline

| metric | baseline | final | verdict |
| ------ | -------- | ----- | ------- |
| full suite files | 35 | **41** | +6 |
| full suite assertions | 2045 | **2401** | +356 |
| suite failures | 0 | **0** | unchanged |
| coverage, lines | 50.65% (9488/18729) | **57.37%** (11124/19389) | +1636 lines covered |
| coverage, functions | 47.34% (294/621) | **59.07%** (384/650) | +90 functions |
| coverage, branches | 79.75% (1647/2065) | **80.91%** (2150/2657) | +503 covered branches; the dip of the earlier run is gone |
| ruff check (`roomcad tests`) | 4 errors | **0** | fixed (T0045) |
| ruff format `--check` | 2 files | **0** | fixed (T0045) |
| bandit (`server.py`) | 0 | **0** | unchanged |
| eslint `roomcad/web tests` | 253 errors | **0 errors, 0 warnings** | every disposition removed (T0054–T0059) |
| shellcheck (warnings+) | 1 warning | **0** | fixed (T0044) |
| gitleaks (full history) | 0 leaks | **0 leaks** | unchanged, now over 237 commits |
| Caddy `validate` | both valid | **both valid** | unchanged |
| production placeholders / facades | 0 | **0** | unchanged |
| ledger open count | n/a | **0** | §12 |

Every metric is the same or strictly better than the baseline; no metric is
worse. The earlier run's fractional branches dip (79.68% against 79.75%) was
removed by the follow-up work, which added tests for the paths it touched.

## The follow-up work this run verifies

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

The verified tree is `006c54e`. Every commit after it in this branch changes
**only files under `AUDIT/`** (this record and the generated report), which no
part of the verification consumes: the suite, `boot.test.mjs`, the linters and the
ledger check read `roomcad/` and `tests/`. The check is one command, and it is the
guarantee:

```bash
git diff --name-only 006c54e..HEAD | grep -v '^AUDIT/'   # must print nothing
```

## What Phase E does not claim

- It is not a browser test. `boot.test.mjs` proves the module graph and the DOM
  contract; no real browser was driven, so "the page renders" is not claimed for
  any change (unchanged from the baseline, and stated in `AGENTS.md`).
- The production VPS was never contacted, deployed to, or read from (§0).
- Semgrep and bandit were run on the primary host (their results are in
  `baseline.md` and `tool-coverage.md`) and not re-installed in the container;
  the container re-ran ruff, shellcheck, eslint and gitleaks. Scanning the same
  commit with the same pinned rules on a second host would not change the result,
  and the portable set is the one that can be installed from the distro.
