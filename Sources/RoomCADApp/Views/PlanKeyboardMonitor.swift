import AppKit
import SwiftUI

enum PlanKeyboardCommand: Sendable {
    case inspect
    case wall
    case door
    case erase
    case rotate
    case delete
    case nudge(dx: Float, dz: Float)
}

/// Window-scoped plan controls that deliberately stand down while a text field
/// is editing, so game-like hotkeys never steal search or measurement input.
struct PlanKeyboardMonitor: NSViewRepresentable {
    var gridSpacing: Float
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
        var gridSpacing: Float
        var action: @MainActor (PlanKeyboardCommand) -> Void
        nonisolated(unsafe) private var eventMonitor: Any?

        init(
            gridSpacing: Float,
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
            case 9: command = .inspect // V
            case 13: command = .wall // W
            case 2: command = .door // D
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
