import Foundation

enum WallEditPart: Sendable {
    case start
    case end
    case body
}

struct PlanSnapResult: Equatable, Sendable {
    var point: PlanPoint
    var label: String?
}

struct LayoutSnapshot: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var name: String
    var createdAt: Date = Date()
    var plan: FloorPlan
}

extension PlanPoint {
    static func + (lhs: PlanPoint, rhs: PlanPoint) -> PlanPoint {
        PlanPoint(x: lhs.x + rhs.x, z: lhs.z + rhs.z)
    }

    static func - (lhs: PlanPoint, rhs: PlanPoint) -> PlanPoint {
        PlanPoint(x: lhs.x - rhs.x, z: lhs.z - rhs.z)
    }

    static func * (lhs: PlanPoint, rhs: Float) -> PlanPoint {
        PlanPoint(x: lhs.x * rhs, z: lhs.z * rhs)
    }

    func clamped(to dimensions: SurveyDimensions) -> PlanPoint {
        PlanPoint(
            x: x.clamped(to: 0...dimensions.roomWidth),
            z: z.clamped(to: 0...dimensions.roomLength)
        )
    }
}

extension PartitionWall {
    var angleDegrees: Float {
        var degrees = atan2(end.z - start.z, end.x - start.x) * 180 / .pi
        if degrees < 0 { degrees += 360 }
        return degrees
    }

    var midpoint: PlanPoint {
        PlanPoint(x: (start.x + end.x) / 2, z: (start.z + end.z) / 2)
    }
}

extension PlanRectangle {
    func union(_ other: PlanRectangle) -> PlanRectangle {
        PlanRectangle(
            minX: min(minX, other.minX),
            maxX: max(maxX, other.maxX),
            minZ: min(minZ, other.minZ),
            maxZ: max(maxZ, other.maxZ)
        )
    }

    func expanded(by amount: Float) -> PlanRectangle {
        PlanRectangle(
            minX: minX - amount,
            maxX: maxX + amount,
            minZ: minZ - amount,
            maxZ: maxZ + amount
        )
    }
}

extension FloorPlan {
    func smartSnap(
        _ rawPoint: PlanPoint,
        anchor: PlanPoint? = nil,
        excludingWallID: UUID? = nil,
        lockAngles: Bool = false
    ) -> PlanSnapResult {
        let walls = partitions.filter { $0.id != excludingWallID }
        let raw = rawPoint.clamped(to: dimensions)
        var directional = raw
        var directionalLabel: String?

        if let anchor {
            let dx = raw.x - anchor.x
            let dz = raw.z - anchor.z
            let distance = max(0.001, hypot(dx, dz))
            let rawAngle = atan2(dz, dx)
            var snappedAngle: Float?

            if lockAngles {
                snappedAngle = (rawAngle / (.pi / 4)).rounded() * (.pi / 4)
                directionalLabel = "45° angle lock"
            } else {
                let tolerance = Float(6 * Double.pi / 180)
                let candidateAngles = walls.flatMap { wall -> [Float] in
                    let angle = atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x)
                    return [angle, angle + .pi / 2]
                }
                if let closest = candidateAngles.min(by: {
                    Self.angularDistance(rawAngle, $0) < Self.angularDistance(rawAngle, $1)
                }), Self.angularDistance(rawAngle, closest) <= tolerance {
                    snappedAngle = closest
                    directionalLabel = "Parallel / perpendicular"
                }
            }

            if let snappedAngle {
                directional = PlanPoint(
                    x: anchor.x + cos(snappedAngle) * distance,
                    z: anchor.z + sin(snappedAngle) * distance
                ).clamped(to: dimensions)
            }
        }

