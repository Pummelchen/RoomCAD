import Foundation

// MARK: - Opening spacing (the cm indicators)

struct OpeningSpacing: Equatable, Sendable {
    var toWallStart: Double
    var toWallEnd: Double
    var gapToPrevious: Double?
    var gapToNext: Double?

    var hasNeighborGaps: Bool {
        gapToPrevious != nil || gapToNext != nil
    }
}

extension RoomPlan {
    /// Distances from an opening to the wall ends and to its neighbors on the
    /// same wall. Used by the inspector readouts and the canvas measurement
    /// labels while an opening is being slid.
    func spacing(forOpeningWith id: UUID, kind: OpeningKind) -> OpeningSpacing? {
        let wallID: UUID
        let offset: Double
        let width: Double
        switch kind {
        case .door:
            guard let door = door(id: id) else { return nil }
            wallID = door.wallID
            offset = door.offset
            width = door.width
        case .window:
            guard let window = window(id: id) else { return nil }
            wallID = window.wallID
            offset = window.offset
            width = window.width
        }
        guard let wall = walls.first(where: { $0.id == wallID }) else { return nil }

        let others: [(offset: Double, width: Double)] = doors
            .filter { $0.wallID == wallID && $0.id != id }
            .map { (offset: $0.offset, width: $0.width) }
            + windows
                .filter { $0.wallID == wallID && $0.id != id }
                .map { (offset: $0.offset, width: $0.width) }

        let previous = others
            .filter { $0.offset + $0.width <= offset }
            .max { $0.offset < $1.offset }
        let next = others
            .filter { $0.offset >= offset + width }
            .min { $0.offset < $1.offset }

        return OpeningSpacing(
            toWallStart: offset,
            toWallEnd: wall.length - offset - width,
            gapToPrevious: previous.map { offset - ($0.offset + $0.width) },
            gapToNext: next.map { $0.offset - (offset + width) }
        )
    }

    /// The wall an opening is attached to.
    func openingWall(id: UUID, kind: OpeningKind) -> Wall? {
        let wallID: UUID?
        switch kind {
        case .door: wallID = door(id: id)?.wallID
        case .window: wallID = window(id: id)?.wallID
        }
        guard let wallID else { return nil }
        return walls.first { $0.id == wallID }
    }

    /// An offset an opening may slide to, keeping a 10 cm safety gap at both
    /// wall ends.
    func clampedOpeningOffset(_ offset: Double, width: Double, wallID: UUID) -> Double? {
        guard let wall = walls.first(where: { $0.id == wallID }) else { return nil }
        return offset.clamped(to: 0.10...(wall.length - width - 0.10))
    }
}

// MARK: - Wall slicing for the 3D view

/// A piece of wall measured along its own length, from `from` to `to` metres
/// from the wall start.
struct WallSpan: Equatable, Sendable {
    var from: Double
    var to: Double

    var length: Double { to - from }
}

/// Pure geometry that turns a wall with openings into solid and glass spans.
/// Doors reach the floor; windows have a sill, glass, and a solid strip above.
struct WallBuildPlan: Equatable, Sendable {
    static let sillHeight: Double = 0.90
    static let glassHeight: Double = 1.00
    static let doorHeight: Double = 2.10
    static let wallThickness: Double = 0.10

    var wall: Wall
    var doorSpans: [WallSpan]
    var windowSpans: [WallSpan]
    /// Solid below the sill; door spans are cut through to the floor.
    var baseSpans: [WallSpan]
    /// Solid between sill top and door top; both door and window spans cut it.
    var midSpans: [WallSpan]
    /// Glass boxes at window spans.
    var glassSpans: [WallSpan]
    /// Solid strip above each window's glass, up to the door top.
    var stripSpans: [WallSpan]
    /// Solid header across the whole wall, from door top to the ceiling.
    var headerSpan: WallSpan
    /// Thin door leaves standing in the door spans.
    var doorLeafSpans: [WallSpan]

    init(wall: Wall, doors: [DoorOpening], windows: [WindowOpening], height: Double) {
        self.wall = wall
        doorSpans = doors
            .filter { $0.wallID == wall.id }
            .sorted { $0.offset < $1.offset }
            .map { WallSpan(from: $0.offset, to: $0.offset + $0.width) }
        windowSpans = windows
            .filter { $0.wallID == wall.id }
            .sorted { $0.offset < $1.offset }
            .map { WallSpan(from: $0.offset, to: $0.offset + $0.width) }

        baseSpans = Self.solidSpans(length: wall.length, cuts: doorSpans)
        midSpans = Self.solidSpans(length: wall.length, cuts: doorSpans + windowSpans)
        glassSpans = windowSpans
        stripSpans = windowSpans
        headerSpan = WallSpan(from: 0, to: wall.length)
        doorLeafSpans = doorSpans
    }

    /// Splits `0...length` into the solid pieces left after removing `cuts`.
    static func solidSpans(length: Double, cuts: [WallSpan]) -> [WallSpan] {
        var spans: [WallSpan] = []
        var cursor = 0.0
        for cut in cuts {
            let from = max(cut.from, cursor)
            let to = min(cut.to, length)
            if from > cursor {
                spans.append(WallSpan(from: cursor, to: min(from, length)))
            }
            cursor = max(cursor, to)
        }
        if cursor < length {
            spans.append(WallSpan(from: cursor, to: length))
        }
        return spans
    }
}

// MARK: - Walkthrough collision

extension RoomPlan {
    /// True when a player circle of the given radius centered at `point`
    /// touches a wall or furniture item.
    func blocksPlayer(at point: PlanPoint, radius: Double) -> Bool {
        let halfThickness = WallBuildPlan.wallThickness / 2 + 0.02
        for wall in walls {
            if wall.projection(of: point).distance <= radius + halfThickness {
                return true
            }
        }
        for item in furniture {
            if item.footprint.expanded(by: radius).contains(point) {
                return true
            }
        }
        return false
    }
}
