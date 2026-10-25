import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation

private let computerUseCancelLock = NSLock()
private var computerUseCanceled = false
private var computerUseFence: UInt64 = 0
private let computerUseParentPID = getppid()

private func checkComputerUseFence() throws {
    guard getppid() == computerUseParentPID,
          let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
        throw HostError.notGranted("The Computer Use issuer is no longer available.")
    }
    let path = support.appendingPathComponent("lime/computer-use/desktop.lock").path
    let fd = open(path, O_RDONLY | O_NOFOLLOW)
    guard fd >= 0 else { throw HostError.notGranted("The Computer Use control lock is not available.") }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_mode & 0o077 == 0, info.st_nlink == 1 else {
        throw HostError.notGranted("The Computer Use control lock is not private.")
    }
    // A live issuer must still own the OS lock. A newly available lock means
    // its process died or released control; do not continue the old action.
    if flock(fd, LOCK_EX | LOCK_NB) == 0 {
        _ = flock(fd, LOCK_UN)
        throw HostError.notGranted("The Computer Use control lease is no longer held.")
    }
    guard errno == EWOULDBLOCK else { throw HostError.notGranted("The control lock could not be verified.") }
    var bytes = [UInt8](repeating: 0, count: 8)
    guard read(fd, &bytes, 8) == 8,
          bytes.reduce(UInt64(0), { ($0 << 8) | UInt64($1) }) == computerUseFence else {
        throw HostError.notGranted("The Computer Use control fence has changed.")
    }
}

func computerUseCancelLine(_ line: String) -> Bool {
    guard let bytes = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          object["method"] as? String == "computerUse.cancel" else { return false }
    computerUseCancelLock.lock()
    computerUseCanceled = true
    computerUseCancelLock.unlock()
    return true
}

private func checkComputerUseCancellation() throws {
    computerUseCancelLock.lock()
    let canceled = computerUseCanceled
    computerUseCancelLock.unlock()
    if canceled { throw HostError.operationFailed("Computer Use canceled; outcome may be unknown.") }
    guard !computerUseLocked(), AXIsProcessTrusted() else {
        throw HostError.notGranted("Computer Use requires an unlocked desktop and Accessibility permission.")
    }
}

private func exactComputerUseWindow(pid: pid_t, frame: CGRect) throws -> AXUIElement {
    let app = AXUIElementCreateApplication(pid)
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
          let windows = raw as? [AXUIElement] else {
        throw HostError.unavailable("The target has no Accessibility windows.")
    }
    let matches = windows.filter { window in
        var positionRaw: CFTypeRef?
        var sizeRaw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRaw) == .success,
              AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRaw) == .success,
              let positionRaw, let sizeRaw,
              CFGetTypeID(positionRaw) == AXValueGetTypeID(), CFGetTypeID(sizeRaw) == AXValueGetTypeID() else { return false }
        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionRaw as! AXValue, .cgPoint, &position),
              AXValueGetValue(sizeRaw as! AXValue, .cgSize, &size) else { return false }
        return abs(position.x - frame.minX) < 1 && abs(position.y - frame.minY) < 1
            && abs(size.width - frame.width) < 1 && abs(size.height - frame.height) < 1
    }
    guard matches.count == 1, let window = matches.first else {
        throw HostError.unavailable("The target window could not be matched unambiguously.")
    }
    return window
}

private func inputComputerUseTarget(windowID: UInt32, pid: pid_t, window: AXUIElement, frame: CGRect) throws {
    try checkComputerUseCancellation()
    try checkComputerUseFence()
    guard try windowOwnerPID(windowID: windowID) == pid,
          try windowBounds(windowID: windowID) == frame,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          !IsSecureEventInputEnabled() else {
        throw HostError.notGranted("Target focus changed or secure input is active.")
    }
    var focused: CFTypeRef?
    let app = AXUIElementCreateApplication(pid)
    guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
          let focused, CFEqual(focused, window) else {
        throw HostError.notGranted("The approved window is not focused.")
    }
}

