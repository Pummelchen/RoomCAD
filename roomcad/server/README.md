# RoomCAD server

Everything needed to run the RoomCAD backend on the VPS, and to rebuild it
from scratch if the VPS is ever lost. The web app itself lives in
[`../web`](../web); this directory mirrors the production server.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | Python (stdlib) save + live-collaboration API, SQLite-backed |
| `roomcad.service` | systemd unit that runs `server.py` on `127.0.0.1:8078` |
| `Caddyfile` | RoomCAD's **own** Caddy config — terminates TLS, serves the web app, proxies `/api/*` to the API |
| `roomcad-caddy.service` | systemd unit for RoomCAD's own Caddy instance, under its own user |
| `split-caddy-instances.sh` | one-time migration that gave each project on the host its own web server |
| `renew-certificate.sh` | renews the certificate using RoomCAD's own certbot store |
| `schema.sql` | SQLite schema (versioned rooms plus hashed browser session records) |
| `rooms.db.sql` | full SQL dump of the rooms database (structure + content), restorable |
| `deploy.sh` | one-command deploy of the web app + API to the VPS |

## Server layout on the VPS

```
/var/roomcad/
  server.py        # the API
  rooms.db         # SQLite database (WAL mode)
  web/             # static web app
  rooms/           # legacy .rcad files (migrated once, now empty)

/etc/systemd/system/roomcad.service        # the Python API
/etc/systemd/system/roomcad-caddy.service  # RoomCAD's own web server

/var/roomcad/bin/caddy        # its own copy of the binary
/var/roomcad/caddy/Caddyfile  # its own config
/var/roomcad/caddy/data       # its own storage
/var/roomcad/tls/             # its own certificate, root:roomcadweb 0750
/var/roomcad/letsencrypt/     # its own certbot store (renew-certificate.sh)
```

The API listens on `127.0.0.1:8078`; Caddy reverse-proxies `/api/*` to it and
serves `web/` as static files.

## HTTPS, and one web server per project

The entry point is **https://roomcad.91.99.176.243.nip.io:8443/** (a nip.io
wildcard that resolves to the VPS IP). RoomCAD runs its **own** Caddy: its own
copy of the binary in `/var/roomcad/bin`, its own config, its own storage, its
own unix user (`roomcadweb`) and its own unit (`roomcad-caddy.service`). It
terminates TLS, serves `web/` and forwards `/api/*` to the Python API. Nothing
else is in the request path.

It did not start that way, and the reasons it changed are worth keeping:

* RoomCAD used to be a site block inside the **system-wide**
  `/etc/caddy/Caddyfile`, which also served an unrelated updater on `:8090`.
  Because `deploy.sh` installed that whole file, this repository had to carry
  the other project's configuration, and every RoomCAD release overwrote
  whatever had been changed on the host. One project's deploy was another
  project's outage waiting to happen.
* `/etc/nginx` and `/etc/letsencrypt` on this host are **symlinks into a third
  project's tree**. When that tree was restructured both links dangled, and
  because `deploy.sh` stops on the first error it began abandoning deploys
  halfway — web files synced, Caddy never reloaded, site never checked.

`split-caddy-instances.sh` performed the separation: it gave the updater its own
instance too (`/var/xaios_updater/bin/caddy`, `xaios-caddy.service`, user
`xaiosweb`, port 8090), validated both configs with each project's own binary
before switching, rolled back if either failed, and left the shared
`caddy.service` stopped and disabled with its config file untouched as a record.
Each instance has its own admin socket, because two Caddy processes cannot share
the default admin port.

Restarting either instance now leaves the other serving.

The port is 8443 rather than 443 because an unrelated service (nginx) still
holds 80 and 443. That also rules out Caddy running ACME for itself, since
HTTP-01 needs port 80 and TLS-ALPN-01 needs port 443 — so the certificate is
obtained by `renew-certificate.sh`, which keeps its certbot state under
`/var/roomcad/letsencrypt` and installs the result into `/var/roomcad/tls` for
`roomcadweb` alone. Because the challenge needs port 80, that script **refuses
to stop another project's web server on its own**: it reports who holds the port
and stops, unless run with `--take-port-80`. Read its warning first — `nginx -t`
currently fails on this host, so nginx would not come back.

The old `:443` address is still forwarded to `:8443` by nginx, from a config
loaded before its directory vanished. That redirect is no longer RoomCAD's to
manage; `deploy.sh` reports it and moves on.

`flush_interval -1` on the API proxy keeps the live-collaboration SSE stream
unbuffered.

### HTTP/3 (QUIC)

Enabled explicitly with `protocols h1 h2 h3`, so Caddy listens on **UDP 8443**
as well as TCP and advertises `Alt-Svc: h3=":8443"`.

QUIC is UDP, and **a firewall rule that opens a TCP port does not open the UDP
one** — they are separate rules. Both the host firewall and the provider's
firewall have to allow UDP 8443. If HTTP/3 works on the host itself but not
from outside, that is the difference:

```bash
# on the host — bypasses any external firewall
curl --http3-only --resolve roomcad.91.99.176.243.nip.io:8443:127.0.0.1 \
  https://roomcad.91.99.176.243.nip.io:8443/
# from anywhere else
curl --http3-only https://roomcad.91.99.176.243.nip.io:8443/
```

