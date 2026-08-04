# RoomCAD

A native macOS planning tool for shophouses. It combines a realtime Swift + Metal walkthrough with a precise SwiftUI top-down editor for testing women-only rental-room layouts.

## Current survey model

All geometry uses metres internally and displays both metres and centimetres where useful.

| Measurement | Current value | Confidence |
| --- | ---: | --- |
| Window-to-window length | **16.44 m** | Confirmed by owner, 3 August 2026 |
| Inside width | 4.87 m | Read from handwritten sketch; needs confirmation |
| Clear ceiling height | 3.60 m | Estimated from photos; needs measurement |
| Stair/bath core length | 6.00 m | Supplied by owner |
| Stair/bath core width | 2.50 m | Read from sketch; needs confirmation |
| First upward step from long wall | 2.40 m | Confirmed by owner |
| Lower stair width | 1.15 m | Confirmed by owner |
| Bathroom depth | 1.75 m | Confirmed by owner |
| Free landing space beside lower opening | 1.32 × 3.50 m | Calculated from confirmed dimensions |
| Wall before rear window | 0.08 m | Confirmed by owner |
| Rear window to bathroom wall | 1.52 m | Confirmed by owner |
| Rear two-window width | 1.52 m | Inferred; not directly measured |
| Main floor tile module | 0.60 × 0.60 m | Inferred from supplied photos |
| Front glazing | Four elements | Confirmed by photos/sketch |
| Rear glazing | Two elements | Confirmed by photos/sketch |

The fixed shell includes the glossy grey-veined marble floor, white plaster, dark wood-look stair tiles, black steel railings, the stairwell opening, transverse upward flight, rear bathroom, four-element street window, and two-element rear window. The main floor uses a continuous 60 cm tile grid with a photo-matched 4 mm grout joint and per-tile marble variation. Across the measured rectangle this gives 9 positions (8 full tiles plus a 7 cm cut) by 28 positions (27 full tiles plus a 24 cm cut); the stair opening removes parts of several positions. The lower stair continues below the upper flight and bathroom. In 2D, current-floor architecture is solid while below-floor geometry is dashed purple.

> This is a layout visualisation tool, not a structural, fire-safety, ventilation, or permit drawing. Windowless rental rooms need professional review for Indonesian building, fire-egress, electrical, sanitation, and ventilation requirements before construction.

## Controls

### 3D walkthrough

- `W` / `S`: move forward / backward
- `A` / `D`: move left / right
- Mouse drag: look around
- `Space`: fly up
- `C`: fly down
- `Shift`: move faster
- Click the Metal view if movement keys are not active

The renderer targets 60 fps at Retina resolution with physically-inspired lighting, glossy procedural marble, glass, timber grain, and tiled surfaces. The base Apple M3 profile uses 2× MSAA to hold 60 fps; higher-tier Apple GPUs retain 4× MSAA. The live HUD reports measured FPS, vertex count, MSAA, and GPU name.

### 2D plan

- **Configure the grid**: enter any spacing from 1–50 cm in the Editor Grid inspector, or choose a 1, 2.5, 5, or 10 cm preset. The default is 5 cm. The visible grid and pointer coordinate follow the setting, while the exact measured shell edges remain available as snap targets.
- **Zoom the plan**: roll the mouse wheel over the 2D canvas, use the bottom-right zoom controls, or press `⌘+` / `⌘−`. Wheel zoom stays anchored to the pointer so the area under the mouse remains in view. Press `⌘0` or click the percentage to return to 100%; zoom is limited to 50–400%.
- **Rotate the plan**: use the left/right turn buttons beside the zoom controls, or press `⌘[` / `⌘]`, to rotate the entire 2D workspace in 90° steps. Geometry, snapping, panning, furniture direction arrows, dimensions, and the overview map follow the chosen orientation while every text label stays upright. Click the degree value to return to 0°.
- **Move around**: hold `Space` and drag, or drag with the middle mouse button, to pan. **Fit Plan** shows the whole room, **Fit Selection** frames the current object, and the overview map appears while zoomed in so any area is one click away.
- **Draw walls**: click one point and then another. Continue clicking to chain connected free-form wall segments, then choose **Finish**; alternatively, drag between two points to create one wall. Endpoints intelligently find room corners, wall ends, midpoints, intersections, and parallel/perpendicular directions before falling back to the configured grid. Hold `Shift` for 45° angle locks. The active wall bar also accepts an exact centimetre length and degree angle. Press `Esc` at any time to cancel the active wall chain or drag without creating a wall.
- **Edit walls**: choose Inspect and drag either blue endpoint to resize, or drag the middle of a wall to move the whole segment without changing its size. The inspector accepts exact length and angle values and preserves attached doors whenever the new wall remains large enough.
- **Place and position doors**: choose **Add Door** above Furniture in the sidebar (or use the Place Door toolbar icon), then click close to a wall. Each wall supports one 90 cm single-leaf door. The editor immediately switches to Inspect so the door can be dragged along the wall. Live labels show the door width and the remaining wall length in centimetres on both sides.
- **Furniture**: search the visual catalog and click an item. Move its placement ghost onto the plan—green means it fits, red means the space is occupied—then click to place as many as needed. Alignment guides appear near other furniture; `Esc` finishes placement. Dragging a catalog item directly onto the plan remains supported.
- **Move furniture**: choose Inspect, then click and drag an object; positions snap to the active grid and nearby object centres. Every object is locked to floor level in 3D, cannot overlap other furniture, and cannot be placed over the bathroom, upper stair flight, or lower stair opening.
- **Rotate furniture**: click an object to select it and press `B` to rotate clockwise through north, east, south, and west.
- **Select more**: `Shift`-click furniture to build a selection, then rotate, duplicate (`⌘D`), delete, or nudge it one grid step with the arrow keys. The Objects list provides an accessible outline for selecting walls, doors, and furniture by name.
- **Inspect**: click a wall or furniture object to view exact dimensions and editing controls. Right-click any completed wall to see its length in metres and centimetres or delete it directly.
- **Erase**: click furniture, a door, or a wall.
- **Tool keys**: `V` Inspect, `W` Draw Wall, `D` Place Door, and `E` Erase while the 2D plan is active. Delete removes the selected object.
- **Quick Start**: the first launch opens a five-step, game-style guide; reopen it any time from the Workspace section.
- **Snapshots and recovery**: name and save stable layout versions from the sidebar, then restore one with a click. Clear and example-replacement actions require confirmation and remain undoable.
- **Restore example**: loads a small two-wall/one-door layout; a fresh install starts with the measured shell empty.
- **Undo/redo**: use the arrow icons in the 2D toolbar or press `⌘Z` / `⇧⌘Z`. Every top-right toolbar icon explains its action when hovered.
- Layouts autosave in Application Support with visible saved status and can be exported as readable JSON.

