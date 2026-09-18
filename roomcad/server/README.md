# RoomCAD server

Everything needed to run the RoomCAD backend on the VPS, and to rebuild it
from scratch if the VPS is ever lost. The web app itself lives in
[`../web`](../web); this directory mirrors the production server.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | the runnable entry point for the API: Python (stdlib), SQLite-backed save + live-collaboration. It re-exports the implementation from `roomcad_api/` |
| `roomcad_api/` | the API implementation as a package. `state.py` holds every configuration value and mutable global (and is where a caller or test must rebind them); `db.py`, `auth.py` and `live.py` hold storage, authentication and live drafts; `http.py` and `app.py` hold the HTTP handler and server |
| `roomcad.service` | systemd unit that runs `server.py` on `127.0.0.1:8078`, as the unprivileged `roomcadapp` user in a systemd sandbox |
| `Caddyfile` | RoomCAD's **own** Caddy config — serves the web app and proxies `/api/*` to the API. It does **not** terminate TLS: it listens on plain HTTP on loopback, and the host's master Caddy owns 80/443 |
| `roomcad-caddy.service` | systemd unit for RoomCAD's own Caddy instance, under its own user |
| `roomcad.caddy` | RoomCAD's route in the host's master server — the one file it installs outside `/var/roomcad` |
| `install-caddy.sh` | installs the latest **official** Caddy release as a project's own binary |
| `schema.sql` | SQLite schema (versioned rooms plus hashed browser session records); documentation — `server.py` creates the schema itself at boot |
| `rooms.db.sql` | the database **structure**, restorable into an empty file. Structure only: it carries no room content |
| `deploy.sh` | one-command deploy of the web app + API to the VPS |

## Server layout on the VPS

```
/var/roomcad/
  server.py        # the API entry point
  roomcad_api/     # the API implementation (state.py holds the configuration)
  rooms.db         # SQLite database (WAL mode)
  web/             # static web app
  rooms/           # legacy .rcad files (migrated once, now empty)

/etc/systemd/system/roomcad.service        # the Python API
/etc/systemd/system/roomcad-caddy.service  # RoomCAD's own web server

/var/roomcad/bin/caddy        # its own copy of the binary
/var/roomcad/caddy/Caddyfile  # its own config
/var/roomcad/caddy/data       # its own storage
/var/caddy/projects/roomcad.caddy   # its route in the master (the only file
                                    # it installs outside /var/roomcad)
```

The API listens on `127.0.0.1:8078`; Caddy reverse-proxies `/api/*` to it and
serves `web/` as static files.

## HTTPS, and one web server per project

The entry point is **https://roomcad.91.99.176.243.nip.io/**. The request path is:

```
client ──443──> master Caddy (/var/caddy) ──loopback──> roomcad-caddy ──> API
                owns 80 and 443                        127.0.0.1:8081     :8078
                terminates TLS, routes hostnames
```

The **master** owns ports 80 and 443 for the whole host. Because it owns port 80
it answers the ACME challenge itself, so certificates are obtained and renewed
automatically: no certbot, no store to borrow from, no hook to copy anything.

**RoomCAD's own Caddy** — its own binary in `/var/roomcad/bin`, its own config,
storage, unix user (`roomcadweb`) and unit — listens on plain HTTP on loopback
and does no TLS. It serves `web/` and forwards `/api/*` to the Python API.
Binding loopback means nothing can reach the app around the TLS hop.

Each project owns **exactly one file** in `/var/caddy/projects/`, and nothing
else there. `roomcad.caddy` is RoomCAD's, installed by its deploy, and is the
only thing the deploy writes outside `/var/roomcad`.

Two details that are easy to get wrong and silent when you do:

* The backend's site block is `:8081` with `bind 127.0.0.1`, **not**
  `127.0.0.1:8081`. The master forwards the client's real `Host`, so a block
  keyed on an address matches nothing, and Caddy answers a bare empty 200 — a
  success status with no body and no error logged anywhere.
* The backend passes `X-Forwarded-Proto` through unchanged. Caddy normally sets
  that header from the connection *it* received, which here is plain HTTP over
  loopback — so left alone the API would decide the request was insecure and
  drop the `Secure` flag from the session cookie.

There are two proxies in front of the API now, so `ROOMCAD_PROXY_HOPS=1`: the
real client address is one entry further from the end of `X-Forwarded-For`.
Left at zero, every request throttles as `127.0.0.1`.

Port **8443** still answers — the master serves it as well, so links handed out
while RoomCAD terminated TLS on that port keep working.

### How this came to be

Worth keeping, because each step was a real outage or near-miss:

* One system-wide `/etc/caddy/Caddyfile` held several projects' real configs,
  and RoomCAD's deploy installed that whole file — so every release overwrote
  the others'.
* `/etc/nginx` and `/etc/letsencrypt` were symlinks into a third project's tree.
  When it was restructured both dangled: the certificate hook could not be
  installed, and a deploy that stops on the first error began giving up halfway,
  after syncing files but before reloading or checking anything.
* nginx then held 80 and 443 while its own config was gone and `nginx -t`
  failed, so it could not be restarted and no ACME challenge could be answered.
  It was stopped; its last known state is in `/root/nginx-last-known-state.txt`.

