import AppKit
import ApplicationServices
import CoreGraphics
import CoreImage
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
    private var cursorLayer: CALayer?
    private var timer: Timer?
    private var cursorHidden = false
    private var lastPoint = CGPoint.zero
    private var ownerPID: pid_t = 0
    private var owner: [String]?
    private var windowID: UInt32 = 0
    private var frame = CGRect.zero
    private var targetIsOnScreen = false
    private var targetWindowLevel = NSWindow.Level.normal
    private var animating = false
    private var activity = ComputerUseCursorIdle
    private var motion = ComputerUseCursorMotion()
    private var nextValidation = 0.0
    private var presentationRevision: UInt64 = 0
    private let images: [CGImage] = ComputerUseCursorFrames.png.compactMap { encoded in
        guard let data = Data(base64Encoded: encoded),
              let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    func begin(owner: [String], windowID: UInt32, ownerPID: pid_t, frame: CGRect) {
        // A late action from the interrupted owner cannot resume presentation.
        if self.owner == owner && activity == ComputerUseCursorPaused { return }
        if self.owner != owner || self.windowID != windowID || self.frame != frame {
            stop()
            lastPoint = CGPoint(x: frame.midX, y: frame.midY)
            computerUseCursorReset(&motion, lastPoint.x, lastPoint.y, ProcessInfo.processInfo.systemUptime, false)
        }
        self.owner = owner
        self.windowID = windowID
        self.ownerPID = ownerPID
        self.frame = frame
        activity = ComputerUseCursorIdle
        guard updateTargetPresentation() else { stop(); return }
        present()
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                guard let self else { return }
                let now = ProcessInfo.processInfo.systemUptime
                // Takeover dims presentation without reviving input. Permission
                // loss, a changed target or a locked desktop still clears it.
                if now >= self.nextValidation {
                    self.nextValidation = now + 0.1
                    if computerUseLocked() || !AXIsProcessTrusted() || !CGPreflightScreenCaptureAccess()
                        || NSWorkspace.shared.frontmostApplication?.processIdentifier != self.ownerPID
                        || (try? windowOwnerPID(windowID: self.windowID)) != self.ownerPID
                        || (try? windowBounds(windowID: self.windowID)) != self.frame
                        || !self.updateTargetPresentation() {
                        self.stop()
                        return
                    }
                    do { try checkComputerUseInputTurn() }
                    catch HostError.userIntervened {
                        if let owner = self.owner { self.pause(owner: owner) }
                    } catch { self.stop(); return }
                }
                self.present()
            }
        }
    }

    func show(at point: CGPoint, ownerPID: pid_t) -> Bool {
        guard owner != nil, self.ownerPID == ownerPID, activity != ComputerUseCursorPaused else { return false }
        lastPoint = point
        let now = ProcessInfo.processInfo.systemUptime
        computerUseCursorMove(&motion, point.x, point.y, now)
        computerUseCursorAttach(&motion, true, now)
        present()
        guard panel?.isVisible == true else { return false }
        if !cursorHidden {
            guard CGDisplayHideCursor(CGMainDisplayID()) == .success else { return false }
            cursorHidden = true
        }
        return true
    }

    func press(_ pressed: Bool) {
        guard owner != nil, activity != ComputerUseCursorPaused else { return }
        computerUseCursorPress(&motion, pressed, ProcessInfo.processInfo.systemUptime)
        present()
    }

    private func updateTargetPresentation() -> Bool {
        let windows = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]]
        guard let target = windows?.first,
              (target[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID,
              (target[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == ownerPID,
              let layer = target[kCGWindowLayer as String] as? NSNumber,
              let onScreen = target[kCGWindowIsOnscreen as String] as? Bool else { return false }
        targetWindowLevel = NSWindow.Level(rawValue: layer.intValue)
        targetIsOnScreen = onScreen
        return true
    }

    private func present() {
        guard targetIsOnScreen else {
            if panel?.isVisible == true {
                presentationRevision &+= 1
                panel?.orderOut(nil)
                resetPresentation()
            }
            return
        }
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
            let view = NSView(frame: NSRect(origin: .zero, size: size))
            view.setAccessibilityElement(false)
            view.setAccessibilityHidden(true)
            view.wantsLayer = true
            // AppKit owns the backing layer's geometry and can reset its
            // transform during window layout. Animate a dedicated child layer.
            let layer = CALayer()
            layer.frame = view.bounds
            layer.contents = images[0]
            layer.contentsScale = 2
            layer.anchorPoint = CGPoint(x: ComputerUseCursorFrames.hotspotX / size.width,
                y: 1 - ComputerUseCursorFrames.hotspotY / size.height)
            layer.position = CGPoint(x: ComputerUseCursorFrames.hotspotX,
                y: size.height - ComputerUseCursorFrames.hotspotY)
            view.layer?.addSublayer(layer)
            cursorLayer = layer
            window.contentView = view
            panel = window
        }
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let transform = computerUseCursorSample(&motion, ProcessInfo.processInfo.systemUptime, reduced)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cursorLayer?.opacity = activity == ComputerUseCursorPaused ? 0.5 : 1
        // Shared math uses top-left screen coordinates; AppKit's layer uses Y-up.
        cursorLayer?.setAffineTransform(CGAffineTransform(a: transform.a, b: -transform.b,
            c: -transform.c, d: transform.d, tx: 0, ty: 0))
        CATransaction.commit()
        CATransaction.flush()
        let animate = !reduced && activity == ComputerUseCursorLoading
        if animating != animate {
            animating = animate
            if animate {
                let animation = CAKeyframeAnimation(keyPath: "contents")
                animation.values = images
                animation.duration = ComputerUseCursorFrames.duration
                animation.calculationMode = .discrete
                animation.repeatCount = .infinity
                cursorLayer?.add(animation, forKey: "lime-gradient")
            } else {
                cursorLayer?.removeAnimation(forKey: "lime-gradient")
                cursorLayer?.contents = images[0]
            }
        }
        // Quartz uses the primary display's top-left; AppKit uses its bottom-left.
        panel?.setFrameOrigin(NSPoint(x: lastPoint.x - ComputerUseCursorFrames.hotspotX,
            y: primary.frame.maxY - lastPoint.y - ComputerUseCursorFrames.height + ComputerUseCursorFrames.hotspotY))
        // Ordinary targeted presentation follows the shipped native window's
        // level and relative ordering; it is not a global system-cursor layer.
        let shouldFadeIn = panel?.isVisible == false && !reduced
        if shouldFadeIn { panel?.alphaValue = 0 }
        panel?.level = targetWindowLevel
        panel?.order(.above, relativeTo: Int(windowID))
        if shouldFadeIn { transition(visible: true) }
    }

    func detach() {
        let now = ProcessInfo.processInfo.systemUptime
        computerUseCursorPress(&motion, false, now)
        computerUseCursorAttach(&motion, false, now)
        if owner != nil && activity != ComputerUseCursorPaused { activity = ComputerUseCursorLoading }
        // Waiting/model sampling keeps the Agent indicator, not control of the
        // user's system cursor. No input lease is retained for presentation.
        if cursorHidden {
            _ = CGDisplayShowCursor(CGMainDisplayID())
            cursorHidden = false
        }
        if owner != nil { present() }
    }

    func pause(owner: [String]) {
        guard self.owner == owner else { return }
        activity = ComputerUseCursorPaused
        // Retain only a dimmed, detached indicator. Input turn epochs remain
        // invalid, and show()/press()/begin() cannot revive this owner.
        motion.pressUntil = 0
        motion.pressAmount = 0
        motion.pressVelocity = 0
        motion.velocityX = 0
        motion.velocityY = 0
        detach()
    }

    func finish(owner: [String]) {
        guard self.owner == owner else { return }
        guard let window = panel, window.isVisible,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { stop(); return }
        endOwnership()
        transition(visible: false)
    }

    private func transition(visible: Bool) {
        guard let window = panel else { return }
        presentationRevision &+= 1
        let revision = presentationRevision
        let layer = cursorLayer
        let fromRadius = visible ? 7.0 : 0.0
        let toRadius = visible ? 0.0 : 7.0
        if let blur = CIFilter(name: "CIGaussianBlur") {
            blur.name = "gaussianBlur"
            blur.setValue(toRadius, forKey: kCIInputRadiusKey)
            layer?.filters = [blur]
            let animation = CABasicAnimation(keyPath: "filters.gaussianBlur.inputRadius")
            animation.fromValue = fromRadius
            animation.toValue = toRadius
            animation.duration = 0.44
            animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            layer?.add(animation, forKey: "cursorBlurTransition")
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.44
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().alphaValue = visible ? 1 : 0
        }, completionHandler: { [weak self, weak window] in
            guard let self, self.presentationRevision == revision, (self.owner != nil) == visible,
                  let window, self.panel === window else { return }
            if !visible { window.orderOut(nil) }
            self.resetPresentation()
        })
    }

    private func endOwnership() {
        timer?.invalidate()
        timer = nil
        owner = nil
        activity = ComputerUseCursorIdle
        animating = false
        cursorLayer?.removeAnimation(forKey: "lime-gradient")
        targetIsOnScreen = false
        detach()
        motion = ComputerUseCursorMotion()
        nextValidation = 0
    }

    private func resetPresentation() {
        cursorLayer?.removeAnimation(forKey: "cursorBlurTransition")
        cursorLayer?.filters = nil
        // Supersede an in-flight window animator before a new owner is shown.
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0
            panel?.animator().alphaValue = 1
        }
    }

    func stop() {
        presentationRevision &+= 1
        endOwnership()
        panel?.orderOut(nil)
        resetPresentation()
    }
}

func beginComputerUsePointer(owner: [String], windowID: UInt32, ownerPID: pid_t, frame: CGRect) {
    ComputerUsePointer.shared.begin(owner: owner, windowID: windowID, ownerPID: ownerPID, frame: frame)
}

func finishComputerUsePointer(owner: [String]) {
    ComputerUsePointer.shared.finish(owner: owner)
}

func detachComputerUsePointer() {
    ComputerUsePointer.shared.detach()
}

func pauseComputerUsePointer(owner: [String]) {
    ComputerUsePointer.shared.pause(owner: owner)
}

func pressComputerUsePointer(_ pressed: Bool) {
    ComputerUsePointer.shared.press(pressed)
}

func showComputerUsePointer(at point: CGPoint, ownerPID: pid_t) -> Bool {
    return ComputerUsePointer.shared.show(at: point, ownerPID: ownerPID)
}

func stopComputerUsePointer() {
    ComputerUsePointer.shared.stop()
}
