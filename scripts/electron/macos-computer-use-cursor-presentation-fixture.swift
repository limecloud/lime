import AppKit
import CoreGraphics
import Foundation

// Compile the current product pointer with isolated helper prerequisites. These
// checks use real WindowServer windows and never inject input or activate an app.
func computerUseLocked() -> Bool { false }
enum HostError: Error { case userIntervened(String) }
func checkComputerUseInputTurn() throws {}
func windowOwnerPID(windowID: UInt32) throws -> pid_t {
    let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]]
    return (rows?.first?[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
}
func windowBounds(windowID: UInt32) throws -> CGRect {
    let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]]
    guard let bounds = rows?.first?[kCGWindowBounds as String] as? [String: Any],
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return .zero }
    return rect
}

@main
struct CursorPresentationFixture {
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let pid = ProcessInfo.processInfo.processIdentifier
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let target = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 64, height: 64),
            styleMask: .borderless, backing: .buffered, defer: false)
        target.title = "Lime Cursor Presentation Fixture"
        target.isReleasedWhenClosed = false
        let blocker = NSWindow(contentRect: NSRect(x: 160, y: 80, width: 64, height: 64),
            styleMask: .borderless, backing: .buffered, defer: false)
        blocker.isReleasedWhenClosed = false
        defer { stopComputerUsePointer(); target.close(); blocker.close() }
        let owner = ["cursor-presentation-fixture", UUID().uuidString]
        let nextOwner = ["cursor-presentation-fixture", UUID().uuidString]
        let id = UInt32(target.windowNumber)
        var checks = [String]()
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            guard condition() else {
                FileHandle.standardError.write(Data(("FAIL: " + message + "\n").utf8))
                exit(1)
            }
            checks.append(message)
        }
        func overlay() -> NSWindow? {
            app.windows.first { $0.title == "Lime Computer Use Pointer" }
        }
        func cursorLayer() -> CALayer? {
            overlay()?.contentView?.layer?.sublayers?.first
        }
        func rows() -> [[String: Any]] {
            CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        }
        func ids() -> [Int] {
            rows().compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
        }
        func settle() {
            // Commit AppKit transactions without running the default-mode
            // intervention timer; foreground/permission policy is outside this fixture.
            app.updateWindows()
            let deadline = Date(timeIntervalSinceNow: 0.03)
            while Date() < deadline {
                _ = RunLoop.current.run(mode: .modalPanel, before: deadline)
            }
        }
        func waitFor(_ predicate: () -> Bool, timeout: TimeInterval = 1.5) -> Bool {
            let deadline = Date(timeIntervalSinceNow: timeout)
            repeat {
                settle()
                if predicate() { return true }
            } while Date() < deadline
            return false
        }
        func alpha() -> Double? {
            guard let window = overlay() else { return nil }
            return (rows().first {
                ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == window.windowNumber
            }?[kCGWindowAlpha as String] as? NSNumber)?.doubleValue
        }
        func begin(_ currentOwner: [String] = owner, _ currentPID: pid_t = pid) throws {
            settle()
            beginComputerUsePointer(owner: currentOwner, windowID: id, ownerPID: currentPID,
                frame: try windowBounds(windowID: id))
            settle()
        }

        target.orderFrontRegardless()
        blocker.orderFrontRegardless()
        target.display()
        try begin()
        if overlay()?.isVisible != true {
            let diagnostic: [String: Any] = ["expectedWindow": id, "actualWindow": target.windowNumber,
                "targetVisible": target.isVisible,
                "target": CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]] ?? []]
            FileHandle.standardError.write(try JSONSerialization.data(withJSONObject: diagnostic, options: [.sortedKeys]))
        }
        check(overlay()?.isVisible == true, "normal target presents the actual Agent panel")
        check(cursorLayer()?.animation(forKey: "lime-gradient") == nil && cursorLayer()?.opacity == 1,
            "action start presents idle at full content opacity without the waiting animation")
        let overlayID = overlay()!.windowNumber
        let initialOrder = ids()
        check(initialOrder.contains(overlayID) && initialOrder.contains(Int(id)),
            "WindowServer lists both exact fixture windows on screen")
        check(initialOrder.firstIndex(of: overlayID)! < initialOrder.firstIndex(of: Int(id))!,
            "Agent panel is ordered above its target")
        check(initialOrder.firstIndex(of: blocker.windowNumber) != nil
            && initialOrder.firstIndex(of: blocker.windowNumber)! < initialOrder.firstIndex(of: overlayID)!,
            "Agent panel preserves a window already ordered above the target")
        let row = rows().first { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == overlayID }
        check((row?[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
            "WindowServer reports normal layer instead of global cursor layer")
        check(overlay()?.canBecomeKey == false && overlay()?.ignoresMouseEvents == true,
            "Agent panel cannot take keyboard focus or intercept mouse events")
        if !reduced {
            check(waitFor { alpha().map { $0 > 0.01 && $0 < 0.99 } == true },
                "first presentation fades in with a real intermediate WindowServer opacity")
        }
        check(waitFor { alpha().map { $0 > 0.99 } == true },
            "first presentation reaches full opacity")
        check(waitFor { cursorLayer()?.filters == nil },
            "completed fade-in clears its blur")
        let waitingTransform = cursorLayer()!.affineTransform()
        if abs(waitingTransform.a - 0.75) >= 0.000001 || abs(waitingTransform.d - 0.75) >= 0.000001 {
            FileHandle.standardError.write(Data("detached layer actual=\(waitingTransform) expected=scale(0.75)\n".utf8))
        }
        check(abs(waitingTransform.a - 0.75) < 0.000001 && abs(waitingTransform.d - 0.75) < 0.000001
            && waitingTransform.b == 0 && waitingTransform.c == 0,
            "actual product layer presents the detached indicator at 75 percent scale")
        detachComputerUsePointer()
        settle()
        check((cursorLayer()?.animation(forKey: "lime-gradient") != nil) == !reduced,
            "action detach starts the waiting animation unless reduced motion is enabled")
        try begin()
        check(overlay()?.windowNumber == overlayID && alpha().map { $0 > 0.99 } == true,
            "same-owner tool activation preserves the visible panel without replaying fade-in")
        check(cursorLayer()?.affineTransform() == waitingTransform,
            "same-owner observation preserves detached scale without replaying its transition")
        check(cursorLayer()?.animation(forKey: "lime-gradient") == nil,
            "a new action exits loading without replacing the existing panel")
        let hotspot = cursorLayer()!.position
        check(waitFor {
            pressComputerUsePointer(true)
            return cursorLayer().map { abs($0.affineTransform().a - 0.525) < 0.003 } == true
        }, "actual product layer applies the 70 percent press scale over its detached scale")
        check(cursorLayer()?.position == hotspot,
            "press spring preserves the product layer's fixed input hotspot")
        check(waitFor {
            pressComputerUsePointer(false)
            return cursorLayer().map { abs($0.affineTransform().a - 0.75) < 0.000001 } == true
        }, "actual product layer returns to detached scale after release")

        detachComputerUsePointer()
        pauseComputerUsePointer(owner: nextOwner)
        check(cursorLayer()?.opacity == 1,
            "an unrelated owner's intervention cannot dim the current indicator")
        pauseComputerUsePointer(owner: owner)
        check(overlay()?.isVisible == true && cursorLayer()?.opacity == 0.5,
            "user takeover retains only the existing half-opacity indicator")
        check(cursorLayer()?.animation(forKey: "lime-gradient") == nil,
            "paused presentation stops the waiting animation")
        check(showComputerUsePointer(at: .zero, ownerPID: pid) == false,
            "paused presentation refuses cursor replacement before any OS cursor change")
        detachComputerUsePointer()
        try begin()
        pressComputerUsePointer(true)
        let pausedDeadline = Date(timeIntervalSinceNow: 0.75)
        while Date() < pausedDeadline { settle() }
        check(cursorLayer()?.opacity == 0.5 && cursorLayer()?.animation(forKey: "lime-gradient") == nil,
            "detach, same-owner begin, press and elapsed time cannot resume a paused indicator")
        check(showComputerUsePointer(at: .zero, ownerPID: pid) == false,
            "waiting through the pause never restores cursor replacement")
        try begin(nextOwner)
        check(cursorLayer()?.opacity == 1 && cursorLayer()?.animation(forKey: "lime-gradient") == nil,
            "a different owner replaces the paused presentation with idle")
        pauseComputerUsePointer(owner: owner)
        check(cursorLayer()?.opacity == 1,
            "a queued former-owner intervention cannot dim the replacement")
        finishComputerUsePointer(owner: owner)
        check(overlay()?.isVisible == true,
            "a queued former-owner finish cannot hide the replacement after takeover")
        pauseComputerUsePointer(owner: nextOwner)
        finishComputerUsePointer(owner: nextOwner)
        check(showComputerUsePointer(at: .zero, ownerPID: pid) == false,
            "finishing a paused owner releases ownership before its fade")
        check(waitFor { overlay()?.isVisible == false },
            "a paused indicator still finishes its normal exit")
        pauseComputerUsePointer(owner: nextOwner)
        check(overlay()?.isVisible == false,
            "late intervention never creates or resurrects a finished indicator")
        try begin()

        target.level = .floating
        try begin()
        let floatingRow = rows().first { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == overlayID }
        check((floatingRow?[kCGWindowLayer as String] as? NSNumber)?.intValue == NSWindow.Level.floating.rawValue,
            "Agent panel follows a changed target layer")

        target.orderOut(nil)
        try begin()
        check(overlay()?.isVisible == false && !ids().contains(overlayID),
            "off-screen target hides the Agent panel")
        check(showComputerUsePointer(at: .zero, ownerPID: pid) == false,
            "hidden presentation refuses mouse-cursor replacement")

        target.level = .normal
        target.orderFrontRegardless()
        try begin()
        check(overlay()?.isVisible == true && overlay()?.windowNumber == overlayID,
            "target return reuses and restores the same panel")
        if !reduced {
            check(waitFor { alpha().map { $0 > 0.01 && $0 < 0.99 } == true },
                "target return fades in from its hidden presentation")
        }
        check(waitFor { alpha().map { $0 > 0.99 } == true },
            "restored target reaches full opacity")
        try begin(nextOwner)
        finishComputerUsePointer(owner: owner)
        check(overlay()?.isVisible == true, "late former-owner cleanup preserves the new owner")
        check(waitFor { alpha().map { $0 > 0.99 } == true },
            "new owner finishes presentation before normal termination")
        finishComputerUsePointer(owner: nextOwner)
        check(showComputerUsePointer(at: .zero, ownerPID: pid) == false,
            "normal finish releases ownership before visual completion")
        check(overlay()?.isVisible == !reduced,
            "normal finish respects the current reduced-motion preference")
        if !reduced {
            check(waitFor { alpha().map { $0 > 0.01 && $0 < 0.99 } == true },
                "WindowServer observes an intermediate fade opacity")
        }
        check(waitFor { overlay()?.isVisible == false && !ids().contains(overlayID) },
            "matching owner termination finishes by hiding the actual panel")
        check(overlay()?.alphaValue == 1 && cursorLayer()?.filters == nil,
            "completed fade restores opacity and clears its blur")

        try begin()
        finishComputerUsePointer(owner: owner)
        try begin(nextOwner)
        check(overlay()?.isVisible == true,
            "new owner cancels an unfinished fade-out and presents its own panel")
        if !reduced {
            check(waitFor { alpha().map { $0 > 0.01 && $0 < 0.99 } == true },
                "new owner replaces unfinished fade-out with its own fade-in")
        }
        let oldCompletionDeadline = Date(timeIntervalSinceNow: 0.65)
        while Date() < oldCompletionDeadline { settle() }
        check(overlay()?.isVisible == true && alpha().map { $0 > 0.99 } == true,
            "old animation completion cannot hide or fade a new owner")
        finishComputerUsePointer(owner: nextOwner)
        stopComputerUsePointer()
        check(overlay()?.isVisible == false && overlay()?.alphaValue == 1,
            "emergency stop cancels a fade and immediately hides the panel")
        let stoppedCompletionDeadline = Date(timeIntervalSinceNow: 0.65)
        while Date() < stoppedCompletionDeadline { settle() }
        check(overlay()?.isVisible == false,
            "cancelled animation completion cannot resurrect a stopped panel")

        try begin()
        stopComputerUsePointer()
        check(overlay()?.isVisible == false && overlay()?.alphaValue == 1,
            "emergency stop also immediately cancels a fade-in")
        let stoppedFadeInDeadline = Date(timeIntervalSinceNow: 0.65)
        while Date() < stoppedFadeInDeadline { settle() }
        check(overlay()?.isVisible == false,
            "cancelled fade-in completion cannot resurrect a stopped panel")

        try begin(owner, 0)
        check(overlay()?.isVisible == false, "mismatched target process cannot present a panel")
        target.close()
        try begin()
        check(overlay()?.isVisible == false, "removed target cannot leave an Agent panel on screen")
        check(NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmost,
            "presentation checks preserve the user's foreground application")
        let record: [String: Any] = ["passed": checks.count, "checks": checks,
            "inputInjected": false, "productSourceCompiled": true,
            "reducedMotion": reduced,
            "unverified": ["timer, permission and takeover prerequisites use fixture isolation",
                "not Desktop/CLI/TUI or Windows acceptance"]]
        print(String(data: try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]), encoding: .utf8)!)
    }
}
