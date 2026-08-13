import Foundation

// MARK: - Points

struct PlanPoint: Codable, Equatable, Sendable {
    var x: Double
    var z: Double

    static let zero = PlanPoint(x: 0, z: 0)

    func distance(to other: PlanPoint) -> Double {
        hypot(other.x - x, other.z - z)
    }

    static func + (lhs: PlanPoint, rhs: PlanPoint) -> PlanPoint {
        PlanPoint(x: lhs.x + rhs.x, z: lhs.z + rhs.z)
    }

    static func - (lhs: PlanPoint, rhs: PlanPoint) -> PlanPoint {
        PlanPoint(x: lhs.x - rhs.x, z: lhs.z - rhs.z)
    }

    static func * (lhs: PlanPoint, rhs: Double) -> PlanPoint {
        PlanPoint(x: lhs.x * rhs, z: lhs.z * rhs)
    }

    func clamped(x xRange: ClosedRange<Double>, z zRange: ClosedRange<Double>) -> PlanPoint {
        PlanPoint(x: x.clamped(to: xRange), z: z.clamped(to: zRange))
    }
}

// MARK: - Grid

enum GridStep: String, Codable, CaseIterable, Identifiable, Sendable {
    case oneCentimeter
    case twoCentimeters
    case fiveCentimeters

    var id: Self { self }

    var meters: Double {
        switch self {
        case .oneCentimeter: 0.01
        case .twoCentimeters: 0.02
        case .fiveCentimeters: 0.05
        }
    }

    var label: String {
        switch self {
        case .oneCentimeter: "1 cm"
        case .twoCentimeters: "2 cm"
        case .fiveCentimeters: "5 cm"
        }
    }
}

// MARK: - Walls and openings

struct Wall: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var start: PlanPoint
    var end: PlanPoint

    var length: Double { start.distance(to: end) }

    /// Unit vector pointing from start toward end.
    var direction: PlanPoint {
        let delta = end - start
        let length = max(delta.distance(to: .zero), 0.0001)
        return delta * (1 / length)
    }

    /// Unit vector perpendicular to the wall (rotated 90° counterclockwise).
    var perpendicular: PlanPoint {
        let d = direction
        return PlanPoint(x: -d.z, z: d.x)
    }

    var midpoint: PlanPoint {
        PlanPoint(x: (start.x + end.x) / 2, z: (start.z + end.z) / 2)
    }

    func point(atOffset offset: Double) -> PlanPoint {
        start + direction * offset.clamped(to: 0...length)
    }

    /// Projection of a point onto the segment: closest point, its distance
    /// along the wall from the start, and the perpendicular distance.
    func projection(of point: PlanPoint) -> (point: PlanPoint, offset: Double, distance: Double) {
        let dx = end.x - start.x
        let dz = end.z - start.z
        let lengthSquared = dx * dx + dz * dz
        guard lengthSquared > 0.0001 else { return (start, 0, start.distance(to: point)) }
        let rawT = ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared
        let t = rawT.clamped(to: 0...1)
        let projected = PlanPoint(x: start.x + dx * t, z: start.z + dz * t)
        return (projected, length * t, projected.distance(to: point))
    }

    func translated(by delta: PlanPoint, clampedTo width: Double, length roomLength: Double) -> Wall {
        var wall = self
        wall.start = (start + delta).clamped(x: 0...width, z: 0...roomLength)
        wall.end = (end + delta).clamped(x: 0...width, z: 0...roomLength)
        return wall
    }
}

enum WallPart: Sendable {
    case start
    case end
}

enum OpeningKind: String, Codable, Sendable {
    case door
    case window
}

struct DoorOpening: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var wallID: UUID
    var offset: Double = 0
    var width: Double = 0.90
}

struct WindowOpening: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var wallID: UUID
    var offset: Double = 0
    var width: Double = 1.00
}

// MARK: - Furniture

