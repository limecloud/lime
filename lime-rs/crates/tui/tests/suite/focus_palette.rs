use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const FOCUS_INPUT_TIMEOUT: Duration = Duration::from_secs(5);
const RESIZE_EVENT_TIMEOUT: Duration = Duration::from_secs(5);
const FOCUS_PROBE_INPUT: &str = "focus-palette-24527";

#[derive(Clone, Copy)]
enum StartMode<'a> {
    Tui,
    Resume(&'a str),
    RemoteResume(&'a str, &'a str),
}

#[test]
fn focus_gained_with_unanswered_palette_queries_preserves_immediate_input() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return Ok(());
    }

    let cli_bin = required_test_path("LIME_TEST_CLI_BIN");
    let app_server_bin = required_test_path("LIME_TEST_APP_SERVER_BIN");
    let backend_path = required_test_path("LIME_TEST_TERMINAL_BACKEND");
    let ledger_path = required_test_path("LIME_TEST_TERMINAL_LEDGER");
    let cwd = required_test_path("LIME_TEST_TERMINAL_CWD");
    let node_bin = required_test_path("LIME_TEST_NODE_BIN");
    let mut terminal = PtyLime::start(
        &cli_bin,
        &app_server_bin,
        &backend_path,
        &ledger_path,
        &cwd,
        &node_bin,
    )?;
    terminal.wait_for_startup()?;

    let startup_output_len = terminal.output.len();
    ensure!(
        count_bytes(&terminal.output, b"\x1b]10;?") == 1,
        "startup foreground palette query was not issued exactly once"
    );
    ensure!(
        count_bytes(&terminal.output, b"\x1b]11;?") == 1,
        "startup background palette query was not issued exactly once"
    );
    let focus_started = Instant::now();
    terminal.write_input(format!("\u{1b}[I{FOCUS_PROBE_INPUT}").as_bytes())?;
    terminal.wait_for_focus_input(FOCUS_PROBE_INPUT, focus_started, startup_output_len)?;

    let delayed_input = format!("{FOCUS_PROBE_INPUT}-delayed");
    let delayed_focus_started = Instant::now();
    terminal.write_input(b"\x1b[I")?;
    terminal.read_output(Duration::from_millis(20))?;
    terminal.write_input(delayed_input.as_bytes())?;
    terminal.wait_for_focus_input(&delayed_input, delayed_focus_started, startup_output_len)?;

    // Ctrl-U clears the focus probe text from the composer. Wait for that edit to be
    // rendered before sending Ctrl-D so the two key events cannot race the PTY redraw.
    terminal.write_input(&[21])?;
    terminal.wait_for_screen_without(FOCUS_PROBE_INPUT, FOCUS_INPUT_TIMEOUT)?;
    terminal.write_input(&[4])?;
    terminal.wait_for_exit()?;
    ensure!(
        contains_bytes(&terminal.output, b"\x1b[?1049l"),
        "alternate screen was not restored after focus palette test"
    );
    Ok(())
}

pub(super) struct PtyLime {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    reader: std::sync::mpsc::Receiver<Vec<u8>>,
    output: Vec<u8>,
    parser: vt100::Parser,
    cursor_answered: bool,
    palette_answered: bool,
}

impl PtyLime {
    pub(super) fn start(
        cli_bin: &Path,
        app_server_bin: &Path,
        backend_path: &Path,
        ledger_path: &Path,
        cwd: &Path,
        node_bin: &Path,
    ) -> Result<Self> {
        Self::start_with_mode(
            cli_bin,
            app_server_bin,
            backend_path,
            ledger_path,
            cwd,
            node_bin,
            StartMode::Tui,
        )
    }

    pub(super) fn start_resume(
        cli_bin: &Path,
        app_server_bin: &Path,
        backend_path: &Path,
        ledger_path: &Path,
        cwd: &Path,
        node_bin: &Path,
        thread_id: &str,
    ) -> Result<Self> {
        Self::start_with_mode(
            cli_bin,
            app_server_bin,
            backend_path,
            ledger_path,
            cwd,
            node_bin,
            StartMode::Resume(thread_id),
        )
    }

    pub(super) fn start_remote_resume(
        cli_bin: &Path,
        remote_url: &str,
        cwd: &Path,
        thread_id: &str,
    ) -> Result<Self> {
        Self::start_with_mode(
            cli_bin,
            Path::new("app-server"),
            Path::new("backend.mjs"),
            Path::new("ledger.jsonl"),
            cwd,
            Path::new("node"),
            StartMode::RemoteResume(remote_url, thread_id),
        )
    }

