#!/usr/bin/python3
"""Short-lived, unprivileged upload of one trusted Linux guest runtime.

The management channel delivers only the generated public certificate and a
capability digest. A pinned TLS client supplies the capability in a header;
guest credentials are returned only over that authenticated TLS connection.
"""
import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import secrets
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import uuid


def load_installer():
    directory = Path(__file__).resolve().parent
    file = directory / "install.py"
    if not file.is_file():
        file = directory / "linux-guest.py"
    spec = importlib.util.spec_from_file_location("lime_guest_installer", file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guest = load_installer()
MAX_LIFETIME = 30 * 60


def load_config(path):
    if not path.is_absolute():
        raise RuntimeError("Bootstrap configuration must be absolute")
    guest.private_directory(path.parent)
    config = json.loads(guest.private_read(path))
    fields = {"operationId", "capabilitySha256", "archiveSha256", "manifestSha256",
              "archiveBytes", "bindAddress", "publicAddress", "expiresAt"}
    if not isinstance(config, dict) or set(config) != fields:
        raise RuntimeError("Invalid bootstrap configuration")
    try:
        if str(uuid.UUID(config["operationId"])) != config["operationId"]:
            raise ValueError()
        for name in ("capabilitySha256", "archiveSha256", "manifestSha256"):
            if not guest.sha256_value(config[name]):
                raise ValueError()
        for name in ("bindAddress", "publicAddress"):
            address = ipaddress.IPv4Address(config[name])
            if address.is_unspecified or address.is_multicast or str(address) != config[name]:
                raise ValueError()
        if (type(config["archiveBytes"]) is not int
                or not 0 < config["archiveBytes"] <= guest.MAX_ARCHIVE_BYTES
                or type(config["expiresAt"]) is not int
                or not 0 < config["expiresAt"] - time.time() <= MAX_LIFETIME):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError("Invalid bootstrap configuration") from None
    return config


def operation_lock(root):
    return guest.private_lock(root / "lease")


def certificate(root, address):
    key, cert = root / "tls-key.pem", root / "tls-cert.pem"
    if key.exists() or cert.exists():
        guest.private_read(key)
        return guest.private_read(cert).decode("ascii")
    # No names, paths, credentials or arbitrary openssl flags come from HTTP.
    result = subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
         "-days", "1", "-subj", "/CN=Lime temporary guest installation",
         "-addext", "subjectAltName=IP:" + address,
         "-keyout", str(key), "-out", str(cert)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=30, check=False)
    if result.returncode != 0:
        raise RuntimeError("Cannot create bootstrap certificate")
    key.chmod(0o600)
    cert.chmod(0o600)
    guest.private_read(key)
    return guest.private_read(cert).decode("ascii")


