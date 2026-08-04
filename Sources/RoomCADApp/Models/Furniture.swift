import Foundation

enum FurnitureKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case singleBed
    case squareTable
    case chair
    case twoDoorWardrobe

    var id: Self { self }

    var title: String {
        switch self {
        case .singleBed: "Single bed"
        case .squareTable: "Square table"
        case .chair: "Chair"
        case .twoDoorWardrobe: "Two-door wardrobe"
        }
    }

    var systemImage: String {
        switch self {
        case .singleBed: "bed.double"
        case .squareTable: "table.furniture"
        case .chair: "chair"
        case .twoDoorWardrobe: "cabinet"
        }
    }

    var planLabel: String {
        switch self {
        case .singleBed: "BED"
        case .squareTable: "TABLE"
        case .chair: "C"
        case .twoDoorWardrobe: "WARDROBE"
        }
    }

    /// Unrotated footprint and solid-model height, in metres.
    var dimensions: (width: Float, depth: Float, height: Float) {
        switch self {
        case .singleBed: (0.90, 2.00, 0.90)
        case .squareTable: (0.70, 0.70, 0.75)
        case .chair: (0.45, 0.47, 0.82)
        case .twoDoorWardrobe: (1.00, 0.60, 2.00)
        }
    }

    var footprintLabel: String {
        "\(dimensions.width.formattedCentimeters) × \(dimensions.depth.formattedCentimeters)"
    }
}

enum CardinalDirection: Int, Codable, CaseIterable, Sendable {
    case north = 0
    case east = 1
    case south = 2
    case west = 3

    var next: CardinalDirection {
        CardinalDirection(rawValue: (rawValue + 1) % Self.allCases.count) ?? .north
    }

    var title: String {
        switch self {
        case .north: "North"
        case .east: "East"
        case .south: "South"
        case .west: "West"
        }
    }

    var planSymbol: String {
        switch self {
        case .north: "N↑"
        case .east: "E→"
        case .south: "S↓"
        case .west: "W←"
        }
    }

    var yawRadians: Float { Float(rawValue) * .pi / 2 }
    var swapsFootprintAxes: Bool { self == .east || self == .west }
}

struct FurnitureItem: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var kind: FurnitureKind
    var center: PlanPoint
    var direction: CardinalDirection = .north

    var orientedWidth: Float {
        direction.swapsFootprintAxes ? kind.dimensions.depth : kind.dimensions.width
    }

    var orientedDepth: Float {
        direction.swapsFootprintAxes ? kind.dimensions.width : kind.dimensions.depth
    }

    var footprint: PlanRectangle {
        PlanRectangle(
            minX: center.x - orientedWidth / 2,
            maxX: center.x + orientedWidth / 2,
            minZ: center.z - orientedDepth / 2,
            maxZ: center.z + orientedDepth / 2
        )
    }

    func contains(_ point: PlanPoint, tolerance: Float = 0) -> Bool {
        let bounds = footprint
        return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance
            && point.z >= bounds.minZ - tolerance && point.z <= bounds.maxZ + tolerance
    }

    mutating func clampToRoom(_ dimensions: SurveyDimensions) {
        center.x = center.x.clamped(to: orientedWidth / 2...(dimensions.roomWidth - orientedWidth / 2))
        center.z = center.z.clamped(to: orientedDepth / 2...(dimensions.roomLength - orientedDepth / 2))
    }

    func isOnUsableFloor(_ dimensions: SurveyDimensions) -> Bool {
        let bounds = footprint
        guard bounds.minX >= 0, bounds.maxX <= dimensions.roomWidth,
              bounds.minZ >= 0, bounds.maxZ <= dimensions.roomLength else { return false }

        let fixed = StairBathroomLayout(dimensions: dimensions)
        return !bounds.intersects(fixed.bathroom)
            && !bounds.intersects(fixed.upperFlight)
            && !bounds.intersects(fixed.lowerOpening)
    }

    mutating func sanitize(for dimensions: SurveyDimensions) {
        clampToRoom(dimensions)
        guard !isOnUsableFloor(dimensions) else { return }

        // All non-floor fixed geometry is in the rear six-metre core. Move an
        // invalid restored item just in front of it rather than allowing it to
        // float over the stair opening or deleting user data.
        let fixed = StairBathroomLayout(dimensions: dimensions)
        center.z = fixed.core.minZ - orientedDepth / 2 - 0.10
        clampToRoom(dimensions)
    }
}

extension PlanRectangle {
    func intersects(_ other: PlanRectangle) -> Bool {
        minX < other.maxX && maxX > other.minX && minZ < other.maxZ && maxZ > other.minZ
    }
}
