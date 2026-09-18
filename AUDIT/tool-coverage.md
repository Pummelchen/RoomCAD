# AUDIT — tool-coverage and language-standard proofs (§1)

Every check delegated to a tool is proved here to actually fail on a deliberate
violation, in a scratch file outside the repository (or a scratch file inside the
tree that the same command deletes). A tool that stays silent does not cover the
check; the check would then be restored to a human read.

All commands were run on the primary host (`mac-local`) with the pinned versions
in `environment.md`.

## 1. Tool-coverage proofs

### 1.1 Ruff (Python formatter + linter) — `ruff.toml`

Scratch file `/tmp/tc/pitfalls.py`:

```python
def f(x=[]):                                  # mutable default
    return x
try:
    pass
except:                                       # bare except
    pass
def swallow():
    try:
        pass
    except Exception:
        pass                                  # except: pass
def g(v):
    if v is 5:                                # is vs literal
        return True
    return v is "x"
def h(p):
    return open(p)                            # no encoding=
import subprocess
def run(cmd):
    subprocess.run(cmd)                       # no check=True
    subprocess.call(cmd, check=True)
from datetime import datetime
def now():
    return datetime.now()                     # naive datetime
def validate(v):
    assert v, "validation"                    # assert
```

```
$ ruff check --no-cache --isolated --select B,E722,S101,F632,DTZ,S110,S112 --target-version py312 --output-format concise /tmp/tc/pitfalls.py
/tmp/tc/pitfalls.py:1:9: B006 Do not use mutable data structures for argument defaults
/tmp/tc/pitfalls.py:5:1: E722 Do not use bare `except`
/tmp/tc/pitfalls.py:5:1: S110 `try`-`except`-`pass` detected, consider logging the exception
/tmp/tc/pitfalls.py:10:5: S110 `try`-`except`-`pass` detected, consider logging the exception
/tmp/tc/pitfalls.py:13:8: F632 [*] Use `==` to compare constant literals
/tmp/tc/pitfalls.py:15:12: F632 [*] Use `==` to compare constant literals
/tmp/tc/pitfalls.py:24:12: DTZ005 `datetime.datetime.now()` called without a `tz` argument
/tmp/tc/pitfalls.py:26:5: S101 Use of `assert` detected
Found 8 errors.
ruff exit=1
```

The required §1 proof — **introduce a bare `except` and confirm Ruff rejects it** —
is the `E722` line above.

Formatter proof:

```
$ printf 'def f( a,b ):\n  return a+b\n' > /tmp/tc/misformatted.py
$ ruff format --no-cache --isolated --check /tmp/tc/misformatted.py
unformatted: File would be reformatted
 --> /tmp/tc/misformatted.py:1:7
1 file would be reformatted
exit=1
```

Two §1 pitfalls have **no stable Ruff rule** and are delegated to the pinned
semgrep pack instead (§1.3):

- `open()` without `encoding=` — Ruff's `PLW1514` is preview-only, and turning on
  preview would silently enable every other unstable preview rule.
- `subprocess` without `check=True` — no Ruff rule matches it.

### 1.2 Semgrep (pinned local pack `AUDIT/semgrep-rules.yml`)

```
$ semgrep scan --config AUDIT/semgrep-rules.yml --metrics off --quiet --json /tmp/tc
AUDIT.roomcad-python-open-no-encoding    /tmp/tc/pitfalls.py:17
AUDIT.roomcad-python-subprocess-no-check /tmp/tc/pitfalls.py:20
AUDIT.roomcad-python-assert-validation  /tmp/tc/pitfalls.py:26
AUDIT.roomcad-python-sql-fstring        /tmp/tc/sg_more.py:3
```

and on a JavaScript violation:

```
$ cat /tmp/tc/js/bad.js
export function f(el, v) {
  el.innerHTML = "<b>" + v + "</b>";
  if (v == 5) return;
  eval(v);
}
$ semgrep scan --config AUDIT/semgrep-rules.yml --metrics off --quiet --json /tmp/tc/js
AUDIT.roomcad-innerhtml-dynamic  bad.js:2
AUDIT.roomcad-javascript-eval    bad.js:6
```

One rule proved silent and was therefore **removed** rather than left as dead
cover: `roomcad-python-bare-except` (the pattern did not match a bare `except:`
block; bare `except` is covered by Ruff `E722`, proved above).

`AUDIT/gates.sh` runs the pack with `--severity ERROR --error`, so the two
WARNING-severity rules do not gate: `roomcad-innerhtml-dynamic` (the 12 known
`esc()`-mitigated sites — ledger T0049, the same limitation eslint's
`no-unsanitized/property` has) and `roomcad-insertadjacenthtml-dynamic`. They are
still reported, still proved to fire above, and are compensated by
`tests/audit-xss.test.mjs`; a rule that cannot see per-interpolation escaping
would otherwise gate forever on a verified false positive. The ERROR-severity
rules (SQL injection, eval, weak randomness, subprocess-without-check,
open-without-encoding) do gate, and none of them fires on this tree.

### 1.3 eslint 10 + plugins — `AUDIT/eslint.config.mjs`

Scratch file `roomcad/web/__proof_bad.js` (created and deleted by the same
command, never committed):

```js
export function f(el, v) {
  el.innerHTML = "<b>" + v + "</b>";
  const unusedThing = 1;
  if (v == 5) return;
  eval(v);
  try { g(); } catch (e) {}
  return globalThisDoesNotExist;
}
```

