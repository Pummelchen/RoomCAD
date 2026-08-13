# RoomCAD V2

A clean-sheet, kid-friendly room planner for macOS. Draw walls on a simple
grid, click doors and windows into walls and slide them with live centimeter
readouts, drop in furniture, then walk around the result in 3D.

This is a from-scratch rebuild (no code shared with the V1 prototype). It uses
a standard SwiftUI window — normal title bar, system resize/minimize/maximize —
and keeps the feature set deliberately small.

## Features

- **1 / 2 / 5 cm grid** — switch anytime; walls, openings, and furniture snap to it
- **Wall drawing** — drag on the plan; endpoints snap to the grid, room corners, and other walls
- **Doors and windows** — click a wall to add one, drag it along the wall to slide, see the cm spacing to the wall ends and neighboring openings while you move it
- **Furniture** — bed, table, chair, wardrobe; drag to move, `B` or the inspector to turn 90°
- **2D plan and 3D walk** — switch with the toolbar picker (⌘1 / ⌘2); walk with WASD or arrow keys and look with the mouse
- **Multiple rooms** — each room is its own `.room` file; save to `~/Documents/RoomCAD` and reopen from the "My Rooms" sidebar
- **Undo / redo** (⌘Z / ⇧⌘Z), erase tool, Esc to cancel, status hints at the bottom

## Build and run

```bash
cd V2
swift run            # fastest way to try it
./script/build.sh    # build a release .app in V2/dist and launch it
./script/build.sh --verify   # build, launch, verify the process starts
swift test           # run the geometry and file tests
```

## Project layout

- `Sources/RoomCADV2/Models/` — room model, grid, snapping, opening spacing, 3D wall slicing, file format
- `Sources/RoomCADV2/Stores/` — editing state, tools, undo/redo, save/open
- `Sources/RoomCADV2/Views/` — 2D plan editor, inspector, 3D walkthrough (SceneKit), window and menus
- `Tests/RoomCADV2Tests/` — geometry, snapping, spacing, and file round-trip tests

## Controls

| Action | Control |
| --- | --- |
| Select / Wall / Door / Window / Erase | `V` / `W` / `D` / `G` / `E` |
| Cancel placement | `Esc` |
| Turn selected furniture | `B` |
| Nudge selected furniture | Arrow keys |
| Delete selection | Delete |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| 2D / 3D | `⌘1` / `⌘2` |
| New / Open / Save / Save As | `⌘N` / `⌘O` / `⌘S` / `⇧⌘S` |
| Zoom the plan | Mouse wheel, around the cursor |
| Pan the plan | `Space`-drag or middle-mouse drag |

## Web version (`web/`)

The same room planner also runs in the browser, served by a local Caddy server.
It shares the exact `.room` file format with the native app, so rooms move
between the two freely.

```bash
cd V2/web
./serve.sh                 # starts Caddy on http://localhost:8080
```

The first run downloads the Caddy binary into `web/bin/` (git-ignored).
Three.js is vendored in `web/lib/`, so the page works offline.

Web differences from the native app:

- **Save** downloads a `.room` file (same format as the native app) and also
  stores a copy in the browser's "My Rooms" sidebar (localStorage) for quick
  multi-room editing.
- **Open** loads a `.room` file from disk.
- Same tools, grid, cm measurement chips, furniture, and first-person 3D walk
  (click the 3D view to look around, click again to stop, `WASD`/arrows to walk).
- Dark theme, walls lock to 90° angles, furniture lives in the sidebar as a
  toggleable icon palette, and the default room is the original seven-room
  survey demo (the bathroom and stair placeholders were removed — the whole
  floor is now usable).
- Turn the whole plan in 90° steps with the toolbar ⟲/⟳ buttons or ⌘[ / ⌘]
  while every label stays upright — handy for the long 16.44 m room.
- The 3D walkthrough is lit like daytime (bright sun + sky bounce) even though
  the app chrome is dark. The 11 photos from the repo's `Pix/` folder are
  copied into `web/photos/` (git-ignored). The floor is a true 60 × 60 cm tile
  grid — 8 full tiles + 7 cm cut strip across, 27 full + 24 cm cut down, per
  the photo-derived survey module — with the real floor photo as the surface
  (`FLOOR_PHOTO` in `walk3d.js`; swap it to use a different photo).
