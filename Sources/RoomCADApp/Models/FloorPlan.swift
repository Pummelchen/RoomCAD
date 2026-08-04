import Foundation

struct PlanPoint: Codable, Equatable, Hashable, Sendable {
    var x: Float
    var z: Float

    static let zero = PlanPoint(x: 0, z: 0)

    func distance(to other: PlanPoint) -> Float {
        hypot(other.x - x, other.z - z)
    }
}

struct SurveyDimensions: Codable, Equatable, Sendable {
    var roomWidth: Float = 4.87
    var roomLength: Float = 16.44
    var clearHeight: Float = 3.60
    var exteriorWallThickness: Float = 0.15
    var drywallThickness: Float = 0.10
    var stairCoreLength: Float = 6.00
    var stairCoreWidth: Float = 2.50
    var gridSpacing: Float = 0.05

    var floorArea: Float { roomWidth * roomLength }

    /// Returns the closest editable grid point while preserving the exact
    /// measured shell edges as valid snap targets. This matters when a room
    /// dimension is not an exact multiple of the configured grid spacing.
    func snapped(_ point: PlanPoint) -> PlanPoint {
        func snappedCoordinate(_ value: Float, maximum: Float) -> Float {
            let bounded = value.clamped(to: 0...maximum)
            let spacing = max(gridSpacing, 0.001)
            let gridValue = ((bounded / spacing).rounded() * spacing).clamped(to: 0...maximum)
            return [Float(0), gridValue, maximum]
                .min(by: { abs($0 - bounded) < abs($1 - bounded) }) ?? gridValue
        }

        return PlanPoint(
            x: snappedCoordinate(point.x, maximum: roomWidth),
            z: snappedCoordinate(point.z, maximum: roomLength)
        )
    }

    mutating func sanitize() {
        roomWidth = roomWidth.clamped(to: 3...12)
        roomLength = roomLength.clamped(to: 6...40)
        clearHeight = clearHeight.clamped(to: 2.4...6)
        exteriorWallThickness = exteriorWallThickness.clamped(to: 0.08...0.4)
        drywallThickness = drywallThickness.clamped(to: 0.06...0.25)
        stairCoreLength = stairCoreLength.clamped(to: 2...min(10, roomLength - 1))
        stairCoreWidth = stairCoreWidth.clamped(to: 1.2...min(4, roomWidth - 0.4))
        gridSpacing = gridSpacing.clamped(to: 0.01...0.5)
    }
}

/// Photo-matched floor finish expressed in the same metre coordinate system as
/// the survey. The 60 cm module is inferred from the square polished tiles in
/// the supplied photographs; cut strips fall at the far walls.
struct FloorTileLayout: Equatable, Sendable {
    static let tileSize: Float = 0.60
    static let groutWidth: Float = 0.004

    let columns: Int
    let rows: Int
    let fullColumns: Int
    let fullRows: Int
    let widthCut: Float
    let lengthCut: Float

    init(dimensions: SurveyDimensions) {
        func axisLayout(length: Float) -> (full: Int, cut: Float) {
            let quotient = length / Self.tileSize
            let nearestWhole = quotient.rounded()
            if abs(quotient - nearestWhole) < 0.001 {
                return (Int(nearestWhole), 0)
            }
            let full = Int(quotient.rounded(.down))
            return (full, max(0, length - Float(full) * Self.tileSize))
        }

        let width = axisLayout(length: dimensions.roomWidth)
        let length = axisLayout(length: dimensions.roomLength)

        fullColumns = width.full
        fullRows = length.full
        widthCut = width.cut
        lengthCut = length.cut
        columns = width.full + (width.cut > 0.001 ? 1 : 0)
        rows = length.full + (length.cut > 0.001 ? 1 : 0)
    }
}

struct PlanRectangle: Equatable, Sendable {
    var minX: Float
    var maxX: Float
    var minZ: Float
    var maxZ: Float

