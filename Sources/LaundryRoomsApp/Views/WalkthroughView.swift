import SwiftUI

struct WalkthroughView: View {
    let store: FloorPlanStore
    @State private var metrics = RenderMetrics()

    var body: some View {
        ZStack(alignment: .topLeading) {
            MetalCanvas(plan: store.plan) { metrics = $0 }
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 8) {
                Label("M3 REALTIME", systemImage: "apple.logo")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.green)

                Text(metrics.summary)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)

                Text("Walk / fly")
                    .font(.headline)
                Text("W/S forward/back  •  A left  •  D right")
                Text("Drag mouse to look")
                Text("Space up  •  C down  •  Shift fast")
                Text("Click the scene to capture keys")
            }
            .font(.caption)
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(16)

            Crosshair()
        }
        .background(.black)
    }
}

private struct Crosshair: View {
    var body: some View {
        GeometryReader { geometry in
            Path { path in
                let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
                path.move(to: CGPoint(x: center.x - 7, y: center.y))
                path.addLine(to: CGPoint(x: center.x + 7, y: center.y))
                path.move(to: CGPoint(x: center.x, y: center.y - 7))
                path.addLine(to: CGPoint(x: center.x, y: center.y + 7))
            }
            .stroke(.white.opacity(0.72), lineWidth: 1)
            .shadow(color: .black, radius: 1)
        }
        .allowsHitTesting(false)
    }
}
