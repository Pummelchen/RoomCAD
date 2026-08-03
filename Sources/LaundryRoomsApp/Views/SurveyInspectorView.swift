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
                Text("Height and stair-core dimensions are photo/sketch estimates. Change them here when measured; the 2D and Metal models update together.")
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
