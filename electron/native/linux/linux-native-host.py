#!/usr/bin/python3
"""Lime X11 adapter. Public upstream has no Linux native helper to copy.

The same helper serves Electron and the standalone App Server. X11 clients of
one OS user share a trust boundary; this does not sandbox hostile applications.
Dependencies are distribution packages, never downloaded at helper startup.
"""
import base64
from contextlib import contextmanager, nullcontext
import fcntl
import hashlib
import io
import json
import math
import os
from pathlib import Path
import pwd
import queue
import select
import signal
import stat
import struct
import subprocess
import sys
import threading
import time

MAX_FRAME = 1024 * 1024
MAX_PIXELS = 4096 * 2160
OUTPUT_LOCK = threading.Lock()


class Denied(Exception):
    def __init__(self, message, code="not_granted"):
        super().__init__(message)
        self.code = code


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def reply(request_id, result=None, error=None):
    value = {"id": request_id, "ok": error is None}
    if error is None:
        value["result"] = result
    else:
        value["error"] = {"code": getattr(error, "code", "operation_failed"),
                          "message": str(error) if isinstance(error, Denied) else "Linux native operation failed; outcome may be unknown"}
    with OUTPUT_LOCK:
        print(encode(value), flush=True)


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise Denied("Integer outside allowed bounds", "invalid_argument")
    return value


def active_window_matches(property_value, window_id):
    values = list(property_value.value) if property_value is not None else []
    # Xfwm may append a zero word. Never accept a second nonzero window ID.
    return bool(values) and values[0] == window_id and all(value == 0 for value in values[1:])


def lock_root():
    # Match dirs::data_dir()/lime/computer-use; config/workspace overrides do not apply.
    home = pwd.getpwuid(os.getuid()).pw_dir
    data = os.environ.get("XDG_DATA_HOME") or str(Path(home) / ".local/share")
    if not Path(data).is_absolute():
        raise Denied("XDG data directory must be absolute")
    return Path(data) / "lime/computer-use"


