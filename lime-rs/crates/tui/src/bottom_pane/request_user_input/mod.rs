use std::collections::BTreeMap;

use app_server_protocol::protocol::v2::{
    ToolRequestUserInputAnswer, ToolRequestUserInputParams, ToolRequestUserInputResponse,
};
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::text::Line;
use std::time::{Duration, Instant};

use super::{AppServerResponse, ChatComposer, InputResult};
use crate::bottom_pane::selection_row_layout::MAX_POPUP_ROWS;
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::width::display_width;

mod layout;
pub(super) mod render;

const AUTO_RESOLUTION_HIDDEN_GRACE: Duration = Duration::from_secs(60);
const AUTO_RESOLUTION_VISIBLE_COUNTDOWN: Duration = Duration::from_secs(60);

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
    pub(super) selected: usize,
    pub(super) editing: bool,
    pub(super) composer: ChatComposer,
    answers: BTreeMap<String, ToolRequestUserInputAnswer>,
    /// Stores one notes draft per question so navigation does not lose input.
    question_drafts: Vec<String>,
    /// Stores option selection per question for reversible focus changes.
    question_selections: Vec<usize>,
    /// Stores the Options/Notes focus per question.
    question_editing: Vec<bool>,
    request_started_at: Instant,
    auto_resolution_snoozed: bool,
    submission_error: Option<usize>,
}

