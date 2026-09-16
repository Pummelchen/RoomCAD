#!/usr/bin/env bash
#
# RoomCAD test runner.
#
# There is no package.json and no test framework here, so this is the one place
# that runs the whole suite. It exists because "for t in tests/*.mjs; do node
# "$t"; done" has no timeout, no totals and no exit code worth trusting when a
# file hangs — and city-fuzz legitimately runs for over six minutes.
#
# Usage:
#   ./tests/run.sh              # everything (the real gate)
#   ./tests/run.sh --fast       # skip the long fuzz files, for iterating
#   ./tests/run.sh plan-editing # only files whose name matches
#
# Environment:
#   ROOMCAD_TEST_TIMEOUT  seconds per file (default 900)
#
# Exits non-zero if any file fails, times out, or reports failures.
#
# Written for bash 3.2, which is still what macOS ships: no empty-array
# expansion under `set -u`, no associative arrays, no `mapfile`.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

TIMEOUT="${ROOMCAD_TEST_TIMEOUT:-900}"

# The slow, fuzz-heavy files. --fast skips these; everything else is seconds.
SLOW_FILES="city-fuzz editor-fuzz layout-fuzz model-fuzz"

MODE="all"
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --fast) MODE="fast" ;;
    --all)  MODE="all" ;;
    -h|--help)
      sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) FILTER="$arg" ;;
  esac
done

# `timeout` is GNU coreutils; macOS only has it via Homebrew, and a minimal
# image may have neither. Fall back to perl's alarm, then to no limit, rather
# than silently skipping the guard.
run_with_timeout() {
  local limit="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$limit" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$limit" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$limit" "$@"
  else
    "$@"
  fi
}

is_slow() {
  local s
  for s in $SLOW_FILES; do [ "$1" = "$s" ] && return 0; done
  return 1
}

# Reads "N passed, M failed" out of a test's output and adds it to the totals.
# model-fuzz reports named invariants instead, so a missing count is not an error.
#
# Sets ACC_COUNTS rather than printing: a `$(...)` call would run in a subshell
# and every total it updated would be thrown away.
ACC_COUNTS=""
accumulate() {
  local passed failed
  ACC_COUNTS="$(printf '%s' "$1" | grep -oE '[0-9]+ passed, [0-9]+ failed' | tail -1)"
  if [ -n "$ACC_COUNTS" ]; then
    passed="${ACC_COUNTS%% *}"
    failed="$(printf '%s' "$ACC_COUNTS" | sed 's/.* \([0-9][0-9]*\) failed/\1/')"
    total_passed=$((total_passed + passed))
    total_failed=$((total_failed + failed))
  fi
}

total_passed=0
total_failed=0
ran=0
failed_count=0
failed_list=""
skipped_count=0
skipped_list=""

printf 'RoomCAD test suite — mode=%s timeout=%ss\n\n' "$MODE" "$TIMEOUT"

report() {
  # $1 name, $2 code, $3 elapsed, $4 counts, $5 output
  if [ "$2" -eq 0 ]; then
    printf '  ok      %-22s %4ss  %s\n' "$1" "$3" "$4"
    return
  fi
  if [ "$2" -eq 124 ] || [ "$2" -eq 142 ]; then
    printf '  TIMEOUT %-22s %4ss\n' "$1" "$3"
  else
    printf '  FAIL    %-22s %4ss  (exit %s)\n' "$1" "$3" "$2"
  fi
  failed_count=$((failed_count + 1))
  failed_list="$failed_list $1"
  printf '%s\n' "$5" | tail -25 | sed 's/^/        /'
}

for path in tests/*.test.mjs; do
  name="$(basename "$path" .test.mjs)"

  if [ -n "$FILTER" ] && [ "${name#*"$FILTER"}" = "$name" ]; then
    continue
  fi
  if [ "$MODE" = "fast" ] && is_slow "$name"; then
    skipped_count=$((skipped_count + 1))
    skipped_list="$skipped_list $name"
    continue
  fi

  ran=$((ran + 1))
  start=$(date +%s)
  out="$(run_with_timeout "$TIMEOUT" node "$path" 2>&1)"
  code=$?
  elapsed=$(( $(date +%s) - start ))
  accumulate "$out"; counts="$ACC_COUNTS"
  report "$name" "$code" "$elapsed" "$counts" "$out"
done

# The API suite is Python and speaks to a real server on an ephemeral port.
if command -v python3 >/dev/null 2>&1; then
  ran=$((ran + 1))
  start=$(date +%s)
  out="$(run_with_timeout "$TIMEOUT" python3 tests/server-live.test.py 2>&1)"
  code=$?
  elapsed=$(( $(date +%s) - start ))
  accumulate "$out"; counts="$ACC_COUNTS"
  report "server-live (python)" "$code" "$elapsed" "$counts" "$out"
else
  printf '  SKIP    %-22s (no python3 on PATH)\n' "server-live (python)"
  skipped_count=$((skipped_count + 1))
  skipped_list="$skipped_list server-live"
fi

printf '\n'
[ "$skipped_count" -gt 0 ] && printf 'Skipped:%s\n' "$skipped_list"
printf '%s files run, %s assertions passed, %s failed\n' "$ran" "$total_passed" "$total_failed"

if [ "$failed_count" -gt 0 ]; then
  printf 'FAILED files:%s\n' "$failed_list"
  exit 1
fi
if [ "$total_failed" -gt 0 ]; then
  printf 'FAILED: %s assertions\n' "$total_failed"
  exit 1
fi
printf 'All green.\n'
