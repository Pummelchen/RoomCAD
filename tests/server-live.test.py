#!/usr/bin/env python3
"""Integration test for RoomCAD's live-draft (unsaved collaboration) API.

Spawns the server on a random local port with a temp database and verifies:

  0. Auth: unauthenticated calls are 401; a correct password issues a session
     cookie and a wrong one does not.
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
    os.makedirs(server.LEGACY_DIR)

    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
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
    check("save returns version 1", status == 200 and resp.get("version") == 1, f"{status} {resp}")
    check("save clears the live draft", "room1" not in server.LIVE)

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

    reader.stop()
    reader2.stop()
    httpd.shutdown()
    tmp.cleanup()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
