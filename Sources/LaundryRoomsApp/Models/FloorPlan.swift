import Foundation

struct PlanPoint: Codable, Equatable, Hashable, Sendable {
    var x: Float
    var z: Float

    static let zero = PlanPoint(x: 0, z: 0)

    func distance(to other: PlanPoint) -> Float {
        hypot(other.x - x, other.z - z)
    }

    func snapped(to grid: Float) -> PlanPoint {
        guard grid > 0 else { return self }
        return PlanPoint(
            x: (x / grid).rounded() * grid,
            z: (z / grid).rounded() * grid
        )
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

struct FloorPlan: Codable, Equatable, Sendable {
    var dimensions = SurveyDimensions()
    var partitions: [PartitionWall] = []
    var doors: [DoorOpening] = []

    static let initial = FloorPlan()

    static var example: FloorPlan {
        let first = PartitionWall(start: PlanPoint(x: 0.15, z: 5.20), end: PlanPoint(x: 2.15, z: 5.20))
        let second = PartitionWall(start: PlanPoint(x: 2.15, z: 5.20), end: PlanPoint(x: 2.15, z: 8.35))
        return FloorPlan(
            dimensions: SurveyDimensions(),
            partitions: [first, second],
            doors: [DoorOpening(wallID: first.id, offset: 0.75)]
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
    case erase = "Erase"

    var id: Self { self }

    var systemImage: String {
        switch self {
        case .select: "arrow.up.left.and.arrow.down.right"
        case .wall: "pencil.and.ruler"
        case .door: "door.left.hand.open"
        case .erase: "eraser"
        }
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
