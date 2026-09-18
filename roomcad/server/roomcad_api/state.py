"""Configuration and mutable state for the RoomCAD API.

Everything the server reads as configuration lives HERE and is read as
`state.NAME` at call time. Nothing else in this package may import one of
these names by value, and nothing may read one at import time: a test or a
caller rebinds the name on THIS module, so a copy taken elsewhere would keep
the old value and the rebind would be a silent no-op. The one that must never
miss is `DB_PATH` — a missed rebind points the server at the production
database.
"""

import os
import threading

DB_PATH = os.environ.get("ROOMCAD_DB_PATH", "/var/roomcad/rooms.db")
LEGACY_DIR = os.environ.get(
    "ROOMCAD_LEGACY_DIR", "/var/roomcad/rooms"
)  # old .rcad files, migrated once
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
MAX_CHUNK_LINE = 65536  # longest chunk-size or trailer line accepted
MAX_BODY_BYTES = 8 * 1024 * 1024

# Failed-login throttle. One shared password is brute-forceable otherwise.
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_SECONDS = 300
LOGIN_FAILURES = {}  # client key -> [failures, window_started_at]
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
# Every live stream pins a server thread, a socket and a queue holding up to
# WATCH_QUEUE_LIMIT whole-room snapshots, and ThreadingHTTPServer opens one for
# every connection a client cares to make — so with no ceiling at all, one
# authenticated client looping on /api/watch can pin threads until the process
# dies and take everybody else with it. Two caps, because they stop two
# different failures.
#
# MAX_WATCHERS_TOTAL bounds the process, and that is the one that has to hold:
# 256 streams at the worst-case queue is a known, survivable figure instead of
# an unbounded one, and it is far above the handful of people who share one
# password.
#
# MAX_WATCHERS_PER_SESSION stops one client from being the client that reaches
# that total. A global cap on its own is a race the noisiest client wins —
# everyone else is refused while it holds the pool — and a per-session cap on
# its own still lets many clients add up past what the process can hold, which
# is why both exist. One stream is one open tab, so 16 covers someone with a
# room-per-tab plus the overlap of a stream that is reconnecting before the
# dead socket is noticed, while keeping one session's share small enough that
# it cannot starve the others. Lower would mistake a heavy multi-tab user for
# an attack; higher would not stop one client claiming a large slice.
MAX_WATCHERS_TOTAL = 256
MAX_WATCHERS_PER_SESSION = 16
# An unsaved draft nobody has touched for this long is forgotten.
LIVE_DRAFT_TTL_SECONDS = 3600
# Active browser sessions: session token -> last-seen time. Any authenticated
# request refreshes it, so /api/status can report how many people are around.
PRESENCE = {}
PRESENCE_LOCK = threading.Lock()

WATCHERS = {}
# Which session opened each registered queue, so the per-session cap can be
# counted and a stream that ends can free exactly its own slot. Keyed by the
# queue rather than by a counter per session on purpose: `pop` in the finally
# block is idempotent, so a stream that somehow ends twice cannot drive a
# counter negative or hand a slot to the wrong session.
WATCHER_SESSIONS = {}
WATCH_LOCK = threading.Lock()
# Latest unsaved "live" draft per room (in-memory only; lost on restart, which
# is fine — they are drafts). A new watcher receives this on connect so it
# joins mid-edit in sync with everyone else.
LIVE = {}
# How many times the shared state of a room has moved on, counted per room and
# handed out with every copy of it. A client publishes the number its edit was
# built on; anything built on an older one is refused rather than applied,
# because a client that is behind would otherwise republish its stale copy and
# silently destroy everyone else's newer work. Survives a draft being saved and
# cleared, so drafts based on the pre-save state are stale too.
LIVE_SEQ = {}
LIVE_LOCK = threading.Lock()
DB_LOCK = threading.Lock()
_conn = None
_CONN_LOCK = threading.Lock()

# A room name goes into the database and into every listing, so it is bounded
# here rather than trusting the client to have done it. The web app slugs to 48;
# this is the backstop for anything else that talks to the API.
MAX_ROOM_NAME = 64
