#!/usr/bin/env python3
"""Integration test for RoomCAD's SQLite session + live-draft API.

Spawns the server on a random local port with a temp database and verifies:

  0. Auth: unauthenticated calls are 401; a correct password creates a
     SQLite-backed session cookie and a wrong one does not.
  0a. The current session remembers the exact saved room/version to resume.
  1. POST /api/live/<name> stores and broadcasts a draft WITHOUT saving
     (no row lands in the database).
  2. A newly connecting watcher receives the current draft on connect.
  3. POST /api/save clears the pending draft and bumps the version.
  4. A connected watcher receives a new draft pushed mid-stream.
  5. Live streams are capped: past the cap the request is refused with the
     JSON error envelope, nothing is registered, and a later stream is still
     served once a slot frees up.
  6. A cross-origin POST/DELETE (and login) is refused, a matching Origin is
     accepted, and a request with no Origin at all is still accepted.

Run:  python3 tests/server-live.test.py
"""

import http.client
import json
import os
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "roomcad", "server"))
import server  # noqa: E402


class SseReader(threading.Thread):
    """Reads `data:` events from a live /api/watch connection."""

    def __init__(self, port, name, cookie):
        super().__init__(daemon=True)
        self.port = port
        self.name = name
        self.cookie = cookie
        self.events = []
        self._stop = threading.Event()

    def run(self):
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            conn.request(
                "GET",
                "/api/watch/" + self.name,
                headers={"Accept": "text/event-stream", "Cookie": self.cookie},
            )
            r = conn.getresponse()
            # Not an `assert`: this file is Tier C test code, but an assert is
            # stripped by `python -O`, so the check would vanish and the reader
            # would go on reading a non-stream. Ruff's S101 names it.
            if r.status != 200:
                raise AssertionError(r.status)
            while not self._stop.is_set():
                line = r.readline().decode()
                if not line:
                    break
                if line.startswith("data: "):
                    self.events.append(json.loads(line[len("data: ") :].strip()))
            conn.close()
        except Exception as e:  # pragma: no cover - surfaced via assertions
            self.events.append({"__error__": str(e)})

    def stop(self):
        self._stop.set()


def request(port, method, path, body=None, cookie="", extra_headers=None):
    """Returns (status, parsed_body, set_cookie)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if cookie:
        headers["Cookie"] = cookie
    if extra_headers:
        headers.update(extra_headers)
    conn.request(method, path, data, headers)
    r = conn.getresponse()
    raw = r.read().decode()
    set_cookie = r.getheader("Set-Cookie")
    conn.close()
    try:
        return r.status, json.loads(raw), set_cookie
    except json.JSONDecodeError:
        return r.status, raw, set_cookie


def stream_status(port, name, cookie, extra_headers=None):
    """How /api/watch answers, without waiting for the stream to finish.

    An accepted stream is a 200 with no Content-Length, so reading it to EOF
    would block until the next heartbeat — this only wants the status line and
    any error body the refusal carried. Returns (status, body_text).
    """
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Accept": "text/event-stream", "Cookie": cookie}
    if extra_headers:
        headers.update(extra_headers)
    conn.request("GET", "/api/watch/" + name, headers=headers)
    r = conn.getresponse()
    status = r.status
    body = r.read().decode() if r.getheader("Content-Length") else ""
    conn.close()
    return status, body


def raw_request(port, method, path, body_bytes, headers):
    """Like request(), but sends an exact byte body and exact headers."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request(method, path, body_bytes, headers)
    r = conn.getresponse()
    r.read()
    status, set_cookie = r.status, r.getheader("Set-Cookie")
    conn.close()
    return status, set_cookie


def login(port):
    status, _, set_cookie = request(port, "POST", "/api/login", {"password": "testpass"})
    if status != 200:
        raise AssertionError(status)
    if not set_cookie:
        raise AssertionError("no Set-Cookie returned")
    return set_cookie.split(";")[0]  # "roomcad_auth=<token>"


