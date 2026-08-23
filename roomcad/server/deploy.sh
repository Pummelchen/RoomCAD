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

# Caddy serves RoomCAD end to end, including TLS, so it needs a copy of the
# certificate it can actually read: certbot keeps its store at 0700 root:root
# and Caddy runs as the caddy user. The hook does the copy on every renewal;
# running it once here makes sure the files exist before Caddy is asked to load
# them, and before the Caddyfile is validated against them below.
echo "Installing the certificate hook and refreshing Caddy's copy …"
scp -q "$SERVER_DIR/certbot-deploy-hook.sh" "$HOST:/etc/letsencrypt/renewal-hooks/deploy/roomcad-caddy.sh"
ssh "$HOST" "chmod 755 /etc/letsencrypt/renewal-hooks/deploy/roomcad-caddy.sh && \
  /etc/letsencrypt/renewal-hooks/deploy/roomcad-caddy.sh"

# Validate the Caddyfile with the Caddy that is actually on the host before it
# is allowed anywhere near /etc. Caddy directives come and go between versions,
# so validating with a local binary proves nothing about the server — and an
# invalid file installed here would leave a landmine that only goes off the
# next time Caddy restarts, long after the deploy "succeeded". It also checks
# the certificate files are readable, so a missing copy aborts here rather than
# taking the site down on the next reload.
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

echo "Installing systemd unit and Caddyfile …"
scp "$SERVER_DIR/roomcad.service" "$HOST:/etc/systemd/system/roomcad.service"
scp "$SERVER_DIR/Caddyfile" "$HOST:/etc/caddy/Caddyfile"
ssh "$HOST" "chown root:caddy /etc/caddy/Caddyfile && \
  chmod 644 /etc/caddy/Caddyfile && \
  systemctl daemon-reload && \
  systemctl restart roomcad"

# Reload Caddy, then check it is actually still running. Caddy 2.6.2 can panic
# while swapping a config in — a Go runtime bug, not a bad config — and the
# process dies. `systemctl reload` reported that as a non-fatal message, so a
# deploy once finished with "Deployed." while the site was down. Fall back to a
# hard restart, and refuse to claim success until the site answers.
echo "Reloading Caddy …"
if ! ssh "$HOST" "systemctl reload caddy" 2>/dev/null || \
   ! ssh "$HOST" "systemctl is-active --quiet caddy"; then
  echo "  reload did not leave Caddy running — restarting it."
  ssh "$HOST" "systemctl restart caddy"
fi
if ! ssh "$HOST" "systemctl is-active --quiet caddy"; then
  echo "FAILED: Caddy is not running on $HOST." >&2
  ssh "$HOST" "journalctl -u caddy -n 15 --no-pager" >&2 || true
  exit 1
fi

# RoomCAD used to be published through an nginx site that proxied to Caddy.
# Caddy now terminates TLS itself, so that site is retired. In its place goes a
# block that does nothing but redirect to the real address.
#
# That redirect is not optional. nginx owns 80 and 443 here and its default
# server answers for ANY hostname that matches nothing else, so with no block
# for this name RoomCAD's old address falls through to that default and serves a
# completely different application to anyone with an old bookmark. The block
# contains no proxy_pass, no root, and no RoomCAD configuration — only a 308.
echo "Pointing the old address at the real one …"
scp -q "$SERVER_DIR/nginx-roomcad-redirect.conf" "$HOST:/etc/nginx/sites-available/roomcad-redirect.conf"
if ssh "$HOST" "rm -f /etc/nginx/sites-enabled/roomcad.conf && \
  ln -sf /etc/nginx/sites-available/roomcad-redirect.conf /etc/nginx/sites-enabled/roomcad-redirect.conf && \
  nginx -t && systemctl reload nginx" >/dev/null 2>&1; then
  echo "  the old URL now redirects to port 8443."
else
  echo "  WARNING: nginx would not reload — the old URL may still land elsewhere." >&2
  ssh "$HOST" "rm -f /etc/nginx/sites-enabled/roomcad-redirect.conf; nginx -t && systemctl reload nginx" >/dev/null 2>&1 || true
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

# The old address must land on RoomCAD, not on whatever nginx serves by default.
legacy="$(curl -sk -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 \
  https://roomcad.91.99.176.243.nip.io/ || echo "000")"
case "$legacy" in
  30*\ *:8443/*) echo "Old URL redirects correctly: $legacy" ;;
  *) echo "WARNING: the old URL answered '$legacy' — expected a redirect to :8443." >&2 ;;
esac

echo "Deployed. roomcad and caddy serve the app; nginx only forwards the old URL."
echo "RoomCAD: $SITE/"
