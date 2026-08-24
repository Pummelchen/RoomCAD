#!/usr/bin/env python3
"""RoomCAD V2 save + live-collaboration API (SQLite-backed).

Rooms are stored in a SQLite database (WAL mode) instead of .rcad files, and
every save is kept as a new version. Also streams live updates to anyone
watching a room (Server-Sent Events). Runs behind Caddy via a reverse proxy
on /api/* (127.0.0.1:8078).
"""
import hashlib
import json
import os
import queue
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("ROOMCAD_DB_PATH", "/var/roomcad/rooms.db")
LEGACY_DIR = os.environ.get("ROOMCAD_LEGACY_DIR", "/var/roomcad/rooms")  # old .rcad files, migrated once
PREFIX = "ternak_room"
HOST = "127.0.0.1"
# Overridable so a test can run a throwaway server beside the real one.
PORT = int(os.environ.get("ROOMCAD_PORT", "8078"))

# Shared password + login sessions. The password is injected via the
# ROOMCAD_PASSWORD environment variable (see roomcad.service); it is never
# stored in this file so it stays out of the public repo. Logging in sets the
# one existing HttpOnly session cookie. Its hashed token and the last design
# selected by that browser are kept in SQLite, so both survive an API restart.
PASSWORD = os.environ.get("ROOMCAD_PASSWORD")
SESSION_COOKIE = "roomcad_auth"
SESSION_TTL_SECONDS = 31536000

# A request body is read into memory, so it has to be bounded: without this a
# client could announce a huge Content-Length and exhaust the process. Rooms
# are JSON documents of a few hundred kB at most.
MAX_CHUNK_LINE = 65536      # longest chunk-size or trailer line accepted
MAX_BODY_BYTES = 8 * 1024 * 1024

# Failed-login throttle. One shared password is brute-forceable otherwise.
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_SECONDS = 300
LOGIN_FAILURES = {}          # client key -> [failures, window_started_at]
LOGIN_LOCK = threading.Lock()

# How many entries at the END of X-Forwarded-For were appended by our own
# proxies and must be skipped to reach the real client. In the reference
# deployment the chain is client -> nginx -> Caddy -> here: nginx appends the
# client's address and Caddy forwards that list unchanged, so the real
# client is the last entry. Counting from the right is un-spoofable: a client
# can prepend anything it likes to the header, but it cannot control what our
# own proxies append.
PROXY_HOPS = int(os.environ.get("ROOMCAD_PROXY_HOPS", "0"))

# A watcher that stops reading must not be able to grow its queue without
# bound. Payloads are whole-room snapshots and the newest one supersedes the
# rest, so dropping the oldest is the correct overflow behaviour.
WATCH_QUEUE_LIMIT = 16
# How long a watcher waits before sending a keep-alive comment. This is also
# what lets the server notice a client that vanished: the write fails and the
# thread exits instead of parking on an empty queue forever.
SSE_HEARTBEAT_SECONDS = 20
# An unsaved draft nobody has touched for this long is forgotten.
LIVE_DRAFT_TTL_SECONDS = 3600
# Active browser sessions: session token -> last-seen time. Any authenticated
# request refreshes it, so /api/status can report how many people are around.
PRESENCE = {}
PRESENCE_LOCK = threading.Lock()

WATCHERS = {}
WATCH_LOCK = threading.Lock()
# Latest unsaved "live" draft per room (in-memory only; lost on restart, which
# is fine — they are drafts). A new watcher receives this on connect so it
# joins mid-edit in sync with everyone else.
LIVE = {}
LIVE_LOCK = threading.Lock()
DB_LOCK = threading.Lock()
_conn = None


def get_conn():
    global _conn
    if _conn is None:
        # check_same_thread=False is safe here: every DB call is serialized
        # by DB_LOCK, so the single connection is never used concurrently.
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.execute("PRAGMA busy_timeout=5000")
        init_db(_conn)
    return _conn


