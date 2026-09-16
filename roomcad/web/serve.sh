#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/caddy"

# Check $1 (a downloaded file) against the entry for $2 (its published
# filename) in $3 (the release's checksums file). Caddy publishes SHA-512
# today, but the algorithm is read from the entry rather than assumed, so a
# switch upstream keeps verifying instead of silently passing. Fails — with
# the expected and actual hashes on stderr — on a missing entry, an
# unrecognised hash, a missing hash tool, or a mismatch. The caller must not
# extract or run anything when this returns non-zero.
verify_archive() {
  local file="$1" name="$2" sums="$3" expected actual sumcmd shasum_flag shasum_bits openssl_dgst
  expected=$(awk -v f="$name" '$2 == f || $2 == "*" f { print $1; exit }' "$sums")
  if [ -z "$expected" ]; then
    echo "no checksum for $name in the release's checksums file" >&2
    return 1
  fi
  case "${#expected}" in
    128) sumcmd=sha512sum; shasum_flag=-a; shasum_bits=512; openssl_dgst=-sha512 ;;
    64)  sumcmd=sha256sum; shasum_flag=-a; shasum_bits=256; openssl_dgst=-sha256 ;;
    *) echo "unrecognised checksum for $name (${#expected} hex digits)" >&2; return 1 ;;
  esac
  if command -v "$sumcmd" >/dev/null 2>&1; then
    actual=$("$sumcmd" "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    # macOS ships shasum rather than the coreutils sha512sum/sha256sum.
    actual=$(shasum "$shasum_flag" "$shasum_bits" "$file" | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then
    actual=$(openssl dgst "$openssl_dgst" "$file" | awk '{print $NF}')
  else
    echo "cannot verify $name: none of $sumcmd, shasum or openssl is installed." >&2
    echo "Install one of them — an unverified binary will not be run." >&2
    return 1
  fi
  if [ "$actual" != "$expected" ]; then
    echo "CHECKSUM MISMATCH for $name" >&2
    echo "  expected: $expected" >&2
    echo "  found:    $actual" >&2
    return 1
  fi
  echo "  verified: $name ($sumcmd)"
}

if [[ ! -x "$BIN" ]]; then
  echo "Caddy not found — downloading it into $DIR/bin …"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64|aarch64) ASSET="mac_arm64" ;;
    x86_64|amd64)  ASSET="mac_amd64" ;;
    *)
      # The old fallback sent every unknown machine to the macOS amd64 build,
      # so on Linux this quietly downloaded and ran the wrong binary.
      echo "Unsupported architecture: $ARCH. Download Caddy yourself and put it at $BIN." >&2
      exit 1
      ;;
  esac

  JSON="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest)"

  # Matched in the shell rather than piped into `grep … | head -1`: head exits
  # after its first line, grep takes SIGPIPE, and `set -o pipefail` then aborts
  # this script on the very first run, before a single byte is downloaded.
  # install-caddy.sh documents the same trap for the same reason.
  if [[ "$JSON" =~ \"tag_name\":\ *\"([^\"]+)\" ]]; then
    TAG="${BASH_REMATCH[1]#v}"
  else
    echo "Could not read the latest Caddy release from the GitHub API." >&2
    exit 1
  fi
  if [[ "$JSON" =~ (https://[^\"]*${ASSET}\.tar\.gz) ]]; then
    URL="${BASH_REMATCH[1]}"
  else
    echo "Caddy $TAG has no ${ASSET} download." >&2
    exit 1
  fi
  # The checksums file the same release publishes for every asset, taken from
  # the release JSON rather than assembled from the version, so an upstream
  # rename stays a failure rather than a silent skip.
  if [[ "$JSON" =~ (https://[^\"]*_checksums\.txt)\" ]]; then
    SUMS_URL="${BASH_REMATCH[1]}"
  else
    echo "Caddy $TAG publishes no checksums file — refusing to run an unverified binary." >&2
    exit 1
  fi
  ARCHIVE="${URL##*/}"

  echo "Downloading Caddy v$TAG ($ASSET) …"
  # A private scratch directory, cleaned up on any exit. The old fixed
  # /tmp/roomcad-caddy.tar.gz was predictable and left behind on failure.
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  curl -fsSL --max-time 180 "$URL" -o "$TMP/$ARCHIVE"
  if ! curl -fsSL --max-time 60 "$SUMS_URL" -o "$TMP/checksums.txt"; then
    echo "Could not download the checksums file for Caddy $TAG ($SUMS_URL)." >&2
    echo "Refusing to run an unverified binary." >&2
    exit 1
  fi
  if ! verify_archive "$TMP/$ARCHIVE" "$ARCHIVE" "$TMP/checksums.txt"; then
    rm -f "$TMP/$ARCHIVE"
    echo "Refusing to run Caddy from an unverified download." >&2
    exit 1
  fi
  mkdir -p "$DIR/bin"
  tar -xzf "$TMP/$ARCHIVE" -C "$DIR/bin" caddy
  chmod +x "$BIN"
  echo "Installed: $BIN"
fi

cd "$DIR"
echo "RoomCAD web → http://localhost:8080"
exec "$BIN" run --config Caddyfile --adapter caddyfile
