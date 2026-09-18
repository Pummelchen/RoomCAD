"""Request framing: bodies, drains, sending JSON and reading it back.

The body-size limits are read from `state` at call time — see state.py.
"""

import json

from . import state


class TransportMixin:
    """Body framing and JSON responses, mixed into the request Handler."""

    def handle_one_request(self):
        # One handler instance serves EVERY request on a keep-alive connection,
        # so per-request state has to be reset here — __init__ runs once per
        # connection, not once per request. Leaving _body_done set from the
        # previous request made _drain() a no-op for the next one, which put
        # that request's body back into the stream. It only showed up behind a
        # proxy, because a proxy is what reuses upstream connections.
        self._body_done = False
        return super().handle_one_request()

    def _body_bytes(self):
        """Reads the request body under either framing.

        Returns (status, data) where status is "ok", "none", "too_large" or
        "bad". http.server does not decode chunked bodies, and a body arrives
        chunked whenever a proxy re-frames it — which is exactly what happens
        in production, where nginx and Caddy sit in front. Handling only
        Content-Length here meant a chunked body was left in the socket
        entirely.
        """
        encoding = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in encoding:
            data = bytearray()
            while True:
                line = self.rfile.readline(state.MAX_CHUNK_LINE)
                if not line:
                    return ("bad", None)
                try:
                    size = int(line.split(b";", 1)[0].strip(), 16)
                except ValueError:
                    return ("bad", None)
                if size == 0:
                    # Trailing headers, if any, then the blank line that ends them.
                    while True:
                        trailer = self.rfile.readline(state.MAX_CHUNK_LINE)
                        if not trailer or trailer in (b"\r\n", b"\n"):
                            break
                    return ("ok", bytes(data))
                if len(data) + size > state.MAX_BODY_BYTES:
                    return ("too_large", None)
                chunk = self.rfile.read(size)
                if len(chunk) != size:
                    return ("bad", None)
                data.extend(chunk)
                self.rfile.read(2)  # the CRLF that closes the chunk
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            return ("bad", None)
        if length <= 0:
            return ("none", b"")
        if length > state.MAX_BODY_BYTES:
            return ("too_large", None)
        body = self.rfile.read(length)
        if len(body) != length:
            return ("bad", None)
        return ("ok", body)

    def _drain(self):
        """Swallows an unread request body.

        Every early return that answers without reading the body — an unknown
        path, a throttled login, a rejected name — used to leave those bytes in
        the socket. On a keep-alive connection the next request is then parsed
        starting in the middle of the previous body, so a client that merely
        POSTs to the wrong URL breaks its *following* request too. An oversized
        or malformed body is not drained; the connection is closed instead of
        reading megabytes only to discard them.
        """
        if getattr(self, "_body_done", False):
            return
        self._body_done = True
        try:
            status, _ = self._body_bytes()
        except Exception:
            self.close_connection = True
            return
        if status in ("too_large", "bad"):
            self.close_connection = True

    def _send(self, obj, code=200, extra_headers=()):
        """Sends one JSON response.

        Every response goes through here, including the two that carry a
        `Set-Cookie` (login and logout, via `extra_headers`), because the body
        and its `Content-Length` have to be computed from the SAME
        `json.dumps` call. Those two used to write the body themselves with a
        hand-written `Content-Length: 11` for a 12-byte body, so one byte of
        `{"ok": true}` stayed in the socket — and with HTTP/1.1 keep-alive on,
        the next response on that connection began with a stray `}`, which
        desynchronises any client that trusts the declared length.
        """
        self._drain()
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in extra_headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

    def _read_json(self):
        """Reads a bounded JSON body. Sends the error response and returns None
        if the body is missing, oversized or malformed."""
        try:
            status, raw = self._body_bytes()
        except Exception:
            status, raw = "bad", None
        self._body_done = True
        if status == "too_large":
            self.close_connection = True
            self._send({"error": "payload too large"}, 413)
            return None
        if status != "ok" or not raw:
            if status == "bad":
                self.close_connection = True
            self._send({"error": "bad request"}, 400)
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            self._send({"error": "bad request"}, 400)
            return None

    def _read_json_object(self):
        """Reads a JSON *object* body, or answers 400 and returns None.

        `_read_json` happily returns a list or a scalar for `[]`, `5` or `"x"`,
        and every caller then reached straight for `.get(...)`. On the handlers
        that did not happen to wrap that in a try/except it was an unhandled
        AttributeError: no response, a dropped connection and a traceback in the
        journal. Going through this instead means a caller never has to guard
        against the body being the wrong *shape*, only the wrong *values*.
        """
        data = self._read_json()
        if data is None:
            return None
        if not isinstance(data, dict):
            self._send({"error": "bad request"}, 400)
            return None
        return data
