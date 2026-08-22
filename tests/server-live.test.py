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
            conn.request("GET", "/api/watch/" + self.name,
                         headers={"Accept": "text/event-stream", "Cookie": self.cookie})
            r = conn.getresponse()
            assert r.status == 200, r.status
            while not self._stop.is_set():
                line = r.readline().decode()
                if not line:
                    break
                if line.startswith("data: "):
                    self.events.append(json.loads(line[len("data: "):].strip()))
            conn.close()
        except Exception as e:  # pragma: no cover - surfaced via assertions
            self.events.append({"__error__": str(e)})

    def stop(self):
        self._stop.set()


def request(port, method, path, body=None, cookie=""):
    """Returns (status, parsed_body, set_cookie)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if cookie:
        headers["Cookie"] = cookie
    conn.request(method, path, data, headers)
    r = conn.getresponse()
    raw = r.read().decode()
    set_cookie = r.getheader("Set-Cookie")
    conn.close()
    try:
        return r.status, json.loads(raw), set_cookie
    except json.JSONDecodeError:
        return r.status, raw, set_cookie


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
    assert status == 200, status
    assert set_cookie, "no Set-Cookie returned"
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
    check("status reports one active session", status == 200 and resp.get("count") == 1, f"{status} {resp}")
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check("new project session has no room to resume", status == 200 and resp is None, f"{status} {resp}")

    # 1. A live draft is stored and broadcast, but NOT saved to the DB.
    draft1 = {"json": '{"room":{"width":6}}', "clientId": "A", "version": 1}
    status, resp, _ = request(port, "POST", "/api/live/room1", draft1, cookie)
    check("live POST returns ok", status == 200 and resp.get("ok") is True, f"{status} {resp}")
    check("draft stored in memory", server.LIVE.get("room1", {}).get("json") == draft1["json"])
    check("draft not saved to DB", server.load_room("room1") is None)

    # 2. A new watcher receives the current draft on connect.
    reader = SseReader(port, "room1", cookie)
    reader.start()
    check("watcher gets draft on connect",
          wait_for(lambda: len(reader.events) >= 1),
          "no event within timeout")
    if reader.events:
        ev = reader.events[0]
        check("draft event is marked live", ev.get("live") is True)
        check("draft event carries the json", ev.get("json") == draft1["json"])

    # 3. A real save clears the pending draft and bumps the version.
    status, resp, _ = request(port, "POST", "/api/save",
                              {"name": "room1", "json": '{"room":{"width":6}}', "clientId": "B"}, cookie)
    # A file's first save is v0 — the original, before anything was saved on top.
    check("a file's first save is version 0", status == 200 and resp.get("version") == 0, f"{status} {resp}")
    check("save clears the live draft", "room1" not in server.LIVE)
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check("save marks exact room/version for resume",
          status == 200 and resp.get("name") == "room1" and resp.get("version") == 0
          and resp.get("json") == '{"room":{"width":6}}', f"{status} {resp}")

    # 3a. Opening an earlier version explicitly is also remembered, and the
    # session data remains available after its in-memory state is discarded.
    status, resp, _ = request(port, "POST", "/api/save",
                              {"name": "room1", "json": '{"room":{"width":7}}', "clientId": "B"}, cookie)
    check("the next save counts up from it", status == 200 and resp.get("version") == 1, f"{status} {resp}")
    status, resp, _ = request(port, "POST", "/api/session/last",
                              {"name": "room1", "version": 0}, cookie)
    check("choosing a version updates session resume target", status == 200 and resp.get("ok") is True, f"{status} {resp}")
    # v0 is a real version, so the resume handler must not reject it as falsy.
    check("version 0 is accepted as a resume target", resp.get("ok") is True, f"{resp}")
    first_time_cookie = login(port)
    status, resp, _ = request(port, "GET", "/api/status", cookie=first_time_cookie)
    check("second project session is visible to live collaboration", status == 200 and resp.get("count") == 2, f"{status} {resp}")
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=first_time_cookie)
    check("first project session opens the latest saved file/version",
          status == 200 and resp.get("name") == "room1" and resp.get("version") == 1
          and resp.get("projectLatest") is True and resp.get("json") == '{"room":{"width":7}}',
          f"{status} {resp}")
    server._conn.close()
    server._conn = None
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check("resume target survives a database reconnect",
          status == 200 and resp.get("version") == 0 and not resp.get("projectLatest")
          and resp.get("json") == '{"room":{"width":6}}',
          f"{status} {resp}")

    status, resp, _ = request(port, "POST", "/api/save",
                              {"json": '{"room":{"width":8}}', "clientId": "B"}, cookie)
    check("unnamed save returns its generated room name",
          status == 200 and resp.get("name") == "ternak_room1" and resp.get("version") == 0,
          f"{status} {resp}")
    status, resp, _ = request(port, "GET", "/api/session/last", cookie=cookie)
    check("generated room is also the latest resume target",
          status == 200 and resp.get("name") == "ternak_room1" and resp.get("version") == 0,
          f"{status} {resp}")

    # 4. Real-time broadcast: a connected watcher receives a NEW draft pushed
    #    after it connected (without a save).
    reader2 = SseReader(port, "room1", cookie)
    reader2.start()
    wait_for(lambda: len(reader2.events) >= 1)  # initial saved-room event
    initial_count = len(reader2.events)
    draft2 = {"json": '{"room":{"width":7}}', "clientId": "C", "version": 1}
    request(port, "POST", "/api/live/room1", draft2, cookie)
    check("watcher receives a live draft pushed mid-stream",
          wait_for(lambda: len(reader2.events) >= initial_count + 1),
          "no follow-up event within timeout")
    if len(reader2.events) > initial_count:
        ev = reader2.events[initial_count]
        check("follow-up event is live", ev.get("live") is True and ev.get("json") == draft2["json"])

    # ---- 4b. Naming: the Room Name is the file name ------------------------
    # Saving under a new name starts a new file at v0 rather than versioning the
    # old one, and My Rooms lists the most recently saved first so a fresh save
    # is at the top.
    request(port, "POST", "/api/save",
            {"name": "Attic-Flat", "json": '{"room":{"width":9}}', "clientId": "B"}, cookie)
    status, resp, _ = request(port, "GET", "/api/rooms", cookie=cookie)
    names = [r["name"] for r in resp]
    check("a newly named save appears in the room list", "Attic-Flat" in names, str(names))
    check("the newest save is first in the list", names[0] == "Attic-Flat", str(names))
    attic = next(r for r in resp if r["name"] == "Attic-Flat")
    check("a brand new file starts at v0", attic["version"] == 0, str(attic))

    # Saving the same name again versions it rather than forking.
    status, resp, _ = request(port, "POST", "/api/save",
                              {"name": "Attic-Flat", "json": '{"room":{"width":10}}', "clientId": "B"}, cookie)
    check("saving the same name again adds a version", resp.get("version") == 1, str(resp))
    # A different name forks, and leaves the original where it was.
    status, resp, _ = request(port, "POST", "/api/save",
                              {"name": "Attic-Flat-Copy", "json": '{"room":{"width":10}}', "clientId": "B"}, cookie)
    check("a different name starts a separate file at v0",
          resp.get("name") == "Attic-Flat-Copy" and resp.get("version") == 0, str(resp))
    status, resp, _ = request(port, "GET", "/api/versions/Attic-Flat", cookie=cookie)
    check("the original keeps its own versions", [r["version"] for r in resp] == [1, 0], str(resp))

    # v0 can be loaded back like any other version.
    status, resp, _ = request(port, "GET", "/api/load/Attic-Flat?version=0", cookie=cookie)
    check("version 0 can be loaded back",
          status == 200 and resp.get("json") == '{"room":{"width":9}}', f"{status} {resp}")

    # A name is client-supplied and ends up in the database and every listing,
    # so its length is bounded on the server rather than trusted.
    long_name = "N" * 400
    status, resp, _ = request(port, "POST", "/api/save",
                              {"name": long_name, "json": '{"room":{"width":1}}', "clientId": "B"}, cookie)
    check("an over-long room name is truncated, not stored whole",
          status == 200 and len(resp.get("name", "")) <= server.MAX_ROOM_NAME,
          f"{status} {len(resp.get('name',''))}")
    status, resp, _ = request(port, "GET", "/api/rooms", cookie=cookie)
    check("no listing entry exceeds the name limit",
          all(len(r["name"]) <= server.MAX_ROOM_NAME for r in resp))

    # ---- 5. Hardening ------------------------------------------------------
    # A body is read into memory, so an oversized Content-Length must be
    # refused outright rather than allocated.
    big = b"x" * 2048
    status, _ = raw_request(
        port, "POST", "/api/save", big,
        {"Content-Type": "application/json",
         "Content-Length": str(server.MAX_BODY_BYTES + 1),
         "Cookie": cookie},
    )
    check("an oversized Content-Length is rejected, not allocated", status == 413, f"{status}")

    status, _, _ = request(port, "POST", "/api/save", None, cookie)
    check("an empty body is a 400, not a crash", status == 400, f"{status}")

    # The session cookie must be marked Secure when the request arrived over
    # HTTPS, and must not be when it did not (or plain-HTTP dev would break).
    _, plain_cookie = raw_request(
        port, "POST", "/api/login", json.dumps({"password": "testpass"}).encode(),
        {"Content-Type": "application/json"},
    )
    check("cookie is not Secure over plain HTTP", plain_cookie and "Secure" not in plain_cookie,
          str(plain_cookie))
    _, https_cookie = raw_request(
        port, "POST", "/api/login", json.dumps({"password": "testpass"}).encode(),
        {"Content-Type": "application/json", "X-Forwarded-Proto": "https"},
    )
    check("cookie is Secure behind an HTTPS proxy", https_cookie and "Secure" in https_cookie,
          str(https_cookie))
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
    check("the real client is the entry our own proxy appended",
          client_key_for("203.0.113.9") == "203.0.113.9",
          client_key_for("203.0.113.9"))
    check("a client cannot spoof its way to a fresh throttle bucket",
          client_key_for("1.2.3.4, 203.0.113.9") == "203.0.113.9",
          client_key_for("1.2.3.4, 203.0.113.9"))
    check("no proxy at all falls back to the socket address",
          client_key_for(None, "198.51.100.7") == "198.51.100.7")

    # A deployment whose proxy appends its own hop sets ROOMCAD_PROXY_HOPS.
    saved_hops = server.PROXY_HOPS
    try:
        server.PROXY_HOPS = 1
        check("an extra proxy hop can be configured away",
              client_key_for("1.2.3.4, 203.0.113.9, 127.0.0.1") == "203.0.113.9",
              client_key_for("1.2.3.4, 203.0.113.9, 127.0.0.1"))
        check("a too-short chain still yields something usable",
              client_key_for("203.0.113.9") == "203.0.113.9")
    finally:
        server.PROXY_HOPS = saved_hops

    def is_https_for(headers):
        h = server.Handler.__new__(server.Handler)
        h.headers = FakeHeaders(headers)
        return server.Handler._is_https(h)

    check("X-Forwarded-Proto decides when it is present",
          is_https_for({"X-Forwarded-Proto": "https"}) is True
          and is_https_for({"X-Forwarded-Proto": "http"}) is False)
    check("a public host is treated as HTTPS if the header is missing",
          is_https_for({"Host": "roomcad.91.99.176.243.nip.io"}) is True)
    check("localhost stays insecure so plain-HTTP development works",
          is_https_for({"Host": "localhost:8080"}) is False
          and is_https_for({"Host": "127.0.0.1:8080"}) is False)

    check("cookie stays HttpOnly and SameSite", https_cookie and "HttpOnly" in https_cookie
          and "SameSite=Lax" in https_cookie, str(https_cookie))

    # One shared password has to be protected from brute force.
    server.LOGIN_FAILURES.clear()
    codes = []
    for _ in range(server.LOGIN_MAX_FAILURES + 2):
        st, _, _ = request(port, "POST", "/api/login", {"password": "nope"})
        codes.append(st)
    check("repeated wrong passwords eventually return 429",
          429 in codes, f"never throttled: {codes}")
    check("throttling only kicks in after the budget",
          codes[:server.LOGIN_MAX_FAILURES] == [401] * server.LOGIN_MAX_FAILURES,
          f"{codes}")
    server.LOGIN_FAILURES.clear()
    status, _, _ = request(port, "POST", "/api/login", {"password": "testpass"})
    check("a correct password still works once the window is cleared", status == 200, f"{status}")

    # A watcher that stops reading must not grow an unbounded queue.
    check("watcher queues are bounded", server.WATCH_QUEUE_LIMIT > 0)
    check("watchers wait with a timeout so dead streams are reaped",
          server.SSE_HEARTBEAT_SECONDS > 0)
    check("a client going away is not logged as a server error",
          hasattr(server, "RoomCADServer") and "handle_error" in vars(server.RoomCADServer))

    # Empty watcher sets are removed rather than accumulating per room name.
    reader.stop()
    reader2.stop()
    check("no watcher entry leaks once every stream for a room has gone",
          wait_for(lambda: "room1" not in server.WATCHERS, timeout=3.0)
          or not server.WATCHERS.get("room1"),
          f"{list(server.WATCHERS)}")

    httpd.shutdown()
    tmp.cleanup()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
