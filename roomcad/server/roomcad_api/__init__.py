"""RoomCAD's API implementation, split out of the single-file server.

`roomcad/server/server.py` remains the runnable entry point and re-exports this
package's public surface. Configuration and mutable state live in
`roomcad_api.state` — rebound them THERE, because a rebind on any other module
would be a silent no-op.
"""
