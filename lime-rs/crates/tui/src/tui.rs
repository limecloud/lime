use std::future::Future;
use std::io::{self, stdout, Stdout, Write};
use std::panic;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Once;
use std::time::Duration;

use crossterm::cursor::{SetCursorStyle, Show};
#[cfg(not(windows))]
use crossterm::event::EnableFocusChange;
use crossterm::event::{
    DisableBracketedPaste, DisableFocusChange, DisableMouseCapture, EnableBracketedPaste,
    EnableMouseCapture, KeyEvent, MouseEvent,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::SynchronizedUpdate;
use ratatui::backend::Backend;
use ratatui::backend::CrosstermBackend;
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Size};
use ratatui::Terminal as RatatuiTerminal;
use tokio::sync::broadcast;

use crate::terminal_title::{clear_terminal_title, ManagedTerminalTitle};
use crate::viewport::ViewportState;

pub(crate) mod event_stream;
mod frame_rate_limiter;
mod frame_requester;
#[cfg(any(windows, test))]
mod windows_console;
#[cfg(any(windows, test))]
mod windows_key_sequence;

pub(crate) use event_stream::{EventBroker, TuiEventStream};
pub(crate) use frame_requester::FrameRequester;

pub(crate) const TARGET_FRAME_INTERVAL: Duration = frame_rate_limiter::MIN_FRAME_INTERVAL;

/// Normalized events consumed by the TUI runtime.
#[derive(Debug, Clone)]
pub enum TuiEvent {
    Key(KeyEvent),
    Paste(String),
    Mouse(MouseEvent),
    Resize(ratatui::layout::Size),
    Draw,
    #[allow(dead_code)]
    Resume,
    FocusGained,
    FocusLost,
}

pub(crate) type Terminal = RatatuiTerminal<CrosstermBackend<Stdout>>;

#[derive(Clone, Copy)]
pub(crate) enum TerminalHandoff {
    Restore,
    KeepScreen,
}

fn repaint_visible_frame(frame: &mut ratatui::Frame<'_>, visible_frame: &Buffer) {
    let area = frame.area().intersection(visible_frame.area);
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            frame.buffer_mut()[(x, y)] = visible_frame[(x, y)].clone();
        }
    }
}

static PANIC_HOOK: Once = Once::new();
static TERMINAL_ACTIVE: AtomicBool = AtomicBool::new(false);
// The panic hook retains only ownership, never a second copy of the title or business state.
static TERMINAL_TITLE_ACTIVE: AtomicBool = AtomicBool::new(false);

fn clear_title_after_panic(output: &mut impl Write) -> io::Result<()> {
    if TERMINAL_TITLE_ACTIVE.load(Ordering::Acquire) {
        clear_terminal_title(output)?;
        TERMINAL_TITLE_ACTIVE.store(false, Ordering::Release);
    }
    Ok(())
}

fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(move |panic_info| {
            if TERMINAL_ACTIVE.swap(false, Ordering::AcqRel) {
                let _ = restore_terminal_state();
            }
            previous(panic_info);
        }));
    });
}

