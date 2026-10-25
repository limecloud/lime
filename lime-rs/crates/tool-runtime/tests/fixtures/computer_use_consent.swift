// Test-only driver: approve the exact fixture window in Lime's own consent UI.
import AppKit
import ApplicationServices
import Foundation

func attribute(_ node: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(node, key as CFString, &value) == .success else { return nil }
    return value
}
func descendants(_ node: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    guard depth < 8 else { return [] }
    return [node] + ((attribute(node, kAXChildrenAttribute) as? [AXUIElement]) ?? []).prefix(128).flatMap { descendants($0, depth: depth + 1) }
}
let parent = CommandLine.arguments[1]
let document = CommandLine.arguments[2]
let deadline = Date(timeIntervalSinceNow: 55)
while Date() < deadline {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/ps")
    task.arguments = ["-axo", "pid=,ppid=,comm="]
    let pipe = Pipe()
    task.standardOutput = pipe
    try task.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    let lines = String(data: data, encoding: .utf8)?.split(separator: "\n") ?? []
    let processes = lines.map { $0.split(maxSplits: 2, whereSeparator: { $0.isWhitespace }) }.filter { $0.count == 3 }
    var processTree = Set([parent])
    for _ in 0..<8 {
        for parts in processes where processTree.contains(String(parts[1])) {
            processTree.insert(String(parts[0]))
        }
    }
    for parts in processes {
        guard processTree.contains(String(parts[1])), parts[2].hasSuffix("/macos-native-host"), let pid = Int32(parts[0]) else { continue }
        let app = AXUIElementCreateApplication(pid)
        for window in (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? [] {
            let nodes = descendants(window)
            let text = nodes.flatMap { node in [kAXTitleAttribute, kAXValueAttribute].compactMap { attribute(node, $0) as? String } }.joined(separator: "\n")
            guard text.contains(document), text.contains("com.kingsoft.wpsoffice.mac") else { continue }
            for node in nodes {
                guard attribute(node, kAXRoleAttribute) as? String == kAXButtonRole,
                      let title = attribute(node, kAXTitleAttribute) as? String,
                      ["允许本次连接", "允許本次連線", "Allow this connection", "この接続で許可", "이번 연결 허용"].contains(title) else { continue }
                guard AXUIElementPerformAction(node, kAXPressAction as CFString) == .success else { exit(2) }
                print("approved exact WPS fixture consent")
                exit(0)
            }
        }
    }
    Thread.sleep(forTimeInterval: 0.1)
}
fputs("fixture consent was not found\n", stderr)
exit(1)
