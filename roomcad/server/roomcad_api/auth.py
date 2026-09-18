"""The shared password, the login throttle, presence and browser sessions.

Configuration and locks are read from `state` at call time — see state.py.
`session_hash` lives in db.py, next to the session rows it hashes for; it is
re-exported here so the session functions remain callable as a group.
"""

import secrets
import time

from . import state
from .db import get_conn, session_hash


def active_count(ttl=30):
    """Number of session tokens seen within the last `ttl` seconds."""
    now = time.time()
    with state.PRESENCE_LOCK:
        stale = [t for t, seen in state.PRESENCE.items() if now - seen > ttl]
        for t in stale:
            del state.PRESENCE[t]
        return len(state.PRESENCE)


def password_matches(candidate):
    """Constant-time password check that also survives non-ASCII input.

    `secrets.compare_digest` raises TypeError when either str holds a non-ASCII
    character. Comparing the UTF-8 *bytes* instead makes a non-ASCII password
    work correctly rather than merely not crashing — and, because the caller
    counts every False as a failure, it keeps those attempts inside the login
    throttle. Before this, one accented character from an unauthenticated client
    killed the handler before `note_login_failure` ran, so the attempt was never
    counted and the connection was dropped with no response at all.
    """
    if not state.PASSWORD:
        return False
    try:
        return secrets.compare_digest(
            str(candidate).encode("utf-8"), state.PASSWORD.encode("utf-8")
        )
    except Exception:
        return False


def login_blocked(key):
    """True once a client has burned through its failed-login budget."""
    now = time.time()
    with state.LOGIN_LOCK:
        entry = state.LOGIN_FAILURES.get(key)
        if not entry:
            return False
        failures, started = entry
        if now - started > state.LOGIN_WINDOW_SECONDS:
            del state.LOGIN_FAILURES[key]
            return False
        return failures >= state.LOGIN_MAX_FAILURES


def note_login_failure(key):
    now = time.time()
    with state.LOGIN_LOCK:
        # Opportunistically forget windows that have aged out, so a long-lived
        # process does not accumulate an entry per address seen.
        for k in [
            k
            for k, (_, started) in state.LOGIN_FAILURES.items()
            if now - started > state.LOGIN_WINDOW_SECONDS
        ]:
            del state.LOGIN_FAILURES[k]
        failures, started = state.LOGIN_FAILURES.get(key, (0, now))
        state.LOGIN_FAILURES[key] = (failures + 1, started)


def note_login_success(key):
    with state.LOGIN_LOCK:
        state.LOGIN_FAILURES.pop(key, None)


def create_session(token):
    now = int(time.time())
    conn = get_conn()
    with state.DB_LOCK:
        conn.execute("DELETE FROM browser_sessions WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO browser_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
            (session_hash(token), now, now + state.SESSION_TTL_SECONDS),
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
    with state.DB_LOCK:
        conn.execute("DELETE FROM browser_sessions WHERE token_hash=?", (session_hash(token),))
        conn.commit()
    with state.PRESENCE_LOCK:
        state.PRESENCE.pop(token, None)


def session_is_valid(token):
    if not token:
        return False
    conn = get_conn()
    with state.DB_LOCK:
        row = conn.execute(
            "SELECT 1 FROM browser_sessions WHERE token_hash=? AND expires_at >= ?",
            (session_hash(token), int(time.time())),
        ).fetchone()
    return row is not None
