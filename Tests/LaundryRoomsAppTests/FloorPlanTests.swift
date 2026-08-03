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
