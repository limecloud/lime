use std::collections::BTreeMap;

use app_server_protocol::protocol::v2::{
    ToolRequestUserInputAnswer, ToolRequestUserInputParams, ToolRequestUserInputResponse,
};
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::text::Line;
use std::time::{Duration, Instant};

use super::{AppServerResponse, ChatComposer, ChatComposerConfig, ComposerDraft, InputResult};
use crate::bottom_pane::selection_row_layout::MAX_POPUP_ROWS;
use crate::footer_hint::{display_key_label, primary_action_hint, wrap_hint_rows, ShortcutHint};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::width::display_width;

mod confirmation;
mod layout;
mod state;
use crate::bottom_pane::scroll_state::ScrollState;
use state::{AnswerState, Focus};
pub(super) mod render;

const AUTO_RESOLUTION_HIDDEN_GRACE: Duration = Duration::from_secs(60);
const AUTO_RESOLUTION_VISIBLE_COUNTDOWN: Duration = Duration::from_secs(60);
const OTHER_OPTION_LABEL: &str = "None of the above";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AutoResolutionTiming {
    Disabled,
    HiddenGrace { remaining: Duration },
    VisibleCountdown { remaining: Duration },
    Due,
}

fn format_auto_resolution_remaining(remaining: Duration) -> String {
    let mut seconds = remaining.as_secs();
    if remaining.subsec_nanos() > 0 {
        seconds = seconds.saturating_add(1);
    }
    if seconds < 60 {
        return format!("{seconds}s");
    }
    format!("{}m {:02}s", seconds / 60, seconds % 60)
}

fn fit_footer_hint(hint: String, width: usize) -> String {
    truncate_line_with_ellipsis_if_overflow(Line::from(hint), width).to_string()
}

#[derive(Debug)]
pub(super) struct RequestUserInputOverlay {
    pub(super) id: RequestId,
    pub(super) params: ToolRequestUserInputParams,
    pub(super) question_index: usize,
    pub(super) composer: ChatComposer,
    answers: Vec<AnswerState>,
    pending_submission_draft: Option<ComposerDraft>,
    confirm_unanswered: Option<ScrollState>,
    list_keymap: ListKeymap,
    list_key_chord_matcher: KeyChordMatcher,
    request_started_at: Instant,
    auto_resolution_snoozed: bool,
    submission_error: Option<usize>,
}

impl RequestUserInputOverlay {
    pub(super) fn new(id: RequestId, params: ToolRequestUserInputParams) -> Self {
        let answers = params
            .questions
            .iter()
            .map(|question| {
                AnswerState::new(
                    question
                        .options
                        .as_ref()
                        .is_some_and(|options| !options.is_empty()),
                )
            })
            .collect();
        Self {
            id,
            params,
            question_index: 0,
            composer: ChatComposer::new_with_config(ChatComposerConfig::plain_text()),
            answers,
            pending_submission_draft: None,
            confirm_unanswered: None,
            list_keymap: ListKeymap::default(),
            list_key_chord_matcher: KeyChordMatcher::default(),
            request_started_at: Instant::now(),
            auto_resolution_snoozed: false,
            submission_error: None,
        }
    }

    pub(super) fn action_required_label(&self, locale: crate::locale::Locale) -> Option<String> {
        self.params
            .questions
            .first()
            .map(|question| question.header.clone())
            .filter(|header| !header.trim().is_empty())
            .or_else(|| Some(locale.request_input_action_label().to_string()))
    }

    pub(super) fn set_keymap_bindings(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        self.composer.set_keymap_bindings(keymap);
        self.list_keymap = keymap.list().clone();
        self.list_key_chord_matcher.reset();
    }

    fn snooze_auto_resolution(&mut self) {
        if !self.params.is_blocking {
            self.auto_resolution_snoozed = true;
        }
    }

    fn auto_resolution_timing_at(&self, now: Instant) -> AutoResolutionTiming {
        if self.params.is_blocking || self.auto_resolution_snoozed {
            return AutoResolutionTiming::Disabled;
        }

        let elapsed = now.saturating_duration_since(self.request_started_at);
        if elapsed < AUTO_RESOLUTION_HIDDEN_GRACE {
            return AutoResolutionTiming::HiddenGrace {
                remaining: AUTO_RESOLUTION_HIDDEN_GRACE.saturating_sub(elapsed),
            };
        }
        let visible_elapsed = elapsed.saturating_sub(AUTO_RESOLUTION_HIDDEN_GRACE);
        if visible_elapsed < AUTO_RESOLUTION_VISIBLE_COUNTDOWN {
            return AutoResolutionTiming::VisibleCountdown {
                remaining: AUTO_RESOLUTION_VISIBLE_COUNTDOWN.saturating_sub(visible_elapsed),
            };
        }
        AutoResolutionTiming::Due
    }

