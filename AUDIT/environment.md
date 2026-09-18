# AUDIT — environment and pinned toolchain (§1, §1b, §3)

Recorded once, at baseline. One pinned version per language; the primary host for baseline,
fixes and tests is the machine below.

## Hosts

| Host | Role | OS | Arch | CPU/RAM | Notes |
| ---- | ---- | -- | ---- | ------- | ----- |
| `mac-local` (primary) | baseline, fixes, all tests, Tier A/B manual review | macOS 27.0 (build 26A428) | arm64 (Apple Silicon) | 8 GB | §1b heavy-job limit: **one heavy job at a time**. `city-fuzz` alone is 6–12 min. |
| `linux-container` (independent) | single final Phase E verification only | Linux (Docker, `node:24-bookworm-slim` + Python 3.11 from the distro) | arm64 (native, no emulation) | shared with mac-local | Not used until Phase E. |

Production (`91.99.176.243`, the VPS in `deploy.sh`) is **never** a host for this audit. No deploy,
no restart, no DB write, no migration, no credential rotation is performed against it (§0).
No VPS was provisioned; the independent host is a local container (§1b: "Linux/x86 local or VPS").

## Language toolchain

| Language | Tool | Version | Install method | Role |
| -------- | ---- | ------- | -------------- | ---- |
| Python (3.14.7, `/opt/homebrew/bin/python3`) | **ruff** | 0.16.7 | Homebrew (`brew install ruff`) | formatter **and** linter (§1: both, with `--fix`) |
| Python | **bandit** | 1.9.4 | Homebrew (pip package, `brew install bandit`) | SAST (Tier A code) |
| Python | pip-audit | *not installed* | — | **N/A**: there is no `requirements.txt`, lockfile, `pyproject.toml` or `setup.py`; the API is stdlib-only. §1 makes `pip-audit` conditional on a lock file existing. |
| Python | mypy / pyright | present (`mypy` on PATH) but **deliberately not run** | — | §1 de-scopes the Python type checker: "the Python rules drop it". Recorded, not used. |
| JavaScript (Node v26.8.2, npm 12.0.2) | **eslint** | 10.10.0 | `npm ci` in `AUDIT/` (pins in `AUDIT/package.json` + `package-lock.json`) | linter + SAST (`eslint-plugin-security` 4.0.1, `eslint-plugin-no-unsanitized` 4.1.5) |
| JavaScript | **prettier** | 3.9.8 | `npm ci` in `AUDIT/` | formatter (check mode; see "Formatter policy" below) |
| JavaScript | **c8** | 12.0.0 | `npm ci` in `AUDIT/` | coverage (`NODE_V8_COVERAGE` works through `tests/run.sh`) |
| JavaScript | semgrep | 1.176.0 | Homebrew | SAST, Python + JavaScript rules, with a **committed local rule pack** (`AUDIT/semgrep-rules.yml`) so the rules are pinned in-repo |
| Shell | **shellcheck** | 0.11.0 | Homebrew | linter for `tests/run.sh`, `deploy.sh`, `install-caddy.sh`, `serve.sh` |
| Shell | bash | 3.2.57 (`/bin/bash`) | OS | the runner targets bash 3.2 |
| Caddy | caddy | 2.11.4 | Homebrew | `caddy validate` for both Caddyfiles (the deploy path validates with the VPS's own binary; never run here) |
| Secrets (all languages/history) | **gitleaks** | 8.30.1 | Homebrew | full-history secret scan, once |
| SQLite | sqlite3 | 3.54.0 | OS | schema inspection only; no live DB is opened |

`AUDIT/node_modules/` is git-ignored. Reproduce the JS toolchain with:

```bash
cd AUDIT && npm ci          # exact pins from package-lock.json
```

## Swift / C — standards with no target

§1 requires the Swift and C standards to be *proved* against a target. Neither language exists here:

```
$ find . -path ./.git -prune -o -type f \( -name '*.swift' -o -name '*.c' -o -name '*.h' \
    -o -name '*.m' -o -name '*.mm' -o -name '*.cpp' \) -print
(no output)
```

- **Swift**: Xcode 27.0 (build 27A266a) and Apple Swift 6.4 (`swiftlang-6.4.0.34.1`,
  target `arm64-apple-macosx27.0.0`) *are* installed on the primary host, so the §1b requirement
  ("the Mac carrying a Swift project must have Xcode 27 / Swift 6.4") is satisfied — but there is
  no Swift target to compile, so `SWIFT_VERSION = 6.0`, `SWIFT_STRICT_CONCURRENCY = complete`,
  `SWIFT_TREAT_WARNINGS_AS_ERRORS = YES`, swift-format and SwiftLint have nothing to bind to.
- **C**: no C source and no compiler invocation exists, so `-std=c99 -pedantic-errors` and the
  ASan/UBSan suite run have nothing to bind to. This is not a lowered standard.

Both are recorded as **N/A (no target)**, with the `find` above as the evidence, in
`tool-coverage.md`. The toolchain the standard demands is present; the target is absent.

## Formatter policy (JavaScript)

Prettier is installed and run in `--check` mode; its result is recorded in the baseline. The
repository is deliberately **not** blanket-reformatted. This is not a weakened check: this
codebase's own gate contains *source contracts* — tests that assert an exact line of source text
(`tests/*.test.mjs`, see `AGENTS.md` "Several other tests make source contracts") — and a
whole-tree reformat would silently invalidate them, which is a much worse failure than uneven
indentation. Files rewritten by this audit are formatted to the Prettier config on the way
through; the rest are reported, not churned. Prettier's own config is committed at
`AUDIT/.prettierrc.json`.

## Rebuilding this environment on a fresh machine

```bash
brew install ruff shellcheck bandit semgrep gitleaks caddy node python@3.14
cd AUDIT && npm ci
python3 -m compileall -q roomcad tests        # confirms the Python is importable
```

## Tool-coverage proof

Every check delegated to a tool is proved to actually fail on a deliberate violation; see
`tool-coverage.md`. That file is the gate for this section, and it is required before any check
may be delegated.