    fn start_with_mode(
        cli_bin: &Path,
        app_server_bin: &Path,
        backend_path: &Path,
        ledger_path: &Path,
        cwd: &Path,
        node_bin: &Path,
        mode: StartMode<'_>,
    ) -> Result<Self> {
        let pair = native_pty_system().openpty(PtySize {
            rows: 32,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut command = CommandBuilder::new(cli_bin);
        let mut arguments = Vec::new();
        let remote = match mode {
            StartMode::Tui => {
                arguments.push(OsString::from("tui"));
                false
            }
            StartMode::Resume(thread_id) => {
                arguments.push(OsString::from("resume"));
                arguments.push(OsString::from(thread_id));
                false
            }
            StartMode::RemoteResume(remote_url, thread_id) => {
                arguments.extend([
                    OsString::from("resume"),
                    OsString::from(thread_id),
                    OsString::from("--remote"),
                    OsString::from(remote_url),
                ]);
                true
            }
        };
        arguments.extend([
            OsString::from("--cd"),
            cwd.as_os_str().to_os_string(),
            OsString::from("--model"),
            OsString::from("fixture-model"),
            OsString::from("--provider"),
            OsString::from("fixture-provider"),
        ]);
        if !remote {
            arguments.extend([
                OsString::from("--app-server"),
                app_server_bin.as_os_str().to_os_string(),
                OsString::from("--app-server-arg=--backend"),
                OsString::from("--app-server-arg=external"),
                OsString::from("--app-server-arg=--backend-command"),
                OsString::from(format!("--app-server-arg={}", node_bin.display())),
                OsString::from("--app-server-arg=--backend-arg"),
                OsString::from(format!("--app-server-arg={}", backend_path.display())),
                OsString::from("--app-server-arg=--backend-arg"),
                OsString::from(format!("--app-server-arg={}", ledger_path.display())),
                OsString::from("--app-server-arg=--backend-timeout-ms"),
                OsString::from("--app-server-arg=5000"),
                OsString::from("--app-server-arg=--data-dir"),
                OsString::from(format!("--app-server-arg={}", cwd.join("data").display())),
                OsString::from("--app-server-arg=--app-data-dir"),
                OsString::from(format!(
                    "--app-server-arg={}",
                    cwd.join("app-data").display()
                )),
            ]);
        }
        for argument in arguments {
            command.arg(argument);
        }
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("LIME_LOCALE", "en-US");
        if let Some(runtime_path) = std::env::var_os("LIME_TEST_DYLD_LIBRARY_PATH") {
            command.env("DYLD_LIBRARY_PATH", runtime_path);
        }

        let child = pair.slave.spawn_command(command)?;
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (output_tx, output_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if output_tx.send(buffer[..read].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        let _ = output_tx.send(format!("PTY_READER_ERROR: {error}\n").into_bytes());
                        break;
                    }
                }
            }
        });