    pub(super) fn next_frame_delay(&self, now: Instant) -> Option<Duration> {
        let auto_resolution = match self.auto_resolution_timing_at(now) {
            AutoResolutionTiming::Disabled => None,
            AutoResolutionTiming::HiddenGrace { remaining } => Some(remaining),
            AutoResolutionTiming::VisibleCountdown { remaining } => {
                Some(remaining.min(Duration::from_secs(1)))
            }
            AutoResolutionTiming::Due => Some(Duration::ZERO),
        };
        auto_resolution
            .into_iter()
            .chain(
                self.composer
                    .paste_burst_needs_frame()
                    .then_some(crate::tui::TARGET_FRAME_INTERVAL),
            )
            .min()
    }

    pub(super) fn pre_draw_tick(&mut self, now: Instant) -> Option<AppServerResponse> {
        self.flush_paste_burst_if_due(now);
        if !matches!(
            self.auto_resolution_timing_at(now),
            AutoResolutionTiming::Due
        ) {
            return None;
        }
        Some(AppServerResponse::UserInput {
            id: self.id.clone(),
            response: ToolRequestUserInputResponse {
                answers: BTreeMap::new(),
            },
        })
    }

    pub(super) fn auto_resolution_countdown_text(
        &self,
        now: Instant,
        locale: crate::locale::Locale,
    ) -> Option<String> {
        match self.auto_resolution_timing_at(now) {
            AutoResolutionTiming::VisibleCountdown { remaining } => {
                Some(locale.auto_resolution_countdown(&format_auto_resolution_remaining(remaining)))
            }
            AutoResolutionTiming::Disabled
            | AutoResolutionTiming::HiddenGrace { .. }
            | AutoResolutionTiming::Due => None,
        }
    }

    fn secondary_footer_hints(&self, locale: crate::locale::Locale, width: usize) -> Vec<String> {
        let mut hints = Vec::with_capacity(4);
        if let Some(position) = self.option_position_hint(locale) {
            hints.push(fit_footer_hint(position, width));
        }
        if self.has_options() && !self.editing() {
            if let (Some(up), Some(down)) = (
                self.list_keymap.primary_hint(ListAction::MoveUp),
                self.list_keymap.primary_hint(ListAction::MoveDown),
            ) {
                hints.push(
                    ShortcutHint::new(
                        &format!("{}/{}", display_key_label(&up), display_key_label(&down)),
                        locale.request_select_hint(&up, &down),
                    )
                    .fit(width),
                );
            }
        }
        if self.has_options() {
            hints.push(ShortcutHint::new("tab", locale.request_notes_hint("tab")).fit(width));
        }
        if self.params.questions.len() > 1 && !self.editing() {
            if let (Some(left), Some(right)) = (
                self.list_keymap.primary_hint(ListAction::MoveLeft),
                self.list_keymap.primary_hint(ListAction::MoveRight),
            ) {
                hints.push(
                    ShortcutHint::new(
                        &format!("{}/{}", display_key_label(&left), display_key_label(&right)),
                        locale.request_question_nav_hint(&left, &right),
                    )
                    .fit(width),
                );
            }
        }
        hints
    }

    pub(super) fn footer_hint_lines(
        &self,
        locale: crate::locale::Locale,
        width: usize,
    ) -> Vec<String> {
        if width == 0 {
            return Vec::new();
        }
        if self.confirm_unanswered.is_some() {
            return self.confirmation_footer_hints(locale, width);
        }

        let tips = std::iter::once(self.primary_footer_hint_for_width(locale, width))
            .chain(self.secondary_footer_hints(locale, width))
            .filter(|hint| !hint.is_empty());
        wrap_hint_rows(tips, width, display_width(" · "), |hint| {
            display_width(hint)
        })
        .into_iter()
        .map(|row| row.join(" · "))
        .collect()
    }

    pub(super) fn footer_required_height(
        &self,
        locale: crate::locale::Locale,
        width: usize,
    ) -> u16 {
        u16::try_from(self.footer_hint_lines(locale, width).len()).unwrap_or(u16::MAX)
    }

    fn primary_footer_hint_for_width(&self, locale: crate::locale::Locale, width: usize) -> String {
        if let Some(actual_chars) = self.submission_error {
            return fit_footer_hint(locale.user_input_too_large_message(actual_chars), width);
        }
        let (submit_key, cancel_key) = self.action_hint_keys();
        primary_action_hint(
            submit_key.map(|key| ShortcutHint::new(&key, locale.request_submit_hint(&key))),
            cancel_key.map(|key| ShortcutHint::new(&key, locale.request_cancel_hint(&key))),
            width,
        )
    }

