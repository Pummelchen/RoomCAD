import AppKit
import SwiftUI

enum PlanKeyboardCommand: Sendable {
    case select
    case wall
    case door
    case window
    case erase
    case rotate
    case delete
    case nudge(dx: Double, dz: Double)
}

/// Window-scoped plan controls that stand down while a text field is editing,
/// so hotkeys never steal input from the room name or dimension fields.
struct PlanKeyboardMonitor: NSViewRepresentable {
    var gridSpacing: Double
    var action: @MainActor (PlanKeyboardCommand) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(gridSpacing: gridSpacing, action: action)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        context.coordinator.view = view
        context.coordinator.install()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.gridSpacing = gridSpacing
        context.coordinator.action = action
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    @MainActor
    final class Coordinator {
        weak var view: NSView?
        var gridSpacing: Double
        var action: @MainActor (PlanKeyboardCommand) -> Void
        nonisolated(unsafe) private var eventMonitor: Any?

        init(
            gridSpacing: Double,
            action: @escaping @MainActor (PlanKeyboardCommand) -> Void
        ) {
            self.gridSpacing = gridSpacing
            self.action = action
        }

        func install() {
            guard unsafe eventMonitor == nil else { return }
            unsafe eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                let windowNumber = event.windowNumber
                let keyCode = event.keyCode
                let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                let hasCommandModifier = !modifiers.intersection([.command, .control, .option]).isEmpty
                guard !hasCommandModifier else { return event }

                let handled = MainActor.assumeIsolated {
                    self?.handle(keyCode: keyCode, windowNumber: windowNumber) ?? false
                }
                return handled ? nil : event
            }
        }

        private func handle(keyCode: UInt16, windowNumber: Int) -> Bool {
            guard let view,
                  unsafe windowNumber == view.window?.windowNumber,
                  !(unsafe view.window?.firstResponder is NSTextView) else { return false }
            let command: PlanKeyboardCommand
            switch keyCode {
            case 9: command = .select // V
            case 13: command = .wall // W
            case 2: command = .door // D
            case 5: command = .window // G (glass)
            case 14: command = .erase // E
            case 11: command = .rotate // B
            case 51, 117: command = .delete
            case 123: command = .nudge(dx: -gridSpacing, dz: 0)
            case 124: command = .nudge(dx: gridSpacing, dz: 0)
            case 125: command = .nudge(dx: 0, dz: -gridSpacing)
            case 126: command = .nudge(dx: 0, dz: gridSpacing)
            default: return false
            }
            action(command)
            return true
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

/// Esc always cancels the active placement or drag, even mid-gesture.
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

/// Raw mouse-wheel deltas with the pointer's location, so the plan can zoom
/// around the cursor.
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

/// Space-drag and middle-mouse drag pan the plan.
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
