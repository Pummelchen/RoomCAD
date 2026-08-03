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

            Section("Test layout") {
                metric("Dry walls", "\(store.plan.partitions.count)")
                metric("Wall length", store.plan.totalPartitionLength.formattedMeters)
                metric("Doors", "\(store.plan.doors.count)")

                Button("Clear test layout", systemImage: "trash") {
                    store.clearPartitions()
                }
                .disabled(store.plan.partitions.isEmpty)

                Button("Restore example", systemImage: "arrow.counterclockwise") {
                    store.resetToSurvey()
                }
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
                    .help("Click to place, or drag into the 2D plan · \(kind.footprintLabel)")
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
