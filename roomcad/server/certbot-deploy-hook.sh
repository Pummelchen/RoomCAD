#!/usr/bin/env bash
# Gives Caddy its own readable copy of RoomCAD's certificate.
#
# certbot keeps /etc/letsencrypt/live and /archive at mode 0700 root:root, and
# Caddy runs as the unprivileged `caddy` user, so it cannot read the files
# there. Rather than loosening permissions on a store shared with other
# services, this copies just RoomCAD's certificate into a directory Caddy owns.
#
# certbot runs every script in /etc/letsencrypt/renewal-hooks/deploy/ after a
# successful renewal, for each renewed lineage, with RENEWED_LINEAGE set.
# Installed and run once by deploy.sh, so the copy exists before Caddy needs it.
set -euo pipefail

DOMAIN="roomcad.91.99.176.243.nip.io"
SRC="${RENEWED_LINEAGE:-/etc/letsencrypt/live/$DOMAIN}"
DEST="/var/roomcad/tls"

# On a renewal of some other certificate, this hook has nothing to do.
case "$SRC" in
  *"$DOMAIN"*) ;;
  *) exit 0 ;;
esac

[ -r "$SRC/fullchain.pem" ] || { echo "roomcad-caddy hook: no cert at $SRC" >&2; exit 1; }

install -d -m 0750 -o root -g caddy "$DEST"
install -m 0640 -o root -g caddy "$SRC/fullchain.pem" "$DEST/fullchain.pem"
install -m 0640 -o root -g caddy "$SRC/privkey.pem"   "$DEST/privkey.pem"

# Pick up the new certificate without dropping connections.
systemctl reload caddy 2>/dev/null || true
echo "roomcad-caddy hook: certificate copied to $DEST"
