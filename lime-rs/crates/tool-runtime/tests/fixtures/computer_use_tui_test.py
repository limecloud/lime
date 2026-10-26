"""Verify the PTY evidence driver accepts restoration and rejects broken cleanup."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin", "macOS controlling terminal regression")
class TerminalRestorationTests(unittest.TestCase):
    def run_terminal(self, restore):
        command = """
import os, sys, termios, tty
before = termios.tcgetattr(0)
tty.setraw(0)
os.write(1, b'\\x1b[?1049hAsk Lime to do anything')
while b'\\r' not in os.read(0, 4096):
    pass
os.write(1, b'FIXTURE_DONE')
while b'\\x03' not in os.read(0, 4096):
    pass
if sys.argv[1] == 'restore':
    termios.tcsetattr(0, termios.TCSANOW, before)
os.write(1, b'\\x1b[?1049l')
"""
        with tempfile.TemporaryDirectory(prefix="lime-wps-pty-check-") as root:
            return subprocess.run(
                [sys.executable, str(Path(__file__).with_name("computer_use_tui.py")),
                 json.dumps([sys.executable, "-c", command, "restore" if restore else "broken"]),
                 "isolated terminal input", "FIXTURE_DONE", str(Path(root) / "terminal.log")],
                capture_output=True, text=True, timeout=10,
            )

    def test_restored_terminal_is_read_before_session_leader_exits(self):
        result = self.run_terminal(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        evidence = json.loads(result.stdout)
        self.assertTrue(evidence["terminalModeRestored"])
        self.assertTrue(evidence["alternateScreenRestored"])

    def test_missing_terminal_restoration_is_rejected(self):
        result = self.run_terminal(False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("'terminalModeRestored': False", result.stderr)


if __name__ == "__main__":
    unittest.main()