`deploy.sh` runs the second of those and says so if HTTP/3 is advertised but
cannot connect. It is advisory: HTTP/2 over TCP still serves every client, and
browsers fall back on their own when a QUIC attempt fails.

HTTP/3 is **confirmed working for public clients**. The way to establish that,
if it is ever in doubt again, is to capture on the server while an external
client connects, rather than to trust a test run from here:

```bash
# on the server, ignoring anything coming over the tailnet
tcpdump -ni any 'udp port 8443 and not net 100.64.0.0/10' -w /tmp/ext.pcap
# then have something on the public internet fetch the site
```

A completed handshake shows the server sending a ~1280-byte Initial (the one
carrying the certificate), then Handshake, then 1-RTT packets. 1-RTT means the
handshake finished.

**Do not trust an HTTP/3 test from a machine that reaches the server over a VPN
or mesh network.** If the host is in a Tailscale/WireGuard network, traffic to
its public address is carried over that tunnel instead of the public internet —
a different path with a smaller MTU, which QUIC is far more sensitive to than
TCP. `ip route get <ip>` shows which interface is really used, and a capture on
the server shows which interface packets arrive on.

This is not hypothetical: over a 1280-MTU tunnel the server's ~1280-byte
Initial cannot be sent at all (1280 + 28 bytes of IP/UDP header exceeds the
tunnel MTU, and QUIC sets DF so it is dropped rather than fragmented). The
client then retransmits its ClientHello forever and the handshake times out —
while the very same server completes the handshake normally with any client
that reaches it over the public internet.

Caddy must be recent. Debian ships 2.6.2 (upstream 2022), whose QUIC and config
reloading are both long superseded — a reload of that build could panic and
take the process down. The host now tracks Caddy's official apt repository.

## Authentication

The site is protected by one shared password, checked server-side. The password
is **not** stored in this repo — it lives in a host-local env file so it stays
out of the public git history:

```bash
# /var/roomcad/roomcad.env  (chmod 600)
ROOMCAD_PASSWORD=your-password
```

`roomcad.service` loads it via `EnvironmentFile`. `POST /api/login` checks the
password and sets an `HttpOnly` session cookie; a hash of that token and the
last saved/opened room version are stored in SQLite. A new session without a
prior selection opens the project's most recently saved room/version, while a
returning session resumes its own exact version. This survives an API restart
without adding local-storage or a second cookie. Every other `/api/*` handler
returns 401 without a valid session. The frontend `login.js` just drives the
form and calls `/api/login`. If the env file is missing, the service starts but
logins are disabled (fail-closed).

## Restoring from a lost VPS

1. Provision a Linux host and install Caddy, certbot and Python 3
   (RoomCAD then keeps its own copy of the Caddy binary; see `split-caddy-instances.sh`)
   (stdlib only).
2. Restore this directory:

   ```bash
   mkdir -p /var/roomcad/web
   cp server.py /var/roomcad/server.py
   chmod 755 /var/roomcad/server.py
   ```

3. Restore the database from the dump:

   ```bash
   sqlite3 /var/roomcad/rooms.db < rooms.db.sql
   ```

4. Install the service, Caddy config and the password env file:

   ```bash
   cp roomcad.service /etc/systemd/system/roomcad.service
   cp roomcad-caddy.service /etc/systemd/system/roomcad-caddy.service
   cp Caddyfile /var/roomcad/caddy/Caddyfile
   chown root:roomcadweb /var/roomcad/caddy/Caddyfile
   chmod 640 /var/roomcad/caddy/Caddyfile
   printf 'ROOMCAD_PASSWORD=your-password\n' > /var/roomcad/roomcad.env
   chmod 600 /var/roomcad/roomcad.env
   systemctl daemon-reload
   systemctl enable --now roomcad roomcad-caddy
   systemctl reload caddy
   ```

5. Obtain the certificate, then give Caddy a copy it can read.

   Caddy serves RoomCAD end to end, TLS included — nginx is not involved. It
   listens on **8443** rather than 443 because an unrelated service already
   holds 80 and 443 on this host; that also rules out Caddy running ACME for
   itself, since HTTP-01 needs port 80 and TLS-ALPN-01 needs port 443. So
   certbot obtains the certificate over another site's webroot, and a deploy
   hook copies it into `/var/roomcad/tls/`, which the `caddy` user can read
   (certbot's own store is `0700 root:root`).

   ```bash
   certbot certonly --webroot -w /var/minecraftai/web/site/public \
     -d roomcad.91.99.176.243.nip.io --key-type ecdsa --agree-tos --non-interactive
   ```

   `deploy.sh` installs the hook and runs it once, so there is nothing else to
   do here. RoomCAD is then at **https://roomcad.91.99.176.243.nip.io:8443/**.

## Deploying

Run `./deploy.sh` from this directory (uses your SSH key). It synchronizes the
web app with deletion enabled, uploads the API, installs the
service and Caddy config, and restarts the services. It never touches
`rooms.db` or `roomcad.env`, so live data and the password are preserved.

## HTTP/3 (QUIC)

Caddy 2.6+ serves HTTP/3 automatically for every TLS site (no extra directive
needed), so the production `:8443` site already accepts HTTP/3 over **UDP 8443**
(and standard UDP 443 where available) in addition to HTTP/1.1 + HTTP/2 over
TCP. Just make sure the firewall allows UDP on the TLS port.
