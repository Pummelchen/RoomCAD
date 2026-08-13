import AppKit
import Foundation
import Observation

enum WorkspaceMode: String, CaseIterable, Identifiable, Sendable {
    case plan = "2D Plan"
    case walkthrough = "3D Walk"

    var id: Self { self }

    var systemImage: String {
        self == .plan ? "square.grid.3x3" : "cube.transparent"
    }
}

enum PlanTool: String, CaseIterable, Identifiable, Sendable {
    case select
    case wall
    case door
    case window
    case furniture
    case erase

    var id: Self { self }

    var title: String {
        switch self {
        case .select: "Select"
        case .wall: "Wall"
        case .door: "Door"
        case .window: "Window"
        case .furniture: "Furniture"
        case .erase: "Erase"
        }
    }

    var systemImage: String {
        switch self {
        case .select: "cursorarrow"
        case .wall: "pencil.and.ruler"
        case .door: "door.left.hand.open"
        case .window: "rectangle.dashed"
        case .furniture: "sofa"
        case .erase: "eraser"
        }
    }

    var helpText: String {
        switch self {
        case .select: "Drag walls, doors, windows, and furniture · click to select"
        case .wall: "Drag on the plan to draw a wall"
        case .door: "Click a wall to add a door, then drag it to slide"
        case .window: "Click a wall to add a window, then drag it to slide"
        case .furniture: "Click the floor to place furniture"
        case .erase: "Click anything to erase it"
        }
    }
}

@MainActor
@Observable
final class RoomStore {
    var room: RoomPlan
    var mode: WorkspaceMode = .plan
    var tool: PlanTool = .select
    var pendingFurnitureKind: FurnitureKind?
    var selectedWallID: UUID?
    var selectedDoorID: UUID?
    var selectedWindowID: UUID?
    var selectedFurnitureID: UUID?
    var currentFileURL: URL?
    var documentIsEdited = false
    var statusMessage = "Ready"
    var savedRooms: [SavedRoom] = []

    private var undoStack: [RoomPlan] = []
    private var redoStack: [RoomPlan] = []
    private var dragTransactionActive = false

    static let roomsFolder: URL = {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appending(path: "RoomCAD", directoryHint: .isDirectory)
    }()

    init(room: RoomPlan = .fresh()) {
        self.room = room
        refreshSavedRooms()
    }

    // MARK: Selection

    var hasSelection: Bool {
        selectedWallID != nil || selectedDoorID != nil
            || selectedWindowID != nil || selectedFurnitureID != nil
    }

    var selectedWall: Wall? {
        guard let selectedWallID else { return nil }
        return room.walls.first { $0.id == selectedWallID }
    }

    var selectedDoor: DoorOpening? {
        guard let selectedDoorID else { return nil }
        return room.door(id: selectedDoorID)
    }

    var selectedWindow: WindowOpening? {
        guard let selectedWindowID else { return nil }
        return room.window(id: selectedWindowID)
    }

    var selectedFurniture: FurnitureItem? {
        guard let selectedFurnitureID else { return nil }
        return room.furniture.first { $0.id == selectedFurnitureID }
    }

    var selectedOpeningKind: OpeningKind? {
        if selectedDoorID != nil { return .door }
        if selectedWindowID != nil { return .window }
        return nil
    }

    var selectedOpeningWall: Wall? {
        guard let kind = selectedOpeningKind else { return nil }
        let id = kind == .door ? selectedDoorID : selectedWindowID
        guard let id else { return nil }
        return room.openingWall(id: id, kind: kind)
    }

    var selectedOpeningSpacing: OpeningSpacing? {
        guard let kind = selectedOpeningKind else { return nil }
        let id = kind == .door ? selectedDoorID : selectedWindowID
        guard let id else { return nil }
        return room.spacing(forOpeningWith: id, kind: kind)
    }

