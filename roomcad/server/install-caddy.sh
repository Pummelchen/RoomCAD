#!/usr/bin/env bash
# Install the latest OFFICIAL Caddy release as a project's own binary.
#
# The binary that came with the distribution is whatever the package archive
# happens to carry, and it is shared by every project on the host: upgrading it
# for one upgrades it for all, and nobody finds out until something restarts.
# Each project keeps its own copy instead, taken from the upstream release
# rather than from apt.
#
# The archive is checked against the checksums file published with the same
# release before it is extracted, installed or run. A download that does not
# match — tampered with, or truncated by a flaky connection — is discarded and
# the install fails: a server executing an unverified binary is the worse
# outcome.
#
# Usage: ./install-caddy.sh [host] [project-dir ...]
#        ./install-caddy.sh root@host /var/roomcad /srv/another-project
set -euo pipefail

HOST="${1:-root@91.99.176.243}"
shift || true
TARGETS=("$@")
# The default is RoomCAD's own directory, and only RoomCAD's. Every project on
# this host owns its own web server and its own copy of the binary; installing
# into a neighbour's tree is how one project's upgrade breaks another, which is
# exactly the coupling this per-project arrangement exists to prevent. An
# explicit list is still honoured — that is how an operator asks for another
# directory on purpose.
[ ${#TARGETS[@]} -gt 0 ] || TARGETS=(/var/roomcad)

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
archive="caddy_${version}_linux_${rel}.tar.gz"
url="https://github.com/caddyserver/caddy/releases/download/${tag}/${archive}"
# The checksums file is published beside the archive in the same release. Its
# URL is read from the release JSON rather than assembled from the version, so
# an upstream rename stays a failure rather than a silent skip.
sums_url=""
if [[ $release =~ (https://[^\"]*_checksums\.txt)\" ]]; then
  sums_url="${BASH_REMATCH[1]}"
fi
[ -n "$sums_url" ] || { echo "Caddy $tag publishes no checksums file — refusing to install an unverified binary." >&2; exit 1; }

# Check $1 (a downloaded file) against the entry for $2 (its published
# filename) in $3 (the release's checksums file). Caddy publishes SHA-512
# today, but the algorithm is read from the entry rather than assumed, so a
# switch upstream keeps verifying instead of silently passing. Fails — with
# the expected and actual hashes on stderr — on a missing entry, an
# unrecognised hash, a missing hash tool, or a mismatch. The caller must not
# install or run anything when this returns non-zero.
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

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Fetching official Caddy $tag ($rel) …"
curl -fsSL --max-time 120 "$url" -o "$tmp/$archive"
if ! curl -fsSL --max-time 60 "$sums_url" -o "$tmp/checksums.txt"; then
  echo "could not download the checksums file for Caddy $tag ($sums_url)" >&2
  echo "Refusing to install an unverified binary." >&2
  exit 1
fi
if ! verify_archive "$tmp/$archive" "$archive" "$tmp/checksums.txt"; then
  rm -f "$tmp/$archive"
  echo "Refusing to install Caddy from an unverified download." >&2
  exit 1
fi
tar -xzf "$tmp/$archive" -C "$tmp" caddy
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