        var namedCandidates: [(PlanPoint, String)] = [
            (PlanPoint(x: 0, z: 0), "Room corner"),
            (PlanPoint(x: dimensions.roomWidth, z: 0), "Room corner"),
            (PlanPoint(x: 0, z: dimensions.roomLength), "Room corner"),
            (PlanPoint(x: dimensions.roomWidth, z: dimensions.roomLength), "Room corner")
        ]
        for wall in walls {
            namedCandidates.append((wall.start, "Wall endpoint"))
            namedCandidates.append((wall.end, "Wall endpoint"))
            namedCandidates.append((wall.midpoint, "Wall midpoint"))
        }
        for firstIndex in walls.indices {
            for secondIndex in walls.indices where secondIndex > firstIndex {
                if let intersection = Self.segmentIntersection(walls[firstIndex], walls[secondIndex]) {
                    namedCandidates.append((intersection, "Wall intersection"))
                }
            }
        }

        let tolerance = max(0.12, dimensions.gridSpacing * 1.5)
        if let candidate = namedCandidates
            .map({ ($0.0, $0.1, $0.0.distance(to: directional)) })
            .filter({ $0.2 <= tolerance })
            .min(by: { $0.2 < $1.2 }) {
            return PlanSnapResult(point: candidate.0, label: candidate.1)
        }

        if directionalLabel != nil {
            return PlanSnapResult(point: directional, label: directionalLabel)
        }
        return PlanSnapResult(point: dimensions.snapped(directional), label: "Grid")
    }

    func boundsForSelection(
        wallID: UUID?,
        doorID: UUID?,
        furnitureIDs: Set<UUID>
    ) -> PlanRectangle? {
        var bounds: PlanRectangle?
        func include(_ rectangle: PlanRectangle) {
            bounds = bounds?.union(rectangle) ?? rectangle
        }

        if let wallID, let wall = partitions.first(where: { $0.id == wallID }) {
            include(PlanRectangle(
                minX: min(wall.start.x, wall.end.x),
                maxX: max(wall.start.x, wall.end.x),
                minZ: min(wall.start.z, wall.end.z),
                maxZ: max(wall.start.z, wall.end.z)
            ).expanded(by: 0.35))
        }
        if let doorID,
           let door = doors.first(where: { $0.id == doorID }),
           let wall = partitions.first(where: { $0.id == door.wallID }) {
            let startT = door.offset / max(wall.length, 0.001)
            let endT = (door.offset + door.width) / max(wall.length, 0.001)
            let first = PlanPoint(
                x: wall.start.x + (wall.end.x - wall.start.x) * startT,
                z: wall.start.z + (wall.end.z - wall.start.z) * startT
            )
            let second = PlanPoint(
                x: wall.start.x + (wall.end.x - wall.start.x) * endT,
                z: wall.start.z + (wall.end.z - wall.start.z) * endT
            )
            include(PlanRectangle(
                minX: min(first.x, second.x), maxX: max(first.x, second.x),
                minZ: min(first.z, second.z), maxZ: max(first.z, second.z)
            ).expanded(by: 0.50))
        }
        for item in furniture where furnitureIDs.contains(item.id) {
            include(item.footprint.expanded(by: 0.35))
        }
        return bounds
    }

    private static func angularDistance(_ first: Float, _ second: Float) -> Float {
        let fullTurn = Float.pi * 2
        let difference = abs((first - second).truncatingRemainder(dividingBy: fullTurn))
        return min(difference, fullTurn - difference)
    }

    private static func segmentIntersection(_ first: PartitionWall, _ second: PartitionWall) -> PlanPoint? {
        let p = first.start
        let r = first.end - first.start
        let q = second.start
        let s = second.end - second.start
        let cross = r.x * s.z - r.z * s.x
        guard abs(cross) > 0.0001 else { return nil }
        let qMinusP = q - p
        let t = (qMinusP.x * s.z - qMinusP.z * s.x) / cross
        let u = (qMinusP.x * r.z - qMinusP.z * r.x) / cross
        guard (0...1).contains(t), (0...1).contains(u) else { return nil }
        return p + r * t
    }
}
