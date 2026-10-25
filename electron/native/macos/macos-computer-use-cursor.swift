import AppKit
import CoreGraphics
import ImageIO
import QuartzCore

// A non-interactive indicator for product-owned input, not a system cursor preference.
private final class ComputerUsePointerPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class ComputerUsePointer {
    static let shared = ComputerUsePointer()
    private var panel: NSPanel?
    private var timer: Timer?
    private var cursorHidden = false
    private var lastPoint = CGPoint.zero
    private var lastInput = ProcessInfo.processInfo.systemUptime
    private var ownerPID: pid_t = 0
    private let images: [CGImage] = ComputerUseCursorFrames.png.compactMap { encoded in
        guard let data = Data(base64Encoded: encoded),
              let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    func show(at point: CGPoint, ownerPID: pid_t) {
        guard !images.isEmpty, let primary = NSScreen.screens.first else { return }
        if panel == nil {
            let size = NSSize(width: ComputerUseCursorFrames.width, height: ComputerUseCursorFrames.height)
            let window = ComputerUsePointerPanel(contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.title = "Lime Computer Use Pointer"
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = false
            window.ignoresMouseEvents = true
            window.hidesOnDeactivate = false
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.cursorWindow)))
            let view = NSView(frame: NSRect(origin: .zero, size: size))
            view.setAccessibilityElement(false)
            view.setAccessibilityHidden(true)
            view.wantsLayer = true
            view.layer?.contents = images[0]
            view.layer?.contentsScale = 2
            window.contentView = view
            panel = window
        }
        if !cursorHidden {
            guard CGDisplayHideCursor(CGMainDisplayID()) == .success else { return }
            cursorHidden = true
            if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                let animation = CAKeyframeAnimation(keyPath: "contents")
                animation.values = images
                animation.duration = ComputerUseCursorFrames.duration
                animation.calculationMode = .discrete
                animation.repeatCount = .infinity
                panel?.contentView?.layer?.add(animation, forKey: "lime-gradient")
            } else {
                panel?.contentView?.layer?.removeAnimation(forKey: "lime-gradient")
            }
        }
        lastPoint = point
        self.ownerPID = ownerPID
        lastInput = ProcessInfo.processInfo.systemUptime
        // Quartz uses the primary display's top-left; AppKit uses its bottom-left.
        panel?.setFrameOrigin(NSPoint(x: point.x - ComputerUseCursorFrames.hotspotX,
            y: primary.frame.maxY - point.y - ComputerUseCursorFrames.height + ComputerUseCursorFrames.hotspotY))
        panel?.orderFrontRegardless()
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                guard let self else { return }
                let pointer = CGEvent(source: nil)?.location
                // Restore immediately when the user takes over, or input becomes idle.
                if pointer == nil || abs(pointer!.x - self.lastPoint.x) > 2 || abs(pointer!.y - self.lastPoint.y) > 2
                    || computerUseLocked()
                    || NSWorkspace.shared.frontmostApplication?.processIdentifier != self.ownerPID
                    || ProcessInfo.processInfo.systemUptime - self.lastInput > 2.4 {
                    self.stop()
                }
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        panel?.orderOut(nil)
        if cursorHidden {
            _ = CGDisplayShowCursor(CGMainDisplayID())
            cursorHidden = false
        }
    }
}

func showComputerUsePointer(at point: CGPoint, ownerPID: pid_t) {
    ComputerUsePointer.shared.show(at: point, ownerPID: ownerPID)
}

func stopComputerUsePointer() {
    ComputerUsePointer.shared.stop()
}
