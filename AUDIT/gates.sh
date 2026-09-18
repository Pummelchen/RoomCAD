#!/usr/bin/env bash
# RoomCAD audit gate runner.
#
# Runs every pinned check the audit relies on, in one place, so "the gate" is a
# command and not a memory. Exits non-zero on the first check that fails.
#
# Usage:  AUDIT/gates.sh          # everything
#         AUDIT/gates.sh --fast   # skip the coverage run (the slow one)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
ROOT="$PWD"
FAILED=0
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

step() { printf '\n=== %s ===\n' "$1"; }
bad()  { FAILED=1; printf '  ** FAIL: %s\n' "$1"; }
ok()   { printf '  ok: %s\n' "$1"; }

# ── Python: formatter, linter (ruff.toml is committed) ───────────────────────
step "ruff format --check"
if ruff format --no-cache --check roomcad tests; then ok "python formatting"; else bad "python formatting"; fi

step "ruff check"
if ruff check --no-cache roomcad tests; then ok "python lint"; else bad "python lint"; fi

step "python importability"
if python3 -m compileall -q roomcad tests >/dev/null; then ok "compileall"; else bad "compileall"; fi

step "bandit (Python SAST)"
# The whole server tree, not just server.py: server.py is a facade now and the
# implementation lives in roomcad_api/, so scanning the entry point alone would
# silently scan almost nothing.
if bandit -q -r roomcad/server; then ok "bandit"; else bad "bandit"; fi

# ── JavaScript: lint + SAST + SAST rules (pinned in AUDIT/) ──────────────────
ESLINT="AUDIT/node_modules/.bin/eslint"
if [ ! -x "$ESLINT" ]; then
  bad "AUDIT/node_modules missing — run: cd AUDIT && npm ci"
else
  step "eslint"
  if "$ESLINT" --config AUDIT/eslint.config.mjs roomcad/web tests; then ok "eslint"; else bad "eslint"; fi
fi

# Gate on ERROR severity. The WARNING-severity rules are the ones whose findings
# are reviewed and compensated in writing: roomcad-innerhtml-dynamic (the 12
# esc()-mitigated sites, T0049) and roomcad-insertadjacenthtml-dynamic. They are
# still reported by `semgrep scan` without --severity, and proved to fire in
# AUDIT/tool-coverage.md; they just do not gate, because a rule that cannot see
# per-interpolation escaping would gate forever on a false positive.
step "semgrep (pinned local rule pack)"
if semgrep scan --config AUDIT/semgrep-rules.yml --metrics off --quiet --severity ERROR --error roomcad tests >/dev/null 2>&1; then
  ok "semgrep"
else
  bad "semgrep"
fi

# ── Shell ────────────────────────────────────────────────────────────────────
step "shellcheck"
if shellcheck --severity=warning tests/run.sh roomcad/server/deploy.sh roomcad/server/install-caddy.sh roomcad/web/serve.sh release.sh; then
  ok "shellcheck"; else bad "shellcheck"; fi

# ── Caddy configs ────────────────────────────────────────────────────────────
step "caddy validate"
for f in roomcad/server/Caddyfile roomcad/web/Caddyfile; do
  if caddy validate --config "$f" --adapter caddyfile >/dev/null 2>&1; then ok "$f"; else bad "$f"; fi
done

# ── Secret scanning (working tree; history is scanned once, see below) ───────
step "gitleaks (working tree)"
if gitleaks detect --source . --no-git --redact >/dev/null 2>&1; then ok "gitleaks"; else bad "gitleaks"; fi

# ── Test suite: the repository's own gate ────────────────────────────────────
step "tests/run.sh"
if [ "$FAST" = "1" ]; then
  if ./tests/run.sh --fast; then ok "suite (--fast)"; else bad "suite (--fast)"; fi
else
  if ./tests/run.sh; then ok "suite (full)"; else bad "suite (full)"; fi
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\nGATES FAILED\n' >&2
  exit 1
fi
printf '\nAll gates green.\n'