    var width: Float { maxX - minX }
    var length: Float { maxZ - minZ }
    var centerX: Float { (minX + maxX) / 2 }
    var centerZ: Float { (minZ + maxZ) / 2 }
}

/// Shared photo-and-survey interpretation for the fixed six-metre core.
///
/// The lower flight approaches beneath the bathroom, turns beneath the
/// transverse upper flight, and is exposed only in the 3.50 m floor opening.
/// Keeping this derivation in the model makes the 2D and Metal views agree.
struct StairBathroomLayout: Equatable, Sendable {
    static let bathroomDepth: Float = 1.75

    let core: PlanRectangle
    let bathroom: PlanRectangle
    let upperFlight: PlanRectangle
    let landing: PlanRectangle
    let lowerOpening: PlanRectangle
    let lowerCoveredFlight: PlanRectangle
    let lowerUnderBathroom: PlanRectangle
    let rearWindowStartX: Float
    let rearWindowEndX: Float

    init(dimensions d: SurveyDimensions) {
        let coreStart = d.roomLength - d.stairCoreLength
        let landingLength = min(3.50, d.stairCoreLength - 1.0)
        let rearBlockStart = coreStart + landingLength
        let lowerWidth = min(1.15, d.roomWidth - 1.0)
        let lowerMinX = d.roomWidth - lowerWidth
        let bathroomMinX = max(0, d.roomWidth - Self.bathroomDepth)
        let upperStartX = min(2.40, lowerMinX - 0.60)
        let landingMinX = max(upperStartX, lowerMinX - 1.35)
        let upperFlightDepth = min(1.35, d.roomLength - rearBlockStart)
        let upperFlightEnd = rearBlockStart + upperFlightDepth

        core = PlanRectangle(
            minX: max(0, d.roomWidth - d.stairCoreWidth),
            maxX: d.roomWidth,
            minZ: coreStart,
            maxZ: d.roomLength
        )
        bathroom = PlanRectangle(
            minX: bathroomMinX,
            maxX: d.roomWidth,
            minZ: upperFlightEnd,
            maxZ: d.roomLength
        )
        upperFlight = PlanRectangle(
            minX: upperStartX,
            maxX: d.roomWidth,
            minZ: rearBlockStart,
            maxZ: upperFlightEnd
        )
        landing = PlanRectangle(
            minX: landingMinX,
            maxX: lowerMinX,
            minZ: coreStart,
            maxZ: rearBlockStart
        )
        lowerOpening = PlanRectangle(
            minX: lowerMinX,
            maxX: d.roomWidth,
            minZ: coreStart,
            maxZ: rearBlockStart
        )
        lowerCoveredFlight = PlanRectangle(
            minX: lowerMinX,
            maxX: d.roomWidth,
            minZ: rearBlockStart,
            maxZ: upperFlightEnd
        )
        lowerUnderBathroom = PlanRectangle(
            minX: lowerMinX,
            maxX: d.roomWidth,
            minZ: upperFlightEnd,
            maxZ: d.roomLength
        )
        rearWindowStartX = 0.08
        rearWindowEndX = max(rearWindowStartX + 0.50, bathroomMinX - 1.52)
    }
}

struct PartitionWall: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var start: PlanPoint
    var end: PlanPoint

    var length: Float { start.distance(to: end) }

    func projection(of point: PlanPoint) -> (point: PlanPoint, offset: Float, distance: Float) {
        let dx = end.x - start.x
        let dz = end.z - start.z
        let lengthSquared = dx * dx + dz * dz
        guard lengthSquared > 0.0001 else { return (start, 0, start.distance(to: point)) }
        let rawT = ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared
        let t = rawT.clamped(to: 0...1)
        let projected = PlanPoint(x: start.x + dx * t, z: start.z + dz * t)
        return (projected, length * t, projected.distance(to: point))
    }
}

enum DoorHinge: String, Codable, CaseIterable, Sendable {
    case left
    case right
}

struct DoorOpening: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var wallID: UUID
    var offset: Float
    var width: Float = 0.90
    var height: Float = 2.10
    var hinge: DoorHinge = .left
}

