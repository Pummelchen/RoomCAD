#!/usr/bin/env bash
# Install the latest OFFICIAL Caddy release as a project's own binary.
#
# The binary that came with the distribution is whatever the package archive
# happens to carry, and it is shared by every project on the host: upgrading it
# for one upgrades it for all, and nobody finds out until something restarts.
# Each project keeps its own copy instead, taken from the upstream release
# rather than from apt.
#
# Usage: ./install-caddy.sh [host] [project-dir ...]
#        ./install-caddy.sh root@host /var/roomcad /var/xaios_updater
set -euo pipefail

HOST="${1:-root@91.99.176.243}"
shift || true
TARGETS=("$@")
[ ${#TARGETS[@]} -gt 0 ] || TARGETS=(/var/roomcad /var/xaios_updater)

ssh "$HOST" "TARGETS='${TARGETS[*]}' bash -s" <<'REMOTE'
set -euo pipefail
arch=$(dpkg --print-architecture 2>/dev/null || uname -m)
case "$arch" in
  amd64|x86_64) rel=amd64 ;;
  arm64|aarch64) rel=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac

# Fetched into a variable rather than piped: `grep -m1` closes the pipe as soon
# as it matches, curl fails on the broken pipe, and pipefail turns that into a
# fatal error for a download that actually succeeded.
release=$(curl -fsSL --max-time 20 https://api.github.com/repos/caddyserver/caddy/releases/latest)
# Matched in the shell rather than piped through grep. Any early-exiting reader
# (`grep -m1`, `head -1`) closes the pipe while the writer is still going, which
# is a SIGPIPE, which under pipefail is a fatal error for a download that in
# fact succeeded — the script died with 141 and printed nothing at all.
tag=""
if [[ $release =~ \"tag_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  tag="${BASH_REMATCH[1]}"
fi
[ -n "$tag" ] || { echo "could not determine the latest Caddy release" >&2; exit 1; }
version="${tag#v}"
url="https://github.com/caddyserver/caddy/releases/download/${tag}/caddy_${version}_linux_${rel}.tar.gz"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Fetching official Caddy $tag ($rel) …"
curl -fsSL --max-time 120 "$url" -o "$tmp/caddy.tar.gz"
tar -xzf "$tmp/caddy.tar.gz" -C "$tmp" caddy
chmod 0755 "$tmp/caddy"
have=$("$tmp/caddy" version | head -1)
echo "  downloaded: $have"

for dir in $TARGETS; do
  [ -d "$dir" ] || { echo "  skipping $dir (not there)"; continue; }
  install -d -m 0755 "$dir/bin"
  was="unknown"
  [ -x "$dir/bin/caddy" ] && was=$("$dir/bin/caddy" version 2>/dev/null | head -1)
  # Replace via a temporary name: a running server holds its binary open, and
  # overwriting it in place can fail with "text file busy".
  install -m 0755 "$tmp/caddy" "$dir/bin/caddy.new"
  mv -f "$dir/bin/caddy.new" "$dir/bin/caddy"
  echo "  $dir: $was -> $($dir/bin/caddy version | head -1)"
done
REMOTE