    func clearSelection() {
        selectedWallID = nil
        selectedDoorID = nil
        selectedWindowID = nil
        selectedFurnitureID = nil
    }

    func select(near point: PlanPoint) {
        if let furniture = room.furniture(near: point) {
            clearSelection()
            selectedFurnitureID = furniture.id
            statusMessage = "Selected \(furniture.kind.title.lowercased()) · drag to move, B to turn"
            return
        }
        if let opening = room.opening(near: point) {
            clearSelection()
            switch opening.kind {
            case .door:
                selectedDoorID = opening.id
                statusMessage = "Selected door · drag along the wall to slide it"
            case .window:
                selectedWindowID = opening.id
                statusMessage = "Selected window · drag along the wall to slide it"
            }
            return
        }
        if let wall = room.wall(near: point) {
            clearSelection()
            selectedWallID = wall.id
            statusMessage = "Selected wall · \(wall.length.formattedCentimeters) long"
            return
        }
        clearSelection()
        statusMessage = "Click a wall, door, window, or furniture item"
    }

    // MARK: Tools

    func chooseTool(_ tool: PlanTool) {
        self.tool = tool
        pendingFurnitureKind = nil
        clearSelection()
        statusMessage = tool.helpText
    }

    func beginFurniturePlacement(_ kind: FurnitureKind) {
        tool = .furniture
        pendingFurnitureKind = kind
        clearSelection()
        statusMessage = "Click on the floor to place the \(kind.title.lowercased()) · Esc to stop"
    }

    func cancelPlacement() {
        guard tool != .select else { return }
        pendingFurnitureKind = nil
        tool = .select
        statusMessage = "Stopped"
    }

    // MARK: Walls

    @discardableResult
    func addWall(from rawStart: PlanPoint, to rawEnd: PlanPoint) -> Bool {
        let start = room.snapPoint(rawStart)
        let end = room.snapPoint(rawEnd)
        let wall = Wall(start: start, end: end)
        guard wall.length >= RoomPlan.minimumWallLength else {
            statusMessage = "Walls need to be at least 30 cm long"
            return false
        }
        commit(message: "Added \(wall.length.formattedCentimeters) wall") {
            $0.walls.append(wall)
        }
        selectedWallID = wall.id
        selectedDoorID = nil
        selectedWindowID = nil
        selectedFurnitureID = nil
        return true
    }

    /// Moves one wall endpoint while dragging.
    func updateWallEndpoint(id: UUID, part: WallPart, to rawPoint: PlanPoint) {
        guard let index = room.walls.firstIndex(where: { $0.id == id }) else { return }
        let point = room.snapPoint(rawPoint, excludingWallID: id)
        beginDragTransaction()
        var wall = room.walls[index]
        switch part {
        case .start: wall.start = point
        case .end: wall.end = point
        }
        if wall.length >= 0.15 {
            room.walls[index] = wall
        }
    }

    /// Translates a whole wall while dragging.
    func moveWall(id: UUID, by rawDelta: PlanPoint) {
        guard let index = room.walls.firstIndex(where: { $0.id == id }) else { return }
        beginDragTransaction()
        let delta = PlanPoint(x: rawDelta.x, z: rawDelta.z)
        room.walls[index] = room.walls[index].translated(
            by: delta,
            clampedTo: room.width,
            length: room.length
        )
    }

    // MARK: Doors and windows

