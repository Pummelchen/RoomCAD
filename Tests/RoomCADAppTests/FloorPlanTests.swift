import Foundation
import Testing
@testable import RoomCADApp

@Suite("RoomCAD plan geometry")
struct FloorPlanTests {
    @Test("Confirmed room length remains the default survey value")
    func confirmedLength() {
        #expect(SurveyDimensions().roomLength == 16.44)
    }

    @Test("Floor area is calculated in square metres")
    func floorArea() {
        let dimensions = SurveyDimensions()
        #expect(abs(dimensions.floorArea - 80.0628) < 0.001)
    }

    @Test("Photo-matched 60 cm floor tiles preserve the measured room extents")
    func floorTileLayout() {
        let layout = FloorTileLayout(dimensions: SurveyDimensions())

        #expect(FloorTileLayout.tileSize == 0.60)
        #expect(FloorTileLayout.groutWidth == 0.004)
        #expect(layout.columns == 9)
        #expect(layout.rows == 28)
        #expect(layout.fullColumns == 8)
        #expect(layout.fullRows == 27)
        #expect(abs(layout.widthCut - 0.07) < 0.001)
        #expect(abs(layout.lengthCut - 0.24) < 0.001)
    }

    @Test("Exact tile multiples do not create a false cut strip")
    func exactFloorTileMultiple() {
        var dimensions = SurveyDimensions()
        dimensions.roomWidth = 4.80
        dimensions.roomLength = 16.20
        let layout = FloorTileLayout(dimensions: dimensions)

        #expect(layout.columns == 8)
        #expect(layout.rows == 27)
        #expect(layout.fullColumns == 8)
        #expect(layout.fullRows == 27)
        #expect(layout.widthCut == 0)
        #expect(layout.lengthCut == 0)
    }

    @Test("Stacked stair core preserves the supplied landing and lower-flight measurements")
    func stackedStairCore() {
        let dimensions = SurveyDimensions()
        let layout = StairBathroomLayout(dimensions: dimensions)

        #expect(abs(layout.core.length - 6.00) < 0.001)
        #expect(abs(layout.lowerOpening.width - 1.15) < 0.001)
        #expect(abs(layout.lowerOpening.length - 3.50) < 0.001)
        #expect(abs(layout.landing.width - 1.32) < 0.001)
        #expect(abs(layout.landing.length - 3.50) < 0.001)
        #expect(abs(layout.upperFlight.minX - 2.40) < 0.001)
        #expect(layout.lowerCoveredFlight.minZ == layout.lowerOpening.maxZ)
        #expect(layout.lowerUnderBathroom.maxZ == dimensions.roomLength)
        #expect(layout.bathroom.minZ == layout.upperFlight.maxZ)
        #expect(abs(layout.bathroom.width - 1.75) < 0.001)
        #expect(layout.bathroom.minX < layout.lowerUnderBathroom.minX)
        #expect(layout.bathroom.maxX == layout.lowerUnderBathroom.maxX)
        #expect(abs(layout.rearWindowStartX - 0.08) < 0.001)
        #expect(abs((layout.bathroom.minX - layout.rearWindowEndX) - 1.52) < 0.001)
        #expect(abs((layout.rearWindowEndX - layout.rearWindowStartX) - 1.52) < 0.001)
    }

    @Test("Wall projection supplies a physical door offset")
    func wallProjection() {
        let wall = PartitionWall(start: PlanPoint(x: 1, z: 2), end: PlanPoint(x: 4, z: 2))
        let result = wall.projection(of: PlanPoint(x: 2.25, z: 2.4))
        #expect(abs(result.offset - 1.25) < 0.001)
        #expect(abs(result.distance - 0.4) < 0.001)
    }

    @Test("Configurable grid snapping preserves exact measured shell edges")
    func configurableGridSnapping() {
        var dimensions = SurveyDimensions()
        dimensions.gridSpacing = 0.05

        let fiveCentimeterPoint = dimensions.snapped(PlanPoint(x: 1.023, z: 2.076))
        #expect(abs(fiveCentimeterPoint.x - 1.00) < 0.001)
        #expect(abs(fiveCentimeterPoint.z - 2.10) < 0.001)
        #expect(
            dimensions.snapped(PlanPoint(x: dimensions.roomWidth, z: dimensions.roomLength))
                == PlanPoint(x: 4.87, z: 16.44)
        )

