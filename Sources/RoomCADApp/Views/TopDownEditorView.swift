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

    var body: some View {
        GeometryReader { geometry in
            let transform = PlanTransform(size: geometry.size, dimensions: store.plan.dimensions)
            let snapshot = PlanDrawingSnapshot(
                plan: previewPlan,
                selectedWallID: store.selectedWallID,
                selectedDoorID: store.selectedDoorID,
                selectedFurnitureID: store.selectedFurnitureID,
                dragStart: wallAnchor ?? dragStart,
                dragCurrent: dragCurrent ?? (wallAnchor == nil ? nil : hoverPoint),
                snapPoint: hoverPoint
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
                            case .wall: break
                            }
                        }
                }
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    hoverPoint = transform.snappedPlanPoint(from: location)
                case .ended:
                    hoverPoint = nil
                }
            }
            .background {
                EscapeKeyMonitor(
                    isEnabled: store.tool == .wall
                        && (wallAnchor != nil || dragStart != nil || dragCurrent != nil),
                    action: cancelWallDrawing
                )
                .frame(width: 0, height: 0)
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
            .onChange(of: store.tool) { _, _ in resetTransientInteraction() }
            .onChange(of: store.mode) { _, _ in resetTransientInteraction() }
            .onChange(of: store.plan.dimensions.gridSpacing) { _, _ in resetTransientInteraction() }
        }
    }

    private var instruction: String {
        switch store.tool {
        case .wall: "Click points to chain walls, or drag one wall · Esc cancels"
        case .door: "Click a wall to place a 90 cm door, then Inspect to slide it"
        case .erase: "Click furniture, a door, or a wall to remove it"
        case .select: "Drag doors along walls or furniture across the grid"
        }
    }

    private func wallGesture(transform: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard !wallDragCancelled else { return }
                if dragStart == nil {
                    dragStart = wallAnchor ?? transform.snappedPlanPoint(from: value.startLocation)
                }
                dragCurrent = transform.snappedPlanPoint(from: value.location)
            }
            .onEnded { value in
                if wallDragCancelled {
                    wallDragCancelled = false
                    dragStart = nil
                    dragCurrent = nil
                    return
                }
                let end = transform.snappedPlanPoint(from: value.location)
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
                if furnitureDragID == nil && doorDragID == nil {
                    store.select(near: transform.planPoint(from: value.startLocation))
                    furnitureDragID = store.selectedFurnitureID
                    doorDragID = store.selectedDoorID
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
                furnitureDragID = nil
                furnitureDragCenter = nil
                doorDragID = nil
                doorDragOffset = nil
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
        return plan
    }

    @ViewBuilder
    private var selectionControls: some View {
        if let item = store.selectedFurniture {
            HStack(spacing: 8) {
                Label(item.kind.title, systemImage: item.kind.systemImage)
                Text(item.kind.footprintLabel)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Button("Rotate", systemImage: "rotate.right") { store.rotateSelectedFurniture() }
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
        }
    }

    private func cancelWallChain() {
        wallAnchor = nil
        dragStart = nil
        dragCurrent = nil
        store.statusMessage = "Wall chain finished"
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

    private func resetTransientInteraction() {
        wallAnchor = nil
        dragStart = nil
        dragCurrent = nil
        wallDragCancelled = false
        furnitureDragID = nil
        furnitureDragCenter = nil
        doorDragID = nil
        doorDragOffset = nil
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
                selected: item.id == snapshot.selectedFurnitureID
            )
        }

        if let start = snapshot.dragStart, let end = snapshot.dragCurrent {
            drawWall(PartitionWall(start: start, end: end), context: &context, transform: transform, dimensions: snapshot.plan.dimensions, selectedWallID: snapshot.selectedWallID, preview: true)
        }

        if let snapPoint = snapshot.snapPoint {
            drawSnapPoint(snapPoint, context: &context, transform: transform)
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
        context: inout GraphicsContext,
        transform: PlanTransform
    ) {
        let screenPoint = transform.point(point)
        let marker = CGRect(x: screenPoint.x - 4, y: screenPoint.y - 4, width: 8, height: 8)
        context.fill(Path(ellipseIn: marker), with: .color(.accentColor.opacity(0.30)))
        context.stroke(Path(ellipseIn: marker), with: .color(.accentColor), lineWidth: 1.5)
        context.draw(
            Text("\(point.x.formattedCentimeters), \(point.z.formattedCentimeters)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary),
            at: CGPoint(x: screenPoint.x + 8, y: screenPoint.y - 10),
            anchor: .leading
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
        let directionEnd: CGPoint = switch item.direction {
        case .north: CGPoint(x: center.x, y: center.y - directionLength)
        case .east: CGPoint(x: center.x + directionLength, y: center.y)
        case .south: CGPoint(x: center.x, y: center.y + directionLength)
        case .west: CGPoint(x: center.x - directionLength, y: center.y)
        }
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
        let landing = transform.rect(layout.landing)
        let lowerOpening = transform.rect(layout.lowerOpening)
        let lowerCovered = transform.rect(layout.lowerCoveredFlight)
        let lowerUnderBathroom = transform.rect(layout.lowerUnderBathroom)

        context.fill(Path(bathroom), with: .color(.teal.opacity(0.14)))
        context.stroke(Path(bathroom), with: .color(.teal), lineWidth: 2)

        context.fill(Path(lowerCovered), with: .color(.purple.opacity(0.08)))
        context.stroke(Path(lowerCovered), with: .color(.purple.opacity(0.75)), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
        context.fill(Path(lowerUnderBathroom), with: .color(.purple.opacity(0.08)))
        context.stroke(Path(lowerUnderBathroom), with: .color(.purple.opacity(0.75)), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))

        // This is usable floor, not a constructed block. Keep the floor/grid
        // visible and use only a light dashed survey boundary.
        context.stroke(
            Path(landing),
            with: .color(.green.opacity(0.60)),
            style: StrokeStyle(lineWidth: 1.25, dash: [5, 4])
        )

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
        openingRail.move(to: transform.point(PlanPoint(x: layout.lowerOpening.minX, z: layout.lowerOpening.minZ)))
        openingRail.addLine(to: transform.point(PlanPoint(x: layout.lowerOpening.maxX, z: layout.lowerOpening.minZ)))
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
        context.draw(Text("UP →").font(coreLabel).foregroundStyle(.brown), at: CGPoint(x: upperFlight.midX, y: upperFlight.midY))
        context.draw(Text("LOWER OPENING\n\(layout.lowerOpening.width.formatted(compactMeasurement)) × \(layout.lowerOpening.length.formatted(compactMeasurement))").font(coreLabel).foregroundStyle(.primary), at: CGPoint(x: lowerOpening.midX, y: lowerOpening.midY))
        context.draw(Text("FREE LANDING SPACE\n\(layout.landing.width.formatted(compactMeasurement)) × \(layout.landing.length.formatted(compactMeasurement))").font(coreLabel).foregroundStyle(.green), at: CGPoint(x: landing.midX, y: landing.midY))
    }

    private static func drawDimensions(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let d = dimensions
        context.draw(
            Text(d.roomLength.formattedMeters).font(.caption.monospacedDigit()).foregroundStyle(.secondary),
            at: CGPoint(x: transform.roomRect.maxX + 34, y: transform.roomRect.midY),
            anchor: .center
        )
        context.draw(
            Text(d.roomWidth.formattedMeters).font(.caption.monospacedDigit()).foregroundStyle(.secondary),
            at: CGPoint(x: transform.roomRect.midX, y: transform.roomRect.maxY + 18),
            anchor: .center
        )
        context.draw(Text("4-PANE FRONT WINDOW").font(.caption2).foregroundStyle(.blue), at: CGPoint(x: transform.roomRect.midX, y: transform.roomRect.maxY + 38))
        let rearWindow = StairBathroomLayout(dimensions: d)
        let rearWindowWidth = rearWindow.rearWindowEndX - rearWindow.rearWindowStartX
        context.draw(Text("2-PANE REAR ≈\(rearWindowWidth.formattedMeters)").font(.caption2).foregroundStyle(.blue), at: CGPoint(x: transform.roomRect.minX + transform.roomRect.width * 0.28, y: transform.roomRect.minY - 14))
    }
}

private struct PlanDrawingSnapshot: Sendable {
    var plan: FloorPlan
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedFurnitureID: UUID?
    var dragStart: PlanPoint?
    var dragCurrent: PlanPoint?
    var snapPoint: PlanPoint?
}

private struct PlanTransform: Sendable {
    let roomRect: CGRect
    let scale: CGFloat
    let dimensions: SurveyDimensions

    init(size: CGSize, dimensions: SurveyDimensions) {
        self.dimensions = dimensions
        let available = CGSize(width: max(1, size.width - 150), height: max(1, size.height - 110))
        scale = min(available.width / CGFloat(dimensions.roomWidth), available.height / CGFloat(dimensions.roomLength))
        let roomSize = CGSize(width: CGFloat(dimensions.roomWidth) * scale, height: CGFloat(dimensions.roomLength) * scale)
        roomRect = CGRect(
            x: (size.width - roomSize.width) / 2,
            y: (size.height - roomSize.height) / 2,
            width: roomSize.width,
            height: roomSize.height
        )
    }

    func point(_ point: PlanPoint) -> CGPoint {
        CGPoint(
            x: roomRect.minX + CGFloat(point.x) * scale,
            y: roomRect.maxY - CGFloat(point.z) * scale
        )
    }

    func rect(_ rectangle: PlanRectangle) -> CGRect {
        let topLeft = point(PlanPoint(x: rectangle.minX, z: rectangle.maxZ))
        return CGRect(
            x: topLeft.x,
            y: topLeft.y,
            width: CGFloat(rectangle.width) * scale,
            height: CGFloat(rectangle.length) * scale
        )
    }

    func planPoint(from point: CGPoint) -> PlanPoint {
        PlanPoint(
            x: Float((point.x - roomRect.minX) / scale).clamped(to: 0...dimensions.roomWidth),
            z: Float((roomRect.maxY - point.y) / scale).clamped(to: 0...dimensions.roomLength)
        )
    }

    func snappedPlanPoint(from point: CGPoint) -> PlanPoint {
        dimensions.snapped(planPoint(from: point))
    }
}
