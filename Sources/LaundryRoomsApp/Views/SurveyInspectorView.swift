import SwiftUI

struct SurveyInspectorView: View {
    let store: FloorPlanStore
    @State private var draft: SurveyDimensions

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
                measurement("Drawing grid", value: $draft.gridSpacing)
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
                LabeledContent("Clear landing", value: fixedCore.landing.width.formattedMeters + " × " + fixedCore.landing.length.formattedMeters)
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

            if let wall = selectedWall {
                Section("Selected wall") {
                    LabeledContent("Length", value: wall.length.formattedMeters)
                    LabeledContent("Start", value: pointText(wall.start))
                    LabeledContent("End", value: pointText(wall.end))
                    if store.plan.doors.contains(where: { $0.wallID == wall.id }) {
                        Button("Flip door hinge", systemImage: "arrow.left.arrow.right") {
                            store.toggleSelectedDoorHinge()
                        }
                    }
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