    fn action_hint_keys(&self) -> (Option<String>, Option<String>) {
        if self.has_options() && !self.editing() {
            (
                self.list_keymap.primary_hint(ListAction::Accept),
                self.list_keymap.primary_hint(ListAction::Cancel),
            )
        } else {
            (Some("enter".to_string()), Some("esc".to_string()))
        }
    }

    fn option_position_hint(&self, locale: crate::locale::Locale) -> Option<String> {
        let total = self.option_count();
        if total <= MAX_POPUP_ROWS {
            return None;
        }
        let selected = self.selected().min(total.saturating_sub(1)) + 1;
        Some(locale.request_option_position_hint(selected, total))
    }

    #[cfg(test)]
    pub(super) fn handle_key_event(&mut self, key: KeyEvent) -> Option<AppServerResponse> {
        self.handle_key_event_at(key, Instant::now())
    }

    pub(super) fn handle_key_event_at(
        &mut self,
        key: KeyEvent,
        now: Instant,
    ) -> Option<AppServerResponse> {
        if key.kind == KeyEventKind::Release {
            return None;
        }
        if self.params.questions.is_empty() {
            return Some(self.finish());
        }
        self.snooze_auto_resolution();
        self.submission_error = None;
        if self.confirm_unanswered.is_some() {
            return self.handle_confirm_unanswered_key_event(key);
        }
        if self.editing()
            && (self.composer.key_chord_pending()
                || self.composer.vim_search_active()
                || self.composer.history_search_active()
                || self.composer.vim_search_wants_key(key)
                || self.composer.should_handle_vim_insert_escape(key))
        {
            self.pending_submission_draft = None;
            let result = self.composer.handle_key_event_at(key, now);
            return self.handle_composer_input_result(result);
        }
        if self.editing() && self.composer.prepare_key_event(key, now) {
            self.pending_submission_draft = None;
            self.save_current_state();
            return None;
        }
        match key {
            key if key.kind == KeyEventKind::Press
                && key.modifiers.contains(KeyModifiers::CONTROL)
                && key.code == KeyCode::Char('c') =>
            {
                // Match Codex's overlay boundary: while editing notes, the first Ctrl-C
                // clears the local draft; only an empty draft cancels the request. This keeps
                // cancellation explicit and never fabricates a partial answer response.
                if self.editing() && !self.composer.is_empty() {
                    self.composer.replace(String::new());
                    self.save_current_state();
                    None
                } else {
                    Some(self.cancel())
                }
            }
            key if key.kind == KeyEventKind::Press => {
                if !self.editing() {
                    match self
                        .list_keymap
                        .dispatch(&mut self.list_key_chord_matcher, key, false)
                    {
                        KeymapMatch::Completed(ListAction::MoveUp) => {
                            self.move_option(false);
                            return None;
                        }
                        KeymapMatch::Completed(ListAction::MoveDown) => {
                            self.move_option(true);
                            return None;
                        }
                        KeymapMatch::Completed(ListAction::MoveLeft) => {
                            if self.has_options() {
                                self.move_question(false);
                            }
                            return None;
                        }
                        KeymapMatch::Completed(ListAction::MoveRight) => {
                            if self.has_options() {
                                self.move_question(true);
                            }
                            return None;
                        }
                        KeymapMatch::Completed(ListAction::Accept) => {
                            return self.commit_selected_or_open_notes();
                        }
                        KeymapMatch::Completed(ListAction::Cancel) => return Some(self.cancel()),
                        KeymapMatch::Completed(ListAction::PageUp) => {
                            self.move_question(false);
                            return None;
                        }
                        KeymapMatch::Completed(ListAction::PageDown) => {
                            self.move_question(true);
                            return None;
                        }
                        KeymapMatch::Pending | KeymapMatch::Cancelled => return None,
                        KeymapMatch::Completed(ListAction::JumpTop)
                        | KeymapMatch::Completed(ListAction::JumpBottom)
                        | KeymapMatch::PassThrough => {}
                    }
                }
                match key.code {
                    KeyCode::Esc if self.editing() && self.has_options() => {
                        self.clear_notes_and_focus_options();
                        None
                    }
                    KeyCode::Esc if self.editing() => Some(self.cancel()),
                    KeyCode::Char('p')
                        if self.editing() && key.modifiers.contains(KeyModifiers::CONTROL) =>
                    {
                        self.move_question(false);
                        None
                    }
                    KeyCode::Char('n')
                        if self.editing() && key.modifiers.contains(KeyModifiers::CONTROL) =>
                    {
                        self.move_question(true);
                        None
                    }
                    KeyCode::PageUp if self.editing() => {
                        self.move_question(false);
                        None
                    }
                    KeyCode::PageDown if self.editing() => {
                        self.move_question(true);
                        None
                    }
                    KeyCode::Tab if self.has_options() && self.editing() => {
                        self.list_key_chord_matcher.reset();
                        self.clear_notes_and_focus_options();
                        None
                    }
                    KeyCode::Tab if self.has_options() => {
                        self.list_key_chord_matcher.reset();
                        self.restore_current_state();
                        self.set_focus(Focus::Notes);
                        self.save_current_state();
                        None
                    }
                    KeyCode::Char(' ')
                        if !self.editing() && self.has_options() && key.modifiers.is_empty() =>
                    {
                        self.save_current_state();
                        None
                    }
                    KeyCode::Backspace
                        if self.editing() && self.has_options() && self.composer.is_empty() =>
                    {
                        self.clear_notes_and_focus_options();
                        None
                    }
                    _ if self.editing()
                        && key.code == KeyCode::Enter
                        && key.modifiers.is_empty()
                        && self.composer.is_empty()
                        && !self.composer.vim_search_active()
                        && !self.composer.history_search_active()
                        && !self.composer.vim_key_event_is_owned(key) =>
                    {
                        self.commit()
                    }
                    _ if self.editing() => {
                        self.pending_submission_draft = (key.code == KeyCode::Enter
                            && key.modifiers.is_empty())
                        .then(|| self.composer.snapshot_draft());
                        let result = self.composer.handle_key_event_at(key, now);
                        self.handle_composer_input_result(result)
                    }
                    KeyCode::Char(ch) if ch.is_ascii_digit() && ch != '0' => {
                        let index = ch.to_digit(10).unwrap_or_default() as usize - 1;
                        if index < self.option_count() {
                            self.set_selected(index);
                            self.save_current_state();
                            self.commit()
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn handle_composer_input_result(&mut self, result: InputResult) -> Option<AppServerResponse> {
        if !matches!(result, InputResult::Submitted { .. }) {
            self.pending_submission_draft = None;
        }
        match result {
            InputResult::Submitted { .. } => self.commit(),
            InputResult::Interrupt | InputResult::Quit => Some(self.cancel()),
            InputResult::Queued { text, .. } => {
                self.composer.insert(&text);
                self.save_current_state();
                None
            }
            InputResult::SubmissionRejected { actual_chars } => {
                self.submission_error = Some(actual_chars);
                self.save_current_state();
                None
            }
            InputResult::None
            | InputResult::Changed
            | InputResult::DecreaseEffort
            | InputResult::IncreaseEffort
            | InputResult::PreviousPermissions
            | InputResult::NextPermissions
            | InputResult::OpenExternalEditor
            | InputResult::OpenAgentsOverview => {
                self.save_current_state();
                None
            }
        }
    }

    pub(super) fn flush_paste_burst_if_due(&mut self, now: Instant) -> bool {
        if self.composer.handle_paste_burst_flush(now) {
            self.save_current_state();
            true
        } else {
            false
        }
    }

    pub(super) fn is_in_paste_burst(&self) -> bool {
        self.composer.paste_burst_needs_frame()
    }

    fn commit_selected_or_open_notes(&mut self) -> Option<AppServerResponse> {
        if self.selected() == self.current_options().map_or(usize::MAX, <[_]>::len)
            && self.other_option_enabled()
        {
            self.set_focus(Focus::Notes);
            self.save_current_state();
            return None;
        }
        self.commit()
    }

    fn current_options(
        &self,
    ) -> Option<&[app_server_protocol::protocol::v2::ToolRequestUserInputOption]> {
        self.params
            .questions
            .get(self.question_index)
            .and_then(|question| question.options.as_deref())
    }

    fn has_options(&self) -> bool {
        self.current_options()
            .is_some_and(|options| !options.is_empty())
    }

    fn option_count(&self) -> usize {
        let options = self.current_options().map_or(0, <[_]>::len);
        if self.other_option_enabled() {
            options + 1
        } else {
            options
        }
    }

    fn other_option_enabled(&self) -> bool {
        self.params
            .questions
            .get(self.question_index)
            .is_some_and(|question| question.is_other && self.has_options())
    }

    fn cancel(&self) -> AppServerResponse {
        AppServerResponse::UserInput {
            id: self.id.clone(),
            response: ToolRequestUserInputResponse {
                answers: BTreeMap::new(),
            },
        }
    }

    pub(super) fn handle_paste(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.snooze_auto_resolution();
        self.submission_error = None;
        if self.confirm_unanswered.is_some() {
            return;
        }
        self.set_focus(Focus::Notes);
        self.composer.handle_paste(text);
        self.save_current_state();
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

#[cfg(test)]
mod paste_tests;

#[cfg(test)]
mod state_tests;

#[cfg(test)]
mod burst_tests;
