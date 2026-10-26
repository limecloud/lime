import AppKit
import ApplicationServices
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

// Separate test process: its events must never be mistaken for the helper's input.
private let externalMarker: Int64 = 0x4c494d4554455354

// The unbundled test observer has the caller's existing monitoring access.
// Retain only tagged test-event counts; do not record user input metadata.
final class InputReceipts {
    let output: URL
    var healthy = true
    var ownMouseUps = 0
    var externalInputs = 0
    var foreignInputs = 0
    var foreignSources: [String: Int] = [:]
    var drags = 0
    init(path: String) { output = URL(fileURLWithPath: path) }
    func save() {
        let data = try? JSONSerialization.data(withJSONObject: ["ready": healthy,
            "ownMouseUps": ownMouseUps, "externalInputs": externalInputs, "foreignInputs": foreignInputs,
            "foreignSources": foreignSources, "drags": drags])
        try? data?.write(to: output, options: .atomic)
    }
    func record(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            healthy = false
            save()
            return
        }
        let marker = event.getIntegerValueField(.eventSourceUserData)
        if marker == externalMarker { externalInputs += 1 }
        else if marker == 0x4c494d455f4355 {
            if type == .leftMouseUp { ownMouseUps += 1 }
            if type == .leftMouseDragged { drags += 1 }
        } else {
            foreignInputs += 1
            // Attribution only: PID and event kind, never coordinates/keycodes.
            let source = "\(event.getIntegerValueField(.eventSourceUnixProcessID)):\(type.rawValue)"
            foreignSources[source, default: 0] += 1
        }
        save()
    }
}

final class InterventionFixture: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    let output: URL
    var window: NSWindow!
    var field: NSTextField!
    var timer: Timer?

    init(output: String) { self.output = URL(fileURLWithPath: output) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        applicationItem.submenu = NSMenu(title: "Lime Intervention Fixture")
        menu.addItem(applicationItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 180, y: 320, width: 420, height: 200),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Lime Computer Use Intervention Fixture"
        window.isReleasedWhenClosed = false
        window.acceptsMouseMovedEvents = true
        field = NSTextField(frame: NSRect(x: 24, y: 70, width: 370, height: 36))
        field.stringValue = "ready"
        field.delegate = self
        window.contentView?.addSubview(field)
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeFirstResponder(field)
        timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [self] _ in save() }
        save()
    }

    func controlTextDidChange(_ notification: Notification) { save() }

    private func save() {
        let point = window.convertPoint(toScreen: field.convert(NSPoint(x: 40, y: 18), to: nil))
        let record: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier,
            "text": field.stringValue, "editing": field.currentEditor() != nil,
            "selectedLength": (field.currentEditor() as? NSTextView)?.selectedRange().length ?? 0,
            "click": ["x": point.x - window.frame.minX, "y": window.frame.maxY - point.y],
            "screenPoint": ["x": point.x, "y": (NSScreen.screens.first?.frame.maxY ?? 0) - point.y]]
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) {
            try? data.write(to: output, options: .atomic)
        }
    }
}

