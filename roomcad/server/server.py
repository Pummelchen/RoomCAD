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
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("ROOMCAD_DB_PATH", "/var/roomcad/rooms.db")
LEGACY_DIR = os.environ.get("ROOMCAD_LEGACY_DIR", "/var/roomcad/rooms")  # old .rcad files, migrated once
PREFIX = "ternak_room"
HOST = "127.0.0.1"
PORT = 8078

# Shared password + login sessions. The password is injected via the
# ROOMCAD_PASSWORD environment variable (see roomcad.service); it is never
# stored in this file so it stays out of the public repo. Logging in sets the
# one existing HttpOnly session cookie. Its hashed token and the last design
# selected by that browser are kept in SQLite, so both survive an API restart.
PASSWORD = os.environ.get("ROOMCAD_PASSWORD")
SESSION_COOKIE = "roomcad_auth"
SESSION_TTL_SECONDS = 31536000
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
            ORDER BY r.name
        """).fetchall()
    return [{"name": r["name"], "version": r["version"], "savedAt": r["saved_at"]} for r in rows]


def sanitize(name):
    return re.sub(r"[^A-Za-z0-9_-]", "", name)


def active_count(ttl=30):
    """Number of session tokens seen within the last `ttl` seconds."""
    now = time.time()
    with PRESENCE_LOCK:
        stale = [t for t, seen in PRESENCE.items() if now - seen > ttl]
        for t in stale:
            del PRESENCE[t]
        return len(PRESENCE)


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
    """Return the exact saved room/version selected by this browser, if any."""
    conn = get_conn()
    with DB_LOCK:
        row = conn.execute(
            "SELECT last_room_name, last_room_version FROM browser_sessions WHERE token_hash=?",
            (session_hash(token),),
        ).fetchone()
        if not row or not row["last_room_name"] or row["last_room_version"] is None:
            return None
        room = conn.execute(
            "SELECT name, version, json FROM rooms WHERE name=? AND version=?",
            (row["last_room_name"], row["last_room_version"]),
        ).fetchone()
        if room is None:
            conn.execute(
                "UPDATE browser_sessions SET last_room_name=NULL, last_room_version=NULL WHERE token_hash=?",
                (session_hash(token),),
            )
            conn.commit()
            return None
    return {"name": room["name"], "version": room["version"], "json": room["json"]}


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
        row = conn.execute("SELECT COALESCE(MAX(version), 0) AS v FROM rooms WHERE name=?", (name,)).fetchone()
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
    conn = get_conn()
    with DB_LOCK:
        cur = conn.execute("DELETE FROM rooms WHERE name=?", (name,))
        conn.execute(
            "UPDATE browser_sessions SET last_room_name=NULL, last_room_version=NULL WHERE last_room_name=?",
            (name,),
        )
        conn.commit()
    return cur.rowcount > 0


def versions(name):
    conn = get_conn()
    with DB_LOCK:
        rows = conn.execute(
            "SELECT version, saved_at FROM rooms WHERE name=? ORDER BY version DESC",
            (name,),
        ).fetchall()
    return [{"version": r["version"], "savedAt": r["saved_at"]} for r in rows]


def notify(name, room_json, client_id, version):
    payload = json.dumps({"name": name, "json": room_json, "clientId": client_id, "version": version})
    with WATCH_LOCK:
        queues = list(WATCHERS.get(name, set()))
    for q in queues:
        q.put(payload)


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
        q.put(payload)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, obj, code=200):
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
        q = queue.Queue()
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
                payload = q.get()
                try:
                    self._sse_write(payload)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
        finally:
            with WATCH_LOCK:
                WATCHERS.get(name, set()).discard(q)

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
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                password = str(data.get("password", ""))
            except Exception:
                self._send({"error": "bad request"}, 400)
                return
            if not secrets.compare_digest(password, PASSWORD):
                self._send({"error": "wrong password"}, 401)
                return
            token = secrets.token_urlsafe(32)
            create_session(token)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "11")  # {"ok": true}
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Set-Cookie",
                "%s=%s; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000" % (SESSION_COOKIE, token),
            )
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return
        if not self._require_auth():
            return
        if path == "/api/session/last":
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                name = sanitize(data.get("name") or "")
                version = data.get("version")
                if not name or not isinstance(version, int) or version < 1:
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
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                room_json = str(data.get("json", ""))
                client_id = str(data.get("clientId", ""))
                version = data.get("version")
            except Exception:
                self._send({"error": "bad request"}, 400)
                return
            draft = {"json": room_json, "clientId": client_id, "version": version}
            with LIVE_LOCK:
                LIVE[name] = draft
            notify_live(name, draft)
            self._send({"ok": True})
            return
        if path != "/api/save":
            self._send({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
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


if __name__ == "__main__":
    if not PASSWORD:
        print("WARNING: ROOMCAD_PASSWORD is not set — logins are disabled.", flush=True)
    get_conn()  # create DB + migrate on boot
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
