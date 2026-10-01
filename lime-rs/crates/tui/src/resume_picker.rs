use anyhow::{Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    SortDirection, Thread, ThreadArchiveParams, ThreadHistoryMode, ThreadListCwdFilter,
    ThreadListParams, ThreadListResponse, ThreadSortKey, ThreadStatus, ThreadUnarchiveParams,
    ThreadUnarchiveResponse, METHOD_THREAD_ARCHIVE, METHOD_THREAD_UNARCHIVE,
};
use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use futures::StreamExt;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;
use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tokio::sync::mpsc;

use crate::app::history_ui::render_transcript_entry_lines_wrapped;
use crate::clipboard_paste::normalize_pasted_search_query;
use crate::keymap::{KeyChordMatcher, ListKeymap, TranscriptKeymap};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::pager_overlay::{PagerAction, PagerOverlay};
#[cfg(test)]
use crate::projection::EntryKind;
use crate::projection::TranscriptEntry;
use crate::runtime::{connect_session, TuiOptions};
use crate::terminal_hyperlinks::HyperlinkLine;
use crate::text_formatting::center_truncate_path;
use crate::transcript_view::TranscriptContent;
use crate::tui::{Tui, TuiEvent};
use crate::width::display_width;

mod archive;
mod page_loading;

use page_loading::{PageCursor, PageLoadMode, PaginationState};

#[path = "resume_picker_transcript_preview.rs"]
mod transcript_preview;

const MAX_THREADS: u32 = 100;
const PICKER_LIST_HORIZONTAL_INSET: u16 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) struct SessionTarget {
    pub(crate) path: Option<PathBuf>,
    pub(crate) thread_id: String,
    pub(crate) history_mode: Option<ThreadHistoryMode>,
}

