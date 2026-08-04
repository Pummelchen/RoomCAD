import AppKit
import SwiftUI

/// Keeps the main SwiftUI window explicitly border-resizable. SwiftUI can
/// otherwise derive a fixed AppKit style while resolving a split view and its
/// inspector, even though the content itself has flexible dimensions.
struct ResizableWindowConfigurator: NSViewRepresentable {
    var minimumContentSize: NSSize

    func makeNSView(context: Context) -> ResizableWindowView {
        ResizableWindowView(minimumContentSize: minimumContentSize)
    }

    func updateNSView(_ nsView: ResizableWindowView, context: Context) {
        nsView.minimumContentSize = minimumContentSize
        nsView.configureWindow()
    }
}

final class ResizableWindowView: NSView {
    var minimumContentSize: NSSize

    init(minimumContentSize: NSSize) {
        self.minimumContentSize = minimumContentSize
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureWindow()
    }

    func configureWindow() {
        guard let window = unsafe self.window else { return }
        window.styleMask.insert(.resizable)
        window.contentMinSize = minimumContentSize
        window.contentMaxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        window.resizeIncrements = NSSize(width: 1, height: 1)
    }
}
