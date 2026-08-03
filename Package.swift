// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "LaundryRooms",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "LaundryRooms", targets: ["LaundryRoomsApp"])
    ],
    targets: [
        .executableTarget(
            name: "LaundryRoomsApp",
            path: "Sources/LaundryRoomsApp",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        ),
        .testTarget(
            name: "LaundryRoomsAppTests",
            dependencies: ["LaundryRoomsApp"],
            path: "Tests/LaundryRoomsAppTests",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
