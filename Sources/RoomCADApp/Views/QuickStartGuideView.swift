import SwiftUI

struct QuickStartGuideView: View {
    let startDesigning: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "house.and.flag.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 7) {
                Text("Build Your Room")
                    .font(.largeTitle.bold())
                Text("RoomCAD works like a simple building game.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 16) {
                guideRow("1", "Draw walls", "Choose Draw Wall, then click grid dots. Hold Shift for clean 45° angles.")
                guideRow("2", "Add doors", "Choose Add Door and click a wall. Inspect lets you slide it.")
                guideRow("3", "Place furniture", "Pick an item on the left, move the green ghost, and click.")
                guideRow("4", "Fix anything", "Drag objects to move them. Esc cancels. ⌘Z undoes.")
                guideRow("5", "Look around", "Use the mouse wheel to zoom and Space-drag to pan.")
            }

            HStack {
                Button("Not Now") { dismiss() }
                Spacer()
                Button("Start Building", systemImage: "hammer.fill") {
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
