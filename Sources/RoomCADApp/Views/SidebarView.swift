import SwiftUI

struct SidebarView: View {
    let store: FloorPlanStore

    var body: some View {
        List {
            Section("Workspace") {
                ForEach(WorkspaceMode.allCases) { mode in
                    Button {
                        store.mode = mode
                    } label: {
                        Label(mode.rawValue, systemImage: mode.systemImage)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(store.mode == mode ? Color.accentColor : Color.primary)
                }
            }

            Section("Measured shell") {
                metric("Length", store.plan.dimensions.roomLength.formattedMeters)
                metric("Width", store.plan.dimensions.roomWidth.formattedMeters)
                metric("Clear height", store.plan.dimensions.clearHeight.formattedMeters)
                metric(
                    "Floor area",
                    store.plan.dimensions.floorArea.formatted(.number.precision(.fractionLength(1))) + " m²"
                )
            }

            Section("Editable layout") {
                metric("Snap grid", store.plan.dimensions.gridSpacing.formattedCentimeters)
                metric("Dry walls", "\(store.plan.partitions.count)")
                metric("Wall length", store.plan.totalPartitionLength.formattedMeters)
                metric("Doors", "\(store.plan.doors.count)")

                Button("Clear walls and doors", systemImage: "trash") {
                    store.clearPartitions()
                }
                .disabled(store.plan.partitions.isEmpty)

                Button("Restore example", systemImage: "arrow.counterclockwise") {
                    store.resetToSurvey()
                }

                Button("Add Door", systemImage: "door.left.hand.open") {
                    store.beginDoorPlacement()
                }
                .help("Switch to the 2D plan and place a 90 cm door on a wall")
            }

            Section("Furniture") {
                ForEach(FurnitureKind.allCases) { kind in
                    Button {
                        store.addFurniture(kind)
                    } label: {
                        Label("Add \(kind.title)", systemImage: kind.systemImage)
                    }
                    .draggable(kind.rawValue) {
                        Label(kind.title, systemImage: kind.systemImage)
                            .padding(8)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .help("Click to place, or drag into the 2D plan; then drag to move and use B to rotate · \(kind.footprintLabel)")
                }

                metric("Placed", "\(store.plan.furniture.count)")
                Button("Clear furniture", systemImage: "trash") {
                    store.clearFurniture()
                }
                .disabled(store.plan.furniture.isEmpty)
            }

            Section("File") {
                Button("Export JSON…", systemImage: "square.and.arrow.up") {
                    store.exportPlan()
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            Text(store.statusMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.bar)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
        .font(.callout)
    }
}
