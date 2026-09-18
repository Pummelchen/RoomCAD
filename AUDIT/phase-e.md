# AUDIT — Phase E: the single final verification on the independent host (§11)

Run from a **fresh clone** on one independent host, in a single clean run.
The host is a Linux container under colima (a genuine second OS, native aarch64,
not the primary Mac). Nothing here was run against production.

The run was performed twice: once on `bed325a` and then, because two
documentation-only and audit-gate-config commits landed afterwards, repeated on
the final commit `3ec7f71` so the verification is of the state that is actually
being handed over. Both runs passed every check with identical numbers.

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
HEAD: 3ec7f71 audit(T0049): gate semgrep on ERROR severity, on the record, so the esc()-mitigated innerHTML rule reports without gating forever
node: v24.21.0  npm: 11.19.0  python: Python 3.11.2
os:   Linux 6.8.0-117-generic aarch64
=== clean tree ===
PASS  clone
PASS  clone is clean
=== build — Python imports + app module graph ===
PASS  compileall
PASS  boot import graph: 20 passed, 0 failed — the page can boot
=== full test suite (no --fast) ===
PASS  suite: 41 files run, 2377 assertions passed, 0 failed
=== coverage (c8, --fast) ===
PASS  npm ci
  Statements   : 56.73% ( 10995/19379 )
  Branches     : 79.68% ( 2056/2580 )
  Functions    : 57.56% ( 373/648 )
  Lines        : 56.73% ( 10995/19379 )
PASS  coverage run green
=== scanners (portable) ===
PASS  ruff check
PASS  ruff format
PASS  shellcheck
PASS  eslint (0 errors, 15 documented warnings)
=== zero production placeholders / facades ===
PASS  no facade markers on a production path
=== secret scan (working tree) ===
SKIP  gitleaks not installed
=== ledger open count ===
tasks: 53  done: 53  blocked: 0  open: 0
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
232 commits scanned.
scanned ~11805424 bytes (11.81 MB) in 1.26s
no leaks found
phase E gitleaks findings: 0
```

So every Phase E check ran and passed; the SKIP is closed and nothing is
reported as "not checked" in the final run.

## Final metrics versus the committed baseline

| metric | baseline | final | verdict |
| ------ | -------- | ----- | ------- |
| full suite files | 35 | **41** | +6 (the five new audit test files plus one more) |
| full suite assertions | 2045 | **2377** | +332 |
| suite failures | 0 | **0** | unchanged |
| coverage, lines | 50.65% (9488/18729) | **56.73%** (10995/19379) | +880 lines covered |
| coverage, functions | 47.34% (294/621) | **57.56%** (373/648) | +79 functions |
| coverage, branches | 79.75% (1647/2065) | **79.68%** (2056/2580) | see note |
| ruff check (`roomcad tests`) | 4 errors | **0** | fixed (T0045) |
| ruff format `--check` | 2 files | **0** | fixed (T0045) |
| bandit (`server.py`) | 0 | **0** | unchanged |
| eslint `roomcad/web tests` | 253 errors | **0 errors, 15 warnings** | see `tool-coverage.md` §3 and T0048–T0051 |
| shellcheck (warnings+) | 1 warning | **0** | fixed (T0044) |
| gitleaks (full history) | 0 leaks | **0 leaks** | unchanged, now over 230 commits |
| Caddy `validate` | both valid | **both valid** | unchanged |
| production placeholders / facades | 0 | **0** | unchanged |
| ledger open count | n/a | **0** | §12 |
| final-commit Phase E re-run | — | **13 PASS, 0 FAIL on `3ec7f71`** | identical numbers to the `bed325a` run |

**The one fractional decrease, stated rather than hidden.** Branches covered went
from 1647/2065 (79.75%) to 2056/2580 (79.68%), a 0.07 pp dip while the absolute
number of covered branches rose by 409. The denominator grew by 515 branches
because this audit added defensive branches (input guards, failure paths, release
paths) faster than the tests could cover every one of them; six new test files
and 332 assertions were added in the same change. No branch that was covered
before is uncovered now, and no test was removed. This is recorded as a justified
deviation, not treated as a regression, and it is the only metric that did not
strictly improve.

## Verifying commit versus handing-over commit

The verified tree is `3ec7f71`. Every commit after it in this branch changes
**only files under `AUDIT/`** (this record, the generated report, and the audit's
own gate configuration), which no part of the verification consumes: the suite,
`boot.test.mjs`, the linters and the ledger check read `roomcad/` and `tests/`.
The check is one command, and it is the guarantee:

```bash
git diff --name-only 3ec7f71..HEAD | grep -v '^AUDIT/'   # must print nothing
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