        Ok(Self {
            master: pair.master,
            writer,
            child,
            reader: output_rx,
            output: Vec::new(),
            parser: vt100::Parser::new(32, 120, 0),
            cursor_answered: false,
            palette_answered: false,
        })
    }

    pub(super) fn wait_for_startup(&mut self) -> Result<()> {
        self.wait_for_startup_with_timeout(STARTUP_TIMEOUT)
    }

    pub(super) fn wait_for_startup_with_timeout(&mut self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            self.read_output(Duration::from_millis(50))?;
            self.answer_startup_queries()?;
            if self.palette_answered && self.screen_contains("Ask Lime to do anything") {
                return Ok(());
            }
            if let Some(status) = self.child.try_wait()? {
                bail!(
                    "Lime exited before focus test started ({status:?}); screen:\n{}\nraw output:\n{}",
                    self.screen_contents(),
                    String::from_utf8_lossy(&self.output)
                );
            }
        }
        bail!(
            "Lime did not initialize within {timeout:?}; screen:\n{}",
            self.screen_contents()
        )
    }

    fn wait_for_focus_input(
        &mut self,
        input: &str,
        focus_started: Instant,
        startup_output_len: usize,
    ) -> Result<()> {
        while focus_started.elapsed() < FOCUS_INPUT_TIMEOUT {
            self.read_output(Duration::from_millis(20))?;
            let focus_output = &self.output[startup_output_len..];
            ensure!(
                !contains_bytes(focus_output, b"\x1b]10;?")
                    && !contains_bytes(focus_output, b"\x1b]11;?"),
                "focus regain queried terminal colors after startup palette was cached"
            );
            if self.screen_contains(input) {
                return Ok(());
            }
        }
        bail!(
            "focus-time input {input:?} was not visible within {FOCUS_INPUT_TIMEOUT:?}; screen:\n{}",
            self.screen_contents()
        )
    }

    fn answer_startup_queries(&mut self) -> Result<()> {
        if !self.cursor_answered && contains_bytes(&self.output, b"\x1b[6n") {
            self.write_input(b"\x1b[1;1R")?;
            self.cursor_answered = true;
        }
        if !self.palette_answered
            && contains_bytes(&self.output, b"\x1b]10;?")
            && contains_bytes(&self.output, b"\x1b]11;?")
        {
            self.write_input(b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\\x1b]11;rgb:0000/0000/0000\x1b\\")?;
            self.palette_answered = true;
        }
        Ok(())
    }

    pub(super) fn read_output(&mut self, timeout: Duration) -> Result<()> {
        if let Ok(chunk) = self.reader.recv_timeout(timeout) {
            self.output.extend_from_slice(&chunk);
            self.parser.process(&chunk);
        }
        Ok(())
    }

    pub(super) fn write_input(&mut self, bytes: &[u8]) -> Result<()> {
        self.writer.write_all(bytes)?;
        self.writer.flush()?;
        Ok(())
    }

    pub(super) fn write_typed_input(&mut self, bytes: &[u8]) -> Result<()> {
        for byte in bytes {
            self.writer.write_all(std::slice::from_ref(byte))?;
            self.writer.flush()?;
            std::thread::sleep(Duration::from_millis(24));
        }
        Ok(())
    }

    pub(super) fn wait_for_exit(&mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.child.try_wait()?.is_some() {
                // Process exit can precede delivery of the reader thread's final PTY chunk.
                // Drain to EOF before assertions inspect terminal-restoration sequences.
                while Instant::now() < deadline {
                    match self.reader.recv_timeout(Duration::from_millis(20)) {
                        Ok(chunk) => {
                            self.output.extend_from_slice(&chunk);
                            self.parser.process(&chunk);
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
                break;
            }
            self.read_output(Duration::from_millis(20))?;
        }
        bail!(
            "Lime did not exit within 5s; alternate_screen_restored={}; screen:\n{}",
            contains_bytes(&self.output, b"\x1b[?1049l"),
            self.screen_contents()
        )
    }

    pub(super) fn screen_contains(&self, text: &str) -> bool {
        self.parser.screen().contents().contains(text)
    }

    pub(super) fn screen_contents(&self) -> String {
        self.parser.screen().contents()
    }

    pub(super) fn resize(&mut self, rows: u16, cols: u16) -> Result<()> {
        let output_len = self.output.len();
        // The terminal adopts its new geometry before the application can repaint. Parsing
        // that repaint at the old size clamps cursor moves and wraps text into stale rows.
        self.parser.screen_mut().set_size(rows, cols);
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let deadline = Instant::now() + RESIZE_EVENT_TIMEOUT;
        while Instant::now() < deadline {
            self.read_output(Duration::from_millis(20))?;
            if self.output.len() > output_len {
                return Ok(());
            }
        }
        bail!(
            "TUI did not render resize {rows}x{cols} within {RESIZE_EVENT_TIMEOUT:?}; screen:\n{}",
            self.screen_contents()
        )
    }

    pub(super) fn wait_for_screen_compact_contains(
        &mut self,
        text: &str,
        timeout: Duration,
    ) -> Result<()> {
        let expected = compact_text(text);
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if compact_text(&self.screen_contents()).contains(&expected) {
                return Ok(());
            }
            self.read_output(Duration::from_millis(20))?;
        }
        bail!(
            "terminal did not render compact text {text:?} within {timeout:?}; screen:\n{}",
            self.screen_contents()
        )
    }

    pub(super) fn wait_for_screen_without(&mut self, text: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !self.screen_contains(text) {
                return Ok(());
            }
            self.read_output(Duration::from_millis(20))?;
        }
        bail!(
            "terminal still rendered {text:?} after {timeout:?}; screen:\n{}",
            self.screen_contents()
        )
    }

    pub(super) fn screen_size(&self) -> (u16, u16) {
        self.parser.screen().size()
    }

    pub(super) fn output_contains(&self, needle: &[u8]) -> bool {
        contains_bytes(&self.output, needle)
    }
}

impl Drop for PtyLime {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = &self.master;
    }
}

pub(super) fn required_test_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn contains_bytes(buffer: &[u8], needle: &[u8]) -> bool {
    buffer.windows(needle.len()).any(|window| window == needle)
}

fn count_bytes(buffer: &[u8], needle: &[u8]) -> usize {
    buffer
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count()
}

fn compact_text(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
