# RoomCAD server

Everything needed to run the RoomCAD backend on the VPS, and to rebuild it
from scratch if the VPS is ever lost. The web app itself lives in
[`../web`](../web); this directory mirrors the production server.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | Python (stdlib) save + live-collaboration API, SQLite-backed |
| `roomcad.service` | systemd unit that runs `server.py` on `127.0.0.1:8078` |
| `Caddyfile` | production Caddy config (reverse-proxies `/api/*` to the API, serves the web app, TLS) |
| `nginx-roomcad.conf` | nginx site for `roomcad.91.99.176.243.nip.io` (Let's Encrypt HTTPS, proxies to Caddy `:8077`) |
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
/etc/nginx/sites-available/roomcad.conf   # (symlinked from sites-enabled/)
/etc/letsencrypt/live/roomcad.91.99.176.243.nip.io/   # Let's Encrypt cert
```

The API listens on `127.0.0.1:8078`; Caddy reverse-proxies `/api/*` to it and
serves `web/` as static files.

## HTTPS

The public, trusted-HTTPS entry point is
**https://roomcad.91.99.176.243.nip.io** (a nip.io wildcard that resolves to the
VPS IP). nginx owns ports 80/443 on this host (it also serves the minecraftai
site on `pummelchen…nip.io`), so Caddy cannot bind them; instead nginx terminates
TLS and reverse-proxies to Caddy on `127.0.0.1:8077`, which then serves the web
app and forwards `/api/*` to the Python API.

The certificate is issued once with certbot and auto-renews via the systemd
`certbot.timer` (config dir is `/etc/letsencrypt`, symlinked to
`/var/minecraftai/web/letsencrypt`):

```bash
certbot certonly --webroot -w /var/minecraftai/web/site/public \
  -d roomcad.91.99.176.243.nip.io --key-type ecdsa --agree-tos --non-interactive
```

The nginx `location /api/watch/` block disables buffering so the live
collaboration SSE stream flushes immediately.

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

1. Provision a Linux host and install Caddy, nginx, certbot and Python 3
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

5. Install the nginx site and obtain the certificate (run certbot *before*
   `nginx -t`, since the HTTPS block references the cert):

   ```bash
   cp nginx-roomcad.conf /etc/nginx/sites-available/roomcad.conf
   ln -s /etc/nginx/sites-available/roomcad.conf /etc/nginx/sites-enabled/roomcad.conf
   nginx -t && systemctl reload nginx
   certbot certonly --webroot -w /var/minecraftai/web/site/public \
     -d roomcad.91.99.176.243.nip.io --key-type ecdsa --agree-tos --non-interactive
   nginx -t && systemctl reload nginx
   ```

## Deploying

Run `./deploy.sh` from this directory (uses your SSH key). It packages the web
app + API, uploads them to the VPS, installs the service/Caddy/nginx config,
and restarts the services. It never touches `rooms.db` or `roomcad.env`, so live
data and the password are preserved.

## HTTP/3 (QUIC)

Caddy 2.6+ serves HTTP/3 automatically for every TLS site (no extra directive
needed), so the production `:8443` site already accepts HTTP/3 over **UDP 8443**
(and standard UDP 443 where available) in addition to HTTP/1.1 + HTTP/2 over
TCP. Just make sure the firewall allows UDP on the TLS port.
