#!/usr/bin/env python3
"""RoomCAD V2 save + live-collaboration API (SQLite-backed).

Rooms are stored in a SQLite database (WAL mode) instead of .rcad files, and
every save is kept as a new version. Also streams live updates to anyone
watching a room (Server-Sent Events). Runs behind Caddy via a reverse proxy
on /api/* (127.0.0.1:8078).

This file is the runnable entry point; the implementation is the `roomcad_api`
package beside it. **State and configuration live in `roomcad_api.state` and
must be rebound there, not here.** They are read at call time, so assigning to
a name on THIS module would be a silent no-op — and the one that silently
missed `state.DB_PATH` would point the server at the production database.
"""

from roomcad_api import state
from roomcad_api.app import (
    Handler,
    RoomCADServer,
    active_count,
    create_session,
    delete_room,
    destroy_session,
    digest_of,
    expire_live_drafts,
    get_conn,
    init_db,
    last_room_for_session,
    load_room,
    login_blocked,
    migrate,
    note_login_failure,
    note_login_success,
    notify,
    notify_live,
    password_matches,
    publish,
    remember_last_room,
    room_list,
    sanitize,
    save_room,
    session_hash,
    session_is_valid,
    versions,
)

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

if __name__ == "__main__":
    if not state.PASSWORD:
        print("WARNING: ROOMCAD_PASSWORD is not set — logins are disabled.", flush=True)
    get_conn()  # create DB + migrate on boot
    RoomCADServer((state.HOST, state.PORT), Handler).serve_forever()
