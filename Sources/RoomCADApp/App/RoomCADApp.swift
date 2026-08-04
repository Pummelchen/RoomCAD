import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct RoomCADApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = FloorPlanStore()

    var body: some Scene {
        WindowGroup("RoomCAD") {
            ContentView(store: store)
                .frame(minWidth: 1_180, minHeight: 720)
        }
        .defaultSize(width: 1_440, height: 900)
        .commands {
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") { store.undo() }
                    .keyboardShortcut("z")
                    .disabled(!store.canUndo)
                Button("Redo") { store.redo() }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
                    .disabled(!store.canRedo)
            }
            CommandMenu("Layout") {
                Button("3D Walkthrough") { store.mode = .walkthrough }
                    .keyboardShortcut("1", modifiers: .command)
                Button("2D Plan") { store.mode = .plan }
                    .keyboardShortcut("2", modifiers: .command)
                Divider()
                Button("Zoom In") { store.zoomPlanIn() }
                    .keyboardShortcut("+", modifiers: .command)
                    .disabled(store.mode != .plan || !store.canZoomIn)
                Button("Zoom Out") { store.zoomPlanOut() }
                    .keyboardShortcut("-", modifiers: .command)
                    .disabled(store.mode != .plan || !store.canZoomOut)
                Button("Reset Zoom") { store.resetPlanZoom() }
                    .keyboardShortcut("0", modifiers: .command)
                    .disabled(store.mode != .plan || store.planZoomScale == 1)
                Button("Turn Plan Left") { store.rotatePlanLeft() }
                    .keyboardShortcut("[", modifiers: .command)
                    .disabled(store.mode != .plan)
                Button("Turn Plan Right") { store.rotatePlanRight() }
                    .keyboardShortcut("]", modifiers: .command)
                    .disabled(store.mode != .plan)
                Button("Reset Plan Orientation") { store.resetPlanRotation() }
                    .disabled(store.mode != .plan || store.planRotation == .zero)
                Divider()
                Button("Inspect Tool") { store.tool = .select }
                    .disabled(store.mode != .plan)
                Button("Draw Wall Tool") { store.tool = .wall }
                    .disabled(store.mode != .plan)
                Button("Place Door Tool") { store.beginDoorPlacement() }
                    .disabled(store.mode != .plan)
                Button("Erase Tool") { store.tool = .erase }
                    .disabled(store.mode != .plan)
                Divider()
                Button("Delete Selection") { store.deleteSelection() }
                    .disabled(store.mode != .plan || !store.hasSelection)
                Button("Duplicate Selection") { store.duplicateSelectedFurniture() }
                    .keyboardShortcut("d", modifiers: .command)
                    .disabled(store.mode != .plan || store.selectedFurnitureIDs.isEmpty)
                Button("Nudge Left") {
                    store.nudgeSelectedFurniture(dx: -store.plan.dimensions.gridSpacing, dz: 0)
                }
                .disabled(store.mode != .plan || store.selectedFurnitureIDs.isEmpty)
                Button("Nudge Right") {
                    store.nudgeSelectedFurniture(dx: store.plan.dimensions.gridSpacing, dz: 0)
                }
                .disabled(store.mode != .plan || store.selectedFurnitureIDs.isEmpty)
                Button("Nudge Up") {
                    store.nudgeSelectedFurniture(dx: 0, dz: store.plan.dimensions.gridSpacing)
                }
                .disabled(store.mode != .plan || store.selectedFurnitureIDs.isEmpty)
                Button("Nudge Down") {
                    store.nudgeSelectedFurniture(dx: 0, dz: -store.plan.dimensions.gridSpacing)
                }
                .disabled(store.mode != .plan || store.selectedFurnitureIDs.isEmpty)
                Divider()
                Button("Export Layout…") { store.exportPlan() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
            }
            CommandMenu("Furniture") {
                Button("Place Single Bed") { store.beginFurniturePlacement(.singleBed) }
                Button("Place Square Table") { store.beginFurniturePlacement(.squareTable) }
                Button("Place Chair") { store.beginFurniturePlacement(.chair) }
                Button("Place Two-Door Wardrobe") { store.beginFurniturePlacement(.twoDoorWardrobe) }
                Divider()
                Button("Rotate Selected Furniture") { store.rotateSelectedFurniture() }
                    .disabled(store.selectedFurnitureIDs.isEmpty)
                Button("Delete Selected Furniture") { store.deleteSelectedFurniture() }
                    .disabled(store.selectedFurnitureIDs.isEmpty)
            }
        }
    }
}