enum FurnitureKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case bed
    case table
    case chair
    case wardrobe

    var id: Self { self }

    var title: String {
        switch self {
        case .bed: "Bed"
        case .table: "Table"
        case .chair: "Chair"
        case .wardrobe: "Wardrobe"
        }
    }

    var systemImage: String {
        switch self {
        case .bed: "bed.double"
        case .table: "table.furniture"
        case .chair: "chair.lounge"
        case .wardrobe: "cabinet"
        }
    }

    /// Unrotated footprint (width, depth) and solid height, in metres.
    var dimensions: (width: Double, depth: Double, height: Double) {
        switch self {
        case .bed: (0.90, 2.00, 0.90)
        case .table: (0.70, 0.70, 0.75)
        case .chair: (0.45, 0.47, 0.82)
        case .wardrobe: (1.00, 0.60, 2.00)
        }
    }

    /// Friendly 3D color.
    var color: (red: Double, green: Double, blue: Double) {
        switch self {
        case .bed: (0.30, 0.65, 0.85)
        case .table: (0.95, 0.72, 0.22)
        case .chair: (0.90, 0.38, 0.32)
        case .wardrobe: (0.82, 0.52, 0.28)
        }
    }

    var planLabel: String {
        switch self {
        case .bed: "BED"
        case .table: "TABLE"
        case .chair: "CHAIR"
        case .wardrobe: "WARDROBE"
        }
    }
}

struct FurnitureItem: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var kind: FurnitureKind
    var center: PlanPoint
    /// Always a multiple of 90 degrees.
    var rotationDegrees: Double = 0

    var orientedWidth: Double {
        rotationDegrees == 90 || rotationDegrees == 270 ? kind.dimensions.depth : kind.dimensions.width
    }

    var orientedDepth: Double {
        rotationDegrees == 90 || rotationDegrees == 270 ? kind.dimensions.width : kind.dimensions.depth
    }

    var footprint: PlanRectangle {
        PlanRectangle(
            minX: center.x - orientedWidth / 2,
            maxX: center.x + orientedWidth / 2,
            minZ: center.z - orientedDepth / 2,
            maxZ: center.z + orientedDepth / 2
        )
    }

    func contains(_ point: PlanPoint, tolerance: Double = 0) -> Bool {
        let bounds = footprint
        return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance
            && point.z >= bounds.minZ - tolerance && point.z <= bounds.maxZ + tolerance
    }
}

struct PlanRectangle: Equatable, Sendable {
    var minX: Double
    var maxX: Double
    var minZ: Double
    var maxZ: Double

    var width: Double { maxX - minX }
    var length: Double { maxZ - minZ }
    var centerX: Double { (minX + maxX) / 2 }
    var centerZ: Double { (minZ + maxZ) / 2 }

    func contains(_ point: PlanPoint) -> Bool {
        point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ
    }

    func intersects(_ other: PlanRectangle) -> Bool {
        minX < other.maxX && maxX > other.minX && minZ < other.maxZ && maxZ > other.minZ
    }

    func expanded(by amount: Double) -> PlanRectangle {
        PlanRectangle(
            minX: minX - amount,
            maxX: maxX + amount,
            minZ: minZ - amount,
            maxZ: maxZ + amount
        )
    }
}

// MARK: - Room

struct RoomPlan: Codable, Equatable, Sendable {
    static let defaultWidth: Double = 6.00
    static let defaultLength: Double = 4.00
    static let defaultHeight: Double = 2.60
    static let minimumWallLength: Double = 0.30

    var id: UUID = UUID()
    var name: String = "My Room"
    var width: Double = RoomPlan.defaultWidth
    var length: Double = RoomPlan.defaultLength
    var height: Double = RoomPlan.defaultHeight
    var grid: GridStep = .fiveCentimeters
    var walls: [Wall] = []
    var doors: [DoorOpening] = []
    var windows: [WindowOpening] = []
    var furniture: [FurnitureItem] = []

    init() {}

