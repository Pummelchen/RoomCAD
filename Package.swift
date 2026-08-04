// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "RoomCAD",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "RoomCAD", targets: ["RoomCADApp"])
    ],
    targets: [
        .executableTarget(
            name: "RoomCADApp",
            path: "Sources/RoomCADApp",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        ),
        .testTarget(
            name: "RoomCADAppTests",
            dependencies: ["RoomCADApp"],
            path: "Tests/RoomCADAppTests",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
