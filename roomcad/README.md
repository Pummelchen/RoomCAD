# RoomCAD — web app

This directory is the web edition of [RoomCAD](../README.md): a browser-based
room planner (vanilla JavaScript ES modules + Three.js + Rapier), served by
Caddy. See the root README for what it does, and the
[wiki](https://github.com/Pummelchen/RoomCAD/wiki) for guides and hosting.

## Run locally

```bash
# 1. the API (save, versions, live collaboration)
ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=letmein \
  python3 server/server.py &          # 127.0.0.1:8078

# 2. the app
cd web && ./serve.sh                  # http://localhost:8080
```

`web/Caddyfile` proxies `/api/*` to the API, so save, version history and live
collaboration all work locally. Start only `serve.sh` and the app still loads,
but reports "server not reachable" for anything server-side.

The first `serve.sh` run downloads Caddy into `web/bin/` (git-ignored).
Three.js and Rapier are vendored in `web/lib/`, so the page works offline.
The 3D view needs a **WebGPU**-capable browser.

## Layout

| Path | Contains |
| --- | --- |
| `web/plan.js` | room model, grid, snapping, wall geometry, joins, auto-layout, `.rcad` format |
| `web/store.js` | editing state, tools, undo/redo, save/open, remote-apply |
| `web/editor2d.js` | 2D plan canvas |
| `web/walk3d.js` | Three.js 3D walkthrough (Rapier physics, real sun, lighting, bloom) |
| `web/app.js` | UI glue: toolbar, inspector, keyboard, files, live collaboration |
| `web/audio.js` | procedural sound effects |
| `web/login.js` | password gate + cookie |
| `web/version.js` | the single visible release number |
| `web/lib/` | vendored Three.js, Rapier and post-processing modules |
| `server/` | the Python API, systemd unit, Caddy/nginx configs, DB dump, `deploy.sh` |

`server/` mirrors the production VPS so it can be rebuilt from git — see
[Hosting and Deployment](https://github.com/Pummelchen/RoomCAD/wiki/Hosting-and-Deployment).

## Controls

Full key map in the
[2D Editor Guide](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide)
and [3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough).
