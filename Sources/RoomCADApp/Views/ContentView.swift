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
                }

                if store.mode == .plan {
                    ToolbarItemGroup(placement: .primaryAction) {
                        ForEach(PlanTool.allCases) { tool in
                            Button {
                                store.tool = tool
                            } label: {
                                Label(tool.rawValue, systemImage: tool.systemImage)
                            }
                            .help(tool.rawValue)
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
                    .help("Show or hide survey measurements")
                }
            }
        }
    }
}
