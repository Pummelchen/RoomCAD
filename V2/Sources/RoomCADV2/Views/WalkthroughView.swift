import AppKit
import SceneKit
import SwiftUI

struct WalkthroughView: View {
    let store: RoomStore

    var body: some View {
        WalkthroughSceneView(room: store.room)
            .overlay(alignment: .bottom) {
                Text("WASD or arrow keys to walk · drag mouse to look around")
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 10)
            }
    }
}

struct WalkthroughSceneView: NSViewRepresentable {
    let room: RoomPlan

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> FirstPersonSCNView {
        let view = FirstPersonSCNView(frame: .zero)
        view.controller = context.coordinator
        view.allowsCameraControl = false
        view.autoenablesDefaultLighting = false
        view.antialiasingMode = .multisampling4X
        view.backgroundColor = NSColor(red: 0.86, green: 0.89, blue: 0.94, alpha: 1)
        view.rendersContinuously = true
        context.coordinator.attach(view: view, room: room)
        return view
    }

    func updateNSView(_ nsView: FirstPersonSCNView, context: Context) {
        context.coordinator.update(room: room, view: nsView)
    }

    @MainActor
    final class Coordinator {
        private var room: RoomPlan?
        private weak var view: FirstPersonSCNView?
        private var cameraNode: SCNNode?
        private var yaw: Double = 0
        private var pitch: Double = 0
        private var position = SIMD3<Double>(3, 1.5, 3)
        private var pressedKeys: Set<UInt16> = []
        nonisolated(unsafe) private var timer: Timer?

        deinit {
            timer?.invalidate()
        }

        func attach(view: FirstPersonSCNView, room: RoomPlan) {
            self.view = view
            self.room = nil
            update(room: room, view: view)
            startTimer()
        }

        func update(room: RoomPlan, view: FirstPersonSCNView) {
            let changed = self.room.map { $0 != room } ?? true
            guard changed else { return }
            if let previous = self.room,
               previous.id == room.id,
               previous.width == room.width,
               previous.length == room.length {
                // Same room, keep walking where you were.
            } else {
                position = Self.startingPosition(for: room)
                yaw = 0
                pitch = 0
            }
            self.room = room
            view.scene = RoomSceneBuilder.makeScene(room: room)
            cameraNode = view.scene?.rootNode.childNode(withName: "camera", recursively: false)
            applyCamera()
        }

        private func startTimer() {
            timer?.invalidate()
            let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        }

        func keyDown(_ event: NSEvent) {
            if !event.isARepeat {
                pressedKeys.insert(event.keyCode)
            }
        }

        func keyUp(_ event: NSEvent) {
            pressedKeys.remove(event.keyCode)
        }

        func look(dx: Double, dy: Double) {
            yaw -= dx * 0.005
            pitch = (pitch - dy * 0.005).clamped(to: -1.4...1.4)
            applyCamera()
        }

        private func tick() {
            guard cameraNode != nil, let room else { return }
            var forward = 0.0
            var right = 0.0
            if pressedKeys.contains(13) || pressedKeys.contains(126) { forward += 1 }
            if pressedKeys.contains(1) || pressedKeys.contains(125) { forward -= 1 }
            if pressedKeys.contains(0) { right -= 1 }
            if pressedKeys.contains(2) { right += 1 }
            guard forward != 0 || right != 0 else { return }

            let length = max(1, hypot(forward, right))
            let forwardVector = SIMD2<Double>(sin(yaw), -cos(yaw))
            let rightVector = SIMD2<Double>(cos(yaw), sin(yaw))
            let velocity = (forwardVector * (forward / length) + rightVector * (right / length)) * 2.5
            let dt = 1.0 / 60.0

            var next = position
            let candidateX = PlanPoint(x: next.x + velocity.x * dt, z: next.z)
            if !room.blocksPlayer(at: candidateX, radius: 0.28) {
                next.x = candidateX.x
            }
            let candidateZ = PlanPoint(x: next.x, z: next.z + velocity.y * dt)
            if !room.blocksPlayer(at: candidateZ, radius: 0.28) {
                next.z = candidateZ.z
            }
            next.x = next.x.clamped(to: 0.3...(room.width - 0.3))
            next.z = next.z.clamped(to: 0.3...(room.length - 0.3))
            position = next
            applyCamera()
        }

        private func applyCamera() {
            guard let cameraNode else { return }
            cameraNode.position = SCNVector3(position.x, position.y, position.z)
            cameraNode.eulerAngles = SCNVector3(pitch, yaw, 0)
        }

        private static func startingPosition(for room: RoomPlan) -> SIMD3<Double> {
            SIMD3(room.width / 2, 1.5, max(0.5, room.length - 0.6))
        }
    }
}

/// SCNView that forwards keyboard and mouse input to the walk controller.
final class FirstPersonSCNView: SCNView {
    weak var controller: WalkthroughSceneView.Coordinator?

    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }

    override func keyDown(with event: NSEvent) {
        controller?.keyDown(event)
    }

    override func keyUp(with event: NSEvent) {
        controller?.keyUp(event)
    }

    override func mouseDragged(with event: NSEvent) {
        controller?.look(dx: Double(event.deltaX), dy: Double(event.deltaY))
    }
}

// MARK: - Scene building

