import AppKit
import MetalKit
import SwiftUI

struct MetalCanvas: NSViewRepresentable {
    let plan: FloorPlan

    func makeNSView(context: Context) -> InteractiveMetalView {
        let view = InteractiveMetalView(frame: .zero)
        view.configure(plan: plan)
        return view
    }

    func updateNSView(_ view: InteractiveMetalView, context: Context) {
        view.update(plan: plan)
    }
}

@MainActor
final class InteractiveMetalView: MTKView {
    private(set) var pressedKeys: Set<Character> = []
    private(set) var shiftPressed = false
    private var renderer: RoomRenderer?

    override var acceptsFirstResponder: Bool { true }

    func configure(plan: FloorPlan) {
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        self.device = device
        colorPixelFormat = .bgra8Unorm_srgb
        depthStencilPixelFormat = .depth32Float
        sampleCount = 4
        preferredFramesPerSecond = 60
        enableSetNeedsDisplay = false
        isPaused = false
        framebufferOnly = true
        clearColor = MTLClearColor(red: 0.045, green: 0.065, blue: 0.09, alpha: 1)

        do {
            let renderer = try RoomRenderer(view: self, plan: plan)
            self.renderer = renderer
            delegate = renderer
        } catch {
            Swift.print("Metal renderer setup failed: \(error)")
        }
    }

    func update(plan: FloorPlan) {
        renderer?.update(plan: plan)
    }

    func isPressed(_ key: Character) -> Bool { pressedKeys.contains(key) }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
    }

    override func mouseDragged(with event: NSEvent) {
        renderer?.rotate(deltaX: Float(event.deltaX), deltaY: Float(event.deltaY))
    }

    override func rightMouseDragged(with event: NSEvent) {
        renderer?.rotate(deltaX: Float(event.deltaX), deltaY: Float(event.deltaY))
    }

    override func keyDown(with event: NSEvent) {
        updateKey(event, pressed: true)
    }

    override func keyUp(with event: NSEvent) {
        updateKey(event, pressed: false)
    }

    override func flagsChanged(with event: NSEvent) {
        shiftPressed = event.modifierFlags.contains(.shift)
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .crosshair)
    }

    private func updateKey(_ event: NSEvent, pressed: Bool) {
        guard let character = event.charactersIgnoringModifiers?.lowercased().first else { return }
        if pressed { pressedKeys.insert(character) } else { pressedKeys.remove(character) }
    }
}
