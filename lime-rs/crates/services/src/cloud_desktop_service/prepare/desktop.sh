#!/bin/sh
set -eu
exec /usr/bin/python3 -I - <<'LIME_DESKTOP_PREPARE'
"""Prepare distribution packages only; never read or emit user credentials."""
import errno
import fcntl
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

PACKAGES = (
    "xfce4-session", "xfwm4", "xfce4-panel", "xfdesktop4", "thunar",
    "xfce4-terminal", "xfce4-screensaver", "tigervnc-standalone-server",
    "tigervnc-tools", "tigervnc-common", "xauth", "x11-utils", "dbus-x11",
    "dbus-user-session", "libglib2.0-bin",
    "novnc", "websockify", "python3-xlib", "python3-pil", "zenity",
    "gnome-keyring", "libsecret-tools", "fonts-noto-cjk",
)
REQUIRED = (
    "Xtigervnc", "tigervncpasswd", "xauth", "xdpyinfo", "xfce4-session",
    "xfce4-screensaver", "gdbus", "vncconfig", "websockify", "zenity",
)
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8",
       "DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l"}
APT_LISTS_LOCK = Path("/var/lib/apt/lists/lock")


def supported_system(release, machine):
    values = dict(line.split("=", 1) for line in release.splitlines()
                  if "=" in line and not line.startswith("#"))
    return (values.get("ID", "").strip('"') == "ubuntu"
            and values.get("VERSION_ID", "").strip('"') == "24.04"
            and machine == "x86_64")


def run(arguments, timeout):
    return subprocess.run(arguments, env=ENV, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=timeout, check=False).returncode == 0


def wait_for_package_index_lock(timeout):
    deadline = time.monotonic() + timeout
    try:
        descriptor = os.open(APT_LISTS_LOCK, os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
    except FileNotFoundError:
        return True
    try:
        while True:
            try:
                # APT uses POSIX record locks; flock does not observe these locks.
                fcntl.lockf(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError as error:
                if error.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            time.sleep(min(0.25, remaining))
    finally:
        os.close(descriptor)


def missing_packages():
    result = subprocess.run(
        ["/usr/bin/dpkg-query", "--show", "--showformat=${Package}\t${db:Status-Status}\n",
         *PACKAGES], env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, timeout=30, check=False)
    if result.returncode not in (0, 1):
        raise OSError("Cannot inspect desktop packages")
    installed = set()
    seen = set()
    for line in result.stdout.decode("ascii").splitlines():
        package, status = line.split("\t", 1)
        if (package not in PACKAGES or package in seen
                or status not in ("not-installed", "config-files", "half-installed", "unpacked",
                                  "half-configured", "triggers-awaited", "triggers-pending", "installed")):
            raise ValueError("Invalid desktop package inventory")
        seen.add(package)
        if status == "installed":
            installed.add(package)
    if (result.returncode == 0) != (len(seen) == len(PACKAGES)):
        raise ValueError("Incomplete desktop package inventory")
    return [package for package in PACKAGES if package not in installed]


def dependencies_ready():
    return (all(shutil.which(name, path=ENV["PATH"]) is not None for name in REQUIRED)
            and Path("/usr/share/novnc/vnc.html").is_file()
            and run(["/usr/bin/python3", "-I", "-c", "import Xlib, PIL"], 30))


def prepare():
    if os.geteuid() != 0:
        return "requiresRoot"
    if not supported_system(Path("/etc/os-release").read_text(), platform.machine()):
        return "unsupportedSystem"
    missing = missing_packages()
    # Reuse the prepared environment without contacting package sources, taking
    # the apt lock or upgrading installed desktop packages on every invocation.
    if not missing:
        return "ready" if dependencies_ready() else "dependencyCheckFailed"
    if shutil.disk_usage("/").free < 4 * 1024**3:
        return "insufficientDisk"
    # Keep the machine's signed package sources and existing configuration.
    # No full upgrade, arbitrary script, reboot, firewall or screen-lock changes.
    # DPkg::Lock::Timeout does not wait for the update command's lists lock.
    # Close our probe before APT starts; APT must still obtain its own lock.
    if not wait_for_package_index_lock(60):
        return "packageInstallFailed"
    if not run(["/usr/bin/apt-get", "-o", "DPkg::Lock::Timeout=60", "update"], 240):
        return "packageInstallFailed"
    if not run(["/usr/bin/apt-get", "-o", "DPkg::Lock::Timeout=60",
                "-o", "Dpkg::Options::=--force-confold", "install", "-y",
                "--no-install-recommends", *missing], 1200):
        return "packageInstallFailed"
    if missing_packages() or not dependencies_ready():
        return "dependencyCheckFailed"
    return "ready"


def main():
    try:
        status = prepare()
    except (OSError, ValueError, subprocess.SubprocessError):
        status = "preparationFailed"
    print("LIME_DESKTOP_PREPARE_V1:" + status)
    return 0 if status == "ready" else 1


if __name__ == "__main__":
    sys.exit(main())
LIME_DESKTOP_PREPARE