impl RequestUserInputOverlay {
    pub(super) fn new(id: RequestId, params: ToolRequestUserInputParams) -> Self {
        let question_count = params.questions.len();
        let question_editing = params
            .questions
            .iter()
            .map(|question| question.options.as_ref().is_none_or(Vec::is_empty))
            .collect();
        let editing = params
            .questions
            .first()
            .and_then(|question| question.options.as_ref())
            .is_none_or(Vec::is_empty);
        Self {
            id,
            params,
            question_index: 0,
            selected: 0,
            editing,
            composer: ChatComposer::default(),
            answers: BTreeMap::new(),
            question_drafts: vec![String::new(); question_count],
            question_selections: vec![0; question_count],
            question_editing,
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
        match self.auto_resolution_timing_at(now) {
            AutoResolutionTiming::Disabled => None,
            AutoResolutionTiming::HiddenGrace { remaining } => Some(remaining),
            AutoResolutionTiming::VisibleCountdown { remaining } => {
                Some(remaining.min(Duration::from_secs(1)))
            }
            AutoResolutionTiming::Due => Some(Duration::ZERO),
        }
    }

    pub(super) fn pre_draw_tick(&mut self, now: Instant) -> Option<AppServerResponse> {
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

    fn footer_hints(&self, locale: crate::locale::Locale) -> Vec<String> {
        let mut hints = Vec::with_capacity(6);
        // The submit/cancel pair is the non-negotiable action set on narrow terminals.
        // Secondary navigation may be clipped, but these two controls must remain visible.
        hints.push(locale.request_submit_hint().to_string());
        hints.push(locale.request_cancel_hint().to_string());
        if let Some(position) = self.option_position_hint(locale) {
            hints.push(position);
        }
        if self.has_options() && !self.editing {
            hints.push(locale.request_select_hint().to_string());
        }
        if self.has_options() {
            hints.push(locale.request_notes_hint().to_string());
        }
        if self.params.questions.len() > 1 {
            hints.push(locale.request_question_nav_hint().to_string());
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

        let hints = self.footer_hints(locale);
        let mut tips = Vec::with_capacity(hints.len().saturating_sub(1));
        tips.push(self.primary_footer_hint_for_width(locale, width));
        tips.extend(
            hints
                .into_iter()
                .skip(2)
                .map(|hint| fit_footer_hint(hint, width)),
        );

        let mut lines = Vec::new();
        let mut current = String::new();
        for tip in tips.into_iter().filter(|tip| !tip.is_empty()) {
            let candidate = if current.is_empty() {
                tip.clone()
            } else {
                format!("{current} · {tip}")
            };
            if display_width(&candidate) <= width {
                current = candidate;
            } else {
                lines.push(current);
                current = tip;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
        lines
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
        let primary = format!(
            "{} · {}",
            locale.request_submit_hint(),
            locale.request_cancel_hint()
        );
        let selected = [
            primary.as_str(),
            "Enter · Esc",
            "↵ · Esc",
            "↵Esc",
            "Esc",
            "",
        ]
        .into_iter()
        .find(|candidate| display_width(candidate) <= width)
        .unwrap_or("")
        .to_string();
        selected
    }

    fn option_position_hint(&self, locale: crate::locale::Locale) -> Option<String> {
        let total = self.option_count();
        if total <= MAX_POPUP_ROWS {
            return None;
        }
        let selected = self.selected.min(total.saturating_sub(1)) + 1;
        Some(locale.request_option_position_hint(selected, total))
    }

    fn save_current_state(&mut self) {
        if let Some(draft) = self.question_drafts.get_mut(self.question_index) {
            *draft = self.composer.text().to_owned();
        }
        if let Some(selection) = self.question_selections.get_mut(self.question_index) {
            *selection = self.selected;
        }
        if let Some(editing) = self.question_editing.get_mut(self.question_index) {
            *editing = self.editing;
        }
    }

    fn restore_current_state(&mut self) {
        self.selected = self
            .question_selections
            .get(self.question_index)
            .copied()
            .unwrap_or(0);
        let draft = self
            .question_drafts
            .get(self.question_index)
            .cloned()
            .unwrap_or_default();
        self.composer.replace(draft);
        self.editing = self
            .question_editing
            .get(self.question_index)
            .copied()
            .unwrap_or_else(|| !self.has_options());
    }

    fn move_question(&mut self, next: bool) {
        let count = self.params.questions.len();
        if count < 2 {
            return;
        }
        self.save_current_state();
        self.question_index = if next {
            (self.question_index + 1) % count
        } else {
            (self.question_index + count - 1) % count
        };
        self.restore_current_state();
    }

    /// Move through the current question's choices with the same wrapping list semantics as
    /// Codex. Notes editing remains a separate mode, so this is only called while options are
    /// focused.
    fn move_option(&mut self, next: bool) {
        let count = self.option_count();
        if count == 0 {
            return;
        }
        let selected = self.selected.min(count - 1);
        self.selected = if next {
            (selected + 1) % count
        } else {
            selected.checked_sub(1).unwrap_or(count - 1)
        };
        self.save_current_state();
    }

    pub(super) fn handle_key_event(&mut self, key: KeyEvent) -> Option<AppServerResponse> {
        if self.params.questions.is_empty() {
            return Some(self.finish());
        }
        self.snooze_auto_resolution();
        self.submission_error = None;
        if self.editing && self.composer.key_chord_pending() {
            self.composer.handle_key_event(key);
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
                if self.editing && !self.composer.is_empty() {
                    self.composer.replace(String::new());
                    self.save_current_state();
                    None
                } else {
                    Some(self.cancel())
                }
            }
            key if key.kind == KeyEventKind::Press => match key.code {
                KeyCode::Esc if self.editing && self.has_options() => {
                    self.clear_notes_and_focus_options();
                    None
                }
                KeyCode::Esc => Some(self.cancel()),
                KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    self.move_question(false);
                    None
                }
                KeyCode::Char('n') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    self.move_question(true);
                    None
                }
                KeyCode::PageUp => {
                    self.move_question(false);
                    None
                }
                KeyCode::PageDown => {
                    self.move_question(true);
                    None
                }
                KeyCode::Left | KeyCode::Char('h')
                    if !self.editing && self.has_options() && key.modifiers.is_empty() =>
                {
                    self.move_question(false);
                    None
                }
                KeyCode::Right | KeyCode::Char('l')
                    if !self.editing && self.has_options() && key.modifiers.is_empty() =>
                {
                    self.move_question(true);
                    None
                }
                KeyCode::Tab if self.has_options() && self.editing => {
                    self.clear_notes_and_focus_options();
                    None
                }
                KeyCode::Tab if self.has_options() => {
                    self.restore_current_state();
                    self.editing = true;
                    self.save_current_state();
                    None
                }
                KeyCode::Up if !self.editing => {
                    self.move_option(false);
                    None
                }
                KeyCode::Char('k')
                    if !self.editing
                        && (key.modifiers.is_empty()
                            || key.modifiers.contains(KeyModifiers::CONTROL)) =>
                {
                    self.move_option(false);
                    None
                }
                KeyCode::Down if !self.editing => {
                    self.move_option(true);
                    None
                }
                KeyCode::Char('j')
                    if !self.editing
                        && (key.modifiers.is_empty()
                            || key.modifiers.contains(KeyModifiers::CONTROL)) =>
                {
                    self.move_option(true);
                    None
                }
                KeyCode::Char(' ')
                    if !self.editing && self.has_options() && key.modifiers.is_empty() =>
                {
                    self.save_current_state();
                    None
                }
                KeyCode::Backspace
                    if self.editing && self.has_options() && self.composer.is_empty() =>
                {
                    self.clear_notes_and_focus_options();
                    None
                }
                _ if self.editing && key.code == KeyCode::Enter && self.composer.is_empty() => {
                    let answer = self.selected_option_label().into_iter().collect();
                    self.commit(answer)
                }
                _ if self.editing => match self.composer.handle_key_event(key) {
                    InputResult::Submitted { text, .. } => {
                        let mut answers =
                            self.selected_option_label().into_iter().collect::<Vec<_>>();
                        let note = text.trim();
                        if !note.is_empty() {
                            if self.has_options() {
                                answers.push(format!("user_note: {note}"));
                            } else {
                                answers.push(note.to_string());
                            }
                        }
                        self.commit(answers)
                    }
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
                },
                KeyCode::Enter => {
                    if self.selected == self.current_options().map_or(usize::MAX, <[_]>::len)
                        && self.other_option_enabled()
                    {
                        self.editing = true;
                        self.save_current_state();
                        return None;
                    }
                    let answer = self.selected_option_label().into_iter().collect();
                    self.commit(answer)
                }
                KeyCode::Char(ch) if ch.is_ascii_digit() && ch != '0' => {
                    let index = ch.to_digit(10).unwrap_or_default() as usize - 1;
                    if index < self.option_count() {
                        self.selected = index;
                        self.save_current_state();
                        let answer = self.selected_option_label().into_iter().collect();
                        self.commit(answer)
                    } else {
                        None
                    }
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn commit(&mut self, answers: Vec<String>) -> Option<AppServerResponse> {
        self.save_current_state();
        if let Some(question) = self.params.questions.get(self.question_index) {
            self.answers
                .insert(question.id.clone(), ToolRequestUserInputAnswer { answers });
        }
        if self.question_index + 1 >= self.params.questions.len() {
            return Some(self.finish());
        }
        self.question_index += 1;
        self.restore_current_state();
        None
    }

    fn clear_notes_and_focus_options(&mut self) {
        if let Some(draft) = self.question_drafts.get_mut(self.question_index) {
            draft.clear();
        }
        self.composer.replace(String::new());
        self.editing = false;
        self.save_current_state();
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

    fn selected_option_label(&self) -> Option<String> {
        let options = self.current_options()?;
        if let Some(option) = options.get(self.selected) {
            return Some(option.label.clone());
        }
        (self.selected == options.len() && self.other_option_enabled()).then(|| "Other".to_string())
    }

    fn finish(&self) -> AppServerResponse {
        AppServerResponse::UserInput {
            id: self.id.clone(),
            response: ToolRequestUserInputResponse {
                answers: self.answers.clone(),
            },
        }
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
        self.editing = true;
        self.composer.insert(text);
        self.save_current_state();
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
