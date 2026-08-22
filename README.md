# RoomCAD

RoomCAD is a kid-friendly room planner that runs entirely in the browser. Draw
walls, drop in doors, windows, furniture and ceiling lights on a
centimetre-accurate 2D plan, then walk through the result in a real-time 3D
view — with physics, daylight and a city outside the windows.

No installation, no native build. It is a quick, simple planning tool — not a
structural, architectural or building-code tool.

## What it can do

- **Draw walls** on a 1 / 2 / 5 cm grid (90° only) with a live length readout in centimetres.
- **Place doors and windows** in walls and slide them with exact spacing to the wall ends and neighbours.
- **Arrange furniture** (bed, table, chair, wardrobe) and a ceiling-mounted light.
- **Walk the room in 3D** — real physics (jump onto furniture, crouch, double-jump), soft shadows, and a day/night sky you set with a 24 h time-of-day control (sun, twilight and city lights follow it).
- **Save rooms to the server** (SQLite, versioned) and reopen them from the sidebar.
- **Edit together live** — several people can open the same room and see each other's changes in real time.
- **One shared password** (checked server-side) protects the site.

## Quick start

Open the deployed site and enter the password. To run it locally, start the
backend, then the static server:

```bash
ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=ternak \
  python3 roomcad/server/server.py &   # API on 127.0.0.1:8078
cd roomcad/web
./serve.sh                             # static + /api proxy on http://localhost:8080
```

## Essential controls

| Action | Key |
| --- | --- |
| Select / Wall / Door / Window / Erase | `V` / `W` / `D` / `G` / `E` |
| Furniture / Light | sidebar, or `F` |
| Rotate furniture | `R` |
| 2D plan / 3D walk | `⌘1` / `⌘2` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Walk / look | `WASD` / mouse |
| Jump (×2) / crouch | `Space` / `C` |

Drag either divider beside the plan to resize the left tool panel or right
inspector. RoomCAD remembers those widths in your browser for your next visit.

## Development

The 3D view uses Three.js **WebGPU (`REVISION = "186dev"`)**, vendored under
`roomcad/web/lib/` (including the city/skyscraper/terrain/tree generators).
Physics is Rapier (WASM). There is no build step — the app is plain ES modules
loaded via an import map.

The current visible release is defined once in
[`roomcad/web/version.js`](roomcad/web/version.js). Increment it for every
deployed user-facing fix so the footer always identifies the running release.

## Documentation

Everything else lives in the [wiki](https://github.com/Pummelchen/RoomCAD/wiki):

- [Getting Started](https://github.com/Pummelchen/RoomCAD/wiki/Getting-Started)
- [2D Editor Guide](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide)
- [3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough)
- [Hosting and Deployment](https://github.com/Pummelchen/RoomCAD/wiki/Hosting-and-Deployment)
- [Server API and Storage](https://github.com/Pummelchen/RoomCAD/wiki/Server-API-and-Storage)
- [Live Collaboration](https://github.com/Pummelchen/RoomCAD/wiki/Live-Collaboration)
- [File Format](https://github.com/Pummelchen/RoomCAD/wiki/File-Format)
- [Architecture and Development](https://github.com/Pummelchen/RoomCAD/wiki/Architecture-and-Development)
- [Troubleshooting](https://github.com/Pummelchen/RoomCAD/wiki/Troubleshooting)

## License

MIT — see [LICENSE](LICENSE).
