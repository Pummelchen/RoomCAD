import AppKit
import SwiftUI

/// A narrow AppKit bridge for the one command SwiftUI's canvas does not
/// reliably receive when it has no keyboard focus: Escape during an active
/// pointer gesture. SwiftUI remains the source of truth for interaction state.
struct EscapeKeyMonitor: NSViewRepresentable {
    var isEnabled: Bool
    var action: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(isEnabled: isEnabled, action: action)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        context.coordinator.view = view
        context.coordinator.install()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isEnabled = isEnabled
        context.coordinator.action = action
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    @MainActor
    final class Coordinator {
        weak var view: NSView?
        var isEnabled: Bool
        var action: @MainActor () -> Void
        nonisolated(unsafe) private var eventMonitor: Any?

        init(isEnabled: Bool, action: @escaping @MainActor () -> Void) {
            self.isEnabled = isEnabled
            self.action = action
        }

        func install() {
            guard unsafe eventMonitor == nil else { return }
            unsafe eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard event.keyCode == 53 else { return event }
                let eventWindowNumber = event.windowNumber
                let handled = MainActor.assumeIsolated {
                    guard let self,
                          self.isEnabled,
                          unsafe eventWindowNumber == self.view?.window?.windowNumber else { return false }
                    self.action()
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
