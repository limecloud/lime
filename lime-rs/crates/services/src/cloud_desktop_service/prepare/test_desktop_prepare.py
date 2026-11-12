"""Exercise the shipped bootstrap without modifying the host package manager."""
from contextlib import redirect_stdout
import io
from pathlib import Path
import types
import unittest
from unittest.mock import patch

script = Path(__file__).with_name("desktop.sh").read_text()
source = script.split("<<'LIME_DESKTOP_PREPARE'\n", 1)[1].rsplit("\nLIME_DESKTOP_PREPARE", 1)[0]
guest = types.ModuleType("desktop_prepare")
exec(compile(source, "desktop.sh", "exec"), guest.__dict__)


class DesktopPreparationTests(unittest.TestCase):
    def test_only_supported_distribution_and_architecture(self):
        self.assertTrue(guest.supported_system('ID=ubuntu\nVERSION_ID="24.04"\n', "x86_64"))
        for release, machine in [('ID=debian\nVERSION_ID="24.04"', "x86_64"),
                                 ('ID=ubuntu\nVERSION_ID="22.04"', "x86_64"),
                                 ('ID=ubuntu\nVERSION_ID="24.04"', "aarch64")]:
            self.assertFalse(guest.supported_system(release, machine))

    def test_no_package_command_for_unsupported_system_or_non_root(self):
        with patch.object(guest.os, "geteuid", return_value=1000), patch.object(guest, "run") as run:
            self.assertEqual(guest.prepare(), "requiresRoot")
            run.assert_not_called()
        with patch.object(guest.os, "geteuid", return_value=0), \
             patch.object(guest.Path, "read_text", return_value="ID=debian\nVERSION_ID=12"), \
             patch.object(guest, "run") as run:
            self.assertEqual(guest.prepare(), "unsupportedSystem")
            run.assert_not_called()

    def test_fixed_signed_package_install_then_dependency_probe(self):
        with patch.object(guest.os, "geteuid", return_value=0), \
             patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
             patch.object(guest.platform, "machine", return_value="x86_64"), \
             patch.object(guest.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8*1024**3)), \
             patch.object(guest.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(guest.Path, "is_file", return_value=True), \
             patch.object(guest, "missing_packages", side_effect=[["tigervnc-common", "libglib2.0-bin"], []]), \
             patch.object(guest, "run", return_value=True) as run:
            self.assertEqual(guest.prepare(), "ready")
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(len(commands), 3)
            self.assertEqual(commands[0][-1], "update")
            self.assertIn("--no-install-recommends", commands[1])
            self.assertIn("tigervnc-common", commands[1])
            self.assertIn("libglib2.0-bin", commands[1])
            self.assertNotIn("xfce4-session", commands[1])
            self.assertIn("Dpkg::Options::=--force-confold", commands[1])
            self.assertEqual(commands[2], ["/usr/bin/python3", "-I", "-c", "import Xlib, PIL"])
            self.assertTrue(all("upgrade" not in command for command in commands))

    def test_prepared_desktop_is_reused_without_apt_or_installation_disk_budget(self):
        with patch.object(guest.os, "geteuid", return_value=0), \
             patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
             patch.object(guest.platform, "machine", return_value="x86_64"), \
             patch.object(guest, "missing_packages", return_value=[]), \
             patch.object(guest.shutil, "disk_usage") as disk, \
             patch.object(guest.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(guest.Path, "is_file", return_value=True), \
             patch.object(guest, "run", return_value=True) as run:
            self.assertEqual(guest.prepare(), "ready")
            disk.assert_not_called()
            run.assert_called_once_with(
                ["/usr/bin/python3", "-I", "-c", "import Xlib, PIL"], 30)

    def test_existing_desktop_with_missing_cjk_fonts_is_completed_once(self):
        before = "".join(f"{package}\tinstalled\n" for package in guest.PACKAGES
                         if package != "fonts-noto-cjk").encode("ascii")
        after = before + b"fonts-noto-cjk\tinstalled\n"
        inventories = [types.SimpleNamespace(returncode=1, stdout=before),
                       types.SimpleNamespace(returncode=0, stdout=after),
                       types.SimpleNamespace(returncode=0, stdout=after)]
        with patch.object(guest.os, "geteuid", return_value=0), \
             patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
             patch.object(guest.platform, "machine", return_value="x86_64"), \
             patch.object(guest.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8*1024**3)), \
             patch.object(guest.subprocess, "run", side_effect=inventories), \
             patch.object(guest, "dependencies_ready", return_value=True), \
             patch.object(guest, "run", return_value=True) as run:
            self.assertEqual(guest.prepare(), "ready")
            install = run.call_args_list[1].args[0]
            self.assertEqual(install[install.index("--no-install-recommends") + 1:],
                             ["fonts-noto-cjk"])
            self.assertEqual(guest.prepare(), "ready")
            self.assertEqual(run.call_count, 2)

    def test_broken_prepared_desktop_does_not_update_or_silently_repair_packages(self):
        with patch.object(guest.os, "geteuid", return_value=0), \
             patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
             patch.object(guest.platform, "machine", return_value="x86_64"), \
             patch.object(guest, "missing_packages", return_value=[]), \
             patch.object(guest.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(guest.Path, "is_file", return_value=True), \
             patch.object(guest, "run", return_value=False) as run:
            self.assertEqual(guest.prepare(), "dependencyCheckFailed")
            self.assertTrue(all("apt-get" not in call.args[0][0]
                                for call in run.call_args_list))

    def test_an_installed_package_inventory_cannot_hide_a_missing_runtime_command(self):
        for missing in ("vncconfig", "gdbus"):
            with self.subTest(missing=missing), \
                 patch.object(guest.os, "geteuid", return_value=0), \
                 patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
                 patch.object(guest.platform, "machine", return_value="x86_64"), \
                 patch.object(guest, "missing_packages", return_value=[]), \
                 patch.object(guest.shutil, "which", side_effect=lambda name, **kwargs:
                              None if name == missing else "/usr/bin/tool"), \
                 patch.object(guest, "run") as run:
                self.assertEqual(guest.prepare(), "dependencyCheckFailed")
                run.assert_not_called()

    def test_partial_package_inventory_only_installs_missing_or_unconfigured_packages(self):
        present, incomplete, absent = guest.PACKAGES[:3]
        inventory = "".join(f"{package}\tinstalled\n" for package in guest.PACKAGES
                            if package not in (incomplete, absent))
        inventory += f"{incomplete}\tunpacked\n"
        result = types.SimpleNamespace(returncode=1, stdout=inventory.encode("ascii"))
        with patch.object(guest.subprocess, "run", return_value=result) as run:
            self.assertEqual(guest.missing_packages(), [incomplete, absent])
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[0], "/usr/bin/dpkg-query")
            self.assertIn(present, arguments)
            self.assertEqual(run.call_args.kwargs["env"], guest.ENV)
            self.assertIs(run.call_args.kwargs["stderr"], guest.subprocess.DEVNULL)

    def test_invalid_package_inventory_never_reaches_apt_or_leaks_output(self):
        inventories = [b"unexpected-package\tinstalled\n", b"invalid-row\n",
                       (f"{guest.PACKAGES[0]}\tinstalled\n" * 2).encode("ascii"),
                       b"", f"{guest.PACKAGES[0]}\tunknown-state\n".encode("ascii")]
        for inventory in inventories:
            with self.subTest(inventory=inventory), \
                 patch.object(guest.os, "geteuid", return_value=0), \
                 patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
                 patch.object(guest.platform, "machine", return_value="x86_64"), \
                 patch.object(guest.subprocess, "run", return_value=types.SimpleNamespace(
                     returncode=0, stdout=inventory)) as run:
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(guest.main(), 1)
                self.assertEqual(output.getvalue(), "LIME_DESKTOP_PREPARE_V1:preparationFailed\n")
                self.assertEqual(run.call_count, 1)

    def test_successful_installation_still_requires_package_and_runtime_checks(self):
        for remaining, usable in [(["xfce4-session"], True), ([], False)]:
            with self.subTest(remaining=remaining, usable=usable), \
                 patch.object(guest.os, "geteuid", return_value=0), \
                 patch.object(guest.Path, "read_text", return_value="ID=ubuntu\nVERSION_ID=24.04"), \
                 patch.object(guest.platform, "machine", return_value="x86_64"), \
                 patch.object(guest.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8*1024**3)), \
                 patch.object(guest, "missing_packages", side_effect=[["xfce4-session"], remaining]), \
                 patch.object(guest, "dependencies_ready", return_value=usable), \
                 patch.object(guest, "run", return_value=True):
                self.assertEqual(guest.prepare(), "dependencyCheckFailed")

    def test_raw_failure_is_not_written_to_cloud_assistant_output(self):
        with patch.object(guest, "prepare", side_effect=OSError("secret=must-not-leak")):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(guest.main(), 1)
            self.assertEqual(output.getvalue(), "LIME_DESKTOP_PREPARE_V1:preparationFailed\n")

    def test_apt_receives_a_fixed_noninteractive_environment(self):
        with patch.object(guest.subprocess, "run", return_value=types.SimpleNamespace(returncode=0)) as run:
            self.assertTrue(guest.run(["/usr/bin/apt-get", "update"], 240))
            self.assertEqual(run.call_args.kwargs["env"], guest.ENV)
            self.assertEqual(run.call_args.kwargs["env"]["NEEDRESTART_MODE"], "l")
            self.assertEqual(run.call_args.kwargs["stdout"], guest.subprocess.DEVNULL)
            self.assertEqual(run.call_args.kwargs["stderr"], guest.subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