Each project now runs its own web server on loopback, behind one master that
owns TLS and routing. `install-caddy.sh` gives each of them its own copy of the
official Caddy release rather than sharing the distribution's binary, which
upgrades for everyone at once and is noticed by nobody until a restart.

`flush_interval -1` on the API proxy keeps the live-collaboration SSE stream
unbuffered.

### HTTP/3 (QUIC)

TLS and QUIC belong to the **master** Caddy. It terminates TLS, advertises
`Alt-Svc` and answers on port 8443 as well as 443. RoomCAD's own instance is
plain HTTP on loopback with `auto_https off` — it has no TLS listener at all, so
nothing in this directory enables or disables HTTP/3.

The rest of this section is about judging whether QUIC actually works, which is
worth keeping because it is very easy to measure wrongly.

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

### Two more lines behind the cookie

The cookie is `HttpOnly; SameSite=Lax`, which already stops it riding a
cross-site `POST`. On top of that, `POST` and `DELETE` must be **same-origin**:
an `Origin` header, or a `Referer` standing in for one, must name the host the
request was actually made to, or the API answers 403. A request carrying
neither header is allowed — `curl`, the test suite and a plain same-origin form
post send none, and a browser making a cross-site `POST` always sends `Origin`.
The check covers `/api/login` deliberately: a cross-site login can force a
session onto a visitor and spend the login throttle.

Live collaboration streams over SSE (`GET /api/watch/<name>`), and each stream
pins a thread, a socket and a queue, so the number of them is bounded:
`MAX_WATCHERS_TOTAL` (256) protects the process, and `MAX_WATCHERS_PER_SESSION`
(16) stops one client claiming the whole pool and starving everyone else. A
refused stream gets a clean `503` with the usual JSON error envelope, before the
SSE headers are written, and registers nothing. `request_queue_size` is raised
from socketserver's default of 5, which is smaller than one browser opening a
stream per tab can produce.

## Restoring from a lost VPS

1. Provision a Linux host with Python 3 (standard library only) and the host's
   **master Caddy** (`/var/caddy`), which owns ports 80 and 443, terminates TLS
   and routes hostnames. RoomCAD then installs its **own** copy of the Caddy
   binary with `install-caddy.sh`.
2. Restore this directory:

   ```bash
   mkdir -p /var/roomcad/web
   cp server.py /var/roomcad/server.py
   chmod 755 /var/roomcad/server.py
   cp -R roomcad_api /var/roomcad/roomcad_api
   chmod -R u+rwX,go+rX /var/roomcad/roomcad_api
   ```

   The service runs as `roomcadapp`, so the package must be readable by it even
   though root owns it — `go+rX` is what makes the directory traversable and
   the modules readable.

3. Restore the database **structure** from the dump:

   ```bash
   sqlite3 /var/roomcad/rooms.db < rooms.db.sql
   ```

   `rooms.db.sql` is structure only — it deliberately carries no room content,
   because a public repository is the wrong place for real designs. Restore the
   rooms themselves from a server-side backup of `rooms.db` if you have one; a
   fresh install simply starts empty.

4. Install the service, its account, the Caddy config and the password env file:

   ```bash
   cp roomcad.service /etc/systemd/system/roomcad.service
   cp roomcad-caddy.service /etc/systemd/system/roomcad-caddy.service
   cp Caddyfile /var/roomcad/caddy/Caddyfile
   chown root:roomcadweb /var/roomcad/caddy/Caddyfile
   chmod 640 /var/roomcad/caddy/Caddyfile

   # The API runs as an unprivileged user with a read-only filesystem apart
   # from /var/roomcad. It must own the database, the WAL sidecars SQLite
   # keeps beside it, and the directory they live in; the legacy .rcad
   # directory too, because the one-shot migration deletes what it imports.
   useradd --system --no-create-home --shell /usr/sbin/nologin roomcadapp
   install -d -o roomcadapp -g roomcadapp -m 755 /var/roomcad
   chown roomcadapp:roomcadapp /var/roomcad/rooms.db
   [ -d /var/roomcad/rooms ] && chown -R roomcadapp:roomcadapp /var/roomcad/rooms

   printf 'ROOMCAD_PASSWORD=your-password\n' > /var/roomcad/roomcad.env
   chmod 600 /var/roomcad/roomcad.env
   systemctl daemon-reload
   systemctl enable --now roomcad roomcad-caddy
   systemctl reload caddy
   ```

5. Nothing else. The **master** Caddy owns port 80, so it answers the ACME
   challenge itself and obtains and renews the certificate for this hostname:
   there is no certbot, no certificate for RoomCAD to keep, and no copy to
   refresh. Install RoomCAD's route into the master (`roomcad.caddy`, one file
   in `/var/caddy/projects/`) and validate the master's whole config before
   reloading it — `deploy.sh` does both. RoomCAD is then at
   **https://roomcad.91.99.176.243.nip.io/**.

   Port **8443** is also answered by the master, because links were handed out
   while RoomCAD terminated TLS there itself.

## Deploying

Run `./deploy.sh` from this directory (uses your SSH key). It synchronizes the
web app with deletion enabled, uploads the API entry point and its
`roomcad_api/` package, installs the service units, the
Caddy config and RoomCAD's route in the master, ensures the `roomcadapp` account
and its file ownership, and restarts the services. It never rewrites
`rooms.db` **contents** or `roomcad.env`, so live data and the password are
preserved.
