import SwiftUI

struct PlanEditorView: View {
    let store: RoomStore

    @State private var hoverPoint: PlanPoint?
    @State private var scale: Double = 100
    @State private var origin: CGPoint = .zero
    @State private var didFit = false
    @State private var drag: DragState = .idle
    @State private var lastDragPoint: PlanPoint?

    var body: some View {
        GeometryReader { geometry in
            let transform = PlanTransform(scale: scale, origin: origin)
            let snapshot = PlanDrawingSnapshot(
                room: store.room,
                selectedWallID: store.selectedWallID,
                selectedDoorID: store.selectedDoorID,
                selectedWindowID: store.selectedWindowID,
                selectedFurnitureID: store.selectedFurnitureID,
                hoverPoint: hoverPoint,
                tool: store.tool,
                pendingFurnitureKind: store.pendingFurnitureKind,
                drag: drag
            )
            ZStack {
                Color(red: 0.965, green: 0.965, blue: 0.955)
                Canvas(opaque: false, colorMode: .linear, rendersAsynchronously: true) { context, _ in
                    PlanCanvasRenderer.draw(
                        context: &context,
                        size: geometry.size,
                        snapshot: snapshot,
                        transform: transform
                    )
                }
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(editorGesture(transform: transform))
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let location):
                            hoverPoint = transform.plan(location)
                        case .ended:
                            hoverPoint = nil
                        }
                    }
            }
            .background {
                ZStack {
                    ScrollWheelMonitor { delta, location in
                        zoom(by: delta, at: location)
                    }
                    CanvasPanMonitor { delta in
                        origin = CGPoint(x: origin.x + delta.width, y: origin.y + delta.height)
                    }
                    PlanKeyboardMonitor(gridSpacing: store.room.grid.meters) { command in
                        handleKeyboardCommand(command)
                    }
                    EscapeKeyMonitor(isEnabled: true, action: cancelActiveInteraction)
                }
            }
            .overlay(alignment: .topLeading) {
                Button {
                    fitPlan(size: geometry.size)
                } label: {
                    Label("Fit Plan", systemImage: "arrow.down.right.and.arrow.up.left")
                }
                .labelStyle(.iconOnly)
                .help("Fit the whole room in view")
                .buttonStyle(.bordered)
                .padding(12)
            }
            .onAppear {
                if !didFit { fitPlan(size: geometry.size) }
            }
            .onChange(of: geometry.size) { _, newSize in
                if !didFit { fitPlan(size: newSize) }
            }
            .onChange(of: store.room.id) { _, _ in fitPlan(size: geometry.size) }
            .onChange(of: store.room.width) { _, _ in fitPlan(size: geometry.size) }
            .onChange(of: store.room.length) { _, _ in fitPlan(size: geometry.size) }
        }
    }

    // MARK: Viewport

    private func fitPlan(size: CGSize) {
        guard size.width > 10, size.height > 10 else { return }
        let roomWidth = store.room.width
        let roomLength = store.room.length
        let padding: Double = 70
        let newScale = min(
            (Double(size.width) - padding) / roomWidth,
            (Double(size.height) - padding) / roomLength
        ).clamped(to: 20...400)
        scale = newScale
        origin = CGPoint(
            x: (size.width - roomWidth * newScale) / 2,
            y: (size.height - roomLength * newScale) / 2
        )
        didFit = true
    }

    private func zoom(by delta: CGFloat, at location: CGPoint) {
        let factor = pow(1.12, Double(delta))
        let newScale = (scale * factor).clamped(to: 20...400)
        guard abs(newScale - scale) > 0.0001 else { return }
        let plan = PlanTransform(scale: scale, origin: origin).plan(location)
        scale = newScale
        origin = CGPoint(x: location.x - plan.x * scale, y: location.y - plan.z * scale)
    }

    // MARK: Gestures

    private func editorGesture(transform: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                let point = transform.plan(value.location)
                handleDragChanged(point: point, startLocation: value.startLocation)
            }
            .onEnded { value in
                let point = transform.plan(value.location)
                handleDragEnded(
                    point: point,
                    startLocation: value.startLocation,
                    endLocation: value.location
                )
            }
    }

    private func handleDragChanged(point: PlanPoint, startLocation: CGPoint) {
        switch store.tool {
        case .select:
            if case .idle = drag {
                beginSelectDrag(at: point)
            }
            updateSelectDrag(to: point)
        case .wall:
            if case .idle = drag {
                let anchor = store.room.snapPoint(point)
                drag = .drawingWall(anchor: anchor, current: anchor)
            }
            if case .drawingWall(let anchor, _) = drag {
                drag = .drawingWall(anchor: anchor, current: store.room.snapPoint(point))
            }
        case .door, .window, .furniture, .erase:
            break
        }
        lastDragPoint = point
    }

    private func beginSelectDrag(at point: PlanPoint) {
        if let furniture = store.room.furniture(near: point, tolerance: 0.12) {
            drag = .movingFurniture(id: furniture.id)
            store.beginDragTransaction()
        } else if let opening = store.room.opening(near: point) {
            drag = .slidingOpening(kind: opening.kind, id: opening.id)
            store.beginDragTransaction()
        } else if let wall = store.room.wall(near: point, tolerance: 0.12) {
            let startDistance = wall.start.distance(to: point)
            let endDistance = wall.end.distance(to: point)
            if min(startDistance, endDistance) <= 0.18 {
                drag = .draggingWallEndpoint(
                    id: wall.id,
                    part: startDistance <= endDistance ? .start : .end
                )
            } else {
                drag = .movingWall(id: wall.id)
            }
            store.beginDragTransaction()
        }
    }

    private func updateSelectDrag(to point: PlanPoint) {
        switch drag {
        case .movingFurniture(let id):
            store.moveFurniture(id: id, to: point)
        case .slidingOpening(let kind, let id):
            store.slideOpening(kind: kind, id: id, to: point)
        case .draggingWallEndpoint(let id, let part):
            store.updateWallEndpoint(id: id, part: part, to: point)
        case .movingWall(let id):
            if let lastDragPoint {
                store.moveWall(id: id, by: point - lastDragPoint)
            }
        case .idle, .drawingWall:
            break
        }
    }

    private func handleDragEnded(point: PlanPoint, startLocation: CGPoint, endLocation: CGPoint) {
        let moved = hypot(
            Double(endLocation.x - startLocation.x),
            Double(endLocation.y - startLocation.y)
        )
        switch drag {
        case .idle:
            switch store.tool {
            case .door:
                store.placeOpening(kind: .door, near: point)
            case .window:
                store.placeOpening(kind: .window, near: point)
            case .furniture:
                if let kind = store.pendingFurnitureKind {
                    store.placeFurniture(kind: kind, near: point)
                }
            case .erase:
                store.erase(near: point)
            case .select:
                store.select(near: point)
            case .wall:
                break
            }
        case .drawingWall(let anchor, let current):
            if current.distance(to: anchor) >= RoomPlan.minimumWallLength {
                store.addWall(from: anchor, to: current)
            } else {
                store.statusMessage = "Walls need to be at least 30 cm long"
            }
        case .movingFurniture:
            if moved < 4 {
                store.discardDragTransaction()
                store.select(near: point)
            } else {
                store.endDragTransaction(message: "Moved furniture")
            }
        case .slidingOpening(let kind, _):
            if moved < 4 {
                store.discardDragTransaction()
                store.select(near: point)
            } else {
                store.endDragTransaction(message: kind == .door ? "Slid door" : "Slid window")
            }
        case .draggingWallEndpoint:
            if moved < 4 {
                store.discardDragTransaction()
            } else {
                store.endDragTransaction(message: "Reshaped wall")
            }
        case .movingWall:
            if moved < 4 {
                store.discardDragTransaction()
            } else {
                store.endDragTransaction(message: "Moved wall")
            }
        }
        drag = .idle
        lastDragPoint = nil
    }

    // MARK: Keyboard

    private func handleKeyboardCommand(_ command: PlanKeyboardCommand) {
        switch command {
        case .select: store.chooseTool(.select)
        case .wall: store.chooseTool(.wall)
        case .door: store.chooseTool(.door)
        case .window: store.chooseTool(.window)
        case .erase: store.chooseTool(.erase)
        case .rotate: store.rotateSelectedFurniture()
        case .delete: store.deleteSelection()
        case .nudge(let dx, let dz): store.nudgeSelectedFurniture(dx: dx, dz: dz)
        }
    }

    private func cancelActiveInteraction() {
        if drag != .idle {
            drag = .idle
            lastDragPoint = nil
            store.discardDragTransaction()
            store.statusMessage = "Cancelled"
        } else {
            store.cancelPlacement()
        }
    }
}

