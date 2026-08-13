import Foundation
import UniformTypeIdentifiers

extension UTType {
    static let roomCADV2Room = UTType(
        exportedAs: "com.maria.roomcad-v2.room",
        conformingTo: .json
    )
}

enum RoomFileError: LocalizedError, Sendable {
    case invalidDocument
    case unsupportedVersion(Int)

    var errorDescription: String? {
        switch self {
        case .invalidDocument:
            "This file is not a RoomCAD V2 room design."
        case let .unsupportedVersion(version):
            "This room uses format version \(version), which this version of RoomCAD can't open."
        }
    }
}

/// Small, versioned JSON envelope for one saved room. Each room is its own
/// `.room` file, so editing multiple rooms is just opening another file.
struct RoomFile: Codable, Equatable, Sendable {
    static let formatIdentifier = "com.maria.roomcad-v2.room"
    static let currentVersion = 1
    static let fileExtension = "room"

    var format: String
    var version: Int
    var room: RoomPlan

    init(room: RoomPlan) {
        format = Self.formatIdentifier
        version = Self.currentVersion
        self.room = room
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }

    static func decode(_ data: Data) throws -> RoomPlan {
        guard let file = try? JSONDecoder().decode(RoomFile.self, from: data),
              file.format == formatIdentifier else {
            throw RoomFileError.invalidDocument
        }
        guard file.version <= currentVersion else {
            throw RoomFileError.unsupportedVersion(file.version)
        }
        var room = file.room
        room.sanitize()
        return room
    }
}
