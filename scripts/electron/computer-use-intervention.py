"""Real macOS helper intervention probe using a dedicated, disposable window.

External input is injected by a separate test process; this is OS event-path
evidence, not a claim of physical hardware, model, or product Host acceptance.
"""

import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import queue
import shutil
import statistics
import subprocess
import sys
import threading
import time
import uuid


def wait_for(read, predicate, description, timeout=10):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = read()
            if predicate(last):
                return last
        except FileNotFoundError:
            pass
        time.sleep(0.02)
    raise RuntimeError(f"{description}: last={last}")


class Helper:
    def __init__(self, executable, evidence):
        self.errors = (evidence / "helper.stderr").open("w")
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.errors, text=True)
        self.responses = queue.Queue()
        self.counter = 0
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        for line in self.process.stdout:
            try:
                value = json.loads(line)
                if "event" not in value:
                    self.responses.put(value)
            except ValueError as error:
                self.responses.put(error)
        self.responses.put(RuntimeError("helper exited"))

    def request(self, method, params):
        self.counter += 1
        request_id = str(self.counter)
        self.process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        result = self.responses.get(timeout=20)
        if isinstance(result, Exception):
            raise result
        assert result["id"] == request_id, result
        return result

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.errors.close()


def run(args, receipt):
    evidence = args.evidence_dir.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    bundle = evidence / "Intervention Fixture.app"
    executable = bundle / "Contents/MacOS/intervention-fixture"
    executable.parent.mkdir(parents=True, exist_ok=True)
    app_id = "com.limecloud.lime.intervention-fixture"
    with (bundle / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump({"CFBundleIdentifier": app_id, "CFBundleExecutable": executable.name,
                       "CFBundlePackageType": "APPL", "CFBundleName": "Lime Intervention Fixture"}, stream)
    source = Path("scripts/electron/macos-computer-use-intervention-fixture.swift").resolve()
    compiled = subprocess.run(["swiftc", "-parse-as-library", str(source), "-framework", "AppKit",
                               "-o", str(executable)], capture_output=True)
    (evidence / "observer-build.log").write_bytes(compiled.stdout + compiled.stderr)
    compiled.check_returncode()
    subprocess.run(["codesign", "--force", "--sign", "-", "--identifier", app_id, str(bundle)],
                   check=True, capture_output=True)
    injector = evidence / "input-injector"
    shutil.copy2(executable, injector)
    permission = json.loads(subprocess.check_output([str(injector), "--permissions"], text=True, timeout=5))
    receipt["injectorPermissions"] = permission
    assert all(permission.get(name) is True for name in ["accessibility", "listen", "post"]), \
        "test injector requires existing Accessibility/Input Monitoring/event-posting authorization"
    wait_for(lambda: float(subprocess.check_output([str(injector), "--idle"], text=True, timeout=5)),
             lambda seconds: seconds >= 3, "desktop idle window before opening the fixture", timeout=30)
    input_file = evidence / f"input-{uuid.uuid4()}.json"
    observer = subprocess.Popen([str(injector), "--listen", str(input_file)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    state_file = evidence / f"fixture-{uuid.uuid4()}.json"
    fixture = subprocess.Popen([str(executable), str(state_file)], stdout=subprocess.DEVNULL,
                               stderr=(evidence / "fixture.stderr").open("w"))
    helper = None
    lock_fd = None
    try:
        read = lambda: json.loads(state_file.read_text())
        def read_input():
            value = json.loads(input_file.read_text())
            assert value.get("ready"), "independent input observer was disabled"
            return value
        wait_for(read_input, lambda value: value.get("ready"), "independent input observer")
        state = wait_for(read, lambda value: value.get("text") == "ready", "fixture launch")
        # The same real OS lock as ControlBroker prevents this probe from racing
        # another Computer Use process. Never unlink it or roll its fence back.
        lock_path = Path.home() / "Library/Application Support/lime/computer-use/desktop.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        metadata = os.fstat(lock_fd)
        assert metadata.st_nlink == 1 and metadata.st_mode & 0o077 == 0
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior = os.read(lock_fd, 8)
        fence = (int.from_bytes(prior, "big") if len(prior) == 8 else 0) + 1
        os.lseek(lock_fd, 0, os.SEEK_SET)
        os.write(lock_fd, fence.to_bytes(8, "big"))
        os.ftruncate(lock_fd, 8)
        helper = Helper(args.helper.resolve(), evidence)
        snapshot = helper.request("computerUse.snapshot", {})
        assert snapshot["ok"] and snapshot["result"]["readiness"] == "ready"
        generation = snapshot["result"]["generation"]
        targets = [target for target in snapshot["result"]["targets"]
                   if target["identity"]["appId"] == app_id
                   and target["identity"]["processId"] == fixture.pid]
        assert len(targets) == 1, "dedicated signed fixture must be discovered exactly once"
        identity = targets[0]["identity"]
        receipt["helperSha256"] = hashlib.sha256(args.helper.read_bytes()).hexdigest()
        receipt["fixtureSha256"] = hashlib.sha256(executable.read_bytes()).hexdigest()
        receipt["target"] = identity
        owner = {"connection": "intervention-probe", "thread_id": str(uuid.uuid4()), "turn_id": "first"}

        def action(operation):
            return helper.request("computerUse.execute", {"target": identity, "owner": owner,
                "generation": generation, "fence": fence, "operation": operation})

        def succeed(operation):
            result = action(operation)
            assert result["ok"], result
            return result["result"]

        def replace(text):
            original = read()["text"]
            succeed({"action": "key", "key": "a", "modifiers": ["command"]})
            wait_for(read, lambda value: value["selectedLength"] == len(original.encode("utf-16-le")) // 2,
                     "independent select-all readback")
            succeed({"action": "type", "text": text})
            wait_for(read, lambda value: value["text"] == text, "independent text readback")

        def click():
            before = read_input()["ownMouseUps"]
            succeed({"action": "click", **state["click"], "button": "left", "count": 1})
            wait_for(read_input, lambda value: value["ownMouseUps"] > before and read()["editing"],
                     "native click reached the dedicated field editor")

        def inject(kind):
            before = read_input()["externalInputs"]
            point = read()["screenPoint"]
            expected = before + (2 if kind == "key" else 1)
            injection = subprocess.Popen([str(injector), "--inject", kind, str(point["x"]), str(point["y"])],
                                         stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
            try:
                wait_for(read_input, lambda value: value["externalInputs"] >= expected, "external event delivered")
            finally:
                try:
                    injection.communicate("\n", timeout=5)
                except subprocess.TimeoutExpired:
                    injection.kill()
                    injection.wait(timeout=5)
            assert injection.returncode == 0, "test input injector failed"

        def pointer_state(pid=None):
            return json.loads(subprocess.check_output([str(injector), "--cursor-state",
                str(pid if pid is not None else helper.process.pid)], text=True, timeout=5))

        def pointer_visible(visible):
            return wait_for(pointer_state, lambda value: bool(value["pointerWindows"]) == visible,
                            f"independent pointer window visible={visible}", timeout=5)

        if args.cursor_motion:
            succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
            pointer_visible(True)
            frames_dir = evidence / "motion-frames"
            recording = subprocess.Popen([str(injector), "--record-cursor", str(helper.process.pid), str(frames_dir)],
                                         stdout=subprocess.DEVNULL, stderr=(evidence / "cursor-recorder.stderr").open("w"))
            def read_frames():
                code = recording.poll()
                if code is not None and code != 0:
                    raise RuntimeError(f"overlay recorder exited {code}; see cursor-recorder.stderr")
                frames = json.loads((frames_dir / "frames.json").read_text())
                if frames.get("captureError"):
                    raise RuntimeError(f"overlay recorder failed: {frames['captureError']}")
                return frames
            try:
                initial = wait_for(read_frames, lambda value: len(value["samples"]) >= 6,
                                   "independent overlay pixel recorder")
                assert not initial["reducedMotion"], "motion probe requires animations already enabled; do not change system settings"
                baseline = initial["samples"][-6:]
                click()
                drag_before = len(read_frames()["samples"])
                succeed({"action": "drag", **state["click"], "to_x": state["click"]["x"] + 120,
                         "to_y": state["click"]["y"], "duration_ms": 1200})
                drag_after = len(read_frames()["samples"])
                recording.wait(timeout=10)
                assert recording.returncode == 0, "overlay recorder failed"
                captured = read_frames()["samples"]
                dragging = captured[drag_before + 3:drag_after - 3]
                assert len(dragging) >= 8, "not enough independent pressed-drag frames"
                settled = captured[-6:]
                baseline_area = statistics.median(sample["solidPixels"] for sample in baseline)
                drag_area = statistics.median(sample["solidPixels"] for sample in dragging)
                settled_area = statistics.median(sample["solidPixels"] for sample in settled)
                assert baseline_area > 0 and drag_area < baseline_area * 0.9, (baseline_area, drag_area)
                assert abs(settled_area - baseline_area) < baseline_area * 0.12, (baseline_area, settled_area)
                assert all(sample["transparentPixels"] > 0 for sample in captured)
                receipt["motionPixels"] = {"samples": len(captured), "dragRange": [drag_before, drag_after],
                    "baselineSolidPixels": baseline_area, "pressedDragSolidPixels": drag_area,
                    "releasedSolidPixels": settled_area,
                    "pngSha256": {sample["file"]: hashlib.sha256((frames_dir / sample["file"]).read_bytes()).hexdigest()
                                  for sample in captured}}
                receipt["checks"].append("independent overlay PNGs show pressed drag compression and released recovery with transparent background")
            finally:
                if recording.poll() is None:
                    recording.terminate()
                    recording.wait(timeout=5)
                receipt["motionRecorderExitCode"] = recording.returncode

        if args.cursor_lifecycle:
            receipt["unverified"] = ["system cursor visibility: current macOS SDK marks CGCursorIsVisible unavailable; OS window readback proves only the Agent overlay"]
            succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
            pointer_visible(True)
            samples = []
            started = time.monotonic()
            while time.monotonic() - started <= 11:
                value = pointer_state()
                assert len(value["pointerWindows"]) == 1, value
                samples.append({"elapsed": time.monotonic() - started, **value})
                time.sleep(0.2)
            receipt["idlePointerSamples"] = samples
            receipt["idleDurationSeconds"] = time.monotonic() - started
            receipt["checks"].append("observe-only Agent pointer stays visible beyond 10 seconds")
            marker = "keyboard-only-中文🚀-" + str(uuid.uuid4())
            replace(marker)
            pointer_visible(True)
            receipt["checks"].append("keyboard-only input preserves the Agent pointer without a mouse action")
            old_owner = owner.copy()
            assert helper.request("computerUse.finishTurn", {"owner": old_owner})["ok"]
            pointer_visible(False)
            owner["turn_id"] = str(uuid.uuid4())
            succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
            pointer_visible(True)
            assert helper.request("computerUse.finishTurn", {"owner": old_owner})["ok"]
            pointer_visible(True)
            wrong_connection = {**owner, "connection": "other-connection"}
            assert helper.request("computerUse.finishTurn", {"owner": wrong_connection})["ok"]
            pointer_visible(True)
            receipt["checks"].append("matching terminal hides the pointer; delayed old-turn or foreign-connection terminal preserves the new pointer")

        click()
        if args.cursor_lifecycle:
            pointer_visible(True)
        marker = "own-input-" + str(uuid.uuid4())
        replace(marker)
        succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
        receipt["checks"].append("own mouse and Unicode keyboard injection did not trigger intervention")
        for kind in ["mouse", "key"]:
            inject(kind)
            if args.cursor_lifecycle:
                pointer_visible(False)
            result = action({"action": "type", "text": "MUST_NOT_APPEAR"})
            assert not result["ok"] and result["error"]["code"] == "user_intervened", result
            again = action({"action": "type", "text": "MUST_NOT_APPEAR"})
            assert not again["ok"] and again["error"]["code"] == "user_intervened", again
            assert read()["text"] == marker, "no subsequent input after takeover"
            receipt["checks"].append(f"external {kind} input fences subsequent requests of the same turn")
            interrupted_turn = owner["turn_id"]
            owner["turn_id"] = str(uuid.uuid4())
            succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
            click()
            marker = "explicit-resume-中文🚀-" + str(uuid.uuid4())
            replace(marker)
            resumed_turn = owner["turn_id"]
            owner["turn_id"] = interrupted_turn
            stale = action({"action": "type", "text": "MUST_NOT_APPEAR"})
            assert not stale["ok"] and stale["error"]["code"] == "user_intervened", stale
            assert read()["text"] == marker, "interleaving a new turn revived old input"
            owner["turn_id"] = resumed_turn
        receipt["checks"].append("explicit new turns observe first and then accept new input without replay")
        before = read_input()["drags"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(action, {"action": "drag", **state["click"],
                "to_x": state["click"]["x"] + 120, "to_y": state["click"]["y"], "duration_ms": 2000})
            wait_for(read_input, lambda value: value["drags"] > before, "native drag started")
            inject("mouse")
            result = pending.result(timeout=5)
        assert not result["ok"] and result["error"]["code"] == "user_intervened", result
        released = subprocess.check_output([str(injector), "--button-state"], text=True, timeout=5).strip()
        assert released == "released", released
        receipt["checks"].append("in-flight drag stops and releases the held mouse button")
        if args.cursor_lifecycle:
            owner["turn_id"] = str(uuid.uuid4())
            succeed({"action": "observe", "max_depth": 3, "max_nodes": 64})
            pointer_visible(True)
            helper_pid = helper.process.pid
            helper.close()
            helper = None
            wait_for(lambda: pointer_state(helper_pid), lambda value: not value["pointerWindows"], "EOF removes the native overlay")
            receipt["checks"].append("EOF reaps the helper and removes its pointer window")
        receipt["result"] = "pass"
    finally:
        if helper:
            helper.close()
        if lock_fd is not None:
            os.close(lock_fd)
        observer.terminate()
        observer.wait(timeout=5)
        fixture.terminate()
        try:
            fixture.wait(timeout=5)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--cursor-lifecycle", action="store_true", help="also verify persistent overlay and owner-scoped terminal cleanup")
    parser.add_argument("--cursor-motion", action="store_true", help="also independently capture the actual overlay during press/drag/release")
    options = parser.parse_args()
    options.cursor_lifecycle = options.cursor_lifecycle or options.cursor_motion
    receipt = {"result": "failed", "checks": [], "liveModelUsed": False,
        "claimBoundary": "real macOS helper with separate-process OS input injection; not physical hardware or Desktop/CLI/TUI Gate B"}
    try:
        assert sys.platform == "darwin", "requires macOS"
        run(options, receipt)
    except Exception as error:
        receipt["error"] = repr(error)
        raise
    finally:
        options.evidence_dir.mkdir(parents=True, exist_ok=True)
        (options.evidence_dir / "intervention.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(receipt, ensure_ascii=False))
