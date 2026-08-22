#!/usr/bin/env bash
set -euo pipefail

# Deploy the RoomCAD web app + API to the production VPS.
# Uses your SSH key (no password). Never touches the live rooms.db.
#
# Usage: ./deploy.sh [host]

HOST="${1:-root@91.99.176.243}"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOMCAD_DIR="$(cd "$SERVER_DIR/.." && pwd)"
WEB_DIR="$ROOMCAD_DIR/web"
REMOTE_ROOT="/var/roomcad"
echo "Synchronizing web/ and server.py to $HOST …"
# --delete makes source removals real on the VPS too. The excluded development
# helpers are deliberately preserved if a host has them.
rsync -az --delete --exclude='bin' --exclude='photos' "$WEB_DIR/" "$HOST:$REMOTE_ROOT/web/"
scp "$SERVER_DIR/server.py" "$HOST:$REMOTE_ROOT/server.py"

echo "Setting deployed file permissions …"
ssh "$HOST" "chown -R root:root '$REMOTE_ROOT/web' '$REMOTE_ROOT/server.py' && \
  chmod -R u+rwX,go+rX '$REMOTE_ROOT/web' && \
  chmod 755 '$REMOTE_ROOT/server.py' && \
  find '$REMOTE_ROOT/web' -name '._*' -delete"

# Validate the Caddyfile with the Caddy that is actually on the host before it
# is allowed anywhere near /etc. Caddy directives come and go between versions,
# so validating with a local binary proves nothing about the server — and an
# invalid file installed here would leave a landmine that only goes off the
# next time Caddy restarts, long after the deploy "succeeded".
echo "Validating the Caddyfile against the Caddy on $HOST …"
scp -q "$SERVER_DIR/Caddyfile" "$HOST:/tmp/Caddyfile.candidate"
if ! ssh "$HOST" "caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile" >/dev/null 2>&1; then
  echo "ABORTED: the Caddyfile is not valid for $(ssh "$HOST" 'caddy version' 2>/dev/null | head -1)." >&2
  ssh "$HOST" "caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile" 2>&1 | grep -i error >&2 || true
  ssh "$HOST" "rm -f /tmp/Caddyfile.candidate"
  echo "Nothing was installed. The running site is untouched." >&2
  exit 1
fi
ssh "$HOST" "rm -f /tmp/Caddyfile.candidate"

echo "Installing systemd unit, Caddyfile and nginx site …"
scp "$SERVER_DIR/roomcad.service" "$HOST:/etc/systemd/system/roomcad.service"
scp "$SERVER_DIR/Caddyfile" "$HOST:/etc/caddy/Caddyfile"
scp "$SERVER_DIR/nginx-roomcad.conf" "$HOST:/etc/nginx/sites-available/roomcad.conf"
ssh "$HOST" "chown root:caddy /etc/caddy/Caddyfile && \
  chmod 644 /etc/caddy/Caddyfile && \
  ln -sf /etc/nginx/sites-available/roomcad.conf /etc/nginx/sites-enabled/roomcad.conf && \
  systemctl daemon-reload && \
  systemctl restart roomcad && \
  systemctl reload caddy"
# nginx reload is optional: on a fresh host the Let's Encrypt cert may not be
# issued yet (see README), so don't fail the whole deploy over it.
if ! ssh "$HOST" "nginx -t && systemctl reload nginx"; then
  echo "WARNING: nginx not reloaded — issue the roomcad…nip.io cert first (see README)."
fi

# The shared password lives in a host-local env file, never in git.
if ! ssh "$HOST" "test -f /var/roomcad/roomcad.env"; then
  echo "WARNING: /var/roomcad/roomcad.env is missing — logins are disabled until you create it with ROOMCAD_PASSWORD=… (see README)."
fi

echo "Deployed. roomcad, caddy and nginx are restarted."
