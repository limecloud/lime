"""Fixed ECS Cloud Assistant bootstrap. Never reads application credentials."""
import fcntl
import json
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import stat
import subprocess
import time
import uuid

BASE = Path("/var/lib/lime/cloud-guest")
HOME = Path("/home/lime")
MARKER = "LIME_GUEST_BOOTSTRAP_V1:"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}


def run(arguments, timeout=30):
    subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, env=ENV, timeout=timeout, check=True)


def private_read(path, owner, limit=8192):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_nlink != 1
                or info.st_mode & 0o077 or not 0 < info.st_size <= limit):
            raise RuntimeError("privateStateInvalid")
        return source.read(limit + 1)


def create_file(path, value, owner=0, group=0):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
        os.fchown(output.fileno(), owner, group)


def root_directory(path):
    path.mkdir(mode=0o711, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError("privateStateInvalid")


def validate_config(config):
    reconnect = isinstance(config, dict) and config.get("reconnect") is True
    fields = {"operationId", "capabilitySha256", "expiresAt"}
    fields |= {"reconnect"} if reconnect else {"archiveSha256", "manifestSha256", "archiveBytes"}
    if not isinstance(config, dict) or set(config) != fields:
        raise RuntimeError("invalidConfiguration")
    if str(uuid.UUID(config["operationId"])) != config["operationId"]:
        raise RuntimeError("invalidConfiguration")
    for key in (("capabilitySha256",) if reconnect else ("capabilitySha256", "archiveSha256", "manifestSha256")):
        if not isinstance(config[key], str) or not re.fullmatch(r"[0-9a-f]{64}", config[key]):
            raise RuntimeError("invalidConfiguration")
    if ((not reconnect and (type(config["archiveBytes"]) is not int or not 0 < config["archiveBytes"] <= 1024**3))
            or type(config["expiresAt"]) is not int or not 0 < config["expiresAt"] - time.time() <= 1800):
        raise RuntimeError("invalidConfiguration")


def desktop_user(create=True):
    marker = BASE / "desktop-user.json"
    try:
        user = pwd.getpwnam("lime")
    except KeyError:
        if not create or marker.exists():
            raise RuntimeError("userConflict") from None
        run(["/usr/sbin/useradd", "--create-home", "--user-group", "--shell", "/bin/bash",
             "--comment", "Lime persistent desktop", "lime"])
        user = pwd.getpwnam("lime")
        if user.pw_uid < 1000 or user.pw_dir != str(HOME):
            raise RuntimeError("userConflict")
        create_file(marker, json.dumps({"uid": user.pw_uid, "gid": user.pw_gid,
                                       "home": user.pw_dir}).encode())
    expected = {"uid": user.pw_uid, "gid": user.pw_gid, "home": str(HOME)}
    if (user.pw_uid < 1000 or user.pw_dir != str(HOME) or user.pw_shell != "/bin/bash"
            or json.loads(private_read(marker, 0)) != expected):
        raise RuntimeError("userConflict")
    info = HOME.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != user.pw_uid or info.st_mode & 0o022:
        raise RuntimeError("userConflict")
    run(["/usr/bin/loginctl", "enable-linger", "lime"])
    run(["/usr/bin/systemctl", "start", "user@" + str(user.pw_uid) + ".service"])
    runtime = Path("/run/user") / str(user.pw_uid)
    info = runtime.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != user.pw_uid or info.st_mode & 0o077:
        raise RuntimeError("managerNotReady")
    return user


def supported_system():
    values = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines()
                  if "=" in line and not line.startswith("#"))
    return (values.get("ID", "").strip('"') == "ubuntu"
            and values.get("VERSION_ID", "").strip('"') == "24.04"
            and platform.machine() == "x86_64")


def ready_output(path, owner, config):
    value = json.loads(private_read(path, owner))
    if (not isinstance(value, dict)
            or set(value) != {"operationId", "certificate", "expiresAt", "phase"}
            or value["operationId"] != config["operationId"] or value["expiresAt"] != config["expiresAt"]
            or value["phase"] != "listening" or not isinstance(value["certificate"], str)
            or not re.fullmatch(r"-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n", value["certificate"])):
        raise RuntimeError("bootstrapFailed")
    return {"operationId": config["operationId"], "phase": "uploadReady",
            "certificate": value["certificate"],
            "expiresAt": config["expiresAt"]}


def prepare(bundle):
    if os.geteuid() != 0:
        raise RuntimeError("requiresRoot")
    if not supported_system():
        raise RuntimeError("unsupportedSystem")
    config = bundle["config"]
    validate_config(config)
    if any(shutil.which(name, path=ENV["PATH"]) is None for name in
           ("openssl", "Xtigervnc", "websockify", "xfce4-session", "xfce4-screensaver")):
        raise RuntimeError("dependenciesNotReady")
    # All privileged writes stay below root-owned parents. Never write into a
    # desktop user's mutable home as root, including on a later installation.
    for directory in (BASE.parent, BASE, BASE / "bootstrap"):
        root_directory(directory)
    lease = os.open(BASE / "launch.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lease)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1):
            raise RuntimeError("privateStateInvalid")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        user = desktop_user(create=config.get("reconnect") is not True)
        stage = BASE / "bootstrap" / config["operationId"]
        stage.mkdir(mode=0o700, exist_ok=False)
        for name, content in (("install.py", bundle["installer"]), ("bootstrap.py", bundle["bootstrap"]),
                              ("config.json", json.dumps(config))):
            create_file(stage / name, content.encode(), user.pw_uid, user.pw_gid)
        os.chown(stage, user.pw_uid, user.pw_gid, follow_symlinks=False)
        unit = "lime-guest-install-" + config["operationId"]
        run(["/usr/bin/systemd-run", "--quiet", "--collect", "--unit=" + unit,
             "--property=User=" + str(user.pw_uid), "--property=Group=" + str(user.pw_gid),
             "--property=WorkingDirectory=" + str(HOME), "--property=UMask=0077",
             "--property=RuntimeMaxSec=1800", "--property=TimeoutStopSec=10",
             "--property=KillMode=control-group", "--property=NoNewPrivileges=yes",
             "--setenv=HOME=" + str(HOME), "--setenv=USER=lime", "--setenv=LOGNAME=lime",
             "--setenv=PATH=/usr/bin:/bin", "--setenv=XDG_RUNTIME_DIR=/run/user/" + str(user.pw_uid),
             "/usr/bin/python3", "-I", str(stage / "bootstrap.py"), "--config", str(stage / "config.json")])
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and time.time() < config["expiresAt"]:
            if (stage / "listener.json").exists():
                run(["/usr/bin/systemctl", "is-active", "--quiet", unit + ".service"], 5)
                return ready_output(stage / "listener.json", user.pw_uid, config)
            time.sleep(0.2)
        raise RuntimeError("bootstrapFailed")
    finally:
        os.close(lease)


def main(bundle):
    try:
        result = prepare(bundle)
        status = 0
    except (OSError, KeyError, ValueError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, RuntimeError) else "bootstrapFailed"
        if code not in ("requiresRoot", "unsupportedSystem", "invalidConfiguration", "dependenciesNotReady",
                        "privateStateInvalid", "userConflict", "managerNotReady", "bootstrapFailed"):
            code = "bootstrapFailed"
        result, status = {"phase": "failed", "code": code}, 1
    print(MARKER + json.dumps(result, separators=(",", ":")))
    return status
