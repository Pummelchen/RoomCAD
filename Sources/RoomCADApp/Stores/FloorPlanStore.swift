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
    var planRotation: PlanRotation = .zero
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedFurnitureIDs: Set<UUID> = []
    var pendingFurnitureKind: FurnitureKind?
    var snapshots: [LayoutSnapshot] = []
    var lastSavedAt: Date?
    var currentDocumentURL: URL?
    var lastDocumentSavedAt: Date?
    var currentDocumentFileSize: Int?
    var documentIsEdited = false
    var documentErrorMessage: String?
    var statusMessage = "Ready"

    private var undoStack: [FloorPlan] = []
    private var redoStack: [FloorPlan] = []
    private let persistenceURL: URL
    private var documentCreatedAt = Date()

    var documentDisplayName: String {
        currentDocumentURL?.deletingPathExtension().lastPathComponent ?? "Untitled Design"
    }

    var documentContentsSummary: String {
        "Measured shell · \(plan.partitions.count) walls · \(plan.doors.count) doors · \(plan.furniture.count) furniture · \(plan.roomLabels.count) rooms"
    }

    var selectedFurnitureID: UUID? {
        get { selectedFurnitureIDs.count == 1 ? selectedFurnitureIDs.first : nil }
        set { selectedFurnitureIDs = newValue.map { [$0] } ?? [] }
    }

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
            documentIsEdited = true
        } else {
            plan = loadPersisted ? .example : .initial
            if loadPersisted {
                statusMessage = "Loaded optimized 8-room demo"
            }
        }
        snapshots = loadSnapshots()
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var canZoomIn: Bool { planZoomScale < Self.maximumPlanZoom }
    var canZoomOut: Bool { planZoomScale > Self.minimumPlanZoom }
    var selectedFurniture: FurnitureItem? {
        guard let selectedFurnitureID else { return nil }
        return plan.furniture.first { $0.id == selectedFurnitureID }
    }
    var selectedFurnitureItems: [FurnitureItem] {
        plan.furniture.filter { selectedFurnitureIDs.contains($0.id) }
    }
    var selectedWall: PartitionWall? {
        guard let selectedWallID else { return nil }
        return plan.partitions.first { $0.id == selectedWallID }
    }
    var selectedDoor: DoorOpening? {
        guard let selectedDoorID else { return nil }
        return plan.doors.first { $0.id == selectedDoorID }
    }

    var hasSelection: Bool {
        selectedWallID != nil || selectedDoorID != nil || !selectedFurnitureIDs.isEmpty
    }

    func clearSelection() {
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureIDs.removeAll()
    }

    func beginFurniturePlacement(_ kind: FurnitureKind) {
        mode = .plan
        tool = .furniture
        pendingFurnitureKind = kind
        clearSelection()
        statusMessage = "Move \(kind.title.lowercased()) onto the plan, then click to place"
    }

    func cancelCurrentAction() {
        guard pendingFurnitureKind != nil else { return }
        pendingFurnitureKind = nil
        tool = .select
        statusMessage = "Furniture placement cancelled"
    }

    func furniturePreview(kind: FurnitureKind, near rawPoint: PlanPoint) -> (item: FurnitureItem, isValid: Bool)? {
        guard let item = preparedFurniture(kind: kind, center: rawPoint) else { return nil }
        return (item, isFurniturePlacementValid(item))
    }

    func placePendingFurniture(near rawPoint: PlanPoint) {
        guard let kind = pendingFurnitureKind,
              let preview = furniturePreview(kind: kind, near: rawPoint) else {
            statusMessage = "Keep furniture on the usable floor"
            return
        }
        guard preview.isValid else {
            statusMessage = "That spot is occupied · choose an open space"
            return
        }
        let item = preview.item
        commit(message: "Placed \(kind.title.lowercased())") { $0.furniture.append(item) }
        selectedFurnitureID = item.id
        statusMessage = "Placed \(kind.title.lowercased()) · click again or press Esc to finish"
    }

    func addFurniture(_ kind: FurnitureKind, at rawPoint: PlanPoint? = nil) {
        let candidate = rawPoint.map { preparedFurniture(kind: kind, center: $0) }
            ?? firstAvailableFurniture(kind: kind)
        guard let item = candidate, isFurniturePlacementValid(item) else {
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
        return isFurniturePlacementValid(candidate, excluding: [id]) ? candidate.center : nil
    }

    func moveFurniture(id: UUID, to rawPoint: PlanPoint) {
        guard let center = constrainedFurnitureCenter(id: id, near: rawPoint),
              let index = plan.furniture.firstIndex(where: { $0.id == id }) else {
            statusMessage = "Furniture must stay on open, usable floor"
            return
        }
        guard plan.furniture[index].center != center else { return }

        let title = plan.furniture[index].kind.title
        commit(message: "Moved \(title.lowercased())") { $0.furniture[index].center = center }
        selectedFurnitureID = id
    }

    func rotateSelectedFurniture() {
        guard !selectedFurnitureIDs.isEmpty else {
            statusMessage = "Select furniture before pressing B"
            return
        }
        let ids = selectedFurnitureIDs
        var candidates: [UUID: FurnitureItem] = [:]
        for id in ids {
            guard var candidate = plan.furniture.first(where: { $0.id == id }) else { continue }
            candidate.direction = candidate.direction.next
            candidate.clampToRoom(plan.dimensions)
            guard isFurniturePlacementValid(candidate, excluding: ids) else {
                statusMessage = "Not enough open floor space to rotate here"
                return
            }
            candidates[id] = candidate
        }
        let rotatedItems = Array(candidates.values)
        for first in rotatedItems.indices {
            for second in rotatedItems.indices where second > first {
                guard !rotatedItems[first].footprint.intersects(rotatedItems[second].footprint) else {
                    statusMessage = "Selected furniture would overlap after rotating"
                    return
                }
            }
        }
        commit(message: candidates.count == 1 ? "Rotated furniture" : "Rotated \(candidates.count) items") { plan in
            for index in plan.furniture.indices {
                if let candidate = candidates[plan.furniture[index].id] {
                    plan.furniture[index] = candidate
                }
            }
        }
        selectedFurnitureIDs = ids
    }

    func deleteSelectedFurniture() {
        let ids = selectedFurnitureIDs
        guard !ids.isEmpty else { return }
        commit(message: ids.count == 1 ? "Removed furniture" : "Removed \(ids.count) furniture items") {
            $0.furniture.removeAll { ids.contains($0.id) }
        }
        selectedFurnitureIDs.removeAll()
    }

    func duplicateSelectedFurniture() {
        let originals = selectedFurnitureItems
        guard !originals.isEmpty else {
            statusMessage = "Select furniture to duplicate"
            return
        }
        let largestFootprint = originals.reduce(Float(0)) {
            max($0, max($1.orientedWidth, $1.orientedDepth))
        }
        let offset = max(plan.dimensions.gridSpacing * 2, largestFootprint + 0.10)
        let originalIDs = Set(originals.map(\.id))
        var copies: [FurnitureItem] = []
        for original in originals {
            var copy = original
            copy.id = UUID()
            copy.center = snappedFurnitureCenter(
                PlanPoint(x: original.center.x + offset, z: original.center.z + offset),
                for: copy
            )
            guard isFurniturePlacementValid(copy, excluding: originalIDs),
                  !copies.contains(where: { $0.footprint.intersects(copy.footprint) }) else {
                statusMessage = "Move the selection away from walls or furniture before duplicating"
                return
            }
            copies.append(copy)
        }
        commit(message: copies.count == 1 ? "Duplicated furniture" : "Duplicated \(copies.count) items") {
            $0.furniture.append(contentsOf: copies)
        }
        selectedFurnitureIDs = Set(copies.map(\.id))
    }

    func nudgeSelectedFurniture(dx: Float, dz: Float) {
        let ids = selectedFurnitureIDs
        guard !ids.isEmpty else { return }
        var replacements: [UUID: FurnitureItem] = [:]
        for item in selectedFurnitureItems {
            var candidate = item
            candidate.center = PlanPoint(x: item.center.x + dx, z: item.center.z + dz)
            guard isFurniturePlacementValid(candidate, excluding: ids) else {
                statusMessage = "Cannot move farther in that direction"
                return
            }
            replacements[item.id] = candidate
        }
        commit(message: "Nudged furniture") { plan in
            for index in plan.furniture.indices {
                if let replacement = replacements[plan.furniture[index].id] {
                    plan.furniture[index] = replacement
                }
            }
        }
        selectedFurnitureIDs = ids
    }

    func clearFurniture() {
        guard !plan.furniture.isEmpty else { return }
        commit(message: "Cleared furniture") { $0.furniture.removeAll() }
        selectedFurnitureIDs.removeAll()
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

    @discardableResult
    func addWall(from start: PlanPoint, length: Float, angleDegrees: Float) -> Bool {
        guard length.isFinite, angleDegrees.isFinite, length >= 0.30 else {
            statusMessage = "Enter a wall length of at least 30 cm"
            return false
        }
        let radians = angleDegrees * .pi / 180
        let end = PlanPoint(
            x: start.x + cos(radians) * length,
            z: start.z + sin(radians) * length
        )
        let wall = PartitionWall(start: start, end: end)
        guard wall.length >= 0.30 else {
            statusMessage = "Wall must be at least 30 cm long"
            return false
        }
        guard end == end.clamped(to: plan.dimensions) else {
            statusMessage = "That exact wall would leave the room"
            return false
        }
        commit(message: "Added exact \(wall.length.formattedMeters) wall") {
            $0.partitions.append(wall)
        }
        selectedWallID = wall.id
        selectedDoorID = nil
        selectedFurnitureIDs.removeAll()
        return true
    }

    @discardableResult
    func updateWall(id: UUID, start: PlanPoint, end: PlanPoint) -> Bool {
        guard let index = plan.partitions.firstIndex(where: { $0.id == id }) else { return false }
        let candidate = PartitionWall(id: id, start: start.clamped(to: plan.dimensions), end: end.clamped(to: plan.dimensions))
        guard candidate.length >= 0.30 else {
            statusMessage = "Wall must be at least 30 cm long"
            return false
        }
        let attachedDoors = plan.doors.filter { $0.wallID == id }
        guard attachedDoors.allSatisfy({ candidate.length >= $0.width + 0.20 }) else {
            statusMessage = "This wall is too short for its door"
            return false
        }
        commit(message: "Updated \(candidate.length.formattedMeters) wall") { plan in
            plan.partitions[index] = candidate
            for doorIndex in plan.doors.indices where plan.doors[doorIndex].wallID == id {
                let door = plan.doors[doorIndex]
                plan.doors[doorIndex].offset = door.offset.clamped(
                    to: 0.10...(candidate.length - door.width - 0.10)
                )
            }
        }
        selectedWallID = id
        return true
    }

    @discardableResult
    func updateSelectedWall(length: Float, angleDegrees: Float) -> Bool {
        guard let wall = selectedWall else { return false }
        guard length.isFinite, angleDegrees.isFinite, length >= 0.30 else {
            statusMessage = "Enter a wall length of at least 30 cm"
            return false
        }
        let radians = angleDegrees * .pi / 180
        let end = PlanPoint(
            x: wall.start.x + cos(radians) * length,
            z: wall.start.z + sin(radians) * length
        )
        guard end == end.clamped(to: plan.dimensions) else {
            statusMessage = "That exact wall would leave the room"
            return false
        }
        return updateWall(id: wall.id, start: wall.start, end: end)
    }

    @discardableResult
    func moveWall(id: UUID, translation: PlanPoint) -> Bool {
        guard let wall = plan.partitions.first(where: { $0.id == id }) else { return false }
        let dx = translation.x.clamped(
            to: -min(wall.start.x, wall.end.x)...(plan.dimensions.roomWidth - max(wall.start.x, wall.end.x))
        )
        let dz = translation.z.clamped(
            to: -min(wall.start.z, wall.end.z)...(plan.dimensions.roomLength - max(wall.start.z, wall.end.z))
        )
        return updateWall(
            id: id,
            start: wall.start + PlanPoint(x: dx, z: dz),
            end: wall.end + PlanPoint(x: dx, z: dz)
        )
    }

    func beginDoorPlacement() {
        mode = .plan
        tool = .door
        pendingFurnitureKind = nil
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

    func rotatePlanLeft() {
        planRotation = planRotation.turnedLeft
        statusMessage = "Rotated plan left · labels stay upright"
    }

    func rotatePlanRight() {
        planRotation = planRotation.turnedRight
        statusMessage = "Rotated plan right · labels stay upright"
    }

    func resetPlanRotation() {
        planRotation = .zero
        statusMessage = "Reset plan orientation"
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

    func roomLabel(near point: PlanPoint, tolerance: Float) -> RoomLabel? {
        plan.roomLabels
            .map { ($0, $0.position.distance(to: point)) }
            .filter { $0.1 <= tolerance }
            .min { $0.1 < $1.1 }?.0
    }

    @discardableResult
    func saveRoomLabel(name rawName: String, at rawPoint: PlanPoint, editingID: UUID? = nil) -> Bool {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = String(trimmed.prefix(RoomLabel.maximumNameLength))
        guard !name.isEmpty else {
            statusMessage = "Enter a room name"
            return false
        }
        let position = rawPoint.clamped(to: plan.dimensions)

        if let editingID,
           let index = plan.roomLabels.firstIndex(where: { $0.id == editingID }) {
            guard plan.roomLabels[index].name != name || plan.roomLabels[index].position != position else {
                return true
            }
            commit(message: "Renamed room to \(name)") { plan in
                plan.roomLabels[index].name = name
                plan.roomLabels[index].position = position
            }
        } else {
            let label = RoomLabel(name: name, position: position)
            commit(message: "Named room \(name)") { $0.roomLabels.append(label) }
        }
        return true
    }

    func deleteRoomLabel(id: UUID) {
        guard let label = plan.roomLabels.first(where: { $0.id == id }) else { return }
        commit(message: "Removed room label \(label.name)") {
            $0.roomLabels.removeAll { $0.id == id }
        }
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
            selectedFurnitureIDs.remove(furniture.id)
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

    func select(near point: PlanPoint, additive: Bool = false) {
        if let furniture = plan.furniture.last(where: { $0.contains(point, tolerance: 0.08) }) {
            if additive {
                if selectedFurnitureIDs.contains(furniture.id) {
                    selectedFurnitureIDs.remove(furniture.id)
                } else {
                    selectedFurnitureIDs.insert(furniture.id)
                }
            } else {
                selectedFurnitureID = furniture.id
            }
            selectedWallID = nil
            selectedDoorID = nil
            statusMessage = selectedFurnitureIDs.count > 1
                ? "Selected \(selectedFurnitureIDs.count) items · duplicate, rotate, nudge, or delete"
                : "Selected \(furniture.kind.title.lowercased()) · B rotates"
            return
        }

        if let door = nearestDoor(to: point, tolerance: 0.35) {
            selectedDoorID = door.id
            selectedWallID = door.wallID
            selectedFurnitureID = nil
            statusMessage = "Selected door · drag along its wall to position"
            return
        }

        selectedFurnitureIDs.removeAll()
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

    func updateSelectedDoorWidth(_ width: Float) {
        guard let doorID = selectedDoorID,
              let index = plan.doors.firstIndex(where: { $0.id == doorID }),
              let wall = plan.partitions.first(where: { $0.id == plan.doors[index].wallID }) else { return }
        guard width.isFinite else {
            statusMessage = "Enter a valid door width"
            return
        }
        let safeWidth = width.clamped(to: 0.60...min(2.00, wall.length - 0.20))
        commit(message: "Door width set to \(safeWidth.formattedCentimeters)") { plan in
            plan.doors[index].width = safeWidth
            plan.doors[index].offset = plan.doors[index].offset.clamped(
                to: 0.10...(wall.length - safeWidth - 0.10)
            )
        }
    }

    func deleteSelection() {
        if selectedDoorID != nil {
            deleteSelectedDoor()
        } else if !selectedFurnitureIDs.isEmpty {
            deleteSelectedFurniture()
        } else {
            deleteSelectedWall()
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
        guard spacing.isFinite else {
            statusMessage = "Enter a valid grid spacing"
            return
        }
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
        documentIsEdited = true
        statusMessage = "Loaded optimized 8-room demo"
        persist()
    }

    /// One-time upgrade path for installations that previously autosaved the
    /// old empty startup workspace. Never replaces a non-empty user layout.
    @discardableResult
    func loadDemoIfEmpty() -> Bool {
        guard plan == .initial else { return false }
        resetToSurvey()
        return true
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(plan)
        plan = previous
        selectedWallID = nil
        selectedDoorID = nil
        selectedFurnitureID = nil
        documentIsEdited = true
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
        documentIsEdited = true
        statusMessage = "Redid change"
        persist()
    }

    func openDocument() {
        guard confirmDiscardingDocumentChanges() else { return }
        let panel = NSOpenPanel()
        panel.title = "Open RoomCAD Design"
        panel.message = "Choose a .roomcad design or an older RoomCAD JSON export."
        panel.prompt = "Open"
        panel.allowedContentTypes = [.roomCADDesign, .json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        openDocument(at: url, confirmUnsavedChanges: false)
    }

    func openDocument(at url: URL, confirmUnsavedChanges: Bool = true) {
        guard !confirmUnsavedChanges || confirmDiscardingDocumentChanges() else { return }
        do {
            try loadDocument(from: url)
        } catch {
            documentErrorMessage = error.localizedDescription
            statusMessage = "Could not open \(url.lastPathComponent)"
        }
    }

    func loadDocument(from url: URL) throws {
        let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        if let fileSize, fileSize > RoomCADFile.maximumFileSize {
            throw RoomCADDocumentError.fileTooLarge
        }
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        let decoded = try RoomCADFile.decode(Data(contentsOf: url, options: .mappedIfSafe))

        plan = decoded.plan
        undoStack.removeAll()
        redoStack.removeAll()
        clearSelection()
        pendingFurnitureKind = nil
        mode = .plan
        tool = .select
        documentCreatedAt = decoded.createdAt
        lastDocumentSavedAt = decoded.savedAt
        currentDocumentFileSize = fileSize
        currentDocumentURL = decoded.isLegacyJSON ? nil : url.standardizedFileURL
        documentIsEdited = decoded.isLegacyJSON || decoded.repairedInvalidObjects

        if decoded.isLegacyJSON {
            statusMessage = "Imported legacy JSON · save it as a RoomCAD design"
        } else if decoded.repairedInvalidObjects {
            statusMessage = "Opened \(url.lastPathComponent) · repaired invalid objects"
        } else {
            statusMessage = "Opened \(url.lastPathComponent)"
        }
        persist()
    }

    @discardableResult
    func saveDocument() -> Bool {
        guard let currentDocumentURL else { return saveDocumentAs() }
        do {
            try saveDocument(to: currentDocumentURL)
            return true
        } catch {
            documentErrorMessage = error.localizedDescription
            statusMessage = "Could not save \(currentDocumentURL.lastPathComponent)"
            return false
        }
    }

    @discardableResult
    func saveDocumentAs() -> Bool {
        let panel = NSSavePanel()
        panel.title = "Save RoomCAD Design"
        panel.message = "RoomCAD designs include walls, doors, furniture, labels, and measurements."
        panel.prompt = "Save"
        panel.allowedContentTypes = [.roomCADDesign]
        panel.allowsOtherFileTypes = false
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = suggestedDocumentName + "." + RoomCADFile.fileExtension
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try saveDocument(to: url)
            return true
        } catch {
            documentErrorMessage = error.localizedDescription
            statusMessage = "Could not save \(url.lastPathComponent)"
            return false
        }
    }

    func saveDocument(to url: URL) throws {
        let savedAt = Date()
        let data = try RoomCADFile(
            plan: plan,
            createdAt: documentCreatedAt,
            savedAt: savedAt
        ).encoded()
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        try data.write(to: url, options: .atomic)
        currentDocumentURL = url.standardizedFileURL
        lastDocumentSavedAt = savedAt
        currentDocumentFileSize = data.count
        documentIsEdited = false
        statusMessage = "Saved \(url.lastPathComponent) · \(plan.partitions.count) walls, \(plan.doors.count) doors, \(plan.furniture.count) furniture"
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

    func saveSnapshot(named rawName: String) {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? "Layout \(snapshots.count + 1)" : trimmed
        let snapshot = LayoutSnapshot(name: name, plan: plan)
        do {
            try FileManager.default.createDirectory(
                at: snapshotDirectory,
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(snapshot).write(
                to: snapshotDirectory.appending(path: "\(snapshot.id.uuidString).json"),
                options: .atomic
            )
            snapshots.insert(snapshot, at: 0)
            statusMessage = "Saved snapshot “\(name)”"
        } catch {
            statusMessage = "Could not save snapshot: \(error.localizedDescription)"
        }
    }

    func restoreSnapshot(id: UUID) {
        guard let snapshot = snapshots.first(where: { $0.id == id }) else { return }
        recordUndo()
        plan = snapshot.plan
        plan.sanitize()
        redoStack.removeAll()
        clearSelection()
        documentIsEdited = true
        statusMessage = "Restored snapshot “\(snapshot.name)”"
        persist()
    }

    func deleteSnapshot(id: UUID) {
        guard let snapshot = snapshots.first(where: { $0.id == id }) else { return }
        do {
            let url = snapshotDirectory.appending(path: "\(id.uuidString).json")
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            snapshots.removeAll { $0.id == id }
            statusMessage = "Removed snapshot “\(snapshot.name)”"
        } catch {
            statusMessage = "Could not remove snapshot: \(error.localizedDescription)"
        }
    }

    private func commit(message: String, mutation: (inout FloorPlan) -> Void) {
        recordUndo()
        mutation(&plan)
        plan.sanitize()
        redoStack.removeAll()
        documentIsEdited = true
        statusMessage = message
        persist()
    }

    private func confirmDiscardingDocumentChanges() -> Bool {
        guard documentIsEdited else { return true }
        let alert = NSAlert()
        alert.messageText = "Save changes to \(documentDisplayName)?"
        alert.informativeText = "Opening another design replaces the current workspace. Choose Save to keep your latest changes in a RoomCAD design file."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don't Save")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            return saveDocument()
        case .alertThirdButtonReturn:
            return true
        default:
            return false
        }
    }

    private var suggestedDocumentName: String {
        guard currentDocumentURL == nil,
              plan.partitions.count == 17,
              plan.doors.count == 8,
              plan.furniture.count == 24,
              plan.roomLabels.count == 8 else {
            return documentDisplayName
        }
        return "RoomCAD 8-Room Demo"
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

    private func isFurniturePlacementValid(
        _ item: FurnitureItem,
        excluding excludedIDs: Set<UUID> = []
    ) -> Bool {
        item.isOnUsableFloor(plan.dimensions)
            && !plan.furniture.contains {
                !excludedIDs.contains($0.id) && $0.footprint.intersects(item.footprint)
            }
    }

    private func snappedFurnitureCenter(_ rawPoint: PlanPoint, for item: FurnitureItem) -> PlanPoint {
        let spacing = max(plan.dimensions.gridSpacing, 0.001)
        func coordinate(_ rawValue: Float, minimum: Float, maximum: Float) -> Float {
            let minimumGrid = (minimum / spacing).rounded(.up) * spacing
            let maximumGrid = (maximum / spacing).rounded(.down) * spacing
            guard minimumGrid <= maximumGrid else { return (minimum + maximum) / 2 }
            return ((rawValue / spacing).rounded() * spacing).clamped(to: minimumGrid...maximumGrid)
        }

        var result = PlanPoint(
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
        let guideTolerance = max(spacing * 1.5, 0.08)
        if let alignedX = plan.furniture
            .filter({ $0.id != item.id })
            .map(\.center.x)
            .filter({ abs($0 - result.x) <= guideTolerance })
            .min(by: { abs($0 - result.x) < abs($1 - result.x) }) {
            result.x = alignedX
        }
        if let alignedZ = plan.furniture
            .filter({ $0.id != item.id })
            .map(\.center.z)
            .filter({ abs($0 - result.z) <= guideTolerance })
            .min(by: { abs($0 - result.z) < abs($1 - result.z) }) {
            result.z = alignedZ
        }
        return result
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
            lastSavedAt = Date()
        } catch {
            statusMessage = "Could not autosave: \(error.localizedDescription)"
        }
    }

    private var snapshotDirectory: URL {
        persistenceURL.deletingLastPathComponent()
            .appending(path: "Snapshots", directoryHint: .isDirectory)
    }

    private func loadSnapshots() -> [LayoutSnapshot] {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: snapshotDirectory,
            includingPropertiesForKeys: nil
        ) else { return [] }
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(LayoutSnapshot.self, from: data)
            }
            .sorted { $0.createdAt > $1.createdAt }
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