def wait_for(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def main():
    tmp = tempfile.TemporaryDirectory()
    server.DB_PATH = os.path.join(tmp.name, "rooms.db")
    server.LEGACY_DIR = os.path.join(tmp.name, "legacy")
    server.PASSWORD = "testpass"
    # A dead watcher is only noticed when the next keep-alive fails to write,
    # so shorten the heartbeat to keep the test quick.
    server.SSE_HEARTBEAT_SECONDS = 0.3
    os.makedirs(server.LEGACY_DIR)

    httpd = server.RoomCADServer(("127.0.0.1", 0), server.Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    passed = 0
    failed = 0

    def check(name, cond, detail=""):
        nonlocal passed, failed
        if cond:
            passed += 1
        else:
            failed += 1
            print(f"FAIL: {name}{' — ' + detail if detail else ''}")

    # 0. Auth.
    status, _, _ = request(port, "GET", "/api/rooms")
    check("unauthenticated /api/rooms is 401", status == 401, f"{status}")
    status, _, _ = request(port, "GET", "/api/status")
    check("unauthenticated /api/status is 401", status == 401, f"{status}")
    status, _, _ = request(port, "POST", "/api/login", {"password": "wrong"})
    check("wrong password is 401", status == 401, f"{status}")
    cookie = login(port)
    check("login issues a session cookie", cookie.startswith("roomcad_auth="))
    status, resp, _ = request(port, "GET", "/api/status", cookie=cookie)
    check(
        "status reports one active session",
        status == 200 and resp.get("count") == 1,
        f"{status} {resp}",
    )
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check(
        "new project session has no room to resume",
        status == 200 and resp is None,
        f"{status} {resp}",
    )

    def current_seq(name):
        """What a client's copy is based on, asked for the way a client asks."""
        _, resp, _ = request(
            port,
            "POST",
            "/api/live-check/" + name,
            {"clientId": "probe", "digest": "0" * 64},
            cookie,
        )
        return (resp or {}).get("seq", 0)

    # 1. A live draft is stored and broadcast, but NOT saved to the DB.
    draft1 = {"json": '{"room":{"width":6}}', "clientId": "A", "version": 1, "baseSeq": 0}
    status, resp, _ = request(port, "POST", "/api/live/room1", draft1, cookie)
    check("live POST returns ok", status == 200 and resp.get("ok") is True, f"{status} {resp}")
    check("draft stored in memory", server.LIVE.get("room1", {}).get("json") == draft1["json"])
    check("draft not saved to DB", server.load_room("room1") is None)

    # An edit built on a copy that has since moved on is refused rather than
    # applied: publishing it would replace newer work by other people with this
    # client's older picture, which is how a finished design disappears.
    seq_now = current_seq("room1")
    status, resp, _ = request(
        port,
        "POST",
        "/api/live/room1",
        {
            "json": '{"room":{"width":99}}',
            "clientId": "stale",
            "version": 1,
            "baseSeq": seq_now - 1,
        },
        cookie,
    )
    check(
        "an edit built on an out-of-date copy is refused",
        status == 200 and resp.get("ok") is False and resp.get("stale") is True,
        f"{status} {resp}",
    )
    check(
        "and the room still holds what was really published",
        server.LIVE.get("room1", {}).get("json") == draft1["json"],
        server.LIVE.get("room1", {}).get("json"),
    )
    check(
        "the refusal hands back the current room to catch up on", resp.get("json") == draft1["json"]
    )
    check("with the sequence to publish against next", resp.get("seq") == seq_now)

    # 2. A new watcher receives the current draft on connect.
    reader = SseReader(port, "room1", cookie)
    reader.start()
    check(
        "watcher gets draft on connect",
        wait_for(lambda: len(reader.events) >= 1),
        "no event within timeout",
    )
    if reader.events:
        ev = reader.events[0]
        check("draft event is marked live", ev.get("live") is True)
        check("draft event carries the json", ev.get("json") == draft1["json"])

    # 3. A real save clears the pending draft and bumps the version.
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "room1", "json": '{"room":{"width":6}}', "clientId": "B"},
        cookie,
    )
    # A file's first save is v0 — the original, before anything was saved on top.
    check(
        "a file's first save is version 0",
        status == 200 and resp.get("version") == 0,
        f"{status} {resp}",
    )
    check("save clears the live draft", "room1" not in server.LIVE)
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check(
        "save marks exact room/version for resume",
        status == 200
        and resp.get("name") == "room1"
        and resp.get("version") == 0
        and resp.get("json") == '{"room":{"width":6}}',
        f"{status} {resp}",
    )

    # 3a. Opening an earlier version explicitly is also remembered, and the
    # session data remains available after its in-memory state is discarded.
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "room1", "json": '{"room":{"width":7}}', "clientId": "B"},
        cookie,
    )
    check(
        "the next save counts up from it",
        status == 200 and resp.get("version") == 1,
        f"{status} {resp}",
    )
    status, resp, _ = request(
        port, "POST", "/api/session/last", {"name": "room1", "version": 0}, cookie
    )
    check(
        "choosing a version updates session resume target",
        status == 200 and resp.get("ok") is True,
        f"{status} {resp}",
    )
    # v0 is a real version, so the resume handler must not reject it as falsy.
    check("version 0 is accepted as a resume target", resp.get("ok") is True, f"{resp}")
    first_time_cookie = login(port)
    status, resp, _ = request(port, "GET", "/api/status", cookie=first_time_cookie)
    check(
        "second project session is visible to live collaboration",
        status == 200 and resp.get("count") == 2,
        f"{status} {resp}",
    )
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=first_time_cookie)
    check(
        "first project session opens the latest saved file/version",
        status == 200
        and resp.get("name") == "room1"
        and resp.get("version") == 1
        and resp.get("projectLatest") is True
        and resp.get("json") == '{"room":{"width":7}}',
        f"{status} {resp}",
    )
    server._conn.close()
    server._conn = None
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check(
        "resume target survives a database reconnect",
        status == 200
        and resp.get("version") == 0
        and not resp.get("projectLatest")
        and resp.get("json") == '{"room":{"width":6}}',
        f"{status} {resp}",
    )

    status, resp, _ = request(
        port, "POST", "/api/save", {"json": '{"room":{"width":8}}', "clientId": "B"}, cookie
    )
    check(
        "unnamed save returns its generated room name",
        status == 200 and resp.get("name") == "ternak_room1" and resp.get("version") == 0,
        f"{status} {resp}",
    )
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check(
        "generated room is also the latest resume target",
        status == 200 and resp.get("name") == "ternak_room1" and resp.get("version") == 0,
        f"{status} {resp}",
    )

    # 4. Real-time broadcast: a connected watcher receives a NEW draft pushed
    #    after it connected (without a save).
    reader2 = SseReader(port, "room1", cookie)
    reader2.start()
    wait_for(lambda: len(reader2.events) >= 1)  # initial saved-room event
    initial_count = len(reader2.events)
    draft2 = {
        "json": '{"room":{"width":7}}',
        "clientId": "C",
        "version": 1,
        "baseSeq": current_seq("room1"),
    }
    request(port, "POST", "/api/live/room1", draft2, cookie)
    check(
        "watcher receives a live draft pushed mid-stream",
        wait_for(lambda: len(reader2.events) >= initial_count + 1),
        "no follow-up event within timeout",
    )
    if len(reader2.events) > initial_count:
        ev = reader2.events[initial_count]
        check(
            "follow-up event is live", ev.get("live") is True and ev.get("json") == draft2["json"]
        )

    # ---- 4b. Naming: the Room Name is the file name ------------------------
    # Saving under a new name starts a new file at v0 rather than versioning the
    # old one, and My Rooms lists the most recently saved first so a fresh save
    # is at the top.
    request(
        port,
        "POST",
        "/api/save",
        {"name": "Attic-Flat", "json": '{"room":{"width":9}}', "clientId": "B"},
        cookie,
    )
    status, resp, _ = request(port, "GET", "/api/rooms", cookie=cookie)
    names = [r["name"] for r in resp]
    check("a newly named save appears in the room list", "Attic-Flat" in names, str(names))
    check("the newest save is first in the list", names[0] == "Attic-Flat", str(names))
    attic = next(r for r in resp if r["name"] == "Attic-Flat")
    check("a brand new file starts at v0", attic["version"] == 0, str(attic))

    # Saving the same name again versions it rather than forking.
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "Attic-Flat", "json": '{"room":{"width":10}}', "clientId": "B"},
        cookie,
    )
    check("saving the same name again adds a version", resp.get("version") == 1, str(resp))
    # A different name forks, and leaves the original where it was.
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "Attic-Flat-Copy", "json": '{"room":{"width":10}}', "clientId": "B"},
        cookie,
    )
    check(
        "a different name starts a separate file at v0",
        resp.get("name") == "Attic-Flat-Copy" and resp.get("version") == 0,
        str(resp),
    )
    status, resp, _ = request(port, "GET", "/api/versions/Attic-Flat", cookie=cookie)
    check("the original keeps its own versions", [r["version"] for r in resp] == [1, 0], str(resp))

    # v0 can be loaded back like any other version.
    status, resp, _ = request(port, "GET", "/api/load/Attic-Flat?version=0", cookie=cookie)
    check(
        "version 0 can be loaded back",
        status == 200 and resp.get("json") == '{"room":{"width":9}}',
        f"{status} {resp}",
    )

    # A name is client-supplied and ends up in the database and every listing,
    # so its length is bounded on the server rather than trusted.
    long_name = "N" * 400
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": long_name, "json": '{"room":{"width":1}}', "clientId": "B"},
        cookie,
    )
    check(
        "an over-long room name is truncated, not stored whole",
        status == 200 and len(resp.get("name", "")) <= server.MAX_ROOM_NAME,
        f"{status} {len(resp.get('name', ''))}",
    )
    status, resp, _ = request(port, "GET", "/api/rooms", cookie=cookie)
    check(
        "no listing entry exceeds the name limit",
        all(len(r["name"]) <= server.MAX_ROOM_NAME for r in resp),
    )

    # ---- 5. Hardening ------------------------------------------------------
    # A body is read into memory, so an oversized Content-Length must be
    # refused outright rather than allocated.
    big = b"x" * 2048
    status, _ = raw_request(
        port,
        "POST",
        "/api/save",
        big,
        {
            "Content-Type": "application/json",
            "Content-Length": str(server.MAX_BODY_BYTES + 1),
            "Cookie": cookie,
        },
    )
    check("an oversized Content-Length is rejected, not allocated", status == 413, f"{status}")

    status, _, _ = request(port, "POST", "/api/save", None, cookie)
    check("an empty body is a 400, not a crash", status == 400, f"{status}")

    # The session cookie must be marked Secure when the request arrived over
    # HTTPS, and must not be when it did not (or plain-HTTP dev would break).
    _, plain_cookie = raw_request(
        port,
        "POST",
        "/api/login",
        json.dumps({"password": "testpass"}).encode(),
        {"Content-Type": "application/json"},
    )
    check(
        "cookie is not Secure over plain HTTP",
        plain_cookie and "Secure" not in plain_cookie,
        str(plain_cookie),
    )
    _, https_cookie = raw_request(
        port,
        "POST",
        "/api/login",
        json.dumps({"password": "testpass"}).encode(),
        {"Content-Type": "application/json", "X-Forwarded-Proto": "https"},
    )
    check(
        "cookie is Secure behind an HTTPS proxy",
        https_cookie and "Secure" in https_cookie,
        str(https_cookie),
    )

    # The production chain is client -> nginx -> Caddy -> here, so the real
    # client sits one hop from the right of X-Forwarded-For. Taking the last
    # entry would key every user to the proxy's own loopback address, making
    # the login throttle global instead of per-client.
    class FakeHeaders(dict):
        def get(self, k, d=None):
            return dict.get(self, k, d)

    def client_key_for(xff, sock="127.0.0.1"):
        h = server.Handler.__new__(server.Handler)
        h.headers = FakeHeaders({"X-Forwarded-For": xff} if xff else {})
        h.client_address = (sock, 0)
        return server.Handler._client_key(h)

    # In the reference chain Caddy forwards nginx's X-Forwarded-For unchanged,
    # so the last entry is the one nginx appended: the real remote address.
    check(
        "the real client is the entry our own proxy appended",
        client_key_for("203.0.113.9") == "203.0.113.9",
        client_key_for("203.0.113.9"),
    )
    check(
        "a client cannot spoof its way to a fresh throttle bucket",
        client_key_for("1.2.3.4, 203.0.113.9") == "203.0.113.9",
        client_key_for("1.2.3.4, 203.0.113.9"),
    )
    check(
        "no proxy at all falls back to the socket address",
        client_key_for(None, "198.51.100.7") == "198.51.100.7",
    )

    # A deployment whose proxy appends its own hop sets ROOMCAD_PROXY_HOPS.
    saved_hops = server.PROXY_HOPS
    try:
        server.PROXY_HOPS = 1
        check(
            "an extra proxy hop can be configured away",
            client_key_for("1.2.3.4, 203.0.113.9, 127.0.0.1") == "203.0.113.9",
            client_key_for("1.2.3.4, 203.0.113.9, 127.0.0.1"),
        )
        check(
            "a too-short chain still yields something usable",
            client_key_for("203.0.113.9") == "203.0.113.9",
        )
    finally:
        server.PROXY_HOPS = saved_hops

    def is_https_for(headers):
        h = server.Handler.__new__(server.Handler)
        h.headers = FakeHeaders(headers)
        return server.Handler._is_https(h)

    check(
        "X-Forwarded-Proto decides when it is present",
        is_https_for({"X-Forwarded-Proto": "https"}) is True
        and is_https_for({"X-Forwarded-Proto": "http"}) is False,
    )
    check(
        "a public host is treated as HTTPS if the header is missing",
        is_https_for({"Host": "roomcad.91.99.176.243.nip.io"}) is True,
    )
    check(
        "localhost stays insecure so plain-HTTP development works",
        is_https_for({"Host": "localhost:8080"}) is False
        and is_https_for({"Host": "127.0.0.1:8080"}) is False,
    )

    check(
        "cookie stays HttpOnly and SameSite",
        https_cookie and "HttpOnly" in https_cookie and "SameSite=Lax" in https_cookie,
        str(https_cookie),
    )

    # One shared password has to be protected from brute force.
    server.LOGIN_FAILURES.clear()
    codes = []
    for _ in range(server.LOGIN_MAX_FAILURES + 2):
        st, _, _ = request(port, "POST", "/api/login", {"password": "nope"})
        codes.append(st)
    check(
        "repeated wrong passwords eventually return 429", 429 in codes, f"never throttled: {codes}"
    )
    check(
        "throttling only kicks in after the budget",
        codes[: server.LOGIN_MAX_FAILURES] == [401] * server.LOGIN_MAX_FAILURES,
        f"{codes}",
    )
    server.LOGIN_FAILURES.clear()
    status, _, _ = request(port, "POST", "/api/login", {"password": "testpass"})
    check("a correct password still works once the window is cleared", status == 200, f"{status}")

    # A body that is valid JSON but not an object must be refused, not crash the
    # handler. `_read_json` returns a list or a scalar happily, and every caller
    # then reached for `.get(...)` — on the handlers without a try/except around
    # it that was an unhandled AttributeError: no response, a dropped connection
    # and a traceback in the journal.
    cookie = login(port)
    for bad_path in (
        "/api/save",
        "/api/session/last",
        "/api/live-check/shapes",
        "/api/live/shapes",
    ):
        st, _, _ = request(port, "POST", bad_path, [], cookie=cookie)
        check(f"a JSON array body is refused on {bad_path}", st == 400, f"{st}")
        st, _, _ = request(port, "POST", bad_path, 5, cookie=cookie)
        check(f"a JSON scalar body is refused on {bad_path}", st == 400, f"{st}")

    # A password containing a non-ASCII character used to raise TypeError inside
    # secrets.compare_digest, before the failure was counted — so those attempts
    # escaped the throttle and the connection was dropped with no response.
    server.LOGIN_FAILURES.clear()
    st, _, _ = request(port, "POST", "/api/login", {"password": "pässwörd"})
    check("a non-ASCII password is rejected rather than crashing", st == 401, f"{st}")
    st, _, _ = request(port, "POST", "/api/login", {"password": "pässwörd"})
    check("a non-ASCII attempt is answered again, not dropped", st == 401, f"{st}")
    check(
        "non-ASCII attempts are counted by the throttle",
        sum(f[0] for f in server.LOGIN_FAILURES.values()) >= 1,
        str(server.LOGIN_FAILURES),
    )

    # The configured password itself may be non-ASCII; signing in must still work.
    server.LOGIN_FAILURES.clear()
    original_password = server.PASSWORD
    server.PASSWORD = "pässwörd1A$"
    st, _, _ = request(port, "POST", "/api/login", {"password": "pässwörd1A$"})
    check("a non-ASCII configured password can be used to sign in", st == 200, f"{st}")
    st, _, _ = request(port, "POST", "/api/login", {"password": "passwörd1A$"})
    check("a near-miss non-ASCII password is rejected", st == 401, f"{st}")
    server.PASSWORD = original_password
    server.LOGIN_FAILURES.clear()

    # Deleting a room has to drop its live sequence counter too, or the map keeps
    # an entry for every room name the process has ever seen.
    st, _, _ = request(
        port, "POST", "/api/save", {"json": "{}", "name": "seqprune", "clientId": ""}, cookie=cookie
    )
    check("a room to prune can be saved", st == 200, f"{st}")
    st, _, _ = request(
        port, "POST", "/api/live/seqprune", {"json": "{}", "clientId": "c"}, cookie=cookie
    )
    check("a draft can be published to it", st == 200, f"{st}")
    check(
        "its sequence counter exists", "seqprune" in server.LIVE_SEQ, str(sorted(server.LIVE_SEQ))
    )
    st, _, _ = request(port, "DELETE", "/api/rooms/seqprune", cookie=cookie)
    check("the room is deleted", st == 200, f"{st}")
    check(
        "deleting the room drops its sequence counter",
        "seqprune" not in server.LIVE_SEQ,
        str(sorted(server.LIVE_SEQ)),
    )

    # A watcher that stops reading must not grow an unbounded queue.
    check("watcher queues are bounded", server.WATCH_QUEUE_LIMIT > 0)
    check(
        "watchers wait with a timeout so dead streams are reaped", server.SSE_HEARTBEAT_SECONDS > 0
    )
    check(
        "a client going away is not logged as a server error",
        hasattr(server, "RoomCADServer") and "handle_error" in vars(server.RoomCADServer),
    )

    # A POST to an unknown path must not poison the connection it arrived on.
    # Answering without reading the body leaves those bytes in the socket, so
    # the NEXT request on the same keep-alive connection is parsed starting in
    # the middle of the previous body and fails with 400. Caddy pools upstream
    # connections, which is exactly where this bites in production.
    import socket as _socket

    sock = _socket.create_connection(("127.0.0.1", port))
    sock.settimeout(4)
    junk = json.dumps({"password": "testpass"}).encode()
    sock.sendall(
        b"POST /api/nope HTTP/1.1\r\nHost: x\r\nContent-Length: "
        + str(len(junk)).encode()
        + b"\r\n\r\n"
        + junk
    )
    sock.sendall(b"GET /api/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    raw = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            raw += chunk
    except _socket.timeout:
        pass
    sock.close()
    text = raw.decode("latin1")
    check(
        "an unread POST body does not corrupt the next request on the connection",
        "Bad request syntax" not in text,
        text[:200],
    )
    check(
        "both requests on the connection get a response",
        text.count("HTTP/1.1 ") >= 2,
        f"{text.count('HTTP/1.1 ')} responses",
    )

    # SEVERAL bodied requests down one connection. http.server reuses a single
    # handler instance for every request on a connection, so per-request state
    # set while handling the first is still there for the second. That made the
    # drain a no-op for every request after the first, and only showed up
    # through a proxy, because a proxy is what reuses upstream connections.
    sock = _socket.create_connection(("127.0.0.1", port))
    sock.settimeout(4)
    for _ in range(3):
        sock.sendall(
            b"POST /api/nope HTTP/1.1\r\nHost: x\r\nContent-Length: "
            + str(len(junk)).encode()
            + b"\r\n\r\n"
            + junk
        )
    sock.sendall(b"GET /api/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    raw = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            raw += chunk
    except _socket.timeout:
        pass
    sock.close()
    text = raw.decode("latin1")
    check(
        "repeated bodied requests on one connection stay in sync",
        "Bad request syntax" not in text,
        text[:200],
    )
    check(
        "every request on a reused connection is answered",
        text.count("HTTP/1.1 ") >= 4,
        f"{text.count('HTTP/1.1 ')} responses for 4 requests",
    )

    # A body may arrive chunked rather than with a Content-Length — that is how
    # a proxy re-frames one. http.server does not decode chunked itself.
    sock = _socket.create_connection(("127.0.0.1", port))
    sock.settimeout(4)
    sock.sendall(
        b"POST /api/nope HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n"
        + hex(len(junk))[2:].encode()
        + b"\r\n"
        + junk
        + b"\r\n0\r\n\r\n"
    )
    sock.sendall(b"GET /api/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    raw = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            raw += chunk
    except _socket.timeout:
        pass
    sock.close()
    text = raw.decode("latin1")
    check(
        "a chunked body is drained too, not left in the stream",
        "Bad request syntax" not in text,
        text[:200],
    )

    # And a chunked body must actually be readable, not rejected outright.
    sock = _socket.create_connection(("127.0.0.1", port))
    sock.settimeout(4)
    creds = json.dumps({"password": "testpass"}).encode()
    sock.sendall(
        b"POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
        b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
        + hex(len(creds))[2:].encode()
        + b"\r\n"
        + creds
        + b"\r\n0\r\n\r\n"
    )
    raw = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            raw += chunk
    except _socket.timeout:
        pass
    sock.close()
    check(
        "a chunked request body is accepted, not answered with 400",
        raw.decode("latin1").startswith("HTTP/1.1 200"),
        raw.decode("latin1").split("\r\n")[0],
    )

    # Signing out. The session cookie lasts a year, so without a way to end it
    # a login on a borrowed machine could not be undone.
    status, _, sc = request(port, "POST", "/api/login", {"password": "testpass"})
    out_cookie = sc.split(";")[0]
    check("a fresh session works", request(port, "GET", "/api/rooms", None, out_cookie)[0] == 200)
    status, _, logout_sc = request(port, "POST", "/api/logout", None, out_cookie)
    check("logout succeeds", status == 200, f"{status}")
    check(
        "logout clears the cookie",
        logout_sc is not None and "Max-Age=0" in logout_sc,
        str(logout_sc),
    )
    check(
        "the cookie stays HttpOnly while being cleared",
        logout_sc is not None and "HttpOnly" in logout_sc,
        str(logout_sc),
    )
    check(
        "the session is really gone, not just the cookie",
        request(port, "GET", "/api/rooms", None, out_cookie)[0] == 401,
    )
    # An already-invalid session must still be able to clear itself rather than
    # being told 401 and left stuck.
    check(
        "logging out twice is not an error",
        request(port, "POST", "/api/logout", None, out_cookie)[0] == 200,
    )
    check(
        "logging out with no session at all is fine", request(port, "POST", "/api/logout")[0] == 200
    )
    check(
        "logout does not resurrect access",
        request(port, "GET", "/api/rooms", None, out_cookie)[0] == 401,
    )

    # Deleting a file must take every version of it with it, however many there
    # are, and leave nothing behind that refers to it.
    bulk = "bulkroom"
    bulk_json = '{"room":{"width":6,"length":4}}'
    for _ in range(120):
        request(
            port, "POST", "/api/save", {"name": bulk, "json": bulk_json, "clientId": "bulk"}, cookie
        )
    conn = server.get_conn()

    def count_of():
        return conn.execute("SELECT COUNT(*) FROM rooms WHERE name=?", (bulk,)).fetchone()[0]

    check("a file can accumulate many versions", count_of() >= 120, f"{count_of()}")

    # Point a session at it and leave an unsaved draft under its name.
    request(
        port,
        "POST",
        "/api/live/" + bulk,
        {"json": bulk_json, "clientId": "other", "version": 119, "baseSeq": current_seq(bulk)},
        cookie,
    )
    request(port, "POST", "/api/session/last", {"name": bulk, "version": 0}, cookie)
    check("the draft is there before the delete", bulk in server.LIVE)

    started = time.time()
    status, _, _ = request(port, "DELETE", "/api/rooms/" + bulk, None, cookie)
    elapsed = time.time() - started
    check("deleting a many-versioned file succeeds", status == 200, f"{status}")
    check("every version goes, not just the newest", count_of() == 0, f"{count_of()} left")
    check(
        "deleting 120 versions is one transaction, not 120 round trips",
        elapsed < 2.0,
        f"took {elapsed:.2f}s",
    )
    check(
        "no session is left pointing at the deleted file",
        conn.execute(
            "SELECT COUNT(*) FROM browser_sessions WHERE last_room_name=?", (bulk,)
        ).fetchone()[0]
        == 0,
    )
    # A draft left in memory outlives the file and would be handed to the next
    # watcher of a room created with the same name.
    check("the unsaved draft does not outlive the file", bulk not in server.LIVE)
    status, listing, _ = request(port, "GET", "/api/rooms", None, cookie)
    names = [r.get("name") for r in listing] if isinstance(listing, list) else []
    check("the room listing comes back as a list", isinstance(listing, list), repr(listing)[:120])
    check("the deleted file is gone from the listing", bulk not in names, str(names)[:120])
    check(
        "deleting a file that is not there is a 404",
        request(port, "DELETE", "/api/rooms/" + bulk, None, cookie)[0] == 404,
    )

    # Empty watcher sets are removed rather than accumulating per room name.
    reader.stop()
    reader2.stop()
    check(
        "no watcher entry leaks once every stream for a room has gone",
        wait_for(lambda: "room1" not in server.WATCHERS, timeout=3.0)
        or not server.WATCHERS.get("room1"),
        f"{list(server.WATCHERS)}",
    )

    # ---- 5. Bounding live streams ------------------------------------------
    # Every stream costs a thread, a socket and a queue, so an authenticated
    # client must not be able to open unlimited ones. The caps are exercised
    # with small values so the test does not have to open 256 connections; the
    # code under test is the same either way.
    wait_for(lambda: not server.WATCHERS, timeout=3.0)  # start from a clean pool
    # getattr, not attribute access: a missing cap is one of the things this
    # section is here to catch, and it has to be reported as a failed check
    # rather than aborting the file before the counts are printed.
    saved_per_session = getattr(server, "MAX_WATCHERS_PER_SESSION", 0)
    saved_total = getattr(server, "MAX_WATCHERS_TOTAL", 0)
    check(
        "there are named caps on live streams",
        saved_per_session > 0 and saved_total > 0,
        f"per-session={saved_per_session} total={saved_total}",
    )
    check(
        "one session's share cannot exceed the whole pool",
        0 < saved_per_session <= saved_total,
        f"per-session={saved_per_session} total={saved_total}",
    )
    cap_cookie = login(port)
    try:
        server.MAX_WATCHERS_PER_SESSION = 2
        r1 = SseReader(port, "caproom", cap_cookie)
        r1.start()
        check(
            "a stream within the per-session cap is served",
            wait_for(lambda: len(server.WATCHERS.get("caproom", ())) == 1),
            f"{list(server.WATCHERS)}",
        )
        r2 = SseReader(port, "caproom", cap_cookie)
        r2.start()
        check(
            "a second stream within the per-session cap is served",
            wait_for(lambda: len(server.WATCHERS.get("caproom", ())) == 2),
            f"{list(server.WATCHERS)}",
        )

        status, body = stream_status(port, "caproom", cap_cookie)
        try:
            envelope = json.loads(body)
        except ValueError:
            envelope = {}
        check(
            "a stream past the per-session cap gets an error status, not a 200",
            status == 503,
            f"{status} {body[:120]}",
        )
        check(
            "the refused stream is answered with the JSON error envelope",
            isinstance(envelope, dict) and envelope.get("error"),
            body[:120],
        )
        check(
            "the refused stream registered no queue",
            len(server.WATCHERS.get("caproom", ())) == 2,
            f"{len(server.WATCHERS.get('caproom', ()))}",
        )

        r1.stop()
        r2.stop()
        check(
            "streams deregister so their slots are freed",
            wait_for(lambda: not server.WATCHERS.get("caproom"), timeout=3.0),
            f"{list(server.WATCHERS)}",
        )
        r3 = SseReader(port, "caproom", cap_cookie)
        r3.start()
        check(
            "a later legitimate stream is served after a refusal",
            wait_for(lambda: len(server.WATCHERS.get("caproom", ())) == 1),
            f"{list(server.WATCHERS)}",
        )
        r3.stop()
        wait_for(lambda: not server.WATCHERS, timeout=3.0)

        # The global cap is the one that protects the process, so it is
        # exercised on its own with the per-session cap out of the way: the
        # same session opens both streams and is refused by the total, not by
        # its own share.
        server.MAX_WATCHERS_PER_SESSION = 100
        server.MAX_WATCHERS_TOTAL = 2
        g1 = SseReader(port, "caproom2", cap_cookie)
        g1.start()
        check(
            "a stream within the global cap is served",
            wait_for(lambda: len(server.WATCHERS.get("caproom2", ())) == 1),
            f"{list(server.WATCHERS)}",
        )
        g2 = SseReader(port, "caproom2", cap_cookie)
        g2.start()
        check(
            "streams up to the global cap are served",
            wait_for(lambda: len(server.WATCHERS.get("caproom2", ())) == 2),
            f"{list(server.WATCHERS)}",
        )
        status, body = stream_status(port, "caproom2", cap_cookie)
        try:
            envelope = json.loads(body)
        except ValueError:
            envelope = {}
        check(
            "a stream past the global cap is refused with the JSON envelope",
            status == 503 and isinstance(envelope, dict) and envelope.get("error"),
            f"{status} {body[:120]}",
        )
        check(
            "the globally refused stream registered no queue",
            len(server.WATCHERS.get("caproom2", ())) == 2,
            f"{len(server.WATCHERS.get('caproom2', ()))}",
        )
        g1.stop()
        g2.stop()
        wait_for(lambda: not server.WATCHERS, timeout=3.0)
    finally:
        server.MAX_WATCHERS_PER_SESSION = saved_per_session
        server.MAX_WATCHERS_TOTAL = saved_total

    # The per-session bookkeeping has to empty out with the streams themselves,
    # or a long-lived process slowly refuses sessions that have no stream left.
    # getattr so the old code reports this as a failure instead of an abort.
    sessions_left = getattr(server, "WATCHER_SESSIONS", None)
    check(
        "no watcher bookkeeping is left behind once every stream has gone",
        sessions_left == {} and not server.WATCHERS,
        f"sessions={sessions_left} watchers={list(server.WATCHERS)}",
    )

    # The listen backlog bounds the connections the kernel holds unaccepted;
    # socketserver's default of 5 is small enough that a page opening a stream
    # per tab can overflow it before the process is even involved.
    backlog = getattr(server.RoomCADServer, "request_queue_size", 5)
    check(
        "the listen backlog is raised above the socketserver default of 5",
        backlog > 5,
        f"{backlog}",
    )
    check(
        "the listen backlog is a deliberate value, and still a bound",
        64 <= backlog <= 1024,
        f"{backlog}",
    )

    # ---- 6. Cross-site state-changing requests -----------------------------
    # SameSite=Lax withholds the cookie from a cross-site POST, but that is the
    # only defence and /api/logout is deliberately unauthenticated, so the
    # origin itself is checked as a second line. A browser sends Origin on a
    # cross-site POST; the host it is compared against is this request's own.
    origin = f"http://127.0.0.1:{port}"
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "csrfroom", "json": "{}", "clientId": "csrf"},
        cookie,
        {"Origin": "http://evil.example"},
    )
    check("a cross-origin POST is refused", status == 403, f"{status} {resp}")
    check(
        "and the refusal uses the JSON error envelope",
        isinstance(resp, dict) and "error" in resp,
        f"{resp}",
    )
    _, listing, _ = request(port, "GET", "/api/rooms", None, cookie)
    check(
        "the refused cross-origin POST changed nothing",
        all(r.get("name") != "csrfroom" for r in (listing or [])),
        str(listing)[:160],
    )

    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "sameorigin", "json": "{}", "clientId": "same"},
        cookie,
        {"Origin": origin},
    )
    check("a matching Origin is accepted", status == 200, f"{status} {resp}")

    status, resp, _ = request(
        port, "POST", "/api/save", {"name": "noorigin", "json": "{}", "clientId": "none"}, cookie
    )
    check("a request with no Origin at all is still accepted", status == 200, f"{status} {resp}")

    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "refererroom", "json": "{}", "clientId": "ref"},
        cookie,
        {"Referer": "http://evil.example/page"},
    )
    check("a cross-origin Referer with no Origin is refused", status == 403, f"{status} {resp}")
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"name": "refererroom", "json": "{}", "clientId": "ref"},
        cookie,
        {"Referer": origin + "/index.html"},
    )
    check("a matching Referer with no Origin is accepted", status == 200, f"{status} {resp}")

    status, resp, _ = request(
        port, "DELETE", "/api/rooms/sameorigin", None, cookie, {"Origin": "http://evil.example"}
    )
    check("a cross-origin DELETE is refused", status == 403, f"{status} {resp}")
    _, listing, _ = request(port, "GET", "/api/rooms", None, cookie)
    check(
        "the refused cross-origin DELETE left the room alone",
        any(r.get("name") == "sameorigin" for r in (listing or [])),
        str(listing)[:160],
    )

    # Login is the one endpoint that works before a session exists, which is
    # exactly why it is covered too: a cross-site login is a real attack.
    status, resp, _ = request(
        port,
        "POST",
        "/api/login",
        {"password": "testpass"},
        extra_headers={"Origin": "http://evil.example"},
    )
    check("a cross-origin login attempt is refused", status == 403, f"{status} {resp}")
    status, _, _ = request(
        port, "POST", "/api/login", {"password": "testpass"}, extra_headers={"Origin": origin}
    )
    check("a same-origin login still works", status == 200, f"{status}")

    # ---- A save body's `json` must be a string, not any JSON value ----------
    # The document is stored as TEXT and handed back for the client to parse. A
    # dict or a list used to reach the INSERT and die inside sqlite3, which is
    # not a response: the connection was dropped with a traceback in the journal
    # and the caller could not tell a bad request from a dead server. A number
    # was silently accepted and stored. Each shape is checked here, and the
    # server has to still answer normally afterwards.
    for label, value in (
        ("an object", {"a": 1}),
        ("a list", [1, 2]),
        ("a number", 5),
        ("null", None),
        ("a boolean", True),
    ):
        status, resp, _ = request(
            port,
            "POST",
            "/api/save",
            {"json": value, "name": "shapecheck", "clientId": "shape"},
            cookie,
        )
        check(
            f"a save whose json is {label} is refused as a bad request",
            status == 400,
            f"{status} {resp!r:.80}",
        )
    check(
        "the server is still serving after refusing those bodies",
        request(port, "GET", "/api/rooms", None, cookie)[0] == 200,
    )
    status, resp, _ = request(
        port,
        "POST",
        "/api/save",
        {"json": '{"room":{}}', "name": "shapecheck", "clientId": "shape"},
        cookie,
    )
    check("a save whose json IS a string is accepted", status == 200, f"{status} {resp!r:.80}")

    httpd.shutdown()
    tmp.cleanup()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