// MARK: - Drawing

private enum DragState: Equatable, Sendable {
    case idle
    case drawingWall(anchor: PlanPoint, current: PlanPoint)
    case movingFurniture(id: UUID)
    case slidingOpening(kind: OpeningKind, id: UUID)
    case draggingWallEndpoint(id: UUID, part: WallPart)
    case movingWall(id: UUID)
}

private struct PlanTransform: Sendable {
    var scale: Double
    var origin: CGPoint

    func screen(_ point: PlanPoint) -> CGPoint {
        CGPoint(x: origin.x + point.x * scale, y: origin.y + point.z * scale)
    }

    func plan(_ point: CGPoint) -> PlanPoint {
        PlanPoint(x: (point.x - origin.x) / scale, z: (point.y - origin.y) / scale)
    }

    func rect(_ rectangle: PlanRectangle) -> CGRect {
        CGRect(
            x: origin.x + rectangle.minX * scale,
            y: origin.y + rectangle.minZ * scale,
            width: rectangle.width * scale,
            height: rectangle.length * scale
        )
    }
}

private struct PlanDrawingSnapshot: Sendable {
    var room: RoomPlan
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedWindowID: UUID?
    var selectedFurnitureID: UUID?
    var hoverPoint: PlanPoint?
    var tool: PlanTool
    var pendingFurnitureKind: FurnitureKind?
    var drag: DragState
}

