import MetalKit
import simd

private struct RoomVertex: Sendable {
    var position: SIMD4<Float>
    var normal: SIMD4<Float>
    var color: SIMD4<Float>
    var surface: SIMD4<Float> // u, v, material id, unused
}

private struct FrameUniforms: Sendable {
    var viewProjection: simd_float4x4
    var cameraExposure: SIMD4<Float>
}

private enum Surface: Float, Sendable {
    case plaster = 0
    case marble = 1
    case stairWood = 2
    case metal = 3
    case glass = 4
    case drywall = 5
    case bathroomTile = 6
}

private struct RoomMesh: Sendable {
    var opaque: [RoomVertex]
    var translucent: [RoomVertex]

    var vertexCount: Int { opaque.count + translucent.count }
}

@MainActor
final class RoomRenderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let opaquePipeline: MTLRenderPipelineState
    private let translucentPipeline: MTLRenderPipelineState
    private let opaqueDepthState: MTLDepthStencilState
    private let translucentDepthState: MTLDepthStencilState
    private weak var view: InteractiveMetalView?
    private var opaqueVertexBuffer: MTLBuffer?
    private var translucentVertexBuffer: MTLBuffer?
    private var opaqueVertexCount = 0
    private var translucentVertexCount = 0
    private var currentPlan: FloorPlan
    private var lastFrameTime = CACurrentMediaTime()
    private var metricsElapsed: Double = 0
    private var metricsFrames = 0
    private var geometryGeneration: UInt = 0
    private var geometryTask: Task<Void, Never>?

    var onMetrics: @MainActor (RenderMetrics) -> Void

    private var cameraPosition = SIMD3<Float>(2.43, 1.65, 1.60)
    private var yaw: Float = 0
    private var pitch: Float = 0

    init(
        view: InteractiveMetalView,
        plan: FloorPlan,
        onMetrics: @escaping @MainActor (RenderMetrics) -> Void
    ) throws {
        guard let device = view.device, let queue = device.makeCommandQueue() else {
            throw RendererError.noDevice
        }
        self.device = device
        commandQueue = queue
        self.view = view
        currentPlan = plan
        self.onMetrics = onMetrics

        let compileOptions = MTLCompileOptions()
        if #available(macOS 26.0, *) {
            compileOptions.languageVersion = .version4_0
        } else if #available(macOS 15.0, *) {
            compileOptions.languageVersion = .version3_2
        } else {
            compileOptions.languageVersion = .version3_1
        }
        if #available(macOS 15.0, *) {
            compileOptions.mathMode = .fast
            compileOptions.mathFloatingPointFunctions = .fast
        }
        let library = try device.makeLibrary(source: Self.shaderSource, options: compileOptions)

        let opaqueDescriptor = MTLRenderPipelineDescriptor()
        opaqueDescriptor.label = "M3 opaque architecture"
        opaqueDescriptor.vertexFunction = library.makeFunction(name: "room_vertex")
        opaqueDescriptor.fragmentFunction = library.makeFunction(name: "room_fragment")
        opaqueDescriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        opaqueDescriptor.depthAttachmentPixelFormat = view.depthStencilPixelFormat
        opaqueDescriptor.rasterSampleCount = view.sampleCount
        opaquePipeline = try device.makeRenderPipelineState(descriptor: opaqueDescriptor)

        guard let translucentDescriptor = opaqueDescriptor.copy() as? MTLRenderPipelineDescriptor else {
            throw RendererError.pipelineDescriptorCopy
        }
        translucentDescriptor.label = "M3 translucent glazing"
        translucentDescriptor.colorAttachments[0].isBlendingEnabled = true
        translucentDescriptor.colorAttachments[0].rgbBlendOperation = .add
        translucentDescriptor.colorAttachments[0].alphaBlendOperation = .add
        translucentDescriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        translucentDescriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        translucentDescriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        translucentDescriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        translucentPipeline = try device.makeRenderPipelineState(descriptor: translucentDescriptor)

        let opaqueDepthDescriptor = MTLDepthStencilDescriptor()
        opaqueDepthDescriptor.depthCompareFunction = .less
        opaqueDepthDescriptor.isDepthWriteEnabled = true
        guard let opaqueDepth = device.makeDepthStencilState(descriptor: opaqueDepthDescriptor) else {
            throw RendererError.noDepthState
        }
        opaqueDepthState = opaqueDepth

        let translucentDepthDescriptor = MTLDepthStencilDescriptor()
        translucentDepthDescriptor.depthCompareFunction = .lessEqual
        translucentDepthDescriptor.isDepthWriteEnabled = false
        guard let translucentDepth = device.makeDepthStencilState(descriptor: translucentDepthDescriptor) else {
            throw RendererError.noDepthState
        }
        translucentDepthState = translucentDepth
        super.init()
        rebuildGeometry()
    }

    func update(plan: FloorPlan) {
        guard plan != currentPlan else { return }
        currentPlan = plan
        cameraPosition.x = cameraPosition.x.clamped(to: 0.2...(plan.dimensions.roomWidth - 0.2))
        cameraPosition.z = cameraPosition.z.clamped(to: 0.2...(plan.dimensions.roomLength - 0.2))
        rebuildGeometry()
    }

    func rotate(deltaX: Float, deltaY: Float) {
        yaw += deltaX * 0.0045
        pitch = (pitch - deltaY * 0.0045).clamped(to: -1.48...1.48)
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        let elapsed = now - lastFrameTime
        let delta = Float(min(elapsed, 1.0 / 15.0))
        lastFrameTime = now
        updateCamera(deltaTime: delta)

        guard let drawable = view.currentDrawable,
              let pass = view.currentRenderPassDescriptor,
              opaqueVertexCount + translucentVertexCount > 0,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }

        let aspect = Float(max(view.drawableSize.width, 1) / max(view.drawableSize.height, 1))
        let projection = simd_float4x4.perspective(fovY: .pi / 3.1, aspect: aspect, near: 0.04, far: 80)
        let forward = cameraForward
        let viewMatrix = simd_float4x4.lookAt(eye: cameraPosition, target: cameraPosition + forward, up: SIMD3<Float>(0, 1, 0))
        var uniforms = FrameUniforms(
            viewProjection: projection * viewMatrix,
            cameraExposure: SIMD4<Float>(cameraPosition.x, cameraPosition.y, cameraPosition.z, 0.86)
        )

        encoder.setCullMode(.none)
        unsafe encoder.setVertexBytes(&uniforms, length: MemoryLayout<FrameUniforms>.stride, index: 1)
        unsafe encoder.setFragmentBytes(&uniforms, length: MemoryLayout<FrameUniforms>.stride, index: 1)

        if let opaqueVertexBuffer, opaqueVertexCount > 0 {
            encoder.setRenderPipelineState(opaquePipeline)
            encoder.setDepthStencilState(opaqueDepthState)
            encoder.setVertexBuffer(opaqueVertexBuffer, offset: 0, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: opaqueVertexCount)
        }

        if let translucentVertexBuffer, translucentVertexCount > 0 {
            encoder.setRenderPipelineState(translucentPipeline)
            encoder.setDepthStencilState(translucentDepthState)
            encoder.setVertexBuffer(translucentVertexBuffer, offset: 0, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: translucentVertexCount)
        }
        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
        recordMetrics(frameDuration: elapsed)
    }

    private var cameraForward: SIMD3<Float> {
        simd_normalize(SIMD3<Float>(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)))
    }

    private func updateCamera(deltaTime: Float) {
        guard let view else { return }
        let flatForward = simd_normalize(SIMD3<Float>(sin(yaw), 0, cos(yaw)))
        let right = simd_normalize(simd_cross(SIMD3<Float>(0, 1, 0), flatForward))
        var movement = SIMD3<Float>.zero
        if view.isPressed("w") { movement += flatForward }
        if view.isPressed("s") { movement -= flatForward }
        if view.isPressed("d") { movement += right }
        if view.isPressed("a") { movement -= right }
        if view.isPressed(" ") { movement.y += 1 }
        if view.isPressed("c") { movement.y -= 1 }

        if simd_length_squared(movement) > 0 {
            let speed: Float = view.shiftPressed ? 7.0 : 3.0
            cameraPosition += simd_normalize(movement) * speed * deltaTime
            let d = currentPlan.dimensions
            cameraPosition.x = cameraPosition.x.clamped(to: 0.12...(d.roomWidth - 0.12))
            cameraPosition.y = cameraPosition.y.clamped(to: 0.18...(d.clearHeight - 0.12))
            cameraPosition.z = cameraPosition.z.clamped(to: 0.12...(d.roomLength - 0.12))
        }
    }

    private func rebuildGeometry() {
        geometryGeneration &+= 1
        let generation = geometryGeneration
        let plan = currentPlan
        geometryTask?.cancel()
        geometryTask = Task { @concurrent in
            var builder = RoomMeshBuilder(plan: plan)
            let mesh = builder.build()
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, generation == self.geometryGeneration else { return }
                self.install(mesh: mesh)
            }
        }
    }

    private func install(mesh: RoomMesh) {
        opaqueVertexCount = mesh.opaque.count
        translucentVertexCount = mesh.translucent.count
        opaqueVertexBuffer = makeBuffer(vertices: mesh.opaque, label: "Opaque room architecture")
        translucentVertexBuffer = makeBuffer(vertices: mesh.translucent, label: "Translucent room glazing")
    }

    private func makeBuffer(vertices: [RoomVertex], label: String) -> MTLBuffer? {
        guard !vertices.isEmpty else { return nil }
        let buffer = unsafe device.makeBuffer(
            bytes: vertices,
            length: vertices.count * MemoryLayout<RoomVertex>.stride,
            options: .storageModeShared
        )
        buffer?.label = label
        return buffer
    }

    private func recordMetrics(frameDuration: Double) {
        metricsFrames += 1
        metricsElapsed += frameDuration
        guard metricsElapsed >= 0.75 else { return }
        onMetrics(RenderMetrics(
            framesPerSecond: Double(metricsFrames) / metricsElapsed,
            vertexCount: opaqueVertexCount + translucentVertexCount,
            deviceName: device.name,
            sampleCount: view?.sampleCount ?? 1
        ))
        metricsFrames = 0
        metricsElapsed = 0
    }

    enum RendererError: Error {
        case noDevice
        case noDepthState
        case pipelineDescriptorCopy
    }
}

