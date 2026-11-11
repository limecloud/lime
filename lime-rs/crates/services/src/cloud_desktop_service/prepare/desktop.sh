#!/bin/sh
set -eu
exec /usr/bin/python3 -I - <<'LIME_DESKTOP_PREPARE'
"""Prepare distribution packages only; never read or emit user credentials."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

PACKAGES = (
    "xfce4-session", "xfwm4", "xfce4-panel", "xfdesktop4", "thunar",
    "xfce4-terminal", "xfce4-screensaver", "tigervnc-standalone-server",
    "tigervnc-tools", "xauth", "x11-utils", "dbus-x11", "dbus-user-session",
    "novnc", "websockify", "python3-xlib", "python3-pil", "zenity",
    "gnome-keyring", "libsecret-tools",
)
REQUIRED = (
    "Xtigervnc", "tigervncpasswd", "xauth", "xdpyinfo", "xfce4-session",
    "xfce4-screensaver", "gdbus", "vncconfig", "websockify", "zenity",
)
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8",
       "DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l"}


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


def prepare():
    if os.geteuid() != 0:
        return "requiresRoot"
    if not supported_system(Path("/etc/os-release").read_text(), platform.machine()):
        return "unsupportedSystem"
    if shutil.disk_usage("/").free < 4 * 1024**3:
        return "insufficientDisk"
    # Keep the machine's signed package sources and existing configuration.
    # No full upgrade, arbitrary script, reboot, firewall or screen-lock changes.
    if not run(["/usr/bin/apt-get", "-o", "DPkg::Lock::Timeout=60", "update"], 240):
        return "packageInstallFailed"
    if not run(["/usr/bin/apt-get", "-o", "DPkg::Lock::Timeout=60",
                "-o", "Dpkg::Options::=--force-confold", "install", "-y",
                "--no-install-recommends", *PACKAGES], 1200):
        return "packageInstallFailed"
    if (any(shutil.which(name, path=ENV["PATH"]) is None for name in REQUIRED)
            or not Path("/usr/share/novnc/vnc.html").is_file()
            or not run(["/usr/bin/python3", "-I", "-c", "import Xlib, PIL"], 30)):
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
