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
TMP_TAR="/tmp/roomcad-deploy.tar.gz"

echo "Packaging web/ and server.py …"
tar czf "$TMP_TAR" --exclude='web/bin' --exclude='web/photos' -C "$ROOMCAD_DIR" web -C "$SERVER_DIR" server.py

echo "Uploading to $HOST …"
scp "$TMP_TAR" "$HOST:$TMP_TAR"

echo "Extracting into $REMOTE_ROOT …"
ssh "$HOST" "tar xzf '$TMP_TAR' -C '$REMOTE_ROOT' && \
  chown -R root:root '$REMOTE_ROOT/web' '$REMOTE_ROOT/server.py' && \
  chmod -R u+rwX,go+rX '$REMOTE_ROOT/web' && \
  chmod 755 '$REMOTE_ROOT/server.py' && \
  find '$REMOTE_ROOT/web' -name '._*' -delete && \
  rm -f '$TMP_TAR'"

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

rm -f "$TMP_TAR"
echo "Deployed. roomcad, caddy and nginx are restarted."
