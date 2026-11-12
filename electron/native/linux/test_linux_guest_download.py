"""Local TLS/installer fixtures; no public network or cloud resource is used."""
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import test_linux_guest_bootstrap as base

bootstrap = base.bootstrap
PUBLIC_ADDRESS = "93.184.216.34"


class ArtifactNetworkPolicyTests(unittest.TestCase):
    def connection(self):
        connection = bootstrap.ArtifactHTTPSConnection("assets.example.com", 443, timeout=5)
        connection.cancelled = lambda: False
        return connection

    def test_rejects_private_metadata_mixed_and_multicast_dns_before_connecting(self):
        for address in ("127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
                        "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1",
                        "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "ff02::1",
                        "64:ff9b::a00:1", "64:ff9b:1::a00:1", "2002:a00:1::",
                        "2001:0:4136:e378:8000:63bf:3fff:fdd2"):
            for mixed in (False, True):
                with self.subTest(address=address, mixed=mixed):
                    records = [(socket.AF_INET6 if ":" in address else socket.AF_INET,
                                socket.SOCK_STREAM, 6, "", (address, 443))]
                    if mixed:
                        records.insert(0, (socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_ADDRESS, 443)))
                    connection = self.connection()
                    with patch.object(bootstrap.socket, "getaddrinfo", return_value=records), \
                            patch.object(bootstrap.socket, "socket") as create:
                        with self.assertRaisesRegex(OSError, "not public"):
                            connection.connect()
                        create.assert_not_called()

    def test_resolves_once_and_connects_only_the_verified_address_with_original_tls_hostname(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_ADDRESS, 443))]
        connection = self.connection()
        connection._context = MagicMock()
        with patch.object(bootstrap.socket, "getaddrinfo", side_effect=[records, AssertionError("DNS rebinding")]) as dns, \
                patch.object(bootstrap.socket, "socket") as create:
            connection.connect()
            dns.assert_called_once_with("assets.example.com", 443, type=socket.SOCK_STREAM)
            create.return_value.connect.assert_called_once_with((PUBLIC_ADDRESS, 443))
            connection._context.wrap_socket.assert_called_once_with(create.return_value, server_hostname="assets.example.com")

    def test_allows_ordinary_global_ipv6_without_accepting_transition_addresses(self):
        address = ("2606:4700:4700::1111", 443, 0, 0)
        connection = self.connection()
        connection._context = MagicMock()
        with patch.object(bootstrap.socket, "getaddrinfo", return_value=[(socket.AF_INET6, socket.SOCK_STREAM, 6, "", address)]), \
                patch.object(bootstrap.socket, "socket") as create:
            connection.connect()
            create.return_value.connect.assert_called_once_with(address)

    def test_rejects_unsafe_urls_and_cancellation_before_dns(self):
        for url in ("http://assets.example.com/a", "https://user:secret@assets.example.com/a",
                    "https://assets.example.com:444/a", "https://assets.example.com/a#secret",
                    "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a",
                    "https://assets.example.com/a\nsecret"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                bootstrap.download_url(url)
        with patch.object(bootstrap.socket, "getaddrinfo") as dns:
            with self.assertRaisesRegex(OSError, "cancelled"):
                bootstrap.open_artifact("https://assets.example.com/a", lambda: True)
            dns.assert_not_called()


class ArtifactTLSDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = self.root / "payload"
        source.mkdir()
        self.manifest = base.payload(source)
        self.archive = self.root / "package.tar.gz"
        base.runtime_archive(source, self.archive)
        self.mode, self.requests = "normal", []
        self.marker = self.root / "verified"
        installer = str(Path(bootstrap.guest.__file__).resolve())
        self.fixture = self.root / "fixture-installer.py"
        self.fixture.write_text(
            "import argparse,importlib.util,pathlib,tempfile\n"
            "s=importlib.util.spec_from_file_location('guest'," + repr(installer) + ");g=importlib.util.module_from_spec(s);s.loader.exec_module(g)\n"
            "p=argparse.ArgumentParser();p.add_argument('command');p.add_argument('--archive');p.add_argument('--archive-sha256');p.add_argument('--manifest-sha256');p.add_argument('--start',action='store_true');a=p.parse_args()\n"
            "assert a.command=='install-archive' and a.start\n"
            "with tempfile.TemporaryDirectory() as d:\n"
            " g.unpack_payload(a.archive,a.archive_sha256,pathlib.Path(d));g.verify_payload(pathlib.Path(d),a.manifest_sha256)\n"
            "pathlib.Path(" + repr(str(self.marker)) + ").write_text('verified actual archive and manifest')\n")
        key, cert = self.root / "key.pem", self.root / "cert.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
                        "-days", "1", "-subj", "/CN=Explicit local artifact fixture",
                        "-addext", "subjectAltName=DNS:assets.example.com",
                        "-keyout", str(key), "-out", str(cert)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=30, check=True)
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                owner.requests.append({key.lower(): value for key, value in self.headers.items()})
                if owner.mode.startswith("redirect:"):
                    self.send_response(302)
                    self.send_header("Location", owner.mode.split(":", 1)[1])
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                data = owner.archive.read_bytes()
                if owner.mode == "corrupt":
                    data = bytes([data[0] ^ 1]) + data[1:]
                elif owner.mode == "extra":
                    data += b"extra"
                elif owner.mode == "short":
                    data = data[:-1]
                self.send_response(200)
                if owner.mode not in ("extra", "short", "without-length"):
                    self.send_header("Content-Length", str(len(data) + (1 if owner.mode == "bad-length" else 0)))
                if owner.mode == "encoded":
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.server_thread = threading.Thread(target=self.server.serve_forever)
        self.server_thread.start()
        self.addCleanup(self.close_server)
        original_dns, original_socket = socket.getaddrinfo, socket.socket
        original_context = ssl.create_default_context
        self.system_context = original_context
        port = self.server.server_port

        def dns(host, *args, **kwargs):
            if host in ("assets.example.com", "private.example.com"):
                address = PUBLIC_ADDRESS if host == "assets.example.com" else "100.100.100.200"
                return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
            return original_dns(host, *args, **kwargs)

        class FixtureSocket(original_socket):
            def connect(self, address):
                # Only this validated public fixture address is physically redirected.
                if address != (PUBLIC_ADDRESS, 443):
                    raise AssertionError("Unexpected network connection in local fixture")
                return super().connect(("127.0.0.1", port))

        for item in (patch.object(bootstrap.socket, "getaddrinfo", side_effect=dns),
                     patch.object(bootstrap.socket, "socket", FixtureSocket),
                     patch.object(bootstrap.ssl, "create_default_context", side_effect=lambda: original_context(cafile=str(cert))),
                     patch.object(bootstrap.guest, "__file__", str(self.fixture))):
            item.start()
            self.addCleanup(item.stop)

    def close_server(self):
        self.server.shutdown()
        self.server_thread.join(timeout=5)
        self.server.server_close()

    def operation(self):
        root = self.root / ("operation-" + str(len(list(self.root.glob("operation-*")))))
        root.mkdir(mode=0o700)
        config, capability = base.configuration(root, self.archive)
        config["manifestSha256"] = self.manifest
        return bootstrap.Installation(root, config), capability

    def download(self, operation):
        self.assertTrue(operation.download("https://assets.example.com/runtime.tar.gz?signature=synthetic-secret"))
        operation.download_thread.join(timeout=10)
        self.assertFalse(operation.download_thread.is_alive())

    def test_actual_tls_bytes_and_child_manifest_verifier_without_proxy_or_credentials(self):
        for mode in ("normal", "without-length"):
            with self.subTest(mode=mode):
                self.mode = mode
                operation, capability = self.operation()
                with patch.dict("os.environ", {"HTTPS_PROXY": "http://127.0.0.1:1"}):
                    self.download(operation)
                self.assertEqual(operation.phase, "installed")
                self.assertTrue(self.marker.is_file())
                self.assertEqual(operation.archive.read_bytes(), self.archive.read_bytes())
                self.assertFalse(operation.download("https://assets.example.com/another"))
                persisted = operation.state_path.read_text()
                self.assertNotIn("synthetic-secret", persisted)
                self.assertNotIn(capability, persisted)
                self.assertEqual(self.requests[-1]["accept-encoding"], "identity")
                for key in ("authorization", "cookie", "proxy-authorization"):
                    self.assertNotIn(key, self.requests[-1])
                operation.close()

    def test_rejects_bad_length_extra_bytes_short_body_sha_encoding_and_manifest(self):
        for mode in ("bad-length", "extra", "short", "corrupt", "encoded", "manifest"):
            with self.subTest(mode=mode):
                self.mode = mode
                self.marker.unlink(missing_ok=True)
                operation, _ = self.operation()
                if mode == "manifest":
                    operation.config["manifestSha256"] = "0" * 64
                self.download(operation)
                self.assertEqual(operation.phase, "failed")
                self.assertIsNone(operation.credentials())
                self.assertFalse(self.marker.exists())
                self.assertFalse(operation.download("https://assets.example.com/retry"))
                operation.close()

    def test_download_verifies_the_artifact_server_certificate(self):
        operation, _ = self.operation()
        with patch.object(bootstrap.ssl, "create_default_context", side_effect=self.system_context):
            self.download(operation)
        self.assertEqual(operation.phase, "failed")
        self.assertFalse(operation.archive.exists())
        self.assertEqual(self.requests, [])
        operation.close()

    def test_revalidates_redirects_before_any_private_connection(self):
        for target in ("http://assets.example.com/a", "https://user:secret@assets.example.com/a",
                       "https://private.example.com/a", "https://assets.example.com/loop"):
            with self.subTest(target=target):
                self.mode = "redirect:" + target
                operation, _ = self.operation()
                self.download(operation)
                self.assertEqual(operation.phase, "failed")
                self.assertFalse(operation.archive.exists())
                self.assertIsNone(operation.credentials())
                operation.close()


