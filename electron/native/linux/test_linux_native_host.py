import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import fcntl

spec = importlib.util.spec_from_file_location("linux_native_host", Path(__file__).with_name("linux-native-host.py"))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class NativeSecurityTests(unittest.TestCase):
    def test_typing_rejects_caps_lock_before_injecting_any_text(self):
        driver = host.Driver.__new__(host.Driver)
        driver.X, driver.XK = SimpleNamespace(LockMask=2), object()
        display = SimpleNamespace(query_keymap=lambda: bytes(32), sync=lambda: None,
                                  screen=lambda: SimpleNamespace(root=SimpleNamespace(query_pointer=lambda: SimpleNamespace(mask=2))))
        driver.display = display
        with self.assertRaisesRegex(host.Denied, "Caps Lock"):
            driver.input(None, {"action": "type", "text": "Exact Case"}, lambda *args: None)

    def test_xfwm_active_window_padding_cannot_accept_a_different_window(self):
        for values in ([42], [42, 0]):
            self.assertTrue(host.active_window_matches(SimpleNamespace(value=values), 42))
        for values in ([], [43], [0, 42], [42, 43]):
            self.assertFalse(host.active_window_matches(SimpleNamespace(value=values), 42))
        self.assertFalse(host.active_window_matches(None, 42))

    def test_vnc_zero_exit_with_rejected_setting_fails_closed_and_checks_both_inputs(self):
        with patch.object(host.subprocess, "run") as run:
            run.return_value.stdout = b"0\n"
            with self.assertRaisesRegex(host.Denied, "could not be verified"):
                host.vnc_input(True)
            queried = [call.args[0][-1] for call in run.call_args_list if "-get" in call.args[0]]
            self.assertEqual(queried, ["AcceptKeyEvents", "AcceptPointerEvents"])
            host.vnc_input(False)
        with patch.object(host.subprocess, "run", side_effect=OSError("unavailable")) as run:
            with self.assertRaises(OSError):
                host.vnc_input(False)
            self.assertEqual(run.call_count, 2)

    def test_target_revisions_match_public_numeric_contract_and_never_reuse_retired_identity(self):
        driver = host.Driver.__new__(host.Driver)
        driver.revision_clock, driver.revisions = 0, {}
        first = driver.target_revision("window", "original")
        self.assertTrue(first.isdecimal())
        self.assertGreater(int(first), 0)
        self.assertEqual(driver.target_revision("window", "original"), first)
        changed = driver.target_revision("window", "changed")
        self.assertGreater(int(changed), int(first))
        driver.display, driver.monitor = None, None
        driver.display_failure = "linux_x11_session_unavailable"
        driver.generation, driver.fingerprint = 0, None
        driver.targets, driver.approved = {}, {}
        driver.snapshot()
        self.assertGreater(int(driver.target_revision("window", "original")), int(changed))
        driver.revision_clock = 2**64 - 1
        with self.assertRaisesRegex(host.Denied, "exhausted"):
            driver.target_revision("other", "new")

    def test_managed_vnc_consent_fences_all_helpers_and_disables_input_on_cancel(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)), patch.object(host, "vnc_input") as vnc:
            root = Path(directory)
            with self.assertRaisesRegex(RuntimeError, "cancel test"):
                with host.consent_control(lambda: False):
                    self.assertTrue((root / "consent-control").is_file())
                    with self.assertRaises(host.Denied):
                        host.check_fence(1)
                    raise RuntimeError("cancel test")
            self.assertEqual([call.args[0] for call in vnc.call_args_list], [True, False])
            self.assertFalse((root / "consent-control").exists())
            self.assertEqual((root / "desktop.lock").read_bytes(), (1).to_bytes(8, "big"))

    def test_consent_never_overrides_human_takeover_or_uncertain_vnc_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)), patch.object(host, "vnc_input") as vnc:
            root = Path(directory)
            (root / "human-control").touch(mode=0o600)
            with self.assertRaises(host.Denied):
                with host.consent_control(lambda: False):
                    self.fail("Cannot override human takeover")
            vnc.assert_not_called()
            (root / "human-control").unlink()
            vnc.side_effect = [None, OSError("cannot disable viewer")]
            with self.assertRaises(OSError):
                with host.consent_control(lambda: False):
                    pass
            self.assertTrue((root / "consent-control").exists())

    def test_human_takeover_at_consent_lock_acquisition_does_not_open_approval(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)), patch.object(host, "vnc_input") as vnc:
            root = Path(directory)
            original = host.fcntl.flock
            def take_over(fd, operation):
                original(fd, operation)
                if operation == fcntl.LOCK_EX | fcntl.LOCK_NB:
                    (root / "human-control").touch(mode=0o600)
            with patch.object(host.fcntl, "flock", side_effect=take_over):
                with self.assertRaisesRegex(host.Denied, "human control"):
                    with host.consent_control(lambda: False):
                        self.fail("Approval opened after human control was requested")
            self.assertNotIn(True, [call.args[0] for call in vnc.call_args_list])
            self.assertTrue((root / "human-control").exists())
            self.assertFalse((root / "consent-control").exists())

    def test_takeover_after_prompt_opens_cancels_and_reaps_it_before_unlocking(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)), patch.object(host, "vnc_input") as vnc, patch.object(host.os, "environ", {"LIME_MANAGED_VNC_SESSION": "1"}):
            root = Path(directory)
            driver = host.Driver.__new__(host.Driver)
            driver.approved, driver.generation = {}, 1
            selected = {"windowId": "42"}
            target = {"revision": "1", "identity": {"appId": "synthetic-app", "title": "Synthetic"}}
            lifecycle = []
            polls = 0
            def poll():
                nonlocal polls
                polls += 1
                (root / "human-control").touch(mode=0o600, exist_ok=True)
                return None if polls <= 2 else 0
            def reaped():
                descriptor = host.private_file(root / "desktop.lock")
                try:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    os.close(descriptor)
                lifecycle.append("reaped while locked")
            prompt = SimpleNamespace(returncode=0, poll=poll, terminate=lambda: lifecycle.append("terminated"), wait=lambda **kwargs: reaped())
            with patch.object(driver, "snapshot", return_value={}), patch.object(driver, "select_target", return_value=(target, object())), patch.object(host.subprocess, "Popen", return_value=prompt):
                with self.assertRaisesRegex(host.Denied, "Approval canceled"):
                    driver.setup({"adapter": "native", "grantScope": "session", "target": selected}, lambda: False)
            self.assertEqual(driver.approved, {})
            self.assertEqual(lifecycle, ["terminated", "reaped while locked"])
            self.assertEqual([call.args[0] for call in vnc.call_args_list], [True, False])
            self.assertTrue((root / "human-control").exists())
            self.assertFalse((root / "consent-control").exists())

    def test_only_active_desktop_lock_service_can_report_unlocked(self):
        driver = host.Driver.__new__(host.Driver)
        driver.display, driver.monitor = object(), SimpleNamespace(available=True)
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)):
            for desktop, bus in [("ubuntu:GNOME", "org.gnome.ScreenSaver"), ("XFCE", "org.xfce.ScreenSaver")]:
                with patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": desktop}), patch.object(host.subprocess, "run") as run:
                    run.return_value.stdout = b"(false,)\n"
                    self.assertIsNone(driver.block_reason())
                    self.assertIn(bus, run.call_args.args[0])
                    run.return_value.stdout = b"(true,)\n"
                    self.assertEqual(driver.block_reason(), "linux_desktop_locked")
                    run.return_value.stdout = b"(unexpected,)\n"
                    self.assertEqual(driver.block_reason(), "linux_desktop_lock_state_unavailable")
                    run.side_effect = OSError("lock service unavailable")
                    self.assertEqual(driver.block_reason(), "linux_desktop_lock_state_unavailable")
                    self.assertEqual(run.call_count, 4)
            with patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "unknown"}):
                self.assertEqual(driver.block_reason(), "linux_desktop_lock_state_unavailable")
            driver.monitor.available = False
            self.assertEqual(driver.block_reason(), "linux_x11_input_monitor_unavailable")
            (Path(directory) / "human-control").touch(mode=0o600)
            self.assertEqual(driver.block_reason(), "linux_human_control_active")

    def test_lock_detected_during_execution_retires_approval_before_unlock(self):
        driver = host.Driver.__new__(host.Driver)
        driver.monitor = SimpleNamespace(epoch=0)
        driver.generation, driver.fingerprint = 1, "ready"
        driver.turn_epochs, driver.revisions = {}, {"target": ("verified", "1")}
        identity = {"type": "native", "appId": "/usr/bin/terminal", "processId": 10, "windowId": "target"}
        driver.targets = {"target": ({"revision": "1", "identity": identity}, object())}
        driver.approved = {"target": "1"}
        request = {"generation": 1, "fence": 1, "target": identity,
                   "owner": {"connection": "client", "thread_id": "thread", "turn_id": "turn"},
                   "operation": {"action": "observe"}}
        with patch.object(driver, "snapshot"), patch.object(driver, "block_reason", return_value="linux_desktop_locked"):
            with self.assertRaises(host.Denied) as failure:
                driver.execute(request, lambda: False)
        self.assertEqual(failure.exception.code, "desktop_locked")
        self.assertEqual(driver.approved, {})
        self.assertEqual(driver.revisions, {})
        self.assertEqual(driver.generation, 2)
        driver.update_targets(None, {"target": ({"revision": "2", "identity": identity}, object())})
        with patch.object(driver, "snapshot"), self.assertRaisesRegex(host.Denied, "approval expired"):
            driver.execute(request, lambda: False)

    def test_fence_requires_live_lease_and_matching_private_inode(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(host, "lock_root", lambda: Path(directory)):
            path = Path(directory) / "desktop.lock"
            fd = host.private_file(path, create=True)
            os.write(fd, (7).to_bytes(8, "big"))
            try:
                with self.assertRaises(host.Denied):
                    host.check_fence(7)
                fcntl.flock(fd, fcntl.LOCK_EX)
                host.check_fence(7)
                with self.assertRaises(host.Denied):
                    host.check_fence(6)
                (Path(directory) / "human-control").touch(mode=0o600)
                with self.assertRaisesRegex(host.Denied, "Human control"):
                    host.check_fence(7)
            finally:
                os.close(fd)

    def test_public_symlink_and_hardlink_lock_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.write_bytes(b"secret")
            target.chmod(0o644)
            with self.assertRaises(host.Denied):
                host.private_file(target)
            target.chmod(0o600)
            (root / "symlink").symlink_to(target)
            with self.assertRaises(OSError):
                host.private_file(root / "symlink")
            os.link(target, root / "hardlink")
            with self.assertRaises(host.Denied):
                host.private_file(target)

    def test_no_linux_session_is_blocked_and_cannot_forge_consent(self):
        driver = host.Driver.__new__(host.Driver)
        driver.display, driver.monitor = None, None
        driver.display_failure = "linux_x11_session_unavailable"
        driver.generation, driver.fingerprint = 0, None
        driver.targets, driver.approved = {}, {}
        driver.revisions = {}
        snapshot = driver.snapshot()
        self.assertEqual(snapshot["readiness"], "blocked")
        self.assertEqual(snapshot["reason"], "linux_x11_session_unavailable")
        self.assertEqual(snapshot["targets"], [])
        with self.assertRaises(host.Denied):
            driver.setup({"adapter": "native", "grantScope": "persistent", "target": None}, lambda: False)

    def test_framing_recovers_after_oversize_without_executing_input(self):
        class Driver:
            def snapshot(self):
                return {"readiness": "blocked"}
        payload = b"x" * (host.MAX_FRAME + 20) + b"\n" + b'{"id":"read","method":"computerUse.snapshot"}\n'
        output = io.StringIO()
        with patch("sys.stdout", output):
            host.serve(io.BytesIO(payload), Driver())
        responses = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(responses[0]["error"]["code"], "invalid_request")
        self.assertEqual(responses[-1]["result"]["readiness"], "blocked")

    def test_invalid_bounds_reject_bool_and_exhausted_fence(self):
        for value in (True, -1, 0, 2**64, 1.1):
            with self.assertRaises(host.Denied):
                host.integer(value, 1, 2**64 - 1)


if __name__ == "__main__":
    unittest.main()
