"""The HTTP handler: the API routes and who is allowed to call them.

Body framing lives in transport.py, the SSE stream in stream.py, the
same-origin rule in origin.py and storage in db.py.
"""

import secrets
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler

from . import state
from .auth import (
    active_count,
    create_session,
    destroy_session,
    login_blocked,
    note_login_failure,
    note_login_success,
    password_matches,
    session_is_valid,
)
from .db import (
    delete_room,
    last_room_for_session,
    load_room,
    remember_last_room,
    room_list,
    sanitize,
    save_room,
    versions,
)
from .live import digest_of, expire_live_drafts, notify, notify_live
from .origin import OriginMixin
from .stream import StreamMixin
from .transport import TransportMixin


class Handler(OriginMixin, TransportMixin, StreamMixin, BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cookie(self, name):
        """Reads a cookie value from the request's Cookie header (or None)."""
        header = self.headers.get("Cookie")
        if not header:
            return None
        for part in header.split(";"):
            part = part.strip()
            if part.startswith(name + "="):
                return part[len(name) + 1 :]
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
            index = len(parts) - 1 - state.PROXY_HOPS
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

    def _require_auth(self):
        token = self._cookie(state.SESSION_COOKIE)
        if not session_is_valid(token):
            self._send({"error": "unauthorized"}, 401)
            return False
        with state.PRESENCE_LOCK:
            state.PRESENCE[token] = time.time()
        return True

    def do_GET(self):
        if not self._require_auth():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        if path == "/api/rooms":
            self._send(room_list())
        elif path == "/api/session/last":
            self._send(last_room_for_session(self._cookie(state.SESSION_COOKIE)))
        elif path == "/api/status":
            self._send({"count": active_count()})
        elif path.startswith("/api/watch/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/watch/") :]))
            if name:
                self._sse(name)
            else:
                self._send({"error": "bad name"}, 400)
        elif path.startswith("/api/versions/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/versions/") :]))
            if name:
                self._send(versions(name))
            else:
                self._send({"error": "bad name"}, 400)
        elif path.startswith("/api/load/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/load/") :]))
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
        # State-changing, so the same-origin check comes first — and it covers
        # /api/login, deliberately. Login is the one endpoint that works before
        # a session exists, which is exactly why a forced cross-site login is a
        # real attack: it can sign the victim into a session the attacker chose
        # or spend the login budget of the victim's address. The app is served
        # from the same origin as the API, so a legitimate login always passes,
        # and a scripted client that sends no Origin at all is untouched.
        if not self._require_same_origin():
            self._send({"error": "cross-origin request refused"}, 403)
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/login":
            if not state.PASSWORD:
                self._send({"error": "auth not configured"}, 500)
                return
            client = self._client_key()
            if login_blocked(client):
                self._send({"error": "too many attempts"}, 429)
                return
            data = self._read_json_object()
            if data is None:
                return
            password = str(data.get("password", ""))
            if not password_matches(password):
                note_login_failure(client)
                self._send({"error": "wrong password"}, 401)
                return
            note_login_success(client)
            self._drain()
            token = secrets.token_urlsafe(32)
            create_session(token)
            # Mark the cookie Secure whenever the request actually reached the
            # user over HTTPS. Hard-coding it would break plain-HTTP local
            # development; omitting it would expose the session in production.
            https = self._is_https()
            cookie = "%s=%s; HttpOnly; SameSite=Lax; Path=/; Max-Age=%d%s" % (
                state.SESSION_COOKIE,
                token,
                state.SESSION_TTL_SECONDS,
                "; Secure" if https else "",
            )
            self._send({"ok": True}, extra_headers=[("Set-Cookie", cookie)])
            return
        if path == "/api/logout":
            # No auth check on purpose: a session that is already invalid must
            # still be able to clear its cookie rather than being told 401.
            self._drain()
            destroy_session(self._cookie(state.SESSION_COOKIE))
            cookie = "%s=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0%s" % (
                state.SESSION_COOKIE,
                "; Secure" if self._is_https() else "",
            )
            self._send({"ok": True}, extra_headers=[("Set-Cookie", cookie)])
            return
        if not self._require_auth():
            return
        if path == "/api/session/last":
            data = self._read_json_object()
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
            if not remember_last_room(self._cookie(state.SESSION_COOKIE), name, version):
                self._send({"error": "not found"}, 404)
                return
            self._send({"ok": True})
            return
        if path.startswith("/api/live-check/"):
            # "Am I still looking at what everyone else is looking at?"
            #
            # A client publishes its edits and hopes they land. If one is lost —
            # a dropped stream, a reconnect, a client that was asleep — nothing
            # ever corrects it and the two sides quietly diverge for the rest of
            # the session. So every live client asks this every couple of
            # seconds, with a digest rather than the whole room, and is handed
            # the current state back only if it has drifted.
            #
            # This never takes work AWAY from a client: it answers with what the
            # room currently is, and a client only asks when it has nothing
            # unpublished of its own.
            name = sanitize(urllib.parse.unquote(path[len("/api/live-check/") :]))
            if not name:
                self._send({"error": "bad name"}, 400)
                return
            data = self._read_json_object()
            if data is None:
                return
            digest = str(data.get("digest", ""))
            expire_live_drafts()
            with state.LIVE_LOCK:
                draft = state.LIVE.get(name)
            with state.LIVE_LOCK:
                seq = state.LIVE_SEQ.get(name, 0)
            if draft:
                current, version, live = draft["json"], draft["version"], True
            else:
                row = load_room(name)
                if not row:
                    self._send({"error": "not found"}, 404)
                    return
                current, version, live = row["json"], row["version"], False
            if digest_of(current) == digest:
                self._send({"inSync": True, "version": version, "seq": seq})
            else:
                self._send(
                    {"inSync": False, "json": current, "version": version, "seq": seq, "live": live}
                )
            return
        if path.startswith("/api/live/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/live/") :]))
            if not name:
                self._send({"error": "bad name"}, 400)
                return
            data = self._read_json_object()
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
            base = data.get("baseSeq")
            base = base if isinstance(base, int) else 0
            with state.LIVE_LOCK:
                current = state.LIVE_SEQ.get(name, 0)
                if base != current:
                    # This edit was made against a copy of the room that has
                    # since moved on. Publishing it would replace everyone
                    # else's newer work with this client's older picture — the
                    # failure that loses an afternoon of design in one click.
                    # Hand back what the room actually is instead.
                    stale_draft = state.LIVE.get(name)
                    behind = True
                else:
                    behind = False
                    current += 1
                    state.LIVE_SEQ[name] = current
                    draft = {
                        "json": room_json,
                        "clientId": client_id,
                        "version": version,
                        "at": time.time(),
                        "seq": current,
                    }
                    state.LIVE[name] = draft
            if behind:
                if stale_draft:
                    current_json, current_version = stale_draft["json"], stale_draft["version"]
                else:
                    row = load_room(name)
                    if not row:
                        self._send({"error": "not found"}, 404)
                        return
                    current_json, current_version = row["json"], row["version"]
                self._send(
                    {
                        "ok": False,
                        "stale": True,
                        "seq": current,
                        "json": current_json,
                        "version": current_version,
                    }
                )
                return
            notify_live(name, draft)
            self._send({"ok": True, "seq": current})
            return
        if path != "/api/save":
            self._send({"error": "not found"}, 404)
            return
        data = self._read_json_object()
        if data is None:
            return
        try:
            room_json = data.get("json", "")
            client_id = str(data.get("clientId", ""))
            name = sanitize(data.get("name") or "")
        except Exception:
            self._send({"error": "bad request"}, 400)
            return
        # The document is stored as text and handed back to the client to parse,
        # so it has to BE text. A dict or a list used to reach the INSERT and die
        # inside sqlite3 ("Error binding parameter 3: type 'dict' is not
        # supported"), which is not a response — the connection was dropped with
        # a traceback in the journal and the client could not tell a bad request
        # from a dead server. A number was worse: it was accepted and stored.
        if not isinstance(room_json, str):
            self._send({"error": "bad request"}, 400)
            return
        name, version = save_room(name, room_json, client_id)
        remember_last_room(self._cookie(state.SESSION_COOKIE), name, version)
        # A real save supersedes any unsaved draft for this room, and moves the
        # shared state on: an edit built on the room as it was before the save
        # must not be publishable afterwards.
        with state.LIVE_LOCK:
            state.LIVE.pop(name, None)
            seq = state.LIVE_SEQ.get(name, 0) + 1
            state.LIVE_SEQ[name] = seq
        notify(name, room_json, client_id, version, seq)
        self._send({"name": name, "version": version})

    def do_DELETE(self):
        # DELETE is the most destructive verb on the API, so it gets the origin
        # check as well as the auth check. Checked before auth on purpose: a
        # request that is not same-origin is refused whatever its cookie says,
        # and the 403 tells an honest client more than a 401 would.
        if not self._require_same_origin():
            self._send({"error": "cross-origin request refused"}, 403)
            return
        if not self._require_auth():
            return
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/rooms/"):
            name = sanitize(urllib.parse.unquote(path[len("/api/rooms/") :]))
            if name and delete_room(name):
                self._send({"ok": True})
            else:
                self._send({"error": "not found"}, 404)
        else:
            self._send({"error": "not found"}, 404)