private enum PlanCanvasRenderer {
    static func draw(
        context: inout GraphicsContext,
        size: CGSize,
        snapshot: PlanDrawingSnapshot,
        transform: PlanTransform
    ) {
        let room = snapshot.room

        let floorRect = transform.rect(PlanRectangle(
            minX: 0, maxX: room.width, minZ: 0, maxZ: room.length
        ))
        context.fill(Path(floorRect), with: .color(Color(red: 0.98, green: 0.96, blue: 0.90)))

        drawGrid(context: &context, room: room, transform: transform)

        if snapshot.tool == .door || snapshot.tool == .window,
           let hoverPoint = snapshot.hoverPoint,
           let placement = room.wall(forPlacementAt: hoverPoint) {
            highlightWall(context: &context, wall: placement.wall, transform: transform)
        }

        for wall in room.walls {
            drawWall(
                context: &context,
                wall: wall,
                room: room,
                selected: wall.id == snapshot.selectedWallID,
                transform: transform
            )
        }

        if let measured = activeOpening(snapshot) {
            drawOpeningMeasurements(
                context: &context,
                kind: measured.kind,
                id: measured.id,
                room: room,
                transform: transform
            )
        }

        for item in room.furniture {
            drawFurniture(
                context: &context,
                item: item,
                selected: item.id == snapshot.selectedFurnitureID,
                transform: transform
            )
        }

        if case .drawingWall(let anchor, let current) = snapshot.drag {
            var path = Path()
            path.move(to: transform.screen(anchor))
            path.addLine(to: transform.screen(current))
            context.stroke(
                path,
                with: .color(Color.accentColor),
                style: StrokeStyle(lineWidth: 2.5, dash: [6, 5])
            )
            drawSnapDot(context: &context, at: current, transform: transform)
        }

        if snapshot.tool == .furniture,
           let kind = snapshot.pendingFurnitureKind,
           let hoverPoint = snapshot.hoverPoint {
            drawFurnitureGhost(
                context: &context,
                kind: kind,
                near: hoverPoint,
                room: room,
                transform: transform
            )
        }

        if snapshot.tool == .wall, let hoverPoint = snapshot.hoverPoint {
            drawSnapDot(context: &context, at: room.snapPoint(hoverPoint), transform: transform)
        }
    }

    private static func activeOpening(_ snapshot: PlanDrawingSnapshot) -> (kind: OpeningKind, id: UUID)? {
        if case .slidingOpening(let kind, let id) = snapshot.drag {
            return (kind, id)
        }
        if let id = snapshot.selectedDoorID { return (.door, id) }
        if let id = snapshot.selectedWindowID { return (.window, id) }
        return nil
    }

    // MARK: Grid

    private static func drawGrid(context: inout GraphicsContext, room: RoomPlan, transform: PlanTransform) {
        let scale = transform.scale
        let minorStep = room.grid.meters
        let majorStep = 0.10
        let drawMinor = minorStep * scale >= 3

        var minorPath = Path()
        var majorPath = Path()
        func addLines(step: Double, to path: inout Path) {
            var x = 0.0
            while x <= room.width + 0.0001 {
                let px = transform.origin.x + x * scale
                path.move(to: CGPoint(x: px, y: transform.origin.y))
                path.addLine(to: CGPoint(x: px, y: transform.origin.y + room.length * scale))
                x += step
            }
            var z = 0.0
            while z <= room.length + 0.0001 {
                let py = transform.origin.y + z * scale
                path.move(to: CGPoint(x: transform.origin.x, y: py))
                path.addLine(to: CGPoint(x: transform.origin.x + room.width * scale, y: py))
                z += step
            }
        }
        if drawMinor {
            addLines(step: minorStep, to: &minorPath)
        }
        addLines(step: majorStep, to: &majorPath)
        context.stroke(minorPath, with: .color(.black.opacity(0.05)), lineWidth: 1)
        context.stroke(majorPath, with: .color(.black.opacity(0.13)), lineWidth: 1)
    }

