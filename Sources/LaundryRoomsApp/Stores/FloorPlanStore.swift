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
    }

    func erase(near point: PlanPoint) {
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
    }

    func resetToSurvey() {
        recordUndo()
        plan = .example
        redoStack.removeAll()
        selectedWallID = nil
        statusMessage = "Loaded example room layout"
        persist()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(plan)
        plan = previous
        selectedWallID = nil
        statusMessage = "Undid change"
        persist()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(plan)
        plan = next
        selectedWallID = nil
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
    var formattedMeters: String { String(format: "%.2f m", self) }
    var formattedCentimeters: String { String(format: "%.0f cm", self * 100) }
}
