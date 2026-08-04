import Foundation
import UniformTypeIdentifiers

extension UTType {
    static let roomCADDesign = UTType(
        exportedAs: RoomCADFile.formatIdentifier,
        conformingTo: .json
    )
}

enum RoomCADDocumentError: LocalizedError, Equatable, Sendable {
    case fileTooLarge
    case invalidDocument
    case unsupportedVersion(Int)
    case unsupportedUnits(String)
    case duplicateObjectIdentifiers

    var errorDescription: String? {
        switch self {
        case .fileTooLarge:
            "This design is larger than RoomCAD's 50 MB safety limit."
        case .invalidDocument:
            "This file is not a valid RoomCAD design or legacy RoomCAD JSON export."
        case let .unsupportedVersion(version):
            "This design uses RoomCAD format version \(version), which this version of RoomCAD doesn't support."
        case let .unsupportedUnits(units):
            "This design uses unsupported units (\(units)). RoomCAD designs must use metres."
        case .duplicateObjectIdentifiers:
            "This design contains duplicate object identifiers and cannot be opened safely."
        }
    }
}

/// Stable, versioned representation of a user-owned RoomCAD design.
///
/// `FloorPlan` remains the in-memory editing model and Application Support
/// recovery payload. User files use this envelope so future versions can
/// migrate the schema deliberately without guessing which model was encoded.
struct RoomCADFile: Codable, Equatable, Sendable {
    static let formatIdentifier = "com.maria.roomcad.design"
    static let currentFormatVersion = 1
    static let fileExtension = "roomcad"
    static let maximumFileSize = 50 * 1_024 * 1_024

    var formatIdentifier: String
    var formatVersion: Int
    var units: String
    var createdAt: Date
    var savedAt: Date
    var plan: FloorPlan

    init(plan: FloorPlan, createdAt: Date = Date(), savedAt: Date = Date()) {
        formatIdentifier = Self.formatIdentifier
        formatVersion = Self.currentFormatVersion
        units = "metres"
        self.createdAt = createdAt
        self.savedAt = savedAt
        self.plan = plan
    }

    struct Decoded: Sendable {
        var plan: FloorPlan
        var createdAt: Date
        var savedAt: Date?
        var isLegacyJSON: Bool
        var repairedInvalidObjects: Bool
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }

    static func decode(_ data: Data) throws -> Decoded {
        guard data.count <= maximumFileSize else {
            throw RoomCADDocumentError.fileTooLarge
        }

        let jsonObject = try? JSONSerialization.jsonObject(with: data)
        let topLevel = jsonObject as? [String: Any]
        let hasDocumentEnvelope = topLevel?["formatIdentifier"] != nil
            || topLevel?["formatVersion"] != nil

        if hasDocumentEnvelope {
            if let version = topLevel?["formatVersion"] as? Int,
               version > currentFormatVersion {
                throw RoomCADDocumentError.unsupportedVersion(version)
            }

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            guard let file = try? decoder.decode(Self.self, from: data),
                  file.formatIdentifier == formatIdentifier else {
                throw RoomCADDocumentError.invalidDocument
            }
            guard file.formatVersion == currentFormatVersion else {
                throw RoomCADDocumentError.unsupportedVersion(file.formatVersion)
            }
            guard file.units == "metres" else {
                throw RoomCADDocumentError.unsupportedUnits(file.units)
            }
            try validateUniqueIdentifiers(in: file.plan)
            var plan = file.plan
            plan.sanitize()
            return Decoded(
                plan: plan,
                createdAt: file.createdAt,
                savedAt: file.savedAt,
                isLegacyJSON: false,
                repairedInvalidObjects: plan != file.plan
            )
        }

        guard let legacyPlan = try? JSONDecoder().decode(FloorPlan.self, from: data) else {
            throw RoomCADDocumentError.invalidDocument
        }
        try validateUniqueIdentifiers(in: legacyPlan)
        var plan = legacyPlan
        plan.sanitize()
        return Decoded(
            plan: plan,
            createdAt: Date(),
            savedAt: nil,
            isLegacyJSON: true,
            repairedInvalidObjects: plan != legacyPlan
        )
    }

    private static func validateUniqueIdentifiers(in plan: FloorPlan) throws {
        func hasUniqueIDs<T: Identifiable>(_ values: [T]) -> Bool where T.ID == UUID {
            Set(values.map(\.id)).count == values.count
        }

        guard hasUniqueIDs(plan.partitions),
              hasUniqueIDs(plan.doors),
              hasUniqueIDs(plan.furniture),
              hasUniqueIDs(plan.roomLabels) else {
            throw RoomCADDocumentError.duplicateObjectIdentifiers
        }
    }
}
