import AppKit
import SwiftUI

extension View {
    /// Adds both the standard macOS tooltip and an immediate visible hint.
    /// SwiftUI toolbar items do not reliably surface `.help` in every toolbar
    /// configuration, so the AppKit tracker provides deterministic feedback.
    func immediateToolbarHelp(_ text: String) -> some View {
        help(text)
            .background {
                ToolbarHoverHelpBridge(text: text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
    }
}

private struct ToolbarHoverHelpBridge: NSViewRepresentable {
    var text: String

    func makeNSView(context: Context) -> ToolbarHoverTrackingView {
        ToolbarHoverTrackingView(text: text)
    }

    func updateNSView(_ nsView: ToolbarHoverTrackingView, context: Context) {
        nsView.text = text
    }
}

private final class ToolbarHoverTrackingView: NSView {
    var text: String {
        didSet {
            toolTip = text
            if oldValue != text { hideHint() }
        }
    }

    private var hoverTrackingArea: NSTrackingArea?
    private var hintPanel: NSPanel?

    init(text: String) {
        self.text = text
        super.init(frame: .zero)
        toolTip = text
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func updateTrackingAreas() {
        if let hoverTrackingArea {
            removeTrackingArea(hoverTrackingArea)
        }
        let trackingArea = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self
        )
        addTrackingArea(trackingArea)
        hoverTrackingArea = trackingArea
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        showHint()
    }

    override func mouseExited(with event: NSEvent) {
        hideHint()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if unsafe self.window == nil { hideHint() }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    private func showHint() {
        guard NSApp.isActive,
              hintPanel == nil,
              !text.isEmpty,
              let window = unsafe self.window else { return }

        let hint = Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 7))
            .overlay {
                RoundedRectangle(cornerRadius: 7)
                    .stroke(.primary.opacity(0.18), lineWidth: 0.5)
            }
            .fixedSize()
        let hostingView = NSHostingView(rootView: hint)
        let hintSize = hostingView.fittingSize
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: hintSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = hostingView
        panel.level = .popUpMenu
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = true
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]

        let mouseLocation = NSEvent.mouseLocation
        let activeScreen = NSScreen.screens.first {
            NSMouseInRect(mouseLocation, $0.frame, false)
        } ?? window.screen ?? NSScreen.main
        let visibleFrame = activeScreen?.visibleFrame ?? .zero
        var origin = NSPoint(
            x: mouseLocation.x - hintSize.width / 2,
            y: mouseLocation.y - hintSize.height - 18
        )
        origin.x = origin.x.clamped(
            to: (visibleFrame.minX + 6)...max(visibleFrame.minX + 6, visibleFrame.maxX - hintSize.width - 6)
        )
        if origin.y < visibleFrame.minY + 6 {
            origin.y = mouseLocation.y + 18
        }

        panel.setFrameOrigin(origin)
        hintPanel = panel
        panel.orderFrontRegardless()
    }

    private func hideHint() {
        hintPanel?.orderOut(nil)
        hintPanel = nil
    }
}
