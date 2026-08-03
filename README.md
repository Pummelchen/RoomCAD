# Laundry Rooms Planner

A native macOS planning tool for the first floor of an Indonesian shophouse. It combines a realtime Swift + Metal walkthrough with a precise SwiftUI top-down editor for testing women-only rental-room layouts.

## Current survey model

All geometry uses metres internally and displays both metres and centimetres where useful.

| Measurement | Current value | Confidence |
| --- | ---: | --- |
| Window-to-window length | **16.44 m** | Confirmed by owner, 3 August 2026 |
| Inside width | 4.87 m | Read from handwritten sketch; needs confirmation |
| Clear ceiling height | 3.60 m | Estimated from photos; needs measurement |
| Stair/bath core length | 6.00 m | Read from sketch; needs confirmation |
| Stair/bath core width | 2.50 m | Read from sketch; needs confirmation |
| Front glazing | Four elements | Confirmed by photos/sketch |
| Rear glazing | Two elements | Confirmed by photos/sketch |

The fixed shell includes the glossy grey-veined marble floor, white plaster, dark wood-look stair tiles, black steel railings, the stairwell opening, upward flight, rear bathroom, four-element street window, and two-element rear window. Architectural positions other than the confirmed length are deliberately editable in the survey inspector.

> This is a layout visualisation tool, not a structural, fire-safety, ventilation, or permit drawing. Windowless rental rooms need professional review for Indonesian building, fire-egress, electrical, sanitation, and ventilation requirements before construction.

## Controls

### 3D walkthrough

- `W`, `A`, `S`, `D`: move
- Mouse drag: look around
- `Space`: fly up
- `C`: fly down
- `Shift`: move faster
- Click the Metal view if movement keys are not active

The renderer targets 60 fps, uses Retina resolution, 4× MSAA, physically-inspired lighting, glossy procedural marble, glass, timber grain, tiled surfaces, and geometry rebuilt only when the plan changes. The current scene is intentionally lightweight for the unified-memory budget of a MacBook Air M3 with 16 GB RAM.

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

The script builds with SwiftPM, stages `dist/LaundryRooms.app`, and launches it as a normal foreground macOS app. The Codex **Run** action uses the same script.

Validation commands:

```bash
swift test
./script/build_and_run.sh --verify
```

## Project structure

- `Models/`: survey, wall, and door geometry in real-world units
- `Stores/`: layout editing, validation, undo/redo, autosave, and export
- `Views/`: desktop split layout, survey inspector, walkthrough HUD, and 2D editor
- `Metal/`: `MTKView` bridge, camera controls, procedural mesh builder, and Metal shaders
- `Tests/`: survey, geometry, editing invariant, and undo coverage

The source photos remain local in `Pix/` and are ignored by Git; no private location imagery is packaged into the app.