private struct RoomMeshBuilder: Sendable {
    let plan: FloorPlan
    private var opaqueVertices: [RoomVertex] = []
    private var translucentVertices: [RoomVertex] = []

    init(plan: FloorPlan) { self.plan = plan }

    mutating func build() -> RoomMesh {
        opaqueVertices.reserveCapacity(4_096)
        translucentVertices.reserveCapacity(256)
        addFloorWithStairOpening()
        addCeilingWithUpperOpening()
        addExteriorShell()
        addBathroom()
        addStairsAndRails()
        addPartitions()
        addCeilingLights()
        return RoomMesh(opaque: opaqueVertices, translucent: translucentVertices)
    }

    private mutating func addFloorWithStairOpening() {
        let d = plan.dimensions
        let hole = StairBathroomLayout(dimensions: d).lowerOpening
        let marble = SIMD4<Float>(0.82, 0.86, 0.88, 1)

        addHorizontalRect(x0: 0, x1: d.roomWidth, z0: 0, z1: hole.minZ, y: 0, color: marble, surface: .marble)
        addHorizontalRect(x0: 0, x1: hole.minX, z0: hole.minZ, z1: hole.maxZ, y: 0, color: marble, surface: .marble)
        if hole.maxX < d.roomWidth {
            addHorizontalRect(x0: hole.maxX, x1: d.roomWidth, z0: hole.minZ, z1: hole.maxZ, y: 0, color: marble, surface: .marble)
        }
        addHorizontalRect(x0: 0, x1: d.roomWidth, z0: hole.maxZ, z1: d.roomLength, y: 0, color: marble, surface: .marble)
    }

