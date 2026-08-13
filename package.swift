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
            path: "sources/roomcadapp",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        ),
        .testTarget(
            name: "RoomCADAppTests",
            dependencies: ["RoomCADApp"],
            path: "tests/roomcadapptests",
            swiftSettings: [
                .unsafeFlags(["-strict-memory-safety"])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
