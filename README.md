# RoomCAD

RoomCAD is a kid-friendly room planner that runs entirely in the browser. Draw
walls on a centimetre-accurate 2D plan, drop in doors, windows, furniture and
ceiling lights, then walk through the result in real-time 3D — with physics and
real daylight.

No installation, no build step. It is a quick planning tool — not a structural,
architectural or building-code tool.

## What it can do

- **Draw walls** on a 1 / 2 / 5 cm grid (90° only). Ends lock onto any wall
  they meet, so rooms close cleanly instead of overshooting or stopping short.
- **Read every size at a glance** — walls, doors and windows carry permanent
  CAD-style dimension lines, and there is a measure tool for anything else.
- **Grab the red handles** on a selected wall, door, window or public area to
  drag either end and resize it in place.
- **Place doors and windows** in walls and slide them with exact spacing to the
  wall ends and neighbours. Doors open, close and swing to either side.
- **Label the plan** — drop text anywhere; it turns with the plan and stays
  the right way up.
- **Mark shared (public) floor space**, with live side lengths while you drag
  it out. Public areas are selectable, resizable and deletable.
- **Furnish** with ten pieces — bed, table, chair, wardrobe, desk, sofa,
  bookshelf, nightstand, dresser, armchair — plus two ceiling lights
  (60 W bulb, 200 W office panel).
- **Auto-lay-out a floor**: choose how many rooms and the target m², and
  RoomCAD partitions the space into rooms with doors and optional windows.
  *Redesign* reshuffles it; marked public areas are left alone.
- **Walk the room in 3D** — real physics (jump onto furniture, double-jump,
  crouch), soft shadows, and a day/night sky you set with a 24 h time-of-day
  control driven by a real Singapore sun position, under a drifting cloud deck.
- **See it in a city** — the room stands in a stylised neighbourhood of
  streets, blocks, traffic and trees, so you can judge the space against
  something real. Windows and street lamps come on after dark.
- **Build solid rooms** — walls render as sealed solids that bite into the
  floor, the ceiling and each other. Only doors and windows let light through.
- **Save rooms to the server** (SQLite, versioned). New sessions open the
  latest saved design; returning browsers resume their exact last version.
- **Edit together live** — when another member is present, **Join Live** pulses
  green; **Live Active** syncs edits both ways, and **Leave Live Mode** saves
  once for everyone before detaching.
- **One shared password**, checked server-side.

## Quick start

Open the deployed site and enter the password. To run it locally, start the
backend, then the static server:

```bash
ROOMCAD_DB_PATH=/tmp/roomcad.db ROOMCAD_PASSWORD=ternak \
  python3 roomcad/server/server.py &   # API on 127.0.0.1:8078
cd roomcad/web && ./serve.sh           # app on http://localhost:8080
```

## Essential controls

| Action | Key |
| --- | --- |
| Select / Wall / Door / Window | `V` / `W` / `D` / `G` |
| Erase / Measure / Furniture | `E` / `M` / `F` |
| Label | `T` |
| Turn furniture or label / delete | `R` / `⌫` |
| Nudge selection | arrow keys |
| 2D plan / 3D walk | `⌘1` / `⌘2` |
| Turn the plan | `⌘[` / `⌘]` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Save / Open | `⌘S` / `⌘O` |
| Walk / look | `WASD` / mouse |
| Jump (×2) / crouch | `Space` / `C` |
| Lights on–off (3D) | `L` |

Drag either divider beside the plan to resize the tool panel or the inspector;
RoomCAD remembers the widths for your next visit. The shared password
identifies a RoomCAD project — a first-time browser opens its latest saved
version, and after that its own saved or opened design is remembered
server-side. Unsaved edits still need **Save**.

## Development

The 3D view uses Three.js **WebGPU** (`REVISION = "186dev"`) and Rapier (WASM),
both vendored under `roomcad/web/lib/`. There is no build step — the app is
plain ES modules loaded through an import map.

```bash
for t in tests/*.mjs; do node "$t"; done   # geometry, layout, UI contracts
python3 tests/server-live.test.py          # API integration (spawns a server)
```

The visible release is defined once in
[`roomcad/web/version.js`](roomcad/web/version.js) — increment it for every
deployed user-facing fix. Deploy with
[`roomcad/server/deploy.sh`](roomcad/server/deploy.sh); it never touches the
live database or the password file.

## Documentation

Guides live in the [wiki](https://github.com/Pummelchen/RoomCAD/wiki):
[Getting Started](https://github.com/Pummelchen/RoomCAD/wiki/Getting-Started) ·
[2D Editor](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide) ·
[3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough) ·
[Live Collaboration](https://github.com/Pummelchen/RoomCAD/wiki/Live-Collaboration) ·
[Server API and Storage](https://github.com/Pummelchen/RoomCAD/wiki/Server-API-and-Storage) ·
[File Format](https://github.com/Pummelchen/RoomCAD/wiki/File-Format) ·
[Hosting and Deployment](https://github.com/Pummelchen/RoomCAD/wiki/Hosting-and-Deployment) ·
[Architecture](https://github.com/Pummelchen/RoomCAD/wiki/Architecture-and-Development) ·
[Troubleshooting](https://github.com/Pummelchen/RoomCAD/wiki/Troubleshooting)

## License

MIT — see [LICENSE](LICENSE).