    private mutating func addCeilingWithUpperOpening() {
        let d = plan.dimensions
        let opening = StairBathroomLayout(dimensions: d).upperFlight
        let plaster = SIMD4<Float>(0.92, 0.94, 0.95, 1)

        addHorizontalRect(x0: 0, x1: d.roomWidth, z0: 0, z1: opening.minZ, y: d.clearHeight, color: plaster, surface: .plaster, normal: SIMD3<Float>(0, -1, 0))
        addHorizontalRect(x0: 0, x1: opening.minX, z0: opening.minZ, z1: opening.maxZ, y: d.clearHeight, color: plaster, surface: .plaster, normal: SIMD3<Float>(0, -1, 0))
        if opening.maxX < d.roomWidth {
            addHorizontalRect(x0: opening.maxX, x1: d.roomWidth, z0: opening.minZ, z1: opening.maxZ, y: d.clearHeight, color: plaster, surface: .plaster, normal: SIMD3<Float>(0, -1, 0))
        }
        addHorizontalRect(x0: 0, x1: d.roomWidth, z0: opening.maxZ, z1: d.roomLength, y: d.clearHeight, color: plaster, surface: .plaster, normal: SIMD3<Float>(0, -1, 0))
    }

    private mutating func addExteriorShell() {
        let d = plan.dimensions
        let t = d.exteriorWallThickness
        let wallColor = SIMD4<Float>(0.82, 0.86, 0.88, 1)

        addBox(center: SIMD3<Float>(-t / 2, d.clearHeight / 2, d.roomLength / 2), size: SIMD3<Float>(t, d.clearHeight, d.roomLength + t * 2), color: wallColor, surface: .plaster)
        addBox(center: SIMD3<Float>(d.roomWidth + t / 2, d.clearHeight / 2, d.roomLength / 2), size: SIMD3<Float>(t, d.clearHeight, d.roomLength + t * 2), color: wallColor, surface: .plaster)

        let frontWindowStart: Float = 0.34
        let frontWindowEnd = d.roomWidth - 0.34
        addWindowWall(z: 0, windowStart: frontWindowStart, windowEnd: frontWindowEnd, sill: 0.82, top: 2.72, outward: -1, paneCount: 4)

        let fixedCore = StairBathroomLayout(dimensions: d)
        addWindowWall(
            z: d.roomLength,
            windowStart: fixedCore.rearWindowStartX,
            windowEnd: fixedCore.rearWindowEndX,
            sill: 0.92,
            top: 2.55,
            outward: 1,
            paneCount: 2
        )
    }

