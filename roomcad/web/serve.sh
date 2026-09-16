#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/caddy"

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

  echo "Downloading Caddy v$TAG ($ASSET) …"
  # A private scratch directory, cleaned up on any exit. The old fixed
  # /tmp/roomcad-caddy.tar.gz was predictable and left behind on failure.
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  curl -fsSL --max-time 180 "$URL" -o "$TMP/caddy.tar.gz"
  mkdir -p "$DIR/bin"
  tar -xzf "$TMP/caddy.tar.gz" -C "$DIR/bin" caddy
  chmod +x "$BIN"
  echo "Installed: $BIN"
fi

cd "$DIR"
echo "RoomCAD web → http://localhost:8080"
exec "$BIN" run --config Caddyfile --adapter caddyfile
