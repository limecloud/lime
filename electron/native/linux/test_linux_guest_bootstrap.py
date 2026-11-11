import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from test_linux_guest import payload
from test_linux_guest_archive import runtime_archive

spec = importlib.util.spec_from_file_location("guest_bootstrap", Path(__file__).with_name("linux-guest-bootstrap.py"))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def configuration(root, archive=None, lifetime=120):
    capability = "c" * 64  # Explicit synthetic capability; never a user credential.
    config = {
        "operationId": str(uuid.uuid4()),
        "capabilitySha256": hashlib.sha256(capability.encode()).hexdigest(),
        "archiveSha256": bootstrap.guest.digest(archive) if archive else "a" * 64,
        "manifestSha256": "b" * 64,
        "archiveBytes": archive.stat().st_size if archive else 1,
        "bindAddress": "127.0.0.1", "publicAddress": "127.0.0.1",
        "expiresAt": int(time.time()) + lifetime,
    }
    bootstrap.guest.private_write(root / "config.json", json.dumps(config).encode())
    return config, capability


class BootstrapConfigurationTests(unittest.TestCase):
    def test_config_has_fixed_identity_size_lifetime_and_literal_ip(self):
        invalid = {"archiveBytes": [True, 0, bootstrap.guest.MAX_ARCHIVE_BYTES + 1],
                   "expiresAt": [int(time.time()) - 1, int(time.time()) + 1802],
                   "bindAddress": ["0.0.0.0", "host.invalid", "224.0.0.1"],
                   "publicAddress": ["127.0.0.1:8787", "https://host.invalid"],
                   "capabilitySha256": ["secret", "F" * 64], "operationId": ["../escape"]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, _ = configuration(root)
            self.assertEqual(bootstrap.load_config(root / "config.json"), config)
            for field, values in invalid.items():
                for value in values:
                    with self.subTest(field=field, value=value):
                        changed = {**config, field: value}
                        (root / "config.json").write_text(json.dumps(changed))
                        with self.assertRaises(RuntimeError):
                            bootstrap.load_config(root / "config.json")

    def test_interrupted_upload_is_not_replayed_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, _ = configuration(root)
            operation = bootstrap.Installation(root, config)
            self.assertTrue(operation.begin())
            resumed = bootstrap.Installation(root, config)
            self.assertEqual(resumed.status()["phase"], "failed")
            self.assertFalse(resumed.begin())
            with self.assertRaises(RuntimeError):
                bootstrap.Installation(root, {**config, "archiveSha256": "0" * 64})

    def test_lease_rejects_concurrent_process_and_releases_on_close(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = ("import importlib.util,pathlib; "
                    "s=importlib.util.spec_from_file_location('bootstrap'," + repr(str(Path(bootstrap.__file__).resolve())) + "); "
                    "b=importlib.util.module_from_spec(s); s.loader.exec_module(b); "
                    "b.operation_lock(pathlib.Path(" + repr(directory) + ")).__enter__()")
            with bootstrap.operation_lock(root):
                result = subprocess.run([sys.executable, "-c", code], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            with bootstrap.operation_lock(root):
                pass

    def test_close_kills_an_active_installer_and_preserves_an_interrupted_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, _ = configuration(root)
            operation = bootstrap.Installation(root, config)
            process = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"], start_new_session=True)
            try:
                operation.process = process
                operation.phase = "installing"
                operation.save()
                operation.close()
                self.assertLess(process.returncode, 0)
                self.assertTrue(operation.stopped)
                self.assertEqual(operation.phase, "failed")
                self.assertEqual(bootstrap.Installation(root, config).phase, "failed")
            finally:
                bootstrap.Installation.stop_process(process)

    def test_restart_after_finish_only_cleans_operation_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, _ = configuration(root)
            operation = bootstrap.Installation(root, config)
            operation.phase = "installed"
            operation.save()
            self.assertTrue(operation.finish())
            for name in ("tls-key.pem", "tls-cert.pem", "runtime.tar.gz"):
                (root / name).write_bytes(b"synthetic interrupted cleanup")
            with self.assertRaisesRegex(RuntimeError, "already closed"):
                bootstrap.serve(root, config)
            self.assertEqual({p.name for p in root.iterdir()}, {"config.json", "state.json"})


class BootstrapTLSTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = self.root / "payload"
        source.mkdir()
        manifest = payload(source)
        self.archive = self.root / "package.tar.gz"
        runtime_archive(source, self.archive)
        self.operation_root = self.root / "operation"
        self.operation_root.mkdir(mode=0o700)
        self.config, self.capability = configuration(self.operation_root, self.archive)
        self.config["manifestSha256"] = manifest
        (self.operation_root / "config.json").write_text(json.dumps(self.config))
        self.operation = bootstrap.Installation(self.operation_root, self.config)
        public = bootstrap.certificate(self.operation_root, "127.0.0.1")
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.minimum_version = ssl.TLSVersion.TLSv1_2
        server_context.load_cert_chain(self.operation_root / "tls-cert.pem", self.operation_root / "tls-key.pem")
        self.client_context = ssl.create_default_context(cadata=public)
        self.server = bootstrap.UploadServer(("127.0.0.1", 0), self.operation, server_context)
        self.thread = threading.Thread(target=self.server.serve_until_expiry)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.operation.cleanup()

    def request(self, method, route, body=None, headers=None, context=None):
        connection = http.client.HTTPSConnection("127.0.0.1", self.server.server_address[1],
                                                 context=context or self.client_context, timeout=5)
        try:
            connection.request(method, route, body=body,
                               headers=headers if headers is not None else {"Authorization": "Bearer " + self.capability})
            response = connection.getresponse()
            return response.status, json.loads(response.read()), response.getheader("Cache-Control")
        finally:
            connection.close()

    def test_only_pinned_certificates_are_trusted_and_hostname_is_checked(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.request("GET", "/status", context=ssl.create_default_context())
        with socket.create_connection(self.server.server_address, timeout=5) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                self.client_context.wrap_socket(raw, server_hostname="other.invalid")
        status, value, cache = self.request("GET", "/status")
        self.assertEqual((status, value["phase"], cache), (200, "waiting", "no-store"))

    def test_authentication_origin_and_fixed_routes(self):
        for headers in ({}, {"Authorization": "Bearer " + "d" * 64}):
            self.assertEqual(self.request("GET", "/status", headers=headers)[0], 401)
        self.assertEqual(self.request("GET", "/status", headers={"Authorization": "Bearer " + self.capability, "Origin": "https://host.invalid"})[0], 403)
        self.assertEqual(self.request("GET", "/credentials")[0], 409)
        self.assertEqual(self.request("GET", "/status?token=secret")[0], 404)

    def test_invalid_length_does_not_consume_the_operation(self):
        self.assertEqual(self.request("PUT", "/runtime", body=b"x")[0], 400)
        self.assertEqual(self.operation.phase, "waiting")

    def test_failed_upload_does_not_accept_a_second_mutation(self):
        wrong = b"x" * self.config["archiveBytes"]
        self.assertEqual(self.request("PUT", "/runtime", body=wrong)[0], 422)
        self.assertEqual(self.request("PUT", "/runtime", body=wrong)[0], 409)
        status, value, _ = self.request("GET", "/status")
        self.assertEqual((status, value["phase"], value["diagnostic"]), (200, "failed", "INSTALLATION_FAILED"))
        self.assertNotIn(self.capability, (self.operation_root / "state.json").read_text())

    def test_closing_an_incomplete_upload_unblocks_handlers_and_never_installs(self):
        with socket.create_connection(self.server.server_address, timeout=5) as raw:
            with self.client_context.wrap_socket(raw, server_hostname="127.0.0.1") as connection:
                connection.sendall(("PUT /runtime HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer "
                                    + self.capability + "\r\nContent-Length: "
                                    + str(self.config["archiveBytes"]) + "\r\n\r\nx").encode())
                deadline = time.monotonic() + 2
                while self.operation.phase == "waiting" and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertEqual(self.operation.phase, "receiving")
                self.close_server()
                self.assertTrue(self.operation.stopped)
                self.assertEqual(self.operation.phase, "failed")
                self.assertIsNone(self.operation.credentials())

    def test_real_tls_upload_child_validation_secret_delivery_and_finish(self):
        # This explicit installer fixture validates the real archive and writes
        # synthetic credentials. It does not install Xfce or replace Linux E2E.
        installed = self.root / "fixture-credentials"
        installed.mkdir(mode=0o700)
        fixture = self.root / "fixture-installer.py"
        fixture.write_text(
            "import argparse,importlib.util,pathlib,tempfile\n"
            "s=importlib.util.spec_from_file_location('guest'," + repr(str(Path(bootstrap.guest.__file__).resolve())) + ")\n"
            "g=importlib.util.module_from_spec(s);s.loader.exec_module(g)\n"
            "p=argparse.ArgumentParser();p.add_argument('command');p.add_argument('--archive');p.add_argument('--archive-sha256');p.add_argument('--manifest-sha256');p.add_argument('--start',action='store_true');a=p.parse_args()\n"
            "assert a.command=='install-archive' and a.start\n"
            "with tempfile.TemporaryDirectory() as d:\n"
            " g.unpack_payload(a.archive,a.archive_sha256,pathlib.Path(d));g.verify_payload(pathlib.Path(d),a.manifest_sha256)\n"
            "root=pathlib.Path(" + repr(str(installed)) + ")\n"
            "g.private_write(root/'token',b'fixture_'+b't'*40);g.private_write(root/'viewer-password',b'fixture8')\n")
        with patch.object(bootstrap.guest, "__file__", str(fixture)), patch.object(bootstrap.guest, "config_root", return_value=installed):
            self.assertEqual(self.request("PUT", "/runtime", self.archive.read_bytes())[0], 200)
            self.assertEqual(self.request("PUT", "/runtime", self.archive.read_bytes())[0], 409)
            status, credentials, cache = self.request("GET", "/credentials")
            self.assertEqual((status, credentials["token"], credentials["viewerPassword"], cache),
                             (200, "fixture_" + "t" * 40, "fixture8", "no-store"))
            self.assertNotIn(credentials["token"], (self.operation_root / "state.json").read_text())
            self.assertEqual(self.request("POST", "/finish")[0], 200)
            self.thread.join(timeout=5)
            self.assertFalse(self.thread.is_alive())
            self.assertIsNone(self.operation.credentials())
            self.server.server_close()
            self.operation.cleanup()
            self.assertEqual(list(self.operation_root.glob("tls-*.pem")), [])
            self.assertFalse((self.operation_root / "runtime.tar.gz").exists())

    def test_expiry_stops_the_listener_without_delivering_credentials(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.operation.deadline = time.monotonic() + 0.15
        self.thread = threading.Thread(target=self.server.serve_until_expiry)
        self.thread.start()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())
        self.operation.deadline = time.monotonic() - 1
        self.assertIsNone(self.operation.credentials())
        self.server.server_close()
        self.assertTrue(self.operation.stopped)


if __name__ == "__main__":
    unittest.main()
