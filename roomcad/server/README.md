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
| `schema.sql` | SQLite schema (the `rooms` table + index) |
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
```

The API listens on `127.0.0.1:8078`; Caddy reverse-proxies `/api/*` to it and
serves `web/` as static files.

## Restoring from a lost VPS

1. Provision a Linux host and install Caddy and Python 3 (stdlib only).
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

4. Install the service and Caddy config:

   ```bash
   cp roomcad.service /etc/systemd/system/roomcad.service
   cp Caddyfile /etc/caddy/Caddyfile
   chown root:caddy /etc/caddy/Caddyfile
   chmod 644 /etc/caddy/Caddyfile
   systemctl daemon-reload
   systemctl enable --now roomcad
   systemctl reload caddy
   ```

## Deploying

Run `./deploy.sh` from this directory (uses your SSH key). It packages the web
app + API, uploads them to the VPS, installs the service/Caddy config, and
restarts both services. It never touches `rooms.db`, so live data is preserved.

## HTTP/3 (QUIC)

Caddy 2.6+ serves HTTP/3 automatically for every TLS site, and the production
`Caddyfile` makes that explicit with `protocols h1 h2 h3` on the `:8443` site.
Caddy therefore accepts HTTP/3 over **UDP 8443** (and standard UDP 443 where
available) in addition to HTTP/1.1 + HTTP/2 over TCP. No extra module is
needed — just make sure the firewall allows UDP on the TLS port.

