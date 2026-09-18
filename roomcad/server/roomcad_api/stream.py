"""Server-Sent Events: one bounded, mortal stream per watcher."""

import json
import queue

from . import state
from .db import load_room


class StreamMixin:
    """The live-stream writer and loop, mixed into the request Handler."""

    def _sse_write(self, payload):
        self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def _sse(self, name):
        # The cap has to be enforced before the first byte of the response.
        # Once send_response has put out the 200 and the event-stream headers
        # the status line is written and there is nowhere left to put an error,
        # so the count and the registration happen together under WATCH_LOCK —
        # two threads must not both see room for the last slot — before any
        # header is sent. A refusal answers with the ordinary JSON envelope
        # rather than dropping the connection, so the client is told what
        # happened and can retry; and because a refused request never touches
        # WATCHERS, there is no queue left behind to leak.
        token = self._cookie(state.SESSION_COOKIE) or ""
        q = queue.Queue(maxsize=state.WATCH_QUEUE_LIMIT)
        with state.WATCH_LOCK:
            # The total is checked first: it is the process that has to
            # survive, so when the whole pool is gone the honest answer is
            # "the server is full" rather than blaming this client's tab.
            if len(state.WATCHER_SESSIONS) >= state.MAX_WATCHERS_TOTAL:
                refusal = "too many watchers"
            elif (
                sum(1 for t in state.WATCHER_SESSIONS.values() if t == token)
                >= state.MAX_WATCHERS_PER_SESSION
            ):
                refusal = "too many streams"
            else:
                refusal = None
                state.WATCHERS.setdefault(name, set()).add(q)
                state.WATCHER_SESSIONS[q] = token
        if refusal:
            self._send({"error": refusal}, 503)
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            with state.LIVE_LOCK:
                seq = state.LIVE_SEQ.get(name, 0)
            cur = load_room(name)
            if cur:
                self._sse_write(
                    json.dumps(
                        {
                            "name": name,
                            "json": cur["json"],
                            "clientId": "",
                            "version": cur["version"],
                            "seq": seq,
                        }
                    )
                )
            with state.LIVE_LOCK:
                draft = state.LIVE.get(name)
            if draft:
                # Join mid-edit: hand over the latest unsaved draft too.
                self._sse_write(
                    json.dumps(
                        {
                            "name": name,
                            "json": draft["json"],
                            "clientId": draft["clientId"],
                            "version": draft["version"],
                            "seq": draft.get("seq"),
                            "live": True,
                        }
                    )
                )
            while True:
                # Waiting with a timeout is what keeps this thread mortal. A
                # blocking get() never returns for a client that disconnected
                # while idle, so the thread and its socket would leak for the
                # life of the process. The periodic comment doubles as the
                # keep-alive that stops proxies dropping a quiet stream.
                try:
                    payload = q.get(timeout=state.SSE_HEARTBEAT_SECONDS)
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
            with state.WATCH_LOCK:
                # One queue is registered once, just above and before a single
                # byte of the response, and this is the only place it is taken
                # back out — so a disconnect deregisters exactly once and frees
                # exactly this session's slot. The header write is inside the
                # try for the same reason: a client that vanished before the
                # first byte still comes through here instead of leaking a
                # queue that no later reader would ever remove.
                state.WATCHER_SESSIONS.pop(q, None)
                watchers = state.WATCHERS.get(name)
                if watchers is not None:
                    watchers.discard(q)
                    if not watchers:
                        del state.WATCHERS[name]  # do not keep an empty set per room