    private mutating func addWindowWall(z: Float, windowStart: Float, windowEnd: Float, sill: Float, top: Float, outward: Float, paneCount: Int) {
        let d = plan.dimensions
        let t = d.exteriorWallThickness
        let wall = SIMD4<Float>(0.82, 0.86, 0.88, 1)
        addBox(center: SIMD3<Float>(windowStart / 2, d.clearHeight / 2, z), size: SIMD3<Float>(windowStart, d.clearHeight, t), color: wall, surface: .plaster)
        addBox(center: SIMD3<Float>((windowEnd + d.roomWidth) / 2, d.clearHeight / 2, z), size: SIMD3<Float>(d.roomWidth - windowEnd, d.clearHeight, t), color: wall, surface: .plaster)
        addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, sill / 2, z), size: SIMD3<Float>(windowEnd - windowStart, sill, t), color: wall, surface: .plaster)
        addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, (top + d.clearHeight) / 2, z), size: SIMD3<Float>(windowEnd - windowStart, d.clearHeight - top, t), color: wall, surface: .plaster)

        let glassZ = z - outward * t * 0.1
        addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, (sill + top) / 2, glassZ), size: SIMD3<Float>(windowEnd - windowStart, top - sill, 0.018), color: SIMD4<Float>(0.42, 0.68, 0.82, 0.33), surface: .glass)

        let frameColor = SIMD4<Float>(0.52, 0.57, 0.60, 1)
        addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, sill, glassZ - outward * 0.01), size: SIMD3<Float>(windowEnd - windowStart + 0.06, 0.055, 0.055), color: frameColor, surface: .metal)
        addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, top, glassZ - outward * 0.01), size: SIMD3<Float>(windowEnd - windowStart + 0.06, 0.055, 0.055), color: frameColor, surface: .metal)
        for index in 0...paneCount {
            let x = windowStart + (windowEnd - windowStart) * Float(index) / Float(paneCount)
            addBox(center: SIMD3<Float>(x, (sill + top) / 2, glassZ - outward * 0.01), size: SIMD3<Float>(0.045, top - sill, 0.055), color: frameColor, surface: .metal)
        }
        if paneCount == 4 {
            addBox(center: SIMD3<Float>((windowStart + windowEnd) / 2, sill + (top - sill) * 0.45, glassZ - outward * 0.01), size: SIMD3<Float>(windowEnd - windowStart, 0.045, 0.055), color: frameColor, surface: .metal)
        }
    }

    private mutating func addBathroom() {
        let d = plan.dimensions
        let bathroom = StairBathroomLayout(dimensions: d).bathroom
        let x0 = bathroom.minX
        let x1 = bathroom.maxX
        let z0 = bathroom.minZ
        let color = SIMD4<Float>(0.84, 0.87, 0.86, 1)
        let t: Float = min(0.08, bathroom.width * 0.09)

        addBox(center: SIMD3<Float>(x1, d.clearHeight / 2, bathroom.centerZ), size: SIMD3<Float>(t, d.clearHeight, bathroom.length), color: color, surface: .bathroomTile)
        addBox(center: SIMD3<Float>(bathroom.centerX, d.clearHeight / 2, z0), size: SIMD3<Float>(bathroom.width, d.clearHeight, t), color: color, surface: .bathroomTile)
        addBox(center: SIMD3<Float>(bathroom.centerX, d.clearHeight / 2, d.roomLength - t / 2), size: SIMD3<Float>(bathroom.width, d.clearHeight, t), color: color, surface: .bathroomTile)

        let doorWidth: Float = min(0.72, bathroom.length - 0.20)
        let doorStart = bathroom.minZ + (bathroom.length - doorWidth) / 2
        let doorEnd = doorStart + doorWidth
        addBox(center: SIMD3<Float>(x0, d.clearHeight / 2, (bathroom.minZ + doorStart) / 2), size: SIMD3<Float>(t, d.clearHeight, doorStart - bathroom.minZ), color: color, surface: .plaster)
        addBox(center: SIMD3<Float>(x0, d.clearHeight / 2, (doorEnd + bathroom.maxZ) / 2), size: SIMD3<Float>(t, d.clearHeight, bathroom.maxZ - doorEnd), color: color, surface: .plaster)
        addBox(center: SIMD3<Float>(x0, (2.1 + d.clearHeight) / 2, (doorStart + doorEnd) / 2), size: SIMD3<Float>(t, d.clearHeight - 2.1, doorWidth), color: color, surface: .plaster)
        addBox(center: SIMD3<Float>(x0 - doorWidth / 2, 1.05, doorStart), size: SIMD3<Float>(doorWidth, 2.1, 0.035), color: SIMD4<Float>(0.92, 0.93, 0.90, 1), surface: .drywall)
    }

    private mutating func addStairsAndRails() {
        let d = plan.dimensions
        let layout = StairBathroomLayout(dimensions: d)
        let upper = layout.upperFlight
        let steps = 12
        let rise = d.clearHeight / Float(steps)
        let tread = upper.width / Float(steps)
        let wood = SIMD4<Float>(0.24, 0.13, 0.08, 1)

        for index in 0..<steps {
            let height = rise * Float(index + 1)
            let x = upper.minX + tread * (Float(index) + 0.5)
            addBox(center: SIMD3<Float>(x, height / 2, upper.centerZ), size: SIMD3<Float>(tread + 0.015, height, upper.length), color: wood, surface: .stairWood)
        }

        let metal = SIMD4<Float>(0.025, 0.045, 0.055, 1)
        let upperRailZ = upper.minZ - 0.035
        for index in stride(from: 0, through: steps, by: 3) {
            let x = upper.minX + tread * Float(index)
            let y = min(d.clearHeight, rise * Float(index))
            addBeam(from: SIMD3<Float>(x, y, upperRailZ), to: SIMD3<Float>(x, y + 0.94, upperRailZ), thickness: 0.045, color: metal, surface: .metal)
        }
        addBeam(
            from: SIMD3<Float>(upper.minX, 0.94, upperRailZ),
            to: SIMD3<Float>(upper.maxX, d.clearHeight + 0.76, upperRailZ),
            thickness: 0.055,
            color: metal,
            surface: .metal
        )

        addLowerStairs(layout: layout, color: wood)

        let opening = layout.lowerOpening
        addGuardRail(from: SIMD3<Float>(opening.minX, 0, opening.minZ), to: SIMD3<Float>(opening.minX, 0, opening.maxZ), color: metal)
        addGuardRail(from: SIMD3<Float>(opening.minX, 0, opening.minZ), to: SIMD3<Float>(opening.maxX, 0, opening.minZ), color: metal)
    }

    private mutating func addLowerStairs(layout: StairBathroomLayout, color: SIMD4<Float>) {
        let d = plan.dimensions
        let flightMinZ = layout.lowerOpening.minZ
        let flightMaxZ = layout.lowerCoveredFlight.maxZ
        let steps = 17
        let tread = (flightMaxZ - flightMinZ) / Float(steps)
        let rise = d.clearHeight / Float(steps)
        let bottom = -d.clearHeight

        for index in 0..<steps {
            let top = -rise * Float(index)
            let height = max(0.04, top - bottom)
            let z = flightMinZ + tread * (Float(index) + 0.5)
            addBox(
                center: SIMD3<Float>(layout.lowerOpening.centerX, bottom + height / 2, z),
                size: SIMD3<Float>(layout.lowerOpening.width, height, tread + 0.015),
                color: color,
                surface: .stairWood
            )
        }

        let underBathroom = layout.lowerUnderBathroom
        addBox(
            center: SIMD3<Float>(underBathroom.centerX, bottom + 0.06, underBathroom.centerZ),
            size: SIMD3<Float>(underBathroom.width, 0.12, underBathroom.length),
            color: color,
            surface: .stairWood
        )
    }

    private mutating func addGuardRail(from start: SIMD3<Float>, to end: SIMD3<Float>, color: SIMD4<Float>) {
        let length = simd_length(end - start)
        let postCount = max(2, Int(length / 1.0) + 1)
        for index in 0..<postCount {
            let t = Float(index) / Float(postCount - 1)
            let point = simd_mix(start, end, SIMD3<Float>(repeating: t))
            addBeam(from: point, to: point + SIMD3<Float>(0, 1.02, 0), thickness: 0.045, color: color, surface: .metal)
        }
        for y: Float in [0.36, 0.68, 1.02] {
            addBeam(from: start + SIMD3<Float>(0, y, 0), to: end + SIMD3<Float>(0, y, 0), thickness: 0.045, color: color, surface: .metal)
        }
    }

    private mutating func addPartitions() {
        let d = plan.dimensions
        for wall in plan.partitions {
            guard wall.length > 0.001 else { continue }
            let unit = SIMD2<Float>((wall.end.x - wall.start.x) / wall.length, (wall.end.z - wall.start.z) / wall.length)
            if let door = plan.doors.first(where: { $0.wallID == wall.id }) {
                addWallRun(wall: wall, from: 0, to: door.offset, y: d.clearHeight / 2, height: d.clearHeight)
                addWallRun(wall: wall, from: door.offset + door.width, to: wall.length, y: d.clearHeight / 2, height: d.clearHeight)
                addWallRun(wall: wall, from: door.offset, to: door.offset + door.width, y: (door.height + d.clearHeight) / 2, height: d.clearHeight - door.height)

                let hingeOffset = door.hinge == .left ? door.offset : door.offset + door.width
                let hinge = SIMD3<Float>(wall.start.x + unit.x * hingeOffset, door.height / 2, wall.start.z + unit.y * hingeOffset)
                let perpendicular = SIMD3<Float>(-unit.y, 0, unit.x) * (door.hinge == .left ? 1 : -1)
                let end = hinge + perpendicular * door.width
                addBeam(from: hinge, to: end, thickness: 0.045, height: door.height, color: SIMD4<Float>(0.30, 0.20, 0.12, 1), surface: .stairWood)
            } else {
                addWallRun(wall: wall, from: 0, to: wall.length, y: d.clearHeight / 2, height: d.clearHeight)
            }
        }
    }

    private mutating func addWallRun(wall: PartitionWall, from: Float, to: Float, y: Float, height: Float) {
        guard to - from > 0.005, height > 0.005 else { return }
        let dx = (wall.end.x - wall.start.x) / wall.length
        let dz = (wall.end.z - wall.start.z) / wall.length
        let start = SIMD3<Float>(wall.start.x + dx * from, y, wall.start.z + dz * from)
        let end = SIMD3<Float>(wall.start.x + dx * to, y, wall.start.z + dz * to)
        addBeam(from: start, to: end, thickness: plan.dimensions.drywallThickness, height: height, color: SIMD4<Float>(0.88, 0.87, 0.83, 1), surface: .drywall)
    }

    private mutating func addCeilingLights() {
        let d = plan.dimensions
        let upperOpening = StairBathroomLayout(dimensions: d).upperFlight
        for z in stride(from: Float(2.2), through: d.roomLength - 1.5, by: 3.0) {
            let lightMinX = d.roomWidth / 2 - 0.525
            let lightMaxX = d.roomWidth / 2 + 0.525
            let intersectsUpperOpening = lightMaxX > upperOpening.minX && lightMinX < upperOpening.maxX && z > upperOpening.minZ && z < upperOpening.maxZ
            guard !intersectsUpperOpening else { continue }
            addBox(center: SIMD3<Float>(d.roomWidth / 2, d.clearHeight - 0.025, z), size: SIMD3<Float>(1.05, 0.035, 0.10), color: SIMD4<Float>(1, 0.93, 0.72, 1), surface: .glass)
        }
    }

    private mutating func addHorizontalRect(x0: Float, x1: Float, z0: Float, z1: Float, y: Float, color: SIMD4<Float>, surface: Surface, normal: SIMD3<Float> = SIMD3<Float>(0, 1, 0)) {
        guard x1 > x0, z1 > z0 else { return }
        addPlane(origin: SIMD3<Float>(x0, y, z0), axisU: SIMD3<Float>(x1 - x0, 0, 0), axisV: SIMD3<Float>(0, 0, z1 - z0), normal: normal, color: color, surface: surface)
    }

    private mutating func addPlane(origin: SIMD3<Float>, axisU: SIMD3<Float>, axisV: SIMD3<Float>, normal: SIMD3<Float>, color: SIMD4<Float>, surface: Surface) {
        let p0 = origin
        let p1 = origin + axisU
        let p2 = origin + axisU + axisV
        let p3 = origin + axisV
        let u = simd_length(axisU)
        let v = simd_length(axisV)
        appendQuad(p0, p1, p2, p3, normal: normal, color: color, surface: surface, uvMax: SIMD2<Float>(u, v))
    }

    private mutating func addBox(center: SIMD3<Float>, size: SIMD3<Float>, color: SIMD4<Float>, surface: Surface) {
        guard size.x > 0, size.y > 0, size.z > 0 else { return }
        let h = size / 2
        let p000 = center + SIMD3<Float>(-h.x, -h.y, -h.z)
        let p001 = center + SIMD3<Float>(-h.x, -h.y, h.z)
        let p010 = center + SIMD3<Float>(-h.x, h.y, -h.z)
        let p011 = center + SIMD3<Float>(-h.x, h.y, h.z)
        let p100 = center + SIMD3<Float>(h.x, -h.y, -h.z)
        let p101 = center + SIMD3<Float>(h.x, -h.y, h.z)
        let p110 = center + SIMD3<Float>(h.x, h.y, -h.z)
        let p111 = center + SIMD3<Float>(h.x, h.y, h.z)
        appendQuad(p001, p101, p111, p011, normal: SIMD3<Float>(0, 0, 1), color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.y))
        appendQuad(p100, p000, p010, p110, normal: SIMD3<Float>(0, 0, -1), color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.y))
        appendQuad(p000, p001, p011, p010, normal: SIMD3<Float>(-1, 0, 0), color: color, surface: surface, uvMax: SIMD2<Float>(size.z, size.y))
        appendQuad(p101, p100, p110, p111, normal: SIMD3<Float>(1, 0, 0), color: color, surface: surface, uvMax: SIMD2<Float>(size.z, size.y))
        appendQuad(p010, p011, p111, p110, normal: SIMD3<Float>(0, 1, 0), color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.z))
        appendQuad(p000, p100, p101, p001, normal: SIMD3<Float>(0, -1, 0), color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.z))
    }

    private mutating func addBeam(from start: SIMD3<Float>, to end: SIMD3<Float>, thickness: Float, height: Float? = nil, color: SIMD4<Float>, surface: Surface) {
        let direction = end - start
        let length = simd_length(direction)
        guard length > 0.001 else { return }
        let center = (start + end) / 2
        let yHeight = height ?? thickness
        if abs(direction.y) < 0.001 {
            let yaw = atan2(direction.x, direction.z)
            addOrientedBox(center: center, size: SIMD3<Float>(thickness, yHeight, length), yaw: yaw, color: color, surface: surface)
        } else {
            let forward = direction / length
            let reference = abs(simd_dot(forward, SIMD3<Float>(0, 1, 0))) > 0.94 ? SIMD3<Float>(1, 0, 0) : SIMD3<Float>(0, 1, 0)
            let right = simd_normalize(simd_cross(reference, forward))
            let up = simd_normalize(simd_cross(forward, right))
            addBasisBox(center: center, right: right, up: up, forward: forward, size: SIMD3<Float>(thickness, thickness, length), color: color, surface: surface)
        }
    }

    private mutating func addOrientedBox(center: SIMD3<Float>, size: SIMD3<Float>, yaw: Float, color: SIMD4<Float>, surface: Surface) {
        let right = SIMD3<Float>(cos(yaw), 0, -sin(yaw))
        let up = SIMD3<Float>(0, 1, 0)
        let forward = SIMD3<Float>(sin(yaw), 0, cos(yaw))
        addBasisBox(center: center, right: right, up: up, forward: forward, size: size, color: color, surface: surface)
    }

    private mutating func addBasisBox(center: SIMD3<Float>, right: SIMD3<Float>, up: SIMD3<Float>, forward: SIMD3<Float>, size: SIMD3<Float>, color: SIMD4<Float>, surface: Surface) {
        let r = right * size.x / 2
        let u = up * size.y / 2
        let f = forward * size.z / 2
        let p000 = center - r - u - f
        let p001 = center - r - u + f
        let p010 = center - r + u - f
        let p011 = center - r + u + f
        let p100 = center + r - u - f
        let p101 = center + r - u + f
        let p110 = center + r + u - f
        let p111 = center + r + u + f
        appendQuad(p001, p101, p111, p011, normal: forward, color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.y))
        appendQuad(p100, p000, p010, p110, normal: -forward, color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.y))
        appendQuad(p000, p001, p011, p010, normal: -right, color: color, surface: surface, uvMax: SIMD2<Float>(size.z, size.y))
        appendQuad(p101, p100, p110, p111, normal: right, color: color, surface: surface, uvMax: SIMD2<Float>(size.z, size.y))
        appendQuad(p010, p011, p111, p110, normal: up, color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.z))
        appendQuad(p000, p100, p101, p001, normal: -up, color: color, surface: surface, uvMax: SIMD2<Float>(size.x, size.z))
    }

    private mutating func appendQuad(_ p0: SIMD3<Float>, _ p1: SIMD3<Float>, _ p2: SIMD3<Float>, _ p3: SIMD3<Float>, normal: SIMD3<Float>, color: SIMD4<Float>, surface: Surface, uvMax: SIMD2<Float>) {
        let points = [p0, p1, p2, p0, p2, p3]
        let uvs = [SIMD2<Float>(0, 0), SIMD2<Float>(uvMax.x, 0), uvMax, SIMD2<Float>(0, 0), uvMax, SIMD2<Float>(0, uvMax.y)]
        let isTranslucent = surface == .glass && color.w < 0.999
        for (point, uv) in zip(points, uvs) {
            let vertex = RoomVertex(
                position: SIMD4<Float>(point.x, point.y, point.z, 1),
                normal: SIMD4<Float>(normal.x, normal.y, normal.z, 0),
                color: color,
                surface: SIMD4<Float>(uv.x, uv.y, surface.rawValue, 0)
            )
            if isTranslucent {
                translucentVertices.append(vertex)
            } else {
                opaqueVertices.append(vertex)
            }
        }
    }
}

