import AppKit
import MetalKit
import SwiftUI

struct RenderMetrics: Equatable, Sendable {
    var framesPerSecond: Double = 0
    var vertexCount: Int = 0
    var deviceName = "Apple GPU"
    var sampleCount = 1

    var summary: String {
        let fps = framesPerSecond.formatted(.number.precision(.fractionLength(0)))
        return "\(fps) FPS · \(vertexCount.formatted()) vertices · \(sampleCount)× MSAA · \(deviceName)"
    }
}

struct MetalCanvas: NSViewRepresentable {
    let plan: FloorPlan
    let onMetrics: @MainActor (RenderMetrics) -> Void

    func makeNSView(context: Context) -> InteractiveMetalView {
        let view = InteractiveMetalView(frame: .zero)
        view.configure(plan: plan, onMetrics: onMetrics)
        return view
    }

    func updateNSView(_ view: InteractiveMetalView, context: Context) {
        view.update(plan: plan, onMetrics: onMetrics)
    }
}

@MainActor
final class InteractiveMetalView: MTKView {
    private(set) var pressedKeys: Set<Character> = []
    private(set) var shiftPressed = false
    private var renderer: RoomRenderer?

    override var acceptsFirstResponder: Bool { true }

    func configure(plan: FloorPlan, onMetrics: @escaping @MainActor (RenderMetrics) -> Void) {
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        self.device = device
        colorPixelFormat = .bgra8Unorm_srgb
        depthStencilPixelFormat = .depth32Float
        let preferredSamples = device.name == "Apple M3" ? 2 : 4
        sampleCount = device.supportsTextureSampleCount(preferredSamples) ? preferredSamples : 1
        preferredFramesPerSecond = 60
        enableSetNeedsDisplay = false
        isPaused = false
        framebufferOnly = true
        presentsWithTransaction = false
        autoResizeDrawable = true
        clearColor = MTLClearColor(red: 0.045, green: 0.065, blue: 0.09, alpha: 1)

        do {
            let renderer = try RoomRenderer(view: self, plan: plan, onMetrics: onMetrics)
            self.renderer = renderer
            delegate = renderer
        } catch {
            Swift.print("Metal renderer setup failed: \(error)")
        }
    }

    func update(plan: FloorPlan, onMetrics: @escaping @MainActor (RenderMetrics) -> Void) {
        renderer?.onMetrics = onMetrics
        renderer?.update(plan: plan)
    }

    func isPressed(_ key: Character) -> Bool { pressedKeys.contains(key) }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        unsafe window?.makeFirstResponder(self)
    }

    override func mouseDown(with event: NSEvent) {
        unsafe window?.makeFirstResponder(self)
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
