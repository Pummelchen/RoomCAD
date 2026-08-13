# RoomCAD V2

A clean-sheet, kid-friendly room planner that runs in the browser. Draw walls
on a simple grid, click doors and windows into walls and slide them with live
centimeter readouts, drop in furniture and ceiling lights, then walk around
the result in a first-person 3D view.

This is a from-scratch rebuild (no code shared with the V1 prototype) and is
**web-only**: vanilla JavaScript ES modules + Three.js, served by Caddy.

## Features

- **1 / 2 / 5 cm grid** — switch anytime; walls, openings, and furniture snap to it
- **Wall drawing** — drag on the plan; 90°-only walls with a live cm length readout and green snap dots
- **Doors and windows** — click a wall to add one, drag it to slide, see the cm spacing to wall ends and neighbors; doors open/close (double-click) and swing inside/outside
- **Furniture and fixtures** — bed, table, chair, wardrobe, plus a ceiling-mounted 60 W light; drag to move, `B` to turn
- **2D plan and 3D walk** — switch with the toolbar (⌘1 / ⌘2); walk with WASD/arrows, look with the mouse, jump/double-jump (Space), crouch (C)
- **Rapier physics** — the 3D walk uses the Rapier engine for collision, jumping onto furniture, and closed-door blocking
- **Daytime 3D scene** — PBR materials, real shadow mapping, image-based lighting, bloom post-processing, a white marble tile floor, and a procedural city visible through the windows
- **Multiple rooms** — each room is its own `.room` file; save and reopen from the "My Rooms" sidebar (localStorage)
- **Undo / redo** (⌘Z / ⇧⌘Z), erase tool, Esc to cancel, status hints at the bottom

## Run locally

```bash
cd V2/web
./serve.sh                 # starts Caddy on http://localhost:8080
```

The first run downloads the Caddy binary into `web/bin/` (git-ignored).
Three.js, Rapier, and the post-processing modules are vendored in `web/lib/`,
so the page works offline.

## Project layout

- `web/plan.js` — room model, grid, snapping, geometry, opening spacing, `.room` file format
- `web/store.js` — editing state, tools, undo/redo, save/open
- `web/editor2d.js` — 2D plan canvas
- `web/walk3d.js` — Three.js 3D walkthrough (Rapier physics, city, lighting, bloom)
- `web/app.js` — UI glue: toolbar, inspector, keyboard, files
- `web/lib/` — vendored Three.js, Rapier, RoomEnvironment, and post-processing modules

## Controls

| Action | Control |
| --- | --- |
| Select / Wall / Door / Window / Erase | `V` / `W` / `D` / `G` / `E` |
| Furniture / Light | `F` (toggles last used) or the sidebar |
| Cancel placement | `Esc` |
| Turn selected furniture | `B` |
| Nudge selected furniture | Arrow keys |
| Delete selection | Delete |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| 2D / 3D | `⌘1` / `⌘2` |
| New / Open / Save | `⌘N` / `⌘O` / `⌘S` |
| Rotate plan 90° | `⌘[` / `⌘]` |
| Zoom the plan | Mouse wheel, around the cursor |
| Pan the plan | `Space`-drag or middle-mouse drag |
| Walk | `WASD` / arrows |
| Jump / double-jump | `Space` |
| Crouch | `C` |
| Look around | click (toggle) |
| Door swing (3D) | right-click on a door |
