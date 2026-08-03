# Laundry Rooms Planner

A native macOS planning tool for the first floor of an Indonesian shophouse. It combines a realtime Swift + Metal walkthrough with a precise SwiftUI top-down editor for testing women-only rental-room layouts.

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
| Landing beside lower opening | 1.32 × 3.50 m | Calculated from confirmed dimensions |
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

- **Draw wall**: drag between endpoints; coordinates snap to the configured 5 cm grid.
- **Place door**: click close to a wall. Each wall supports one 90 cm single-leaf door; placing again moves it.
- **Inspect**: click a wall to view its exact endpoints and length, flip its hinge, or delete it.
- **Erase**: click a door or wall.
- **Restore example**: loads a small two-wall/one-door layout; a fresh install starts with the measured shell empty.
- Undo/redo: `⌘Z` / `⇧⌘Z`.
- Layouts autosave in Application Support and can be exported as readable JSON.

## Build and run

Requirements: Apple silicon Mac, macOS 14 or later, and Xcode command-line tools.

```bash
./script/build_and_run.sh
```

The script builds a stripped arm64 **release** binary by default, stages `dist/LaundryRooms.app`, and launches it as a normal foreground macOS app. Use `./script/build_and_run.sh --debug` for an LLDB-ready debug build. The Codex **Run** action uses the optimized release path.

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
- The packaged executable is arm64-only, stripped, and ad-hoc signed after bundling. The measured bundle binary is approximately 424 KB versus the previous 1.2 MB debug bundle.

On the target MacBook Air M3 (8-core CPU, 16 GB), the corrected stacked-core scene measured 60 fps with 3,060 vertices and 2× MSAA. A five-second Metal System Trace of the renderer showed no command-buffer errors, potential hangs, or runtime shader compilation during steady rendering.

## Project structure

- `Models/`: survey, wall, and door geometry in real-world units
- `Stores/`: layout editing, validation, undo/redo, autosave, and export
- `Views/`: desktop split layout, survey inspector, walkthrough HUD, and 2D editor
- `Metal/`: `MTKView` bridge, camera controls, procedural mesh builder, and Metal shaders
- `Tests/`: survey, geometry, editing invariant, and undo coverage

The source photos remain local in `Pix/` and are ignored by Git; no private location imagery is packaged into the app.