struct RoomLabel: Identifiable, Codable, Equatable, Sendable {
    static let maximumNameLength = 80

    var id: UUID = UUID()
    var name: String
    var position: PlanPoint
}

/// A dense, corridor-accessed concept for demonstrating RoomCAD's manual
/// editing tools. It is intentionally a planning example, not a claim of local
/// building-code, accessibility, fire-egress, or rental approval.
struct SpaceOptimizedDemoLayout: Sendable {
    struct Room: Sendable {
        var name: String
        var bounds: PlanRectangle
        var entranceWallID: UUID
        var entranceDoorID: UUID
        var furnitureIDs: Set<UUID>

        var area: Float { bounds.width * bounds.length }
    }

    static let corridorWidth: Float = 1.15
    static let frontRoomCount = 6
    static let rearRoomDepth: Float = 2.75
    static let furnitureWallClearance: Float = 0.05

    var walkway: PlanRectangle
    var rooms: [Room] = []
    var partitions: [PartitionWall] = []
    var doors: [DoorOpening] = []
    var furniture: [FurnitureItem] = []
    var labels: [RoomLabel] = []

    init(dimensions d: SurveyDimensions) {
        let core = StairBathroomLayout(dimensions: d)
        let corridorMinX = core.lowerOpening.minX
        let frontRoomDepth = core.core.minZ / Float(Self.frontRoomCount)
        walkway = PlanRectangle(
            minX: corridorMinX,
            maxX: core.lowerOpening.maxX,
            minZ: 0,
            maxZ: core.lowerOpening.minZ
        )

        for index in 0..<Self.frontRoomCount {
            let startZ = Float(index) * frontRoomDepth
            let endZ = Float(index + 1) * frontRoomDepth
            let bounds = PlanRectangle(
                minX: 0,
                maxX: corridorMinX,
                minZ: startZ,
                maxZ: endZ
            )
            let entranceWall = PartitionWall(
                start: PlanPoint(x: corridorMinX, z: startZ),
                end: PlanPoint(x: corridorMinX, z: endZ)
            )
            let entranceDoor = DoorOpening(
                wallID: entranceWall.id,
                offset: frontRoomDepth - 1.00,
                width: 0.90,
                hinge: .left
            )
            let roomEndWall = PartitionWall(
                start: PlanPoint(x: 0, z: endZ),
                end: PlanPoint(x: corridorMinX, z: endZ)
            )
            let set = Self.frontFurnitureSet(in: bounds)
            let name = "Room \(index + 1)"

            partitions.append(contentsOf: [entranceWall, roomEndWall])
            doors.append(entranceDoor)
            furniture.append(contentsOf: set)
            labels.append(RoomLabel(
                name: Self.labelText(name: name, area: bounds.width * bounds.length),
                position: PlanPoint(x: 1.90, z: startZ + 1.40)
            ))
            rooms.append(Room(
                name: name,
                bounds: bounds,
                entranceWallID: entranceWall.id,
                entranceDoorID: entranceDoor.id,
                furnitureIDs: Set(set.map(\.id))
            ))
        }

        let rearStartZ = core.core.minZ
        let rearEndZ = min(d.roomLength, rearStartZ + Self.rearRoomDepth)
        let rearBounds = PlanRectangle(
            minX: 0,
            maxX: core.core.minX,
            minZ: rearStartZ,
            maxZ: rearEndZ
        )
        let rearEntranceWall = PartitionWall(
            start: PlanPoint(x: core.core.minX, z: rearStartZ),
            end: PlanPoint(x: core.core.minX, z: rearEndZ)
        )
        let rearDoor = DoorOpening(
            wallID: rearEntranceWall.id,
            offset: 1.00,
            width: 0.90,
            hinge: .left
        )
        let rearEndWall = PartitionWall(
            start: PlanPoint(x: 0, z: rearEndZ),
            end: PlanPoint(x: core.core.minX, z: rearEndZ)
        )
        let rearSet = Self.rearFurnitureSet(in: rearBounds)
        let rearName = "Room 7"

        partitions.append(contentsOf: [rearEntranceWall, rearEndWall])
        doors.append(rearDoor)
        furniture.append(contentsOf: rearSet)
        labels.append(RoomLabel(
            name: Self.labelText(name: rearName, area: rearBounds.width * rearBounds.length),
            position: PlanPoint(x: 1.40, z: rearStartZ + 2.45)
        ))
        rooms.append(Room(
            name: rearName,
            bounds: rearBounds,
            entranceWallID: rearEntranceWall.id,
            entranceDoorID: rearDoor.id,
            furnitureIDs: Set(rearSet.map(\.id))
        ))
    }

