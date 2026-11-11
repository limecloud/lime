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
             patch.object(guest, "run", return_value=True) as run:
            self.assertEqual(guest.prepare(), "ready")
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(len(commands), 3)
            self.assertEqual(commands[0][-1], "update")
            self.assertIn("--no-install-recommends", commands[1])
            self.assertIn("xfce4-screensaver", commands[1])
            self.assertIn("Dpkg::Options::=--force-confold", commands[1])
            self.assertEqual(commands[2], ["/usr/bin/python3", "-I", "-c", "import Xlib, PIL"])
            self.assertTrue(all("upgrade" not in command for command in commands))

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
