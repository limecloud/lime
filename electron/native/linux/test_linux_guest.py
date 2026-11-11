import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("linux_guest", Path(__file__).with_name("linux-guest.py"))
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)


def payload(root):
    for name in ("bin/lime", "bin/app-server", "bin/code-mode-host", "bin/native/linux/linux-native-host",
                 "install.py", "LICENSE", "LICENSES.md", "NOTICE"):
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b"explicit unit test fixture: " + name.encode())
    native = {"schemaVersion": 1, "applicationId": "com.limecloud.lime", "version": "1.173.0",
              "platform": "linux", "arch": "x64", "resources": [
                  {"id": identifier, "path": name, "sha256": guest.digest(root / "bin" / name)}
                  for identifier, name in [("app-server", "app-server"), ("linux-native-host", "native/linux/linux-native-host")]]}
    (root / "bin/desktop-resources.manifest.json").write_text(json.dumps(native))
    files = [{"path": str(file.relative_to(root)), "size": file.stat().st_size, "sha256": guest.digest(file)}
             for file in sorted(root.rglob("*")) if file.is_file()]
    manifest = {**native, "files": files}
    (root / "guest-manifest.json").write_text(json.dumps(manifest))
    return guest.digest(root / "guest-manifest.json")


class GuestInstallationSecurityTests(unittest.TestCase):
    def test_validated_closure_rejects_changed_app_server(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trusted = payload(root)
            self.assertEqual(guest.verify_payload(root, trusted)["version"], "1.173.0")
            (root / "bin/app-server").write_bytes(b"replaced runtime")
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                guest.verify_payload(root, trusted)

    def test_manifest_replacement_requires_the_trusted_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trusted = payload(root)
            manifest = root / "guest-manifest.json"
            manifest.write_text(manifest.read_text() + " ")
            with self.assertRaisesRegex(RuntimeError, "manifest integrity"):
                guest.verify_payload(root, trusted)

    def test_traversal_duplicate_paths_and_symlink_are_rejected(self):
        for change in ("../escape", "/etc/passwd", "bin/../app-server", "bin\\app-server", "duplicate", "symlink"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                payload(root)
                file = root / "guest-manifest.json"
                manifest = json.loads(file.read_text())
                if change == "symlink":
                    (root / "bin/lime").unlink()
                    (root / "bin/lime").symlink_to(root / "bin/app-server")
                elif change == "duplicate":
                    manifest["files"].append(manifest["files"][0])
                else:
                    manifest["files"][0]["path"] = change
                file.write_text(json.dumps(manifest))
                with self.assertRaises(RuntimeError):
                    guest.verify_payload(root, guest.digest(file))

    def test_native_manifest_cannot_authorize_a_different_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload(root)
            file = root / "bin/desktop-resources.manifest.json"
            native = json.loads(file.read_text())
            native["resources"][1]["sha256"] = "0" * 64
            file.write_text(json.dumps(native))
            manifest = root / "guest-manifest.json"
            value = json.loads(manifest.read_text())
            for entry in value["files"]:
                if entry["path"] == "bin/desktop-resources.manifest.json":
                    entry.update(size=file.stat().st_size, sha256=guest.digest(file))
            manifest.write_text(json.dumps(value))
            with self.assertRaisesRegex(RuntimeError, "Native resource closure"):
                guest.verify_payload(root, guest.digest(manifest))

    def test_reinstallation_preserves_credentials_and_resumes_partial_creation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(guest.subprocess, "run", return_value=SimpleNamespace(stdout=b"12345678")):
            root = Path(directory)
            guest.ensure_credentials(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            guest.ensure_credentials(root)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
            (root / "vnc-password").unlink()
            guest.ensure_credentials(root)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})

    def test_public_or_linked_credentials_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / "token"
            guest.private_write(file, b"private-token" * 4)
            file.chmod(0o644)
            with self.assertRaises(RuntimeError):
                guest.private_read(file)
            file.chmod(0o600)
            (root / "link").symlink_to(file)
            with self.assertRaises(OSError):
                guest.private_read(root / "link")
            os.link(file, root / "hardlink")
            with self.assertRaises(RuntimeError):
                guest.private_read(file)


if __name__ == "__main__":
    unittest.main()
