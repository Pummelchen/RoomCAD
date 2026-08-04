import AppKit
import SwiftUI

struct TopDownEditorView: View {
    let store: FloorPlanStore
    @State private var wallAnchor: PlanPoint?
    @State private var dragStart: PlanPoint?
    @State private var dragCurrent: PlanPoint?
    @State private var wallDragCancelled = false
    @State private var hoverPoint: PlanPoint?
    @State private var doorDragID: UUID?
    @State private var doorDragOffset: Float?
    @State private var furnitureDragID: UUID?
    @State private var furnitureDragCenter: PlanPoint?
    @State private var viewportCenter: PlanPoint?
    @State private var wallEditID: UUID?
    @State private var wallEditPart: WallEditPart?
    @State private var wallEditOriginal: PartitionWall?
    @State private var wallEditPreview: PartitionWall?
    @State private var wallEditPointerStart: PlanPoint?
    @State private var snapLabel: String?
    @State private var selectionGestureStarted = false
    @State private var exactWallLengthCentimeters: Float = 100
    @State private var exactWallAngleDegrees: Float = 0
    @State private var roomLabelDraft = ""
    @State private var roomLabelPoint: PlanPoint?
    @State private var editingRoomLabelID: UUID?
    @State private var showRoomLabelPrompt = false