class ArtifactCancellationTests(unittest.TestCase):
    def test_cancellation_or_expiry_between_reads_never_installs_or_recreates_cleaned_files(self):
        for expiry in (False, True):
            with self.subTest(expiry=expiry), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config, _ = base.configuration(root)
                operation = bootstrap.Installation(root, config)
                entered, release = threading.Event(), threading.Event()

                class Response(io.BytesIO):
                    status = 200
                    headers = Message()

                    def read1(self, size):
                        entered.set()
                        if not release.wait(3):
                            raise OSError("Fixture read not released")
                        return super().read1(size)

                with patch.object(bootstrap, "open_artifact", return_value=Response(b"x")), \
                        patch.object(operation, "run_installer") as install:
                    self.assertTrue(operation.download("https://assets.example.com/runtime"))
                    self.assertTrue(entered.wait(2))
                    if expiry:
                        operation.deadline = time.monotonic() - 1
                        closer = None
                    else:
                        closer = threading.Thread(target=operation.close)
                        closer.start()
                        deadline = time.monotonic() + 2
                        while not operation.stopped and time.monotonic() < deadline:
                            time.sleep(0.001)
                        self.assertTrue(operation.stopped)
                    release.set()
                    operation.download_thread.join(timeout=3)
                    self.assertFalse(operation.download_thread.is_alive())
                    if closer:
                        closer.join(timeout=3)
                        self.assertFalse(closer.is_alive())
                    install.assert_not_called()
                    self.assertEqual(operation.phase, "failed")
                    self.assertIsNone(operation.credentials())
                    operation.close()
                    operation.cleanup()
                    self.assertFalse(operation.archive.exists())
                    self.assertFalse(operation.download("https://assets.example.com/retry"))


if __name__ == "__main__":
    unittest.main()