def private_file(path, create=False):
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
    if create:
        flags |= os.O_CREAT
    fd = os.open(path, flags, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        os.close(fd)
        raise Denied("Desktop control file must be a private regular file")
    return fd


def check_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise Denied("Desktop control directory must be private")


def check_fence(expected):
    root = lock_root()
    check_directory(root)
    if any((root / name).exists() for name in ("human-control", "consent-control")):
        raise Denied("Human control has fenced AI input", "user_intervened")
    fd = private_file(root / "desktop.lock")
    try:
        if os.fstat(fd).st_size != 8 or os.pread(fd, 8, 0) != expected.to_bytes(8, "big"):
            raise Denied("Desktop input fence changed")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        fcntl.flock(fd, fcntl.LOCK_UN)
        raise Denied("App Server does not hold the desktop input lease")
    finally:
        os.close(fd)


def vnc_input(enabled):
    failures = []
    for name in ("AcceptKeyEvents", "AcceptPointerEvents"):
        try:
            # vncconfig can exit zero while reporting that a setting was rejected.
            subprocess.run(["/usr/bin/vncconfig", "-set", f"{name}={int(enabled)}"], check=True,
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
            actual = subprocess.run(["/usr/bin/vncconfig", "-get", name], check=True,
                                    stdin=subprocess.DEVNULL, capture_output=True, timeout=5).stdout.strip().lower()
            if actual not in ((b"1", b"on", b"true") if enabled else (b"0", b"off", b"false")):
                raise Denied("VNC input state could not be verified")
        except (OSError, subprocess.SubprocessError, Denied) as error:
            failures.append(error)
    if failures:
        raise failures[0]


@contextmanager
def consent_control(canceled):
    """Fence all AI helpers while the user answers the managed VNC OS dialog."""
    root = lock_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    check_directory(root)
    if (root / "human-control").exists():
        raise Denied("Return desktop control to AI before requesting application approval")
    latch = root / "consent-control"
    latch_fd = os.open(latch, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(latch_fd)
    fd = None
    acquired = False
    try:
        fd = private_file(root / "desktop.lock", create=True)
        deadline = time.monotonic() + 10
        while not acquired:
            if canceled() or (root / "human-control").exists():
                raise Denied("Approval canceled or human control requested", "canceled")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise Denied("AI input has not stopped; viewer input remains disabled")
                time.sleep(0.05)
        if canceled() or (root / "human-control").exists():
            raise Denied("Approval canceled or human control requested", "canceled")
        raw = os.pread(fd, 8, 0)
        previous = int.from_bytes(raw, "big") if len(raw) == 8 else 0
        if len(raw) not in (0, 8) or previous == 2**64 - 1:
            raise Denied("Desktop fence is corrupt or exhausted")
        os.pwrite(fd, (previous + 1).to_bytes(8, "big"), 0)
        os.fsync(fd)
        vnc_input(True)
        yield
    finally:
        # Keep the latch on an uncertain failure to disable VNC. Only an explicit
        # operator recovery may resume AI after that failure.
        try:
            if acquired:
                vnc_input(False)
            latch.unlink()
        finally:
            if fd is not None:
                os.close(fd)


def human_control(resume_ai=False):
    def stop(_signum, _frame):
        raise KeyboardInterrupt()
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)
    root = lock_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    check_directory(root)
    latch = root / "human-control"
    if resume_ai:
        vnc_input(False)
        fd = private_file(root / "desktop.lock", create=True)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Denied("Desktop control or approval is still active; cancel it before resuming AI")
            for name in ("human-control", "consent-control"):
                path = root / name
                if path.exists():
                    check = private_file(path)
                    os.close(check)
                    path.unlink()
        finally:
            os.close(fd)
        return
    latch_fd = private_file(latch, create=True)
    os.close(latch_fd)
    # The latch cancels in-flight helper input before waiting for the OS lease.
    fd = private_file(root / "desktop.lock", create=True)
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise Denied("AI input has not stopped; VNC input remains disabled")
                time.sleep(0.05)
        raw = os.pread(fd, 8, 0)
        previous = int.from_bytes(raw, "big") if len(raw) == 8 else 0
        if len(raw) not in (0, 8) or previous == 2**64 - 1:
            raise Denied("Desktop fence is corrupt or exhausted")
        os.pwrite(fd, (previous + 1).to_bytes(8, "big"), 0)
        os.fsync(fd)
        vnc_input(True)
        print("Human control active. Press Ctrl+C to stop. AI remains paused until --control-ai.", file=sys.stderr, flush=True)
        while True:
            signal.pause()
    finally:
        try:
            vnc_input(False)
        finally:
            os.close(fd)


class InputMonitor:
    def __init__(self):
        self.epoch = 0
        self.ready = threading.Event()
        self.available = False
        threading.Thread(target=self.run, daemon=True).start()
        self.ready.wait(3)

    def run(self):
        try:
            from Xlib import display
            from Xlib.ext import xinput
            connection = display.Display()
            connection.xinput_query_version()
            devices = connection.xinput_query_device(xinput.AllDevices).devices
            synthetic = {device.deviceid for device in devices if "XTEST" in device.name}
            if len(synthetic) < 2:
                raise Denied("Cannot identify XTEST input devices")
            # Raw events include input outside the selected window. XTEST's own
            # source devices are ignored; noVNC takeover is independently fenced.
            root = connection.screen().root
            raw_events = (13, 14, 15, 16, 17)
            root.xinput_select_events([(xinput.AllMasterDevices, sum(1 << event for event in raw_events)),
                                       (xinput.AllDevices, 1 << xinput.HierarchyChanged)])
            connection.sync()
            self.available = True
            self.ready.set()
            while True:
                if not connection.pending_events():
                    select.select([connection.fileno()], [], [], 1)
                    continue
                event = connection.next_event()
                if getattr(event, "evtype", None) == xinput.HierarchyChanged:
                    raise Denied("Input device topology changed")
                if getattr(event, "evtype", None) in raw_events:
                    raw = event.data
                    if not isinstance(raw, bytes) or len(raw) < 12:
                        raise Denied("Invalid raw input event")
                    source = struct.unpack_from("=H", raw, 10)[0]
                    if source not in synthetic:
                        self.epoch += 1
        except Exception:
            self.available = False
            self.epoch += 1
            self.ready.set()


class Driver:
    def __init__(self):
        self.display = None
        self.monitor = None
        self.generation = 0
        self.fingerprint = None
        self.revision_clock = 0
        self.revisions = {}
        self.targets = {}
        self.approved = {}
        self.turn_epochs = {}
        self.display_failure = "linux_x11_session_unavailable"
        try:
            from Xlib import X, XK, display
            from Xlib.ext import res, xtest
            from PIL import Image
            if os.getuid() == 0 or os.environ.get("XDG_SESSION_TYPE", "x11") != "x11":
                raise Denied("An unprivileged X11 user session is required")
            if os.stat(f"/proc/{os.getppid()}").st_uid != os.getuid():
                raise Denied("Parent App Server belongs to a different user")
            self.display = display.Display()
            self.X, self.XK, self.Image, self.xtest, self.res = X, XK, Image, xtest, res
            version = self.display.res_query_version(1, 2)
            if (version.server_major, version.server_minor) < (1, 2):
                self.display_failure = "linux_x11_window_identity_unavailable"
                raise Denied("XRes 1.2 local process identity is required")
            if not self.display.has_extension("XTEST"):
                self.display_failure = "linux_x11_xtest_unavailable"
                raise Denied("XTEST is unavailable")
            self.monitor = InputMonitor()
        except Exception:
            self.display = None

    def block_reason(self):
        if not self.display:
            return self.display_failure
        root = lock_root()
        if (root / "human-control").exists():
            return "linux_human_control_active"
        if (root / "consent-control").exists():
            return "linux_desktop_consent_pending"
        if not self.monitor or not self.monitor.available:
            return "linux_x11_input_monitor_unavailable"
        try:
            desktop = set(os.environ.get("XDG_CURRENT_DESKTOP", "").lower().split(":"))
            if "gnome" in desktop:
                bus, object_path = "org.gnome.ScreenSaver", "/org/gnome/ScreenSaver"
            elif "xfce" in desktop:
                bus, object_path = "org.xfce.ScreenSaver", "/org/xfce/ScreenSaver"
            else:
                return "linux_desktop_lock_state_unavailable"
            # Query only the current desktop's own lock service. A missing or
            # failed service never falls back to an unrelated unlocked daemon.
            result = subprocess.run(["/usr/bin/gdbus", "call", "--session", "--dest", bus,
                                     "--object-path", object_path, "--method", bus + ".GetActive"],
                                    capture_output=True, timeout=2, check=True)
            status = result.stdout.strip()
            if status == b"(false,)":
                return None
            if status == b"(true,)":
                return "linux_desktop_locked"
        except (OSError, subprocess.SubprocessError):
            pass
        return "linux_desktop_lock_state_unavailable"

    def property(self, window, name, kind=None):
        return window.get_full_property(self.display.intern_atom(name), self.X.AnyPropertyType if kind is None else kind)

    def target_revision(self, key, stamp):
        previous = self.revisions.get(key)
        if previous is None or previous[0] != stamp:
            if self.revision_clock == 2**64 - 1:
                raise Denied("Target revision exhausted")
            self.revision_clock += 1
            previous = (stamp, str(self.revision_clock))
            self.revisions[key] = previous
        return previous[1]

    def target(self, window):
        attributes = window.get_attributes()
        geometry = window.get_geometry()
        if attributes.map_state != self.X.IsViewable or not 0 < geometry.width <= 4096 or not 0 < geometry.height <= 2160:
            raise Denied("Window is not viewable")
        ids = self.display.res_query_client_ids([{"client": window.id, "mask": self.res.LocalClientPIDMask}]).ids
        pids = [int(value.value[0]) for value in ids if value.spec.mask & self.res.LocalClientPIDMask and len(value.value) == 1]
        if len(set(pids)) != 1:
            raise Denied("Window process could not be verified by XRes")
        pid = pids[0]
        proc = Path(f"/proc/{pid}")
        if pid == os.getpid() or proc.stat().st_uid != os.getuid():
            raise Denied("Window belongs to a different user")
        executable = str((proc / "exe").resolve(strict=True))
        binary = os.stat(proc / "exe")
        # comm may contain spaces and parentheses; starttime is field 22 after the final ')'.
        started = (proc / "stat").read_text().rsplit(")", 1)[1].split()[19]
        origin = self.display.screen().root.translate_coords(window, 0, 0)
        title_property = self.property(window, "_NET_WM_NAME")
        title = bytes(title_property.value).decode("utf8", "replace")[:512] if title_property else ""
        stamp = [window.id, pid, executable, binary.st_dev, binary.st_ino, started, origin.x, origin.y, geometry.width, geometry.height]
        revision = self.target_revision(f"{window.id}:{started}", hashlib.sha256(encode(stamp).encode()).hexdigest())
        identity = {"type": "native", "appId": executable, "processId": pid, "windowId": f"{window.id}:{started}", "title": title}
        return {"identity": identity, "revision": revision, "nativeApp": {"type": "linux", "executable": executable},
                "capabilities": ["observe", "screenshot", "click", "type", "key", "scroll", "drag"], "locked": False}, window

    def update_targets(self, reason, targets):
        fingerprint = encode([reason, sorted((key, value[0]["revision"]) for key, value in targets.items())])
        if fingerprint != self.fingerprint:
            self.generation += 1
            self.approved.clear()
            self.fingerprint = fingerprint
        self.targets = targets
        # Retire disappeared or blocked targets; reappearance cannot revive an old grant.
        self.revisions = {key: value for key, value in self.revisions.items() if key in targets}

    def snapshot(self):
        targets = {}
        reason = self.block_reason()
        if reason is None:
            try:
                windows = self.property(self.display.screen().root, "_NET_CLIENT_LIST")
                for window_id in list(windows.value if windows else [])[:256]:
                    try:
                        value, window = self.target(self.display.create_resource_object("window", int(window_id)))
                        targets[value["identity"]["windowId"]] = (value, window)
                    except Exception:
                        continue
            except Exception:
                reason = "linux_x11_window_list_unavailable"
        self.update_targets(reason, targets)
        return {"generation": self.generation, "readiness": "ready" if reason is None else "blocked",
                "targets": [value[0] for value in targets.values()],
                "reason": reason,
                "setupSteps": [] if reason is None else ["start_gnome_or_xfce_x11_session", "unlock_desktop_and_keyring", "release_human_control_explicitly"]}

    def select_target(self, identity):
        if not isinstance(identity, dict) or identity.get("type") != "native":
            raise Denied("Native target required")
        target = self.targets.get(identity.get("windowId"))
        if not target or any(identity.get(key) != target[0]["identity"].get(key) for key in ("appId", "processId", "windowId")):
            raise Denied("Native target identity changed")
        return target

    def setup(self, params, canceled):
        snapshot = self.snapshot()
        if params.get("adapter") != "native" or params.get("grantScope") != "session":
            raise Denied("Linux requires explicit per-session application approval")
        selected = params.get("target")
        accepted = False
        if selected is not None:
            target, _ = self.select_target(selected)
            stamp = target["revision"]
            managed = os.environ.get("LIME_MANAGED_VNC_SESSION") == "1"
            # The OS dialog is required even when a renderer/model asks for setup.
            # Managed VNC enables human input only while holding the global lease.
            with consent_control(canceled) if managed else nullcontext():
                prompt = subprocess.Popen(["/usr/bin/zenity", "--question", "--title=Lime Computer Use",
                                       "--no-markup", "--text=" + f"Allow Lime to observe and control this window for this session?\n{target['identity']['appId']}\n{target['identity']['title']}",
                                       "--ok-label=Allow", "--cancel-label=Deny", "--timeout=90"],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    while prompt.poll() is None:
                        if canceled() or (managed and (lock_root() / "human-control").exists()):
                            raise Denied("Approval canceled", "canceled")
                        time.sleep(0.05)
                    accepted = prompt.returncode == 0 and not canceled()
                finally:
                    if prompt.poll() is None:
                        prompt.terminate()
                        try:
                            prompt.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            prompt.kill()
                            prompt.wait()
            snapshot = self.snapshot()
            current, _ = self.select_target(selected)
            accepted = accepted and current["revision"] == stamp and not canceled()
            if accepted:
                self.approved[selected["windowId"]] = stamp
        return {"outcome": {"accepted": accepted, "approvedTarget": selected if accepted else None,
                            "generation": self.generation}, "snapshot": snapshot}

    def execute(self, params, canceled):
        generation = integer(params.get("generation"), 1, 2**64 - 1)
        fence = integer(params.get("fence"), 1, 2**64 - 1)
        self.snapshot()
        target, window = self.select_target(params.get("target"))
        stamp, key = target["revision"], target["identity"]["windowId"]
        if generation != self.generation or self.approved.get(key) != stamp:
            raise Denied("Snapshot or application approval expired")
        owner = params.get("owner", {})
        if set(owner) != {"connection", "thread_id", "turn_id"} or any(not isinstance(value, str) or not value or len(value) > 512 for value in owner.values()):
            raise Denied("Trusted turn owner required")
        turn = tuple(owner[name] for name in ("connection", "thread_id", "turn_id"))
        self.turn_epochs.setdefault(turn, self.monitor.epoch)

        def check(foreground=True):
            if canceled():
                raise Denied("Computer Use canceled; outcome may be unknown", "canceled")
            reason = self.block_reason()
            if reason is not None:
                self.update_targets(reason, {})
                code = "user_intervened" if reason in ("linux_human_control_active", "linux_desktop_consent_pending") else "desktop_locked"
                raise Denied("Desktop is unavailable for Computer Use", code)
            if self.monitor.epoch != self.turn_epochs[turn]:
                raise Denied("Manual input interrupted this turn", "user_intervened")
            check_fence(fence)
            observed, _ = self.target(window)
            if observed["revision"] != stamp:
                raise Denied("Target process or geometry changed")
            active = self.property(self.display.screen().root, "_NET_ACTIVE_WINDOW")
            if foreground and not active_window_matches(active, window.id):
                raise Denied("Approved window must be foreground; focus changed")

        check(False)
        operation = params.get("operation", {})
        action = operation.get("action")
        if action == "observe":
            return {"window": target, "accessibilityAvailable": False, "reason": "Use window screenshots; AT-SPI semantics are not advertised by this adapter"}
        if action == "screenshot":
            check()
            geometry = window.get_geometry()
            if geometry.width * geometry.height > MAX_PIXELS or self.display.screen().root_depth != 24 or self.display.display.info.image_byte_order != self.X.LSBFirst:
                raise Denied("Screenshot format or bounds unsupported")
            image = window.get_image(0, 0, geometry.width, geometry.height, self.X.ZPixmap, 0xFFFFFFFF)
            if len(image.data) != geometry.width * geometry.height * 4:
                raise Denied("Screenshot pixel format unsupported")
            pixels = self.Image.frombytes("RGB", (geometry.width, geometry.height), image.data, "raw", "BGRX")
            output = io.BytesIO()
            pixels.save(output, format="PNG")
            check()
            return {"format": "png", "source": "window", "width": geometry.width, "height": geometry.height,
                    "data": base64.b64encode(output.getvalue()).decode("ascii")}
        self.input(window, operation, check)
        return {"outcome": "submitted", "windowId": key, "fence": fence}

    def input(self, window, operation, check):
        X, XK = self.X, self.XK
        held = []

        def event(kind, detail=0, **kwargs):
            check()
            self.xtest.fake_input(self.display, kind, detail=detail, **kwargs)
            self.display.sync()

        def press(kind, detail):
            held.append((kind, detail))
            event(kind, detail)

        def release(kind, detail):
            event(kind + 1, detail)
            held.remove((kind, detail))

        def move(x, y):
            geometry = window.get_geometry()
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in (x, y)) or not 0 <= x < geometry.width or not 0 <= y < geometry.height:
                raise Denied("Coordinates must be within the approved window", "invalid_argument")
            origin = self.display.screen().root.translate_coords(window, 0, 0)
            event(X.MotionNotify, x=origin.x + round(x), y=origin.y + round(y))

        def keycode(name):
            aliases = {"ENTER": "Return", "RETURN": "Return", "TAB": "Tab", "ESC": "Escape", "ESCAPE": "Escape", "BACKSPACE": "BackSpace", "DELETE": "Delete", "SPACE": "space", "UP": "Up", "DOWN": "Down", "LEFT": "Left", "RIGHT": "Right", "HOME": "Home", "END": "End", "PAGEUP": "Prior", "PAGEDOWN": "Next"}
            code = self.display.keysym_to_keycode(XK.string_to_keysym(aliases.get(name.upper(), name)))
            if not code:
                raise Denied("Key is unavailable in the current keyboard layout", "invalid_argument")
            return code

        try:
            check()
            if any(self.display.query_keymap()):
                raise Denied("A physical key is already held")
            action = operation.get("action")
            if action == "click":
                count = integer(operation.get("count"), 1, 3)
                button = {"left": 1, "middle": 2, "right": 3}.get(operation.get("button"))
                if not button:
                    raise Denied("Invalid mouse button", "invalid_argument")
                move(operation.get("x"), operation.get("y"))
                for _ in range(count):
                    press(X.ButtonPress, button)
                    release(X.ButtonPress, button)
            elif action == "key":
                modifiers = operation.get("modifiers", [])
                mapping = {"ctrl": "Control_L", "control": "Control_L", "shift": "Shift_L", "alt": "Alt_L", "super": "Super_L", "meta": "Super_L"}
                if not isinstance(modifiers, list) or len(modifiers) > 4 or any(value.lower() not in mapping for value in modifiers):
                    raise Denied("Invalid key modifiers", "invalid_argument")
                codes = [keycode(mapping[value.lower()]) for value in modifiers] + [keycode(operation.get("key", ""))]
                for code in codes:
                    press(X.KeyPress, code)
                for code in reversed(codes):
                    release(X.KeyPress, code)
            elif action == "type":
                text = operation.get("text")
                if not isinstance(text, str) or not text or len(text.encode()) > 16384 or "\0" in text:
                    raise Denied("Text exceeds allowed bounds", "invalid_argument")
                if self.display.screen().root.query_pointer().mask & X.LockMask:
                    raise Denied("Turn off Caps Lock before typing; exact text case is required")
                # Reserve an unmapped key for Unicode input, restore in every path.
                info = self.display.display.info
                mapping = self.display.get_keyboard_mapping(info.min_keycode, info.max_keycode - info.min_keycode + 1)
                spare = next((info.min_keycode + index for index, values in enumerate(mapping) if not any(values)), None)
                if spare is None:
                    raise Denied("No spare X11 keycode for Unicode input")
                original = mapping[spare - info.min_keycode]
                try:
                    for character in text:
                        check()
                        symbol = {"\n": 0xFF0D, "\t": 0xFF09}.get(character, ord(character) if ord(character) < 256 else 0x01000000 | ord(character))
                        self.display.change_keyboard_mapping(spare, [(symbol,) * len(original)])
                        self.display.sync()
                        press(X.KeyPress, spare)
                        release(X.KeyPress, spare)
                finally:
                    self.display.change_keyboard_mapping(spare, [original])
                    self.display.sync()
            elif action == "scroll":
                dx = integer(operation.get("delta_x"), -10000, 10000)
                dy = integer(operation.get("delta_y"), -10000, 10000)
                move(operation.get("x"), operation.get("y"))
                for amount, positive, negative in [(dy, 5, 4), (dx, 7, 6)]:
                    for _ in range(min(100, (abs(amount) + 119) // 120)):
                        button = positive if amount > 0 else negative
                        press(X.ButtonPress, button)
                        release(X.ButtonPress, button)
            elif action == "drag":
                duration = integer(operation.get("duration_ms"), 1, 5000) / 1000
                x, y, tx, ty = (operation.get(name) for name in ("x", "y", "to_x", "to_y"))
                move(tx, ty)  # Validate destination before pressing anything.
                move(x, y)
                press(X.ButtonPress, 1)
                steps = max(1, round(duration * 60))
                for index in range(1, steps + 1):
                    move(x + (tx - x) * index / steps, y + (ty - y) * index / steps)
                    time.sleep(duration / steps)
                release(X.ButtonPress, 1)
            else:
                raise Denied("Unsupported Linux native operation", "invalid_argument")
        finally:
            # Cleanup bypasses focus/cancel checks; never leave a key/button held.
            for kind, detail in reversed(held):
                self.xtest.fake_input(self.display, kind + 1, detail=detail)
            self.display.sync()


def serve(input_stream, driver):
    pending = queue.Queue(maxsize=64)
    state = {"epoch": 0, "closed": False}

    def read():
        while True:
            frame = input_stream.readline(MAX_FRAME + 1)
            if not frame:
                state["closed"] = True
                state["epoch"] += 1
                pending.put(None)
                return
            try:
                if len(frame) > MAX_FRAME or not frame.endswith(b"\n"):
                    if not frame.endswith(b"\n"):
                        while frame and not frame.endswith(b"\n"):
                            frame = input_stream.readline(MAX_FRAME + 1)
                    raise Denied("Invalid or oversized JSONL frame", "invalid_request")
                request = json.loads(frame)
                if not isinstance(request, dict) or set(request) - {"id", "method", "params"} or not isinstance(request.get("params", {}), dict):
                    raise Denied("Invalid request envelope", "invalid_request")
                if any(not isinstance(request.get(name), str) or not 0 < len(request[name]) <= limit for name, limit in [("id", 512), ("method", 128)]):
                    raise Denied("Invalid request identity", "invalid_request")
                if request["method"] == "computerUse.cancel":
                    state["epoch"] += 1
                else:
                    pending.put_nowait((state["epoch"], request))
            except queue.Full:
                reply(request["id"], error=Denied("Native request queue is full", "busy"))
            except Exception as error:
                state["epoch"] += 1
                reply("", error=error if isinstance(error, Denied) else Denied("Invalid JSONL request", "invalid_request"))

    threading.Thread(target=read, daemon=True).start()
    while True:
        item = pending.get()
        if item is None:
            return
        epoch, request = item
        canceled = lambda: state["closed"] or state["epoch"] != epoch
        try:
            method, params = request["method"], request.get("params", {})
            if method == "computerUse.snapshot":
                result = driver.snapshot()
            elif canceled():
                raise Denied("Request canceled before execution", "canceled")
            elif method == "computerUse.setup":
                result = driver.setup(params, canceled)
            elif method == "computerUse.execute":
                result = driver.execute(params, canceled)
            elif method == "computerUse.finishTurn":
                owner = params.get("owner", {})
                turn = tuple(owner.get(name) for name in ("connection", "thread_id", "turn_id"))
                driver.turn_epochs.pop(turn, None)
                result = {}
            else:
                raise Denied("Unsupported native helper method", "invalid_argument")
            reply(request["id"], result)
        except Exception as error:
            reply(request["id"], error=error)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--control-human"]:
            human_control()
        elif sys.argv[1:] == ["--control-ai"]:
            human_control(resume_ai=True)
        elif sys.argv[1:]:
            raise Denied("Unknown Linux native helper argument", "invalid_argument")
        else:
            serve(sys.stdin.buffer, Driver())
    except KeyboardInterrupt:
        pass
