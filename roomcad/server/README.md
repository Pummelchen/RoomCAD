# RoomCAD server

Everything needed to run the RoomCAD backend on the VPS, and to rebuild it
from scratch if the VPS is ever lost. The web app itself lives in
[`../web`](../web); this directory mirrors the production server.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | Python (stdlib) save + live-collaboration API, SQLite-backed |
| `roomcad.service` | systemd unit that runs `server.py` on `127.0.0.1:8078` |
| `Caddyfile` | production Caddy config — terminates TLS, serves the web app, proxies `/api/*` to the API |
| `certbot-deploy-hook.sh` | copies the certificate somewhere the `caddy` user can read, on every renewal |
| `nginx-roomcad-redirect.conf` | sends the old `:443` address to `:8443` — nginx serves nothing of RoomCAD |
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

/etc/systemd/system/roomcad.service
/etc/caddy/Caddyfile
/etc/letsencrypt/live/roomcad.91.99.176.243.nip.io/   # Let's Encrypt cert
/etc/letsencrypt/renewal-hooks/deploy/roomcad-caddy.sh  # copies it for Caddy
/var/roomcad/tls/                        # Caddy's readable copy of the cert
```

The API listens on `127.0.0.1:8078`; Caddy reverse-proxies `/api/*` to it and
serves `web/` as static files.

## HTTPS

The entry point is **https://roomcad.91.99.176.243.nip.io:8443/** (a nip.io
wildcard that resolves to the VPS IP). Caddy serves it end to end: it terminates
TLS, serves `web/` and forwards `/api/*` to the Python API. Nothing else is in
the request path — RoomCAD does not use nginx.

There is one exception, and it is not in the request path. nginx owns ports 80
and 443 on this host, and its default server answers for **any** hostname that
matches nothing else. So a hostname with no server block of its own does not
404 — it quietly serves whatever that default is, which here is an unrelated
application. `nginx-roomcad-redirect.conf` therefore keeps a block for this
name whose entire content is a 308 to port 8443. It has no `proxy_pass` and no
`root`; it exists so an old bookmark lands on RoomCAD instead of somewhere
else. `deploy.sh` installs it and then checks the old URL really does redirect.

The port is 8443 rather than 443 because an unrelated service already holds 80
and 443 on this host. That also rules out Caddy running ACME for itself, since
HTTP-01 needs port 80 and TLS-ALPN-01 needs port 443. So the certificate is
issued once with certbot over another site's webroot and auto-renews via the
systemd `certbot.timer`:

```bash
certbot certonly --webroot -w /var/minecraftai/web/site/public \
  -d roomcad.91.99.176.243.nip.io --key-type ecdsa --agree-tos --non-interactive
```

certbot keeps its store at `0700 root:root` and Caddy runs as the `caddy` user,
so rather than loosening permissions on a store shared with other services, the
deploy hook at `/etc/letsencrypt/renewal-hooks/deploy/roomcad-caddy.sh` copies
just this certificate into `/var/roomcad/tls/` after every renewal and reloads
Caddy. `deploy.sh` installs the hook and runs it once.

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

**Do not trust an HTTP/3 test from a machine that reaches the server over a VPN
or mesh network.** If the host is in a Tailscale/WireGuard network, traffic to
its public address is carried over that tunnel instead of the public internet —
a different path with a smaller MTU, which QUIC is far more sensitive to than
TCP. `ip route get <ip>` shows which interface is really used, and a capture on
the server (`tcpdump -ni any 'udp port 8443'`) shows which interface packets
arrive on. Judge public reachability only from a device on an unrelated network.

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
   cp Caddyfile /etc/caddy/Caddyfile
   chown root:caddy /etc/caddy/Caddyfile
   chmod 644 /etc/caddy/Caddyfile
   printf 'ROOMCAD_PASSWORD=your-password\n' > /var/roomcad/roomcad.env
   chmod 600 /var/roomcad/roomcad.env
   systemctl daemon-reload
   systemctl enable --now roomcad
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