    /// A fresh room already has its four outer walls, so the 3D walk works
    /// from the very first launch.
    static func fresh(name: String = "My Room", width: Double = defaultWidth, length: Double = defaultLength) -> RoomPlan {
        var room = RoomPlan()
        room.name = name
        room.width = width
        room.length = length
        room.walls = [
            Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: width, z: 0)),
            Wall(start: PlanPoint(x: width, z: 0), end: PlanPoint(x: width, z: length)),
            Wall(start: PlanPoint(x: width, z: length), end: PlanPoint(x: 0, z: length)),
            Wall(start: PlanPoint(x: 0, z: length), end: PlanPoint(x: 0, z: 0))
        ]
        return room
    }

    // MARK: Snapping

    /// Snaps a raw point onto the active grid.
    func gridSnap(_ point: PlanPoint) -> PlanPoint {
        let step = max(grid.meters, 0.001)
        func snap(_ value: Double) -> Double {
            let stepped = (value / step).rounded() * step
            // Clean up floating-point noise so snapped values are exact.
            return (stepped * 1000).rounded() / 1000
        }
        return PlanPoint(
            x: snap(point.x).clamped(to: 0...width),
            z: snap(point.z).clamped(to: 0...length)
        )
    }

    /// Smart snap: grid plus room corners and wall endpoints/midpoints.
    func snapPoint(_ raw: PlanPoint, excludingWallID: UUID? = nil) -> PlanPoint {
        let raw = raw.clamped(x: 0...width, z: 0...length)
        var candidates: [(point: PlanPoint, distance: Double)] = [
            (PlanPoint(x: 0, z: 0), raw.distance(to: PlanPoint(x: 0, z: 0))),
            (PlanPoint(x: width, z: 0), raw.distance(to: PlanPoint(x: width, z: 0))),
            (PlanPoint(x: 0, z: length), raw.distance(to: PlanPoint(x: 0, z: length))),
            (PlanPoint(x: width, z: length), raw.distance(to: PlanPoint(x: width, z: length)))
        ]
        for wall in walls where wall.id != excludingWallID {
            candidates.append((wall.start, raw.distance(to: wall.start)))
            candidates.append((wall.end, raw.distance(to: wall.end)))
            candidates.append((wall.midpoint, raw.distance(to: wall.midpoint)))
        }
        let tolerance = max(0.12, grid.meters * 1.5)
        if let best = candidates.min(by: { $0.distance < $1.distance }), best.distance <= tolerance {
            return best.point
        }
        return gridSnap(raw)
    }

    // MARK: Hit testing

    func wall(near point: PlanPoint, tolerance: Double = 0.35) -> Wall? {
        walls
            .map { ($0, $0.projection(of: point).distance) }
            .filter { $0.1 <= tolerance }
            .min { $0.1 < $1.1 }?.0
    }

    /// Nearest wall for placing a door or window.
    func wall(forPlacementAt point: PlanPoint, tolerance: Double = 0.50) -> (wall: Wall, offset: Double)? {
        walls
            .map { ($0, $0.projection(of: point)) }
            .filter { $0.1.distance <= tolerance }
            .min { $0.1.distance < $1.1.distance }
            .map { (wall: $0.0, offset: $0.1.offset) }
    }

    func opening(near point: PlanPoint, tolerance: Double = 0.30) -> (kind: OpeningKind, id: UUID, wallID: UUID, center: PlanPoint)? {
        var best: (kind: OpeningKind, id: UUID, wallID: UUID, center: PlanPoint, distance: Double)?
        func consider(kind: OpeningKind, id: UUID, wallID: UUID, offset: Double, width: Double) {
            guard let wall = walls.first(where: { $0.id == wallID }) else { return }
            let center = wall.point(atOffset: offset + width / 2)
            let distance = center.distance(to: point)
            if best == nil || distance < best!.distance {
                best = (kind, id, wallID, center, distance)
            }
        }
        for door in doors {
            consider(kind: .door, id: door.id, wallID: door.wallID, offset: door.offset, width: door.width)
        }
        for window in windows {
            consider(kind: .window, id: window.id, wallID: window.wallID, offset: window.offset, width: window.width)
        }
        guard let best, best.distance <= tolerance else { return nil }
        return (best.kind, best.id, best.wallID, best.center)
    }

    func furniture(near point: PlanPoint, tolerance: Double = 0.08) -> FurnitureItem? {
        furniture.last { $0.contains(point, tolerance: tolerance) }
    }

    func door(id: UUID) -> DoorOpening? {
        doors.first { $0.id == id }
    }

    func window(id: UUID) -> WindowOpening? {
        windows.first { $0.id == id }
    }

    // MARK: Furniture placement

    func isFurniturePlacementValid(_ item: FurnitureItem, excluding excludedIDs: Set<UUID> = []) -> Bool {
        let bounds = item.footprint
        guard bounds.minX >= 0, bounds.maxX <= width,
              bounds.minZ >= 0, bounds.maxZ <= length else { return false }
        return !furniture.contains { !excludedIDs.contains($0.id) && $0.footprint.intersects(item.footprint) }
    }

    /// Snaps a furniture center to the grid, keeps it inside the room, and
    /// aligns it with neighboring furniture centers when they are close.
    func furnitureCenter(near raw: PlanPoint, for item: FurnitureItem) -> PlanPoint {
        var center = gridSnap(raw)
        center = center.clamped(
            x: item.orientedWidth / 2...(width - item.orientedWidth / 2),
            z: item.orientedDepth / 2...(length - item.orientedDepth / 2)
        )
        let tolerance = max(grid.meters * 1.5, 0.08)
        if let x = furniture
            .filter({ $0.id != item.id })
            .map(\.center.x)
            .filter({ abs($0 - center.x) <= tolerance })
            .min(by: { abs($0 - center.x) < abs($1 - center.x) }) {
            center.x = x
        }
        if let z = furniture
            .filter({ $0.id != item.id })
            .map(\.center.z)
            .filter({ abs($0 - center.z) <= tolerance })
            .min(by: { abs($0 - center.z) < abs($1 - center.z) }) {
            center.z = z
        }
        return center
    }

    // MARK: Sanitizing

    mutating func sanitize() {
        width = width.clamped(to: 2...20)
        length = length.clamped(to: 2...20)
        height = height.clamped(to: 2.2...5)

        walls = walls
            .filter { $0.length >= 0.15 }
            .map { wall in
                var copy = wall
                copy.start = copy.start.clamped(x: 0...width, z: 0...length)
                copy.end = copy.end.clamped(x: 0...width, z: 0...length)
                return copy
            }
        let wallIDs = Set(walls.map(\.id))

        doors = doors
            .map { door in
                var copy = door
                copy.width = copy.width.clamped(to: 0.60...1.40)
                return copy
            }
            .filter { door in
                guard wallIDs.contains(door.wallID),
                      let wall = walls.first(where: { $0.id == door.wallID }) else { return false }
                return wall.length >= door.width + 0.20
            }
        for index in doors.indices {
            if let wall = walls.first(where: { $0.id == doors[index].wallID }) {
                doors[index].offset = doors[index].offset.clamped(
                    to: 0.10...(wall.length - doors[index].width - 0.10)
                )
            }
        }

        windows = windows
            .map { window in
                var copy = window
                copy.width = copy.width.clamped(to: 0.40...2.00)
                return copy
            }
            .filter { window in
                guard wallIDs.contains(window.wallID),
                      let wall = walls.first(where: { $0.id == window.wallID }) else { return false }
                return wall.length >= window.width + 0.20
            }
        for index in windows.indices {
            if let wall = walls.first(where: { $0.id == windows[index].wallID }) {
                windows[index].offset = windows[index].offset.clamped(
                    to: 0.10...(wall.length - windows[index].width - 0.10)
                )
            }
        }

        furniture = furniture.map { item in
            var copy = item
            copy.rotationDegrees = ((copy.rotationDegrees / 90).rounded() * 90)
                .truncatingRemainder(dividingBy: 360)
            copy.center = copy.center.clamped(
                x: copy.orientedWidth / 2...(width - copy.orientedWidth / 2),
                z: copy.orientedDepth / 2...(length - copy.orientedDepth / 2)
            )
            return copy
        }
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

extension Double {
    var formattedMeters: String {
        formatted(.number.precision(.fractionLength(2))) + " m"
    }

    var formattedCentimeters: String {
        (self * 100).formatted(.number.precision(.fractionLength(0))) + " cm"
    }
}
