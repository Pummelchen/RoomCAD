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

# RoomCAD keeps its own certificate in its own directory. It used to be copied
# out of certbot's store by a renewal hook — but that store is a symlink into a
# third project's tree on this host, and when that tree was restructured the
# link dangled and the deploy started failing halfway. Nothing in this script
# reads a path belonging to another project any more; the certificate is simply
# checked, and its expiry reported.
echo "Checking RoomCAD's certificate …"
if ! ssh "$HOST" "test -r /var/roomcad/tls/fullchain.pem && test -r /var/roomcad/tls/privkey.pem"; then
  echo "ABORTED: /var/roomcad/tls is missing its certificate or key." >&2
  echo "Nothing was installed. The running site is untouched." >&2
  exit 1
fi
CERT_END=$(ssh "$HOST" "openssl x509 -enddate -noout -in /var/roomcad/tls/fullchain.pem" 2>/dev/null | cut -d= -f2)
CERT_DAYS=$(ssh "$HOST" "openssl x509 -checkend 2592000 -noout -in /var/roomcad/tls/fullchain.pem >/dev/null 2>&1 && echo ok || echo soon")
echo "  valid until $CERT_END"
if [ "$CERT_DAYS" = "soon" ]; then
  echo "  WARNING: that is less than 30 days away. See renew-certificate.sh." >&2
fi

# RoomCAD runs its OWN Caddy: its own binary under /var/roomcad/bin, its own
# config, its own storage, its own unix user and its own unit. It used to be a
# site block inside the system-wide /etc/caddy/Caddyfile, which also served an
# unrelated project — so this deploy overwrote that project's configuration on
# every release. See split-caddy-instances.sh for the migration.
#
# Validate with the binary that will actually run it. Directives come and go
# between Caddy versions, so validating with some other copy proves nothing —
# and an invalid file installed here is a landmine that only goes off at the
# next restart, long after the deploy "succeeded". It also checks the
# certificate is readable, so a missing copy aborts here rather than taking the
# site down later.
echo "Validating RoomCAD's Caddyfile with RoomCAD's own Caddy …"
scp -q "$SERVER_DIR/Caddyfile" "$HOST:/tmp/Caddyfile.candidate"
if ! ssh "$HOST" "/var/roomcad/bin/caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile" >/dev/null 2>&1; then
  echo "ABORTED: the Caddyfile is not valid for $(ssh "$HOST" '/var/roomcad/bin/caddy version' 2>/dev/null | head -1)." >&2
  ssh "$HOST" "/var/roomcad/bin/caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile" 2>&1 | grep -i error >&2 || true
  ssh "$HOST" "rm -f /tmp/Caddyfile.candidate"
  echo "Nothing was installed. The running site is untouched." >&2
  exit 1
fi
ssh "$HOST" "rm -f /tmp/Caddyfile.candidate"

echo "Installing RoomCAD's units and its own Caddyfile …"
scp -q "$SERVER_DIR/roomcad.service" "$HOST:/etc/systemd/system/roomcad.service"
scp -q "$SERVER_DIR/roomcad-caddy.service" "$HOST:/etc/systemd/system/roomcad-caddy.service"
scp -q "$SERVER_DIR/Caddyfile" "$HOST:/var/roomcad/caddy/Caddyfile"
ssh "$HOST" "chown root:roomcadweb /var/roomcad/caddy/Caddyfile && \
  chmod 640 /var/roomcad/caddy/Caddyfile && \
  systemctl daemon-reload && \
  systemctl restart roomcad"

# Reload, then check it is actually still running. Caddy can panic while
# swapping a config in — a Go runtime bug, not a bad config — and the process
# dies. `systemctl reload` reports that as a non-fatal message, so a deploy once
# finished with "Deployed." while the site was down. Fall back to a hard
# restart, and refuse to claim success until the site answers.
echo "Reloading RoomCAD's Caddy …"
if ! ssh "$HOST" "systemctl reload roomcad-caddy" 2>/dev/null || \
   ! ssh "$HOST" "systemctl is-active --quiet roomcad-caddy"; then
  echo "  reload did not leave it running — restarting."
  ssh "$HOST" "systemctl restart roomcad-caddy"