    @discardableResult
    func placeOpening(kind: OpeningKind, near point: PlanPoint) -> Bool {
        guard let (wall, offset) = room.wall(forPlacementAt: point) else {
            statusMessage = kind == .door
                ? "Click on a wall to place a door"
                : "Click on a wall to place a window"
            return false
        }
        let width: Double = kind == .door ? 0.90 : 1.00
        guard wall.length >= width + 0.20 else {
            statusMessage = "That wall is too short for a \(kind == .door ? "door" : "window")"
            return false
        }
        let rawOffset = offset - width / 2
        let snapped = room.gridSnap(PlanPoint(x: rawOffset, z: 0)).x
            .clamped(to: 0.10...(wall.length - width - 0.10))
        commit(message: kind == .door ? "Added door" : "Added window") { plan in
            if kind == .door {
                plan.doors.append(DoorOpening(wallID: wall.id, offset: snapped, width: width))
            } else {
                plan.windows.append(WindowOpening(wallID: wall.id, offset: snapped, width: width))
            }
        }
        if kind == .door {
            selectedDoorID = room.doors.last?.id
        } else {
            selectedWindowID = room.windows.last?.id
        }
        selectedWallID = nil
        selectedFurnitureID = nil
        tool = .select
        statusMessage = kind == .door
            ? "Door placed · drag it along the wall to position"
            : "Window placed · drag it along the wall to position"
        return true
    }

    /// Slides an opening along its wall while dragging.
    func slideOpening(kind: OpeningKind, id: UUID, to rawPoint: PlanPoint) {
        beginDragTransaction()
        switch kind {
        case .door:
            guard let index = room.doors.firstIndex(where: { $0.id == id }),
                  let wall = room.walls.first(where: { $0.id == room.doors[index].wallID }) else { return }
            let projection = wall.projection(of: rawPoint)
            let offset = snappedOpeningOffset(
                projection.offset - room.doors[index].width / 2,
                width: room.doors[index].width,
                wall: wall
            )
            if let offset {
                room.doors[index].offset = offset
            }
        case .window:
            guard let index = room.windows.firstIndex(where: { $0.id == id }),
                  let wall = room.walls.first(where: { $0.id == room.windows[index].wallID }) else { return }
            let projection = wall.projection(of: rawPoint)
            let offset = snappedOpeningOffset(
                projection.offset - room.windows[index].width / 2,
                width: room.windows[index].width,
                wall: wall
            )
            if let offset {
                room.windows[index].offset = offset
            }
        }
    }

    /// Slides an opening to an exact offset (used by the inspector slider).
    func slideOpeningToOffset(kind: OpeningKind, id: UUID, offset: Double) {
        beginDragTransaction()
        switch kind {
        case .door:
            guard let index = room.doors.firstIndex(where: { $0.id == id }),
                  let wall = room.walls.first(where: { $0.id == room.doors[index].wallID }) else { return }
            room.doors[index].offset = offset.clamped(
                to: 0.10...(wall.length - room.doors[index].width - 0.10)
            )
        case .window:
            guard let index = room.windows.firstIndex(where: { $0.id == id }),
                  let wall = room.walls.first(where: { $0.id == room.windows[index].wallID }) else { return }
            room.windows[index].offset = offset.clamped(
                to: 0.10...(wall.length - room.windows[index].width - 0.10)
            )
        }
    }

    func updateOpeningWidth(kind: OpeningKind, width: Double) {
        beginDragTransaction()
        let clamped = width.clamped(to: kind == .door ? 0.60...1.40 : 0.40...2.00)
        switch kind {
        case .door:
            guard let id = selectedDoorID,
                  let index = room.doors.firstIndex(where: { $0.id == id }) else { return }
            room.doors[index].width = clamped
        case .window:
            guard let id = selectedWindowID,
                  let index = room.windows.firstIndex(where: { $0.id == id }) else { return }
            room.windows[index].width = clamped
        }
    }

    func setOpeningWidth(kind: OpeningKind, width: Double) {
        let id = kind == .door ? selectedDoorID : selectedWindowID
        guard let id else { return }
        let clamped = width.clamped(to: kind == .door ? 0.60...1.40 : 0.40...2.00)
        commit(message: "Set \(kind == .door ? "door" : "window") width to \(clamped.formattedCentimeters)") { plan in
            switch kind {
            case .door:
                if let index = plan.doors.firstIndex(where: { $0.id == id }) {
                    plan.doors[index].width = clamped
                }
            case .window:
                if let index = plan.windows.firstIndex(where: { $0.id == id }) {
                    plan.windows[index].width = clamped
                }
            }
        }
    }

