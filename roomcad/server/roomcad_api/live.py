"""Unsaved live drafts and their fan-out to every watcher of a room.

Configuration and shared state are read from `state` at call time — see
state.py.
"""

import hashlib
import json
import queue
import time

from . import state


def publish(q, payload):
    """Queue a payload, discarding the oldest if the watcher has fallen behind."""
    try:
        q.put_nowait(payload)
        return
    except queue.Full:
        pass
    try:
        q.get_nowait()
    except queue.Empty:
        pass
    try:
        q.put_nowait(payload)
    except queue.Full:
        pass


def notify(name, room_json, client_id, version, seq=None):
    payload = json.dumps(
        {"name": name, "json": room_json, "clientId": client_id, "version": version, "seq": seq}
    )
    with state.WATCH_LOCK:
        queues = list(state.WATCHERS.get(name, set()))
    for q in queues:
        publish(q, payload)


def digest_of(room_json):
    """A short fingerprint of a room, for asking "are we the same?" without
    sending the whole thing. The client computes it the same way over the same
    UTF-8 bytes, so the two can only agree by actually agreeing."""
    return hashlib.sha256(room_json.encode("utf-8")).hexdigest()


def notify_live(name, draft):
    """Broadcast an unsaved live draft to every watcher of a room."""
    payload = json.dumps(
        {
            "name": name,
            "json": draft["json"],
            "clientId": draft["clientId"],
            "version": draft["version"],
            "seq": draft.get("seq"),
            "live": True,
        }
    )
    with state.WATCH_LOCK:
        queues = list(state.WATCHERS.get(name, set()))
    for q in queues:
        publish(q, payload)


def expire_live_drafts():
    """Drop unsaved drafts nobody has updated for a while."""
    cutoff = time.time() - state.LIVE_DRAFT_TTL_SECONDS
    with state.LIVE_LOCK:
        for key in [k for k, v in state.LIVE.items() if v.get("at", 0) < cutoff]:
            del state.LIVE[key]
