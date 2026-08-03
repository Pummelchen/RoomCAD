// swift-tools-version: 6.1
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
            path: "Sources/LaundryRoomsApp"
        ),
        .testTarget(
            name: "LaundryRoomsAppTests",
            dependencies: ["LaundryRoomsApp"],
            path: "Tests/LaundryRoomsAppTests"
        )
    ]
)