def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version INTEGER NOT NULL,
            json TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            client_id TEXT,
            UNIQUE(name, version)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms(name)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS browser_sessions (
            token_hash TEXT PRIMARY KEY,
            last_room_name TEXT,
            last_room_version INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_browser_sessions_expiry ON browser_sessions(expires_at)")
    conn.commit()
    migrate(conn)


def migrate(conn):
    """Move legacy .rcad files into the database (as version 1) and remove them."""
    if not os.path.isdir(LEGACY_DIR):
        return
    for fname in sorted(os.listdir(LEGACY_DIR)):
        if not fname.endswith(".rcad"):
            continue
        name = fname[:-5]
        path = os.path.join(LEGACY_DIR, fname)
        exists = conn.execute("SELECT 1 FROM rooms WHERE name=? LIMIT 1", (name,)).fetchone()
        if not exists:
            with open(path, encoding="utf-8") as f:
                json_text = f.read()
            conn.execute(
                "INSERT INTO rooms (name, version, json, saved_at, client_id) VALUES (?, 1, ?, ?, ?)",
                (name, json_text, int(os.path.getmtime(path) * 1000), ""),
            )
        os.remove(path)
    conn.commit()


def room_list():
    conn = get_conn()
    with DB_LOCK:
        rows = conn.execute("""
            SELECT r.name, r.version, r.saved_at
            FROM rooms r
            JOIN (SELECT name, MAX(version) AS mv FROM rooms GROUP BY name) m
              ON r.name = m.name AND r.version = m.mv
            ORDER BY r.saved_at DESC, r.name
        """).fetchall()
    return [{"name": r["name"], "version": r["version"], "savedAt": r["saved_at"]} for r in rows]


# A room name goes into the database and into every listing, so it is bounded
# here rather than trusting the client to have done it. The web app slugs to 48;
# this is the backstop for anything else that talks to the API.
MAX_ROOM_NAME = 64


def sanitize(name):
    return re.sub(r"[^A-Za-z0-9_-]", "", name)[:MAX_ROOM_NAME]


def active_count(ttl=30):
    """Number of session tokens seen within the last `ttl` seconds."""
    now = time.time()
    with PRESENCE_LOCK:
        stale = [t for t, seen in PRESENCE.items() if now - seen > ttl]
        for t in stale:
            del PRESENCE[t]
        return len(PRESENCE)


def login_blocked(key):
    """True once a client has burned through its failed-login budget."""
    now = time.time()
    with LOGIN_LOCK:
        entry = LOGIN_FAILURES.get(key)
        if not entry:
            return False
        failures, started = entry
        if now - started > LOGIN_WINDOW_SECONDS:
            del LOGIN_FAILURES[key]
            return False
        return failures >= LOGIN_MAX_FAILURES


def note_login_failure(key):
    now = time.time()
    with LOGIN_LOCK:
        # Opportunistically forget windows that have aged out, so a long-lived
        # process does not accumulate an entry per address seen.
        for k in [k for k, (_, started) in LOGIN_FAILURES.items()
                  if now - started > LOGIN_WINDOW_SECONDS]:
            del LOGIN_FAILURES[k]
        failures, started = LOGIN_FAILURES.get(key, (0, now))
        LOGIN_FAILURES[key] = (failures + 1, started)


def note_login_success(key):
    with LOGIN_LOCK:
        LOGIN_FAILURES.pop(key, None)


def session_hash(token):
    """Never store the browser's bearer token itself in SQLite."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(token):
    now = int(time.time())
    conn = get_conn()
    with DB_LOCK:
        conn.execute("DELETE FROM browser_sessions WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO browser_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
            (session_hash(token), now, now + SESSION_TTL_SECONDS),
        )
        conn.commit()


def destroy_session(token):
    """Ends one browser session.

    Without this a login could not be undone: the cookie lasts a year and
    nothing on the server or in the UI could end it early, so signing in on a
    borrowed machine meant leaving it signed in.
    """
    if not token:
        return
    conn = get_conn()
    with DB_LOCK:
        conn.execute("DELETE FROM browser_sessions WHERE token_hash=?", (session_hash(token),))
        conn.commit()
    with PRESENCE_LOCK:
        PRESENCE.pop(token, None)


def session_is_valid(token):
    if not token:
        return False
    conn = get_conn()
    with DB_LOCK:
        row = conn.execute(
            "SELECT 1 FROM browser_sessions WHERE token_hash=? AND expires_at >= ?",
            (session_hash(token), int(time.time())),
        ).fetchone()
    return row is not None


def remember_last_room(token, name, version):
    """Associate one exact saved design version with the current browser."""
    conn = get_conn()
    with DB_LOCK:
        exists = conn.execute(
            "SELECT 1 FROM rooms WHERE name=? AND version=?", (name, version)
        ).fetchone()
        if not exists:
            return False
        cur = conn.execute(
            "UPDATE browser_sessions SET last_room_name=?, last_room_version=? WHERE token_hash=?",
            (name, version, session_hash(token)),
        )
        conn.commit()
    return cur.rowcount == 1


def last_room_for_session(token):
    """Return this browser's room, or the project's latest saved room on first use."""
    conn = get_conn()
    with DB_LOCK:
        row = conn.execute(
            "SELECT last_room_name, last_room_version FROM browser_sessions WHERE token_hash=?",
            (session_hash(token),),
        ).fetchone()
        room = None
        if row and row["last_room_name"] and row["last_room_version"] is not None:
            room = conn.execute(
                "SELECT name, version, json FROM rooms WHERE name=? AND version=?",
                (row["last_room_name"], row["last_room_version"]),
            ).fetchone()
        if room is not None:
            return {"name": room["name"], "version": room["version"], "json": room["json"]}

        # A password identifies one shared RoomCAD project. A new browser has
        # no personal selection yet, so start it at the newest saved project
        # file/version instead of an empty demo. `id` breaks rare equal-ms ties.
        room = conn.execute("""
            SELECT name, version, json
            FROM rooms
            ORDER BY saved_at DESC, id DESC
            LIMIT 1
        """).fetchone()
        if room is None:
            return None
        conn.execute(
            "UPDATE browser_sessions SET last_room_name=?, last_room_version=? WHERE token_hash=?",
            (room["name"], room["version"], session_hash(token)),
        )
        conn.commit()
    return {
        "name": room["name"],
        "version": room["version"],
        "json": room["json"],
        "projectLatest": True,
    }


def save_room(name, room_json, client_id):
    """Inserts a new version. An empty `name` picks the next ternak_roomN
    atomically inside the same lock as the insert, so two simultaneous saves
    can never collide on the same new-room name."""
    conn = get_conn()
    with DB_LOCK:
        if not name:
            rows = conn.execute("SELECT DISTINCT name FROM rooms").fetchall()
            nums = []
            for r in rows:
                m = re.fullmatch(re.escape(PREFIX) + r"(\d+)", r["name"])
                if m:
                    nums.append(int(m.group(1)))
            name = f"{PREFIX}{(max(nums) if nums else 0) + 1}"
        # -1 so a file's first save lands on v0: the original, with later saves
        # counting up from it.
        row = conn.execute(
            "SELECT COALESCE(MAX(version), -1) AS v FROM rooms WHERE name=?", (name,)
        ).fetchone()
        version = row["v"] + 1
        conn.execute(
            "INSERT INTO rooms (name, version, json, saved_at, client_id) VALUES (?, ?, ?, ?, ?)",
            (name, version, room_json, int(time.time() * 1000), client_id),
        )
        conn.commit()
    return name, version


def load_room(name, version=None):
    conn = get_conn()
    with DB_LOCK:
        if version is None:
            row = conn.execute(
                "SELECT name, version, json FROM rooms WHERE name=? ORDER BY version DESC LIMIT 1",
                (name,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT name, version, json FROM rooms WHERE name=? AND version=?",
                (name, version),
            ).fetchone()
    if row is None:
        return None
    return {"name": row["name"], "version": row["version"], "json": row["json"]}


def delete_room(name):
    """Removes a room and every version of it.

    One statement covers all versions however many there are, so a file with a
    hundred of them goes in a single transaction rather than a hundred.
    """
    conn = get_conn()
    with DB_LOCK:
        cur = conn.execute("DELETE FROM rooms WHERE name=?", (name,))
        conn.execute(
            "UPDATE browser_sessions SET last_room_name=NULL, last_room_version=NULL WHERE last_room_name=?",
            (name,),
        )
        conn.commit()
    # An unsaved draft is held in memory under the room's name. Left behind, it
    # outlives the file it belonged to and is handed to the next watcher of a
    # room created with the same name — so deleted work reappears in something
    # that has nothing to do with it.
    with LIVE_LOCK:
        LIVE.pop(name, None)
    return cur.rowcount > 0


def versions(name):
    conn = get_conn()
    with DB_LOCK:
        rows = conn.execute(
            "SELECT version, saved_at FROM rooms WHERE name=? ORDER BY version DESC",
            (name,),
        ).fetchall()
    return [{"version": r["version"], "savedAt": r["saved_at"]} for r in rows]


def publish(q, payload):
    """Queue a payload, discarding the oldest if the watcher has fallen behind."""
    try:
        q.put_nowait(payload)
        return
    except queue.Full:
        pass
    try:
        q.get_nowait()
    except queue.Empty:
        pass
    try:
        q.put_nowait(payload)
    except queue.Full:
        pass


def notify(name, room_json, client_id, version):
    payload = json.dumps({"name": name, "json": room_json, "clientId": client_id, "version": version})
    with WATCH_LOCK:
        queues = list(WATCHERS.get(name, set()))
    for q in queues:
        publish(q, payload)


def notify_live(name, draft):
    """Broadcast an unsaved live draft to every watcher of a room."""
    payload = json.dumps({
        "name": name,
        "json": draft["json"],
        "clientId": draft["clientId"],
        "version": draft["version"],
        "live": True,
    })
    with WATCH_LOCK:
        queues = list(WATCHERS.get(name, set()))
    for q in queues:
        publish(q, payload)


def expire_live_drafts():
    """Drop unsaved drafts nobody has updated for a while."""
    cutoff = time.time() - LIVE_DRAFT_TTL_SECONDS
    with LIVE_LOCK:
        for key in [k for k, v in LIVE.items() if v.get("at", 0) < cutoff]:
            del LIVE[key]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def handle_one_request(self):
        # One handler instance serves EVERY request on a keep-alive connection,
        # so per-request state has to be reset here — __init__ runs once per
        # connection, not once per request. Leaving _body_done set from the
        # previous request made _drain() a no-op for the next one, which put
        # that request's body back into the stream. It only showed up behind a
        # proxy, because a proxy is what reuses upstream connections.
        self._body_done = False
        return super().handle_one_request()

    def _body_bytes(self):
        """Reads the request body under either framing.

        Returns (status, data) where status is "ok", "none", "too_large" or
        "bad". http.server does not decode chunked bodies, and a body arrives
        chunked whenever a proxy re-frames it — which is exactly what happens
        in production, where nginx and Caddy sit in front. Handling only
        Content-Length here meant a chunked body was left in the socket
        entirely.
        """
        encoding = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in encoding:
            data = bytearray()
            while True:
                line = self.rfile.readline(MAX_CHUNK_LINE)
                if not line:
                    return ("bad", None)
                try:
                    size = int(line.split(b";", 1)[0].strip(), 16)
                except ValueError:
                    return ("bad", None)
                if size == 0:
                    # Trailing headers, if any, then the blank line that ends them.
                    while True:
                        trailer = self.rfile.readline(MAX_CHUNK_LINE)
                        if not trailer or trailer in (b"\r\n", b"\n"):
                            break
                    return ("ok", bytes(data))
                if len(data) + size > MAX_BODY_BYTES:
                    return ("too_large", None)
                chunk = self.rfile.read(size)
                if len(chunk) != size:
                    return ("bad", None)
                data.extend(chunk)
                self.rfile.read(2)          # the CRLF that closes the chunk
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            return ("bad", None)
        if length <= 0:
            return ("none", b"")
        if length > MAX_BODY_BYTES:
            return ("too_large", None)
        body = self.rfile.read(length)
        if len(body) != length:
            return ("bad", None)
        return ("ok", body)

    def _drain(self):
        """Swallows an unread request body.

        Every early return that answers without reading the body — an unknown
        path, a throttled login, a rejected name — used to leave those bytes in
        the socket. On a keep-alive connection the next request is then parsed
        starting in the middle of the previous body, so a client that merely
        POSTs to the wrong URL breaks its *following* request too. An oversized
        or malformed body is not drained; the connection is closed instead of
        reading megabytes only to discard them.
        """
        if getattr(self, "_body_done", False):
            return
        self._body_done = True
        try:
            status, _ = self._body_bytes()
        except Exception:
            self.close_connection = True
            return
        if status in ("too_large", "bad"):
            self.close_connection = True

    def _send(self, obj, code=200):
        self._drain()
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

    def _cookie(self, name):
        """Reads a cookie value from the request's Cookie header (or None)."""
        header = self.headers.get("Cookie")
        if not header:
            return None
        for part in header.split(";"):
            part = part.strip()
            if part.startswith(name + "="):
                return part[len(name) + 1:]
        return None

    def _client_key(self):
        """Best available client identity for throttling.

        Every request arrives from the proxy, so the socket address is the same
        for everybody and cannot distinguish clients on its own. The real
        address is in X-Forwarded-For, counted from the right past our own
        proxy hops (see PROXY_HOPS). Falls back to whatever is available so a
        directly-exposed server still throttles per connection."""
        xff = self.headers.get("X-Forwarded-For")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            index = len(parts) - 1 - PROXY_HOPS
            if 0 <= index < len(parts):
                return parts[index]
            if parts:
                return parts[0]
        return self.client_address[0]

    def _is_https(self):
        """Whether the request reached the user over HTTPS.

        X-Forwarded-Proto is authoritative when the proxy chain forwards it.
        The host check is a deliberate backstop: the public deployment is
        HTTPS-only, so if a proxy misconfiguration ever swallowed the header
        again the session cookie would still be marked Secure rather than
        silently dropping the protection. Loopback hosts stay insecure so
        plain-HTTP local development keeps working."""
        proto = self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip().lower()
        if proto:
            return proto == "https"
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        return host not in ("localhost", "127.0.0.1", "::1", "")

    def _read_json(self):
        """Reads a bounded JSON body. Sends the error response and returns None
        if the body is missing, oversized or malformed."""
        try:
            status, raw = self._body_bytes()
        except Exception:
            status, raw = "bad", None
        self._body_done = True
        if status == "too_large":
            self.close_connection = True
            self._send({"error": "payload too large"}, 413)
            return None
        if status != "ok" or not raw:
            if status == "bad":
                self.close_connection = True
            self._send({"error": "bad request"}, 400)
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            self._send({"error": "bad request"}, 400)
            return None

    def _require_auth(self):
        token = self._cookie(SESSION_COOKIE)
        if not session_is_valid(token):
            self._send({"error": "unauthorized"}, 401)
            return False
        with PRESENCE_LOCK:
            PRESENCE[token] = time.time()
        return True

    def _sse_write(self, payload):
        self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def _sse(self, name):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = queue.Queue(maxsize=WATCH_QUEUE_LIMIT)
        with WATCH_LOCK:
            WATCHERS.setdefault(name, set()).add(q)
        try:
            cur = load_room(name)
            if cur:
                self._sse_write(json.dumps({"name": name, "json": cur["json"], "clientId": "", "version": cur["version"]}))
            with LIVE_LOCK:
                draft = LIVE.get(name)
            if draft:
                # Join mid-edit: hand over the latest unsaved draft too.
                self._sse_write(json.dumps({
                    "name": name,
                    "json": draft["json"],
                    "clientId": draft["clientId"],
                    "version": draft["version"],
                    "live": True,
                }))
            while True:
                # Waiting with a timeout is what keeps this thread mortal. A
                # blocking get() never returns for a client that disconnected
                # while idle, so the thread and its socket would leak for the
                # life of the process. The periodic comment doubles as the
                # keep-alive that stops proxies dropping a quiet stream.
                try:
                    payload = q.get(timeout=SSE_HEARTBEAT_SECONDS)
                except queue.Empty:
                    payload = None
                try:
                    if payload is None:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                    else:
                        self._sse_write(payload)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
        finally:
            with WATCH_LOCK:
                watchers = WATCHERS.get(name)
                if watchers is not None:
                    watchers.discard(q)
                    if not watchers:
                        del WATCHERS[name]   # do not keep an empty set per room

    def do_GET(self):
        if not self._require_auth():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        if path == "/api/rooms":
            self._send(room_list())
        elif path == "/api/session/last":
            self._send(last_room_for_session(self._cookie(SESSION_COOKIE)))
        elif path == "/api/status":
            self._send({"count": active_count()})
        elif path.startswith("/api/watch/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/watch/"):]))
            if name:
                self._sse(name)
            else:
                self._send({"error": "bad name"}, 400)
        elif path.startswith("/api/versions/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/versions/"):]))
            if name:
                self._send(versions(name))
            else:
                self._send({"error": "bad name"}, 400)
        elif path.startswith("/api/load/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/load/"):]))
            version = None
            if "version" in qs and qs["version"] and qs["version"][0].isdigit():
                version = int(qs["version"][0])
            data = load_room(name, version) if name else None
            if data:
                self._send(data)
            else:
                self._send({"error": "not found"}, 404)
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/login":
            if not PASSWORD:
                self._send({"error": "auth not configured"}, 500)
                return
            client = self._client_key()
            if login_blocked(client):
                self._send({"error": "too many attempts"}, 429)
                return
            data = self._read_json()
            if data is None:
                return
            password = str(data.get("password", "")) if isinstance(data, dict) else ""
            if not secrets.compare_digest(password, PASSWORD):
                note_login_failure(client)
                self._send({"error": "wrong password"}, 401)
                return
            note_login_success(client)
            self._drain()
            token = secrets.token_urlsafe(32)
            create_session(token)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "11")  # {"ok": true}
            self.send_header("Cache-Control", "no-store")
            # Mark the cookie Secure whenever the request actually reached the
            # user over HTTPS. Hard-coding it would break plain-HTTP local
            # development; omitting it would expose the session in production.
            https = self._is_https()
            self.send_header(
                "Set-Cookie",
                "%s=%s; HttpOnly; SameSite=Lax; Path=/; Max-Age=%d%s"
                % (SESSION_COOKIE, token, SESSION_TTL_SECONDS, "; Secure" if https else ""),
            )
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return
        if path == "/api/logout":
            # No auth check on purpose: a session that is already invalid must
            # still be able to clear its cookie rather than being told 401.
            self._drain()
            destroy_session(self._cookie(SESSION_COOKIE))
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "11")  # {"ok": true}
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Set-Cookie",
                "%s=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0%s"
                % (SESSION_COOKIE, "; Secure" if self._is_https() else ""),
            )
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return
        if not self._require_auth():
            return
        if path == "/api/session/last":
            data = self._read_json()
            if data is None:
                return
            try:
                name = sanitize(data.get("name") or "")
                version = data.get("version")
                if not name or not isinstance(version, int) or version < 0:
                    raise ValueError("bad room")
            except Exception:
                self._send({"error": "bad request"}, 400)
                return
            if not remember_last_room(self._cookie(SESSION_COOKIE), name, version):
                self._send({"error": "not found"}, 404)
                return
            self._send({"ok": True})
            return
        if path.startswith("/api/live/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/live/"):]))
            if not name:
                self._send({"error": "bad name"}, 400)
                return
            data = self._read_json()
            if data is None:
                return
            try:
                room_json = str(data.get("json", ""))
                client_id = str(data.get("clientId", ""))
                version = data.get("version")
            except Exception:
                self._send({"error": "bad request"}, 400)
                return
            expire_live_drafts()
            draft = {"json": room_json, "clientId": client_id, "version": version, "at": time.time()}
            with LIVE_LOCK:
                LIVE[name] = draft
            notify_live(name, draft)
            self._send({"ok": True})
            return
        if path != "/api/save":
            self._send({"error": "not found"}, 404)
            return
        data = self._read_json()
        if data is None:
            return
        try:
            room_json = data.get("json", "")
            client_id = str(data.get("clientId", ""))
            name = sanitize(data.get("name") or "")
        except Exception:
            self._send({"error": "bad request"}, 400)
            return
        name, version = save_room(name, room_json, client_id)
        remember_last_room(self._cookie(SESSION_COOKIE), name, version)
        # A real save supersedes any unsaved draft for this room.
        with LIVE_LOCK:
            LIVE.pop(name, None)
        notify(name, room_json, client_id, version)
        self._send({"name": name, "version": version})

    def do_DELETE(self):
        if not self._require_auth():
            return
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/rooms/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/rooms/"):]))
            if name and delete_room(name):
                self._send({"ok": True})
            else:
                self._send({"error": "not found"}, 404)
        else:
            self._send({"error": "not found"}, 404)


class RoomCADServer(ThreadingHTTPServer):
    """Threading server that stays quiet about clients going away.

    A browser closing a tab aborts its event stream, which surfaces as a reset
    or broken pipe. That is entirely normal here — logging a traceback for each
    one would bury real errors in the journal.
    """

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    if not PASSWORD:
        print("WARNING: ROOMCAD_PASSWORD is not set — logins are disabled.", flush=True)
    get_conn()  # create DB + migrate on boot
    RoomCADServer((HOST, PORT), Handler).serve_forever()
