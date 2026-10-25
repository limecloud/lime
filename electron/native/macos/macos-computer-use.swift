import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Security

// Lime host adaptation. The public upstream contains configuration, but no
// corresponding native helper source. All identities below come from the OS.
private var computerUseGeneration: UInt64 = 1
private var computerUseFingerprint: Data?
private var computerUseTargetTitles: [String: String] = [:]
private var computerUseTargetClock: UInt64 = 0
private var computerUseTargetFingerprints: [String: Data] = [:]
private var computerUseTargetRevisions: [String: UInt64] = [:]
private var computerUseIssuedSnapshots: [UInt64: [String: UInt64]] = [:]

private func computerUseTargetKey(_ identity: [String: Any]) -> String? {
    guard let app = identity["appId"] as? String,
          let pid = identity["processId"] as? NSNumber,
          let window = identity["windowId"] as? String else { return nil }
    return "\(app):\(pid):\(window)"
}

func computerUseGenerationAllowsTarget(_ identity: [String: Any], generation: UInt64) -> Bool {
    guard let key = computerUseTargetKey(identity),
          let issued = computerUseIssuedSnapshots[generation]?[key],
          let current = computerUseTargetRevisions[key] else { return false }
    return issued == current
}

func computerUseLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
          let onConsole = session[kCGSessionOnConsoleKey as String] as? Bool else {
        return true
    }
    return !onConsole || (session["CGSSessionScreenIsLocked"] as? Bool ?? false)
}

private func verifiedComputerUseBundle(pid: pid_t) -> String? {
    guard let application = NSRunningApplication(processIdentifier: pid),
          let bundleID = application.bundleIdentifier,
          !bundleID.isEmpty, pid != ProcessInfo.processInfo.processIdentifier else {
        return nil
    }
    var code: SecCode?
    let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
          let code,
          SecCodeCheckValidity(code, [], nil) == errSecSuccess else {
        return nil
    }
    var staticCode: SecStaticCode?
    var information: CFDictionary?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
          let staticCode,
          SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let info = information as? [String: Any],
          info[kSecCodeInfoIdentifier as String] as? String == bundleID else {
        return nil
    }
    return bundleID
}

func computerUseSnapshot() -> [String: Any] {
    let accessibility = AXIsProcessTrusted()
    let screenCapture = CGPreflightScreenCaptureAccess()
    let locked = computerUseLocked()
    let ready = accessibility && screenCapture && !locked
    var targets: [[String: Any]] = []
    if ready {
        let windows = readWindows()["windows"] as? [[String: Any]] ?? []
        for window in windows {
            guard (window["layer"] as? Int) == 0,
                  let rawPID = window["ownerPid"] as? NSNumber,
                  let rawID = window["windowId"] as? NSNumber,
                  let bundleID = verifiedComputerUseBundle(pid: rawPID.int32Value),
                  let bounds = window["bounds"] as? [String: Any],
                  (bounds["width"] as? Double ?? 0) > 0,
                  (bounds["height"] as? Double ?? 0) > 0 else {
                continue
            }
            targets.append([
                "identity": [
                    "type": "native",
                    "appId": bundleID,
                    "processId": rawPID.uint32Value,
                    "windowId": rawID.stringValue,
                    "title": bundleID == "com.kingsoft.wpsoffice.mac"
                        ? (window["title"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "* "))
                        : computerUseTargetTitles["\(bundleID):\(rawPID):\(rawID)"] ?? window["title"] as? String ?? "",
                ],
                "nativeApp": ["type": "macos", "bundleId": bundleID],
                "capabilities": ["observe", "screenshot", "click", "type", "key", "scroll", "drag"],
                "locked": false,
            ])
            // Keep display labels stable except WPS document tabs, where a
            // title change must invalidate the selected document's authority.
            computerUseTargetTitles["\(bundleID):\(rawPID):\(rawID)"] = (targets.last?["identity"] as? [String: Any])?["title"] as? String
        }
    }
    var steps: [String] = []
    if !accessibility { steps.append("grant_accessibility") }
    if !screenCapture { steps.append("grant_screen_recording") }
    if locked { steps.append("unlock_desktop") }
    let status: [String: Any] = [
        "readiness": locked ? "blocked" : ready ? "ready" : "permission_required",
        "targets": targets.sorted {
            let left = ($0["identity"] as? [String: Any])?["windowId"] as? String ?? ""
            let right = ($1["identity"] as? [String: Any])?["windowId"] as? String ?? ""
            return left < right
        },
        "reason": locked ? "desktop_locked" : ready ? NSNull() as Any : "system_permission_required",
        "setupSteps": steps,
    ]
    let fingerprint = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys])
    if computerUseFingerprint != fingerprint {
        guard computerUseGeneration < UInt64.max else {
            return [
                "generation": computerUseGeneration, "readiness": "blocked", "targets": [],
                "reason": "generation_exhausted", "setupSteps": [],
            ]
        }
        computerUseGeneration += 1
        computerUseFingerprint = fingerprint
    }
    // Snapshot generations include unrelated windows. Preserve exact target
    // revisions so an unrelated popup closing cannot race an approved action.
    // Disappearance, document change or lost readiness retires that revision.
    var fingerprints: [String: Data] = [:]
    var revisions: [String: UInt64] = [:]
    for target in targets {
        guard let identity = target["identity"] as? [String: Any],
              let key = computerUseTargetKey(identity),
              let bytes = try? JSONSerialization.data(withJSONObject: target, options: [.sortedKeys]) else { continue }
        fingerprints[key] = bytes
        if computerUseTargetFingerprints[key] == bytes, let revision = computerUseTargetRevisions[key] {
            revisions[key] = revision
        } else {
            guard computerUseTargetClock < UInt64.max else {
                return ["generation": computerUseGeneration, "readiness": "blocked", "targets": [], "reason": "generation_exhausted", "setupSteps": []]
            }
            computerUseTargetClock += 1
            revisions[key] = computerUseTargetClock
        }
    }
    computerUseTargetFingerprints = fingerprints
    computerUseTargetRevisions = revisions
    computerUseIssuedSnapshots[computerUseGeneration] = revisions
    while computerUseIssuedSnapshots.count > 32, let oldest = computerUseIssuedSnapshots.keys.min() {
        computerUseIssuedSnapshots.removeValue(forKey: oldest)
    }
    return status.merging(["generation": computerUseGeneration]) { _, value in value }
}

