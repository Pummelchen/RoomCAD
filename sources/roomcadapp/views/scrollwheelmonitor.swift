import AppKit
import SwiftUI

/// A pointer-scoped bridge for an interaction SwiftUI does not expose on a
/// plain Canvas: raw mouse-wheel deltas. The editor owns all zoom state; this
/// view only normalizes wheel input and reports its local pointer position.
struct ScrollWheelMonitor: NSViewRepresentable {
    var action: @MainActor (_ delta: CGFloat, _ location: CGPoint) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> NSView {
        let view = FlippedEventView(frame: .zero)
        context.coordinator.view = view
        context.coordinator.install()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.action = action
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    private final class FlippedEventView: NSView {
        override var isFlipped: Bool { true }
    }

    @MainActor
    final class Coordinator {
        weak var view: NSView?
        var action: @MainActor (_ delta: CGFloat, _ location: CGPoint) -> Void
        nonisolated(unsafe) private var eventMonitor: Any?

        init(action: @escaping @MainActor (_ delta: CGFloat, _ location: CGPoint) -> Void) {
            self.action = action
        }

        func install() {
            guard unsafe eventMonitor == nil else { return }
            unsafe eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                let eventWindowNumber = event.windowNumber
                let locationInWindow = event.locationInWindow
                let rawDelta = event.scrollingDeltaY
                let normalizedDelta = event.hasPreciseScrollingDeltas ? rawDelta * 0.05 : rawDelta
                guard abs(normalizedDelta) > 0.001 else { return event }

                let handled = MainActor.assumeIsolated {
                    guard let self,
                          let view = self.view,
                          unsafe eventWindowNumber == view.window?.windowNumber else { return false }
                    let location = view.convert(locationInWindow, from: nil)
                    guard view.bounds.contains(location) else { return false }
                    self.action(normalizedDelta, location)
                    return true
                }
                return handled ? nil : event
            }
        }

        func uninstall() {
            guard let eventMonitor = unsafe eventMonitor else { return }
            NSEvent.removeMonitor(eventMonitor)
            unsafe self.eventMonitor = nil
        }

        deinit {
            if let eventMonitor = unsafe eventMonitor {
                NSEvent.removeMonitor(eventMonitor)
            }
        }
    }
}
