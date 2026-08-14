#!/usr/bin/env python3
"""Integration test for RoomCAD's live-draft (unsaved collaboration) API.

Spawns the server on a random local port with a temp database and verifies:

  1. POST /api/live/<name> stores and broadcasts a draft WITHOUT saving
     (no row lands in the database).
  2. A newly connecting watcher receives the current draft on connect.
  3. POST /api/save clears the pending draft and bumps the version.

Run:  python3 tests/server-live.test.py
"""
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "roomcad", "server"))
import server  # noqa: E402


class SseReader(threading.Thread):
    """Reads `data:` events from a live /api/watch connection."""

    def __init__(self, port, name):
        super().__init__(daemon=True)
        self.port = port
        self.name = name
        self.events = []
        self._stop = threading.Event()

    def run(self):
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            conn.request("GET", "/api/watch/" + self.name, headers={"Accept": "text/event-stream"})
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


def request(port, method, path, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    conn.request(method, path, data, headers)
    r = conn.getresponse()
    raw = r.read().decode()
    conn.close()
    try:
        return r.status, json.loads(raw)
    except json.JSONDecodeError:
        return r.status, raw


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

    # 1. A live draft is stored and broadcast, but NOT saved to the DB.
    draft1 = {"json": '{"room":{"width":6}}', "clientId": "A", "version": 1}
    status, resp = request(port, "POST", "/api/live/room1", draft1)
    check("live POST returns ok", status == 200 and resp.get("ok") is True, f"{status} {resp}")
    check("draft stored in memory", server.LIVE.get("room1", {}).get("json") == draft1["json"])
    check("draft not saved to DB", server.load_room("room1") is None)

    # 2. A new watcher receives the current draft on connect.
    reader = SseReader(port, "room1")
    reader.start()
    check("watcher gets draft on connect",
          wait_for(lambda: len(reader.events) >= 1),
          "no event within timeout")
    if reader.events:
        ev = reader.events[0]
        check("draft event is marked live", ev.get("live") is True)
        check("draft event carries the json", ev.get("json") == draft1["json"])

    # 3. A real save clears the pending draft and bumps the version.
    status, resp = request(port, "POST", "/api/save", {"name": "room1", "json": '{"room":{"width":6}}', "clientId": "B"})
    check("save returns version 1", status == 200 and resp.get("version") == 1, f"{status} {resp}")
    check("save clears the live draft", "room1" not in server.LIVE)

    # 4. Real-time broadcast: a connected watcher receives a NEW draft pushed
    #    after it connected (without a save).
    reader2 = SseReader(port, "room1")
    reader2.start()
    wait_for(lambda: len(reader2.events) >= 1)  # initial saved-room event
    initial_count = len(reader2.events)
    draft2 = {"json": '{"room":{"width":7}}', "clientId": "C", "version": 1}
    request(port, "POST", "/api/live/room1", draft2)
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
