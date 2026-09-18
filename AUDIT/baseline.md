# AUDIT — baseline (§3)

One baseline, on the primary host (`mac-local`), at base commit `dbba4df` plus
the Phase A audit scaffolding only. Every later state is compared against this.
The yardstick is committed so "no metric got worse" is checkable.

## 1. Build

There is no compiled artifact (there is no `package.json`, no bundler and no
build system). "Build" is therefore: the Python imports, the browser module graph
resolves, and the Caddy configs adapt.

| Check | Baseline | Command |
| ----- | -------- | ------- |
| Python importability | clean | `python3 -m compileall -q roomcad tests` |
| App module graph + DOM contract | 20 passed, 0 failed | `node tests/boot.test.mjs` (walks the real import graph from both entry modules and resolves every specifier through `index.html`'s import map) |
| Caddyfile (`server`) | valid | `caddy validate --config roomcad/server/Caddyfile --adapter caddyfile` |
| Caddyfile (`web`) | valid | `caddy validate --config roomcad/web/Caddyfile --adapter caddyfile` |
| Compiler warnings | **N/A** — nothing is compiled; `node --check` is not used and no linter warning is suppressed anywhere. | — |

## 2. Test suite

Run in full (not `--fast`), serially, on the primary host. **This is the real
gate.**

```
35 files run, 2045 assertions passed, 0 failed
All green.  (runner exit 0)
```

Per file (assertions passed / failed, seconds):

| file | s | result | | file | s | result |
| ---- | - | ------ | - | ---- | - | ------ |
| app-clicks | 0 | 32/0 | | live-mode | 0 | 70/0 |
| app-internals | 1 | 57/0 | | live-multi | 4 | 44/0 |
| app-wiring | 0 | 20/0 | | live-state | 0 | 10/0 |
| auto-layout | 15 | 96/0 | | login | 0 | 23/0 |
| boot | 0 | 20/0 | | mode-switch | 0 | 24/0 |
| city-fuzz | 866 | 369/0 | | model-fuzz | 10 | 16/0 |
| city-physics | 4 | 46/0 | | plan-editing | 0 | 198/0 |
| city-turns | 13 | 13/0 | | plan-seal | 0 | 154/0 |
| data-safety | 0 | 24/0 | | room-lights | 1 | 18/0 |
| deploy-config | 0 | 101/0 | | sanitize-report | 0 | 31/0 |
| editor-behaviour | 0 | 37/0 | | sidebar-panels | 0 | 33/0 |
| editor-fuzz | 1 | 133/0 | | styles-split | 0 | 19/0 |
| furniture-freedom | 0 | 79/0 | | svg-export | 1 | 27/0 |
| furniture-kinds | 0 | 12/0 | | three-environment | 0 | 105/0 |
| layout-fuzz | 16 | 35/0 | | vendored-pins | 0 | 19/0 |
| | | | | version | 0 | 6/0 |
| | | | | walk3d-dispose | 0 | 21/0 |
| | | | | wall-collider | 0 | 11/0 |
| | | | | wall-lengths | 0 | 15/0 |
| | | | | server-live (python) | 5 | 127/0 |

`--fast` (the four fuzz files skipped): **31 files, 1492 assertions, 0 failed**.
Wall time for the full run was dominated by `city-fuzz` at 866 s.

**Skipped tests: none.** No test is `.skip`-ed, and the runner reports skips
explicitly (`Skipped:` line) — the only skips are the `--fast` ones, which the
full run does not take.

### Coverage

`c8` around `./tests/run.sh --fast` (`NODE_V8_COVERAGE` is inherited by every
child `node`, so all 31 files in that run are instrumented). `roomcad/web/lib/**`
(vendored, Tier C) and CSS are excluded from the denominator.

```
Statements   : 50.65% ( 9488/18729 )
Branches     : 79.75% ( 1647/2065 )
Functions    : 47.34% ( 294/621 )
Lines        : 50.65% ( 9488/18729 )
```

Lowest-covered files, which is also where the audit's S0 findings are:

| lines | functions | file |
| ----- | --------- | ---- |
| 9.32% | 0% | `roomcad/web/editor2d/drag.js` |
| 12.13% | 0% | `roomcad/web/svg.js` |
| 12.18% | 0% | `roomcad/web/walk3d/scene-building-2.js` |
| 14.28% | 0% | `roomcad/web/audio.js` |
| 19.00% | 0% | `roomcad/web/editor2d/menu.js` |
| 21.67% | 0% | `roomcad/web/walk3d/rapier-physics.js` |
| 21.97% | 0% | `roomcad/web/walk3d/scene-building.js` |
| 22.10% | 0% | `roomcad/web/walk3d/rapier-physics-2.js` |
| 23.60% | 0% | `roomcad/web/city.js` |
| 23.64% | 0% | `roomcad/web/walk3d/loop.js` |
| 33.33% | 0% | `roomcad/web/walk3d/environment-builders.js` |
| 36.36% | 0% | `roomcad/web/walk3d/sun.js` |

The suite is green (2045 assertions) while the 3D walkthrough cannot start
(T0001) and the sun/sky path throws (T0001) — the coverage table is the reason:
the whole `walk3d/` package is between 12% and 36% lines and 0% functions. That
gap is ledged as T0023, not used as an excuse.

## 3. Linters / analyzers / type checker

| Tool | Baseline | Notes |
| ---- | -------- | ----- |
| `ruff check roomcad tests` (`ruff.toml`) | **4 errors**, all in `tests/server-live.test.py`: S101 ×3 (lines 51, 118, 119) and E731 ×1 (line 600). `roomcad/server/server.py` is **clean**. | T0045 |
| `ruff format --check roomcad tests` | 2 files would be reformatted | applies to both Python files |
| `bandit -q -r roomcad/server/server.py` | **0 findings** | |
| `eslint roomcad/web tests` | **253 errors**. `roomcad/web` alone: 128 — 81 `no-unused-vars`, 13 `no-undef`, 12 `no-unsanitized/property`, 9 `require-atomic-updates`, 9 `no-eq-null`, 3 `prefer-const`, 1 `no-promise-executor-return`. | the 13 `no-undef` are T0001/T0008; the 12 `no-unsanitized/property` are all `esc()`-mitigated (see `tool-coverage.md`); `no-eq-null` is redundant with the chosen `eqeqeq: smart` mode and is removed rather than "fixed". T0046 |
| `semgrep --config AUDIT/semgrep-rules.yml` | 12 findings, all `roomcad-innerhtml-dynamic`, all `esc()`-mitigated | the rule is pinned and proved to fire in `tool-coverage.md` |
| `shellcheck` (4 scripts) | 1 warning (`deploy.sh:150` SC2034) + 2 SC2029 notes | T0044 |
| `prettier --check` (roomcad/web + tests) | 115 files differ | **not** swept as a whole-tree rewrite — see `tool-coverage.md` §3 |
| mypy / pyright | **not run** — §1 de-scopes the Python type checker | |
| Caddy `validate` | both configs valid | |

## 4. Dependency CVEs

No dependency manifest exists: there is no `package.json`, `requirements.txt`,
lockfile, `pyproject.toml` or `setup.py`. The browser libraries are **vendored**
under `roomcad/web/lib/` and their content is pinned by SHA-256 in
`THIRD_PARTY_NOTICES.md`, enforced by `tests/vendored-pins.test.mjs` (19 checks).
`pip-audit` is therefore N/A rather than skipped — there is no resolved
dependency set to audit.

## 5. Secret scan

`gitleaks detect --source . --log-opts="--all" --redact` → **220 commits
scanned, ~11.36 MB, no leaks found.** Run once; history is immutable under §0.
The scanner is proved to fire on a planted credential in a scratch repository
(`tool-coverage.md` §1.6).

## 6. Language standard actually in force

| Language | Standard recorded | How it is enforced |
| -------- | ----------------- | ------------------ |
| JavaScript | none named by §1; formatter + linter required | `ruff` has no JS role; `eslint` + `prettier` are pinned in `AUDIT/package.json` and run by `AUDIT/gates.sh`. The app has no build, so there is no build config to carry a mode. |
| Python | §1 "basic only" | `ruff.toml` committed; `ruff check` + `ruff format --check` + `compileall`; `pip-audit` N/A |
| Swift | §1 Swift 6.4 / Swift 6 language mode / complete strict concurrency / warnings-as-errors | **N/A — no Swift target.** Toolchain present: Xcode 27.0 (27A266a), Apple Swift 6.4 (swiftlang-6.4.0.34.1). |
| C | §1 strict C99 + hardening warnings + ASan/UBSan | **N/A — no C target.** |

## 7. Regression rule

No later state may be worse than the above on any metric — test count, failures,
lint findings, coverage, or secret-scan result — without a justified, numbered
task. The comparison is made at every milestone and at Phase E.
