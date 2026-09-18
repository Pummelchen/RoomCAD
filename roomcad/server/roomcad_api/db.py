"""SQLite storage: the connection, the schema and room/session rows.

Configuration and locks are read from `state` at call time — see state.py.
"""

import hashlib
import os
import re
import sqlite3
import time

from . import state


def get_conn():
    if state._conn is None:
        with state._CONN_LOCK:
            # Re-check inside the lock. Two threads can pass the test above
            # together, and without this each built its own connection: one was
            # leaked, and init_db (and the one-shot legacy migration) ran twice.
            if state._conn is None:
                # check_same_thread=False is safe here: every DB call is
                # serialized by DB_LOCK, so the one connection is never used
                # concurrently.
                conn = sqlite3.connect(state.DB_PATH, check_same_thread=False)
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA busy_timeout=5000")
                init_db(conn)
                # Published only once it is fully usable, so another thread
                # can never pick up a half-initialised connection.
                state._conn = conn
    return state._conn


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
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_sessions_expiry ON browser_sessions(expires_at)"
    )
    conn.commit()
    migrate(conn)


def migrate(conn):
    """Move legacy .rcad files into the database (as version 1) and remove them.

    Each file is committed before it is unlinked. Committing once at the end and
    removing as we went meant a crash in between lost the room from BOTH places:
    the INSERT rolled back with the file already gone, and nothing was left to
    recover it from.
    """
    if not os.path.isdir(state.LEGACY_DIR):
        return
    for fname in sorted(os.listdir(state.LEGACY_DIR)):
        if not fname.endswith(".rcad"):
            continue
        name = fname[:-5]
        path = os.path.join(state.LEGACY_DIR, fname)
        exists = conn.execute("SELECT 1 FROM rooms WHERE name=? LIMIT 1", (name,)).fetchone()
        if not exists:
            with open(path, encoding="utf-8") as f:
                json_text = f.read()
            conn.execute(
                "INSERT INTO rooms (name, version, json, saved_at, client_id) VALUES (?, 1, ?, ?, ?)",
                (name, json_text, int(os.path.getmtime(path) * 1000), ""),
            )
            conn.commit()
        # Already in the database (or just committed): the file is now redundant.
        os.remove(path)


def room_list():
    conn = get_conn()
    with state.DB_LOCK:
        rows = conn.execute("""
            SELECT r.name, r.version, r.saved_at
            FROM rooms r
            JOIN (SELECT name, MAX(version) AS mv FROM rooms GROUP BY name) m
              ON r.name = m.name AND r.version = m.mv
            ORDER BY r.saved_at DESC, r.name
        """).fetchall()
    return [{"name": r["name"], "version": r["version"], "savedAt": r["saved_at"]} for r in rows]


def sanitize(name):
    return re.sub(r"[^A-Za-z0-9_-]", "", name)[: state.MAX_ROOM_NAME]


def session_hash(token):
    """Never store the browser's bearer token itself in SQLite."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def remember_last_room(token, name, version):
    """Associate one exact saved design version with the current browser."""
    conn = get_conn()
    with state.DB_LOCK:
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
    with state.DB_LOCK:
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
    with state.DB_LOCK:
        if not name:
            rows = conn.execute("SELECT DISTINCT name FROM rooms").fetchall()
            nums = []
            for r in rows:
                m = re.fullmatch(re.escape(state.PREFIX) + r"(\d+)", r["name"])
                if m:
                    nums.append(int(m.group(1)))
            name = f"{state.PREFIX}{(max(nums) if nums else 0) + 1}"
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
    with state.DB_LOCK:
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
    with state.DB_LOCK:
        cur = conn.execute("DELETE FROM rooms WHERE name=?", (name,))
        conn.execute(
            "UPDATE browser_sessions SET last_room_name=NULL, last_room_version=NULL WHERE last_room_name=?",
            (name,),
        )
        conn.commit()
    # An unsaved draft is held in memory under the room's name. Left behind, it
    # outlives the file it belonged to and is handed to the next watcher of a
    # room created with the same name — so deleted work reappears in something
    # that has nothing to do with it. The sequence counter goes with it: it
    # exists only to order edits to THIS room, and keeping one entry per name
    # ever seen was an unbounded leak in a long-running process.
    with state.LIVE_LOCK:
        state.LIVE.pop(name, None)
        state.LIVE_SEQ.pop(name, None)
    return cur.rowcount > 0


def versions(name):
    conn = get_conn()
    with state.DB_LOCK:
        rows = conn.execute(
            "SELECT version, saved_at FROM rooms WHERE name=? ORDER BY version DESC",
            (name,),
        ).fetchall()
    return [{"version": r["version"], "savedAt": r["saved_at"]} for r in rows]
