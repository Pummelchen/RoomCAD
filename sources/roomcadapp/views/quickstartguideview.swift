import SwiftUI

struct QuickStartGuideView: View {
    @Binding var doNotShowAgain: Bool
    let startDesigning: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "house.and.flag.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 7) {
                Text("Explore and Build")
                    .font(.largeTitle.bold())
                Text("RoomCAD works like a simple building game.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 16) {
                guideRow("1", "Explore the demo", "Seven furnished rooms share a clear route to the bathroom.")
                guideRow("2", "Draw walls", "Choose Draw Wall, then click grid dots. Hold Shift for clean 45° angles.")
                guideRow("3", "Add doors", "Choose Add Door and click a wall. Inspect lets you slide it.")
                guideRow("4", "Place furniture", "Pick an item on the left, move the green ghost, and click.")
                guideRow("5", "Name rooms", "Double-click inside a room, then type its name in the pop-up.")
                guideRow("6", "Fix anything", "Drag objects to move them. Esc cancels. ⌘Z undoes.")
                guideRow("7", "Save your design", "Press ⌘S. The RoomCAD file keeps the shell and every object.")
            }

            Divider()
            Toggle("Do not show again", isOn: $doNotShowAgain)
                .toggleStyle(.checkbox)
                .help("You can reopen this guide from Workspace in the sidebar")

            HStack {
                Button("Not Now") { dismiss() }
                Spacer()
                Button("Explore Demo", systemImage: "building.2.fill") {
                    startDesigning()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .padding(32)
        .frame(width: 610)
        .accessibilityElement(children: .contain)
    }

    private func guideRow(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(number)
                .font(.headline)
                .frame(width: 30, height: 30)
                .background(.tint, in: Circle())
                .foregroundStyle(.white)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail).foregroundStyle(.secondary)
            }
        }
    }
}
