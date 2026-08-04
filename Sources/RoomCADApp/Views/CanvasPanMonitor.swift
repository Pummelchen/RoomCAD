import AppKit
import SwiftUI

/// Pointer-scoped middle-mouse and Space-drag panning for the plan canvas.
/// SwiftUI remains the source of truth; this bridge only reports pixel deltas.
struct CanvasPanMonitor: NSViewRepresentable {
    var action: @MainActor (_ delta: CGSize) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeNSView(context: Context) -> NSView {
        let view = EventView(frame: .zero)
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

    private final class EventView: NSView {
        override var isFlipped: Bool { true }
    }

    @MainActor
    final class Coordinator {
        weak var view: NSView?
        var action: @MainActor (_ delta: CGSize) -> Void
        private var spacePressed = false
        private var panning = false
        private var lastLocation: CGPoint?
        nonisolated(unsafe) private var eventMonitor: Any?

        init(action: @escaping @MainActor (_ delta: CGSize) -> Void) {
            self.action = action
        }

        func install() {
            guard unsafe eventMonitor == nil else { return }
            let mask: NSEvent.EventTypeMask = [
                .keyDown, .keyUp,
                .leftMouseDown, .leftMouseDragged, .leftMouseUp,
                .otherMouseDown, .otherMouseDragged, .otherMouseUp
            ]
            unsafe eventMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
                let type = event.type
                let keyCode = event.keyCode
                let buttonNumber = event.buttonNumber
                let windowNumber = event.windowNumber
                let locationInWindow = event.locationInWindow
                let handled = MainActor.assumeIsolated {
                    self?.handle(
                        type: type,
                        keyCode: keyCode,
                        buttonNumber: buttonNumber,
                        windowNumber: windowNumber,
                        locationInWindow: locationInWindow
                    ) ?? false
                }
                return handled ? nil : event
            }
        }

        private func handle(
            type: NSEvent.EventType,
            keyCode: UInt16,
            buttonNumber: Int,
            windowNumber: Int,
            locationInWindow: CGPoint
        ) -> Bool {
            guard let view, unsafe windowNumber == view.window?.windowNumber else { return false }
            let location = view.convert(locationInWindow, from: nil)
            let pointerInside = view.bounds.contains(location)

            if type == .keyDown, keyCode == 49, pointerInside {
                guard !(unsafe view.window?.firstResponder is NSTextView) else { return false }
                spacePressed = true
                return true
            }
            if type == .keyUp, keyCode == 49 {
                spacePressed = false
                panning = false
                lastLocation = nil
                return true
            }

            let middleButton = buttonNumber == 2
            let wantsPan = middleButton || spacePressed
            switch type {
            case .leftMouseDown where wantsPan && pointerInside,
                 .otherMouseDown where wantsPan && pointerInside:
                panning = true
                lastLocation = location
                return true
            case .leftMouseDragged where panning,
                 .otherMouseDragged where panning:
                if let lastLocation {
                    action(CGSize(width: location.x - lastLocation.x, height: location.y - lastLocation.y))
                }
                lastLocation = location
                return true
            case .leftMouseUp where panning,
                 .otherMouseUp where panning:
                panning = false
                lastLocation = nil
                return true
            default:
                return false
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
