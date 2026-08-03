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

        let rearLeft = transform.point(PlanPoint(x: 0.30, z: dimensions.roomLength))
        let rearRight = transform.point(PlanPoint(x: min(2.45, width - 0.3), z: dimensions.roomLength))
        var rear = Path()
        rear.move(to: rearLeft)
        rear.addLine(to: rearRight)
        context.stroke(rear, with: .color(.blue), style: StrokeStyle(lineWidth: 7, dash: [18, 3]))
    }

    private static func drawFixedCore(context: inout GraphicsContext, transform: PlanTransform, dimensions: SurveyDimensions) {
        let d = dimensions
        let coreStart = d.roomLength - d.stairCoreLength
        let coreX = max(0, d.roomWidth - d.stairCoreWidth)
        let stairRect = CGRect(
            x: transform.point(PlanPoint(x: coreX, z: d.roomLength)).x,
            y: transform.point(PlanPoint(x: coreX, z: d.roomLength)).y,
            width: CGFloat(d.stairCoreWidth) * transform.scale,
            height: CGFloat(d.stairCoreLength) * transform.scale
        )
        context.fill(Path(stairRect), with: .color(.brown.opacity(0.16)))
        context.stroke(Path(stairRect), with: .color(.brown), lineWidth: 2)

        let steps = 14
        for index in 1..<steps {
            let z = coreStart + Float(index) * d.stairCoreLength / Float(steps)
            var line = Path()
            line.move(to: transform.point(PlanPoint(x: coreX, z: z)))
            line.addLine(to: transform.point(PlanPoint(x: d.roomWidth, z: z)))
            context.stroke(line, with: .color(.brown.opacity(0.5)), lineWidth: 1)
        }

        let bathWidth = min(1.35, max(1.0, coreX - 0.15))
        let bathroom = CGRect(
            x: transform.point(PlanPoint(x: coreX - bathWidth, z: d.roomLength)).x,
            y: transform.point(PlanPoint(x: coreX - bathWidth, z: d.roomLength)).y,
            width: CGFloat(bathWidth) * transform.scale,
            height: CGFloat(2.50) * transform.scale
        )
        context.fill(Path(bathroom), with: .color(.teal.opacity(0.12)))
        context.stroke(Path(bathroom), with: .color(.teal), lineWidth: 2)

        context.draw(Text("STAIRS").font(.caption2).foregroundStyle(.brown), at: CGPoint(x: stairRect.midX, y: stairRect.midY))
        context.draw(Text("BATH").font(.caption2).foregroundStyle(.teal), at: CGPoint(x: bathroom.midX, y: bathroom.midY))
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
        context.draw(Text("2-PANE REAR").font(.caption2).foregroundStyle(.blue), at: CGPoint(x: transform.roomRect.minX + transform.roomRect.width * 0.28, y: transform.roomRect.minY - 14))
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

    func planPoint(from point: CGPoint) -> PlanPoint {
        PlanPoint(
            x: Float((point.x - roomRect.minX) / scale).clamped(to: 0...dimensions.roomWidth),
            z: Float((roomRect.maxY - point.y) / scale).clamped(to: 0...dimensions.roomLength)
        )
    }
}
