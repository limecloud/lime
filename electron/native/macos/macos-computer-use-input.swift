import ApplicationServices
import CoreGraphics
import Foundation

// Observe intervention metadata only: never retain keys, text or coordinates.
// Our injected events carry a marker; all other input yields control to the user.
private let computerUseInputMarker: Int64 = 0x4c494d455f4355
private var computerUseInputMonitor: ComputerUseInputMonitor?
private let computerUseEventSource: CGEventSource? = {
    let source = CGEventSource(stateID: .privateState)
    source?.userData = computerUseInputMarker
    return source
}()

func computerUseInputSource() throws -> CGEventSource {
    guard let source = computerUseEventSource else {
        throw HostError.inputMonitorUnavailable("The tagged Computer Use input source is unavailable.")
    }
    return source
}

func markComputerUseInput(_ event: CGEvent) {
    event.setIntegerValueField(.eventSourceUserData, value: computerUseInputMarker)
}

func computerUseInputMonitorReady() -> Bool {
    if computerUseInputMonitor == nil {
        computerUseInputMonitor = ComputerUseInputMonitor()
    }
    return computerUseInputMonitor?.ready == true
}

func computerUseTurnOwner(_ raw: Any?) throws -> [String] {
    guard let owner = raw as? [String: Any] else {
        throw HostError.invalidArgument("A trusted Computer Use turn owner is required.")
    }
    let key = ["connection", "thread_id", "turn_id"].compactMap { owner[$0] as? String }
    guard key.count == 3, key.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
        throw HostError.invalidArgument("The Computer Use turn owner is invalid.")
    }
    return key
}

@discardableResult
func beginComputerUseInputTurn(_ raw: Any?) throws -> [String] {
    let key = try computerUseTurnOwner(raw)
    guard computerUseInputMonitorReady(), let monitor = computerUseInputMonitor else {
        throw HostError.inputMonitorUnavailable("Computer Use cannot monitor manual intervention.")
    }
    try monitor.begin(key)
    return key
}

func checkComputerUseInputTurn() throws {
    guard let monitor = computerUseInputMonitor else {
        throw HostError.inputMonitorUnavailable("Computer Use intervention monitoring is unavailable.")
    }
    try monitor.check()
}

private final class ComputerUseInputMonitor {
    private let lock = NSLock()
    private var tap: CFMachPort?
    private var healthy = true
    private var heartbeat: TimeInterval = 0
    private var epoch: UInt64 = 0
    private var turnEpochs: [[String]: UInt64] = [:]
    private var owner: [String]?

    init?() {
        let events: [CGEventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp,
            .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel, .keyDown, .keyUp, .flagsChanged]
        let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
            options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, context in
                if let context {
                    let monitor = Unmanaged<ComputerUseInputMonitor>.fromOpaque(context).takeUnretainedValue()
                    monitor.record(type, event)
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return nil }
        tap = port
        let started = DispatchSemaphore(value: 0)
        // Actions can block the AppKit thread. A dedicated run loop must keep
        // observing real input while a drag or Accessibility query is in flight.
        Thread.detachNewThread { [self] in
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            let timer = Timer(timeInterval: 0.25, repeats: true) { [self] _ in beat() }
            RunLoop.current.add(timer, forMode: .common)
            CGEvent.tapEnable(tap: port, enable: true)
            beat()
            started.signal()
            CFRunLoopRun()
            lock.lock()
            healthy = false
            lock.unlock()
            timer.invalidate()
        }
        if started.wait(timeout: .now() + 2) != .success {
            lock.lock()
            healthy = false
            lock.unlock()
        }
    }

    var ready: Bool {
        lock.lock()
        defer { lock.unlock() }
        // A stalled/disabled tap never revives an old turn after recovering.
        if heartbeat == 0 || ProcessInfo.processInfo.systemUptime - heartbeat >= 2 {
            healthy = false
        }
        return healthy && tap.map { CGEvent.tapIsEnabled(tap: $0) } == true
    }

    func begin(_ key: [String]) throws {
        guard ready else { throw HostError.inputMonitorUnavailable("Manual intervention monitoring stopped.") }
        lock.lock()
        owner = key
        if turnEpochs[key] == nil {
            // Never evict an old turn and accidentally admit its late input.
            if turnEpochs.count >= 1024 { healthy = false }
            else { turnEpochs[key] = epoch }
        }
        lock.unlock()
        try check()
    }

    func check() throws {
        guard ready else { throw HostError.inputMonitorUnavailable("Manual intervention monitoring stopped.") }
        lock.lock()
        let interrupted = owner.flatMap { turnEpochs[$0] } != epoch
        lock.unlock()
        if interrupted {
            throw HostError.userIntervened("The user took control. Input stopped; observe again before continuing in a new turn.")
        }
    }

    private func beat() {
        lock.lock()
        heartbeat = ProcessInfo.processInfo.systemUptime
        lock.unlock()
    }

    private func record(_ type: CGEventType, _ event: CGEvent) {
        #if COMPUTER_USE_INPUT_DIAGNOSTICS
        // Test-only event provenance; never record keys, text or coordinates.
        fputs("input_event type=\(type.rawValue) pid=\(event.getIntegerValueField(.eventSourceUnixProcessID)) marker=\(event.getIntegerValueField(.eventSourceUserData))\n", stderr)
        #endif
        lock.lock()
        var stopPointer = false
        var interruptedOwner: [String]?
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            healthy = false
            stopPointer = owner != nil
        } else if event.getIntegerValueField(.eventSourceUserData) != computerUseInputMarker {
            if let owner, turnEpochs[owner] == epoch { interruptedOwner = owner }
            if epoch == UInt64.max { healthy = false } else { epoch += 1 }
        }
        lock.unlock()
        if stopPointer { DispatchQueue.main.async { stopComputerUsePointer() } }
        else if let owner = interruptedOwner {
            // Owner-scoped notification cannot dim a later turn's indicator.
            DispatchQueue.main.async { pauseComputerUsePointer(owner: owner) }
        }
    }
}