private extension simd_float4x4 {
    static func perspective(fovY: Float, aspect: Float, near: Float, far: Float) -> simd_float4x4 {
        let y = 1 / tan(fovY * 0.5)
        let x = y / aspect
        let z = far / (far - near)
        return simd_float4x4(columns: (
            SIMD4<Float>(x, 0, 0, 0),
            SIMD4<Float>(0, y, 0, 0),
            SIMD4<Float>(0, 0, z, 1),
            SIMD4<Float>(0, 0, -near * z, 0)
        ))
    }

    static func lookAt(eye: SIMD3<Float>, target: SIMD3<Float>, up: SIMD3<Float>) -> simd_float4x4 {
        let z = simd_normalize(target - eye)
        let x = simd_normalize(simd_cross(up, z))
        let y = simd_cross(z, x)
        return simd_float4x4(columns: (
            SIMD4<Float>(x.x, y.x, z.x, 0),
            SIMD4<Float>(x.y, y.y, z.y, 0),
            SIMD4<Float>(x.z, y.z, z.z, 0),
            SIMD4<Float>(-simd_dot(x, eye), -simd_dot(y, eye), -simd_dot(z, eye), 1)
        ))
    }
}

private extension RoomRenderer {
    static let shaderSource = #"""
    #include <metal_stdlib>
    using namespace metal;

