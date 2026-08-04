import SwiftUI

struct SurveyInspectorView: View {
    let store: FloorPlanStore
    @State private var draft: SurveyDimensions
    @State private var wallLengthCentimeters: Float = 100
    @State private var wallAngleDegrees: Float = 0
    @State private var doorWidthCentimeters: Float = 90

    init(store: FloorPlanStore) {
        self.store = store
        _draft = State(initialValue: store.plan.dimensions)
    }

    var body: some View {
        Form {
            Section("Survey dimensions") {
                measurement("Window-to-window length", value: $draft.roomLength)
                measurement("Inside width", value: $draft.roomWidth)
                measurement("Clear ceiling height", value: $draft.clearHeight)
                measurement("Stair core length", value: $draft.stairCoreLength)
                measurement("Stair core width", value: $draft.stairCoreWidth)

                Button("Apply measurements") {
                    store.updateDimensions(draft)
                    draft = store.plan.dimensions
                }
                .buttonStyle(.borderedProminent)
            }

            Section("Construction") {
                measurement("Exterior wall", value: $draft.exteriorWallThickness)
                measurement("Dry-wall thickness", value: $draft.drywallThickness)
            }

            Section("Editor grid") {
                LabeledContent("Grid spacing") {
                    HStack(spacing: 4) {
                        TextField("", value: gridCentimeters, format: .number.precision(.fractionLength(0...1)))
                            .multilineTextAlignment(.trailing)
                            .frame(width: 64)
                            .accessibilityLabel("Grid spacing in centimetres")
                        Text("cm").foregroundStyle(.secondary)
                    }
                }
                HStack {
                    ForEach([Float(1), 2.5, 5, 10], id: \.self) { centimeters in
                        Button(centimeters.formatted(.number.precision(.fractionLength(0...1))) + " cm") {
                            draft.gridSpacing = centimeters / 100
                            applyGridSpacing()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Button("Apply grid spacing", systemImage: "grid") {
                    applyGridSpacing()
                }
                .buttonStyle(.borderedProminent)
                Text("Walls, doors, and furniture snap to this spacing. Values from 1 to 50 cm are supported; measured shell edges remain exact snap targets.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Floor tiles · photo estimate") {
                LabeledContent("Tile module", value: "60 × 60 cm")
                LabeledContent(
                    "Across \(draft.roomWidth.formattedMeters)",
                    value: "\(floorTiles.columns) positions · \(floorTiles.fullColumns) full + \(floorTiles.widthCut.formattedCentimeters) cut"
                )
                LabeledContent(
                    "Along \(draft.roomLength.formattedMeters)",
                    value: "\(floorTiles.rows) positions · \(floorTiles.fullRows) full + \(floorTiles.lengthCut.formattedCentimeters) cut"
                )
                LabeledContent("Rendered grout", value: "4 mm")
                Text("The tile size is inferred from the photographs. Counts describe the uninterrupted room rectangle; the stair opening removes parts of several positions.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Confirmed stair relationships") {
                LabeledContent("Bathroom depth", value: fixedCore.bathroom.width.formattedMeters)
                LabeledContent("First upward step", value: fixedCore.upperFlight.minX.formattedMeters + " from opposite wall")
                LabeledContent("Lower stair width", value: fixedCore.lowerOpening.width.formattedMeters)
                LabeledContent("Free landing space", value: fixedCore.landing.width.formattedMeters + " × " + fixedCore.landing.length.formattedMeters)
                Text("The lower flight continues below the bathroom and upper flight. Dashed purple geometry in 2D is below this floor.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Two-window wall") {
                LabeledContent("Left wall before window", value: "0.08 m")
                LabeledContent("Two-window width", value: (fixedCore.rearWindowEndX - fixedCore.rearWindowStartX).formattedMeters + " inferred")
                LabeledContent("Window to bathroom", value: "1.52 m")
                Text("The 1.52 m window width is calculated from the 4.87 m total after the confirmed 1.75 m bathroom depth and has not been measured directly.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let door = store.selectedDoor,
               let sides = store.doorSideLengths(door) {
                Section("Selected door") {
                    LabeledContent("Width") {
                        HStack(spacing: 4) {
                            TextField(
                                "Door width",
                                value: $doorWidthCentimeters,
                                format: .number.precision(.fractionLength(0))
                            )
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                            Text("cm").foregroundStyle(.secondary)
                        }
                    }
                    LabeledContent("From wall start", value: sides.leading.formattedCentimeters)
                    LabeledContent("To wall end", value: sides.trailing.formattedCentimeters)
                    LabeledContent("Hinge", value: door.hinge.rawValue.capitalized)
                    Text("Drag the door along its wall in Inspect mode. Its centre snaps to the active editor grid.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Apply door width", systemImage: "ruler") {
                        store.updateSelectedDoorWidth(doorWidthCentimeters / 100)
                        doorWidthCentimeters = (store.selectedDoor?.width ?? door.width) * 100
                    }
                    .buttonStyle(.borderedProminent)
                    Button("Flip door hinge", systemImage: "arrow.left.arrow.right") {
                        store.toggleSelectedDoorHinge()
                    }
                    Button("Delete door", systemImage: "trash", role: .destructive) {
                        store.deleteSelectedDoor()
                    }
                }
            }

            if let item = store.selectedFurniture {
                Section("Selected furniture") {
                    LabeledContent("Object", value: item.kind.title)
                    LabeledContent("Footprint", value: item.kind.footprintLabel)
                    LabeledContent("Facing", value: item.direction.title)
                    LabeledContent("Centre", value: pointText(item.center))
                    Button("Rotate 90° — B", systemImage: "rotate.right") {
                        store.rotateSelectedFurniture()
                    }
                    Button("Delete furniture", systemImage: "trash", role: .destructive) {
                        store.deleteSelectedFurniture()
                    }
                }
            }

            if let wall = selectedWall {
                Section("Selected wall") {
                    LabeledContent("Exact length") {
                        HStack(spacing: 4) {
                            TextField(
                                "Wall length",
                                value: $wallLengthCentimeters,
                                format: .number.precision(.fractionLength(0...1))
                            )
                            .multilineTextAlignment(.trailing)
                            .frame(width: 72)
                            Text("cm").foregroundStyle(.secondary)
                        }
                    }
                    LabeledContent("Exact angle") {
                        HStack(spacing: 4) {
                            TextField(
                                "Wall angle",
                                value: $wallAngleDegrees,
                                format: .number.precision(.fractionLength(0...1))
                            )
                            .multilineTextAlignment(.trailing)
                            .frame(width: 72)
                            Text("°").foregroundStyle(.secondary)
                        }
                    }
                    Button("Apply exact wall size", systemImage: "ruler") {
                        if store.updateSelectedWall(
                            length: wallLengthCentimeters / 100,
                            angleDegrees: wallAngleDegrees
                        ), let updated = store.selectedWall {
                            wallLengthCentimeters = updated.length * 100
                            wallAngleDegrees = updated.angleDegrees
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    LabeledContent("Start", value: pointText(wall.start))
                    LabeledContent("End", value: pointText(wall.end))
                    Text("Angles use 0° to the right, 90° toward the top of the plan. Drag either blue handle for quick edits.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Delete wall", systemImage: "trash", role: .destructive) {
                        store.deleteSelectedWall()
                    }
                }
            }

            Section("Survey confidence") {
                Label("Confirmed: length 16.44 m", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                Label("Please verify: width 4.87 m", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text("Height remains a photo estimate. The 6.00 m stacked core uses the supplied 1.75 m bathroom depth, 2.40 m upward-step offset, and 1.15 m lower stair, leaving a calculated 1.32 × 3.50 m landing.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: store.plan.dimensions) { _, newValue in draft = newValue }
        .onChange(of: store.selectedWallID, initial: true) { _, _ in
            guard let wall = store.selectedWall else { return }
            wallLengthCentimeters = wall.length * 100
            wallAngleDegrees = wall.angleDegrees
        }
        .onChange(of: store.selectedDoorID, initial: true) { _, _ in
            guard let door = store.selectedDoor else { return }
            doorWidthCentimeters = door.width * 100
        }
    }

    private var selectedWall: PartitionWall? {
        guard let id = store.selectedWallID else { return nil }
        return store.plan.partitions.first { $0.id == id }
    }

    private var fixedCore: StairBathroomLayout {
        StairBathroomLayout(dimensions: draft)
    }

    private var floorTiles: FloorTileLayout {
        FloorTileLayout(dimensions: draft)
    }

    private var gridCentimeters: Binding<Float> {
        Binding(
            get: { draft.gridSpacing * 100 },
            set: { draft.gridSpacing = $0 / 100 }
        )
    }

    private func applyGridSpacing() {
        store.updateGridSpacing(draft.gridSpacing)
        draft = store.plan.dimensions
    }

    private func measurement(_ title: String, value: Binding<Float>) -> some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField("", value: value, format: .number.precision(.fractionLength(2)))
                    .multilineTextAlignment(.trailing)
                    .frame(width: 64)
                    .accessibilityLabel(title)
                Text("m").foregroundStyle(.secondary)
            }
        }
    }

    private func pointText(_ point: PlanPoint) -> String {
        let precision = FloatingPointFormatStyle<Float>.number.precision(.fractionLength(2))
        return "\(point.x.formatted(precision)), \(point.z.formatted(precision)) m"
    }
}