    private static func frontFurnitureSet(in bounds: PlanRectangle) -> [FurnitureItem] {
        let clearance = Self.furnitureWallClearance
        let wardrobe = FurnitureItem(kind: .twoDoorWardrobe, center: .zero)
        let bed = FurnitureItem(kind: .singleBed, center: .zero, direction: .east)
        let chair = FurnitureItem(kind: .chair, center: .zero)
        let wardrobeCenter = PlanPoint(
            x: bounds.minX + clearance + wardrobe.orientedWidth / 2,
            z: bounds.maxZ - clearance - wardrobe.orientedDepth / 2
        )
        let bedCenter = PlanPoint(
            x: bounds.minX + clearance + bed.orientedWidth / 2,
            z: bounds.minZ + clearance + bed.orientedDepth / 2
        )
        return [
            FurnitureItem(
                kind: .singleBed,
                center: bedCenter,
                direction: .east
            ),
            FurnitureItem(
                kind: .chair,
                center: PlanPoint(
                    x: bedCenter.x + bed.orientedWidth / 2 + 0.15 + chair.orientedWidth / 2,
                    z: bounds.minZ + clearance + chair.orientedDepth / 2
                )
            ),
            FurnitureItem(
                kind: .twoDoorWardrobe,
                center: wardrobeCenter
            )
        ]
    }

    private static func rearFurnitureSet(in bounds: PlanRectangle) -> [FurnitureItem] {
        let clearance = Self.furnitureWallClearance
        let bed = FurnitureItem(kind: .singleBed, center: .zero)
        let wardrobe = FurnitureItem(kind: .twoDoorWardrobe, center: .zero)
        let chair = FurnitureItem(kind: .chair, center: .zero)
        let bedCenter = PlanPoint(
            x: bounds.minX + clearance + bed.orientedWidth / 2,
            z: bounds.minZ + clearance + bed.orientedDepth / 2
        )
        return [
            FurnitureItem(
                kind: .singleBed,
                center: bedCenter
            ),
            FurnitureItem(
                kind: .twoDoorWardrobe,
                center: PlanPoint(
                    x: bounds.minX + clearance + wardrobe.orientedWidth / 2,
                    z: bounds.maxZ - clearance - wardrobe.orientedDepth / 2
                )
            ),
            FurnitureItem(
                kind: .chair,
                center: PlanPoint(
                    x: bedCenter.x + bed.orientedWidth / 2 + 0.15 + chair.orientedWidth / 2,
                    z: bounds.minZ + clearance + chair.orientedDepth / 2
                )
            )
        ]
    }

    private static func labelText(name: String, area: Float) -> String {
        "\(name) · \(area.formatted(.number.precision(.fractionLength(1)))) m²"
    }
}

struct FloorPlan: Codable, Equatable, Sendable {
    var dimensions = SurveyDimensions()
    var partitions: [PartitionWall] = []
    var doors: [DoorOpening] = []
    var furniture: [FurnitureItem] = []
    var roomLabels: [RoomLabel] = []

    init(
        dimensions: SurveyDimensions = SurveyDimensions(),
        partitions: [PartitionWall] = [],
        doors: [DoorOpening] = [],
        furniture: [FurnitureItem] = [],
        roomLabels: [RoomLabel] = []
    ) {
        self.dimensions = dimensions
        self.partitions = partitions
        self.doors = doors
        self.furniture = furniture
        self.roomLabels = roomLabels
    }