@MainActor
enum RoomSceneBuilder {
    static func makeScene(room: RoomPlan) -> SCNScene {
        let scene = SCNScene()
        let root = scene.rootNode

        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.color = NSColor(white: 0.62, alpha: 1)
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        root.addChildNode(ambientNode)

        let sun = SCNLight()
        sun.type = .directional
        sun.color = NSColor(white: 1, alpha: 1)
        let sunNode = SCNNode()
        sunNode.light = sun
        sunNode.eulerAngles = SCNVector3(-Double.pi / 3, 0.5, 0)
        root.addChildNode(sunNode)

        // Floor
        let floor = SCNBox(width: room.width, height: 0.06, length: room.length, chamferRadius: 0)
        floor.firstMaterial?.diffuse.contents = NSColor(red: 0.92, green: 0.88, blue: 0.79, alpha: 1)
        let floorNode = SCNNode(geometry: floor)
        floorNode.position = SCNVector3(room.width / 2, -0.03, room.length / 2)
        root.addChildNode(floorNode)

        // Ceiling
        let ceiling = SCNBox(width: room.width, height: 0.05, length: room.length, chamferRadius: 0)
        ceiling.firstMaterial?.diffuse.contents = NSColor(white: 0.97, alpha: 1)
        let ceilingNode = SCNNode(geometry: ceiling)
        ceilingNode.position = SCNVector3(room.width / 2, room.height, room.length / 2)
        root.addChildNode(ceilingNode)

        // Walls with door and window openings
        for wall in room.walls {
            let plan = WallBuildPlan(
                wall: wall,
                doors: room.doors,
                windows: room.windows,
                height: room.height
            )
            addWallPlan(plan, height: room.height, to: root)
        }

        // Furniture
        for item in room.furniture {
            addFurniture(item, to: root)
        }

        // First-person camera
        let camera = SCNCamera()
        camera.zNear = 0.05
        camera.zFar = 100
        let cameraNode = SCNNode()
        cameraNode.name = "camera"
        cameraNode.camera = camera
        root.addChildNode(cameraNode)

        return scene
    }

    private static func addWallPlan(_ plan: WallBuildPlan, height: Double, to root: SCNNode) {
        let wallColor = NSColor(red: 0.93, green: 0.91, blue: 0.87, alpha: 1)
        let glassColor = NSColor(red: 0.55, green: 0.80, blue: 0.95, alpha: 0.55)
        let leafColor = NSColor(red: 0.62, green: 0.44, blue: 0.28, alpha: 1)

        let sill = min(WallBuildPlan.sillHeight, height)
        let glassTop = min(sill + WallBuildPlan.glassHeight, height)
        let doorTop = min(WallBuildPlan.doorHeight, height)

        for span in plan.baseSpans {
            addBox(
                span: span,
                height0: 0,
                height1: sill,
                thickness: WallBuildPlan.wallThickness,
                color: wallColor,
                wall: plan.wall,
                to: root
            )
        }
        for span in plan.midSpans {
            addBox(
                span: span,
                height0: sill,
                height1: doorTop,
                thickness: WallBuildPlan.wallThickness,
                color: wallColor,
                wall: plan.wall,
                to: root
            )
        }
        for span in plan.glassSpans {
            addBox(
                span: span,
                height0: sill,
                height1: glassTop,
                thickness: WallBuildPlan.wallThickness * 0.55,
                color: glassColor,
                wall: plan.wall,
                to: root
            )
        }
        for span in plan.stripSpans {
            addBox(
                span: span,
                height0: glassTop,
                height1: doorTop,
                thickness: WallBuildPlan.wallThickness,
                color: wallColor,
                wall: plan.wall,
                to: root
            )
        }
        if doorTop < height {
            addBox(
                span: plan.headerSpan,
                height0: doorTop,
                height1: height,
                thickness: WallBuildPlan.wallThickness,
                color: wallColor,
                wall: plan.wall,
                to: root
            )
        }
        for span in plan.doorLeafSpans {
            addBox(
                span: span,
                height0: 0,
                height1: doorTop,
                thickness: 0.045,
                color: leafColor,
                wall: plan.wall,
                to: root
            )
        }
    }

    private static func addBox(
        span: WallSpan,
        height0: Double,
        height1: Double,
        thickness: Double,
        color: NSColor,
        wall: Wall,
        to root: SCNNode
    ) {
        let boxHeight = height1 - height0
        guard boxHeight > 0.001, span.length > 0.001 else { return }
        let geometry = SCNBox(width: thickness, height: boxHeight, length: span.length, chamferRadius: 0)
        geometry.firstMaterial?.diffuse.contents = color
        let node = SCNNode(geometry: geometry)
        let center = wall.point(atOffset: (span.from + span.to) / 2)
        node.position = SCNVector3(center.x, (height0 + height1) / 2, center.z)
        let angle = atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x)
        node.eulerAngles = SCNVector3(0, .pi / 2 - angle, 0)
        root.addChildNode(node)
    }

    private static func addFurniture(_ item: FurnitureItem, to root: SCNNode) {
        let kind = item.kind
        let color = NSColor(
            red: kind.color.red,
            green: kind.color.green,
            blue: kind.color.blue,
            alpha: 1
        )
        let geometry = SCNBox(
            width: item.orientedWidth,
            height: kind.dimensions.height,
            length: item.orientedDepth,
            chamferRadius: 0
        )
        geometry.firstMaterial?.diffuse.contents = color
        let node = SCNNode(geometry: geometry)
        node.position = SCNVector3(item.center.x, kind.dimensions.height / 2, item.center.z)
        node.eulerAngles = SCNVector3(0, -item.rotationDegrees * .pi / 180, 0)
        root.addChildNode(node)
    }
}
