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
                Button("Export Layout…") { store.exportPlan() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
            }
            CommandMenu("Furniture") {
                Button("Add Single Bed") { store.addFurniture(.singleBed) }
                Button("Add Square Table") { store.addFurniture(.squareTable) }
                Button("Add Chair") { store.addFurniture(.chair) }
                Button("Add Two-Door Wardrobe") { store.addFurniture(.twoDoorWardrobe) }
                Divider()
                Button("Rotate Selected Furniture") { store.rotateSelectedFurniture() }
                    .keyboardShortcut("b", modifiers: [])
                    .disabled(store.selectedFurnitureID == nil)
                Button("Delete Selected Furniture") { store.deleteSelectedFurniture() }
                    .disabled(store.selectedFurnitureID == nil)
            }
        }
    }
}