    // MARK: Walls and openings

    private static func highlightWall(context: inout GraphicsContext, wall: Wall, transform: PlanTransform) {
        var path = Path()
        path.move(to: transform.screen(wall.start))
        path.addLine(to: transform.screen(wall.end))
        context.stroke(
            path,
            with: .color(Color.accentColor.opacity(0.35)),
            style: StrokeStyle(lineWidth: 12, lineCap: .round)
        )
    }

    private static func drawWall(
        context: inout GraphicsContext,
        wall: Wall,
        room: RoomPlan,
        selected: Bool,
        transform: PlanTransform
    ) {
        let thickness: Double = selected ? 9 : 7
        let color = selected ? Color.accentColor : Color(red: 0.32, green: 0.33, blue: 0.38)

        let doorSpans = room.doors
            .filter { $0.wallID == wall.id }
            .map { WallSpan(from: $0.offset, to: $0.offset + $0.width) }
        let windowSpans = room.windows
            .filter { $0.wallID == wall.id }
            .map { WallSpan(from: $0.offset, to: $0.offset + $0.width) }
        let solid = WallBuildPlan.solidSpans(
            length: wall.length,
            cuts: (doorSpans + windowSpans).sorted { $0.from < $1.from }
        )
        for span in solid {
            var path = Path()
            path.move(to: transform.screen(wall.point(atOffset: span.from)))
            path.addLine(to: transform.screen(wall.point(atOffset: span.to)))
            context.stroke(
                path,
                with: .color(color),
                style: StrokeStyle(lineWidth: thickness, lineCap: .round)
            )
        }
        for span in doorSpans {
            drawDoor(context: &context, wall: wall, span: span, transform: transform)
        }
        for span in windowSpans {
            drawWindow(context: &context, wall: wall, span: span, transform: transform)
        }
    }

    private static func drawDoor(
        context: inout GraphicsContext,
        wall: Wall,
        span: WallSpan,
        transform: PlanTransform
    ) {
        let hinge = transform.screen(wall.point(atOffset: span.from))
        let end = transform.screen(wall.point(atOffset: span.to))
        let radius = hypot(end.x - hinge.x, end.y - hinge.y)
        let direction = wall.direction
        let angle = atan2(direction.z, direction.x)
        let swing = angle + .pi / 2

        var arc = Path()
        arc.addArc(
            center: hinge,
            radius: radius,
            startAngle: .radians(angle),
            endAngle: .radians(swing),
            clockwise: false
        )
        context.stroke(
            arc,
            with: .color(Color(red: 0.55, green: 0.40, blue: 0.25)),
            lineWidth: 1.5
        )

        var leaf = Path()
        leaf.move(to: hinge)
        leaf.addLine(to: CGPoint(
            x: hinge.x + cos(swing) * radius,
            y: hinge.y + sin(swing) * radius
        ))
        context.stroke(
            leaf,
            with: .color(Color(red: 0.55, green: 0.40, blue: 0.25)),
            lineWidth: 2
        )
    }

    private static func drawWindow(
        context: inout GraphicsContext,
        wall: Wall,
        span: WallSpan,
        transform: PlanTransform
    ) {
        let start = transform.screen(wall.point(atOffset: span.from))
        let end = transform.screen(wall.point(atOffset: span.to))
        var glass = Path()
        glass.move(to: start)
        glass.addLine(to: end)
        context.stroke(
            glass,
            with: .color(Color(red: 0.45, green: 0.72, blue: 0.95)),
            lineWidth: 5
        )
        var frame = Path()
        frame.move(to: start)
        frame.addLine(to: end)
        context.stroke(frame, with: .color(.white), lineWidth: 1.2)
    }

    // MARK: Measurements