    private func snappedOpeningOffset(_ rawOffset: Double, width: Double, wall: Wall) -> Double? {
        guard wall.length >= width + 0.20 else { return nil }
        let snapped = room.gridSnap(PlanPoint(x: rawOffset, z: 0)).x
        return snapped.clamped(to: 0.10...(wall.length - width - 0.10))
    }

    // MARK: Furniture

    func placeFurniture(kind: FurnitureKind, near rawPoint: PlanPoint) {
        var candidate = FurnitureItem(kind: kind, center: rawPoint)
        candidate.center = room.furnitureCenter(near: rawPoint, for: candidate)
        guard room.isFurniturePlacementValid(candidate) else {
            statusMessage = "That spot is taken · click an open space"
            return
        }
        commit(message: "Placed \(kind.title.lowercased())") {
            $0.furniture.append(candidate)
        }
        selectedFurnitureID = candidate.id
        statusMessage = "\(kind.title) placed · click again or press Esc to stop"
    }

    func moveFurniture(id: UUID, to rawPoint: PlanPoint) {
        beginDragTransaction()
        guard let index = room.furniture.firstIndex(where: { $0.id == id }) else { return }
        var item = room.furniture[index]
        let center = room.furnitureCenter(near: rawPoint, for: item)
        item.center = center
        if room.isFurniturePlacementValid(item, excluding: [id]) {
            room.furniture[index] = item
        }
    }

    func rotateSelectedFurniture() {
        guard let id = selectedFurnitureID else {
            statusMessage = "Select a furniture item first"
            return
        }
        guard let index = room.furniture.firstIndex(where: { $0.id == id }) else { return }
        var candidate = room.furniture[index]
        candidate.rotationDegrees = (candidate.rotationDegrees + 90)
            .truncatingRemainder(dividingBy: 360)
        candidate.center = candidate.center.clamped(
            x: candidate.orientedWidth / 2...(room.width - candidate.orientedWidth / 2),
            z: candidate.orientedDepth / 2...(room.length - candidate.orientedDepth / 2)
        )
        guard room.isFurniturePlacementValid(candidate, excluding: [id]) else {
            statusMessage = "Not enough space to turn it here"
            return
        }
        commit(message: "Turned \(candidate.kind.title.lowercased())") { plan in
            plan.furniture[index] = candidate
        }
    }

    func nudgeSelectedFurniture(dx: Double, dz: Double) {
        guard let id = selectedFurnitureID else { return }
        guard let index = room.furniture.firstIndex(where: { $0.id == id }) else { return }
        var candidate = room.furniture[index]
        candidate.center = PlanPoint(x: candidate.center.x + dx, z: candidate.center.z + dz)
        guard room.isFurniturePlacementValid(candidate, excluding: [id]) else {
            statusMessage = "Can't move any further that way"
            return
        }
        commit(message: "Moved \(candidate.kind.title.lowercased())") { plan in
            plan.furniture[index] = candidate
        }
    }

    // MARK: Erase and delete

    func erase(near point: PlanPoint) {
        if let furniture = room.furniture(near: point) {
            commit(message: "Erased \(furniture.kind.title.lowercased())") {
                $0.furniture.removeAll { $0.id == furniture.id }
            }
            if selectedFurnitureID == furniture.id { selectedFurnitureID = nil }
            return
        }
        if let opening = room.opening(near: point) {
            commit(message: "Erased \(opening.kind == .door ? "door" : "window")") { plan in
                if opening.kind == .door {
                    plan.doors.removeAll { $0.id == opening.id }
                } else {
                    plan.windows.removeAll { $0.id == opening.id }
                }
            }
            if selectedDoorID == opening.id { selectedDoorID = nil }
            if selectedWindowID == opening.id { selectedWindowID = nil }
            return
        }
        if let wall = room.wall(near: point) {
            commit(message: "Erased wall") { plan in
                plan.walls.removeAll { $0.id == wall.id }
                plan.doors.removeAll { $0.wallID == wall.id }
                plan.windows.removeAll { $0.wallID == wall.id }
            }
            if selectedWallID == wall.id { selectedWallID = nil }
            return
        }
        statusMessage = "Nothing to erase there"
    }