    struct VertexIn {
        float4 position;
        float4 normal;
        float4 color;
        float4 surface;
    };

    struct Uniforms {
        float4x4 viewProjection;
        float4 cameraExposure;
    };

    struct VertexOut {
        float4 position [[position]];
        float3 worldPosition;
        float3 normal;
        float4 color;
        float4 surface;
    };

    vertex VertexOut room_vertex(uint vertexID [[vertex_id]],
                                 constant VertexIn *vertices [[buffer(0)]],
                                 constant Uniforms &uniforms [[buffer(1)]]) {
        VertexIn input = vertices[vertexID];
        VertexOut out;
        out.position = uniforms.viewProjection * input.position;
        out.worldPosition = input.position.xyz;
        out.normal = normalize(input.normal.xyz);
        out.color = input.color;
        out.surface = input.surface;
        return out;
    }

    float hash21(float2 p) {
        p = fract(p * float2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }

    fragment float4 room_fragment(VertexOut in [[stage_in]],
                                   constant Uniforms &uniforms [[buffer(1)]]) {
        float3 n = normalize(in.normal);
        float3 v = normalize(uniforms.cameraExposure.xyz - in.worldPosition);
        float material = in.surface.z;
        float3 base = in.color.rgb;
        float roughness = 0.72;
        float alpha = in.color.a;

        if (material > 0.5 && material < 1.5) {
            float2 p = in.worldPosition.xz;
            float broad = sin(p.x * 2.3 + sin(p.y * 1.1) * 1.9);
            float fine = sin(p.x * 13.0 + p.y * 7.0 + hash21(floor(p * 3.0)) * 5.0);
            float vein = smoothstep(0.76, 0.98, abs(broad * 0.72 + fine * 0.28));
            float groutX = smoothstep(0.965, 0.995, abs(fract(p.x / 0.60) * 2.0 - 1.0));
            float groutZ = smoothstep(0.965, 0.995, abs(fract(p.y / 0.60) * 2.0 - 1.0));
            base = mix(float3(0.86, 0.89, 0.90), float3(0.36, 0.40, 0.42), vein * 0.72);
            base = mix(base, float3(0.57), max(groutX, groutZ) * 0.35);
            roughness = 0.16;
        } else if (material > 1.5 && material < 2.5) {
            float grain = sin(in.surface.x * 19.0 + sin(in.surface.y * 8.0) * 2.4);
            base *= 0.78 + grain * 0.09;
            roughness = 0.38;
        } else if (material > 2.5 && material < 3.5) {
            roughness = 0.23;
        } else if (material > 3.5 && material < 4.5) {
            base = mix(float3(0.24, 0.49, 0.62), float3(0.72, 0.88, 0.96), pow(1.0 - max(dot(n, v), 0.0), 3.0));
            roughness = 0.05;
            alpha = in.color.a;
        } else if (material > 5.5) {
            float grout = max(smoothstep(0.94, 0.99, abs(fract(in.surface.x / 0.45) * 2.0 - 1.0)),
                              smoothstep(0.94, 0.99, abs(fract(in.surface.y / 0.45) * 2.0 - 1.0)));
            base = mix(float3(0.82, 0.82, 0.77), float3(0.57), grout * 0.25);
            roughness = 0.35;
        }

        float3 ambient = float3(0.14, 0.17, 0.20);
        float3 sunDir = normalize(float3(-0.55, 0.78, -0.35));
        float ndl = max(dot(n, sunDir), 0.0);
        float3 lighting = ambient + float3(1.05, 0.98, 0.86) * ndl * 0.56;

        for (int i = 0; i < 5; ++i) {
            float3 lightPos = float3(2.43, 3.42, 2.2 + float(i) * 3.0);
            float3 delta = lightPos - in.worldPosition;
            float distance2 = max(dot(delta, delta), 0.3);
            float3 l = normalize(delta);
            float diffuse = max(dot(n, l), 0.0);
            lighting += float3(1.0, 0.82, 0.61) * diffuse * (2.0 / distance2);
        }

        float3 halfVector = normalize(sunDir + v);
        float specularPower = mix(18.0, 150.0, 1.0 - roughness);
        float specular = pow(max(dot(n, halfVector), 0.0), specularPower) * (1.0 - roughness) * 0.75;
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
        float3 color = base * lighting + specular + fresnel * (1.0 - roughness) * 0.18;
        color = color / (color + 0.72);
        color = pow(color, float3(1.0 / 2.2));
        return float4(color * uniforms.cameraExposure.w, alpha);
    }
    """#
}