    private static func drawOpeningMeasurements(
        context: inout GraphicsContext,
        kind: OpeningKind,
        id: UUID,
        room: RoomPlan,
        transform: PlanTransform
    ) {
        guard let spacing = room.spacing(forOpeningWith: id, kind: kind),
              let wall = room.openingWall(id: id, kind: kind) else { return }
        let offset = spacing.toWallStart
        let width: Double
        switch kind {
        case .door: width = room.door(id: id)?.width ?? 0
        case .window: width = room.window(id: id)?.width ?? 0
        }
        guard width > 0 else { return }
        let toEnd = spacing.toWallEnd
        let perp = wall.perpendicular

        func labelPoint(atOffset offset: Double, push: Double) -> CGPoint {
            transform.screen(wall.point(atOffset: offset) + perp * push)
        }

        drawChip(&context, text: "\(Int((offset * 100).rounded()))", at: labelPoint(atOffset: offset / 2, push: 0.5))
        drawChip(&context, text: "\(Int((width * 100).rounded()))", at: labelPoint(atOffset: offset + width / 2, push: 0.5))
        drawChip(&context, text: "\(Int((toEnd * 100).rounded()))", at: labelPoint(atOffset: offset + width + toEnd / 2, push: 0.5))
        if let previous = spacing.gapToPrevious {
            drawChip(&context, text: "\(Int((previous * 100).rounded()))", at: labelPoint(atOffset: offset - previous / 2, push: 0.5))
        }
        if let next = spacing.gapToNext {
            drawChip(&context, text: "\(Int((next * 100).rounded()))", at: labelPoint(atOffset: offset + width + next / 2, push: 0.5))
        }
    }

    private static func drawChip(_ context: inout GraphicsContext, text: String, at point: CGPoint) {
        let resolved = context.resolve(
            Text(text + " cm")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
        )
        let size = resolved.measure(in: CGSize(width: 400, height: 40))
        let rect = CGRect(
            x: point.x - size.width / 2 - 4,
            y: point.y - size.height / 2 - 2,
            width: size.width + 8,
            height: size.height + 4
        )
        context.fill(Path(roundedRect: rect, cornerRadius: 5), with: .color(.white.opacity(0.92)))
        context.stroke(Path(roundedRect: rect, cornerRadius: 5), with: .color(.black.opacity(0.15)), lineWidth: 0.5)
        context.draw(resolved, at: point)
    }

    // MARK: Furniture

    private static func drawFurniture(
        context: inout GraphicsContext,
        item: FurnitureItem,
        selected: Bool,
        transform: PlanTransform
    ) {
        let rect = transform.rect(item.footprint)
        let path = Path(roundedRect: rect, cornerRadius: 6)
        let baseColor = Color(
            red: item.kind.color.red,
            green: item.kind.color.green,
            blue: item.kind.color.blue
        )
        context.fill(path, with: .color(baseColor.opacity(selected ? 0.35 : 0.18)))
        context.stroke(path, with: .color(selected ? .accentColor : baseColor), lineWidth: selected ? 3 : 2)

        let center = CGPoint(x: rect.midX, y: rect.midY)
        context.draw(
            Text(item.kind.planLabel)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(selected ? Color.accentColor : Color.secondary),
            at: center
        )

        var indicator = Path()
        indicator.move(to: center)
        indicator.addLine(to: CGPoint(
            x: rect.midX,
            y: rect.minY + max(6, min(14, rect.height * 0.25))
        ))
        context.stroke(indicator, with: .color(baseColor.opacity(0.85)), lineWidth: 2)
    }

    private static func drawFurnitureGhost(
        context: inout GraphicsContext,
        kind: FurnitureKind,
        near rawPoint: PlanPoint,
        room: RoomPlan,
        transform: PlanTransform
    ) {
        var item = FurnitureItem(kind: kind, center: rawPoint)
        item.center = room.furnitureCenter(near: rawPoint, for: item)
        let valid = room.isFurniturePlacementValid(item)
        let rect = transform.rect(item.footprint)
        let path = Path(roundedRect: rect, cornerRadius: 6)
        context.fill(path, with: .color((valid ? Color.green : Color.red).opacity(0.22)))
        context.stroke(
            path,
            with: .color(valid ? .green : .red),
            style: StrokeStyle(lineWidth: 2, dash: [5, 4])
        )
    }

    private static func drawSnapDot(context: inout GraphicsContext, at point: PlanPoint, transform: PlanTransform) {
        let screen = transform.screen(point)
        let rect = CGRect(x: screen.x - 4, y: screen.y - 4, width: 8, height: 8)
        context.fill(Path(ellipseIn: rect), with: .color(Color.accentColor))
        context.stroke(
            Path(ellipseIn: rect.insetBy(dx: -2, dy: -2)),
            with: .color(.white),
            lineWidth: 1.5
        )
    }
}
