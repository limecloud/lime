#!/usr/bin/env python3
"""Drive only an isolated Lime TUI; WPS input remains owned by product tools."""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

argv, prompt, marker, transcript = json.loads(sys.argv[1]), *sys.argv[2:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 160, 0, 0))
before = termios.tcgetattr(slave)

def terminal_session():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)

child = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave,
                         env={**os.environ, "TERM": "xterm-256color"},
                         preexec_fn=terminal_session)
raw = bytearray()
submitted = visible = False
exit_started = None
deadline = time.monotonic() + 100
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            raw.extend(chunk)
            # Answer only terminal capability queries, never product approvals.
            if b"\x1b[6n" in chunk:
                os.write(master, b"\x1b[1;1R")
            if b"\x1b[c" in chunk:
                os.write(master, b"\x1b[?1;2c")
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw.decode("utf-8", "replace"))
        if not submitted and "Ask Lime to do anything" in text:
            os.write(master, b"\x1b[200~" + prompt.encode() + b"\x1b[201~\r")
            submitted = True
        if submitted and marker in text and exit_started is None:
            visible = True
            exit_started = time.monotonic()
            os.write(master, b"\x03")
        if exit_started and time.monotonic() - exit_started > 0.5 and child.poll() is None:
            os.write(master, b"\x03")
            exit_started = time.monotonic()
        if child.poll() is not None:
            while select.select([master], [], [], 0.05)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                raw.extend(chunk)
            break
    if child.poll() is None:
        raise RuntimeError("real TUI did not visibly finish before deadline")
    after = termios.tcgetattr(slave)
    restored = (after[3] & (termios.ECHO | termios.ICANON)) == (before[3] & (termios.ECHO | termios.ICANON))
    result = {"pid": child.pid, "exitCode": child.returncode, "submitted": submitted,
              "visibleFinal": visible, "alternateScreenEntered": b"\x1b[?1049h" in raw,
              "alternateScreenRestored": b"\x1b[?1049l" in raw,
              "terminalModeRestored": restored, "transcriptSha256": hashlib.sha256(raw).hexdigest()}
    assert child.returncode == 0 and all(result[key] for key in
        ("submitted", "visibleFinal", "alternateScreenEntered", "alternateScreenRestored", "terminalModeRestored")), result
    print(json.dumps(result))
finally:
    Path(transcript).write_bytes(raw)
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    os.close(master)
    os.close(slave)
