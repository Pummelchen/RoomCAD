#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin/caddy"

if [[ ! -x "$BIN" ]]; then
  echo "Caddy not found — downloading it into $DIR/bin …"
  ARCH="$(uname -m)"
  if [[ "$ARCH" == "arm64" ]]; then
    ASSET="mac_arm64"
  else
    ASSET="mac_amd64"
  fi
  JSON="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest)"
  URL="$(printf '%s' "$JSON" | grep -oE "https://[^\"]*${ASSET}\.tar\.gz" | head -1)"
  TAG="$(printf '%s' "$JSON" | grep -oE '"tag_name": *"[^"]*"' | sed 's/.*"v//; s/"$//')"
  echo "Downloading Caddy v$TAG ($ASSET) …"
  curl -fsSL --max-time 180 "$URL" -o /tmp/roomcad-caddy.tar.gz
  mkdir -p "$DIR/bin"
  tar -xzf /tmp/roomcad-caddy.tar.gz -C "$DIR/bin" caddy
  chmod +x "$BIN"
  rm -f /tmp/roomcad-caddy.tar.gz
  echo "Installed: $BIN"
fi

cd "$DIR"
echo "RoomCAD V2 web → http://localhost:8080"
exec "$BIN" run --config Caddyfile --adapter caddyfile
