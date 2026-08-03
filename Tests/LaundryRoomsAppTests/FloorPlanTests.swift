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
        #expect(layout.bathroom == layout.lowerUnderBathroom)
        #expect(abs(layout.rearWindowStartX - 0.08) < 0.001)
        #expect(abs((layout.bathroom.minX - layout.rearWindowEndX) - 1.52) < 0.001)
        #expect(abs((layout.rearWindowEndX - layout.rearWindowStartX) - 2.12) < 0.001)
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
}