private func actionPoint(_ operation: [String: Any], x: String, y: String, frame: CGRect) throws -> CGPoint {
    guard let rawX = operation[x] as? NSNumber, let rawY = operation[y] as? NSNumber,
          rawX.doubleValue.isFinite, rawY.doubleValue.isFinite,
          rawX.doubleValue >= 0, rawY.doubleValue >= 0,
          rawX.doubleValue < frame.width, rawY.doubleValue < frame.height else {
        throw HostError.invalidArgument("Input coordinates must be inside the approved window.")
    }
    return CGPoint(x: frame.minX + rawX.doubleValue, y: frame.minY + rawY.doubleValue)
}

private func postMouse(_ type: CGEventType, point: CGPoint, button: CGMouseButton, pid: pid_t, count: Int = 1) throws {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
        throw HostError.operationFailed("The mouse event could not be created.")
    }
    event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
    event.postToPid(pid)
}

private func computerUseKeyCode(_ name: String) -> CGKeyCode? {
    let keys: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8,
        "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
        "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33,
        "i": 34, "p": 35, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
        "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48,
        "space": 49, "`": 50, "backspace": 51, "escape": 53, "delete": 117,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "left": 123, "right": 124, "down": 125, "up": 126,
    ]
    return keys[name.lowercased()]
}