func computerUseTarget(_ requested: [String: Any], in snapshot: [String: Any]) -> [String: Any]? {
    guard requested["type"] as? String == "native",
          let appID = requested["appId"] as? String,
          let pid = requested["processId"] as? NSNumber,
          let windowID = requested["windowId"] as? String else { return nil }
    let targets = snapshot["targets"] as? [[String: Any]] ?? []
    return targets.compactMap { $0["identity"] as? [String: Any] }.first {
        $0["appId"] as? String == appID
            && $0["processId"] as? NSNumber == pid
            && $0["windowId"] as? String == windowID
    }
}

private func computerUseConsentText() -> (String, String, String, String) {
    let language = Locale.preferredLanguages.first ?? "en"
    if language.hasPrefix("zh-Hant") || language.hasPrefix("zh-TW") || language.hasPrefix("zh-HK") {
        return ("允許 Lime 使用此應用程式？", "Lime 將在本次連線中讀取和操控下列應用程式視窗。你可以隨時在 Lime 中撤銷授權。", "允許本次連線", "取消")
    }
    if language.hasPrefix("zh") {
        return ("允许 Lime 使用此应用？", "Lime 将在本次连接中读取和操控下列应用窗口。你可以随时在 Lime 中撤销授权。", "允许本次连接", "取消")
    }
    if language.hasPrefix("ja") {
        return ("Lime にこのアプリの使用を許可しますか？", "Lime はこの接続中に次のアプリのウインドウを読み取り、操作します。Lime でいつでも許可を取り消せます。", "この接続で許可", "キャンセル")
    }
    if language.hasPrefix("ko") {
        return ("Lime이 이 앱을 사용하도록 허용할까요?", "Lime이 이번 연결에서 아래 앱 창을 읽고 제어합니다. Lime에서 언제든지 권한을 취소할 수 있습니다.", "이번 연결 허용", "취소")
    }
    return ("Allow Lime to use this application?", "Lime will read and control the following application window during this connection. You can revoke access in Lime at any time.", "Allow this connection", "Cancel")
}

func computerUseSetup(params: [String: Any]) throws -> [String: Any] {
    guard params["adapter"] as? String == "native" else {
        throw HostError.invalidArgument("Native setup requires the native adapter.")
    }
    if !AXIsProcessTrusted() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    var snapshot = computerUseSnapshot()
    var approved: Any = NSNull()
    var accepted = true
    if let requested = params["target"] as? [String: Any],
       let target = computerUseTarget(requested, in: snapshot),
       snapshot["readiness"] as? String == "ready" {
        let (title, message, allow, cancel) = computerUseConsentText()
        // The stdio helper normally runs only a Foundation run loop. Initialize
        // AppKit explicitly before presenting consent, including CLI-only use.
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message + "\n\n" + (target["appId"] as? String ?? "")
            + "\n" + (target["title"] as? String ?? "")
        alert.alertStyle = .warning
        alert.addButton(withTitle: allow)
        alert.addButton(withTitle: cancel)
        accepted = alert.runModal() == .alertFirstButtonReturn
        alert.window.orderOut(nil)
        if accepted, let pid = target["processId"] as? NSNumber,
           let targetApplication = NSRunningApplication(processIdentifier: pid.int32Value) {
            _ = activateComputerUseApplication(targetApplication)
        }
        snapshot = computerUseSnapshot()
        if accepted, let current = computerUseTarget(target, in: snapshot) {
            approved = current
        }
    } else if params["target"] != nil && !(params["target"] is NSNull) {
        accepted = false
    }
    return [
        "outcome": [
            "accepted": accepted, "approvedTarget": approved,
            "generation": snapshot["generation"] ?? 0,
        ],
        "snapshot": snapshot,
    ]
}
