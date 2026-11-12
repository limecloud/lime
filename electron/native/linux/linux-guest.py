#!/usr/bin/python3
"""Install the same Lime runtime into an unprivileged, persistent Xfce session.

All runtime listeners bind loopback. Authenticated tunnels own remote access;
this installer never reads
cloud profiles, recovery keys or local workstation credentials.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

MARKER = "# Managed by Lime Linux guest\n"
UNITS = ("lime-cloud-display", "lime-cloud-session", "lime-cloud", "lime-cloud-viewer")
REQUIRED = ("Xtigervnc", "tigervncpasswd", "xauth", "xdpyinfo", "xfce4-session",
            "xfce4-screensaver", "gdbus", "vncconfig", "websockify", "zenity")
MAX_ARCHIVE_BYTES = 1024**3
MAX_PAYLOAD_BYTES = 4 * 1024**3


def sha256_value(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


class PayloadTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive):
        # Reject extended/sparse headers before tarfile allocates their bodies.
        # Runtime builds use short, ordinary paths and need neither links nor PAX.
        if self.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
            raise RuntimeError("Guest archive permits only ordinary files and directories")
        return super()._proc_member(archive)


def unpack_payload(source, expected_sha256, destination):
    """Read one pinned descriptor; never execute or restore tar metadata."""
    if not sha256_value(expected_sha256):
        raise RuntimeError("A trusted guest archive SHA-256 is required")
    private_directory(destination)
    if any(destination.iterdir()):
        raise RuntimeError("Guest archive requires a new empty directory")
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_ARCHIVE_BYTES:
            raise RuntimeError("Invalid guest archive size or type")
        result = hashlib.sha256()
        consumed = 0
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            consumed += len(block)
            if consumed > info.st_size:
                raise RuntimeError("Guest archive changed while reading")
            result.update(block)
        if consumed != info.st_size or result.hexdigest() != expected_sha256:
            raise RuntimeError("Guest archive integrity mismatch")
        stream.seek(0)
        seen, files, total, prefix = set(), set(), 0, None
        with tarfile.open(fileobj=stream, mode="r|gz", tarinfo=PayloadTarInfo) as archive:
            for member in archive:
                name = member.name.rstrip("/") if member.isdir() else member.name
                parts = PurePosixPath(name)
                if (not name or parts.is_absolute() or "\\" in name or str(parts) != name
                        or any(p in (".", "..") for p in parts.parts) or name in seen):
                    raise RuntimeError("Guest archive paths must be unique and contained")
                seen.add(name)
                if len(seen) > 6000:
                    raise RuntimeError("Guest archive has too many entries")
                if prefix is None:
                    if not member.isdir() or len(parts.parts) != 1:
                        raise RuntimeError("Guest archive requires one top-level directory")
                    prefix = parts.parts[0]
                    continue
                if parts.parts[0] != prefix or len(parts.parts) < 2:
                    raise RuntimeError("Guest archive requires one top-level directory")
                relative = Path(*parts.parts[1:])
                target = destination / relative
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                total += member.size
                if member.size < 0 or total > MAX_PAYLOAD_BYTES or len(files) >= 2001:
                    raise RuntimeError("Guest archive exceeds the payload limit")
                files.add(relative.as_posix())
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                content = archive.extractfile(member)
                with target.open("xb") as output:
                    remaining = member.size
                    while remaining:
                        block = content.read(min(1024 * 1024, remaining))
                        if not block:
                            raise RuntimeError("Truncated guest archive")
                        output.write(block)
                        remaining -= len(block)
                target.chmod(0o600)
        if prefix is None or "guest-manifest.json" not in files:
            raise RuntimeError("Incomplete guest archive")
        return files


def install_archive(source, archive_sha256, manifest_sha256, start):
    root = private_directory(state_root())
    with tempfile.TemporaryDirectory(prefix=".upload-", dir=root) as directory:
        destination = Path(directory)
        files = unpack_payload(source, archive_sha256, destination)
        manifest = verify_payload(destination, manifest_sha256)
        if files != {e["path"] for e in manifest["files"]} | {"guest-manifest.json"}:
            raise RuntimeError("Guest archive contains files outside its manifest")
        install(destination, manifest_sha256, start)


def digest(file):
    result = hashlib.sha256()
    with file.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Guest state must be an owned private directory")
    return path


@contextmanager
def private_lock(path):
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_nlink != 1):
            raise RuntimeError("Invalid guest operation lease")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def private_write(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())


def private_read(path, allow_empty=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or not (0 if allow_empty else 1) <= info.st_size <= 4096:
            raise RuntimeError("Guest credentials must be owned private regular files")
        return source.read(4097)


def ensure_credentials(config):
    token = config / "token"
    if not token.exists():
        private_write(token, (secrets.token_urlsafe(32) + "\n").encode())
    if len(private_read(token).strip()) < 32:
        raise RuntimeError("Invalid guest connection token")
    viewer, encoded = config / "viewer-password", config / "vnc-password"
    if not viewer.exists():
        if encoded.exists():
            raise RuntimeError("Viewer credentials are incomplete; restore their private backup")
        private_write(viewer, secrets.token_urlsafe(12)[:8].encode() + b"\n")
    password = private_read(viewer).strip()
    if len(password) != 8:
        raise RuntimeError("Invalid viewer password")
    expected = subprocess.run(["tigervncpasswd", "-f"], input=password + b"\n", capture_output=True, check=True).stdout
    if not encoded.exists():
        private_write(encoded, expected)
    if private_read(encoded) != expected:
        raise RuntimeError("Viewer credential integrity mismatch")


def reconnect_credentials():
    """Revoke existing task/viewer sessions before publishing fresh credentials."""
    root = private_directory(state_root())
    with private_lock(root / "installation.lock"):
        releases = private_directory(root / "releases")
        current = root / "current"
        if not current.is_symlink():
            raise RuntimeError("An installed managed guest is required")
        target = current.resolve(strict=True)
        if target.parent != releases or target.is_symlink():
            raise RuntimeError("Invalid managed guest release")
        private_directory(target)
        manifest = target / "guest-manifest.json"
        if manifest.is_symlink():
            raise RuntimeError("Invalid managed guest manifest")
        verify_payload(target, digest(manifest))
        unit_root = Path.home() / ".config/systemd/user"
        for name, expected in units_for(target).items():
            unit = unit_root / (name + ".service")
            if unit.is_symlink() or private_read(unit).decode() != expected:
                raise RuntimeError("Refusing to reconnect unmanaged guest services")
        config = private_directory(config_root())
        # Validate existing credentials before stopping anything. Never regenerate
        # missing or corrupt state implicitly while reconnecting.
        token = private_read(config / "token").strip().decode("ascii")
        viewer = private_read(config / "viewer-password").strip()
        if not all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for c in token) or not 32 <= len(token) <= 256 or len(viewer) != 8:
            raise RuntimeError("Invalid guest credentials")
        encoded = subprocess.run(["tigervncpasswd", "-f"], input=viewer + b"\n", capture_output=True, check=True).stdout
        if private_read(config / "vnc-password") != encoded:
            raise RuntimeError("Viewer credential integrity mismatch")
        new_viewer = secrets.token_urlsafe(12)[:8].encode()
        values = {"token": (secrets.token_urlsafe(32) + "\n").encode(),
                  "viewer-password": new_viewer + b"\n",
                  "vnc-password": subprocess.run(["tigervncpasswd", "-f"], input=new_viewer + b"\n", capture_output=True, check=True).stdout}
        systemctl("stop", "lime-cloud-human.service", *[n + ".service" for n in reversed(UNITS)])
        for name, value in values.items():
            temporary = config / (".reconnect-" + secrets.token_hex(8))
            private_write(temporary, value)
            temporary.replace(config / name)
        descriptor = os.open(config, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        # Restart uses the exact installed release. Neither packages nor runtime
        # files are replaced, and human-control authorization is never revived.
        systemctl("start", *[n + ".service" for n in UNITS])


def state_root():
    return Path.home() / ".local/share/lime/guest"


def config_root():
    return Path.home() / ".config/lime/guest"


def verify_payload(root, expected_sha256):
    if not sha256_value(expected_sha256):
        raise RuntimeError("A trusted guest manifest SHA-256 is required")
    manifest_file = root / "guest-manifest.json"
    if manifest_file.is_symlink() or manifest_file.stat().st_size > 1024 * 1024 or digest(manifest_file) != expected_sha256:
        raise RuntimeError("Guest manifest integrity mismatch")
    manifest = json.loads(manifest_file.read_text())
    for key, value in {"schemaVersion": 1, "applicationId": "com.limecloud.lime",
                       "platform": "linux", "arch": "x64"}.items():
        if manifest.get(key) != value:
            raise RuntimeError("Guest manifest identity mismatch")
    version = manifest.get("version", "")
    if not version or any(c not in "0123456789." for c in version):
        raise RuntimeError("Invalid guest version")
    files, seen = manifest.get("files"), set()
    if not isinstance(files, list) or not 1 <= len(files) <= 2000:
        raise RuntimeError("Invalid guest file manifest")
    for entry in files:
        relative = entry.get("path", "")
        parts = PurePosixPath(relative)
        if not relative or parts.is_absolute() or "\\" in relative or str(parts) != relative or any(p in (".", "..") for p in parts.parts) or relative in seen:
            raise RuntimeError("Guest paths must be unique and contained")
        seen.add(relative)
        current = root
        for part in parts.parts:
            current = current / part
            if current.is_symlink():
                raise RuntimeError("Guest payload cannot contain symbolic links")
        info = current.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != entry.get("size") or digest(current) != entry.get("sha256"):
            raise RuntimeError("Guest resource integrity mismatch")
    required = {"bin/lime", "bin/app-server", "bin/code-mode-host", "bin/desktop-resources.manifest.json",
                "bin/native/linux/linux-native-host", "install.py", "LICENSE", "LICENSES.md", "NOTICE"}
    if not required <= seen:
        raise RuntimeError("Incomplete guest runtime closure")
    native = json.loads((root / "bin/desktop-resources.manifest.json").read_text())
    if any(native.get(k) != v for k, v in {"schemaVersion": 1, "applicationId": manifest["applicationId"],
                                          "version": version, "platform": "linux", "arch": "x64"}.items()):
        raise RuntimeError("Native resource identity mismatch")
    for identifier, file in [("app-server", "app-server"), ("linux-native-host", "native/linux/linux-native-host")]:
        entries = [e for e in native.get("resources", []) if e.get("id") == identifier]
        if len(entries) != 1 or entries[0].get("path") != file or entries[0].get("sha256") != digest(root / "bin" / file):
            raise RuntimeError("Native resource closure mismatch")
    return manifest


def unit_quote(value):
    if "\n" in value or "\r" in value or "\0" in value:
        raise RuntimeError("Invalid service argument")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def units_for(release):
    script = unit_quote(str(release / "install.py"))
    common = ("[Service]\nType=simple\nUMask=0077\n"
              "Environment=DISPLAY=:1\nEnvironment=XDG_SESSION_TYPE=x11\n"
              "Environment=XDG_CURRENT_DESKTOP=XFCE\n"
              "Environment=LIME_MANAGED_VNC_SESSION=1\n"
              "Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=%t/bus\n"
              + "Environment=" + unit_quote("XAUTHORITY=" + str(config_root() / "Xauthority")) + "\n")
    definitions = {
        "lime-cloud-display": ("", "run-display"),
        "lime-cloud-session": ("Requires=lime-cloud-display.service\nAfter=lime-cloud-display.service\n", "run-session"),
        "lime-cloud": ("Requires=lime-cloud-session.service\nAfter=lime-cloud-session.service\n", "run-server"),
        "lime-cloud-viewer": ("Requires=lime-cloud-display.service\nAfter=lime-cloud-display.service\n", "run-viewer"),
        "lime-cloud-human": ("Requires=lime-cloud-display.service\nAfter=lime-cloud-display.service\n", "run-human"),
    }
    return {name: MARKER + "[Unit]\nDescription=Lime persistent Linux " + name + "\n" + dependencies
            + common + "ExecStart=/usr/bin/python3 " + script + " " + command
            + "\nTimeoutStopSec=20\nKillMode=control-group\n[Install]\nWantedBy=default.target\n"
            for name, (dependencies, command) in definitions.items()}


def systemctl(*args):
    subprocess.run(["systemctl", "--user", *args], check=True, timeout=30)


def install(source, expected_sha256, start):
    root = private_directory(state_root())
    with private_lock(root / "installation.lock"):
        install_payload(source, expected_sha256, start)


def install_payload(source, expected_sha256, start):
    manifest = verify_payload(source, expected_sha256)
    missing = [name for name in REQUIRED if not shutil.which(name)]
    if missing or not Path("/usr/share/novnc/vnc.html").is_file():
        raise RuntimeError("Missing desktop packages: " + ", ".join(missing or ["novnc"]))
    subprocess.run(["/usr/bin/python3", "-c", "import Xlib, PIL"], check=True)
    root = private_directory(state_root())
    releases = private_directory(root / "releases")
    config = private_directory(config_root())
    target = releases / (manifest["version"] + "-" + expected_sha256[:12])
    current = root / "current"
    if current.exists() and not current.is_symlink():
        raise RuntimeError("Guest current path is not a managed symbolic link")
    if target.exists():
        verify_payload(target, expected_sha256)
    else:
        stage = private_directory(releases / (".install-" + secrets.token_hex(8)))
        # Copy only the verified allowlist, then verify the actual installed bytes.
        for entry in manifest["files"] + [{"path": "guest-manifest.json"}]:
            file = Path(entry["path"])
            destination = stage / file
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / file, destination, follow_symlinks=False)
            destination.chmod(0o755 if str(file) in ("bin/lime", "bin/app-server", "bin/code-mode-host", "bin/native/linux/linux-native-host") else 0o600)
        verify_payload(stage, expected_sha256)
        stage.rename(target)
    definitions = units_for(target)
    unit_root = Path.home() / ".config/systemd/user"
    unit_root.mkdir(parents=True, exist_ok=True)
    # Fail before replacing any unrelated user unit.
    for name in definitions:
        unit = unit_root / (name + ".service")
        if unit.is_symlink() or (unit.exists() and not unit.read_text().startswith(MARKER)):
            raise RuntimeError("Refusing to replace an unmanaged user service")
    ensure_credentials(config)
    for name, text in definitions.items():
        unit = unit_root / (name + ".service")
        temporary = unit_root / ("." + name + "." + secrets.token_hex(8))
        private_write(temporary, text.encode())
        temporary.replace(unit)
    temporary = root / (".current-" + secrets.token_hex(8))
    temporary.symlink_to(target)
    temporary.replace(current)
    systemctl("daemon-reload")
    if start:
        # Stop dependents in order; never revive a human-control grant on upgrade.
        systemctl("stop", "lime-cloud-human.service", *[n + ".service" for n in reversed(UNITS)])
        systemctl("enable", *[n + ".service" for n in UNITS])
        systemctl("start", *[n + ".service" for n in UNITS])
    print(json.dumps({"installed": str(target), "version": manifest["version"], "started": start,
                      "appServer": "ws://127.0.0.1:8787", "desktop": "http://127.0.0.1:6080/vnc.html",
                      "credentialsDirectory": str(config), "access": "Authenticated tunnel required"}))


def wait_display():
    for _ in range(100):
        if subprocess.run(["xdpyinfo"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return
        time.sleep(0.1)
    raise RuntimeError("The managed X11 desktop is unavailable")


def run(command):
    config = config_root()
    root = Path(__file__).resolve().parent
    if command == "run-display":
        authority = config / "Xauthority"
        if not authority.exists():
            private_write(authority, b"")
        else:
            private_read(authority, allow_empty=True)
        subprocess.run(["xauth", "-f", str(authority), "source", "-"],
                       input=("add :1 . " + secrets.token_hex(16) + "\n").encode(), check=True)
        args = ["Xtigervnc", ":1", "-localhost", "yes", "-SecurityTypes", "VncAuth",
                "-PasswordFile", str(config / "vnc-password"), "-auth", str(authority),
                "-geometry", "1920x1080", "-depth", "24", "-AlwaysShared",
                "-AcceptKeyEvents=0", "-AcceptPointerEvents=0",
                "-AllowOverride=AcceptKeyEvents,AcceptPointerEvents",
                "-AcceptCutText=0", "-SendCutText=0", "-AcceptSetDesktopSize=0",
                "-nolisten", "tcp"]
    else:
        wait_display()
        if command == "run-session":
            args = ["xfce4-session"]
        elif command == "run-server":
            os.environ["LD_LIBRARY_PATH"] = str(root / "bin")
            os.environ["PATH"] = str(root / "bin") + os.pathsep + os.environ.get("PATH", "")
            args = [str(root / "bin/app-server"), "--listen", "ws://127.0.0.1:8787", "--backend", "runtime",
                    "--ws-auth", "capability-token", "--ws-token-file", str(config / "token")]
        elif command == "run-viewer":
            args = ["websockify", "--web=/usr/share/novnc", "127.0.0.1:6080", "127.0.0.1:5901"]
        else:
            args = ["/usr/bin/python3", str(root / "bin/native/linux/linux-native-host"), "--control-human"]
    os.execvpe(args[0], args, os.environ)


def control(mode):
    if mode == "human":
        systemctl("start", "lime-cloud-human.service")
        for _ in range(120):
            result = subprocess.run(["vncconfig", "-get", "AcceptKeyEvents"], capture_output=True)
            if result.returncode == 0 and result.stdout.strip() in (b"1", b"on", b"true"):
                print("Human control active; AI input is fenced")
                return
            time.sleep(0.1)
        systemctl("stop", "lime-cloud-human.service")
        raise RuntimeError("Human takeover did not become ready; AI remains fenced")
    systemctl("stop", "lime-cloud-human.service")
    subprocess.run(["/usr/bin/python3", str(Path(__file__).resolve().parent / "bin/native/linux/linux-native-host"),
                    "--control-ai"], check=True)
    print("Viewer input disabled; new AI actions require their normal grants")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--manifest-sha256", required=True)
    install_parser.add_argument("--start", action="store_true")
    archive_parser = commands.add_parser("install-archive")
    archive_parser.add_argument("--archive", required=True, type=Path)
    archive_parser.add_argument("--archive-sha256", required=True)
    archive_parser.add_argument("--manifest-sha256", required=True)
    archive_parser.add_argument("--start", action="store_true")
    control_parser = commands.add_parser("control")
    control_parser.add_argument("mode", choices=("human", "ai"))
    commands.add_parser("reconnect")
    for command in ("run-display", "run-session", "run-server", "run-viewer", "run-human"):
        commands.add_parser(command)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("An unprivileged Linux x64 desktop user is required")
    runtime = Path("/run/user") / str(os.getuid())
    if not runtime.is_dir() or runtime.stat().st_uid != os.getuid():
        raise RuntimeError("Start this user's systemd manager before installing the guest")
    os.environ.update(DISPLAY=":1", XAUTHORITY=str(config_root() / "Xauthority"),
                      XDG_SESSION_TYPE="x11", XDG_CURRENT_DESKTOP="XFCE",
                      XDG_RUNTIME_DIR=str(runtime), DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(runtime / "bus"),
                      LIME_MANAGED_VNC_SESSION="1")
    if args.command == "install":
        install(Path(__file__).resolve().parent, args.manifest_sha256, args.start)
    elif args.command == "install-archive":
        install_archive(args.archive, args.archive_sha256, args.manifest_sha256, args.start)
    elif args.command == "control":
        control(args.mode)
    elif args.command == "reconnect":
        reconnect_credentials()
    else:
        run(args.command)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, tarfile.TarError, subprocess.SubprocessError) as error:
        print("Lime Linux guest: " + str(error), file=sys.stderr)
        sys.exit(1)
