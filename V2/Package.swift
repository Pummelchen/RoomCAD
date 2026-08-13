// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "RoomCADV2",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "RoomCADV2", targets: ["RoomCADV2"])
    ],
    targets: [
        .executableTarget(
            name: "RoomCADV2",
            path: "Sources/RoomCADV2"
        ),
        .testTarget(
            name: "RoomCADV2Tests",
            dependencies: ["RoomCADV2"],
            path: "Tests/RoomCADV2Tests"
        )
    ],
    swiftLanguageModes: [.v6]
)