class Installation:
    def __init__(self, root, config):
        self.root, self.config = root, config
        self.lock = threading.Lock()
        self.stopped = False
        self.process = None
        self.phase, self.diagnostic = "waiting", None
        self.state_path = root / "state.json"
        self.archive = root / "runtime.tar.gz"
        self.deadline = time.monotonic() + max(0, config["expiresAt"] - time.time())
        if self.state_path.exists():
            state = json.loads(guest.private_read(self.state_path))
            if (not isinstance(state, dict) or set(state) != {"configurationSha256", "phase"}
                    or state["phase"] not in ("waiting", "receiving", "installing", "installed", "finished", "failed")):
                raise RuntimeError("Invalid bootstrap operation receipt")
            if state.get("configurationSha256") != self.configuration_sha256():
                raise RuntimeError("Bootstrap operation belongs to another package")
            if state.get("phase") in ("installed", "finished", "failed"):
                self.phase = state["phase"]
                self.diagnostic = "INSTALLATION_FAILED" if self.phase == "failed" else None
            else:
                # Never replay an interrupted mutation, even with another PUT.
                self.phase, self.diagnostic = "failed", "INSTALLATION_INTERRUPTED"
        elif self.archive.exists():
            raise RuntimeError("Bootstrap archive has no operation receipt")
        self.save()

    def configuration_sha256(self):
        return hashlib.sha256(json.dumps(self.config, sort_keys=True).encode()).hexdigest()

    def remaining(self):
        return max(0, min(self.config["expiresAt"] - time.time(),
                          self.deadline - time.monotonic()))

    def save(self):
        temporary = self.root / (".state-" + secrets.token_hex(8))
        guest.private_write(temporary, json.dumps({
            "configurationSha256": self.configuration_sha256(), "phase": self.phase,
        }).encode())
        temporary.replace(self.state_path)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def begin(self):
        with self.lock:
            if self.stopped or self.phase != "waiting" or self.remaining() <= 0:
                return False
            self.phase = "receiving"
            self.save()
            return True

    def accept(self, stream):
        remaining = self.config["archiveBytes"]
        fd = os.open(self.archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        result = hashlib.sha256()
        with os.fdopen(fd, "wb") as output:
            while remaining:
                if self.remaining() <= 0:
                    raise RuntimeError("Bootstrap expired")
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    raise RuntimeError("Incomplete upload")
                result.update(block)
                output.write(block)
                remaining -= len(block)
            output.flush()
            os.fsync(output.fileno())
        if result.hexdigest() != self.config["archiveSha256"]:
            raise RuntimeError("Archive integrity mismatch")
        with self.lock:
            self.phase = "installing"
            self.save()
        # This fixed management-supplied installer runs as the desktop user.
        # Uploaded install.py is copied only after the trusted manifest check;
        # it is never executed by a privileged network process.
        install_script = Path(guest.__file__).resolve()
        with self.lock:
            if self.stopped:
                raise RuntimeError("Bootstrap expired")
            process = subprocess.Popen(
                ["/usr/bin/python3", "-I", str(install_script), "install-archive",
                 "--archive", str(self.archive),
                 "--archive-sha256", self.config["archiveSha256"],
                 "--manifest-sha256", self.config["manifestSha256"], "--start"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, start_new_session=True)
            self.process = process
        try:
            if process.wait(timeout=max(0.01, min(300, self.remaining()))) != 0:
                raise RuntimeError("Installation failed")
        finally:
            self.stop_process(process)
            with self.lock:
                self.process = None
        if self.remaining() <= 0:
            raise RuntimeError("Bootstrap expired")
        with self.lock:
            if self.stopped:
                raise RuntimeError("Bootstrap expired")
            self.phase = "installed"
            self.save()

    def fail(self):
        with self.lock:
            self.phase, self.diagnostic = "failed", "INSTALLATION_FAILED"
            self.save()

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()

    def close(self):
        with self.lock:
            self.stopped = True
            if self.process is not None:
                self.stop_process(self.process)
            if self.phase in ("receiving", "installing"):
                self.phase, self.diagnostic = "failed", "INSTALLATION_INTERRUPTED"
                self.save()

    def cleanup(self):
        # Fixed operation-owned names only; retain the non-secret receipt.
        for name in ("runtime.tar.gz", "tls-key.pem", "tls-cert.pem", "listener.json"):
            (self.root / name).unlink(missing_ok=True)

    def status(self):
        with self.lock:
            return {"operationId": self.config["operationId"], "phase": self.phase,
                    "diagnostic": self.diagnostic, "expiresAt": self.config["expiresAt"]}

    def credentials(self):
        with self.lock:
            if self.stopped or self.phase != "installed" or self.remaining() <= 0:
                return None
            config = guest.config_root()
            token = guest.private_read(config / "token").strip().decode("ascii")
            viewer = guest.private_read(config / "viewer-password").strip().decode("ascii")
            if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token) or len(viewer) != 8:
                raise RuntimeError("Invalid installed credentials")
            return {"operationId": self.config["operationId"], "token": token,
                    "viewerPassword": viewer}

    def finish(self):
        with self.lock:
            if self.stopped or self.phase != "installed" or self.remaining() <= 0:
                return False
            self.phase = "finished"
            self.save()
            return True


class UploadServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False

    def __init__(self, address, installation, context):
        self.installation = installation
        self.slots = threading.BoundedSemaphore(4)
        self.connections = set()
        self.connection_lock = threading.Lock()
        self.context = context
        super().__init__(address, UploadHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(max(0.01, min(10, self.installation.remaining())))
        try:
            connection = self.context.wrap_socket(connection, server_side=True)
        except (OSError, ssl.SSLError):
            connection.close()
            raise
        connection.settimeout(max(0.01, min(30, self.installation.remaining())))
        with self.connection_lock:
            self.connections.add(connection)
        return connection, address

    def shutdown_request(self, request):
        with self.connection_lock:
            self.connections.discard(request)
        super().shutdown_request(request)

    def server_close(self):
        with self.connection_lock:
            for connection in self.connections:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()
            self.connections.clear()
        self.installation.close()
        super().server_close()

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        # Base HTTPServer would print request context and raw exceptions.
        pass

    def serve_until_expiry(self):
        timer = threading.Timer(self.installation.remaining(), self.shutdown)
        timer.daemon = True
        timer.start()
        try:
            self.serve_forever(poll_interval=0.1)
        finally:
            timer.cancel()


class UploadHandler(BaseHTTPRequestHandler):
    server_version = "LimeBootstrap"
    sys_version = ""

    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(data)

    def authorize(self):
        values = self.headers.get_all("Authorization", [])
        value = values[0] if len(values) == 1 else ""
        if (not re.fullmatch(r"Bearer [0-9a-f]{64}", value)
                or not hmac.compare_digest(hashlib.sha256(value[7:].encode()).hexdigest(),
                                           self.server.installation.config["capabilitySha256"])):
            self.reply(401, {"error": "UNAUTHORIZED"})
            return False
        if self.headers.get_all("Origin"):
            self.reply(403, {"error": "ORIGIN_DENIED"})
            return False
        if self.server.installation.remaining() <= 0:
            self.reply(410, {"error": "EXPIRED"})
            return False
        return True

    def do_GET(self):
        if not self.authorize():
            return
        if self.path == "/status":
            self.reply(200, self.server.installation.status())
        elif self.path == "/credentials":
            try:
                value = self.server.installation.credentials()
                self.reply(200 if value else 409, value or {"error": "NOT_INSTALLED"})
            except (OSError, UnicodeError, RuntimeError):
                self.reply(500, {"error": "CREDENTIALS_UNAVAILABLE"})
        else:
            self.reply(404, {"error": "NOT_FOUND"})

    def do_PUT(self):
        if not self.authorize():
            return
        if self.path != "/runtime":
            self.reply(404, {"error": "NOT_FOUND"})
            return
        sizes = self.headers.get_all("Content-Length", [])
        if (sizes != [str(self.server.installation.config["archiveBytes"])]
                or self.headers.get_all("Transfer-Encoding")
                or self.headers.get_all("Expect")):
            self.reply(400, {"error": "INVALID_LENGTH"})
            return
        if not self.server.installation.begin():
            self.reply(409, {"error": "ALREADY_SUBMITTED"})
            return
        try:
            self.server.installation.accept(self.rfile)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            self.server.installation.fail()
            self.reply(422, {"error": "INSTALLATION_FAILED"})
            return
        self.reply(200, self.server.installation.status())

    def do_POST(self):
        if not self.authorize():
            return
        if self.path != "/finish":
            self.reply(404, {"error": "NOT_FOUND"})
            return
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Content-Length", []) not in ([], ["0"]):
            self.reply(400, {"error": "INVALID_LENGTH"})
            return
        if not self.server.installation.finish():
            self.reply(409, {"error": "NOT_INSTALLED"})
            return
        self.reply(200, {"phase": "finished"})
        threading.Thread(target=self.server.shutdown, daemon=True).start()


def serve(root, config):
    installation = Installation(root, config)
    try:
        if installation.phase == "finished":
            raise RuntimeError("Bootstrap operation is already closed")
        public_certificate = certificate(root, config["publicAddress"])
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(root / "tls-cert.pem", root / "tls-key.pem")
        (root / "listener.json").unlink(missing_ok=True)
        with UploadServer((config["bindAddress"], 8787), installation, context) as server:
            def stop(_number, _frame):
                threading.Thread(target=server.shutdown, daemon=True).start()
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
            # Management may relay this public certificate, never guest credentials.
            public = {"operationId": config["operationId"], "certificate": public_certificate,
                      "expiresAt": config["expiresAt"], "phase": "listening"}
            guest.private_write(root / "listener.json", json.dumps(public).encode())
            print(json.dumps(public), flush=True)
            server.serve_until_expiry()
    finally:
        installation.close()
        installation.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("An unprivileged Linux x64 desktop user is required")
    os.umask(0o077)
    config = load_config(args.config)
    with operation_lock(args.config.parent):
        serve(args.config.parent, config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print("Lime guest bootstrap failed", file=sys.stderr)
        sys.exit(1)