    func deleteSelection() {
        if let id = selectedFurnitureID {
            commit(message: "Deleted furniture") { $0.furniture.removeAll { $0.id == id } }
            selectedFurnitureID = nil
        } else if let id = selectedDoorID {
            commit(message: "Deleted door") { $0.doors.removeAll { $0.id == id } }
            selectedDoorID = nil
        } else if let id = selectedWindowID {
            commit(message: "Deleted window") { $0.windows.removeAll { $0.id == id } }
            selectedWindowID = nil
        } else if let id = selectedWallID {
            commit(message: "Deleted wall") { plan in
                plan.walls.removeAll { $0.id == id }
                plan.doors.removeAll { $0.wallID == id }
                plan.windows.removeAll { $0.wallID == id }
            }
            selectedWallID = nil
        }
    }

    // MARK: Room settings

    func updateRoomSize(width: Double, length: Double) {
        let clampedWidth = width.clamped(to: 2...20)
        let clampedLength = length.clamped(to: 2...20)
        guard clampedWidth != room.width || clampedLength != room.length else { return }
        commit(message: "Resized room to \(clampedWidth.formattedCentimeters) × \(clampedLength.formattedCentimeters)") {
            $0.width = clampedWidth
            $0.length = clampedLength
        }
        clearSelection()
    }

    func updateRoomHeight(_ height: Double) {
        let clamped = height.clamped(to: 2.2...5)
        guard clamped != room.height else { return }
        commit(message: "Set ceiling height to \(clamped.formattedMeters)") { $0.height = clamped }
    }

    func setGrid(_ step: GridStep) {
        guard step != room.grid else { return }
        commit(message: "Grid set to \(step.label)") { $0.grid = step }
    }

    func renameRoom(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != room.name else { return }
        commit(message: "Renamed room to \(trimmed)") { $0.name = trimmed }
    }

