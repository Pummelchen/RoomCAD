import Foundation
import Testing
@testable import LaundryRoomsApp

@Suite("Laundry room plan geometry")
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

    @Test("Older saved plans decode without a furniture field")
    func legacyPlanDecoding() throws {
        let encoded = try JSONEncoder().encode(FloorPlan.example)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "furniture")
        let legacyData = try JSONSerialization.data(withJSONObject: object)
        let restored = try JSONDecoder().decode(FloorPlan.self, from: legacyData)

        #expect(restored.furniture.isEmpty)
        #expect(restored.dimensions == FloorPlan.example.dimensions)
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
}
