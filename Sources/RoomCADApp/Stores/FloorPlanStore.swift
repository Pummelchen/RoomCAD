import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class FloorPlanStore {
    static let minimumPlanZoom: Float = 0.50
    static let maximumPlanZoom: Float = 4.00

    var plan: FloorPlan
    var mode: WorkspaceMode = .walkthrough
    var tool: PlanTool = .wall
    var planZoomScale: Float = 1.00
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedFurnitureID: UUID?
    var statusMessage = "Ready"

    private var undoStack: [FloorPlan] = []
    private var redoStack: [FloorPlan] = []
    private let persistenceURL: URL

    init(
        persistenceURL: URL? = nil,
        legacyPersistenceURL: URL? = nil,
        loadPersisted: Bool = true
    ) {
        self.persistenceURL = persistenceURL ?? Self.defaultPersistenceURL
        let legacyURL = legacyPersistenceURL ?? (persistenceURL == nil ? Self.legacyPersistenceURL : nil)
        let loadURLs = [self.persistenceURL] + (legacyURL.map { [$0] } ?? [])
        let restored = loadPersisted ? loadURLs.lazy.compactMap { url -> (URL, FloorPlan)? in
            guard let data = try? Data(contentsOf: url),
                  let plan = try? JSONDecoder().decode(FloorPlan.self, from: data) else { return nil }
            return (url, plan)
        }.first : nil

        if let (sourceURL, restoredPlan) = restored {
            var decoded = restoredPlan
            decoded.sanitize()
            plan = decoded
            if sourceURL == self.persistenceURL {
                statusMessage = "Restored saved layout"
            } else {
                statusMessage = "Migrated saved layout to RoomCAD"
                persist()
            }
        } else {
            plan = .initial
        }
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var canZoomIn: Bool { planZoomScale < Self.maximumPlanZoom }
    var canZoomOut: Bool { planZoomScale > Self.minimumPlanZoom }
    var selectedFurniture: FurnitureItem? {
        guard let selectedFurnitureID else { return nil }
        return plan.furniture.first { $0.id == selectedFurnitureID }
    }
    var selectedDoor: DoorOpening? {
        guard let selectedDoorID else { return nil }
        return plan.doors.first { $0.id == selectedDoorID }
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
        selectedDoorID = nil
        selectedFurnitureID = item.id
        mode = .plan
        tool = .select
    }

    func constrainedFurnitureCenter(id: UUID, near rawPoint: PlanPoint) -> PlanPoint? {
        guard var candidate = plan.furniture.first(where: { $0.id == id }) else { return nil }
        candidate.center = snappedFurnitureCenter(rawPoint, for: candidate)
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

    @discardableResult
    func addWall(from rawStart: PlanPoint, to rawEnd: PlanPoint) -> Bool {
        let start = plan.dimensions.snapped(rawStart)
        let end = plan.dimensions.snapped(rawEnd)
        let wall = PartitionWall(start: start, end: end)
        guard wall.length >= 0.30 else {
            statusMessage = "Wall must be at least 30 cm long"
            return false
        }
        commit(message: "Added \(wall.length.formattedMeters) wall") {
            $0.partitions.append(wall)
        }
        selectedWallID = wall.id
        selectedDoorID = nil
        selectedFurnitureID = nil
        return true
    }

    func beginDoorPlacement() {
        mode = .plan
        tool = .door
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
        statusMessage = plan.partitions.isEmpty
            ? "Draw a wall first, then choose Add Door"
            : "Click a wall to place a 90 cm door"
    }

    func setPlanZoomScale(_ scale: Float) {
        planZoomScale = scale.clamped(to: Self.minimumPlanZoom...Self.maximumPlanZoom)
    }

    func zoomPlanIn() {
        setPlanZoomScale(planZoomScale * 1.25)
    }

    func zoomPlanOut() {
        setPlanZoomScale(planZoomScale / 1.25)
    }

    func resetPlanZoom() {
        planZoomScale = 1.00
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
        let safeOffset = snappedDoorOffset(
            centerOffset: projection.offset,
            doorWidth: doorWidth,
            wall: wall
        )
        let door = DoorOpening(wallID: wall.id, offset: safeOffset, width: doorWidth)
        commit(message: "Placed 90 cm door") { plan in
            plan.doors.removeAll { $0.wallID == wall.id }
            plan.doors.append(door)
        }
        selectedWallID = wall.id
        selectedDoorID = door.id
        selectedFurnitureID = nil
        tool = .select
        statusMessage = "Placed 90 cm door · drag it along the wall to position"
    }

    func constrainedDoorOffset(id: UUID, near rawPoint: PlanPoint) -> Float? {
        guard let door = plan.doors.first(where: { $0.id == id }),
              let wall = plan.partitions.first(where: { $0.id == door.wallID }),
              wall.length >= door.width + 0.20 else { return nil }
        let projection = wall.projection(of: rawPoint)
        return snappedDoorOffset(
            centerOffset: projection.offset,
            doorWidth: door.width,
            wall: wall
        )
    }

    func moveDoor(id: UUID, to rawPoint: PlanPoint) {
        guard let offset = constrainedDoorOffset(id: id, near: rawPoint),
              let index = plan.doors.firstIndex(where: { $0.id == id }) else { return }
        guard abs(plan.doors[index].offset - offset) > 0.0001 else { return }

        commit(message: "Moved door to \(offset.formattedCentimeters) from wall start") {
            $0.doors[index].offset = offset
        }
        selectedDoorID = id
        selectedWallID = plan.doors[index].wallID
        selectedFurnitureID = nil
    }

    func doorSideLengths(_ door: DoorOpening) -> (leading: Float, trailing: Float)? {
        guard let wall = plan.partitions.first(where: { $0.id == door.wallID }) else { return nil }
        return (
            leading: door.offset,
            trailing: max(0, wall.length - door.offset - door.width)
        )
    }

    func wall(near point: PlanPoint, tolerance: Float = 0.35) -> PartitionWall? {
        plan.partitions
            .map { ($0, $0.projection(of: point).distance) }
            .filter { $0.1 <= tolerance }
            .min { $0.1 < $1.1 }?.0
    }

    func deleteWall(id: UUID) {
        guard let wall = plan.partitions.first(where: { $0.id == id }) else { return }
        commit(message: "Removed \(wall.length.formattedMeters) wall") { plan in
            plan.partitions.removeAll { $0.id == id }
            plan.doors.removeAll { $0.wallID == id }
        }
        if selectedWallID == id { selectedWallID = nil }
        if let selectedDoorID,
           !plan.doors.contains(where: { $0.id == selectedDoorID }) {
            self.selectedDoorID = nil
        }
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
            if selectedDoorID == door.id { selectedDoorID = nil }
            return
        }
        guard let wall = wall(near: point) else {
            statusMessage = "Nothing to erase here"
            return
        }
        deleteWall(id: wall.id)
    }

    func select(near point: PlanPoint) {
        if let furniture = plan.furniture.last(where: { $0.contains(point, tolerance: 0.08) }) {
            selectedFurnitureID = furniture.id
            selectedWallID = nil
            selectedDoorID = nil
            statusMessage = "Selected \(furniture.kind.title.lowercased()) · B rotates"
            return
        }

        if let door = nearestDoor(to: point, tolerance: 0.35) {
            selectedDoorID = door.id
            selectedWallID = door.wallID
            selectedFurnitureID = nil
            statusMessage = "Selected door · drag along its wall to position"
            return
        }

        selectedFurnitureID = nil
        selectedDoorID = nil
        selectedWallID = wall(near: point)?.id
        statusMessage = selectedWallID == nil ? "No wall selected" : "Wall selected"
    }

    func deleteSelectedWall() {
        guard let id = selectedWallID else { return }
        deleteWall(id: id)
        selectedFurnitureID = nil
    }

    func toggleSelectedDoorHinge() {
        guard let doorID = selectedDoorID,
              let index = plan.doors.firstIndex(where: { $0.id == doorID }) else { return }
        commit(message: "Changed door hinge") { plan in
            plan.doors[index].hinge = plan.doors[index].hinge == .left ? .right : .left
        }
    }

    func deleteSelectedDoor() {
        guard let id = selectedDoorID else { return }
        commit(message: "Removed selected door") { plan in
            plan.doors.removeAll { $0.id == id }
        }
        selectedDoorID = nil
    }

    func updateDimensions(_ dimensions: SurveyDimensions) {
        var sanitized = dimensions
        sanitized.sanitize()
        commit(message: "Updated survey dimensions") { $0.dimensions = sanitized }
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
    }

    func updateGridSpacing(_ spacing: Float) {
        var dimensions = plan.dimensions
        dimensions.gridSpacing = spacing
        dimensions.sanitize()
        guard dimensions.gridSpacing != plan.dimensions.gridSpacing else { return }
        commit(message: "Grid set to \(dimensions.gridSpacing.formattedCentimeters)") {
            $0.dimensions.gridSpacing = dimensions.gridSpacing
        }
    }

    func clearPartitions() {
        guard !plan.partitions.isEmpty else { return }
        commit(message: "Cleared walls and doors") {
            $0.partitions.removeAll()
            $0.doors.removeAll()
        }
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
    }

    func resetToSurvey() {
        recordUndo()
        plan = .example
        redoStack.removeAll()
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
        statusMessage = "Loaded example room layout"
        persist()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(plan)
        plan = previous
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
        statusMessage = "Undid change"
        persist()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(plan)
        plan = next
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
        statusMessage = "Redid change"
        persist()
    }

    func exportPlan() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "RoomCAD-layout.json"
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

    private func preparedFurniture(
        kind: FurnitureKind,
        center: PlanPoint,
        direction: CardinalDirection = .north
    ) -> FurnitureItem? {
        var item = FurnitureItem(kind: kind, center: center, direction: direction)
        item.center = snappedFurnitureCenter(item.center, for: item)
        guard item.isOnUsableFloor(plan.dimensions) else { return nil }
        return item
    }

    private func snappedFurnitureCenter(_ rawPoint: PlanPoint, for item: FurnitureItem) -> PlanPoint {
        let spacing = max(plan.dimensions.gridSpacing, 0.001)
        func coordinate(_ rawValue: Float, minimum: Float, maximum: Float) -> Float {
            let minimumGrid = (minimum / spacing).rounded(.up) * spacing
            let maximumGrid = (maximum / spacing).rounded(.down) * spacing
            guard minimumGrid <= maximumGrid else { return (minimum + maximum) / 2 }
            return ((rawValue / spacing).rounded() * spacing).clamped(to: minimumGrid...maximumGrid)
        }

        return PlanPoint(
            x: coordinate(
                rawPoint.x,
                minimum: item.orientedWidth / 2,
                maximum: plan.dimensions.roomWidth - item.orientedWidth / 2
            ),
            z: coordinate(
                rawPoint.z,
                minimum: item.orientedDepth / 2,
                maximum: plan.dimensions.roomLength - item.orientedDepth / 2
            )
        )
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

    private func snappedDoorOffset(
        centerOffset: Float,
        doorWidth: Float,
        wall: PartitionWall
    ) -> Float {
        let rawOffset = centerOffset - doorWidth / 2
        let spacing = plan.dimensions.gridSpacing
        let snappedOffset = spacing > 0 ? (rawOffset / spacing).rounded() * spacing : rawOffset
        return snappedOffset.clamped(to: 0.10...(wall.length - doorWidth - 0.10))
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
        return base.appending(path: "RoomCAD", directoryHint: .isDirectory)
            .appending(path: "layout.json")
    }

    private static var legacyPersistenceURL: URL {
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
