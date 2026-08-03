import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class FloorPlanStore {
    var plan: FloorPlan
    var mode: WorkspaceMode = .walkthrough
    var tool: PlanTool = .wall
    var selectedWallID: UUID?
    var selectedFurnitureID: UUID?
    var statusMessage = "Ready"

    private var undoStack: [FloorPlan] = []
    private var redoStack: [FloorPlan] = []
    private let persistenceURL: URL

    init(persistenceURL: URL? = nil, loadPersisted: Bool = true) {
        self.persistenceURL = persistenceURL ?? Self.defaultPersistenceURL
        if loadPersisted,
           let data = try? Data(contentsOf: self.persistenceURL),
           var decoded = try? JSONDecoder().decode(FloorPlan.self, from: data) {
            decoded.sanitize()
            plan = decoded
            statusMessage = "Restored saved layout"
        } else {
            plan = .initial
        }
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var selectedFurniture: FurnitureItem? {
        guard let selectedFurnitureID else { return nil }
        return plan.furniture.first { $0.id == selectedFurnitureID }
    }

    func addFurniture(_ kind: FurnitureKind, at rawPoint: PlanPoint? = nil) {
        let candidate = rawPoint.map { preparedFurniture(kind: kind, center: $0) }
            ?? firstAvailableFurniture(kind: kind)
        guard let item = candidate else {
            statusMessage = "No usable floor space for \(kind.title.lowercased())"
            return
        }

        commit(message: "Added \(kind.title.lowercased())") { $0.furniture.append(item) }
        selectedWallID = nil
        selectedFurnitureID = item.id
        mode = .plan
        tool = .select
    }

    func constrainedFurnitureCenter(id: UUID, near rawPoint: PlanPoint) -> PlanPoint? {
        guard var candidate = plan.furniture.first(where: { $0.id == id }) else { return nil }
        candidate.center = rawPoint.snapped(to: plan.dimensions.gridSpacing)
        candidate.clampToRoom(plan.dimensions)
        return candidate.isOnUsableFloor(plan.dimensions) ? candidate.center : nil
    }

    func moveFurniture(id: UUID, to rawPoint: PlanPoint) {
        guard let center = constrainedFurnitureCenter(id: id, near: rawPoint),
              let index = plan.furniture.firstIndex(where: { $0.id == id }) else {
            statusMessage = "Furniture must stay on usable floor"
            return
        }
        guard plan.furniture[index].center != center else { return }

        let title = plan.furniture[index].kind.title
        commit(message: "Moved \(title.lowercased())") { $0.furniture[index].center = center }
        selectedFurnitureID = id
    }

    func rotateSelectedFurniture() {
        guard let id = selectedFurnitureID,
              let index = plan.furniture.firstIndex(where: { $0.id == id }) else {
            statusMessage = "Select furniture before pressing B"
            return
        }

        var candidate = plan.furniture[index]
        candidate.direction = candidate.direction.next
        candidate.clampToRoom(plan.dimensions)
        guard candidate.isOnUsableFloor(plan.dimensions) else {
            statusMessage = "Not enough floor space to rotate here"
            return
        }

        commit(message: "Rotated \(candidate.kind.title.lowercased()) \(candidate.direction.title.lowercased())") {
            $0.furniture[index] = candidate
        }
        selectedFurnitureID = id
    }

    func deleteSelectedFurniture() {
        guard let id = selectedFurnitureID,
              let item = plan.furniture.first(where: { $0.id == id }) else { return }
        commit(message: "Removed \(item.kind.title.lowercased())") {
            $0.furniture.removeAll { $0.id == id }
        }
        selectedFurnitureID = nil
    }

    func clearFurniture() {
        guard !plan.furniture.isEmpty else { return }
        commit(message: "Cleared furniture") { $0.furniture.removeAll() }
        selectedFurnitureID = nil
    }

    func addWall(from rawStart: PlanPoint, to rawEnd: PlanPoint) {
        let start = bounded(rawStart.snapped(to: plan.dimensions.gridSpacing))
        let end = bounded(rawEnd.snapped(to: plan.dimensions.gridSpacing))
        let wall = PartitionWall(start: start, end: end)
        guard wall.length >= 0.30 else {
            statusMessage = "Wall must be at least 30 cm long"
            return
        }
        commit(message: "Added \(wall.length.formattedMeters) wall") {
            $0.partitions.append(wall)
        }
        selectedWallID = wall.id
        selectedFurnitureID = nil
    }

    func placeDoor(near point: PlanPoint) {
        let candidate = plan.partitions
            .map { ($0, $0.projection(of: point)) }
            .filter { $0.1.distance <= 0.45 && $0.0.length >= 1.10 }
            .min { $0.1.distance < $1.1.distance }

        guard let (wall, projection) = candidate else {
            statusMessage = "Click within 45 cm of a wall at least 1.10 m long"
            return
        }

        let doorWidth: Float = 0.90
        let safeOffset = (projection.offset - doorWidth / 2).clamped(to: 0.10...(wall.length - doorWidth - 0.10))
        commit(message: "Placed 90 cm door") { plan in
            plan.doors.removeAll { $0.wallID == wall.id }
            plan.doors.append(DoorOpening(wallID: wall.id, offset: safeOffset, width: doorWidth))
        }
        selectedWallID = wall.id
        selectedFurnitureID = nil
    }

    func erase(near point: PlanPoint) {
        if let furniture = plan.furniture.last(where: { $0.contains(point, tolerance: 0.08) }) {
            commit(message: "Removed \(furniture.kind.title.lowercased())") {
                $0.furniture.removeAll { $0.id == furniture.id }
            }
            if selectedFurnitureID == furniture.id { selectedFurnitureID = nil }
            return
        }
        if let door = nearestDoor(to: point, tolerance: 0.45) {
            commit(message: "Removed door") { $0.doors.removeAll { $0.id == door.id } }
            return
        }
        guard let wall = plan.partitions
            .map({ ($0, $0.projection(of: point).distance) })
            .filter({ $0.1 <= 0.35 })
            .min(by: { $0.1 < $1.1 })?.0 else {
            statusMessage = "Nothing to erase here"
            return
        }
        commit(message: "Removed wall") { plan in
            plan.partitions.removeAll { $0.id == wall.id }
            plan.doors.removeAll { $0.wallID == wall.id }
        }
        if selectedWallID == wall.id { selectedWallID = nil }
    }

    func select(near point: PlanPoint) {
        if let furniture = plan.furniture.last(where: { $0.contains(point, tolerance: 0.08) }) {
            selectedFurnitureID = furniture.id
            selectedWallID = nil
            statusMessage = "Selected \(furniture.kind.title.lowercased()) · B rotates"
            return
        }

        selectedFurnitureID = nil
        selectedWallID = plan.partitions
            .map({ ($0, $0.projection(of: point).distance) })
            .filter({ $0.1 <= 0.35 })
            .min(by: { $0.1 < $1.1 })?.0.id
        statusMessage = selectedWallID == nil ? "No wall selected" : "Wall selected"
    }

    func deleteSelectedWall() {
        guard let id = selectedWallID else { return }
        commit(message: "Removed selected wall") { plan in
            plan.partitions.removeAll { $0.id == id }
            plan.doors.removeAll { $0.wallID == id }
        }
        selectedWallID = nil
        selectedFurnitureID = nil
    }

    func toggleSelectedDoorHinge() {
        guard let wallID = selectedWallID,
              let index = plan.doors.firstIndex(where: { $0.wallID == wallID }) else { return }
        commit(message: "Changed door hinge") { plan in
            plan.doors[index].hinge = plan.doors[index].hinge == .left ? .right : .left
        }
    }

    func updateDimensions(_ dimensions: SurveyDimensions) {
        var sanitized = dimensions
        sanitized.sanitize()
        commit(message: "Updated survey dimensions") { $0.dimensions = sanitized }
    }

    func clearPartitions() {
        guard !plan.partitions.isEmpty else { return }
        commit(message: "Cleared test layout") {
            $0.partitions.removeAll()
            $0.doors.removeAll()
        }
        selectedWallID = nil
        selectedFurnitureID = nil
    }

    func resetToSurvey() {
        recordUndo()
        plan = .example
        redoStack.removeAll()
        selectedWallID = nil
        selectedFurnitureID = nil
        statusMessage = "Loaded example room layout"
        persist()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(plan)
        plan = previous
        selectedWallID = nil
        selectedFurnitureID = nil
        statusMessage = "Undid change"
        persist()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(plan)
        plan = next
        selectedWallID = nil
        selectedFurnitureID = nil
        statusMessage = "Redid change"
        persist()
    }

    func exportPlan() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "LaundryRooms-layout.json"
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(plan).write(to: url, options: .atomic)
            statusMessage = "Exported \(url.lastPathComponent)"
        } catch {
            statusMessage = "Export failed: \(error.localizedDescription)"
        }
    }

    private func commit(message: String, mutation: (inout FloorPlan) -> Void) {
        recordUndo()
        mutation(&plan)
        plan.sanitize()
        redoStack.removeAll()
        statusMessage = message
        persist()
    }

    private func recordUndo() {
        undoStack.append(plan)
        if undoStack.count > 100 { undoStack.removeFirst() }
    }

    private func bounded(_ point: PlanPoint) -> PlanPoint {
        PlanPoint(
            x: point.x.clamped(to: 0...plan.dimensions.roomWidth),
            z: point.z.clamped(to: 0...plan.dimensions.roomLength)
        )
    }

    private func preparedFurniture(
        kind: FurnitureKind,
        center: PlanPoint,
        direction: CardinalDirection = .north
    ) -> FurnitureItem? {
        var item = FurnitureItem(kind: kind, center: center, direction: direction)
        item.center = item.center.snapped(to: plan.dimensions.gridSpacing)
        item.clampToRoom(plan.dimensions)
        guard item.isOnUsableFloor(plan.dimensions) else { return nil }
        return item
    }

    private func firstAvailableFurniture(kind: FurnitureKind) -> FurnitureItem? {
        let dimensions = plan.dimensions
        let template = FurnitureItem(kind: kind, center: .zero)
        let xStart = template.orientedWidth / 2 + 0.20
        let xEnd = dimensions.roomWidth - template.orientedWidth / 2 - 0.20
        let zStart = template.orientedDepth / 2 + 0.40
        let zEnd = StairBathroomLayout(dimensions: dimensions).core.minZ - template.orientedDepth / 2 - 0.20

        guard xStart <= xEnd, zStart <= zEnd else { return nil }
        for z in stride(from: zStart, through: zEnd, by: Float(0.25)) {
            for x in stride(from: xStart, through: xEnd, by: Float(0.25)) {
                guard let item = preparedFurniture(kind: kind, center: PlanPoint(x: x, z: z)),
                      !plan.furniture.contains(where: { $0.footprint.intersects(item.footprint) }) else { continue }
                return item
            }
        }
        return nil
    }

    private func nearestDoor(to point: PlanPoint, tolerance: Float) -> DoorOpening? {
        plan.doors.compactMap { door -> (DoorOpening, Float)? in
            guard let wall = plan.partitions.first(where: { $0.id == door.wallID }) else { return nil }
            let t = (door.offset + door.width / 2) / max(wall.length, 0.001)
            let center = PlanPoint(
                x: wall.start.x + (wall.end.x - wall.start.x) * t,
                z: wall.start.z + (wall.end.z - wall.start.z) * t
            )
            return (door, center.distance(to: point))
        }.filter { $0.1 <= tolerance }.min { $0.1 < $1.1 }?.0
    }

    private func persist() {
        do {
            try FileManager.default.createDirectory(
                at: persistenceURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(plan).write(to: persistenceURL, options: .atomic)
        } catch {
            statusMessage = "Could not autosave: \(error.localizedDescription)"
        }
    }

    private static var defaultPersistenceURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appending(path: "LaundryRooms", directoryHint: .isDirectory)
            .appending(path: "layout.json")
    }
}

extension Float {
    var formattedMeters: String {
        formatted(.number.precision(.fractionLength(2))) + " m"
    }

    var formattedCentimeters: String {
        (self * 100).formatted(.number.precision(.fractionLength(0))) + " cm"
    }
}