    private enum CodingKeys: String, CodingKey {
        case dimensions
        case partitions
        case doors
        case furniture
        case roomLabels
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        dimensions = try container.decode(SurveyDimensions.self, forKey: .dimensions)
        partitions = try container.decodeIfPresent([PartitionWall].self, forKey: .partitions) ?? []
        doors = try container.decodeIfPresent([DoorOpening].self, forKey: .doors) ?? []
        furniture = try container.decodeIfPresent([FurnitureItem].self, forKey: .furniture) ?? []
        roomLabels = try container.decodeIfPresent([RoomLabel].self, forKey: .roomLabels) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dimensions, forKey: .dimensions)
        try container.encode(partitions, forKey: .partitions)
        try container.encode(doors, forKey: .doors)
        try container.encode(furniture, forKey: .furniture)
        try container.encode(roomLabels, forKey: .roomLabels)
    }

    static let initial = FloorPlan()

    static var example: FloorPlan {
        let dimensions = SurveyDimensions()
        let demo = SpaceOptimizedDemoLayout(dimensions: dimensions)
        return FloorPlan(
            dimensions: dimensions,
            partitions: demo.partitions,
            doors: demo.doors,
            furniture: demo.furniture,
            roomLabels: demo.labels
        )
    }

    var totalPartitionLength: Float {
        partitions.reduce(0) { $0 + $1.length }
    }

    mutating func sanitize() {
        dimensions.sanitize()
        partitions = partitions.filter { $0.length >= 0.25 }.map { wall in
            var copy = wall
            copy.start.x = copy.start.x.clamped(to: 0...dimensions.roomWidth)
            copy.end.x = copy.end.x.clamped(to: 0...dimensions.roomWidth)
            copy.start.z = copy.start.z.clamped(to: 0...dimensions.roomLength)
            copy.end.z = copy.end.z.clamped(to: 0...dimensions.roomLength)
            return copy
        }
        let validIDs = Set(partitions.map(\.id))
        doors = doors.filter { door in
            guard validIDs.contains(door.wallID),
                  let wall = partitions.first(where: { $0.id == door.wallID }) else { return false }
            return door.width >= 0.6 && door.offset >= 0 && door.offset + door.width <= wall.length
        }
        furniture = furniture.map { item in
            var copy = item
            copy.sanitize(for: dimensions)
            return copy
        }
        roomLabels = roomLabels.compactMap { label in
            let trimmed = label.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            var copy = label
            copy.name = String(trimmed.prefix(RoomLabel.maximumNameLength))
            copy.position.x = copy.position.x.clamped(to: 0...dimensions.roomWidth)
            copy.position.z = copy.position.z.clamped(to: 0...dimensions.roomLength)
            return copy
        }
    }
}

enum WorkspaceMode: String, CaseIterable, Identifiable {
    case walkthrough = "3D Walkthrough"
    case plan = "2D Plan"

    var id: Self { self }
    var systemImage: String { self == .walkthrough ? "cube.transparent" : "square.grid.3x3" }
}

enum PlanTool: String, CaseIterable, Identifiable {
    case select = "Inspect"
    case wall = "Draw wall"
    case door = "Place door"
    case furniture = "Place furniture"
    case erase = "Erase"

    var id: Self { self }

    var systemImage: String {
        switch self {
        case .select: "arrow.up.left.and.arrow.down.right"
        case .wall: "pencil.and.ruler"
        case .door: "door.left.hand.open"
        case .furniture: "sofa"
        case .erase: "eraser"
        }
    }

    var helpText: String {
        switch self {
        case .select: "Inspect and drag walls, doors, or furniture"
        case .wall: "Draw walls that snap to the configured grid"
        case .door: "Place a 90 cm door on a wall"
        case .furniture: "Place the selected furniture on the floor"
        case .erase: "Erase a wall, door, or furniture item"
        }
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
