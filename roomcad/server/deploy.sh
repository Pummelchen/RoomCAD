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

# RoomCAD runs its OWN Caddy: its own binary under /var/roomcad/bin, its own
# config, its own storage, its own unix user and its own unit. It listens on
# plain HTTP on loopback; the host's master server in /var/caddy owns 80 and
# 443, terminates TLS and routes this hostname here.
#
# RoomCAD's route into the master is one file, /var/caddy/projects/roomcad.caddy,
# installed below. That is the ONLY thing this deploy writes outside
# /var/roomcad, and no other project's route is touched — which is the whole
# arrangement: one shared Caddyfile holding every project's real config is what
# made each deploy overwrite the others'.
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

echo "Installing RoomCAD's units, its Caddyfile and its route in the master …"
scp -q "$SERVER_DIR/roomcad.service" "$HOST:/etc/systemd/system/roomcad.service"
scp -q "$SERVER_DIR/roomcad-caddy.service" "$HOST:/etc/systemd/system/roomcad-caddy.service"
scp -q "$SERVER_DIR/Caddyfile" "$HOST:/var/roomcad/caddy/Caddyfile"
scp -q "$SERVER_DIR/roomcad.caddy" "$HOST:/var/caddy/projects/roomcad.caddy"
ssh "$HOST" "chown root:roomcadweb /var/roomcad/caddy/Caddyfile && \
  chmod 640 /var/roomcad/caddy/Caddyfile && \
  chown caddy:caddy /var/caddy/projects/roomcad.caddy && \
  chmod 644 /var/caddy/projects/roomcad.caddy && \
  install -d -o caddy -g caddy /var/log/caddy && \
  systemctl daemon-reload"

# Two proxies now sit in front of the API — the master, then RoomCAD's own —
# so the real client address is one entry further from the end of
# X-Forwarded-For. Left at zero, every request throttles as 127.0.0.1.
ssh "$HOST" "touch /var/roomcad/roomcad.env && chmod 600 /var/roomcad/roomcad.env && \
  if grep -q '^ROOMCAD_PROXY_HOPS=' /var/roomcad/roomcad.env; then \
    sed -i 's/^ROOMCAD_PROXY_HOPS=.*/ROOMCAD_PROXY_HOPS=1/' /var/roomcad/roomcad.env; \
  else echo 'ROOMCAD_PROXY_HOPS=1' >> /var/roomcad/roomcad.env; fi"
ssh "$HOST" "systemctl restart roomcad"

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

# The master has to re-read its routes for a changed one to take effect. Its
# whole config is validated first — an invalid route here would take down every
# other project on the host, which is exactly the coupling this arrangement is
# meant to prevent, so it is worth a check rather than a hope.
echo "Reloading the master so it picks up the route …"
if ! ssh "$HOST" "/usr/bin/caddy validate --config /var/caddy/Caddyfile --adapter caddyfile" >/dev/null 2>&1; then
  echo "FAILED: RoomCAD's route makes the master's config invalid. Not reloading." >&2
  ssh "$HOST" "/usr/bin/caddy validate --config /var/caddy/Caddyfile --adapter caddyfile" 2>&1 | grep -i error >&2 || true
  exit 1
fi
ssh "$HOST" "systemctl reload caddy" 2>/dev/null || ssh "$HOST" "systemctl restart caddy"
if ! ssh "$HOST" "systemctl is-active --quiet caddy"; then
  echo "FAILED: the master server is not running — every project on this host is down." >&2
  ssh "$HOST" "journalctl -u caddy -n 20 --no-pager" >&2 || true
  exit 1
fi

# The shared password lives in a host-local env file, never in git.
if ! ssh "$HOST" "test -f /var/roomcad/roomcad.env"; then
  echo "WARNING: /var/roomcad/roomcad.env is missing — logins are disabled until you create it with ROOMCAD_PASSWORD=… (see README)."
fi

# A deploy that cannot be reached is not a deploy. Check the real URL, over
# TLS, before saying anything reassuring.
SITE="https://roomcad.91.99.176.243.nip.io"
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

# 8443 was RoomCAD's public port while it terminated TLS itself. The master
# answers there too, so links handed out then still work.
legacy="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  https://roomcad.91.99.176.243.nip.io:8443/ || echo "000")"
if [ "$legacy" = "200" ]; then
  echo "The old :8443 links still work (the master answers there too)."
else
  echo "NOTE: :8443 answered '$legacy' — old links to that port are broken." >&2
fi

echo "Deployed. The master terminates TLS; RoomCAD serves it on loopback."
echo "RoomCAD: $SITE/"
