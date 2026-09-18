#!/usr/bin/env bash
# Phase E — the single final verification, run from a FRESH CLONE on the
# independent Linux host (§11 Phase E). This script is expected to run INSIDE
# the container/VM, never on the primary host.
#
# Usage inside the container:
#   bash /src/AUDIT/phase-e.sh /src          # /src is the read-only source mount
#
# It clones the audit branch into a scratch directory (so nothing in the source
# mount can be modified), installs the pinned toolchain, and runs:
#   * a clean build (compileall + the boot/import graph)
#   * the FULL suite, serially
#   * the coverage report
#   * the portable scanners (ruff, shellcheck, eslint, prettier)
#   * the placeholder / facade / secret greps
# and prints a per-check PASS/FAIL summary with a final exit code.
set -uo pipefail

SRC="${1:-/src}"
WORK=/work/roomcad-fresh
BRANCH="${2:-audit/2026-09-18}"
FAILED=0

step() { printf '\n=== %s ===\n' "$1"; }
pass() { printf 'PASS  %s\n' "$1"; }
fail() { FAILED=1; printf 'FAIL  %s\n' "$1"; }

step "fresh clone from $SRC ($BRANCH)"
rm -rf "$WORK"
if git clone --quiet --branch "$BRANCH" "$SRC" "$WORK"; then pass "clone"; else fail "clone"; exit 1; fi
cd "$WORK" || exit 1
echo "HEAD: $(git log -1 --oneline)"
echo "node: $(node --version)  npm: $(npm --version)  python: $(python3 --version 2>&1)"
echo "os:   $(uname -srm)"

step "clean tree"
[ -z "$(git status --porcelain)" ] && pass "clone is clean" || fail "clone is dirty"

step "build — Python imports + app module graph"
python3 -m compileall -q roomcad tests && pass "compileall" || fail "compileall"
node tests/boot.test.mjs >/tmp/boot.out 2>&1 && pass "boot import graph: $(tail -1 /tmp/boot.out)" \
  || { fail "boot"; tail -5 /tmp/boot.out; }

step "full test suite (no --fast)"
if ./tests/run.sh > /tmp/suite.out 2>&1; then
  pass "suite: $(tail -2 /tmp/suite.out | head -1)"
else
  fail "suite"
  grep -E '^  (FAIL|TIMEOUT)' /tmp/suite.out | head -20
  tail -20 /tmp/suite.out
fi

step "coverage (c8, --fast)"
if [ -x AUDIT/node_modules/.bin/c8 ]; then
  pass "c8 already installed"
else
  (cd AUDIT && npm ci --no-fund --no-audit >/dev/null 2>&1) \
    && pass "npm ci" || fail "npm ci"
fi
if [ -x AUDIT/node_modules/.bin/c8 ]; then
  AUDIT/node_modules/.bin/c8 --reporter=text-summary --include='roomcad/**' \
    --exclude='roomcad/web/lib/**' --report-dir=/tmp/cov --temp-directory=/tmp/cov-tmp \
    ./tests/run.sh --fast > /tmp/cov.out 2>&1
  grep -E 'Lines|Statements|Branches|Functions' /tmp/cov.out | sed 's/^/  /'
  grep -q 'All green' /tmp/cov.out && pass "coverage run green" || fail "coverage run"
fi

step "scanners (portable)"
if command -v ruff >/dev/null 2>&1; then
  ruff check --no-cache roomcad tests && pass "ruff check" || fail "ruff check"
  ruff format --no-cache --check roomcad tests && pass "ruff format" || fail "ruff format"
else
  fail "ruff not installed"
fi
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck --severity=warning tests/run.sh roomcad/server/deploy.sh \
    roomcad/server/install-caddy.sh roomcad/web/serve.sh \
    && pass "shellcheck" || fail "shellcheck"
else
  echo "SKIP  shellcheck not installed"
fi
if [ -x AUDIT/node_modules/.bin/eslint ]; then
  AUDIT/node_modules/.bin/eslint --config AUDIT/eslint.config.mjs roomcad/web tests \
    && pass "eslint (0 errors; documented warnings)" || fail "eslint"
fi

step "zero production placeholders / facades"
hits=$(grep -rnE 'NotImplemented|not implemented|fatalError|throw new Error\("TODO' \
  roomcad/web --include=*.js | grep -v '^roomcad/web/lib/' | wc -l)
[ "$hits" -eq 0 ] && pass "no facade markers on a production path" || { fail "$hits facade markers"; }

step "secret scan (working tree)"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-git --redact >/dev/null 2>&1 && pass "gitleaks" || fail "gitleaks"
else
  echo "SKIP  gitleaks not installed"
fi

step "ledger open count"
python3 - <<'PY'
import json, sys
d = json.load(open("AUDIT/ledger.json"))
open_ = [t for t in d["tasks"] if t["status"] not in ("DONE", "BLOCKED")]
print("tasks: %d  done: %d  blocked: %d  open: %d" % (
    len(d["tasks"]),
    sum(1 for t in d["tasks"] if t["status"] == "DONE"),
    sum(1 for t in d["tasks"] if t["status"] == "BLOCKED"),
    len(open_)))
sys.exit(0 if not open_ else 1)
PY
[ $? -eq 0 ] && pass "ledger open count is 0" || fail "ledger has open tasks"

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "PHASE E: ALL CHECKS PASSED on $(uname -srm)"; else echo "PHASE E: FAILURES ABOVE"; fi
exit "$FAILED"