    // MARK: Undo, redo, and drag transactions

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(room)
        room = previous
        clearSelection()
        documentIsEdited = true
        statusMessage = "Undid change"
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(room)
        room = next
        clearSelection()
        documentIsEdited = true
        statusMessage = "Redid change"
    }

    private func commit(message: String, mutation: (inout RoomPlan) -> Void) {
        if dragTransactionActive {
            dragTransactionActive = false
            undoStack.removeLast()
        }
        recordUndo()
        mutation(&room)
        room.sanitize()
        redoStack.removeAll()
        documentIsEdited = true
        statusMessage = message
    }

    /// Starts an editing session that produces a single undo entry, used by
    /// continuous gestures such as dragging or sliding a slider.
    func beginDragTransaction() {
        guard !dragTransactionActive else { return }
        recordUndo()
        dragTransactionActive = true
    }

    func endDragTransaction(message: String) {
        guard dragTransactionActive else { return }
        dragTransactionActive = false
        room.sanitize()
        redoStack.removeAll()
        documentIsEdited = true
        statusMessage = message
    }

    /// Discards the drag's undo entry without keeping any changes. Used when a
    /// drag turns out to have been a click.
    func discardDragTransaction() {
        guard dragTransactionActive else { return }
        dragTransactionActive = false
        if !undoStack.isEmpty { undoStack.removeLast() }
    }

    private func recordUndo() {
        undoStack.append(room)
        if undoStack.count > 100 { undoStack.removeFirst() }
    }

    // MARK: Files and rooms

    var documentDisplayName: String {
        currentFileURL?.deletingPathExtension().lastPathComponent ?? room.name
    }

    func newRoom() {
        guard confirmDiscardingChanges() else { return }
        room = .fresh()
        undoStack.removeAll()
        redoStack.removeAll()
        clearSelection()
        pendingFurnitureKind = nil
        tool = .select
        mode = .plan
        currentFileURL = nil
        documentIsEdited = false
        statusMessage = "Started a new room"
    }

    func openRoom() {
        guard confirmDiscardingChanges() else { return }
        let panel = NSOpenPanel()
        panel.title = "Open a Room"
        panel.message = "Choose a saved .room design."
        panel.prompt = "Open"
        panel.allowedContentTypes = [.roomCADV2Room]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.directoryURL = Self.roomsFolder
        guard panel.runModal() == .OK, let url = panel.url else { return }
        openRoom(at: url)
    }

    func openRoom(at url: URL) {
        guard confirmDiscardingChanges() else { return }
        do {
            let data = try Data(contentsOf: url)
            let opened = try RoomFile.decode(data)
            room = opened
            undoStack.removeAll()
            redoStack.removeAll()
            clearSelection()
            pendingFurnitureKind = nil
            tool = .select
            mode = .plan
            currentFileURL = url.standardizedFileURL
            documentIsEdited = false
            statusMessage = "Opened \(url.lastPathComponent)"
        } catch {
            statusMessage = "Could not open \(url.lastPathComponent)"
        }
    }

    @discardableResult
    func saveRoom() -> Bool {
        guard let currentFileURL else { return saveRoomAs() }
        do {
            try writeRoom(to: currentFileURL)
            return true
        } catch {
            statusMessage = "Could not save \(currentFileURL.lastPathComponent)"
            return false
        }
    }

    @discardableResult
    func saveRoomAs() -> Bool {
        let panel = NSSavePanel()
        panel.title = "Save Room"
        panel.prompt = "Save"
        panel.allowedContentTypes = [.roomCADV2Room]
        panel.allowsOtherFileTypes = false
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.directoryURL = Self.roomsFolder
        panel.nameFieldStringValue = room.name.isEmpty ? "My Room" : room.name
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try writeRoom(to: url)
            return true
        } catch {
            statusMessage = "Could not save \(url.lastPathComponent)"
            return false
        }
    }

    private func writeRoom(to url: URL) throws {
        var savedRoom = room
        savedRoom.name = url.deletingPathExtension().lastPathComponent
        room.name = savedRoom.name
        try RoomFile(room: savedRoom).encoded().write(to: url, options: .atomic)
        currentFileURL = url.standardizedFileURL
        documentIsEdited = false
        statusMessage = "Saved \(url.lastPathComponent)"
        refreshSavedRooms()
    }

    struct SavedRoom: Identifiable, Equatable, Sendable {
        var url: URL
        var name: String
        var summary: String

        var id: URL { url }
    }

    func refreshSavedRooms() {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: Self.roomsFolder,
            includingPropertiesForKeys: nil
        ) else {
            savedRooms = []
            return
        }
        savedRooms = urls
            .filter { $0.pathExtension.lowercased() == RoomFile.fileExtension }
            .compactMap { url -> SavedRoom? in
                guard let data = try? Data(contentsOf: url),
                      let room = try? RoomFile.decode(data) else { return nil }
                return SavedRoom(
                    url: url,
                    name: room.name,
                    summary: "\(room.width.formattedCentimeters) × \(room.length.formattedCentimeters)"
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func confirmDiscardingChanges() -> Bool {
        guard documentIsEdited else { return true }
        let alert = NSAlert()
        alert.messageText = "Save changes to \(documentDisplayName)?"
        alert.informativeText = "Your latest changes are not saved yet."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don't Save")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            return saveRoom()
        case .alertThirdButtonReturn:
            return true
        default:
            return false
        }
    }
}
