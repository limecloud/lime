import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launch.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def configuration():
    return {"operationId": str(uuid.uuid4()), "capabilitySha256": "c" * 64,
            "archiveSha256": "a" * 64, "manifestSha256": "b" * 64,
            "archiveBytes": 1024,
            "expiresAt": int(time.time()) + 120}


class FixedLauncherTests(unittest.TestCase):
    def test_reconnect_requires_an_existing_user_and_has_no_artifact(self):
        config = configuration()
        for key in ("archiveSha256", "manifestSha256", "archiveBytes"):
            del config[key]
        config["reconnect"] = True
        launcher.validate_config(config)
        with self.assertRaises(RuntimeError):
            launcher.validate_config({**config, "archiveBytes": 1})
        with patch.object(launcher.pwd, "getpwnam", side_effect=KeyError()), patch.object(launcher, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "userConflict"):
                launcher.desktop_user(create=False)
            run.assert_not_called()

    def test_network_identity_consent_descriptor_and_deadline_are_fixed(self):
        original = configuration()
        launcher.validate_config(original)
        for field, value in (("operationId", "../escape"), ("capabilitySha256", "raw-secret"),
                             ("bindAddress", "0.0.0.0"), ("bindAddress", "8.8.8.8"),
                             ("publicAddress", "127.0.0.1"), ("publicAddress", "169.254.1.1"),
                             ("archiveBytes", True), ("expiresAt", int(time.time()) + 1900)):
            with self.subTest(field=field, value=value):
                with self.assertRaises((RuntimeError, ValueError)):
                    launcher.validate_config({**original, field: value})
        with self.assertRaises(RuntimeError):
            launcher.validate_config({**original, "token": "secret"})

    def test_root_and_supported_system_checks_precede_every_write_or_subprocess(self):
        with patch.object(launcher.os, "geteuid", return_value=1000), patch.object(launcher, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "requiresRoot"):
                launcher.prepare({})
            run.assert_not_called()
        with patch.object(launcher.os, "geteuid", return_value=0), patch.object(launcher, "supported_system", return_value=False), patch.object(launcher, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "unsupportedSystem"):
                launcher.prepare({})
            run.assert_not_called()

    def test_public_response_only_relays_matching_operation_and_certificate(self):
        config = configuration()
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "listener.json"
            value = {"operationId": config["operationId"], "phase": "listening", "expiresAt": config["expiresAt"],
                     "certificate": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"}
            launcher.create_file(file, json.dumps(value).encode(), os.getuid(), os.getgid())
            result = launcher.ready_output(file, os.getuid(), config)
            self.assertEqual(set(result), {"operationId", "phase", "expiresAt", "certificate"})
            self.assertEqual(result["phase"], "uploadReady")
            for change in ({"operationId": str(uuid.uuid4())}, {"token": "secret"}, {"certificate": "secret"}):
                file.write_text(json.dumps({**value, **change}))
                with self.assertRaises(RuntimeError):
                    launcher.ready_output(file, os.getuid(), config)

if __name__ == "__main__":
    unittest.main()