func computerUseExecute(params: [String: Any]) throws -> [String: Any] {
    defer {
        computerUseCancelLock.lock()
        computerUseCanceled = false
        computerUseCancelLock.unlock()
    }
    try checkComputerUseCancellation()
    let snapshot = computerUseSnapshot()
    guard let requested = params["target"] as? [String: Any],
          let generation = params["generation"] as? NSNumber,
          generation == snapshot["generation"] as? NSNumber,
          snapshot["readiness"] as? String == "ready",
          let identity = computerUseTarget(requested, in: snapshot),
          let rawID = identity["windowId"] as? String, let windowID = UInt32(rawID),
          let rawPID = identity["processId"] as? NSNumber,
          let fence = params["fence"] as? NSNumber, fence.uint64Value > 0,
          fence.uint64Value >= computerUseFence,
          let operation = params["operation"] as? [String: Any],
          let action = operation["action"] as? String else {
        throw HostError.notGranted("Native action target, generation or fence is no longer valid.")
    }
    computerUseFence = fence.uint64Value
    try checkComputerUseFence()
    let pid = rawPID.int32Value
    let frame = try windowBounds(windowID: windowID)
    let window = try exactComputerUseWindow(pid: pid, frame: frame)
    if action == "observe" {
        let depth = (operation["max_depth"] as? NSNumber)?.intValue ?? 0
        let nodes = (operation["max_nodes"] as? NSNumber)?.intValue ?? 0
        guard (1...8).contains(depth), (1...512).contains(nodes) else {
            throw HostError.invalidArgument("Accessibility observation bounds are invalid.")
        }
        return try readAccessibilityTree(windowID: windowID, params: ["maxDepth": depth, "maxNodes": nodes])
    }
    if action == "screenshot" {
        return try screenCaptureSnapshot(params: ["windowId": windowID])
    }
    guard NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps]) == true,
          AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success else {
        throw HostError.operationFailed("The approved window could not be focused.")
    }
    // A bounded wait for the OS focus transition; revalidate before every event.
    for _ in 0..<10 {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { break }
        Thread.sleep(forTimeInterval: 0.01)
    }
    try inputComputerUseTarget(windowID: windowID, pid: pid, window: window, frame: frame)
    switch action {
    case "click":
        let point = try actionPoint(operation, x: "x", y: "y", frame: frame)
        let buttonName = operation["button"] as? String ?? ""
        let count = (operation["count"] as? NSNumber)?.intValue ?? 0
        guard ["left", "right", "middle"].contains(buttonName), (1...2).contains(count) else {
            throw HostError.invalidArgument("Mouse button or click count is invalid.")
        }
        let button: CGMouseButton = buttonName == "right" ? .right : buttonName == "middle" ? .center : .left
        let down: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
        let up: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
        for index in 1...count {
            try inputComputerUseTarget(windowID: windowID, pid: pid, window: window, frame: frame)
            try postMouse(down, point: point, button: button, pid: pid, count: index)
            try postMouse(up, point: point, button: button, pid: pid, count: index)
        }
    case "type":
        guard let text = operation["text"] as? String, !text.isEmpty, text.utf16.count <= 2048,
              !text.contains("\0") else { throw HostError.invalidArgument("Text length is invalid.") }
        let characters = Array(text.utf16)
        var start = 0
        while start < characters.count {
            try inputComputerUseTarget(windowID: windowID, pid: pid, window: window, frame: frame)
            var end = min(start + 32, characters.count)
            if end < characters.count && (0xD800...0xDBFF).contains(characters[end - 1]) { end -= 1 }
            let part = Array(characters[start..<end])
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw HostError.operationFailed("The text event could not be created.")
            }
            part.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: part.count, unicodeString: buffer.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: part.count, unicodeString: buffer.baseAddress!)
            }
            down.postToPid(pid)
            up.postToPid(pid)
            start = end
        }
    case "key":
        guard let key = operation["key"] as? String, let code = computerUseKeyCode(key),
              let modifiers = operation["modifiers"] as? [String], modifiers.count <= 4 else {
            throw HostError.invalidArgument("Key or modifiers are invalid.")
        }
        var flags: CGEventFlags = []
        for modifier in modifiers {
            switch modifier {
            case "command": flags.insert(.maskCommand)
            case "control": flags.insert(.maskControl)
            case "option": flags.insert(.maskAlternate)
            case "shift": flags.insert(.maskShift)
            default: throw HostError.invalidArgument("Key modifier is invalid.")
            }
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw HostError.operationFailed("The key event could not be created.")
        }
        down.flags = flags
        up.flags = flags
        down.postToPid(pid)
        up.postToPid(pid)
    case "scroll":
        let point = try actionPoint(operation, x: "x", y: "y", frame: frame)
        let dx = (operation["delta_x"] as? NSNumber)?.int32Value ?? 0
        let dy = (operation["delta_y"] as? NSNumber)?.int32Value ?? 0
        guard abs(Int64(dx)) <= 10_000, abs(Int64(dy)) <= 10_000,
              let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else {
            throw HostError.invalidArgument("Scroll bounds are invalid.")
        }
        event.location = point
        event.postToPid(pid)
    case "drag":
        let from = try actionPoint(operation, x: "x", y: "y", frame: frame)
        let to = try actionPoint(operation, x: "to_x", y: "to_y", frame: frame)
        let duration = (operation["duration_ms"] as? NSNumber)?.intValue ?? 0
        guard (50...2000).contains(duration) else { throw HostError.invalidArgument("Drag duration is invalid.") }
        var position = from
        try postMouse(.leftMouseDown, point: from, button: .left, pid: pid)
        defer { try? postMouse(.leftMouseUp, point: position, button: .left, pid: pid) }
        let steps = max(2, duration / 16)
        for index in 1...steps {
            try inputComputerUseTarget(windowID: windowID, pid: pid, window: window, frame: frame)
            let progress = CGFloat(index) / CGFloat(steps)
            position = CGPoint(x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
            try postMouse(.leftMouseDragged, point: position, button: .left, pid: pid)
            Thread.sleep(forTimeInterval: Double(duration) / Double(steps) / 1000)
        }
    default:
        throw HostError.invalidArgument("Unsupported Computer Use action.")
    }
    return ["outcome": "submitted", "windowId": rawID, "fence": fence]
}