```
$ AUDIT/node_modules/.bin/eslint --config AUDIT/eslint.config.mjs roomcad/web/__proof_bad.js
  2:3   error  Unsafe assignment to innerHTML ...                       no-unsanitized/property
  3:9   error  'unusedThing' is assigned a value but never used ...     no-unused-vars
  4:9   error  Expected '===' and instead saw '==' ...                  eqeqeq
  5:3   error  eval with argument of type Identifier ...                security/detect-eval-with-expression
  5:3   error  `eval` can be harmful ...                                no-eval
  6:9   error  'g' is not defined ...                                   no-undef
  6:23  error  'e' is defined but never used ...                        no-unused-vars
  6:26  error  Empty block statement ...                                no-empty
  7:10  error  'globalThisDoesNotExist' is not defined ...              no-undef
✖ 9 problems (9 errors, 0 warnings)
eslint exit=1
```

`no-undef` is the rule that found T0001/T0008 (the imports the prototype split
dropped). `no-unsanitized/property` is configured with the codebase's `esc()` as
an accepted escape function, so a mitigated site is not a false positive and an
unmitigated one still fails.

### 1.4 Bandit (Python SAST)

```
$ bandit -q /tmp/tc/bandit_sample.py -f json      # subprocess shell=True, md5, hardcoded password
B404 1  Consider possible security implications associated with the subprocess module
B105 2  Possible hardcoded password: 'hunter2'
B602 4  subprocess call with shell=True identified, security issue.
B324 6  Use of weak MD5 hash for security. Consider usedforsecurity=False
```

### 1.5 shellcheck

```
$ shellcheck /tmp/tc/bad.sh
line 5: SC2086 (info): Double quote to prevent globbing and word splitting.
line 6: SC2154 (warning): undefined_variable is referenced but not assigned.
shellcheck exit=1
```

The repository's own scripts produce one **warning** (`deploy.sh:150` SC2034,
unused loop variable — ledged as T0044) and two SC2029 notes on intentional
remote-side expansion in `ssh` commands.

### 1.6 gitleaks (full history, once)

A planted GitHub PAT in a throwaway git repository under `/tmp` (never in this
repository, per §0):

```
$ gitleaks detect --source . --no-git --redact --report-format json
findings: 1
github-pat  leak2.js  line 2  - Uncovered a GitHub Personal Access Token ...
exit=1
$ gitleaks detect --source . --log-opts="--all" --redact ...
github-pat  leak2.js  line 2
exit=1
```

On **this repository** (`gitleaks detect --source . --log-opts="--all" --redact`):
`220 commits scanned`, `scanned ~11356895 bytes`, **`no leaks found`**. No secret
is reported anywhere, so no credential line needs naming.

### 1.7 caddy validate

```
$ caddy validate --config /tmp/tc/bad2.caddyfile --adapter caddyfile
Error: adapting config using caddyfile: /tmp/tc/bad2.caddyfile:3: unrecognized directive: totally_bogus_directive
caddy exit=1
```

Both committed Caddyfiles validate with the same command (`Valid configuration`).

### 1.8 c8 (coverage)

`c8` wraps `./tests/run.sh --fast`; `NODE_V8_COVERAGE` is inherited by every
child `node` process, so all 31 test files are instrumented in one run. Result is
in `baseline.md`; the command is in `AUDIT/gates.sh`'s coverage mode.

## 2. Language-standard proofs (§1)

| Standard | Target present? | Proof |
| -------- | --------------- | ----- |
| Swift 6.4 / Swift 6 language mode, complete strict concurrency, warnings-as-errors, swift-format, SwiftLint `--strict` | **No** — `find` returns no `.swift` file anywhere | N/A (no target). Xcode 27.0 / Swift 6.4 *is* installed (`xcodebuild -version` → `Xcode 27.0 (27A266a)`; `swift --version` → `Apple Swift version 6.4 (swiftlang-6.4.0.34.1)`), so this is a missing target, not a missing toolchain and not a lowered mode. A non-Sendable capture across a Task boundary and a force-unwrap have nothing to compile. |
| strict C99 `-std=c99 -pedantic-errors` + the extra warning set + ASan/UBSan | **No** — `find` returns no `.c`/`.h`/`.m`/`.mm`/`.cpp` file anywhere | N/A (no target). An implicit declaration and a GNU extension (`typeof`, nested function) have nothing to compile, and there is no C test suite to run under ASan/UBSan. Sanitizers are therefore not run; Swift's `--sanitize=thread` likewise has no target. |
| Python → basic only: one pinned version, Ruff format + lint, importable scripts, `pip-audit` only if a lock file exists | **Yes** | Python 3.14.7 pinned; `ruff.toml` committed; the bare-`except` proof above; `ruff check roomcad tests` and `python3 -m compileall -q roomcad tests` both clean after T0045; `pip-audit` is N/A because there is no `requirements.txt`, lockfile, `pyproject.toml` or `setup.py` (the API is stdlib-only). |

## 3. Risks accepted and recorded (not waivers of a check)

- **Prettier is not run as a whole-tree rewrite.** `prettier --check` reports 115
  files with style differences. This repository's own gate contains *source
  contracts* — tests that assert exact source text (`AGENTS.md`, "Several other
  tests make source contracts") — so a blanket reformat would invalidate parts of
  the suite, and the only ways out would be to edit those tests (forbidden by §0)
  or to leave the suite red (forbidden by §8). The formatter is therefore applied
  to files this audit rewrites and reported, not used as a churn. This is written
  down as a doubt before acting, per §0.
- **Vendored code (`roomcad/web/lib/**`) is excluded from eslint.** It is
  third-party, SHA-256-pinned and Tier C by §2.4. It is still covered by the
  vendored-pins test and by gitleaks.
