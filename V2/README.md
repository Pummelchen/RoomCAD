# RoomCAD V2 — web app

This directory is the web edition of [RoomCAD](../../README.md): a
browser-based room planner (vanilla JavaScript ES modules + Three.js +
Rapier), served by Caddy. See the root README for what the app does and the
[wiki](https://github.com/Pummelchen/RoomCAD/wiki) for guides and hosting
details.

## Run locally

```bash
cd V2/web
./serve.sh          # starts Caddy on http://localhost:8080
```

The first run downloads the Caddy binary into `web/bin/` (git-ignored).
Three.js, Rapier and the post-processing modules are vendored in `web/lib/`,
so the page works offline.

> The local server has no backend, so **Save** and the room list report
> "server not reachable" there. Use a deployment with the Python API for the
> full save / versioning / live-collaboration experience.

## Project layout

- `web/plan.js` — room model, grid, snapping, geometry, opening spacing, `.rcad` file format
- `web/store.js` — editing state, tools, undo/redo, save/open, remote-apply
- `web/editor2d.js` — 2D plan canvas
- `web/walk3d.js` — Three.js 3D walkthrough (Rapier physics, city, sun, lighting, bloom)
- `web/app.js` — UI glue: toolbar, inspector, keyboard, files, live collaboration
- `web/audio.js` — procedural sound effects (paintball, door)
- `web/login.js` — password gate + cookie
- `web/lib/` — vendored Three.js, Rapier, RoomEnvironment, and post-processing modules

The backend (Python API + SQLite) lives on the server and is documented in
[Server API and Storage](https://github.com/Pummelchen/RoomCAD/wiki/Server-API-and-Storage).

## Controls

See the [2D Editor Guide](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide)
and [3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough)
wiki pages for the full key map.