        dimensions.gridSpacing = 0.10
        let tenCentimeterPoint = dimensions.snapped(PlanPoint(x: 1.04, z: 2.06))
        #expect(abs(tenCentimeterPoint.x - 1.00) < 0.001)
        #expect(abs(tenCentimeterPoint.z - 2.10) < 0.001)
    }

    @Test("Walls use the configured grid for both endpoints") @MainActor
    func wallsUseConfiguredGrid() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        var dimensions = store.plan.dimensions
        dimensions.gridSpacing = 0.10
        store.updateDimensions(dimensions)

        #expect(store.addWall(
            from: PlanPoint(x: 0.04, z: 1.04),
            to: PlanPoint(x: 2.06, z: 3.07)
        ))
        let wall = try #require(store.plan.partitions.first)
        #expect(wall.start == PlanPoint(x: 0, z: 1.0))
        #expect(abs(wall.end.x - 2.1) < 0.001)
        #expect(abs(wall.end.z - 3.1) < 0.001)
    }

    @Test("Sanitizing removes orphaned doors")
    func orphanedDoor() {
        var plan = FloorPlan()
        plan.doors = [DoorOpening(wallID: UUID(), offset: 0.2)]
        plan.sanitize()
        #expect(plan.doors.isEmpty)
    }

    @Test("Store places only one door on a wall") @MainActor
    func oneDoorPerWall() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        store.clearPartitions()
        store.addWall(from: PlanPoint(x: 0.5, z: 3), to: PlanPoint(x: 4.0, z: 3))
        store.placeDoor(near: PlanPoint(x: 1.5, z: 3.1))
        store.placeDoor(near: PlanPoint(x: 3.0, z: 3.1))
        #expect(store.plan.partitions.count == 1)
        #expect(store.plan.doors.count == 1)
        #expect(store.plan.doors[0].offset > 1.8)
    }

    @Test("Add Door opens the plan with the door tool active") @MainActor
    func beginDoorPlacement() {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        store.mode = .walkthrough
        store.tool = .select

        store.beginDoorPlacement()

        #expect(store.mode == .plan)
        #expect(store.tool == .door)
        #expect(store.statusMessage.contains("Draw a wall first"))
    }

    @Test("Wall context lookup and deletion target the nearest wall") @MainActor
    func targetedWallDeletion() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        #expect(store.addWall(from: PlanPoint(x: 0.5, z: 2), to: PlanPoint(x: 4, z: 2)))
        let firstWallID = try #require(store.plan.partitions.first?.id)
        store.placeDoor(near: PlanPoint(x: 2, z: 2.1))
        #expect(store.addWall(from: PlanPoint(x: 0.5, z: 4), to: PlanPoint(x: 4, z: 4)))
        let secondWallID = try #require(store.plan.partitions.last?.id)

        #expect(store.wall(near: PlanPoint(x: 2.5, z: 2.15), tolerance: 0.25)?.id == firstWallID)
        store.deleteWall(id: firstWallID)

        #expect(store.plan.partitions.map(\.id) == [secondWallID])
        #expect(store.plan.doors.isEmpty)
        #expect(store.canUndo)

        store.undo()
        #expect(store.plan.partitions.count == 2)
        #expect(store.plan.doors.count == 1)
    }

    @Test("Selected doors slide on their wall and report both side lengths") @MainActor
    func doorSliding() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        store.addWall(from: PlanPoint(x: 0.5, z: 3), to: PlanPoint(x: 4.0, z: 3))
        store.placeDoor(near: PlanPoint(x: 1.47, z: 3.1))

        let doorID = try #require(store.selectedDoorID)
        let originalDoor = try #require(store.selectedDoor)
        #expect(abs(originalDoor.offset - 0.5) < 0.001)
        #expect(store.tool == .select)

        store.select(near: PlanPoint(x: 1.45, z: 3.0))
        #expect(store.selectedDoorID == doorID)
        store.moveDoor(id: doorID, to: PlanPoint(x: 3.03, z: 3.2))

        let movedDoor = try #require(store.selectedDoor)
        let sides = try #require(store.doorSideLengths(movedDoor))
        #expect(abs(sides.leading - 2.1) < 0.001)
        #expect(abs(sides.trailing - 0.5) < 0.001)

        store.undo()
        #expect(abs((store.plan.doors.first?.offset ?? 0) - 0.5) < 0.001)
    }

    @Test("Undo restores the previous complete plan") @MainActor
    func undo() {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        let original = store.plan
        store.addWall(from: PlanPoint(x: 0.2, z: 2), to: PlanPoint(x: 3, z: 2))
        store.undo()
        #expect(store.plan == original)
        #expect(store.canRedo)
        store.redo()
        #expect(store.plan.partitions.count == 1)
    }

    @Test("Plan zoom steps, resets, and remains within safe bounds") @MainActor
    func planZoomBounds() {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)

        #expect(store.planZoomScale == 1)
        store.zoomPlanIn()
        #expect(abs(store.planZoomScale - 1.25) < 0.001)
        store.zoomPlanOut()
        #expect(abs(store.planZoomScale - 1.00) < 0.001)

        for _ in 0..<20 { store.zoomPlanIn() }
        #expect(store.planZoomScale == FloorPlanStore.maximumPlanZoom)
        #expect(!store.canZoomIn)

        for _ in 0..<40 { store.zoomPlanOut() }
        #expect(store.planZoomScale == FloorPlanStore.minimumPlanZoom)
        #expect(!store.canZoomOut)

        store.resetPlanZoom()
        #expect(store.planZoomScale == 1)
        #expect(store.canZoomIn)
        #expect(store.canZoomOut)
    }

    @Test("Plan rotation preserves coordinates through all four orientations")
    func planRotationRoundTrip() {
        let dimensions = SurveyDimensions()
        let points = [
            PlanPoint.zero,
            PlanPoint(x: dimensions.roomWidth, z: dimensions.roomLength),
            PlanPoint(x: 1.25, z: 7.80)
        ]

        for rotation in PlanRotation.allCases {
            for point in points {
                let display = rotation.displayPoint(point, dimensions: dimensions)
                let restored = rotation.planPoint(display, dimensions: dimensions)
                #expect(restored.distance(to: point) < 0.001)
            }
        }

        let rightSize = PlanRotation.right90.displaySize(for: dimensions)
        #expect(rightSize.width == dimensions.roomLength)
        #expect(rightSize.height == dimensions.roomWidth)

        let source = PlanRectangle(minX: 1, maxX: 3, minZ: 4, maxZ: 9)
        let rotated = PlanRotation.right90.displayRectangle(source, dimensions: dimensions)
        #expect(abs(rotated.width - source.length) < 0.001)
        #expect(abs(rotated.length - source.width) < 0.001)
    }

    @Test("Plan rotation controls turn left, right, and reset") @MainActor
    func planRotationControls() {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)

        store.rotatePlanRight()
        #expect(store.planRotation == .right90)
        store.rotatePlanLeft()
        #expect(store.planRotation == .zero)
        store.rotatePlanLeft()
        #expect(store.planRotation == .left90)
        store.resetPlanRotation()
        #expect(store.planRotation == .zero)
    }

    @Test("Furniture uses measured planning footprints and four cardinal rotations")
    func furnitureDimensionsAndRotation() {
        var bed = FurnitureItem(kind: .singleBed, center: PlanPoint(x: 1, z: 2))

        #expect(abs(bed.orientedWidth - 0.90) < 0.001)
        #expect(abs(bed.orientedDepth - 2.00) < 0.001)
        bed.direction = bed.direction.next
        #expect(bed.direction == .east)
        #expect(abs(bed.orientedWidth - 2.00) < 0.001)
        #expect(abs(bed.orientedDepth - 0.90) < 0.001)
        bed.direction = bed.direction.next.next.next
        #expect(bed.direction == .north)

        #expect(FurnitureKind.squareTable.dimensions.width == 0.70)
        #expect(FurnitureKind.chair.dimensions.width == 0.45)
        #expect(FurnitureKind.twoDoorWardrobe.dimensions.depth == 0.60)
    }

    @Test("Furniture remains on the floor and outside fixed stair geometry")
    func furnitureFloorConstraints() {
        let dimensions = SurveyDimensions()
        let fixed = StairBathroomLayout(dimensions: dimensions)
        var bed = FurnitureItem(kind: .singleBed, center: PlanPoint(x: -2, z: -2))

        bed.clampToRoom(dimensions)
        #expect(bed.footprint.minX >= 0)
        #expect(bed.footprint.minZ >= 0)
        #expect(bed.isOnUsableFloor(dimensions))

        bed.center = PlanPoint(
            x: (fixed.lowerOpening.minX + fixed.lowerOpening.maxX) / 2,
            z: (fixed.lowerOpening.minZ + fixed.lowerOpening.maxZ) / 2
        )
        #expect(!bed.isOnUsableFloor(dimensions))
    }

    @Test("Furniture remains on the configured grid near shell edges") @MainActor
    func furnitureGridAtShellEdge() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)

        store.addFurniture(.chair, at: PlanPoint(x: 4.86, z: 2.03))
        let chair = try #require(store.selectedFurniture)
        let spacing = store.plan.dimensions.gridSpacing
        #expect(chair.footprint.maxX <= store.plan.dimensions.roomWidth)
        #expect(abs(chair.center.x / spacing - (chair.center.x / spacing).rounded()) < 0.001)
        #expect(abs(chair.center.z / spacing - (chair.center.z / spacing).rounded()) < 0.001)
    }

    @Test("Store adds, rotates, moves, rejects stair overlap, and undoes furniture") @MainActor
    func furnitureStoreFlow() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)

        store.addFurniture(.singleBed, at: PlanPoint(x: 1.0, z: 2.0))
        let id = try #require(store.selectedFurnitureID)
        #expect(store.plan.furniture.count == 1)
        #expect(store.selectedFurniture?.direction == .north)

        store.rotateSelectedFurniture()
        #expect(store.selectedFurniture?.direction == .east)
        #expect(abs((store.selectedFurniture?.orientedWidth ?? 0) - 2.00) < 0.001)

        store.moveFurniture(id: id, to: PlanPoint(x: 2.5, z: 4.0))
        #expect(store.selectedFurniture?.center == PlanPoint(x: 2.5, z: 4.0))

        let validCenter = try #require(store.selectedFurniture?.center)
        let opening = StairBathroomLayout(dimensions: store.plan.dimensions).lowerOpening
        store.moveFurniture(
            id: id,
            to: PlanPoint(
                x: (opening.minX + opening.maxX) / 2,
                z: (opening.minZ + opening.maxZ) / 2
            )
        )
        #expect(store.selectedFurniture?.center == validCenter)

        store.undo()
        #expect(store.selectedFurnitureID == nil)
        #expect(store.plan.furniture.first?.center == PlanPoint(x: 1.0, z: 2.0))
        #expect(store.plan.furniture.first?.direction == .east)
    }

    @Test("Older saved plans decode without furniture or room-label fields")
    func legacyPlanDecoding() throws {
        let encoded = try JSONEncoder().encode(FloorPlan.example)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "furniture")
        object.removeValue(forKey: "roomLabels")
        let legacyData = try JSONSerialization.data(withJSONObject: object)
        let restored = try JSONDecoder().decode(FloorPlan.self, from: legacyData)

        #expect(restored.furniture.isEmpty)
        #expect(restored.roomLabels.isEmpty)
        #expect(restored.dimensions == FloorPlan.example.dimensions)
    }

    @Test("Room labels can be added, found, renamed, removed, undone, and persisted") @MainActor
    func roomLabelFlow() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)

        #expect(!store.saveRoomLabel(name: "   ", at: PlanPoint(x: 1, z: 2)))
        #expect(store.plan.roomLabels.isEmpty)
        #expect(store.saveRoomLabel(
            name: "  Kids Room  ",
            at: PlanPoint(x: store.plan.dimensions.roomWidth + 1, z: 2)
        ))

        let label = try #require(store.plan.roomLabels.first)
        #expect(label.name == "Kids Room")
        #expect(label.position == PlanPoint(x: store.plan.dimensions.roomWidth, z: 2))
        #expect(store.roomLabel(near: label.position, tolerance: 0.01)?.id == label.id)

        let restored = FloorPlanStore(persistenceURL: temporary, loadPersisted: true)
        #expect(restored.plan.roomLabels == [label])

        #expect(store.saveRoomLabel(name: "Play Room", at: label.position, editingID: label.id))
        #expect(store.plan.roomLabels.first?.name == "Play Room")
        store.undo()
        #expect(store.plan.roomLabels.first?.name == "Kids Room")
        store.redo()
        #expect(store.plan.roomLabels.first?.name == "Play Room")

        store.deleteRoomLabel(id: label.id)
        #expect(store.plan.roomLabels.isEmpty)
        store.undo()
        #expect(store.plan.roomLabels.first?.name == "Play Room")
    }

    @Test("Furniture survives plan persistence")
    func furniturePersistence() throws {
        var plan = FloorPlan.example
        plan.furniture = [
            FurnitureItem(
                kind: .twoDoorWardrobe,
                center: PlanPoint(x: 1.4, z: 3.2),
                direction: .west
            )
        ]

        let restored = try JSONDecoder().decode(FloorPlan.self, from: JSONEncoder().encode(plan))
        #expect(restored.furniture == plan.furniture)
    }

    @Test("RoomCAD migrates a legacy LaundryRooms saved layout") @MainActor
    func legacyPersistenceMigration() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let currentURL = temporary.appending(path: "RoomCAD/layout.json")
        let legacyURL = temporary.appending(path: "LaundryRooms/layout.json")
        var legacyPlan = FloorPlan.example
        legacyPlan.furniture = [
            FurnitureItem(kind: .singleBed, center: PlanPoint(x: 1.2, z: 2.0))
        ]
        try FileManager.default.createDirectory(
            at: legacyURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder().encode(legacyPlan).write(to: legacyURL)

        let store = FloorPlanStore(
            persistenceURL: currentURL,
            legacyPersistenceURL: legacyURL
        )

        #expect(store.plan == legacyPlan)
        #expect(store.statusMessage == "Migrated saved layout to RoomCAD")
        #expect(FileManager.default.fileExists(atPath: currentURL.path))
        let migrated = try JSONDecoder().decode(FloorPlan.self, from: Data(contentsOf: currentURL))
        #expect(migrated == legacyPlan)
    }

    @Test("Smart snapping finds wall endpoints and locks clean angles")
    func smartWallSnapping() throws {
        let first = PartitionWall(
            start: PlanPoint(x: 1, z: 1),
            end: PlanPoint(x: 3, z: 1)
        )
        let plan = FloorPlan(partitions: [first])

        let endpoint = plan.smartSnap(PlanPoint(x: 3.04, z: 1.03))
        #expect(endpoint.point == first.end)
        #expect(endpoint.label == "Wall endpoint")

        let locked = plan.smartSnap(
            PlanPoint(x: 2.0, z: 2.08),
            anchor: PlanPoint(x: 1, z: 1),
            lockAngles: true
        )
        #expect(abs((locked.point.x - 1) - (locked.point.z - 1)) < 0.001)
        #expect(locked.label == "45° angle lock")
    }

    @Test("Wall handles preserve attached doors and exact wall dimensions") @MainActor
    func editableWallPreservesDoor() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        #expect(store.addWall(from: PlanPoint(x: 0.5, z: 3), to: PlanPoint(x: 4, z: 3)))
        store.placeDoor(near: PlanPoint(x: 2, z: 3))
        let wall = try #require(store.selectedWall)

        #expect(store.updateWall(
            id: wall.id,
            start: wall.start,
            end: PlanPoint(x: 4.5, z: 3)
        ))
        #expect(abs((store.selectedWall?.length ?? 0) - 4.0) < 0.001)
        #expect(store.plan.doors.count == 1)
        #expect(!store.updateSelectedWall(length: 0.5, angleDegrees: 0))
    }

    @Test("Furniture placement blocks overlaps and supports multi-select duplication") @MainActor
    func safeMultiFurniturePlacement() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "plan.json")
        let store = FloorPlanStore(persistenceURL: temporary, loadPersisted: false)
        store.addFurniture(.chair, at: PlanPoint(x: 1, z: 2))
        let first = try #require(store.selectedFurnitureID)
        store.addFurniture(.chair, at: PlanPoint(x: 2, z: 2))
        let second = try #require(store.selectedFurnitureID)

        let overlapping = try #require(store.furniturePreview(kind: .chair, near: PlanPoint(x: 1, z: 2)))
        #expect(!overlapping.isValid)

        store.selectedFurnitureIDs = [first, second]
        store.duplicateSelectedFurniture()
        #expect(store.plan.furniture.count == 4)
        #expect(store.selectedFurnitureIDs.count == 2)
    }

    @Test("Named snapshots save and restore complete layouts") @MainActor
    func namedSnapshots() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let store = FloorPlanStore(
            persistenceURL: temporary.appending(path: "layout.json"),
            loadPersisted: false
        )
        #expect(store.addWall(from: PlanPoint(x: 0.5, z: 2), to: PlanPoint(x: 3, z: 2)))
        let savedPlan = store.plan
        store.saveSnapshot(named: "Kid-safe version")
        let snapshot = try #require(store.snapshots.first)
        store.clearPartitions()

        store.restoreSnapshot(id: snapshot.id)
        #expect(store.plan == savedPlan)

        let reloaded = FloorPlanStore(
            persistenceURL: temporary.appending(path: "layout.json"),
            loadPersisted: true
        )
        #expect(reloaded.snapshots.first?.name == "Kid-safe version")
    }
}
