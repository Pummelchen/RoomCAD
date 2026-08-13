import SwiftUI

struct InspectorView: View {
    @Bindable var store: RoomStore
    @State private var nameText = ""
    @State private var editingWidth = false
    @State private var editingOffset = false

    var body: some View {
        Form {
            if let kind = store.selectedOpeningKind {
                openingSection(kind: kind)
            } else if let wall = store.selectedWall {
                wallSection(wall)
            } else if let furniture = store.selectedFurniture {
                furnitureSection(furniture)
            } else {
                roomSection()
            }
        }
        .formStyle(.grouped)
        .onAppear { nameText = store.room.name }
        .onChange(of: store.room.name) { _, newName in nameText = newName }
    }

    // MARK: Opening

    @ViewBuilder
    private func openingSection(kind: OpeningKind) -> some View {
        Section(kind == .door ? "Door" : "Window") {
            if kind == .door, let door = store.selectedDoor, let wall = store.selectedOpeningWall {
                widthSlider(
                    title: "Width",
                    value: door.width,
                    range: 0.60...1.40,
                    kind: kind
                )
                positionSlider(
                    value: door.offset,
                    wall: wall,
                    openingWidth: door.width,
                    kind: kind,
                    id: door.id
                )
            } else if kind == .window, let window = store.selectedWindow, let wall = store.selectedOpeningWall {
                widthSlider(
                    title: "Width",
                    value: window.width,
                    range: 0.40...2.00,
                    kind: kind
                )
                positionSlider(
                    value: window.offset,
                    wall: wall,
                    openingWidth: window.width,
                    kind: kind,
                    id: window.id
                )
            }
            if let spacing = store.selectedOpeningSpacing {
                LabeledContent("From wall start") {
                    Text(spacing.toWallStart.formattedCentimeters)
                }
                LabeledContent("From wall end") {
                    Text(spacing.toWallEnd.formattedCentimeters)
                }
                if let previous = spacing.gapToPrevious {
                    LabeledContent("Gap to neighbor") {
                        Text(previous.formattedCentimeters)
                    }
                }
            }
            Button("Delete \(kind == .door ? "Door" : "Window")", role: .destructive) {
                store.deleteSelection()
            }
        }
    }

    private func widthSlider(title: String, value: Double, range: ClosedRange<Double>, kind: OpeningKind) -> some View {
        LabeledContent(title) {
            HStack(spacing: 8) {
                Slider(
                    value: Binding(
                        get: { value },
                        set: { store.updateOpeningWidth(kind: kind, width: $0) }
                    ),
                    in: range,
                    step: 0.01,
                    onEditingChanged: { editing in
                        editingWidth = editing
                        if !editing {
                            store.endDragTransaction(message: kind == .door ? "Set door width" : "Set window width")
                        }
                    }
                )
                .frame(width: 110)
                Text(value.formattedCentimeters)
                    .monospacedDigit()
                    .frame(width: 54, alignment: .trailing)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func positionSlider(
        value: Double,
        wall: Wall,
        openingWidth: Double,
        kind: OpeningKind,
        id: UUID
    ) -> some View {
        let range = 0.10...(max(0.10, wall.length - openingWidth - 0.10))
        return LabeledContent("Position") {
            HStack(spacing: 8) {
                Slider(
                    value: Binding(
                        get: { value },
                        set: { store.slideOpeningToOffset(kind: kind, id: id, offset: $0) }
                    ),
                    in: range,
                    step: 0.01,
                    onEditingChanged: { editing in
                        editingOffset = editing
                        if !editing {
                            store.endDragTransaction(message: kind == .door ? "Slid door" : "Slid window")
                        }
                    }
                )
                .frame(width: 110)
                Text(value.formattedCentimeters)
                    .monospacedDigit()
                    .frame(width: 54, alignment: .trailing)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Wall

    @ViewBuilder
    private func wallSection(_ wall: Wall) -> some View {
        Section("Wall") {
            LabeledContent("Length") {
                Text(wall.length.formattedCentimeters)
            }
            LabeledContent("From") {
                Text("\(wall.start.x.formattedMeters), \(wall.start.z.formattedMeters)")
            }
            LabeledContent("To") {
                Text("\(wall.end.x.formattedMeters), \(wall.end.z.formattedMeters)")
            }
            Button("Delete Wall", role: .destructive) {
                store.deleteSelection()
            }
        }
    }

    // MARK: Furniture

    @ViewBuilder
    private func furnitureSection(_ furniture: FurnitureItem) -> some View {
        Section(furniture.kind.title) {
            LabeledContent("Size") {
                Text("\(furniture.orientedWidth.formattedCentimeters) × \(furniture.orientedDepth.formattedCentimeters)")
            }
            Button("Turn 90°") {
                store.rotateSelectedFurniture()
            }
            Button("Delete \(furniture.kind.title)", role: .destructive) {
                store.deleteSelection()
            }
        }
    }

    // MARK: Room

    @ViewBuilder
    private func roomSection() -> some View {
        Section("Room") {
            TextField("Room Name", text: $nameText)
                .onSubmit { store.renameRoom(nameText) }
            LabeledContent("Width") {
                TextField(
                    "Width",
                    value: Binding(
                        get: { store.room.width },
                        set: { store.updateRoomSize(width: $0, length: store.room.length) }
                    ),
                    format: .number.precision(.fractionLength(2))
                )
                .multilineTextAlignment(.trailing)
                .frame(width: 64)
                Text("m")
                    .foregroundStyle(.secondary)
            }
            LabeledContent("Length") {
                TextField(
                    "Length",
                    value: Binding(
                        get: { store.room.length },
                        set: { store.updateRoomSize(width: store.room.width, length: $0) }
                    ),
                    format: .number.precision(.fractionLength(2))
                )
                .multilineTextAlignment(.trailing)
                .frame(width: 64)
                Text("m")
                    .foregroundStyle(.secondary)
            }
            LabeledContent("Ceiling height") {
                TextField(
                    "Height",
                    value: Binding(
                        get: { store.room.height },
                        set: { store.updateRoomHeight($0) }
                    ),
                    format: .number.precision(.fractionLength(2))
                )
                .multilineTextAlignment(.trailing)
                .frame(width: 64)
                Text("m")
                    .foregroundStyle(.secondary)
            }
            Text("Select a wall, door, window, or furniture item to edit it.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