#[allow(dead_code)]
impl SessionTarget {
    pub(crate) fn display_label(&self) -> String {
        self.path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| format!("thread {}", self.thread_id))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum SessionSelection {
    StartFresh,
    AgentsOverview,
    Resume(SessionTarget),
    Fork(SessionTarget),
    Exit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum SessionPickerAction {
    Resume,
    Fork,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum SessionPickerLaunchContext {
    Startup,
    ExistingSession { current_thread_id: Option<String> },
}

#[allow(dead_code)]
impl SessionPickerAction {
    pub(crate) fn title(self) -> &'static str {
        match self {
            Self::Resume => "Resume a previous session",
            Self::Fork => "Fork a previous session",
        }
    }

    pub(crate) fn action_label(self) -> &'static str {
        match self {
            Self::Resume => "resume",
            Self::Fork => "fork",
        }
    }

    pub(crate) fn selection(self, target_session: SessionTarget) -> SessionSelection {
        match self {
            Self::Resume => SessionSelection::Resume(target_session),
            Self::Fork => SessionSelection::Fork(target_session),
        }
    }
}

#[derive(Debug)]
pub(crate) struct ThreadPage {
    threads: Vec<Thread>,
    next_cursor: Option<String>,
}

fn filter_threads(mut threads: Vec<Thread>, query: &str) -> Vec<Thread> {
    threads.retain(|thread| !thread.ephemeral);
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return threads;
    }
    threads
        .into_iter()
        .filter(|thread| {
            thread
                .name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&query)
                || thread.preview.to_ascii_lowercase().contains(&query)
                || thread
                    .cwd
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains(&query)
                || thread.id.to_ascii_lowercase().contains(&query)
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PickerAction {
    None,
    Reload,
    MoveUp,
    MoveDown,
    Select,
    Archive,
    Restore,
    ToggleStatus,
    ToggleFilter,
    ToggleSort,
    ToggleDensity,
    ToggleExpanded,
    OpenTranscript,
    Cancel,
}

pub(crate) enum PickerLoadEvent {
    Threads {
        token: usize,
        result: Result<ThreadPage>,
    },
    Preview {
        thread_id: String,
        result: std::io::Result<Vec<transcript_preview::TranscriptPreviewLine>>,
    },
    Transcript {
        thread_id: String,
        result: std::io::Result<Vec<TranscriptEntry>>,
    },
    Archive {
        thread_id: String,
        result: Result<()>,
    },
    Unarchive {
        thread_id: String,
        result: Box<Result<ThreadUnarchiveResponse>>,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum SessionStatus {
    #[default]
    Active,
    Archived,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum SessionListDensity {
    #[default]
    Comfortable,
    Dense,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionTranscriptState {
    Loading,
    Loaded(Vec<TranscriptEntry>),
    Failed,
}

#[derive(Debug)]
struct PickerTranscriptPager {
    thread_id: String,
    overlay: PagerOverlay,
}

impl PickerTranscriptPager {
    fn new(thread_id: String, locale: Locale, keymap: TranscriptKeymap) -> Self {
        Self {
            thread_id,
            overlay: PagerOverlay::transcript(locale).with_keymap(keymap),
        }
    }
}

impl SessionListDensity {
    fn toggle(self) -> Self {
        match self {
            Self::Comfortable => Self::Dense,
            Self::Dense => Self::Comfortable,
        }
    }
}

#[derive(Debug)]
pub(crate) struct PickerState {
    action: SessionPickerAction,
    pub(crate) threads: Vec<Thread>,
    selected: usize,
    view_rows: Cell<Option<usize>>,
    pending_page_down_target: Option<usize>,
    toolbar_focus: ToolbarControl,
    query: String,
    status: SessionStatus,
    filter_cwd: Option<PathBuf>,
    show_all: bool,
    sort_key: ThreadSortKey,
    density: SessionListDensity,
    transcript_previews: HashMap<String, Vec<transcript_preview::TranscriptPreviewLine>>,
    preview_loading: HashSet<String>,
    expanded_thread_id: Option<String>,
    transcripts: HashMap<String, SessionTranscriptState>,
    transcript_pager: Option<PickerTranscriptPager>,
    pagination: PaginationState,
    seen_cursors: HashSet<String>,
    archive_state: archive::ArchiveState,
    status_message: Option<String>,
    loading: bool,
    pub(crate) load_token: usize,
    transcript_keymap: TranscriptKeymap,
    list_keymap: ListKeymap,
    list_chord_matcher: KeyChordMatcher,
    model_provider: Option<String>,
}

impl PickerState {
    pub(crate) fn new(
        threads: Vec<Thread>,
        action: SessionPickerAction,
        status: SessionStatus,
        filter_cwd: Option<PathBuf>,
        show_all: bool,
    ) -> Self {
        Self {
            action,
            threads: filter_threads(threads, ""),
            selected: 0,
            view_rows: Cell::new(None),
            pending_page_down_target: None,
            toolbar_focus: ToolbarControl::Filter,
            query: String::new(),
            status,
            filter_cwd,
            show_all,
            sort_key: ThreadSortKey::UpdatedAt,
            density: SessionListDensity::Comfortable,
            transcript_previews: HashMap::new(),
            preview_loading: HashSet::new(),
            expanded_thread_id: None,
            transcripts: HashMap::new(),
            transcript_pager: None,
            pagination: PaginationState::new(),
            seen_cursors: HashSet::new(),
            archive_state: archive::ArchiveState::Idle,
            status_message: None,
            loading: false,
            load_token: 0,
            transcript_keymap: TranscriptKeymap::default(),
            list_keymap: ListKeymap::default(),
            list_chord_matcher: KeyChordMatcher::default(),
            model_provider: None,
        }
    }

    /// Restrict history only for an explicit CLI/provider choice.
    ///
    /// When this is `None`, the App Server remains the provider-default owner and the picker
    /// intentionally sends no provider filter, matching Codex's server-default behavior.
    pub(crate) fn set_model_provider_filter(&mut self, provider: Option<String>) {
        self.model_provider = provider
            .map(|provider| provider.trim().to_string())
            .filter(|provider| !provider.is_empty());
    }

    pub(crate) fn set_transcript_keymap(&mut self, keymap: TranscriptKeymap) {
        self.transcript_keymap = keymap;
    }

    pub(crate) fn set_list_keymap(&mut self, keymap: ListKeymap) {
        self.list_keymap = keymap;
        self.list_chord_matcher.reset();
    }

    pub(crate) fn selected_thread_id(&self) -> Option<&str> {
        self.threads
            .get(self.selected)
            .map(|thread| thread.id.as_str())
    }

    pub(crate) fn set_transcript_preview(
        &mut self,
        thread_id: String,
        preview: Vec<transcript_preview::TranscriptPreviewLine>,
    ) {
        self.preview_loading.remove(&thread_id);
        self.transcript_previews.insert(thread_id, preview);
    }

    fn preview_needs_load(&self, thread_id: &str) -> bool {
        !self.transcript_previews.contains_key(thread_id)
            && !self.preview_loading.contains(thread_id)
    }

    fn mark_preview_loading(&mut self, thread_id: impl Into<String>) {
        self.preview_loading.insert(thread_id.into());
    }

    pub(crate) fn toggle_selected_expansion(&mut self) -> Option<String> {
        let thread_id = self.selected_thread_id()?.to_string();
        if self.expanded_thread_id.as_deref() == Some(thread_id.as_str()) {
            self.expanded_thread_id = None;
            return None;
        }
        self.expanded_thread_id = Some(thread_id.clone());
        if !matches!(
            self.transcripts.get(&thread_id),
            Some(SessionTranscriptState::Loaded(_))
        ) {
            self.transcripts
                .insert(thread_id.clone(), SessionTranscriptState::Loading);
            return Some(thread_id);
        }
        None
    }

    pub(crate) fn open_transcript_pager(&mut self, locale: Locale) -> Option<String> {
        let thread_id = self.selected_thread_id()?.to_string();
        let should_load = if self.transcripts.contains_key(&thread_id) {
            false
        } else {
            self.transcripts
                .insert(thread_id.clone(), SessionTranscriptState::Loading);
            true
        };
        self.transcript_pager = Some(PickerTranscriptPager::new(
            thread_id.clone(),
            locale,
            self.transcript_keymap.clone(),
        ));
        should_load.then_some(thread_id)
    }

    fn transcript_content(&self, thread_id: &str, width: u16, locale: Locale) -> TranscriptContent {
        let Some(state) = self.transcripts.get(thread_id) else {
            return TranscriptContent::from_lines(vec![HyperlinkLine::new(Line::styled(
                locale.resume_transcript_loading(),
                Style::default().fg(Color::DarkGray),
            ))]);
        };
        match state {
            SessionTranscriptState::Loading => {
                TranscriptContent::from_lines(vec![HyperlinkLine::new(Line::styled(
                    locale.resume_transcript_loading(),
                    Style::default().fg(Color::DarkGray),
                ))])
            }
            SessionTranscriptState::Failed => {
                TranscriptContent::from_lines(vec![HyperlinkLine::new(Line::styled(
                    locale.resume_transcript_failed(),
                    Style::default().fg(Color::Red),
                ))])
            }
            SessionTranscriptState::Loaded(entries) if entries.is_empty() => {
                TranscriptContent::from_lines(vec![HyperlinkLine::new(Line::styled(
                    locale.resume_transcript_empty(),
                    Style::default().fg(Color::DarkGray),
                ))])
            }
            SessionTranscriptState::Loaded(entries) => {
                let cwd = self
                    .threads
                    .iter()
                    .find(|thread| thread.id == thread_id)
                    .map(|thread| thread.cwd.as_path());
                let cwd = cwd.unwrap_or_else(|| std::path::Path::new(""));
                crate::app::history_ui::render_transcript_entries_content(
                    entries, width, locale, cwd,
                )
            }
        }
    }

    pub(crate) fn set_transcript(
        &mut self,
        thread_id: String,
        result: std::io::Result<Vec<TranscriptEntry>>,
    ) {
        self.transcripts.insert(
            thread_id,
            match result {
                Ok(entries) => SessionTranscriptState::Loaded(entries),
                Err(_) => SessionTranscriptState::Failed,
            },
        );
    }

    fn begin_load(&mut self) -> usize {
        self.load_token = self.load_token.wrapping_add(1);
        self.loading = true;
        self.status_message = None;
        self.pagination
            .start_load(self.load_token, None, PageLoadMode::StoreDefault);
        self.load_token
    }

    #[cfg(test)]
    fn apply_threads(&mut self, token: usize, threads: Vec<Thread>) {
        self.apply_thread_page(
            token,
            ThreadPage {
                threads,
                next_cursor: None,
            },
        );
    }

    pub(crate) fn apply_thread_page(&mut self, token: usize, page: ThreadPage) {
        if token != self.load_token || self.pagination.finish_load(token).is_none() {
            return;
        }
        self.loading = false;
        let page_len = page.threads.len();
        let next_cursor = page.next_cursor;
        let mut seen_thread_ids = self
            .threads
            .iter()
            .map(|thread| thread.id.clone())
            .collect::<HashSet<_>>();
        self.threads.extend(
            page.threads
                .into_iter()
                .filter(|thread| seen_thread_ids.insert(thread.id.clone())),
        );
        self.pagination
            .complete_page(next_cursor.map(PageCursor::AppServer), page_len, false);
        self.selected = self.selected.min(self.threads.len().saturating_sub(1));
        if let Some(target) = self.pending_page_down_target {
            let max_index = self.threads.len().saturating_sub(1);
            if target <= max_index || !self.has_more_pages() {
                self.selected = target.min(max_index);
                self.pending_page_down_target = None;
            }
        }
    }

    pub(crate) fn has_pending_page_down(&self) -> bool {
        self.pending_page_down_target.is_some() && self.should_load_more()
    }

    pub(crate) fn fail_thread_load(&mut self, token: usize, error: anyhow::Error) {
        if token != self.load_token {
            return;
        }
        let _ = self.pagination.finish_load(token);
        self.loading = false;
        self.status_message = Some(error.to_string());
    }

    pub(crate) fn should_load_more(&self) -> bool {
        !self.pagination.is_loading()
            && self.pagination.next_page().is_some()
            && !self.threads.is_empty()
            && (self.pending_page_down_target.is_some() || self.selected + 1 >= self.threads.len())
    }

    pub(crate) fn has_more_pages(&self) -> bool {
        self.pagination.next_page().is_some()
    }

    fn transcript_preview_text(&self, thread_id: &str) -> Option<String> {
        let lines = self.transcript_previews.get(thread_id)?;
        (!lines.is_empty()).then(|| {
            lines
                .iter()
                .map(|line| {
                    let prefix = match line.speaker {
                        transcript_preview::TranscriptPreviewSpeaker::User => "you: ",
                        transcript_preview::TranscriptPreviewSpeaker::Assistant => "assistant: ",
                    };
                    format!("{prefix}{}", line.text)
                })
                .collect::<Vec<_>>()
                .join(" | ")
        })
    }

    pub(crate) fn toggle_status(&mut self) {
        self.status = match self.status {
            SessionStatus::Active => SessionStatus::Archived,
            SessionStatus::Archived => SessionStatus::Active,
        };
        self.selected = 0;
        self.transcript_previews.clear();
        self.preview_loading.clear();
        self.expanded_thread_id = None;
        self.transcripts.clear();
        self.transcript_pager = None;
        self.pagination.reset();
        self.seen_cursors.clear();
    }

    pub(crate) fn toggle_filter(&mut self) {
        self.show_all = !self.show_all;
        self.selected = 0;
        self.transcript_previews.clear();
        self.preview_loading.clear();
        self.expanded_thread_id = None;
        self.transcripts.clear();
        self.transcript_pager = None;
        self.pagination.reset();
        self.seen_cursors.clear();
    }

    pub(crate) fn toggle_sort(&mut self) {
        self.sort_key = match self.sort_key {
            ThreadSortKey::UpdatedAt => ThreadSortKey::CreatedAt,
            ThreadSortKey::CreatedAt
            | ThreadSortKey::RecencyAt
            | ThreadSortKey::SectionPosition => ThreadSortKey::UpdatedAt,
        };
        self.selected = 0;
        self.transcript_previews.clear();
        self.preview_loading.clear();
        self.expanded_thread_id = None;
        self.transcripts.clear();
        self.transcript_pager = None;
        self.pagination.reset();
        self.seen_cursors.clear();
    }

    #[cfg(test)]
    fn set_threads(&mut self, threads: Vec<Thread>) {
        self.threads = filter_threads(threads, &self.query);
        self.selected = self.selected.min(self.threads.len().saturating_sub(1));
        self.transcript_previews.clear();
        self.preview_loading.clear();
        self.expanded_thread_id = None;
        self.transcripts.clear();
        self.transcript_pager = None;
        self.pagination.reset();
        self.seen_cursors.clear();
    }

    pub(crate) fn invalidate_thread_list(&mut self) {
        self.pending_page_down_target = None;
        self.pagination.reset();
        self.seen_cursors.clear();
    }

    pub(crate) fn toggle_density(&mut self) {
        self.density = self.density.toggle();
    }

    pub(crate) fn transcript_pager_is_open(&self) -> bool {
        self.transcript_pager.is_some()
    }

    pub(crate) fn transcript_search_needs_frame(&self) -> bool {
        self.transcript_pager
            .as_ref()
            .is_some_and(|pager| pager.overlay.search_needs_frame())
    }

    pub(crate) fn tick_transcript_selection(&self) -> bool {
        self.transcript_pager
            .as_ref()
            .is_some_and(|pager| pager.overlay.tick_transcript_selection())
    }

    pub(crate) fn end_transcript_drag(&self) {
        if let Some(pager) = self.transcript_pager.as_ref() {
            pager.overlay.end_transcript_drag();
        }
    }

    pub(crate) fn handle_transcript_pager_event(&mut self, event: &Event) -> Option<PagerAction> {
        if let Some(pager) = self.transcript_pager.as_mut() {
            match pager.overlay.handle_event(event) {
                PagerAction::Close => self.transcript_pager = None,
                PagerAction::Consumed | PagerAction::LoadOlderHistory => {}
                action @ PagerAction::ScheduleFrame => return Some(action),
                action @ (PagerAction::CopyTranscriptSelection { .. }
                | PagerAction::OpenLink(_)
                | PagerAction::ContinueTranscriptSelection) => return Some(action),
            }
        }
        None
    }

    pub(crate) fn apply_transcript_copy_result(
        &mut self,
        follow: bool,
        characters: usize,
        result: &Result<crate::clipboard_copy::CopyStatus, String>,
    ) {
        if let Some(pager) = self.transcript_pager.as_mut() {
            pager
                .overlay
                .apply_transcript_copy_result(follow, characters, result);
        }
    }
}

mod host;
mod input;
use input::ToolbarControl;
mod layout;
mod render;

pub(crate) use host::{
    run_resume_picker_with_app_server, spawn_archive_request, spawn_preview_load,
    spawn_thread_load, spawn_transcript_load, spawn_unarchive_request,
};
pub(crate) use render::render_with_locale;

#[cfg(test)]
#[path = "resume_picker/tests.rs"]
mod tests;
