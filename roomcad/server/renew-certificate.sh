#!/usr/bin/env bash
# Renew RoomCAD's TLS certificate, without touching another project's anything.
#
# RoomCAD's Caddy serves a certificate from /var/roomcad/tls. That copy used to
# come from the system certbot store via a renewal hook — but /etc/letsencrypt
# on this host is a symlink into a third project's directory, and when that
# directory was restructured the link dangled: no hook, no renewal, and a deploy
# that gave up halfway. So RoomCAD keeps its own certbot state under
# /var/roomcad/letsencrypt and shares nothing.
#
# The one thing it cannot own is port 80. Let's Encrypt validates HTTP-01 there
# and TLS-ALPN-01 on 443, and both are held by an unrelated nginx. This script
# therefore REFUSES to touch that server by default: it reports who holds the
# port and stops. Pass --take-port-80 to have it stop nginx for the length of
# the challenge and start it again afterwards — read the warning below first.
#
# Usage:
#   ./renew-certificate.sh [host]                  # check and report
#   ./renew-certificate.sh [host] --take-port-80   # actually renew
set -euo pipefail

HOST="${1:-root@91.99.176.243}"
MODE="${2:-}"
DOMAIN="roomcad.91.99.176.243.nip.io"

ssh "$HOST" "MODE='$MODE' DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -euo pipefail
STORE=/var/roomcad/letsencrypt
LIVE="$STORE/live/$DOMAIN"

echo "Certificate in use:"
openssl x509 -enddate -noout -in /var/roomcad/tls/fullchain.pem 2>/dev/null | sed 's/^/  /' \
  || echo "  none installed"

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot is not installed on this host." >&2
  exit 1
fi

holder=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:80$/ {print $6}' | head -1)
if [ -n "$holder" ]; then
  echo "Port 80 is held by: $holder"
  if [ "$MODE" != "--take-port-80" ]; then
    cat >&2 <<'WHY'

Not renewing. Let's Encrypt has to reach this host on port 80 to prove the name
belongs to it, and that port belongs to another project's web server. Stopping
someone else's server is not something this script does on its own.

Re-run with --take-port-80 to stop it for the length of the challenge. Before
you do: check that server can actually start again. On this host `nginx -t`
currently FAILS, because /etc/nginx is a dangling symlink — so stopping nginx
right now would take it down and it would not come back.
WHY
    exit 2
  fi
fi

install -d -m 0700 "$STORE"
stopped=""
if [ -n "$holder" ] && [ "$MODE" = "--take-port-80" ]; then
  echo "Stopping nginx for the challenge …"
  systemctl stop nginx && stopped=1
fi
restore() { [ -n "$stopped" ] && { echo "Starting nginx again …"; systemctl start nginx || true; }; }
trap restore EXIT

certbot certonly --standalone --non-interactive --agree-tos --keep-until-expiring \
  --register-unsafely-without-email \
  --config-dir "$STORE" --work-dir "$STORE/work" --logs-dir "$STORE/logs" \
  -d "$DOMAIN"

[ -r "$LIVE/fullchain.pem" ] || { echo "certbot did not produce a certificate" >&2; exit 1; }

# Into RoomCAD's own directory, readable only by RoomCAD's own web server.
install -d -m 0750 -o root -g roomcadweb /var/roomcad/tls
install -m 0640 -o root -g roomcadweb "$LIVE/fullchain.pem" /var/roomcad/tls/fullchain.pem
install -m 0640 -o root -g roomcadweb "$LIVE/privkey.pem"   /var/roomcad/tls/privkey.pem
systemctl reload roomcad-caddy || systemctl restart roomcad-caddy
echo "Installed. Now serving:"
openssl x509 -enddate -noout -in /var/roomcad/tls/fullchain.pem | sed 's/^/  /'
REMOTE
