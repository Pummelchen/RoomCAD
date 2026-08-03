import SwiftUI

struct TopDownEditorView: View {
    let store: FloorPlanStore
    @State private var dragStart: PlanPoint?
    @State private var dragCurrent: PlanPoint?

    var body: some View {
        GeometryReader { geometry in
            let transform = PlanTransform(size: geometry.size, dimensions: store.plan.dimensions)
            let snapshot = PlanDrawingSnapshot(
                plan: store.plan,
                selectedWallID: store.selectedWallID,
                dragStart: dragStart,
                dragCurrent: dragCurrent
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
            .overlay(alignment: .bottomLeading) {
                Label(instruction, systemImage: store.tool.systemImage)
                    .font(.callout)
                    .padding(10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(14)
            }
        }
    }

    private var instruction: String {
        switch store.tool {
        case .wall: "Drag to draw; endpoints snap to \(store.plan.dimensions.gridSpacing.formattedCentimeters)"
        case .door: "Click a wall to place one 90 cm door"
        case .erase: "Click a door or wall to remove it"
        case .select: "Click a wall to inspect exact dimensions"
        }
    }

    private func wallGesture(transform: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragStart == nil { dragStart = transform.planPoint(from: value.startLocation) }
                dragCurrent = transform.planPoint(from: value.location)
            }
            .onEnded { value in
                let end = transform.planPoint(from: value.location)
                if let start = dragStart { store.addWall(from: start, to: end) }
                dragStart = nil
                dragCurrent = nil
            }
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
            drawDoor(door, context: &context, transform: transform, plan: snapshot.plan)
        }

        if let start = snapshot.dragStart, let end = snapshot.dragCurrent {
            drawWall(PartitionWall(start: start, end: end), context: &context, transform: transform, dimensions: snapshot.plan.dimensions, selectedWallID: snapshot.selectedWallID, preview: true)
        }

        drawDimensions(context: &context, transform: transform, dimensions: snapshot.plan.dimensions)
    }

    private static func drawGrid(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let step: Float = 0.5
        var path = Path()
        var x: Float = 0
        while x <= dimensions.roomWidth + 0.001 {
            path.move(to: transform.point(PlanPoint(x: x, z: 0)))
            path.addLine(to: transform.point(PlanPoint(x: x, z: dimensions.roomLength)))
            x += step
        }
        var z: Float = 0
        while z <= dimensions.roomLength + 0.001 {
            path.move(to: transform.point(PlanPoint(x: 0, z: z)))
            path.addLine(to: transform.point(PlanPoint(x: dimensions.roomWidth, z: z)))
            z += step
        }
        context.stroke(path, with: .color(.secondary.opacity(0.12)), lineWidth: 0.5)
    }

    private static func drawWall(_ wall: PartitionWall, context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions, selectedWallID: UUID?, preview: Bool) {
        var path = Path()
        path.move(to: transform.point(wall.start))
        path.addLine(to: transform.point(wall.end))
        let selected = selectedWallID == wall.id
        let color: Color = preview ? .orange : (selected ? .accentColor : .primary)
        context.stroke(path, with: .color(color.opacity(preview ? 0.8 : 1)), style: StrokeStyle(lineWidth: max(4, transform.scale * CGFloat(dimensions.drywallThickness)), lineCap: .square, dash: preview ? [8, 5] : []))
    }

    private static func drawDoor(_ door: DoorOpening, context: inout GraphicsContext, transform: PlanTransform, plan: FloorPlan) {
        guard let wall = plan.partitions.first(where: { $0.id == door.wallID }), wall.length > 0 else { return }
        let dx = (wall.end.x - wall.start.x) / wall.length
        let dz = (wall.end.z - wall.start.z) / wall.length
        let hingeOffset = door.hinge == .left ? door.offset : door.offset + door.width
        let hinge = PlanPoint(x: wall.start.x + dx * hingeOffset, z: wall.start.z + dz * hingeOffset)
        let sign: Float = door.hinge == .left ? 1 : -1
        let openEnd = PlanPoint(x: hinge.x - dz * door.width * sign, z: hinge.z + dx * door.width * sign)

        var leaf = Path()
        leaf.move(to: transform.point(hinge))
        leaf.addLine(to: transform.point(openEnd))
        context.stroke(leaf, with: .color(.cyan), lineWidth: 2.5)

        let centerOffset = door.offset + door.width / 2
        let center = PlanPoint(x: wall.start.x + dx * centerOffset, z: wall.start.z + dz * centerOffset)
        let gapRect = CGRect(x: transform.point(center).x - 5, y: transform.point(center).y - 5, width: 10, height: 10)
        context.fill(Path(ellipseIn: gapRect), with: .color(.cyan))
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

        context.fill(Path(landing), with: .color(.orange.opacity(0.10)))
        context.stroke(Path(landing), with: .color(.orange.opacity(0.75)), lineWidth: 1.5)

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
        context.draw(Text("BATH\nLOWER STAIR BELOW").font(coreLabel).foregroundStyle(.teal), at: CGPoint(x: bathroom.midX, y: bathroom.midY))
        context.draw(Text("UP →").font(coreLabel).foregroundStyle(.brown), at: CGPoint(x: upperFlight.midX, y: upperFlight.midY))
        context.draw(Text("LOWER OPENING\n\(layout.lowerOpening.width.formatted(compactMeasurement)) × \(layout.lowerOpening.length.formatted(compactMeasurement))").font(coreLabel).foregroundStyle(.primary), at: CGPoint(x: lowerOpening.midX, y: lowerOpening.midY))
        context.draw(Text("LANDING\n\(layout.landing.width.formatted(compactMeasurement)) × \(layout.landing.length.formatted(compactMeasurement))").font(coreLabel).foregroundStyle(.orange), at: CGPoint(x: landing.midX, y: landing.midY))
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
    var dragStart: PlanPoint?
    var dragCurrent: PlanPoint?
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
}