fi
if ! ssh "$HOST" "systemctl is-active --quiet roomcad-caddy"; then
  echo "FAILED: roomcad-caddy is not running on $HOST." >&2
  ssh "$HOST" "journalctl -u roomcad-caddy -n 15 --no-pager" >&2 || true
  exit 1
fi

# The shared password lives in a host-local env file, never in git.
if ! ssh "$HOST" "test -f /var/roomcad/roomcad.env"; then
  echo "WARNING: /var/roomcad/roomcad.env is missing — logins are disabled until you create it with ROOMCAD_PASSWORD=… (see README)."
fi

# A deploy that cannot be reached is not a deploy. Check the real URL, over
# TLS, before saying anything reassuring.
SITE="https://roomcad.91.99.176.243.nip.io:8443"
echo "Checking $SITE …"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/" || echo 000)"
api="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/api/rooms" || echo 000)"
if [ "$code" != "200" ]; then
  echo "FAILED: $SITE/ answered $code (expected 200)." >&2
  exit 1
fi
# Unauthenticated, so 401 is the healthy answer from the API.
if [ "$api" != "401" ] && [ "$api" != "200" ]; then
  echo "FAILED: $SITE/api/rooms answered $api (expected 401)." >&2
  exit 1
fi

# HTTP/3 runs over UDP on the same port number as HTTPS, and a firewall rule
# that opens a TCP port does NOT open the UDP one — they are separate rules.
# Caddy advertises h3 via Alt-Svc regardless, so without this check the site
# can spend months telling every browser to try a protocol that cannot get
# through. Advisory only: HTTP/2 still serves everyone.
alt="$(curl -sI --max-time 15 "$SITE/" | tr -d '\r' | grep -i '^alt-svc:' || true)"
if [ -z "$alt" ]; then
  echo "NOTE: no Alt-Svc header — HTTP/3 is not being advertised."
elif curl --version | grep -q HTTP3; then
  if curl --http3-only -s -o /dev/null --max-time 15 "$SITE/" 2>/dev/null; then
    echo "HTTP/3 (QUIC) reachable from this machine."
  else
    echo "NOTE: HTTP/3 is advertised but did not connect FROM THIS MACHINE."
    echo "      That is not proof it is broken for visitors. This machine may not"
    echo "      reach the server over the public internet at all — a VPN or mesh"
    echo "      network (Tailscale, WireGuard) silently carries the traffic over a"
    echo "      different path with a different MTU, and QUIC is far more sensitive"
    echo "      to that than TCP is. Check with:  ip route get ${SITE#https://}"
    echo "      To judge it properly, test from a device on an unrelated network."
    echo "      If it does fail publicly too, QUIC is UDP: a firewall rule opening"
    echo "      the TCP port does NOT open the UDP one."
  fi
else
  echo "NOTE: local curl has no HTTP/3 support, so QUIC reachability was not checked."
fi

# The old address is forwarded by nginx, which belongs to another project and
# is no longer this script's business to configure. It is still worth reporting,
# because a stale bookmark landing on someone else's application is confusing —
# but it is a note, not a verdict on this deploy.
legacy="$(curl -sk -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 \
  https://roomcad.91.99.176.243.nip.io/ || echo "000")"
case "$legacy" in
  30*\ *:8443/*) echo "Old URL still redirects here: $legacy" ;;
  *) echo "NOTE: the old URL answered '$legacy'. It is forwarded by nginx, which" ;;
esac

echo "Deployed. RoomCAD runs its own web server (roomcad-caddy) on its own port."
echo "RoomCAD: $SITE/"
