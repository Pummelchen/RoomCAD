import SwiftUI

@main
struct RoomCADV2App: App {
    @State private var store = RoomStore()

    var body: some Scene {
        WindowGroup("RoomCAD V2") {
            ContentView(store: store)
                .frame(minWidth: 860, minHeight: 600)
        }
        .defaultSize(width: 1_200, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Room") { store.newRoom() }
                    .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Button("Open Room…") { store.openRoom() }
                    .keyboardShortcut("o", modifiers: .command)
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save Room") { store.saveRoom() }
                    .keyboardShortcut("s", modifiers: .command)
                Button("Save Room As…") { store.saveRoomAs() }
                    .keyboardShortcut("s", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") { store.undo() }
                    .keyboardShortcut("z")
                    .disabled(!store.canUndo)
                Button("Redo") { store.redo() }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
                    .disabled(!store.canRedo)
            }
            CommandMenu("View") {
                Button("2D Plan") { store.mode = .plan }
                    .keyboardShortcut("1", modifiers: .command)
                Button("3D Walk") { store.mode = .walkthrough }
                    .keyboardShortcut("2", modifiers: .command)
            }
        }
    }
}
