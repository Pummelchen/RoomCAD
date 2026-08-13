import SwiftUI

struct ContentView: View {
    @Bindable var store: RoomStore
    @State private var showInspector = true

    var body: some View {
        NavigationSplitView {
            RoomsSidebar(store: store)
                .navigationSplitViewColumnWidth(min: 180, ideal: 205, max: 250)
        } detail: {
            Group {
                switch store.mode {
                case .plan:
                    PlanEditorView(store: store)
                case .walkthrough:
                    WalkthroughView(store: store)
                }
            }
            .inspector(isPresented: $showInspector) {
                InspectorView(store: store)
                    .inspectorColumnWidth(min: 240, ideal: 280, max: 340)
            }
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Picker("View", selection: $store.mode) {
                        ForEach(WorkspaceMode.allCases) { mode in
                            Label(mode.rawValue, systemImage: mode.systemImage).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 210)
                    .help("Switch between the 2D plan and the 3D walk")
                }

                if store.mode == .plan {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Picker("Grid", selection: Binding(
                            get: { store.room.grid },
                            set: { store.setGrid($0) }
                        )) {
                            ForEach(GridStep.allCases) { step in
                                Text(step.label).tag(step)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 130)
                        .help("Snap everything to a 1, 2, or 5 cm grid")

                        Divider()

                        ForEach(PlanTool.allCases.filter { $0 != .furniture }) { tool in
                            Button {
                                store.chooseTool(tool)
                            } label: {
                                Label(tool.title, systemImage: tool.systemImage)
                            }
                            .labelStyle(.iconOnly)
                            .help(tool.helpText)
                            .buttonStyle(.bordered)
                            .tint(store.tool == tool ? .accentColor : nil)
                        }

                        Menu {
                            ForEach(FurnitureKind.allCases) { kind in
                                Button {
                                    store.beginFurniturePlacement(kind)
                                } label: {
                                    Label(kind.title, systemImage: kind.systemImage)
                                }
                            }
                        } label: {
                            Label("Furniture", systemImage: "sofa")
                        }
                        .menuIndicator(.hidden)
                        .help("Pick furniture to place on the floor")

                        Divider()

                        Button {
                            store.undo()
                        } label: {
                            Label("Undo", systemImage: "arrow.uturn.backward")
                        }
                        .labelStyle(.iconOnly)
                        .help("Undo the last change (⌘Z)")
                        .disabled(!store.canUndo)

                        Button {
                            store.redo()
                        } label: {
                            Label("Redo", systemImage: "arrow.uturn.forward")
                        }
                        .labelStyle(.iconOnly)
                        .help("Redo the last undone change (⇧⌘Z)")
                        .disabled(!store.canRedo)
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showInspector.toggle()
                    } label: {
                        Label("Inspector", systemImage: "sidebar.right")
                    }
                    .labelStyle(.iconOnly)
                    .help("Show or hide details for the selected object")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                StatusBar(store: store)
            }
        }
        .navigationTitle(store.documentDisplayName + (store.documentIsEdited ? " · Edited" : ""))
        .onOpenURL { url in
            store.openRoom(at: url)
        }
    }
}

struct RoomsSidebar: View {
    @Bindable var store: RoomStore

    var body: some View {
        VStack(spacing: 0) {
            List {
                Section("My Rooms") {
                    ForEach(store.savedRooms) { savedRoom in
                        Button {
                            store.openRoom(at: savedRoom.url)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(savedRoom.name)
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                Text(savedRoom.summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Button {
                    store.newRoom()
                } label: {
                    Label("New Room", systemImage: "plus")
                }
                Button {
                    store.openRoom()
                } label: {
                    Label("Open…", systemImage: "folder")
                }
                Button {
                    store.saveRoomAs()
                } label: {
                    Label("Save As…", systemImage: "square.and.arrow.down")
                }
            }
            .buttonStyle(.borderless)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { store.refreshSavedRooms() }
    }
}

struct StatusBar: View {
    let store: RoomStore

    var body: some View {
        HStack(spacing: 12) {
            Text(store.statusMessage)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
            Spacer()
            Text(store.mode == .plan
                ? store.tool.helpText
                : "WASD or arrow keys to walk · drag mouse to look around")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }
}
