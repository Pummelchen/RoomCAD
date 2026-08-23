#!/usr/bin/env bash
# One-time migration: give every project on this host its own web server.
#
# Before: one system-wide Caddy (/etc/caddy/Caddyfile, caddy.service) served
# BOTH RoomCAD on :8443 and an unrelated updater on :8090. RoomCAD's deploy
# overwrote that whole file every release, so the other project's configuration
# only survived because it happened to be copied into RoomCAD's repository —
# and any change made to it on the host was lost at the next deploy. One
# project's mistake was the other project's outage.
#
# After: two independent instances, each with its own copy of the binary, its
# own config, its own storage, its own unix user and its own unit.
#
#   /var/roomcad/bin/caddy        roomcad-caddy.service   roomcadweb   :8443
#   /var/xaios_updater/bin/caddy  xaios-caddy.service     xaiosweb     :8090
#
# The system-wide caddy.service is stopped and disabled; its config file is
# left on disk untouched, as a record of what used to be there.
#
# Safe to re-run. If either new instance fails to come up, the old one is
# started again and the script exits non-zero.
set -euo pipefail

HOST="${1:-root@91.99.176.243}"
SRC_BINARY=/usr/bin/caddy

echo "Splitting the shared Caddy into per-project instances on $HOST …"

ssh "$HOST" "bash -s" <<'REMOTE'
set -euo pipefail
SRC=/usr/bin/caddy
[ -x "$SRC" ] || { echo "no caddy binary at $SRC" >&2; exit 1; }
[ -r /var/roomcad/tls/fullchain.pem ] && [ -r /var/roomcad/tls/privkey.pem ] \
  || { echo "RoomCAD's certificate is not in /var/roomcad/tls" >&2; exit 1; }

# --- unix users, one per project -------------------------------------------
for u in roomcadweb xaiosweb; do
  id -u "$u" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$u"
done

# --- RoomCAD ----------------------------------------------------------------
install -d -m 0755 /var/roomcad/bin
# Owned by the instance: its admin socket is created in here at start-up.
install -d -m 0750 -o roomcadweb -g roomcadweb /var/roomcad/caddy \
  /var/roomcad/caddy/data /var/roomcad/caddy/config
install -m 0755 "$SRC" /var/roomcad/bin/caddy
# The certificate is RoomCAD's own, and only its own web server reads it.
chown -R root:roomcadweb /var/roomcad/tls
chmod 0750 /var/roomcad/tls
chmod 0640 /var/roomcad/tls/fullchain.pem /var/roomcad/tls/privkey.pem

# --- xaios updater ----------------------------------------------------------
install -d -m 0755 /var/xaios_updater/bin
install -d -m 0750 -o xaiosweb -g xaiosweb /var/xaios_updater/caddy \
  /var/xaios_updater/caddy/data /var/xaios_updater/caddy/config
install -m 0755 "$SRC" /var/xaios_updater/bin/caddy

cat > /var/xaios_updater/caddy/Caddyfile <<'XCFG'
# The updater's own web server. Its own binary, config, storage, user and unit;
# nothing here is shared with any other project on this host.
{
	auto_https disable_redirects
	# Its own admin socket: two Caddy processes cannot share the default
	# admin endpoint, and the second one to start would fail.
	admin unix//var/xaios_updater/caddy/admin.sock
}

:8090 {
	root * /var/xaios_updater
	header {
		X-Content-Type-Options nosniff
		Cache-Control "public, max-age=300"
	}
	file_server {
		# The server's own files live inside the directory it serves, so they
		# are hidden explicitly rather than being downloadable.
		hide /var/xaios_updater/caddy /var/xaios_updater/bin
	}
}
XCFG
chown root:xaiosweb /var/xaios_updater/caddy/Caddyfile
chmod 0640 /var/xaios_updater/caddy/Caddyfile

cat > /etc/systemd/system/xaios-caddy.service <<'XUNIT'
# The updater's own web server, entirely separate from any other on this host.
[Unit]
Description=Caddy for the xaios updater (private instance)
After=network-online.target
Requires=network-online.target

[Service]
Type=notify
User=xaiosweb
Group=xaiosweb
Environment=XDG_DATA_HOME=/var/xaios_updater/caddy/data
Environment=XDG_CONFIG_HOME=/var/xaios_updater/caddy/config
ExecStart=/var/xaios_updater/bin/caddy run --environ --config /var/xaios_updater/caddy/Caddyfile
ExecReload=/var/xaios_updater/bin/caddy reload --config /var/xaios_updater/caddy/Caddyfile --force --address unix//var/xaios_updater/caddy/admin.sock
Restart=on-failure
RestartSec=3s
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
ReadWritePaths=/var/xaios_updater/caddy

[Install]
WantedBy=multi-user.target
XUNIT
REMOTE

echo "Installing RoomCAD's own config and unit …"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scp -q "$SERVER_DIR/Caddyfile" "$HOST:/var/roomcad/caddy/Caddyfile"
scp -q "$SERVER_DIR/roomcad-caddy.service" "$HOST:/etc/systemd/system/roomcad-caddy.service"

ssh "$HOST" "bash -s" <<'REMOTE'
set -euo pipefail
chown root:roomcadweb /var/roomcad/caddy/Caddyfile
chmod 0640 /var/roomcad/caddy/Caddyfile

# --- validate both, with each project's own binary, before switching --------
/var/roomcad/bin/caddy validate --config /var/roomcad/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || { echo "RoomCAD's own Caddyfile is not valid — nothing changed" >&2; exit 1; }
/var/xaios_updater/bin/caddy validate --config /var/xaios_updater/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || { echo "the updater's Caddyfile is not valid — nothing changed" >&2; exit 1; }

systemctl daemon-reload

# --- the swap ---------------------------------------------------------------
# Both ports are held by the shared instance, so it has to let go before the
# new ones can bind. This is the only moment either site is down.
systemctl stop caddy || true
started=""
if systemctl enable --now roomcad-caddy >/dev/null 2>&1; then started="$started roomcad-caddy"; fi
if systemctl enable --now xaios-caddy >/dev/null 2>&1; then started="$started xaios-caddy"; fi

sleep 2
ok=1
systemctl is-active --quiet roomcad-caddy || { echo "roomcad-caddy did not start" >&2; ok=0; }
systemctl is-active --quiet xaios-caddy   || { echo "xaios-caddy did not start" >&2; ok=0; }
if [ "$ok" != 1 ]; then
  echo "Rolling back to the shared instance." >&2
  systemctl disable --now roomcad-caddy xaios-caddy >/dev/null 2>&1 || true
  systemctl start caddy
  exit 1
fi

# The shared instance is no longer anyone's web server.
systemctl disable caddy >/dev/null 2>&1 || true
echo "roomcad-caddy and xaios-caddy are running; the shared caddy.service is stopped and disabled."
REMOTE

echo "Checking both sites …"
ssh "$HOST" 'curl -s -o /dev/null -w "  updater  :8090 -> %{http_code}\n" --max-time 6 http://127.0.0.1:8090/catalog-x86_64.txt || true'
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://roomcad.91.99.176.243.nip.io:8443/" || true)
echo "  RoomCAD  :8443 -> $code"
[ "$code" = "200" ] || { echo "FAILED: RoomCAD did not answer." >&2; exit 1; }
echo "Done. Every project now runs its own web server."
