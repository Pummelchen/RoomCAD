# RoomCAD

RoomCAD is a native macOS space-planning app for measured shophouse interiors. It combines a precise SwiftUI 2D editor with a real-time Swift and Metal 3D walkthrough so room, wall, door, and furniture ideas can be tested in one place.

The included concept focuses on compact women-only rental rooms around an existing stair and bathroom core. RoomCAD is also a general manual layout editor: walls can be drawn freely on a configurable grid, doors can be attached to walls, furniture can be arranged, and complete designs can be saved as `.rcad` files.

> RoomCAD is an actively developed planning prototype. It is not a structural, architectural, fire-safety, ventilation, accessibility, or permit tool. Have every construction or rental layout reviewed against Indonesian law and local building requirements by qualified professionals.

## Project status

- Native Apple silicon macOS application built with Swift 6.3, SwiftUI, AppKit, and Metal.
- Requires macOS 14 or later and Xcode command-line tools.
- Builds and runs from source; no notarized binary release is currently published.
- Uses an ad hoc signature for local development builds.
- The measured shell contains confirmed, inferred, and photo-estimated dimensions. Confidence is shown in the app and documented in the [survey guide](https://github.com/Pummelchen/RoomCAD/wiki/Demo-Layout-and-Survey).
- Source photos remain local in `Pix/`, which is ignored by Git. Private location imagery is not packaged into the app.

## Highlights

- **Grid-snapped wall drawing** — choose any grid spacing from 1–50 cm, draw connected free-form wall chains, enter exact lengths and angles, use smart endpoint/alignment snapping, and cancel safely with `Esc`.
- **Wall-mounted doors** — place a door on a wall, slide it into position, see the remaining wall length on both sides in centimetres, change its width from 60–200 cm when the wall allows, and flip its hinge.
- **Easy furniture placement** — place beds, tables, chairs, and wardrobes with collision feedback, grid snapping, alignment guides, corner magnets, rotation, duplication, nudging, and multi-selection.
- **Friendly 2D navigation** — mouse-wheel and keyboard zoom, pointer-anchored zooming, space-drag panning, Fit Plan, Fit Selection, an overview map, and 90° plan rotation with upright labels.
- **Editable room labels** — double-click a room to name it; labels remain upright under rotation and persist in files, snapshots, recovery, Undo, and Redo.
- **Realtime 3D walkthrough** — explore the same layout with keyboard and mouse controls in a Metal renderer with adaptive MSAA and an on-screen performance HUD.
- **Recoverable editing** — Undo/Redo, named snapshots, recovery autosave, confirmation before destructive layout replacement, and complete `.rcad` save/open workflows.
- **Accessible desktop UI** — resizable windows, an object outline, keyboard tool shortcuts, a first-run Quick Start guide, and immediate text hints for toolbar icons.

## Included seven-room demo

A fresh workspace contains a furnished, bathroom-connected concept plan:

- six approximately 6.0–6.3 m² front rooms beside a 1.15 m main walkway;
- a 90 cm turn around the lower stair opening;
- a 1.30 m stair-side route, with an 80 cm narrowest transition, continuing to the bathroom;
- an approximately 7.2 m² L-shaped Room 7 beside both stair zones and extended to the complete two-pane rear window;
- one private corridor entrance, single bed, wardrobe, and chair for every room; and
- an unobstructed rear-window alcove in Room 7.

The dense demo demonstrates editor behavior and space relationships. It does **not** establish legal room size, corridor width, egress, accessibility, occupancy, sanitation, or ventilation compliance.

## Build and run

```bash
git clone https://github.com/Pummelchen/RoomCAD.git
cd RoomCAD
./script/build_and_run.sh
```

The script builds a stripped arm64 release binary, stages `dist/RoomCAD.app`, signs the complete bundle with an ad hoc identity, and launches it. Other useful modes are:

```bash
./script/build_and_run.sh --debug      # Build and open the executable in LLDB
./script/build_and_run.sh --logs       # Run with the process log stream
./script/build_and_run.sh --telemetry  # Run with the RoomCAD subsystem log stream
./script/build_and_run.sh --verify     # Build, launch, and verify the process starts
```

## Essential controls

| Action | Control |
| --- | --- |
| Switch to 3D / 2D | `⌘1` / `⌘2` |
| Inspect / Draw Wall / Place Door / Erase | `V` / `W` / `D` / `E` |
| Cancel wall or placement action | `Esc` |
| Zoom in / out / reset | Mouse wheel or `⌘+` / `⌘−` / `⌘0` |
| Rotate plan left / right | `⌘[` / `⌘]` |
| Pan the plan | `Space`-drag or middle-mouse drag |
| Rotate selected furniture | `B` |
| Duplicate selected furniture | `⌘D` |
| Nudge selected furniture | Arrow keys |
| Delete selected object | Delete or Backspace |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Open / Save / Save As | `⌘O` / `⌘S` / `⇧⌘S` |

The 3D walkthrough uses `W`/`S` to move forward/back, `A`/`D` to move sideways, mouse drag to look, `Space`/`C` to move vertically, and `Shift` to move faster.

See the [2D Editor Guide](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide) and [3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough) pages for full instructions.

## RoomCAD design files

Normal designs use the `.rcad` extension. The versioned UTF-8 JSON envelope stores the complete measured shell, partitions, doors, furniture, room labels, dimensions, and grid settings. The packaged app registers the `application/vnd.roomcad+json` type so designs can be opened from Finder.

RoomCAD still reads the former `.roomcad` extension and legacy raw JSON exports, then asks the user to save them in the current format. Files above 50 MB, unknown future versions, unsupported units, duplicate identifiers, and corrupt data are rejected safely.

Recovery autosave and named snapshots are local safety nets; a user-owned `.rcad` file remains the portable design document. Read [File Format and Recovery](https://github.com/Pummelchen/RoomCAD/wiki/File-Format-and-Recovery) for details.

## Current survey summary

RoomCAD uses metres internally and displays metres or centimetres where each is clearest.

| Measurement | Current value | Confidence |
| --- | ---: | --- |
| Window-to-window length | **16.44 m** | Confirmed by owner, 3 August 2026 |
| Inside width | 4.87 m | Sketch-derived; needs confirmation |
| Clear ceiling height | 3.60 m | Photo estimate; needs measurement |
| Stair/bath core | 6.00 × 2.50 m | Length supplied; width needs confirmation |
| First upward step from long wall | 2.40 m | Confirmed by owner |
| Lower stair width | 1.15 m | Confirmed by owner |
| Bathroom depth | 1.75 m | Confirmed by owner |
| Rear two-window width | 1.52 m | Inferred; not directly measured |
| Main floor tile module | 0.60 × 0.60 m | Inferred from photos |

The complete measurement table and fixed-core interpretation are maintained in [Demo Layout and Survey](https://github.com/Pummelchen/RoomCAD/wiki/Demo-Layout-and-Survey).

## Development and validation

```bash
swift test
./script/build_and_run.sh --verify
```

The test suite covers survey geometry, configurable snapping, wall and door editing, furniture collision rules, room naming, plan rotation and zoom, Undo/Redo, snapshots, demo-route invariants, and `.rcad` migration and validation.

Project layout:

- `Sources/RoomCADApp/App/` — application entry point, menus, and window scene
- `Sources/RoomCADApp/Models/` — survey, plan, wall, door, furniture, and file-format models
- `Sources/RoomCADApp/Stores/` — editing state, validation, Undo/Redo, snapshots, recovery, and document workflows
- `Sources/RoomCADApp/Views/` — split desktop UI, 2D editor, inspector, Quick Start, and 3D walkthrough
- `Sources/RoomCADApp/Metal/` — `MTKView` integration, camera, procedural mesh building, and shaders
- `Tests/RoomCADAppTests/` — model, editing, persistence, and regression tests
- `script/build_and_run.sh` — local bundle, signing, launch, logging, and verification workflow

Technical architecture, performance choices, and validation guidance live in [Architecture and Development](https://github.com/Pummelchen/RoomCAD/wiki/Architecture-and-Development).

## Documentation

- [Wiki home](https://github.com/Pummelchen/RoomCAD/wiki)
- [Getting Started](https://github.com/Pummelchen/RoomCAD/wiki/Getting-Started)
- [2D Editor Guide](https://github.com/Pummelchen/RoomCAD/wiki/2D-Editor-Guide)
- [3D Walkthrough](https://github.com/Pummelchen/RoomCAD/wiki/3D-Walkthrough)
- [Demo Layout and Survey](https://github.com/Pummelchen/RoomCAD/wiki/Demo-Layout-and-Survey)
- [File Format and Recovery](https://github.com/Pummelchen/RoomCAD/wiki/File-Format-and-Recovery)
- [Architecture and Development](https://github.com/Pummelchen/RoomCAD/wiki/Architecture-and-Development)
- [Troubleshooting](https://github.com/Pummelchen/RoomCAD/wiki/Troubleshooting)

## License

This repository currently has no license file. Unless a license is added, copyright law reserves reuse and redistribution rights to the repository owner.