fn restore_terminal_state() -> io::Result<()> {
    let mut output = stdout();
    let mut first_error = crossterm::execute!(output, SetCursorStyle::DefaultUserShape, Show).err();
    if let Err(error) = clear_title_after_panic(&mut output) {
        first_error.get_or_insert(error);
    }
    if let Err(error) = crossterm::execute!(
        output,
        DisableBracketedPaste,
        DisableFocusChange,
        DisableMouseCapture,
        LeaveAlternateScreen
    ) {
        first_error.get_or_insert(error);
    }
    if let Err(error) = disable_raw_mode() {
        first_error.get_or_insert(error);
    }
    #[cfg(windows)]
    if let Err(error) = windows_console::restore_input_mode() {
        first_error.get_or_insert(error);
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn set_modes() -> io::Result<()> {
    #[cfg(not(windows))]
    execute!(
        stdout(),
        EnableBracketedPaste,
        EnableFocusChange,
        EnableMouseCapture
    )?;
    #[cfg(windows)]
    execute!(stdout(), EnableBracketedPaste, EnableMouseCapture)?;
    enable_raw_mode()?;
    #[cfg(windows)]
    windows_console::set_input_record_mode()?;
    Ok(())
}

fn restore_keep_raw() -> io::Result<()> {
    let mut output = stdout();
    let mut first_error = execute!(
        output,
        DisableBracketedPaste,
        DisableFocusChange,
        DisableMouseCapture
    )
    .err();
    if let Err(error) = execute!(output, SetCursorStyle::DefaultUserShape, Show) {
        first_error.get_or_insert(error);
    }
    #[cfg(windows)]
    if let Err(error) = windows_console::restore_input_mode() {
        first_error.get_or_insert(error);
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn cleanup_failed_enter(output: &mut Stdout) {
    // `execute!` may fail after an earlier command already changed terminal state. Keep each
    // cleanup independent so one unsupported mode does not prevent the remaining restoration.
    let _ = execute!(output, DisableBracketedPaste);
    #[cfg(not(windows))]
    let _ = execute!(output, DisableFocusChange);
    let _ = execute!(output, DisableMouseCapture);
    let _ = execute!(output, SetCursorStyle::DefaultUserShape, Show);
    let _ = execute!(output, LeaveAlternateScreen);
    let _ = disable_raw_mode();
    #[cfg(windows)]
    let _ = windows_console::restore_input_mode();
}

#[cfg(unix)]
fn flush_terminal_input_buffer() {
    // SAFETY: flushing the stdin input queue does not transfer ownership.
    let result = unsafe { libc::tcflush(libc::STDIN_FILENO, libc::TCIFLUSH) };
    if result != 0 {
        tracing::warn!(
            error = %io::Error::last_os_error(),
            "failed to flush terminal input buffer"
        );
    }
}

#[cfg(windows)]
fn flush_terminal_input_buffer() {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Console::{
        FlushConsoleInputBuffer, GetStdHandle, STD_INPUT_HANDLE,
    };

    unsafe {
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        if handle != 0 && handle != INVALID_HANDLE_VALUE && FlushConsoleInputBuffer(handle) == 0 {
            tracing::warn!("failed to flush terminal input buffer");
        }
    }
}

#[cfg(not(any(unix, windows)))]
fn flush_terminal_input_buffer() {}

pub(crate) struct Tui {
    terminal: Terminal,
    visible_frame: Option<Buffer>,
    terminal_title: ManagedTerminalTitle,
    viewport: ViewportState,
    restored: bool,
    event_broker: Arc<EventBroker>,
    draw_tx: broadcast::Sender<()>,
    frame_requester: FrameRequester,
    terminal_focused: Arc<AtomicBool>,
    pub(crate) clipboard: crate::clipboard_paste::worker::ClipboardWorker,
    pub(crate) clipboard_copy: crate::clipboard_copy::worker::ClipboardWorker,
}

impl Tui {
    pub(crate) fn enter() -> io::Result<Self> {
        install_panic_hook();
        enable_raw_mode()?;
        #[cfg(windows)]
        if let Err(error) = windows_console::set_input_record_mode() {
            let _ = disable_raw_mode();
            return Err(error);
        }
        let mut output = stdout();
        #[cfg(not(windows))]
        let mode_result = execute!(
            output,
            EnterAlternateScreen,
            EnableBracketedPaste,
            EnableFocusChange,
            EnableMouseCapture
        );
        #[cfg(windows)]
        let mode_result = execute!(
            output,
            EnterAlternateScreen,
            EnableBracketedPaste,
            EnableMouseCapture
        );
        if let Err(error) = mode_result {
            cleanup_failed_enter(&mut output);
            return Err(error);
        }
        let terminal = match RatatuiTerminal::new(CrosstermBackend::new(output)) {
            Ok(terminal) => terminal,
            Err(error) => {
                let mut output = stdout();
                cleanup_failed_enter(&mut output);
                return Err(error);
            }
        };
        let size = match terminal.size() {
            Ok(size) => size,
            Err(error) => {
                let mut output = stdout();
                cleanup_failed_enter(&mut output);
                return Err(error);
            }
        };
        #[cfg(unix)]
        let startup_probe = match crate::terminal_probe::startup(
            crate::terminal_probe::DEFAULT_TIMEOUT,
            crate::terminal_probe::StartupKeyboardEnhancementProbe::Skip,
        ) {
            Ok(probe) => {
                tracing::debug!(
                    cursor_position = probe.cursor_position.is_some(),
                    default_colors = probe.default_colors.is_some(),
                    "terminal startup probes completed"
                );
                probe
            }
            Err(error) => {
                tracing::debug!(%error, "terminal startup probes unavailable");
                crate::terminal_probe::StartupProbe {
                    cursor_position: None,
                    default_colors: None,
                    keyboard_enhancement_supported: None,
                }
            }
        };
        #[cfg(unix)]
        crate::terminal_palette::set_default_colors_from_startup_probe(
            startup_probe.default_colors,
        );
        #[cfg(windows)]
        crate::terminal_palette::set_default_colors_from_startup_probe(
            crate::terminal_probe::default_colors(crate::terminal_probe::DEFAULT_TIMEOUT)
                .ok()
                .flatten(),
        );
        let mut viewport = ViewportState::new(size, {
            #[cfg(unix)]
            {
                startup_probe.cursor_position.unwrap_or(Position::ORIGIN)
            }
            #[cfg(not(unix))]
            {
                Position::ORIGIN
            }
        });
        viewport.enter_alternate_screen(size);
        let event_broker = Arc::new(EventBroker::new());
        let (draw_tx, _) = broadcast::channel(8);
        let frame_requester = FrameRequester::new(draw_tx.clone());
        let terminal_focused = Arc::new(AtomicBool::new(true));
        TERMINAL_ACTIVE.store(true, Ordering::Release);
        Ok(Self {
            terminal,
            visible_frame: None,
            terminal_title: ManagedTerminalTitle::default(),
            viewport,
            restored: false,
            event_broker,
            draw_tx,
            frame_requester,
            terminal_focused,
            clipboard: crate::clipboard_paste::worker::ClipboardWorker::default(),
            clipboard_copy: crate::clipboard_copy::worker::ClipboardWorker::default(),
        })
    }

    pub(crate) fn terminal_mut(&mut self) -> &mut Terminal {
        &mut self.terminal
    }

    /// Apply focused cursor and title presentation through the same host as frame drawing.
    pub(crate) fn draw(
        &mut self,
        cursor_style: SetCursorStyle,
        terminal_title: Option<&str>,
        render: impl FnOnce(&mut ratatui::Frame<'_>),
    ) -> io::Result<()> {
        self.sync_viewport()?;
        self.terminal.draw(render)?;
        execute!(self.terminal.backend_mut(), cursor_style)?;
        // A tab-title failure must not stop the canonical conversation or frame drawing.
        if let Err(error) = self.refresh_terminal_title(terminal_title) {
            tracing::debug!(%error, "failed to refresh terminal title");
        }
        Ok(())
    }

    /// Capture only the frame needed for the next terminal handoff through the normal renderer.
    pub(crate) fn draw_for_handoff(
        &mut self,
        cursor_style: SetCursorStyle,
        terminal_title: Option<&str>,
        render: impl FnOnce(&mut ratatui::Frame<'_>),
    ) -> io::Result<()> {
        self.visible_frame = None;
        let mut visible_frame = None;
        self.draw(cursor_style, terminal_title, |frame| {
            render(frame);
            visible_frame = Some(frame.buffer_mut().clone());
        })?;
        self.visible_frame = visible_frame;
        Ok(())
    }

    fn refresh_terminal_title(&mut self, title: Option<&str>) -> io::Result<()> {
        let result = self
            .terminal_title
            .refresh(self.terminal.backend_mut(), title);
        TERMINAL_TITLE_ACTIVE.store(self.terminal_title.is_managed(), Ordering::Release);
        result
    }

    pub(crate) fn screen_size(&self) -> Size {
        self.terminal
            .size()
            .unwrap_or_else(|_| self.viewport.area().as_size())
    }

    pub(crate) fn last_known_cursor_position(&mut self) -> Position {
        self.terminal
            .backend_mut()
            .get_cursor_position()
            .unwrap_or(Position::ORIGIN)
    }

    pub(crate) fn write_ansi(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.terminal.backend_mut().write_all(bytes)
    }

    pub(crate) fn set_viewport_area(&mut self, area: ratatui::layout::Rect) {
        self.viewport.set_viewport_area(area);
    }

    pub(crate) fn note_history_rows_inserted(&mut self, rows: u16) {
        self.viewport.note_history_rows_inserted(rows);
    }

    pub(crate) fn update_viewport(&mut self, screen_size: Size, content_height: u16) {
        self.viewport.update_inline(screen_size, content_height);
    }

    pub(crate) fn sync_viewport(&mut self) -> io::Result<()> {
        let screen_size = self.terminal.size()?;
        self.update_viewport(screen_size, screen_size.height);
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn viewport_area(&self) -> ratatui::layout::Rect {
        self.viewport.area()
    }

    pub(crate) fn event_stream(&self) -> TuiEventStream {
        TuiEventStream::new(
            self.event_broker.clone(),
            self.draw_tx.subscribe(),
            self.terminal_focused.clone(),
        )
    }

    pub(crate) fn frame_requester(&self) -> FrameRequester {
        self.frame_requester.clone()
    }

    pub(crate) fn pause_events(&self) {
        self.event_broker.pause_events();
    }

    pub(crate) fn resume_events(&self) {
        self.event_broker.resume_events();
    }

    #[allow(dead_code)]
    pub(crate) fn is_terminal_focused(&self) -> bool {
        self.terminal_focused
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Temporarily restore terminal state while an external interactive program runs.
    pub(crate) async fn with_restored<R, F, Fut>(&mut self, handoff: TerminalHandoff, f: F) -> R
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = R>,
    {
        self.pause_events();

        if let Err(error) = self.refresh_terminal_title(None) {
            tracing::debug!(%error, "failed to clear terminal title before external program");
        }

        let was_alt_screen = self.viewport.is_alt_screen_active();
        let handoff = if was_alt_screen {
            handoff
        } else {
            TerminalHandoff::Restore
        };
        let visible_frame = self
            .visible_frame
            .take()
            .filter(|_| matches!(handoff, TerminalHandoff::KeepScreen));
        let restore_result = if let Some(visible_frame) = visible_frame {
            stdout()
                .sync_update(|_| {
                    // Restore input on both screens, then leave the captured surface visible.
                    let leave_result = self.leave_alt_screen();
                    let main_result = restore_keep_raw();
                    let enter_result = self.enter_alt_screen();
                    let draw_result = if enter_result.is_ok() {
                        self.terminal
                            .draw(|frame| repaint_visible_frame(frame, &visible_frame))
                            .map(|_| ())
                    } else {
                        Ok(())
                    };
                    let input_result = restore_keep_raw();
                    leave_result
                        .and(main_result)
                        .and(enter_result)
                        .and(draw_result)
                        .and(input_result)
                })
                .and_then(std::convert::identity)
        } else {
            if was_alt_screen {
                let _ = self.leave_alt_screen();
            }
            restore_keep_raw()
        };
        if let Err(error) = restore_result {
            tracing::warn!(%error, "failed to restore terminal modes before external program");
        }

        let output = f().await;

        if was_alt_screen && matches!(handoff, TerminalHandoff::KeepScreen) {
            // The editor may have already left the alternate screen; restore main input first.
            let _ = self.leave_alt_screen();
        }

        if let Err(error) = set_modes() {
            tracing::warn!(%error, "failed to re-enable terminal modes after external program");
        }
        flush_terminal_input_buffer();

        if was_alt_screen {
            let _ = self.enter_alt_screen();
        }

        self.resume_events();
        self.frame_requester.schedule_frame();
        output
    }

    pub(crate) fn restore(&mut self) -> io::Result<()> {
        if self.restored {
            return Ok(());
        }
        self.restored = true;
        self.event_broker.pause_events();
        TERMINAL_ACTIVE.store(false, Ordering::Release);
        let mut first_error = execute!(
            self.terminal.backend_mut(),
            SetCursorStyle::DefaultUserShape,
            Show
        )
        .err();
        if let Err(error) = self.refresh_terminal_title(None) {
            first_error.get_or_insert(error);
        }
        if let Err(error) = execute!(
            self.terminal.backend_mut(),
            DisableBracketedPaste,
            DisableFocusChange,
            DisableMouseCapture,
            LeaveAlternateScreen
        ) {
            first_error.get_or_insert(error);
        }
        self.viewport.leave_alternate_screen();
        if let Err(error) = disable_raw_mode() {
            first_error.get_or_insert(error);
        }
        #[cfg(windows)]
        if let Err(error) = windows_console::restore_input_mode() {
            first_error.get_or_insert(error);
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    #[allow(dead_code)]
    /// Enter alternate screen and expand the viewport to full terminal size, saving the current
    /// inline viewport for restoration when leaving.
    pub(crate) fn enter_alt_screen(&mut self) -> io::Result<()> {
        execute!(
            self.terminal.backend_mut(),
            EnterAlternateScreen,
            EnableMouseCapture
        )?;
        if let Ok(size) = self.terminal.size() {
            self.viewport.enter_alternate_screen(size);
            self.terminal
                .resize(ratatui::layout::Rect::new(0, 0, size.width, size.height))?;
        }
        Ok(())
    }

    /// Leave alternate screen and restore the previously saved inline viewport, if any.
    pub(crate) fn leave_alt_screen(&mut self) -> io::Result<()> {
        execute!(
            self.terminal.backend_mut(),
            DisableMouseCapture,
            LeaveAlternateScreen
        )?;
        self.viewport.leave_alternate_screen();
        Ok(())
    }
}

impl Drop for Tui {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

#[cfg(test)]
mod tests;
