"""The threading HTTP server and this package's public surface.

`server.py` re-exports from here. State and configuration do NOT live here:
they live in `roomcad_api.state` and must be rebound there.
"""

import sys
from http.server import ThreadingHTTPServer

from .auth import (
    active_count,
    create_session,
    destroy_session,
    login_blocked,
    note_login_failure,
    note_login_success,
    password_matches,
    session_hash,
    session_is_valid,
)
from .db import (
    delete_room,
    get_conn,
    init_db,
    last_room_for_session,
    load_room,
    migrate,
    remember_last_room,
    room_list,
    sanitize,
    save_room,
    versions,
)
from .http import Handler
from .live import digest_of, expire_live_drafts, notify, notify_live, publish

__all__ = [
    "Handler",
    "RoomCADServer",
    "active_count",
    "create_session",
    "delete_room",
    "destroy_session",
    "digest_of",
    "expire_live_drafts",
    "get_conn",
    "init_db",
    "last_room_for_session",
    "load_room",
    "login_blocked",
    "migrate",
    "note_login_failure",
    "note_login_success",
    "notify",
    "notify_live",
    "password_matches",
    "publish",
    "remember_last_room",
    "room_list",
    "sanitize",
    "save_room",
    "session_hash",
    "session_is_valid",
    "versions",
]


class RoomCADServer(ThreadingHTTPServer):
    """Threading server that stays quiet about clients going away.

    A browser closing a tab aborts its event stream, which surfaces as a reset
    or broken pipe. That is entirely normal here — logging a traceback for each
    one would bury real errors in the journal.
    """

    daemon_threads = True

    # listen()'s backlog: how many connections the kernel finishes the TCP
    # handshake for and holds until this process accept()s them. socketserver's
    # default is 5, which is not a number anyone here chose and is far too
    # small for a page that opens an event stream per tab on top of ordinary
    # API traffic: once five are waiting, the kernel refuses or drops further
    # connections, so a burst reaches the user as a hung or failed request that
    # this process never even saw and cannot explain. 128 is above any realistic
    # burst for a shared room planner and is still a bound, so a flood cannot
    # grow the queue into memory nobody accounted for.
    request_queue_size = 128

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(
            exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)
        ):
            return
        super().handle_error(request, client_address)
