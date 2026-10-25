#!/usr/bin/env python3
"""Exercise a real macOS helper against an isolated AppKit window, without permission UI.

This is helper-level evidence, not Desktop/CLI/provider or packaged Gate B. The
fixture acquires the real per-user control lock without deleting/resetting it.
"""

import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time


FIXTURE = r'''import AppKit
import Foundation
final class MouseTextView: NSTextView {
 var lastMouse:[String:Int] = [:]
 func record(_ event:NSEvent) { lastMouse = ["button":event.buttonNumber,"count":event.clickCount] }
 override func mouseDown(with event:NSEvent) { record(event); super.mouseDown(with:event) }
 override func rightMouseDown(with event:NSEvent) { record(event) }
 override func otherMouseDown(with event:NSEvent) { record(event) }
}
final class Delegate: NSObject, NSApplicationDelegate, NSTextViewDelegate {
 var window: NSWindow!
 var text: MouseTextView!
 var scroll: NSScrollView!
 var extra: NSWindow?
 var hidden = false
 func applicationDidFinishLaunching(_ notification: Notification) {
  let menu = NSMenu()
  let editItem = NSMenuItem(title:"Edit",action:nil,keyEquivalent:"")
  let edit = NSMenu(title:"Edit")
  edit.addItem(withTitle:"Select All",action:#selector(NSText.selectAll(_:)),keyEquivalent:"a")
  editItem.submenu = edit
  menu.addItem(editItem)
  NSApplication.shared.mainMenu = menu
  window = NSWindow(contentRect:NSRect(x:160,y:160,width:540,height:280),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
  window.title = "Lime Computer Use Fixture"
  scroll = NSScrollView(frame:NSRect(x:10,y:10,width:520,height:230))
  scroll.hasVerticalScroller = true
  text = MouseTextView(frame:NSRect(x:0,y:0,width:500,height:230))
  text.minSize = NSSize(width:0,height:230)
  text.maxSize = NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude)
  text.isVerticallyResizable = true
  text.isHorizontallyResizable = false
  text.autoresizingMask = [.width]
  text.textContainer?.widthTracksTextView = true
  text.textContainer?.containerSize = NSSize(width:500,height:CGFloat.greatestFiniteMagnitude)
  text.identifier = NSUserInterfaceItemIdentifier("computer-use-input")
  text.isEditable = true
  text.isRichText = false
  text.delegate = self
  scroll.documentView = text
  window.contentView?.addSubview(scroll)
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(text)
  NSApplication.shared.activate(ignoringOtherApps:true)
  Timer.scheduledTimer(withTimeInterval:0.03,repeats:true) { _ in self.save() }
  save()
 }
 func textDidChange(_ notification:Notification) { save() }
 func save() {
  let prefix = CommandLine.arguments[1]
  if extra == nil && FileManager.default.fileExists(atPath:prefix + ".extra") {
   extra = NSWindow(contentRect:NSRect(x:740,y:160,width:240,height:140),styleMask:[.titled],backing:.buffered,defer:false)
   extra?.title = "Unrelated fixture window"
   extra?.orderFront(nil)
  }
  let hide = FileManager.default.fileExists(atPath:prefix + ".hide")
  if hide != hidden {
   hidden = hide
   if hide { window.orderOut(nil) } else { window.orderFront(nil) }
  }
  let pointer = window.convertPoint(fromScreen:NSEvent.mouseLocation)
  var state:[String:Any] = ["text":text.string,"pid":ProcessInfo.processInfo.processIdentifier,"selectionLength":text.selectedRange().length,"scrollY":scroll.contentView.bounds.origin.y,"lastMouse":text.lastMouse,"pointer":["x":pointer.x,"y":window.frame.height - pointer.y],"reduceMotion":NSWorkspace.shared.accessibilityDisplayShouldReduceMotion]
  if !text.string.isEmpty, let layout = text.layoutManager, let container = text.textContainer {
   let glyphs = layout.glyphRange(forCharacterRange:NSRange(location:0,length:min(16,text.string.utf16.count)),actualCharacterRange:nil)
   var rect = layout.boundingRect(forGlyphRange:glyphs,in:container)
   rect.origin.x += text.textContainerOrigin.x
   rect.origin.y += text.textContainerOrigin.y
   let converted = text.convert(rect,to:nil)
   state["selectionDrag"] = ["x":converted.minX + 1,"y":window.frame.height - converted.midY,"to_x":converted.maxX + 1,"to_y":window.frame.height - converted.midY]
  }
  if let bytes = try? JSONSerialization.data(withJSONObject:state) {
   try? bytes.write(to:URL(fileURLWithPath:CommandLine.arguments[1]),options:.atomic)
  }
 }
}
@main struct Fixture {
 static func main() {
  let app=NSApplication.shared
  app.setActivationPolicy(.regular)
  let delegate=Delegate()
  app.delegate=delegate
  app.run()
  withExtendedLifetime(delegate) {}
 }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    receipt = {
        "startedAt": time.time(),
        "claimBoundary": "Real macOS helper and controlled AppKit fixture only; no App Server/tool/provider/platform Gate B claim",
        "checks": [],
        "helperSha256": hashlib.sha256(args.helper.read_bytes()).hexdigest(),
        "fixtureSha256": hashlib.sha256(FIXTURE.encode()).hexdigest(),
    }
    root = Path(tempfile.mkdtemp(prefix="lime-cu-live-"))
    helper = fixture = lock = None
    try:
        bundle = root / "Fixture.app"
        macos = bundle / "Contents/MacOS"
        macos.mkdir(parents=True)
        (bundle / "Contents/Info.plist").write_text('''<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.limecloud.lime.computer-use-fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>Lime Computer Use Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>''')
        swift = root / "fixture.swift"
        state = root / "state.json"
        swift.write_text(FIXTURE)
        subprocess.run(["swiftc", "-O", "-parse-as-library", "-framework", "AppKit", str(swift), "-o", str(macos / "fixture")], check=True, capture_output=True)
        subprocess.run(["codesign", "--force", "--sign", "-", "--identifier", "com.limecloud.lime.computer-use-fixture", str(bundle)], check=True, capture_output=True)
        fixture = subprocess.Popen([str(macos / "fixture"), str(state)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        helper = subprocess.Popen([str(args.helper.resolve())], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        seq = 0

        def invoke(method, params, expect_error=False):
            nonlocal seq
            seq += 1
            helper.stdin.write(json.dumps({"id": str(seq), "method": method, "params": params}) + "\n")
            helper.stdin.flush()
            if not select.select([helper.stdout], [], [], 8)[0]:
                raise RuntimeError("helper timeout at " + method)
            result = json.loads(helper.stdout.readline())
            if result.get("id") != str(seq):
                raise RuntimeError("response identity mismatch")
            if expect_error:
                if result.get("ok"):
                    raise RuntimeError("invalid authority accepted")
                return result["error"]
            if not result.get("ok"):
                raise RuntimeError(method + ": " + json.dumps(result.get("error")))
            return result["result"]

        target = None
        for _ in range(80):
            snapshot = invoke("computerUse.snapshot", {})
            target = next((t["identity"] for t in snapshot["targets"] if t["identity"]["appId"] == "com.limecloud.lime.computer-use-fixture"), None)
            if target and state.is_file():
                break
            time.sleep(0.05)
        if not target:
            raise RuntimeError("fixture target unavailable; readiness=" + snapshot["readiness"])
        # AppKit finishes creating its windows after the first visible frame.
        # Await stable discovery before testing authority; never retry an input.
        stable = 0
        for _ in range(80):
            time.sleep(0.05)
            current = invoke("computerUse.snapshot", {})
            stable = stable + 1 if current == snapshot else 0
            snapshot = current
            if stable >= 3:
                break
        if stable < 3:
            raise RuntimeError("OS target discovery did not stabilize")
        receipt["checks"].append("OS-discovered signed fixture target")
        control = Path.home() / "Library/Application Support/lime/computer-use"
        control.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(control / "desktop.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        lock = os.fdopen(fd, "r+b", buffering=0)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        previous = lock.read()
        if len(previous) not in (0, 8):
            raise RuntimeError("existing control fence corrupt")
        fence = int.from_bytes(previous, "big") + 1
        lock.seek(0)
        lock.write(fence.to_bytes(8, "big"))
        os.fsync(lock.fileno())

        def execute(operation, authority=None, expect_error=False):
            current = invoke("computerUse.snapshot", {})
            params = {"target": target, "generation": current["generation"], "fence": fence, "operation": operation}
            params.update(authority or {})
            return invoke("computerUse.execute", params, expect_error)

        def readback(expected):
            for _ in range(100):
                value = json.loads(state.read_text())["text"]
                if value == expected:
                    return
                time.sleep(0.02)
            raise RuntimeError("text readback mismatch: " + repr(value))

        execute({"action": "observe", "max_depth": 5, "max_nodes": 128})
        receipt["checks"].append("bounded AX observation")
        screen = execute({"action": "screenshot"})
        if screen["format"] != "png" or screen["width"] < 1:
            raise RuntimeError("invalid screenshot")
        receipt["checks"].append("target-only PNG screenshot")
        execute({"action": "click", "x": 140, "y": 90, "button": "left", "count": 1})
        def mouse_readback(button, count):
            for _ in range(100):
                current = json.loads(state.read_text())
                pointer = current["pointer"]
                if (current["lastMouse"] == {"button": button, "count": count}
                        and abs(pointer["x"] - 140) < 2 and abs(pointer["y"] - 90) < 2):
                    return {"pointer": pointer, "event": current["lastMouse"]}
                time.sleep(0.02)
            raise RuntimeError("real mouse pointer/button readback mismatch: " + json.dumps(current))

        receipt["mouseReadback"] = [mouse_readback(0, 1)]
        receipt["checks"].append("system pointer moved to approved window coordinates and real left click received")
        overlay = next((w for w in invoke("window.read", {})["windows"]
                        if w.get("title") == "Lime Computer Use Pointer" and w["ownerPid"] == helper.pid), None)
        if not overlay or overlay["layer"] <= 0:
            raise RuntimeError("native animated pointer overlay was not visible after real mouse input")
        receipt["pointerOverlay"] = overlay
        receipt["checks"].append("real native gradient pointer overlay visible above the approved window")
        pointer_frames = []
        for index in range(2):
            time.sleep(0.12)
            frame = invoke("screenCapture.snapshot", {"windowId": overlay["windowId"]})
            pixels = base64.b64decode(frame["data"])
            args.evidence.parent.mkdir(parents=True, exist_ok=True)
            (args.evidence.parent / f"native-pointer-frame-{index}.png").write_bytes(pixels)
            pointer_frames.append(hashlib.sha256(pixels).hexdigest())
        receipt["pointerAnimation"] = {"frameSha256": pointer_frames, "reduceMotion": json.loads(state.read_text())["reduceMotion"]}
        if not receipt["pointerAnimation"]["reduceMotion"] and len(set(pointer_frames)) != 2:
            raise RuntimeError("native gradient pointer did not animate in real window captures")
        receipt["checks"].append("native pointer animation captured in two real overlay frames; respects reduced motion")
        for button, number, count in [("left", 0, 2), ("right", 1, 1), ("middle", 2, 1)]:
            execute({"action": "click", "x": 140, "y": 90, "button": button, "count": count})
            receipt["mouseReadback"].append(mouse_readback(number, count))
        receipt["checks"].append("real double click, right click and middle click received by the exact fixture window")
        execute({"action": "click", "x": 140, "y": 90, "button": "left", "count": 1})
        mouse_readback(0, 1)
        for _ in range(180):
            if not any(w.get("title") == "Lime Computer Use Pointer" and w["ownerPid"] == helper.pid
                       for w in invoke("window.read", {})["windows"]):
                break
            time.sleep(0.02)
        else:
            raise RuntimeError("native pointer overlay did not restore the regular cursor after idle")
        receipt["checks"].append("native pointer overlay dismissed after idle, restoring the regular pointer")
        # Put a surrogate pair across the 32 UTF-16 chunk boundary.
        marker = "Lime " + "a" * 26 + "🟢复刻"
        execute({"action": "type", "text": marker})
        readback(marker)
        receipt["checks"].append("Unicode type including surrogate chunk boundary verified by live AppKit readback")
        execute({"action": "key", "key": "a", "modifiers": ["command"]})
        execute({"action": "type", "text": "Lime replacement"})
        readback("Lime replacement")
        receipt["checks"].append("Command+A and replacement verified by live readback")
        drag = json.loads(state.read_text())["selectionDrag"]
        execute({"action": "drag", **drag, "duration_ms": 80})
        for _ in range(100):
            if json.loads(state.read_text())["selectionLength"] > 0:
                break
            time.sleep(0.02)
        else:
            raise RuntimeError("bounded drag did not select real text")
        receipt["checks"].append("bounded drag verified by live text selection")
        execute({"action": "key", "key": "a", "modifiers": ["command"]})
        long_text = "\n".join("Lime scroll line " + str(i) for i in range(60))
        execute({"action": "type", "text": long_text})
        readback(long_text)
        time.sleep(0.1)
        scroll_before = json.loads(state.read_text())["scrollY"]
        receipt["scrollReadback"] = {"before":scroll_before}
        execute({"action": "scroll", "x": 140, "y": 90, "delta_x": 0, "delta_y": 100 if scroll_before > 0 else -100})
        for _ in range(100):
            scroll_after = json.loads(state.read_text())["scrollY"]
            receipt["scrollReadback"]["after"] = scroll_after
            if abs(scroll_after - scroll_before) > 1:
                break
            time.sleep(0.02)
        else:
            raise RuntimeError("targeted scroll did not move the real viewport")
        receipt["scrollReadback"] = {"before":scroll_before,"after":scroll_after}
        receipt["checks"].append("targeted scroll verified by live viewport offset")
        execute({"action": "key", "key": "a", "modifiers": ["command"]})
        execute({"action": "type", "text": "Lime replacement"})
        readback("Lime replacement")
        current = invoke("computerUse.snapshot", {})
        seq += 1
        action_id = str(seq)
        helper.stdin.write(json.dumps({"id": action_id, "method": "computerUse.execute", "params": {
            "target": target, "generation": current["generation"], "fence": fence,
            "operation": {"action": "drag", "x": 50, "y": 90, "to_x": 180, "to_y": 90, "duration_ms": 1500},
        }}) + "\n")
        helper.stdin.flush()
        time.sleep(0.05)
        cancel_at = time.monotonic()
        helper.stdin.write(json.dumps({"id": "cancel", "method": "computerUse.cancel", "params": {}}) + "\n")
        helper.stdin.flush()
        if not select.select([helper.stdout], [], [], 2)[0]:
            raise RuntimeError("drag cancellation timed out")
        canceled = json.loads(helper.stdout.readline())
        if canceled.get("id") != action_id or canceled.get("ok") or canceled.get("error", {}).get("code") != "operation_failed":
            raise RuntimeError("drag cancellation did not return explicit failure")
        receipt["cancellationMs"] = round((time.monotonic() - cancel_at) * 1000)
        execute({"action": "key", "key": "a", "modifiers": ["command"]})
        execute({"action": "type", "text": "After cancellation"})
        readback("After cancellation")
        receipt["checks"].append("in-flight drag canceled with bounded response and subsequent text readback")
        execute({"action": "screenshot"}, {"generation": 0}, True)
        execute({"action": "screenshot"}, {"fence": fence + 1}, True)
        receipt["checks"].append("stale generation and wrong persisted fence rejected")
        issued = invoke("computerUse.snapshot", {})["generation"]
        Path(str(state) + ".extra").touch()
        for _ in range(80):
            current = invoke("computerUse.snapshot", {})
            if any(t["identity"].get("title") == "Unrelated fixture window" for t in current["targets"]):
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("secondary fixture window not discovered")
        execute({"action":"screenshot"}, {"generation":issued})
        receipt["checks"].append("unrelated window changes retain the issued exact target revision")
        issued = invoke("computerUse.snapshot", {})["generation"]
        Path(str(state) + ".hide").touch()
        for _ in range(80):
            current = invoke("computerUse.snapshot", {})
            if not any(t["identity"].get("windowId") == target["windowId"] for t in current["targets"]):
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("primary fixture window did not hide")
        execute({"action":"screenshot"}, {"generation":issued}, True)
        Path(str(state) + ".hide").unlink()
        for _ in range(80):
            current = invoke("computerUse.snapshot", {})
            if any(t["identity"].get("windowId") == target["windowId"] for t in current["targets"]):
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("primary fixture window did not return")
        execute({"action":"screenshot"}, {"generation":issued}, True)
        receipt["checks"].append("hidden and returned target retires its previous revision")
        fcntl.flock(lock, fcntl.LOCK_UN)
        execute({"action": "screenshot"}, expect_error=True)
        receipt["checks"].append("released control lock rejected")
        receipt["result"] = "pass"
    except Exception as error:
        receipt["result"] = "fail"
        receipt["error"] = str(error)
    finally:
        for child in [helper, fixture]:
            if child:
                child.terminate()
                try:
                    child.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        if lock:
            lock.close()
        receipt["completedAt"] = time.time()
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        shutil.rmtree(root)
    return 0 if receipt["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