Furniture uses compact Indonesian-market planning dimensions: a 90 × 200 cm single bed ([IKEA Indonesia example](https://www.ikea.co.id/en/catalog/products/30278708)), 70 × 70 cm square table ([local product example](https://www.ikea.co.id/in/produk/luar-ruang/kursi-makan-luar-ruang/visingso-visingso-spr-59621540)), 45 × 47 cm chair ([VIHALS](https://www.ikea.co.id/en/products/dining-chairs/non-upholstered-chairs/vihals-art-80592734)), and 100 × 60 cm two-door wardrobe (within [IKEA Indonesia's common two-door range](https://www.ikea.co.id/en/inspirations/how-to-measure-a-wardrobe-that-fits-your-bedroom)). These are editable-layout defaults rather than a legal furniture standard. Furniture position and orientation are included in autosave, JSON export, undo, and redo.

## Build and run

Requirements: Apple silicon Mac, macOS 14 or later, and Xcode command-line tools.

```bash
./script/build_and_run.sh
```

The script builds a stripped arm64 **release** binary by default, stages `dist/RoomCAD.app`, and launches it as a normal foreground macOS app. Use `./script/build_and_run.sh --debug` for an LLDB-ready debug build. The Codex **Run** action uses the optimized release path.

Validation commands:

```bash
swift test
./script/build_and_run.sh --verify
```

## Swift 6.3 and M3 optimization

- Swift tools 6.3, explicit Swift 6 language mode, strict concurrency, and strict-memory-safety auditing.
- Swift 6.3 `@concurrent` cancellable mesh construction keeps wall edits off the main actor.
- Explicit `unsafe` annotations are limited to reviewed AppKit and Metal raw-pointer boundaries.
- Metal 4 shader compilation on macOS 26, Metal 3.2 on macOS 15, and Metal 3.1 fallback on macOS 14.
- Fast Metal math on supported systems, with opaque and translucent geometry in separate optimized pipelines.
- Opaque surfaces avoid blending; glass blends without writing depth, improving both performance and correctness.
- Static mesh arrays reserve capacity and use shared unified memory suited to Apple silicon.
- The 2D Canvas renders an immutable `Sendable` snapshot asynchronously, keeping drawing gestures responsive.
- The packaged executable is arm64-only, stripped, and ad-hoc signed after bundling. The measured bundle binary is approximately 500 KB versus the previous 1.2 MB debug bundle.

On the target MacBook Air M3 (8-core CPU, 16 GB), the corrected stacked-core scene measured 60 fps with 3,060 vertices and 2× MSAA. A five-second Metal System Trace of the renderer showed no command-buffer errors, potential hangs, or runtime shader compilation during steady rendering.

## Project structure

- `Models/`: survey, wall, door, and floor-aligned furniture geometry in real-world units
- `Stores/`: layout editing, validation, undo/redo, autosave, and export
- `Views/`: desktop split layout, survey inspector, walkthrough HUD, and 2D editor
- `Metal/`: `MTKView` bridge, camera controls, procedural mesh builder, and Metal shaders
- `Tests/`: survey, geometry, editing invariant, and undo coverage

The source photos remain local in `Pix/` and are ignored by Git; no private location imagery is packaged into the app.
