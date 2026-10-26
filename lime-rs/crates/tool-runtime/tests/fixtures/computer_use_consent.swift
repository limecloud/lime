// Test-only driver: select an explicit choice in the exact fixture's consent UI.
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
let appID = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "com.kingsoft.wpsoffice.mac"
let scope = CommandLine.arguments.count > 4 ? CommandLine.arguments[4] : "session"
let titles = scope == "persistent"
    ? ["始终允许", "一律允許", "Always allow", "常に許可", "항상 허용"]
    : scope == "cancel"
        ? ["取消", "Cancel", "キャンセル", "취소"]
        : ["允许本次连接", "允許本次連線", "Allow this connection", "この接続で許可", "이번 연결 허용"]
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
            guard text.contains(document), text.contains(appID) else { continue }
            for node in nodes {
                guard attribute(node, kAXRoleAttribute) as? String == kAXButtonRole,
                      let title = attribute(node, kAXTitleAttribute) as? String,
                      titles.contains(title) else { continue }
                if CommandLine.arguments.count > 5 {
                    let gate = CommandLine.arguments[5]
                    FileManager.default.createFile(atPath: gate + ".ready", contents: Data())
                    while !FileManager.default.fileExists(atPath: gate + ".continue") && Date() < deadline {
                        Thread.sleep(forTimeInterval: 0.02)
                    }
                    guard FileManager.default.fileExists(atPath: gate + ".continue") else { exit(3) }
                }
                guard AXUIElementPerformAction(node, kAXPressAction as CFString) == .success else { exit(2) }
                print("selected exact fixture consent: \(scope)")
                exit(0)
            }
        }
    }
    Thread.sleep(forTimeInterval: 0.1)
}
fputs("fixture consent was not found\n", stderr)
exit(1)