// Capture only this helper's named, transparent Agent overlay, never another
// application's contents. Pixel receipts are independent of helper state.
@available(macOS 14.0, *)
final class CursorFrameRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let pid: Int32
    let output: URL
    // ScreenCaptureKit borrows this CF object; retain it through async captures.
    private let captureBackground = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0)
    private let started = ProcessInfo.processInfo.systemUptime
    private var firstFrameTime: Double?
    var samples: [[String: Any]] = []
    var timer: Timer?
    private var stream: SCStream?
    private var stopping = false
    private var stopped = false
    private var statusCounts: [String: Int] = [:]
    var captureError: String?

    init(pid: Int32, directory: String) {
        self.pid = pid
        output = URL(fileURLWithPath: directory, isDirectory: true)
        super.init()
    }

    func run() {
        // ScreenCaptureKit window filters require an initialized AppKit connection.
        NSApplication.shared.setActivationPolicy(.prohibited)
        guard CGPreflightScreenCaptureAccess() else { exit(77) }
        try! FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        save()
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [self] content, error in
            DispatchQueue.main.async {
                let matches = content?.windows.filter {
                    $0.owningApplication?.processID == self.pid && $0.title == "Lime Computer Use Pointer"
                } ?? []
                guard !self.stopping else { return }
                guard matches.count == 1 else {
                    self.finish(error?.localizedDescription ?? "Agent overlay is not uniquely shareable")
                    return
                }
                self.start(matches[0])
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [self] _ in
            let now = ProcessInfo.processInfo.systemUptime
            if let firstFrameTime {
                if now - firstFrameTime >= 5 { finish() }
            } else if now - started >= 8 {
                finish("Overlay stream did not produce a complete frame before the startup deadline")
            }
        }
        CFRunLoopRun()
        if captureError != nil { exit(1) }
    }

    private func save() {
        let data = try! JSONSerialization.data(withJSONObject: ["ready": true,
            "captureMode": "SCStream", "stopped": stopped, "statusCounts": statusCounts,
            "reducedMotion": NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
            "captureError": captureError ?? "", "samples": samples], options: [.sortedKeys])
        try! data.write(to: output.appendingPathComponent("frames.json"), options: .atomic)
    }

    private func start(_ window: SCWindow) {
        let configuration = SCStreamConfiguration()
        configuration.width = Int(window.frame.width * 2)
        configuration.height = Int(window.frame.height * 2)
        configuration.showsCursor = false
        configuration.backgroundColor = captureBackground
        configuration.ignoreShadowsSingleWindow = true
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.queueDepth = 3
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        let capture = SCStream(filter: SCContentFilter(desktopIndependentWindow: window),
            configuration: configuration, delegate: self)
        stream = capture
        do {
            try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        } catch {
            finish(error.localizedDescription)
            return
        }
        capture.startCapture { [self] error in
            if let error {
                DispatchQueue.main.async { self.finish(error.localizedDescription) }
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.finish(error.localizedDescription) }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard !stopping, type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer,
                createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int else { return }
        statusCounts[String(status), default: 0] += 1
        // Idle, blank and incomplete samples are not independent pixel frames.
        guard status == SCFrameStatus.complete.rawValue,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let bytes = CVPixelBufferGetBaseAddress(buffer),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: bytes, width: CVPixelBufferGetWidth(buffer),
                height: CVPixelBufferGetHeight(buffer), bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
              let image = context.makeImage() else {
            finish("Overlay stream pixel buffer could not be decoded")
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if firstFrameTime == nil { firstFrameTime = now }
        record(image, elapsed: now - firstFrameTime!, presentationTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds)
        // A busy screen-output queue can delay run-loop timers. Enforce the
        // same recording deadline while consuming frames as well.
        if now - firstFrameTime! >= 5 { finish() }
    }

    private func finish(_ error: String? = nil) {
        guard !stopping else { return }
        stopping = true
        captureError = error
        timer?.invalidate()
        save()
        guard let stream else { completeStop(); return }
        stream.stopCapture { [self] stopError in
            DispatchQueue.main.async {
                if self.captureError == nil { self.captureError = stopError?.localizedDescription }
                self.completeStop()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [self] in
            guard !stopped else { return }
            captureError = captureError ?? "Overlay stream did not stop before the shutdown deadline"
            completeStop()
        }
    }

    private func completeStop() {
        guard !stopped else { return }
        stopped = true
        save()
        CFRunLoopStop(CFRunLoopGetMain())
    }

    private func record(_ image: CGImage, elapsed: Double, presentationTime: Double) {
        let bitmap = NSBitmapImageRep(cgImage: image)
        let name = String(format: "%03d.png", samples.count)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            finish("Overlay stream frame could not be encoded as PNG")
            return
        }
        try! png.write(to: output.appendingPathComponent(name), options: .atomic)
        var solid = 0, transparent = 0
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                let alpha = bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0
                if alpha >= 220.0 / 255.0 { solid += 1 }
                if alpha == 0 { transparent += 1 }
            }
        }
        samples.append(["elapsed": elapsed, "presentationTime": presentationTime,
            "file": name, "width": image.width, "height": image.height,
            "solidPixels": solid, "transparentPixels": transparent])
        save()
    }
}

