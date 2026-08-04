import SwiftUI

struct ContentView: View {
    let store: FloorPlanStore
    @State private var showInspector = true
    @State private var showQuickStart = false
    @AppStorage("hasSeenRoomCADQuickStart") private var hasSeenQuickStart = false
    @AppStorage("hasSeededRoomCADStairAlignedDemo") private var hasSeededStairAlignedDemo = false

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store) {
                showQuickStart = true
            }
                .navigationSplitViewColumnWidth(min: 210, ideal: 235, max: 280)
        } detail: {
            Group {
                switch store.mode {
                case .walkthrough:
                    WalkthroughView(store: store)
                case .plan:
                    TopDownEditorView(store: store)
                }
            }
            .inspector(isPresented: $showInspector) {
                SurveyInspectorView(store: store)
                    .inspectorColumnWidth(min: 260, ideal: 295, max: 360)
            }
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Picker("View", selection: Bindable(store).mode) {
                        ForEach(WorkspaceMode.allCases) { mode in
                            Label(mode.rawValue, systemImage: mode.systemImage).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 270)
                    .help("Switch between the 3D walkthrough and 2D plan")
                }

                if store.mode == .plan {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            store.undo()
                        } label: {
                            Label("Undo", systemImage: "arrow.uturn.backward")
                        }
                        .labelStyle(.iconOnly)
                        .help("Undo the last layout change (⌘Z)")
                        .disabled(!store.canUndo)

                        Button {
                            store.redo()
                        } label: {
                            Label("Redo", systemImage: "arrow.uturn.forward")
                        }
                        .labelStyle(.iconOnly)
                        .help("Redo the last undone layout change (⇧⌘Z)")
                        .disabled(!store.canRedo)

                        ForEach(PlanTool.allCases.filter { $0 != .furniture }) { tool in
                            Button {
                                store.tool = tool
                            } label: {
                                Label(tool.rawValue, systemImage: tool.systemImage)
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
                            Label("Place Furniture", systemImage: PlanTool.furniture.systemImage)
                        }
                        .menuIndicator(.hidden)
                        .help("Choose furniture to place on the 2D plan")
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showInspector.toggle()
                    } label: {
                        Label("Survey Inspector", systemImage: "sidebar.right")
                    }
                    .labelStyle(.iconOnly)
                    .help("Show or hide survey measurements")
                }
            }
        }
        .navigationTitle(store.documentDisplayName + (store.documentIsEdited ? " — Edited" : ""))
        .background {
            ResizableWindowConfigurator(
                minimumContentSize: NSSize(width: 720, height: 520)
            )
            .frame(width: 0, height: 0)
        }
        .task {
            if !hasSeededStairAlignedDemo {
                store.loadDemoIfEmpty()
                hasSeededStairAlignedDemo = true
            }
            if !hasSeenQuickStart {
                showQuickStart = true
            }
        }
        .sheet(isPresented: $showQuickStart) {
            QuickStartGuideView(doNotShowAgain: $hasSeenQuickStart) {
                hasSeenQuickStart = true
                store.mode = .plan
                store.tool = .select
                store.statusMessage = "Explore the furnished demo, or choose Draw Wall to change it"
            }
        }
        .onOpenURL { url in
            store.openDocument(at: url)
        }
        .alert(
            "RoomCAD Couldn't Finish",
            isPresented: Binding(
                get: { store.documentErrorMessage != nil },
                set: { if !$0 { store.documentErrorMessage = nil } }
            )
        ) {
            Button("OK") { store.documentErrorMessage = nil }
        } message: {
            Text(store.documentErrorMessage ?? "Unknown file error")
        }
    }
}
