from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from test_linux_guest import guest, payload


class ReconnectTests(unittest.TestCase):
    def fixture(self, directory):
        home = Path(directory).resolve()
        root = guest.private_directory(home / "state")
        releases = guest.private_directory(root / "releases")
        release = guest.private_directory(releases / "test")
        payload(release)
        (root / "current").symlink_to(release)
        units = home / ".config/systemd/user"
        units.mkdir(parents=True)
        config = guest.private_directory(home / "config")
        with patch.object(guest, "config_root", return_value=config):
            for name, content in guest.units_for(release).items():
                guest.private_write(units / (name + ".service"), content.encode())
        guest.private_write(config / "token", b"old_" + b"t" * 40)
        guest.private_write(config / "viewer-password", b"oldVnc88")
        guest.private_write(config / "vnc-password", b"encoded:oldVnc88")
        return home, root, release, units, config

    def run_reconnect(self, f, **options):
        home, root, _, _, config = f
        def encode(args, **kwargs):
            self.assertEqual(args, ["tigervncpasswd", "-f"])
            return SimpleNamespace(stdout=b"encoded:" + kwargs["input"].strip())
        with patch.object(guest.Path, "home", return_value=home), patch.object(guest, "state_root", return_value=root), patch.object(guest, "config_root", return_value=config), patch.object(guest.subprocess, "run", side_effect=encode), patch.object(guest, "systemctl", **options) as control:
            guest.reconnect_credentials()
        return control

    def test_rotates_both_credentials_and_stops_old_sessions_without_reinstall(self):
        with tempfile.TemporaryDirectory() as directory:
            f = self.fixture(directory)
            before = {str(p.relative_to(f[2])): p.read_bytes() for p in f[2].rglob("*") if p.is_file()}
            control = self.run_reconnect(f)
            self.assertEqual(control.call_args_list[0].args[0], "stop")
            self.assertIn("lime-cloud-human.service", control.call_args_list[0].args)
            self.assertEqual(control.call_args_list[1].args[0], "start")
            self.assertNotIn("lime-cloud-human.service", control.call_args_list[1].args)
            self.assertNotEqual(guest.private_read(f[4] / "token"), b"old_" + b"t" * 40)
            viewer = guest.private_read(f[4] / "viewer-password").strip()
            self.assertNotEqual(viewer, b"oldVnc88")
            self.assertEqual(guest.private_read(f[4] / "vnc-password"), b"encoded:" + viewer)
            self.assertEqual(before, {str(p.relative_to(f[2])): p.read_bytes() for p in f[2].rglob("*") if p.is_file()})

    def test_unmanaged_units_corrupt_files_and_missing_credentials_fail_before_stop(self):
        for kind in ("unit", "payload", "token", "viewer", "current"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                f = self.fixture(directory)
                if kind == "unit":
                    (f[3] / "lime-cloud.service").write_text("unmanaged unit")
                elif kind == "payload":
                    (f[2] / "bin/app-server").write_bytes(b"changed")
                elif kind == "current":
                    (f[1] / "current").unlink()
                else:
                    (f[4] / ("token" if kind == "token" else "viewer-password")).unlink()
                with patch.object(guest, "systemctl") as control:
                    with self.assertRaises((RuntimeError, OSError)):
                        self.run_reconnect(f, side_effect=AssertionError("must not stop"))
                    control.assert_not_called()

    def test_stop_failure_preserves_original_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            f = self.fixture(directory)
            before = {p.name:p.read_bytes() for p in f[4].iterdir()}
            with self.assertRaises(RuntimeError):
                self.run_reconnect(f, side_effect=RuntimeError("stop refused"))
            self.assertEqual(before, {p.name:p.read_bytes() for p in f[4].iterdir()})


if __name__ == "__main__":
    unittest.main()
