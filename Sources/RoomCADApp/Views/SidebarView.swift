import SwiftUI

struct SidebarView: View {
    let store: FloorPlanStore
    var showQuickStart: () -> Void = {}
    @State private var furnitureSearch = ""
    @State private var snapshotName = ""
    @State private var showClearWalls = false
    @State private var showClearFurniture = false
    @State private var showRestoreExample = false

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
                Button("Quick Start Guide", systemImage: "sparkles") {
                    showQuickStart()
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
                metric("Room labels", "\(store.plan.roomLabels.count)")

                Button("Clear walls and doors", systemImage: "trash") {
                    showClearWalls = true
                }
                .disabled(store.plan.partitions.isEmpty)

                Button("Load 8-room demo", systemImage: "building.2") {
                    showRestoreExample = true
                }

                Button("Add Door", systemImage: "door.left.hand.open") {
                    store.beginDoorPlacement()
                }
                .help("Switch to the 2D plan and place a 90 cm door on a wall")
            }

            Section("Furniture") {
                TextField("Search furniture", text: $furnitureSearch)
                    .textFieldStyle(.roundedBorder)

                ForEach(filteredFurniture) { kind in
                    Button {
                        store.beginFurniturePlacement(kind)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: kind.systemImage)
                                .font(.title3)
                                .frame(width: 28, height: 28)
                                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(kind.title).fontWeight(.medium)
                                Text(kind.footprintLabel)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "plus.circle.fill")
                                .foregroundStyle(.tint)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 3)
                    .draggable(kind.rawValue) {
                        Label(kind.title, systemImage: kind.systemImage)
                            .padding(8)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .help("Click, move the preview onto the plan, then click again to place")
                }

                metric("Placed", "\(store.plan.furniture.count)")
                Button("Clear furniture", systemImage: "trash") {
                    showClearFurniture = true
                }
                .disabled(store.plan.furniture.isEmpty)
            }

            if !store.plan.partitions.isEmpty || !store.plan.doors.isEmpty
                || !store.plan.furniture.isEmpty || !store.plan.roomLabels.isEmpty {
                Section("Objects") {
                    ForEach(store.plan.roomLabels) { label in
                        Button {
                            store.mode = .plan
                            store.tool = .select
                            store.statusMessage = "Double-click \(label.name) on the plan to rename it"
                        } label: {
                            Label(label.name, systemImage: "textformat")
                        }
                        .help("Double-click this label on the 2D plan to rename or remove it")
                    }
                    ForEach(store.plan.partitions) { wall in
                        Button {
                            store.mode = .plan
                            store.tool = .select
                            store.selectedWallID = wall.id
                            store.selectedDoorID = nil
                            store.selectedFurnitureIDs.removeAll()
                        } label: {
                            Label("Wall · \(wall.length.formattedCentimeters)", systemImage: "ruler")
                        }
                        .foregroundStyle(store.selectedWallID == wall.id ? Color.accentColor : Color.primary)
                    }
                    ForEach(store.plan.doors) { door in
                        Button {
                            store.mode = .plan
                            store.tool = .select
                            store.selectedDoorID = door.id
                            store.selectedWallID = door.wallID
                            store.selectedFurnitureIDs.removeAll()
                        } label: {
                            Label("Door · \(door.width.formattedCentimeters)", systemImage: "door.left.hand.open")
                        }
                        .foregroundStyle(store.selectedDoorID == door.id ? Color.accentColor : Color.primary)
                    }
                    ForEach(store.plan.furniture) { item in
                        Button {
                            store.mode = .plan
                            store.tool = .select
                            store.selectedFurnitureID = item.id
                            store.selectedWallID = nil
                            store.selectedDoorID = nil
                        } label: {
                            Label(item.kind.title, systemImage: item.kind.systemImage)
                        }
                        .foregroundStyle(store.selectedFurnitureIDs.contains(item.id) ? Color.accentColor : Color.primary)
                    }
                }
            }

            Section("Snapshots") {
                TextField("Snapshot name", text: $snapshotName)
                Button("Save Current Layout", systemImage: "camera") {
                    store.saveSnapshot(named: snapshotName)
                    snapshotName = ""
                }
                ForEach(store.snapshots) { snapshot in
                    HStack {
                        Button {
                            store.restoreSnapshot(id: snapshot.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(snapshot.name)
                                Text(snapshot.createdAt, style: .date)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Button("Delete snapshot", systemImage: "trash", role: .destructive) {
                            store.deleteSnapshot(id: snapshot.id)
                        }
                        .labelStyle(.iconOnly)
                    }
                }
            }

            Section("File") {
                Label(store.documentDisplayName, systemImage: "doc")
                    .lineLimit(1)
                    .help(store.currentDocumentURL?.path ?? "Not saved as a RoomCAD design yet")
                Text(store.documentContentsSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let currentDocumentFileSize = store.currentDocumentFileSize {
                    Text(
                        "Last saved size: " + ByteCountFormatter.string(
                            fromByteCount: Int64(currentDocumentFileSize),
                            countStyle: .file
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                if store.documentIsEdited {
                    Label("Unsaved design changes", systemImage: "pencil.circle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Button("Open Design…", systemImage: "folder") {
                    store.openDocument()
                }
                Button("Save Design", systemImage: "square.and.arrow.down") {
                    store.saveDocument()
                }
                Button("Save Design As…", systemImage: "doc.badge.plus") {
                    store.saveDocumentAs()
                }
                Button("Export JSON Copy…", systemImage: "square.and.arrow.up") {
                    store.exportPlan()
                }
                .help("Export a legacy-compatible JSON copy; use Save Design for normal RoomCAD files")
                if let lastDocumentSavedAt = store.lastDocumentSavedAt {
                    Text("Design saved \(lastDocumentSavedAt, style: .relative)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let lastSavedAt = store.lastSavedAt {
                    Label {
                        Text("Recovery autosaved \(lastSavedAt, style: .relative)")
                    } icon: {
                        Image(systemName: "checkmark.icloud")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    Label("Recovery autosave is on", systemImage: "checkmark.icloud")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.sidebar)
        .confirmationDialog(
            "Clear every drawn wall and door?",
            isPresented: $showClearWalls,
            titleVisibility: .visible
        ) {
            Button("Clear Walls and Doors", role: .destructive) { store.clearPartitions() }
        } message: {
            Text("You can undo this immediately with ⌘Z.")
        }
        .confirmationDialog(
            "Clear all furniture?",
            isPresented: $showClearFurniture,
            titleVisibility: .visible
        ) {
            Button("Clear Furniture", role: .destructive) { store.clearFurniture() }
        } message: {
            Text("You can undo this immediately with ⌘Z.")
        }
        .confirmationDialog(
            "Replace the current layout with the 8-room demo?",
            isPresented: $showRestoreExample,
            titleVisibility: .visible
        ) {
            Button("Load 8-Room Demo", role: .destructive) { store.resetToSurvey() }
        } message: {
            Text("Your current layout remains available through Undo.")
        }
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

    private var filteredFurniture: [FurnitureKind] {
        let query = furnitureSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return FurnitureKind.allCases }
        return FurnitureKind.allCases.filter { $0.title.localizedCaseInsensitiveContains(query) }
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
