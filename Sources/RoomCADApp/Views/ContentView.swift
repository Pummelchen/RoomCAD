import SwiftUI

struct ContentView: View {
    let store: FloorPlanStore
    @State private var showInspector = true

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store)
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

                        ForEach(PlanTool.allCases) { tool in
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
    }
}