@main
enum FixtureMain {
    static func main() {
        let args = CommandLine.arguments
        if args.count == 4, args[1] == "--record-cursor", let pid = Int32(args[2]) {
            guard #available(macOS 14.0, *) else { exit(77) }
            CursorFrameRecorder(pid: pid, directory: args[3]).run()
            return
        }
        if args.count == 3, args[1] == "--cursor-state", let pid = Int32(args[2]) {
            let windows = (CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
                as? [[String: Any]] ?? []).filter {
                (pid == -1 || ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid)
                    && $0[kCGWindowName as String] as? String == "Lime Computer Use Pointer"
            }
            let data = try! JSONSerialization.data(withJSONObject: [
                "pointerWindows": windows,
                "foregroundPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
            ], options: [.sortedKeys])
            print(String(decoding: data, as: UTF8.self))
            return
        }
        if args.count == 2, args[1] == "--idle" {
            print(CGEventSource.secondsSinceLastEventType(.combinedSessionState,
                eventType: CGEventType(rawValue: UInt32.max)!))
            return
        }
        if args.count == 3, args[1] == "--listen" {
            let receipts = InputReceipts(path: args[2])
            let mask = [CGEventType.mouseMoved, .keyDown, .keyUp, .flagsChanged, .scrollWheel,
                .leftMouseDown, .leftMouseUp, .leftMouseDragged, .rightMouseDown, .rightMouseUp,
                .rightMouseDragged, .otherMouseDown, .otherMouseUp, .otherMouseDragged]
                .reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
            guard let tap = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .tailAppendEventTap,
                options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, context in
                    if let context { Unmanaged<InputReceipts>.fromOpaque(context).takeUnretainedValue().record(type, event) }
                    return Unmanaged.passUnretained(event)
                }, userInfo: Unmanaged.passUnretained(receipts).toOpaque()) else { exit(77) }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            receipts.save()
            withExtendedLifetime(receipts) { CFRunLoopRun() }
            return
        }
        if args.count == 2, args[1] == "--permissions" {
            let data = try! JSONSerialization.data(withJSONObject: [
                "accessibility": AXIsProcessTrusted(),
                "listen": CGPreflightListenEventAccess(),
                "post": CGPreflightPostEventAccess(),
            ], options: [.sortedKeys])
            print(String(decoding: data, as: UTF8.self))
            return
        }
        if args.count == 5, args[1] == "--inject" {
            let source = CGEventSource(stateID: .privateState)
            source?.userData = externalMarker
            let point = CGPoint(x: (Double(args[3]) ?? 0) + 8, y: (Double(args[4]) ?? 0) + 4)
            if args[2] == "mouse", let event = CGEvent(mouseEventSource: source,
                mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
                event.setIntegerValueField(.eventSourceUserData, value: externalMarker)
                event.post(tap: .cghidEventTap)
            } else if args[2] == "key" {
                for down in [true, false] {
                    if let event = CGEvent(keyboardEventSource: source, virtualKey: 53, keyDown: down) {
                        event.setIntegerValueField(.eventSourceUserData, value: externalMarker)
                        event.post(tap: .cghidEventTap)
                    }
                }
            }
            // Posting is asynchronous. Keep this source alive until the
            // independent observer acknowledges delivery through the parent.
            _ = readLine()
            return
        }
        if args.count == 2, args[1] == "--button-state" {
            print(CGEventSource.buttonState(.combinedSessionState, button: .left) ? "held" : "released")
            return
        }
        guard args.count == 2 else { exit(64) }
        let delegate = InterventionFixture(output: args[1])
        let application = NSApplication.shared
        application.delegate = delegate
        application.run()
    }
}