    var body: some View {
        GeometryReader { geometry in
            let transform = PlanTransform(
                size: geometry.size,
                dimensions: store.plan.dimensions,
                zoomScale: store.planZoomScale,
                viewportCenter: viewportCenter,
                rotation: store.planRotation
            )
            let snapshot = PlanDrawingSnapshot(
                plan: previewPlan,
                selectedWallID: store.selectedWallID,
                selectedDoorID: store.selectedDoorID,
                selectedFurnitureIDs: store.selectedFurnitureIDs,
                dragStart: wallAnchor ?? dragStart,
                dragCurrent: dragCurrent ?? (wallAnchor == nil ? nil : hoverPoint),
                snapPoint: hoverPoint,
                snapLabel: snapLabel,
                placementFurniture: placementPreview?.item,
                placementValid: placementPreview?.isValid ?? false
            )

            ZStack {
                Color(nsColor: .textBackgroundColor)
                Canvas(opaque: false, colorMode: .linear, rendersAsynchronously: true) { context, _ in
                    Self.drawPlan(context: &context, transform: transform, snapshot: snapshot)
                }

                if store.tool == .wall {
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(wallGesture(transform: transform))
                } else if store.tool == .select {
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(selectionGesture(transform: transform))
                } else {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            let point = transform.planPoint(from: location)
                            switch store.tool {
                            case .door: store.placeDoor(near: point)
                            case .erase: store.erase(near: point)
                            case .select: store.select(near: point)
                            case .furniture: store.placePendingFurniture(near: point)
                            case .wall: break
                            }
                        }
                }
            }
            .highPriorityGesture(
                SpatialTapGesture(count: 2)
                    .onEnded { event in
                        beginRoomLabel(at: event.location, transform: transform)
                    }
            )
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    let raw = transform.planPoint(from: location)
                    if store.tool == .wall {
                        let result = store.plan.smartSnap(
                            raw,
                            anchor: wallAnchor ?? dragStart,
                            lockAngles: NSEvent.modifierFlags.contains(.shift)
                        )
                        hoverPoint = result.point
                        snapLabel = result.label
                    } else {
                        hoverPoint = store.plan.dimensions.snapped(raw)
                        snapLabel = nil
                    }
                case .ended:
                    hoverPoint = nil
                    snapLabel = nil
                }
            }
            .contextMenu {
                if let hoverPoint,
                   let label = store.roomLabel(near: hoverPoint, tolerance: 0.25) {
                    Text("Room · \(label.name)")
                    Button("Delete Room Label", systemImage: "trash", role: .destructive) {
                        store.deleteRoomLabel(id: label.id)
                    }
                } else if let hoverPoint,
                   let wall = store.wall(near: hoverPoint, tolerance: 0.25) {
                    Text("Wall · \(wall.length.formattedMeters) (\(wall.length.formattedCentimeters))")
                    Button("Delete Wall", systemImage: "trash", role: .destructive) {
                        store.deleteWall(id: wall.id)
                    }
                } else {
                    Text("Right-click a wall to see its size")
                }
            }
            .alert(editingRoomLabelID == nil ? "Name This Room" : "Rename Room", isPresented: $showRoomLabelPrompt) {
                TextField("Room name", text: $roomLabelDraft)
                Button("Cancel", role: .cancel) {
                    clearRoomLabelPrompt()
                }
                if let editingRoomLabelID {
                    Button("Remove Label", role: .destructive) {
                        store.deleteRoomLabel(id: editingRoomLabelID)
                        clearRoomLabelPrompt()
                    }
                }
                Button(editingRoomLabelID == nil ? "Add Label" : "Save") {
                    saveRoomLabel()
                }
                .disabled(roomLabelDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Type a simple name, such as Bedroom, Bathroom, or Play Room.")
            }
            .background {
                ZStack {
                    ScrollWheelMonitor { delta, location in
                        zoomWithWheel(
                            delta: delta,
                            location: location,
                            size: geometry.size,
                            transform: transform
                        )
                    }
                    CanvasPanMonitor { delta in
                        panViewport(by: delta, size: geometry.size, transform: transform)
                    }
                    PlanKeyboardMonitor(gridSpacing: store.plan.dimensions.gridSpacing) { command in
                        handleKeyboardCommand(command)
                    }
                    EscapeKeyMonitor(
                        isEnabled: (store.tool == .wall
                            && (wallAnchor != nil || dragStart != nil || dragCurrent != nil))
                            || store.pendingFurnitureKind != nil,
                        action: cancelCurrentAction
                    )
                    .frame(width: 0, height: 0)
                }
            }
            .dropDestination(for: String.self) { values, location in
                guard let rawKind = values.first,
                      let kind = FurnitureKind(rawValue: rawKind) else { return false }
                store.addFurniture(kind, at: transform.planPoint(from: location))
                return true
            }
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 8) {
                    Label(instruction, systemImage: store.tool.systemImage)
                    Text("Grid \(store.plan.dimensions.gridSpacing.formattedCentimeters)")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .font(.callout)
                .padding(10)
                .background(.regularMaterial, in: Capsule())
                .padding(14)
            }
            .overlay(alignment: .topLeading) {
                if wallAnchor != nil {
                    HStack(spacing: 10) {
                        Label("Wall chain active", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        Button("Finish") { cancelWallChain() }
                            .buttonStyle(.bordered)
                        Divider().frame(height: 22)
                        TextField(
                            "Length",
                            value: $exactWallLengthCentimeters,
                            format: .number.precision(.fractionLength(0...1))
                        )
                        .frame(width: 62)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Exact wall length in centimetres")
                        Text("cm").foregroundStyle(.secondary)
                        TextField(
                            "Angle",
                            value: $exactWallAngleDegrees,
                            format: .number.precision(.fractionLength(0...1))
                        )
                        .frame(width: 54)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Exact wall angle in degrees")
                        Text("°").foregroundStyle(.secondary)
                        Button("Add Exact") { addExactWall() }
                            .buttonStyle(.borderedProminent)
                        Text("Esc cancels")
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .padding(10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                    .padding(14)
                }
            }
            .overlay(alignment: .topTrailing) {
                selectionControls
                    .padding(14)
            }
            .overlay(alignment: .bottomTrailing) {
                HStack(spacing: 5) {
                    Button {
                        store.rotatePlanLeft()
                    } label: {
                        Label("Turn Plan Left", systemImage: "rotate.left")
                    }
                    .labelStyle(.iconOnly)
                    .help("Turn the 2D plan 90° left (⌘[)")

                    Button {
                        store.resetPlanRotation()
                    } label: {
                        Text("\(store.planRotation.degrees)°")
                            .monospacedDigit()
                            .frame(minWidth: 30)
                    }
                    .help("Reset plan orientation")
                    .disabled(store.planRotation == .zero)

                    Button {
                        store.rotatePlanRight()
                    } label: {
                        Label("Turn Plan Right", systemImage: "rotate.right")
                    }
                    .labelStyle(.iconOnly)
                    .help("Turn the 2D plan 90° right (⌘])")

                    Divider().frame(height: 18)

                    Button {
                        store.zoomPlanOut()
                    } label: {
                        Label("Zoom Out", systemImage: "minus.magnifyingglass")
                    }
                    .labelStyle(.iconOnly)
                    .help("Zoom out (⌘−)")
                    .disabled(!store.canZoomOut)

                    Button {
                        fitPlan()
                    } label: {
                        Label("Fit Plan", systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    .labelStyle(.iconOnly)
                    .help("Fit the whole room in the window")

                    Button {
                        fitSelection(size: geometry.size, transform: transform)
                    } label: {
                        Label("Fit Selection", systemImage: "viewfinder")
                    }
                    .labelStyle(.iconOnly)
                    .help("Zoom to the selected object")
                    .disabled(!store.hasSelection)

                    Button {
                        store.resetPlanZoom()
                    } label: {
                        Text("\(Int((store.planZoomScale * 100).rounded()))%")
                            .monospacedDigit()
                            .frame(minWidth: 42)
                    }
                    .help("Reset the 2D plan to 100% (⌘0)")
                    .disabled(store.planZoomScale == 1)

                    Button {
                        store.zoomPlanIn()
                    } label: {
                        Label("Zoom In", systemImage: "plus.magnifyingglass")
                    }
                    .labelStyle(.iconOnly)
                    .help("Zoom in (⌘+)")
                    .disabled(!store.canZoomIn)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(8)
                .background(.regularMaterial, in: Capsule())
                    .padding(14)
            }
            .overlay(alignment: .bottom) {
                if store.planZoomScale > 1.05 {
                    PlanOverviewView(
                        plan: store.plan,
                        viewportCenter: viewportCenter ?? PlanPoint(
                            x: store.plan.dimensions.roomWidth / 2,
                            z: store.plan.dimensions.roomLength / 2
                        ),
                        viewportSize: geometry.size,
                        mainScale: transform.scale,
                        rotation: store.planRotation
                    ) { point in
                        viewportCenter = constrainedViewportCenter(
                            point,
                            size: geometry.size,
                            scale: transform.scale
                        )
                    }
                    .padding(14)
                }
            }
            .onChange(of: store.tool) { _, newTool in
                if newTool != .furniture {
                    store.pendingFurnitureKind = nil
                }
                resetTransientInteraction()
            }
            .onChange(of: store.mode) { _, _ in resetTransientInteraction() }
            .onChange(of: store.plan.dimensions.gridSpacing) { _, _ in resetTransientInteraction() }
            .onChange(of: store.planRotation) { _, newRotation in
                resetTransientInteraction()
                if store.planZoomScale == 1 {
                    viewportCenter = nil
                } else if let viewportCenter {
                    let rotatedTransform = PlanTransform(
                        size: geometry.size,
                        dimensions: store.plan.dimensions,
                        zoomScale: store.planZoomScale,
                        viewportCenter: viewportCenter,
                        rotation: newRotation
                    )
                    self.viewportCenter = constrainedViewportCenter(
                        viewportCenter,
                        size: geometry.size,
                        scale: rotatedTransform.scale
                    )
                }
            }
            .onChange(of: store.planZoomScale) { _, zoomScale in
                if zoomScale == 1 {
                    viewportCenter = nil
                } else if let viewportCenter {
                    self.viewportCenter = constrainedViewportCenter(
                        viewportCenter,
                        size: geometry.size,
                        scale: transform.baseScale * CGFloat(zoomScale)
                    )
                }
            }
        }
    }

    private func zoomWithWheel(
        delta: CGFloat,
        location: CGPoint,
        size: CGSize,
        transform: PlanTransform
    ) {
        let factor = pow(1.12, Float(delta))
        let nextZoom = (store.planZoomScale * factor).clamped(
            to: FloorPlanStore.minimumPlanZoom...FloorPlanStore.maximumPlanZoom
        )
        guard abs(nextZoom - store.planZoomScale) > 0.0001 else { return }

        let anchor = transform.planPoint(from: location)
        let displayAnchor = transform.displayPoint(anchor)
        let nextScale = transform.baseScale * CGFloat(nextZoom)
        let nextDisplayCenter = PlanPoint(
            x: displayAnchor.x - Float((location.x - size.width / 2) / nextScale),
            z: displayAnchor.z + Float((location.y - size.height / 2) / nextScale)
        )
        let nextCenter = transform.planPoint(fromDisplay: nextDisplayCenter)
        viewportCenter = constrainedViewportCenter(nextCenter, size: size, scale: nextScale)
        store.setPlanZoomScale(nextZoom)
    }

    private func beginRoomLabel(at screenPoint: CGPoint, transform: PlanTransform) {
        resetTransientInteraction()
        let rawPoint = transform.planPoint(from: screenPoint)
        let point = rawPoint.clamped(to: store.plan.dimensions)
        guard rawPoint == point else {
            store.statusMessage = "Double-click inside the room to add a name"
            return
        }
        if let label = store.plan.roomLabels.last(where: {
            Self.roomLabelRect(for: $0, transform: transform).insetBy(dx: -6, dy: -6).contains(screenPoint)
        }) {
            editingRoomLabelID = label.id
            roomLabelPoint = label.position
            roomLabelDraft = label.name
        } else {
            editingRoomLabelID = nil
            roomLabelPoint = point
            roomLabelDraft = ""
        }
        showRoomLabelPrompt = true
    }

    private func saveRoomLabel() {
        guard let roomLabelPoint else { return }
        if store.saveRoomLabel(
            name: roomLabelDraft,
            at: roomLabelPoint,
            editingID: editingRoomLabelID
        ) {
            clearRoomLabelPrompt()
        }
    }

    private func clearRoomLabelPrompt() {
        roomLabelDraft = ""
        roomLabelPoint = nil
        editingRoomLabelID = nil
    }

    private func constrainedViewportCenter(
        _ center: PlanPoint,
        size: CGSize,
        scale: CGFloat
    ) -> PlanPoint {
        func coordinate(_ value: Float, length: Float, pixels: CGFloat) -> Float {
            let halfVisible = Float(pixels / max(scale, 0.001) / 2)
            guard halfVisible < length / 2 else { return length / 2 }
            return value.clamped(to: halfVisible...(length - halfVisible))
        }

        let rotation = store.planRotation
        let displaySize = rotation.displaySize(for: store.plan.dimensions)
        let displayCenter = rotation.displayPoint(center, dimensions: store.plan.dimensions)
        let constrainedDisplay = PlanPoint(
            x: coordinate(displayCenter.x, length: displaySize.width, pixels: size.width),
            z: coordinate(displayCenter.z, length: displaySize.height, pixels: size.height)
        )
        return rotation.planPoint(constrainedDisplay, dimensions: store.plan.dimensions)
    }

    private func panViewport(by delta: CGSize, size: CGSize, transform: PlanTransform) {
        let center = viewportCenter ?? PlanPoint(
            x: store.plan.dimensions.roomWidth / 2,
            z: store.plan.dimensions.roomLength / 2
        )
        let displayCenter = transform.displayPoint(center)
        let movedDisplay = PlanPoint(
            x: displayCenter.x - Float(delta.width / transform.scale),
            z: displayCenter.z + Float(delta.height / transform.scale)
        )
        let moved = transform.planPoint(fromDisplay: movedDisplay)
        viewportCenter = constrainedViewportCenter(moved, size: size, scale: transform.scale)
    }

    private func fitPlan() {
        viewportCenter = nil
        store.resetPlanZoom()
        store.statusMessage = "Fit the whole plan"
    }

    private func fitSelection(size: CGSize, transform: PlanTransform) {
        guard let bounds = store.plan.boundsForSelection(
            wallID: store.selectedWallID,
            doorID: store.selectedDoorID,
            furnitureIDs: store.selectedFurnitureIDs
        ) else { return }
        let availableWidth = max(100, size.width - 180)
        let availableHeight = max(100, size.height - 150)
        let displayBounds = store.planRotation.displayRectangle(
            bounds,
            dimensions: store.plan.dimensions
        )
        let selectionScale = min(
            availableWidth / CGFloat(max(displayBounds.width, 0.40)),
            availableHeight / CGFloat(max(displayBounds.length, 0.40))
        )
        let zoom = Float(selectionScale / transform.baseScale).clamped(
            to: FloorPlanStore.minimumPlanZoom...FloorPlanStore.maximumPlanZoom
        )
        viewportCenter = constrainedViewportCenter(
            PlanPoint(x: bounds.centerX, z: bounds.centerZ),
            size: size,
            scale: transform.baseScale * CGFloat(zoom)
        )
        store.setPlanZoomScale(zoom)
        store.statusMessage = "Fit selected object"
    }

    private var placementPreview: (item: FurnitureItem, isValid: Bool)? {
        guard store.tool == .furniture,
              let kind = store.pendingFurnitureKind,
              let hoverPoint else { return nil }
        return store.furniturePreview(kind: kind, near: hoverPoint)
    }

    private var instruction: String {
        switch store.tool {
        case .wall: "Click points to chain walls, or drag one wall · Esc cancels"
        case .door: "Click a wall to place a 90 cm door, then Inspect to slide it"
        case .erase: "Click furniture, a door, or a wall to remove it"
        case .select: "Drag objects · Double-click a room to name it · Space-drag pans"
        case .furniture: "Move the ghost to an open spot, click to place · Esc finishes"
        }
    }

    private func wallGesture(transform: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard !wallDragCancelled else { return }
                if dragStart == nil {
                    let rawStart = transform.planPoint(from: value.startLocation)
                    dragStart = wallAnchor ?? store.plan.smartSnap(rawStart).point
                }
                let raw = transform.planPoint(from: value.location)
                let result = store.plan.smartSnap(
                    raw,
                    anchor: dragStart,
                    lockAngles: NSEvent.modifierFlags.contains(.shift)
                )
                dragCurrent = result.point
                snapLabel = result.label
            }
            .onEnded { value in
                if wallDragCancelled {
                    wallDragCancelled = false
                    dragStart = nil
                    dragCurrent = nil
                    return
                }
                let end = dragCurrent ?? transform.snappedPlanPoint(from: value.location)
                let travel = hypot(value.translation.width, value.translation.height)
                if travel < 3 {
                    if let wallAnchor {
                        if store.addWall(from: wallAnchor, to: end) {
                            self.wallAnchor = end
                            store.statusMessage = "Wall added · click the next grid point or Finish"
                        }
                    } else {
                        wallAnchor = end
                        store.statusMessage = "Wall start set · click another grid point"
                    }
                } else if let start = dragStart {
                    let continuesChain = wallAnchor != nil
                    if store.addWall(from: start, to: end) {
                        wallAnchor = continuesChain ? end : nil
                    }
                }
                dragStart = nil
                dragCurrent = nil
            }
    }

    private func selectionGesture(transform: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if !selectionGestureStarted {
                    selectionGestureStarted = true
                    let startPoint = transform.planPoint(from: value.startLocation)
                    let additive = NSEvent.modifierFlags.contains(.shift)
                    store.select(
                        near: startPoint,
                        additive: additive
                    )
                    if !additive {
                        furnitureDragID = store.selectedFurnitureID
                        doorDragID = store.selectedDoorID
                        if furnitureDragID == nil, doorDragID == nil,
                           let wall = store.selectedWall {
                            wallEditID = wall.id
                            wallEditOriginal = wall
                            wallEditPreview = wall
                            wallEditPointerStart = startPoint
                            let tolerance = max(0.12, Float(10 / transform.scale))
                            if wall.start.distance(to: startPoint) <= tolerance {
                                wallEditPart = .start
                            } else if wall.end.distance(to: startPoint) <= tolerance {
                                wallEditPart = .end
                            } else {
                                wallEditPart = .body
                            }
                        }
                    }
                }
                if let furnitureDragID,
                   let center = store.constrainedFurnitureCenter(
                        id: furnitureDragID,
                        near: transform.planPoint(from: value.location)
                   ) {
                    furnitureDragCenter = center
                } else if let doorDragID,
                          let offset = store.constrainedDoorOffset(
                            id: doorDragID,
                            near: transform.planPoint(from: value.location)
                          ) {
                    doorDragOffset = offset
                } else if let original = wallEditOriginal,
                          let part = wallEditPart,
                          let pointerStart = wallEditPointerStart {
                    let current = transform.planPoint(from: value.location)
                    switch part {
                    case .start:
                        let result = store.plan.smartSnap(
                            current,
                            anchor: original.end,
                            excludingWallID: original.id,
                            lockAngles: NSEvent.modifierFlags.contains(.shift)
                        )
                        wallEditPreview = PartitionWall(id: original.id, start: result.point, end: original.end)
                        snapLabel = result.label
                    case .end:
                        let result = store.plan.smartSnap(
                            current,
                            anchor: original.start,
                            excludingWallID: original.id,
                            lockAngles: NSEvent.modifierFlags.contains(.shift)
                        )
                        wallEditPreview = PartitionWall(id: original.id, start: original.start, end: result.point)
                        snapLabel = result.label
                    case .body:
                        let delta = current - pointerStart
                        let minX = min(original.start.x, original.end.x)
                        let maxX = max(original.start.x, original.end.x)
                        let minZ = min(original.start.z, original.end.z)
                        let maxZ = max(original.start.z, original.end.z)
                        let safe = PlanPoint(
                            x: delta.x.clamped(to: -minX...(store.plan.dimensions.roomWidth - maxX)),
                            z: delta.z.clamped(to: -minZ...(store.plan.dimensions.roomLength - maxZ))
                        )
                        wallEditPreview = PartitionWall(
                            id: original.id,
                            start: original.start + safe,
                            end: original.end + safe
                        )
                    }
                }
            }
            .onEnded { value in
                if let furnitureDragID, let furnitureDragCenter {
                    store.moveFurniture(id: furnitureDragID, to: furnitureDragCenter)
                }
                if let doorDragID {
                    store.moveDoor(
                        id: doorDragID,
                        to: transform.planPoint(from: value.location)
                    )
                }
                if let preview = wallEditPreview,
                   let original = wallEditOriginal,
                   preview != original {
                    _ = store.updateWall(id: preview.id, start: preview.start, end: preview.end)
                }
                furnitureDragID = nil
                furnitureDragCenter = nil
                doorDragID = nil
                doorDragOffset = nil
                wallEditID = nil
                wallEditPart = nil
                wallEditOriginal = nil
                wallEditPreview = nil
                wallEditPointerStart = nil
                snapLabel = nil
                selectionGestureStarted = false
            }
    }

    private var previewPlan: FloorPlan {
        var plan = store.plan
        if let furnitureDragID, let furnitureDragCenter,
           let index = plan.furniture.firstIndex(where: { $0.id == furnitureDragID }) {
            plan.furniture[index].center = furnitureDragCenter
        }
        if let doorDragID, let doorDragOffset,
           let index = plan.doors.firstIndex(where: { $0.id == doorDragID }) {
            plan.doors[index].offset = doorDragOffset
        }
        if let wallEditID, let wallEditPreview,
           let index = plan.partitions.firstIndex(where: { $0.id == wallEditID }) {
            plan.partitions[index] = wallEditPreview
        }
        return plan
    }

    @ViewBuilder
    private var selectionControls: some View {
        if store.selectedFurnitureIDs.count > 1 {
            HStack(spacing: 8) {
                Label("\(store.selectedFurnitureIDs.count) items", systemImage: "square.on.square")
                Button("Rotate", systemImage: "rotate.right") { store.rotateSelectedFurniture() }
                Button("Duplicate", systemImage: "plus.square.on.square") { store.duplicateSelectedFurniture() }
                Button("Delete", systemImage: "trash", role: .destructive) { store.deleteSelectedFurniture() }
            }
            .buttonStyle(.bordered)
            .font(.callout)
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        } else if let item = store.selectedFurniture {
            HStack(spacing: 8) {
                Label(item.kind.title, systemImage: item.kind.systemImage)
                Text(item.kind.footprintLabel)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Button("Rotate", systemImage: "rotate.right") { store.rotateSelectedFurniture() }
                    .buttonStyle(.bordered)
                Button("Duplicate", systemImage: "plus.square.on.square") {
                    store.duplicateSelectedFurniture()
                }
                .buttonStyle(.bordered)
                Button("Delete", systemImage: "trash", role: .destructive) {
                    store.deleteSelectedFurniture()
                }
                .buttonStyle(.bordered)
            }
            .font(.callout)
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        } else if let door = store.selectedDoor,
                  let sides = store.doorSideLengths(door) {
            HStack(spacing: 8) {
                Label("Door", systemImage: "door.left.hand.open")
                Text("\(sides.leading.formattedCentimeters) | \(door.width.formattedCentimeters) | \(sides.trailing.formattedCentimeters)")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Button("Flip", systemImage: "arrow.left.arrow.right") {
                    store.toggleSelectedDoorHinge()
                }
                .buttonStyle(.bordered)
                Button("Delete", systemImage: "trash", role: .destructive) {
                    store.deleteSelectedDoor()
                }
                .buttonStyle(.bordered)
            }
            .font(.callout)
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        } else if let wall = store.selectedWall {
            HStack(spacing: 8) {
                Label("Wall", systemImage: "ruler")
                Text("\(wall.length.formattedCentimeters) · \(wall.angleDegrees.formatted(.number.precision(.fractionLength(0))))°")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Text("Drag ends to resize · drag middle to move")
                    .foregroundStyle(.secondary)
                Button("Delete", systemImage: "trash", role: .destructive) {
                    store.deleteSelectedWall()
                }
                .buttonStyle(.bordered)
            }
            .font(.callout)
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func cancelWallChain() {
        wallAnchor = nil
        dragStart = nil
        dragCurrent = nil
        store.statusMessage = "Wall chain finished"
    }

    private func addExactWall() {
        guard let wallAnchor else { return }
        if store.addWall(
            from: wallAnchor,
            length: exactWallLengthCentimeters / 100,
            angleDegrees: exactWallAngleDegrees
        ), let wall = store.selectedWall {
            self.wallAnchor = wall.end
            store.statusMessage = "Exact wall added · enter the next size or click a point"
        }
    }

    private func cancelWallDrawing() {
        guard store.tool == .wall,
              wallAnchor != nil || dragStart != nil || dragCurrent != nil else { return }
        wallDragCancelled = dragStart != nil || dragCurrent != nil
        wallAnchor = nil
        dragStart = nil
        dragCurrent = nil
        store.statusMessage = "Wall drawing cancelled"
    }

    private func cancelCurrentAction() {
        if store.pendingFurnitureKind != nil {
            store.cancelCurrentAction()
        } else {
            cancelWallDrawing()
        }
    }

    private func handleKeyboardCommand(_ command: PlanKeyboardCommand) {
        switch command {
        case .inspect:
            store.tool = .select
        case .wall:
            store.tool = .wall
        case .door:
            store.beginDoorPlacement()
        case .erase:
            store.tool = .erase
        case .rotate:
            store.rotateSelectedFurniture()
        case .delete:
            store.deleteSelection()
        case let .nudge(dx, dz):
            store.nudgeSelectedFurniture(dx: dx, dz: dz)
        }
    }

    private func resetTransientInteraction() {
        wallAnchor = nil
        dragStart = nil
        dragCurrent = nil
        wallDragCancelled = false
        furnitureDragID = nil
        furnitureDragCenter = nil
        doorDragID = nil
        doorDragOffset = nil
        wallEditID = nil
        wallEditPart = nil
        wallEditOriginal = nil
        wallEditPreview = nil
        wallEditPointerStart = nil
        snapLabel = nil
        selectionGestureStarted = false
    }

    private static func drawPlan(context: inout GraphicsContext, transform: PlanTransform, snapshot: PlanDrawingSnapshot) {
        drawGrid(context: &context, transform: transform, dimensions: snapshot.plan.dimensions)

        let room = transform.roomRect
        context.fill(Path(room), with: .color(.white.opacity(0.035)))
        context.stroke(Path(room), with: .color(.primary), lineWidth: 3)

        drawWindows(context: &context, transform: transform, dimensions: snapshot.plan.dimensions)
        drawFixedCore(context: &context, transform: transform, dimensions: snapshot.plan.dimensions)

        for wall in snapshot.plan.partitions {
            drawWall(wall, context: &context, transform: transform, dimensions: snapshot.plan.dimensions, selectedWallID: snapshot.selectedWallID, preview: false)
        }
        for door in snapshot.plan.doors {
            drawDoor(
                door,
                context: &context,
                transform: transform,
                plan: snapshot.plan,
                selected: door.id == snapshot.selectedDoorID
            )
        }
        for item in snapshot.plan.furniture {
            drawFurniture(
                item,
                context: &context,
                transform: transform,
                selected: snapshot.selectedFurnitureIDs.contains(item.id)
            )
        }
        for label in snapshot.plan.roomLabels {
            drawRoomLabel(label, context: &context, transform: transform)
        }

        if let placement = snapshot.placementFurniture {
            drawFurniturePreview(
                placement,
                context: &context,
                transform: transform,
                plan: snapshot.plan,
                isValid: snapshot.placementValid
            )
        }

        if let start = snapshot.dragStart, let end = snapshot.dragCurrent {
            drawWall(PartitionWall(start: start, end: end), context: &context, transform: transform, dimensions: snapshot.plan.dimensions, selectedWallID: snapshot.selectedWallID, preview: true)
        }

        if let snapPoint = snapshot.snapPoint {
            drawSnapPoint(
                snapPoint,
                label: snapshot.snapLabel,
                context: &context,
                transform: transform
            )
        }

        drawDimensions(context: &context, transform: transform, dimensions: snapshot.plan.dimensions)
    }

    private static func drawGrid(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let configuredStep = max(0.01, dimensions.gridSpacing)
        let pixelStep = CGFloat(configuredStep) * transform.scale
        let visibilityMultiplier = max(1, Int(ceil(2.5 / max(pixelStep, 0.1))))
        let visibleStep = configuredStep * Float(visibilityMultiplier)
        let majorEvery = max(1, Int((0.50 / visibleStep).rounded()))
        let xCount = Int((dimensions.roomWidth / visibleStep).rounded(.down))
        let zCount = Int((dimensions.roomLength / visibleStep).rounded(.down))
        var minor = Path()
        var major = Path()

        for index in 0...xCount {
            let x = Float(index) * visibleStep
            var line = index % majorEvery == 0 ? major : minor
            line.move(to: transform.point(PlanPoint(x: x, z: 0)))
            line.addLine(to: transform.point(PlanPoint(x: x, z: dimensions.roomLength)))
            if index % majorEvery == 0 { major = line } else { minor = line }
        }
        for index in 0...zCount {
            let z = Float(index) * visibleStep
            var line = index % majorEvery == 0 ? major : minor
            line.move(to: transform.point(PlanPoint(x: 0, z: z)))
            line.addLine(to: transform.point(PlanPoint(x: dimensions.roomWidth, z: z)))
            if index % majorEvery == 0 { major = line } else { minor = line }
        }

        context.stroke(minor, with: .color(.secondary.opacity(0.10)), lineWidth: 0.5)
        context.stroke(major, with: .color(.secondary.opacity(0.22)), lineWidth: 0.75)
    }

    private static func drawWall(_ wall: PartitionWall, context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions, selectedWallID: UUID?, preview: Bool) {
        var path = Path()
        path.move(to: transform.point(wall.start))
        path.addLine(to: transform.point(wall.end))
        let selected = selectedWallID == wall.id
        let color: Color = preview ? .orange : (selected ? .accentColor : .primary)
        context.stroke(path, with: .color(color.opacity(preview ? 0.8 : 1)), style: StrokeStyle(lineWidth: max(4, transform.scale * CGFloat(dimensions.drywallThickness)), lineCap: .square, dash: preview ? [8, 5] : []))
        if selected && !preview {
            for point in [wall.start, wall.end] {
                let screen = transform.point(point)
                let handle = CGRect(x: screen.x - 6, y: screen.y - 6, width: 12, height: 12)
                context.fill(Path(ellipseIn: handle), with: .color(.accentColor))
                context.stroke(Path(ellipseIn: handle), with: .color(.white), lineWidth: 2)
            }
        }
    }

    private static func drawDoor(
        _ door: DoorOpening,
        context: inout GraphicsContext,
        transform: PlanTransform,
        plan: FloorPlan,
        selected: Bool
    ) {
        guard let wall = plan.partitions.first(where: { $0.id == door.wallID }), wall.length > 0 else { return }
        let dx = (wall.end.x - wall.start.x) / wall.length
        let dz = (wall.end.z - wall.start.z) / wall.length
        let openingStart = PlanPoint(
            x: wall.start.x + dx * door.offset,
            z: wall.start.z + dz * door.offset
        )
        let openingEnd = PlanPoint(
            x: wall.start.x + dx * (door.offset + door.width),
            z: wall.start.z + dz * (door.offset + door.width)
        )
        let hingeOffset = door.hinge == .left ? door.offset : door.offset + door.width
        let hinge = PlanPoint(x: wall.start.x + dx * hingeOffset, z: wall.start.z + dz * hingeOffset)
        let sign: Float = door.hinge == .left ? 1 : -1
        let openEnd = PlanPoint(x: hinge.x - dz * door.width * sign, z: hinge.z + dx * door.width * sign)

        var opening = Path()
        opening.move(to: transform.point(openingStart))
        opening.addLine(to: transform.point(openingEnd))
        context.stroke(
            opening,
            with: .color(Color(nsColor: .textBackgroundColor)),
            style: StrokeStyle(
                lineWidth: max(6, transform.scale * CGFloat(plan.dimensions.drywallThickness) + 2),
                lineCap: .square
            )
        )

        var leaf = Path()
        leaf.move(to: transform.point(hinge))
        leaf.addLine(to: transform.point(openEnd))
        let doorColor: Color = selected ? .accentColor : .cyan
        context.stroke(leaf, with: .color(doorColor), lineWidth: selected ? 3.5 : 2.5)

        let centerOffset = door.offset + door.width / 2
        let center = PlanPoint(x: wall.start.x + dx * centerOffset, z: wall.start.z + dz * centerOffset)
        let gapRect = CGRect(x: transform.point(center).x - 5, y: transform.point(center).y - 5, width: 10, height: 10)
        context.fill(Path(ellipseIn: gapRect), with: .color(doorColor))

        guard selected else { return }
        let normal = PlanPoint(x: -dz * 0.20, z: dx * 0.20)
        func labelPoint(at offset: Float) -> CGPoint {
            transform.point(PlanPoint(
                x: wall.start.x + dx * offset + normal.x,
                z: wall.start.z + dz * offset + normal.z
            ))
        }
        let trailing = max(0, wall.length - door.offset - door.width)
        context.draw(
            Text(door.offset.formattedCentimeters).font(.caption2.monospacedDigit()).foregroundStyle(Color.accentColor),
            at: labelPoint(at: door.offset / 2)
        )
        context.draw(
            Text(door.width.formattedCentimeters).font(.caption2.bold().monospacedDigit()).foregroundStyle(Color.accentColor),
            at: labelPoint(at: door.offset + door.width / 2)
        )
        context.draw(
            Text(trailing.formattedCentimeters).font(.caption2.monospacedDigit()).foregroundStyle(Color.accentColor),
            at: labelPoint(at: door.offset + door.width + trailing / 2)
        )
    }

    private static func drawSnapPoint(
        _ point: PlanPoint,
        label: String?,
        context: inout GraphicsContext,
        transform: PlanTransform
    ) {
        let screenPoint = transform.point(point)
        let marker = CGRect(x: screenPoint.x - 4, y: screenPoint.y - 4, width: 8, height: 8)
        context.fill(Path(ellipseIn: marker), with: .color(.accentColor.opacity(0.30)))
        context.stroke(Path(ellipseIn: marker), with: .color(.accentColor), lineWidth: 1.5)
        context.draw(
            Text("\(label.map { "\($0) · " } ?? "")\(point.x.formattedCentimeters), \(point.z.formattedCentimeters)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary),
            at: CGPoint(x: screenPoint.x + 8, y: screenPoint.y - 10),
            anchor: .leading
        )
    }

    private static func drawRoomLabel(
        _ label: RoomLabel,
        context: inout GraphicsContext,
        transform: PlanTransform
    ) {
        let center = transform.point(label.position)
        let background = roomLabelRect(for: label, transform: transform)
        let shape = Path(roundedRect: background, cornerRadius: 9)
        context.fill(shape, with: .color(Color(nsColor: .controlBackgroundColor).opacity(0.92)))
        context.stroke(shape, with: .color(.accentColor.opacity(0.75)), lineWidth: 1.5)
        context.draw(
            Text(label.name)
                .font(.callout.bold())
                .foregroundStyle(.primary),
            at: center
        )
    }

    private static func roomLabelRect(for label: RoomLabel, transform: PlanTransform) -> CGRect {
        let center = transform.point(label.position)
        let estimatedWidth = min(220, max(72, CGFloat(label.name.count) * 7.5 + 28))
        return CGRect(
            x: center.x - estimatedWidth / 2,
            y: center.y - 15,
            width: estimatedWidth,
            height: 30
        )
    }

    private static func drawFurniture(
        _ item: FurnitureItem,
        context: inout GraphicsContext,
        transform: PlanTransform,
        selected: Bool
    ) {
        let rectangle = transform.rect(item.footprint)
        let color: Color = switch item.kind {
        case .singleBed: .indigo
        case .squareTable: .brown
        case .chair: .orange
        case .twoDoorWardrobe: .teal
        }

        context.fill(Path(rectangle), with: .color(color.opacity(0.38)))
        context.stroke(
            Path(rectangle),
            with: .color(selected ? .accentColor : color),
            lineWidth: selected ? 3 : 1.5
        )

        let center = transform.point(item.center)
        let directionLength = max(4, min(rectangle.width, rectangle.height) * 0.30)
        let planDirectionLength = Float(directionLength / max(transform.scale, 0.001))
        let directionPlanPoint: PlanPoint = switch item.direction {
        case .north: item.center + PlanPoint(x: 0, z: planDirectionLength)
        case .east: item.center + PlanPoint(x: planDirectionLength, z: 0)
        case .south: item.center + PlanPoint(x: 0, z: -planDirectionLength)
        case .west: item.center + PlanPoint(x: -planDirectionLength, z: 0)
        }
        let directionEnd = transform.point(directionPlanPoint)
        var directionPath = Path()
        directionPath.move(to: center)
        directionPath.addLine(to: directionEnd)
        context.stroke(directionPath, with: .color(.primary.opacity(0.72)), lineWidth: 1.5)
        context.fill(
            Path(ellipseIn: CGRect(x: directionEnd.x - 2, y: directionEnd.y - 2, width: 4, height: 4)),
            with: .color(.primary)
        )

        context.draw(
            Text(item.kind.planLabel).font(.system(size: 7, weight: .bold, design: .rounded)),
            at: center
        )

        if selected {
            for corner in [
                CGPoint(x: rectangle.minX, y: rectangle.minY),
                CGPoint(x: rectangle.maxX, y: rectangle.minY),
                CGPoint(x: rectangle.minX, y: rectangle.maxY),
                CGPoint(x: rectangle.maxX, y: rectangle.maxY)
            ] {
                context.fill(
                    Path(ellipseIn: CGRect(x: corner.x - 3, y: corner.y - 3, width: 6, height: 6)),
                    with: .color(.accentColor)
                )
            }
        }
    }

    private static func drawFurniturePreview(
        _ item: FurnitureItem,
        context: inout GraphicsContext,
        transform: PlanTransform,
        plan: FloorPlan,
        isValid: Bool
    ) {
        let rectangle = transform.rect(item.footprint)
        let color: Color = isValid ? .green : .red
        context.fill(Path(rectangle), with: .color(color.opacity(0.25)))
        context.stroke(
            Path(rectangle),
            with: .color(color),
            style: StrokeStyle(lineWidth: 3, dash: [7, 4])
        )
        context.draw(
            Text(isValid ? "CLICK TO PLACE" : "SPACE OCCUPIED")
                .font(.caption2.bold())
                .foregroundStyle(color),
            at: transform.point(item.center)
        )
        let aligned = plan.furniture.filter { $0.id != item.id }
        if aligned.contains(where: { abs($0.center.x - item.center.x) < 0.001 }) {
            var guide = Path()
            guide.move(to: transform.point(PlanPoint(x: item.center.x, z: 0)))
            guide.addLine(to: transform.point(PlanPoint(x: item.center.x, z: plan.dimensions.roomLength)))
            context.stroke(guide, with: .color(.green.opacity(0.75)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        if aligned.contains(where: { abs($0.center.z - item.center.z) < 0.001 }) {
            var guide = Path()
            guide.move(to: transform.point(PlanPoint(x: 0, z: item.center.z)))
            guide.addLine(to: transform.point(PlanPoint(x: plan.dimensions.roomWidth, z: item.center.z)))
            context.stroke(guide, with: .color(.green.opacity(0.75)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
    }

    private static func drawWindows(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let width = dimensions.roomWidth
        let frontLeft = transform.point(PlanPoint(x: 0.34, z: 0))
        let frontRight = transform.point(PlanPoint(x: width - 0.34, z: 0))
        var front = Path()
        front.move(to: frontLeft)
        front.addLine(to: frontRight)
        context.stroke(front, with: .color(.blue), style: StrokeStyle(lineWidth: 7, dash: [14, 3]))

        let fixedCore = StairBathroomLayout(dimensions: dimensions)
        let rearLeft = transform.point(PlanPoint(x: fixedCore.rearWindowStartX, z: dimensions.roomLength))
        let rearRight = transform.point(PlanPoint(x: fixedCore.rearWindowEndX, z: dimensions.roomLength))
        var rear = Path()
        rear.move(to: rearLeft)
        rear.addLine(to: rearRight)
        context.stroke(rear, with: .color(.blue), style: StrokeStyle(lineWidth: 7, dash: [18, 3]))
    }

    private static func drawFixedCore(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let layout = StairBathroomLayout(dimensions: dimensions)
        let bathroom = transform.rect(layout.bathroom)
        let upperFlight = transform.rect(layout.upperFlight)
        let lowerOpening = transform.rect(layout.lowerOpening)
        let lowerCovered = transform.rect(layout.lowerCoveredFlight)
        let lowerUnderBathroom = transform.rect(layout.lowerUnderBathroom)

        context.fill(Path(bathroom), with: .color(.teal.opacity(0.14)))
        context.stroke(Path(bathroom), with: .color(.teal), lineWidth: 2)

        context.fill(Path(lowerCovered), with: .color(.purple.opacity(0.08)))
        context.stroke(Path(lowerCovered), with: .color(.purple.opacity(0.75)), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
        context.fill(Path(lowerUnderBathroom), with: .color(.purple.opacity(0.08)))
        context.stroke(Path(lowerUnderBathroom), with: .color(.purple.opacity(0.75)), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))

        context.fill(Path(upperFlight), with: .color(.brown.opacity(0.18)))
        context.stroke(Path(upperFlight), with: .color(.brown), lineWidth: 2)

        let steps = 12
        for index in 1..<steps {
            let x = layout.upperFlight.minX + Float(index) * layout.upperFlight.width / Float(steps)
            var line = Path()
            line.move(to: transform.point(PlanPoint(x: x, z: layout.upperFlight.minZ)))
            line.addLine(to: transform.point(PlanPoint(x: x, z: layout.upperFlight.maxZ)))
            context.stroke(line, with: .color(.brown.opacity(0.5)), lineWidth: 1)
        }

        context.fill(Path(lowerOpening), with: .color(.black.opacity(0.22)))
        context.stroke(Path(lowerOpening), with: .color(.primary), lineWidth: 2)
        var openingRail = Path()
        openingRail.move(to: transform.point(PlanPoint(x: layout.lowerOpening.minX, z: layout.lowerOpening.minZ)))
        openingRail.addLine(to: transform.point(PlanPoint(x: layout.lowerOpening.minX, z: layout.lowerOpening.maxZ)))
        context.stroke(openingRail, with: .color(.primary), lineWidth: 4)

        let bathroomDoorWidth = min(0.72, layout.bathroom.length - 0.20)
        let bathroomDoorStart = layout.bathroom.minZ + (layout.bathroom.length - bathroomDoorWidth) / 2
        let bathroomDoorEnd = bathroomDoorStart + bathroomDoorWidth
        let bathroomHinge = transform.point(PlanPoint(x: layout.bathroom.minX, z: bathroomDoorStart))
        var bathroomDoorGap = Path()
        bathroomDoorGap.move(to: bathroomHinge)
        bathroomDoorGap.addLine(to: transform.point(PlanPoint(x: layout.bathroom.minX, z: bathroomDoorEnd)))
        context.stroke(bathroomDoorGap, with: .color(Color(nsColor: .textBackgroundColor)), lineWidth: 5)
        var bathroomDoorLeaf = Path()
        bathroomDoorLeaf.move(to: bathroomHinge)
        bathroomDoorLeaf.addLine(to: transform.point(PlanPoint(x: layout.bathroom.minX - bathroomDoorWidth, z: bathroomDoorStart)))
        context.stroke(bathroomDoorLeaf, with: .color(.teal), lineWidth: 2)

        let coreLabel = Font.system(size: 7, weight: .semibold, design: .rounded)
        let compactMeasurement = FloatingPointFormatStyle<Float>.number.precision(.fractionLength(2))
        context.draw(Text("BATH\n1.75 m DEEP").font(coreLabel).foregroundStyle(.teal), at: CGPoint(x: bathroom.midX, y: bathroom.midY))
        context.draw(
            Text("UP \(transform.rotation.positiveXArrow)")
                .font(coreLabel)
                .foregroundStyle(.brown),
            at: CGPoint(x: upperFlight.midX, y: upperFlight.midY)
        )
        context.draw(Text("LOWER OPENING\n\(layout.lowerOpening.width.formatted(compactMeasurement)) × \(layout.lowerOpening.length.formatted(compactMeasurement))").font(coreLabel).foregroundStyle(.primary), at: CGPoint(x: lowerOpening.midX, y: lowerOpening.midY))
    }

    private static func drawDimensions(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let d = dimensions
        let shellEdgesAreVertical = transform.rotation == .right90 || transform.rotation == .left90
        let widthLabelX = shellEdgesAreVertical ? d.roomWidth * 0.25 : d.roomWidth / 2
        let frontLabelX = shellEdgesAreVertical ? d.roomWidth * 0.72 : d.roomWidth / 2
        let widthLabelZ: Float = transform.rotation == .zero ? 0.25 : -0.45
        let frontLabelZ: Float = switch transform.rotation {
        case .zero: 0.60
        case .right90, .left90: -0.25
        case .halfTurn: -0.60
        }
        context.draw(
            Text(d.roomLength.formattedMeters).font(.caption.monospacedDigit()).foregroundStyle(.secondary),
            at: transform.point(PlanPoint(x: d.roomWidth + 0.65, z: d.roomLength / 2)),
            anchor: .center
        )
        context.draw(
            Text(d.roomWidth.formattedMeters).font(.caption.monospacedDigit()).foregroundStyle(.secondary),
            at: transform.point(PlanPoint(x: widthLabelX, z: widthLabelZ)),
            anchor: .center
        )
        context.draw(
            Text("4-PANE FRONT WINDOW").font(.caption2).foregroundStyle(.blue),
            at: transform.point(PlanPoint(x: frontLabelX, z: frontLabelZ))
        )
        let rearWindow = StairBathroomLayout(dimensions: d)
        let rearWindowWidth = rearWindow.rearWindowEndX - rearWindow.rearWindowStartX
        let rearLabelZ: Float = switch transform.rotation {
        case .zero: d.roomLength + 0.35
        case .right90, .left90: d.roomLength + 0.30
        case .halfTurn: d.roomLength - 0.60
        }
        context.draw(
            Text("2-PANE REAR ≈\(rearWindowWidth.formattedMeters)")
                .font(.caption2)
                .foregroundStyle(.blue),
            at: transform.point(PlanPoint(
                x: (rearWindow.rearWindowStartX + rearWindow.rearWindowEndX) / 2,
                z: rearLabelZ
            ))
        )
    }
}

private struct PlanDrawingSnapshot: Sendable {
    var plan: FloorPlan
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedFurnitureIDs: Set<UUID>
    var dragStart: PlanPoint?
    var dragCurrent: PlanPoint?
    var snapPoint: PlanPoint?
    var snapLabel: String?
    var placementFurniture: FurnitureItem?
    var placementValid: Bool
}

private struct PlanTransform: Sendable {
    let roomRect: CGRect
    let baseScale: CGFloat
    let scale: CGFloat
    let dimensions: SurveyDimensions
    let rotation: PlanRotation

    init(
        size: CGSize,
        dimensions: SurveyDimensions,
        zoomScale: Float,
        viewportCenter: PlanPoint?,
        rotation: PlanRotation
    ) {
        self.dimensions = dimensions
        self.rotation = rotation
        let displaySize = rotation.displaySize(for: dimensions)
        let available = CGSize(width: max(1, size.width - 150), height: max(1, size.height - 110))
        baseScale = min(
            available.width / CGFloat(displaySize.width),
            available.height / CGFloat(displaySize.height)
        )
        scale = baseScale * CGFloat(zoomScale)
        let center = viewportCenter ?? PlanPoint(
            x: dimensions.roomWidth / 2,
            z: dimensions.roomLength / 2
        )
        let displayCenter = rotation.displayPoint(center, dimensions: dimensions)
        let roomSize = CGSize(
            width: CGFloat(displaySize.width) * scale,
            height: CGFloat(displaySize.height) * scale
        )
        roomRect = CGRect(
            x: size.width / 2 - CGFloat(displayCenter.x) * scale,
            y: size.height / 2 - CGFloat(displaySize.height - displayCenter.z) * scale,
            width: roomSize.width,
            height: roomSize.height
        )
    }

    func point(_ point: PlanPoint) -> CGPoint {
        let displayPoint = displayPoint(point)
        return CGPoint(
            x: roomRect.minX + CGFloat(displayPoint.x) * scale,
            y: roomRect.maxY - CGFloat(displayPoint.z) * scale
        )
    }

    func rect(_ rectangle: PlanRectangle) -> CGRect {
        let displayRectangle = rotation.displayRectangle(rectangle, dimensions: dimensions)
        return CGRect(
            x: roomRect.minX + CGFloat(displayRectangle.minX) * scale,
            y: roomRect.maxY - CGFloat(displayRectangle.maxZ) * scale,
            width: CGFloat(displayRectangle.width) * scale,
            height: CGFloat(displayRectangle.length) * scale
        )
    }

    func planPoint(from point: CGPoint) -> PlanPoint {
        let displaySize = rotation.displaySize(for: dimensions)
        let display = PlanPoint(
            x: Float((point.x - roomRect.minX) / scale).clamped(to: 0...displaySize.width),
            z: Float((roomRect.maxY - point.y) / scale).clamped(to: 0...displaySize.height)
        )
        return planPoint(fromDisplay: display)
    }

    func displayPoint(_ point: PlanPoint) -> PlanPoint {
        rotation.displayPoint(point, dimensions: dimensions)
    }

    func planPoint(fromDisplay point: PlanPoint) -> PlanPoint {
        rotation.planPoint(point, dimensions: dimensions).clamped(to: dimensions)
    }

    func snappedPlanPoint(from point: CGPoint) -> PlanPoint {
        dimensions.snapped(planPoint(from: point))
    }
}

private struct PlanOverviewView: View {
    let plan: FloorPlan
    let viewportCenter: PlanPoint
    let viewportSize: CGSize
    let mainScale: CGFloat
    let rotation: PlanRotation
    let navigate: (PlanPoint) -> Void

    var body: some View {
        GeometryReader { geometry in
            let displaySize = rotation.displaySize(for: plan.dimensions)
            let scale = min(
                geometry.size.width / CGFloat(displaySize.width),
                geometry.size.height / CGFloat(displaySize.height)
            )
            let room = CGRect(
                x: (geometry.size.width - CGFloat(displaySize.width) * scale) / 2,
                y: (geometry.size.height - CGFloat(displaySize.height) * scale) / 2,
                width: CGFloat(displaySize.width) * scale,
                height: CGFloat(displaySize.height) * scale
            )
            Canvas { context, _ in
                context.fill(Path(room), with: .color(.black.opacity(0.08)))
                context.stroke(Path(room), with: .color(.primary.opacity(0.65)), lineWidth: 1)

                func point(_ value: PlanPoint) -> CGPoint {
                    let display = rotation.displayPoint(value, dimensions: plan.dimensions)
                    return CGPoint(
                        x: room.minX + CGFloat(display.x) * scale,
                        y: room.maxY - CGFloat(display.z) * scale
                    )
                }
                for wall in plan.partitions {
                    var path = Path()
                    path.move(to: point(wall.start))
                    path.addLine(to: point(wall.end))
                    context.stroke(path, with: .color(.primary), lineWidth: 1.5)
                }
                for item in plan.furniture {
                    let displayRectangle = rotation.displayRectangle(
                        item.footprint,
                        dimensions: plan.dimensions
                    )
                    let rect = CGRect(
                        x: room.minX + CGFloat(displayRectangle.minX) * scale,
                        y: room.maxY - CGFloat(displayRectangle.maxZ) * scale,
                        width: CGFloat(displayRectangle.width) * scale,
                        height: CGFloat(displayRectangle.length) * scale
                    )
                    context.fill(Path(rect), with: .color(.accentColor.opacity(0.5)))
                }

                let visibleWidth = min(
                    displaySize.width,
                    Float(viewportSize.width / max(mainScale, 0.001))
                )
                let visibleLength = min(
                    displaySize.height,
                    Float(viewportSize.height / max(mainScale, 0.001))
                )
                let displayCenter = rotation.displayPoint(
                    viewportCenter,
                    dimensions: plan.dimensions
                )
                let visible = CGRect(
                    x: room.minX + CGFloat(displayCenter.x - visibleWidth / 2) * scale,
                    y: room.maxY - CGFloat(displayCenter.z + visibleLength / 2) * scale,
                    width: CGFloat(visibleWidth) * scale,
                    height: CGFloat(visibleLength) * scale
                )
                context.stroke(Path(visible), with: .color(.orange), lineWidth: 2)
            }
            .contentShape(Rectangle())
            .onTapGesture { location in
                let display = PlanPoint(
                    x: Float((location.x - room.minX) / scale).clamped(to: 0...displaySize.width),
                    z: Float((room.maxY - location.y) / scale).clamped(to: 0...displaySize.height)
                )
                navigate(rotation.planPoint(display, dimensions: plan.dimensions))
            }
        }
        .frame(
            width: rotation == .right90 || rotation == .left90 ? 180 : 92,
            height: rotation == .right90 || rotation == .left90 ? 92 : 180
        )
        .padding(7)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .help("Plan overview · click to jump")
        .accessibilityLabel("Plan overview")
        .accessibilityHint("Click a position to move the zoomed plan there")
    }
}
