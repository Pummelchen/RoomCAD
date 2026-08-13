import Foundation
import Testing
@testable import RoomCADV2

@Suite("RoomCAD V2 plan geometry")
struct PlanTests {
    // MARK: Grid snapping

    @Test("Five centimeter grid rounds to the nearest 5 cm")
    func gridSnapFiveCentimeters() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        room.grid = .fiveCentimeters
        let snapped = room.gridSnap(PlanPoint(x: 1.23, z: 0.97))
        #expect(snapped == PlanPoint(x: 1.25, z: 0.95))
    }

    @Test("Two centimeter grid rounds to the nearest 2 cm")
    func gridSnapTwoCentimeters() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        room.grid = .twoCentimeters
        let snapped = room.gridSnap(PlanPoint(x: 1.234, z: 0.971))
        #expect(snapped == PlanPoint(x: 1.24, z: 0.98))
    }

    @Test("One centimeter grid rounds to the nearest 1 cm")
    func gridSnapOneCentimeter() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        room.grid = .oneCentimeter
        let snapped = room.gridSnap(PlanPoint(x: 1.2345, z: 0.967))
        #expect(snapped == PlanPoint(x: 1.23, z: 0.97))
    }

    @Test("Grid snapping keeps points inside the room")
    func gridSnapClampsToRoom() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        let snapped = room.gridSnap(PlanPoint(x: 6.9, z: -1.0))
        #expect(snapped == PlanPoint(x: 6.0, z: 0.0))
    }

    @Test("Smart snap catches wall endpoints")
    func smartSnapCatchesEndpoints() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        room.walls = [
            Wall(start: PlanPoint(x: 1, z: 1), end: PlanPoint(x: 2, z: 1))
        ]
        let snapped = room.snapPoint(PlanPoint(x: 1.05, z: 1.02))
        #expect(snapped == PlanPoint(x: 1, z: 1))
    }

    @Test("Smart snap catches room corners")
    func smartSnapCatchesCorners() {
        let room = RoomPlan.fresh(width: 6, length: 4)
        let snapped = room.snapPoint(PlanPoint(x: 0.04, z: 0.05))
        #expect(snapped == PlanPoint(x: 0, z: 0))
    }

    // MARK: Wall geometry

    @Test("Wall projection reports offset and perpendicular distance")
    func wallProjection() {
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 4, z: 0))
        let projection = wall.projection(of: PlanPoint(x: 1, z: 0.5))
        #expect(abs(projection.offset - 1) < 0.0001)
        #expect(abs(projection.distance - 0.5) < 0.0001)
    }

    @Test("Wall point at offset walks along the segment")
    func wallPointAtOffset() {
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 4, z: 0))
        let point = wall.point(atOffset: 2.5)
        #expect(point == PlanPoint(x: 2.5, z: 0))
    }

    @Test("Wall direction and perpendicular are unit vectors")
    func wallDirections() {
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 3, z: 4))
        #expect(abs(wall.direction.x - 0.6) < 0.0001)
        #expect(abs(wall.direction.z - 0.8) < 0.0001)
        #expect(abs(wall.perpendicular.distance(to: .zero) - 1) < 0.0001)
        #expect(abs(wall.direction.x * wall.perpendicular.x + wall.direction.z * wall.perpendicular.z) < 0.0001)
    }

    // MARK: Opening spacing

    @Test("Spacing measures distances to wall ends and neighbors")
    func openingSpacing() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 4, z: 0))
        room.walls = [wall]
        let door = DoorOpening(wallID: wall.id, offset: 0.5, width: 0.9)
        let window = WindowOpening(wallID: wall.id, offset: 2.0, width: 1.0)
        room.doors = [door]
        room.windows = [window]

        let doorSpacing = room.spacing(forOpeningWith: door.id, kind: .door)
        #expect(doorSpacing != nil)
        #expect(abs(doorSpacing!.toWallStart - 0.5) < 0.0001)
        #expect(abs(doorSpacing!.toWallEnd - 2.6) < 0.0001)
        #expect(doorSpacing!.gapToPrevious == nil)
        #expect(abs(doorSpacing!.gapToNext! - 0.6) < 0.0001)

        let windowSpacing = room.spacing(forOpeningWith: window.id, kind: .window)
        #expect(abs(windowSpacing!.toWallStart - 2.0) < 0.0001)
        #expect(abs(windowSpacing!.toWallEnd - 1.0) < 0.0001)
        #expect(abs(windowSpacing!.gapToPrevious! - 0.6) < 0.0001)
        #expect(windowSpacing!.gapToNext == nil)
    }

    @Test("Opening offsets clamp with a 10 cm safety gap at both ends")
    func clampedOpeningOffset() {
        let room = RoomPlan.fresh(width: 6, length: 4)
        let wall = room.walls[0]
        let clamped = room.clampedOpeningOffset(0.0, width: 0.9, wallID: wall.id)
        #expect(abs(clamped! - 0.10) < 0.0001)
        let clampedHigh = room.clampedOpeningOffset(100, width: 0.9, wallID: wall.id)
        #expect(abs(clampedHigh! - (wall.length - 1.0)) < 0.0001)
    }

    // MARK: Wall slicing for the 3D view

    @Test("A wall with a door splits into base, mid, header, and leaf spans")
    func wallBuildPlanDoor() {
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 4, z: 0))
        let door = DoorOpening(wallID: wall.id, offset: 1.0, width: 0.9)
        let plan = WallBuildPlan(
            wall: wall,
            doors: [door],
            windows: [],
            height: 2.6
        )
        #expect(plan.baseSpans == [
            WallSpan(from: 0, to: 1.0),
            WallSpan(from: 1.9, to: 4.0)
        ])
        #expect(plan.midSpans == plan.baseSpans)
        #expect(plan.doorLeafSpans == [WallSpan(from: 1.0, to: 1.9)])
        #expect(plan.glassSpans.isEmpty)
        #expect(plan.headerSpan == WallSpan(from: 0, to: 4.0))
    }

    @Test("A wall with a window keeps glass and a strip in the opening")
    func wallBuildPlanWindow() {
        let wall = Wall(start: PlanPoint(x: 0, z: 0), end: PlanPoint(x: 4, z: 0))
        let window = WindowOpening(wallID: wall.id, offset: 2.0, width: 1.0)
        let plan = WallBuildPlan(
            wall: wall,
            doors: [],
            windows: [window],
            height: 2.6
        )
        #expect(plan.baseSpans == [WallSpan(from: 0, to: 4.0)])
        #expect(plan.midSpans == [
            WallSpan(from: 0, to: 2.0),
            WallSpan(from: 3.0, to: 4.0)
        ])
        #expect(plan.glassSpans == [WallSpan(from: 2.0, to: 3.0)])
        #expect(plan.stripSpans == [WallSpan(from: 2.0, to: 3.0)])
    }

    @Test("Overlapping cuts leave no double-covered spans")
    func solidSpansOverlappingCuts() {
        let spans = WallBuildPlan.solidSpans(
            length: 4.0,
            cuts: [
                WallSpan(from: 1.0, to: 2.5),
                WallSpan(from: 2.0, to: 3.0)
            ]
        )
        #expect(spans == [
            WallSpan(from: 0, to: 1.0),
            WallSpan(from: 3.0, to: 4.0)
        ])
    }

    // MARK: Furniture

    @Test("Furniture overlapping the room edge is not placeable")
    func furnitureValidityRejectsEdgeOverlap() {
        let room = RoomPlan.fresh(width: 6, length: 4)
        let bed = FurnitureItem(kind: .bed, center: PlanPoint(x: 0.5, z: 0.5))
        #expect(!room.isFurniturePlacementValid(bed))
        let centered = FurnitureItem(kind: .bed, center: PlanPoint(x: 3, z: 2))
        #expect(room.isFurniturePlacementValid(centered))
    }

    @Test("Furniture center snaps to the grid and stays inside the room")
    func furnitureCenterSnaps() {
        let room = RoomPlan.fresh(width: 6, length: 4)
        let bed = FurnitureItem(kind: .bed, center: .zero)
        let center = room.furnitureCenter(near: PlanPoint(x: 3.07, z: 2.03), for: bed)
        #expect(abs(center.x - 3.05) < 0.0001)
        #expect(abs(center.z - 2.05) < 0.0001)
    }

    @Test("Rotated furniture swaps its footprint axes")
    func rotatedFootprint() {
        let bed = FurnitureItem(kind: .bed, center: .zero, rotationDegrees: 90)
        #expect(abs(bed.orientedWidth - 2.00) < 0.0001)
        #expect(abs(bed.orientedDepth - 0.90) < 0.0001)
    }

    // MARK: Walkthrough collision

    @Test("A point near a wall blocks the player")
    func blocksPlayerAtWall() {
        let room = RoomPlan.fresh(width: 6, length: 4)
        #expect(room.blocksPlayer(at: PlanPoint(x: 3, z: 0.1), radius: 0.28))
        #expect(!room.blocksPlayer(at: PlanPoint(x: 3, z: 2), radius: 0.28))
    }

    @Test("Furniture blocks the player")
    func blocksPlayerAtFurniture() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        room.furniture = [FurnitureItem(kind: .wardrobe, center: PlanPoint(x: 3, z: 2))]
        #expect(room.blocksPlayer(at: PlanPoint(x: 3, z: 2), radius: 0.28))
        #expect(!room.blocksPlayer(at: PlanPoint(x: 1, z: 1), radius: 0.28))
    }

    // MARK: Sanitizing and files

    @Test("Fresh room starts with four outer walls")
    func freshRoomShell() {
        let room = RoomPlan.fresh()
        #expect(room.walls.count == 4)
        #expect(abs(room.width - 6.00) < 0.0001)
        #expect(abs(room.length - 4.00) < 0.0001)
    }

    @Test("Sanitize clamps widths, offsets, and drops orphaned openings")
    func sanitizeRepairs() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        let wall = room.walls[0]
        room.doors = [
            DoorOpening(wallID: wall.id, offset: 0.05, width: 5.0),
            DoorOpening(wallID: UUID(), offset: 0.5, width: 0.9)
        ]
        room.walls.removeAll { $0.id == wall.id }
        room.sanitize()
        #expect(room.doors.count == 0)
    }

    @Test("Sanitize clamps a too-wide door on a valid wall")
    func sanitizeClampsDoorWidth() {
        var room = RoomPlan.fresh(width: 6, length: 4)
        let wall = room.walls[0]
        room.doors = [DoorOpening(wallID: wall.id, offset: 0.5, width: 5.0)]
        room.sanitize()
        #expect(room.doors.count == 1)
        #expect(abs(room.doors[0].width - 1.40) < 0.0001)
        #expect(abs(room.doors[0].offset - 0.5) < 0.0001)
    }

    @Test("Room files round-trip through the versioned envelope")
    func roomFileRoundTrip() throws {
        var room = RoomPlan.fresh(width: 5, length: 3)
        let wall = room.walls[1]
        room.doors = [DoorOpening(wallID: wall.id, offset: 0.4, width: 0.9)]
        room.furniture = [FurnitureItem(kind: .bed, center: PlanPoint(x: 2, z: 1.5))]
        let data = try RoomFile(room: room).encoded()
        let decoded = try RoomFile.decode(data)
        #expect(decoded == room)
    }

    @Test("Foreign formats are rejected")
    func roomFileRejectsForeignFormat() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "format": "some.other.app.room",
            "version": 1,
            "room": [:]
        ])
        #expect(throws: RoomFileError.self) {
            _ = try RoomFile.decode(data)
        }
    }
}
