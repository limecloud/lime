//! MCP form elicitation interaction for the TUI.
//!
//! The App Server owns the request contract. This module only translates the supported form
//! schema into a focused terminal editor and emits the typed v2 response.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use app_server_protocol::protocol::v2::{
    McpServerElicitationAction, McpServerElicitationRequest, McpServerElicitationRequestParams,
    McpServerElicitationRequestResponse,
};
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::Frame;
use serde_json::{Map, Value};

use super::{AppServerResponse, ChatComposer, ChatComposerConfig, ComposerDraft, InputResult};
use crate::bottom_pane::selection_row_layout::{visible_item_window, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::style::{accent_style, muted_style};
use crate::text_formatting::{format_json_compact, truncate_text};
use crate::width::display_width;
use crate::wrapping::{word_wrap_line, RtOptions};

const APPROVAL_META_KIND_KEY: &str = "codex_approval_kind";
const APPROVAL_META_KIND_MCP_TOOL_CALL: &str = "mcp_tool_call";
const APPROVAL_META_KIND_TOOL_SUGGESTION: &str = "tool_suggestion";
const APPROVAL_TOOL_PARAMS_KEY: &str = "tool_params";
const APPROVAL_TOOL_PARAMS_DISPLAY_KEY: &str = "tool_params_display";
const APPROVAL_PERSIST_KEY: &str = "persist";
const APPROVAL_PERSIST_SESSION_VALUE: &str = "session";
const APPROVAL_PERSIST_ALWAYS_VALUE: &str = "always";
const APPROVAL_ACCEPT_ONCE_VALUE: &str = "accept";
const APPROVAL_ACCEPT_SESSION_VALUE: &str = "accept_session";
const APPROVAL_ACCEPT_ALWAYS_VALUE: &str = "accept_always";
const APPROVAL_DECLINE_VALUE: &str = "decline";
const APPROVAL_CANCEL_VALUE: &str = "cancel";
const APPROVAL_TOOL_PARAM_DISPLAY_LIMIT: usize = 3;
const APPROVAL_TOOL_PARAM_VALUE_TRUNCATE_GRAPHEMES: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpResponseMode {
    FormContent,
    ApprovalAction,
}

#[derive(Debug, Clone, PartialEq)]
struct McpField {
    id: String,
    label: String,
    description: Option<String>,
    required: bool,
    input: McpFieldInput,
}

#[derive(Debug, Clone, PartialEq)]
enum McpFieldInput {
    Text {
        default: Option<String>,
    },
    Select {
        options: Vec<McpOption>,
        default_index: Option<usize>,
    },
}

#[derive(Debug, Clone, PartialEq)]
struct McpOption {
    label: String,
    description: Option<String>,
    value: Value,
}

#[derive(Debug, Clone, PartialEq)]
struct McpToolApprovalDisplayParam {
    name: String,
    value: Value,
    display_name: String,
}

#[derive(Debug, Clone, PartialEq)]
enum McpFieldState {
    Text {
        draft: ComposerDraft,
        committed: bool,
    },
    Select {
        selected: Option<usize>,
        committed: bool,
    },
}

#[derive(Debug)]
pub(super) struct McpServerElicitationOverlay {
    id: RequestId,
    server_name: String,
    message: String,
    approval_display_params: Vec<McpToolApprovalDisplayParam>,
    response_mode: McpResponseMode,
    fields: Vec<McpField>,
    states: Vec<McpFieldState>,
    current_field: usize,
    pub(super) composer: ChatComposer,
    list_keymap: ListKeymap,
    list_key_chord_matcher: KeyChordMatcher,
    validation_error: bool,
    submission_error: Option<usize>,
    done: bool,
}

impl McpServerElicitationOverlay {
    pub(super) fn request_id(&self) -> &RequestId {
        &self.id
    }

    pub(super) fn from_server_request(
        id: RequestId,
        params: &McpServerElicitationRequestParams,
    ) -> Option<Self> {
        let McpServerElicitationRequest::Form {
            message,
            requested_schema,
            meta,
            ..
        } = &params.request;
        let schema = Value::Object(requested_schema.clone());
        let (response_mode, fields) = if is_empty_object_schema(&schema) {
            if is_tool_suggestion(meta.as_ref()) {
                return None;
            }
            (
                McpResponseMode::ApprovalAction,
                approval_fields(meta.as_ref())?,
            )
        } else {
            (McpResponseMode::FormContent, parse_fields(&schema)?)
        };
        if fields.is_empty() {
            return None;
        }

        let states = fields
            .iter()
            .map(|field| match &field.input {
                McpFieldInput::Text { default } => McpFieldState::Text {
                    draft: {
                        let mut composer =
                            ChatComposer::new_with_config(ChatComposerConfig::plain_text());
                        composer.replace(default.clone().unwrap_or_default());
                        composer.snapshot_draft()
                    },
                    committed: default
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty()),
                },
                McpFieldInput::Select { default_index, .. } => McpFieldState::Select {
                    selected: default_index.or(Some(0)),
                    committed: default_index.is_some(),
                },
            })
            .collect();

        let mut overlay = Self {
            id,
            server_name: params.server_name.clone(),
            message: message.clone(),
            approval_display_params: if response_mode == McpResponseMode::ApprovalAction
                && is_tool_call_approval(meta.as_ref())
            {
                parse_tool_approval_display_params(meta.as_ref())
            } else {
                Vec::new()
            },
            response_mode,
            fields,
            states,
            current_field: 0,
            composer: ChatComposer::new_with_config(ChatComposerConfig::plain_text()),
            list_keymap: ListKeymap::default(),
            list_key_chord_matcher: KeyChordMatcher::default(),
            validation_error: false,
            submission_error: None,
            done: false,
        };
        overlay.restore_text_field();
        Some(overlay)
    }

    pub(super) fn action_required_label(&self, locale: crate::locale::Locale) -> String {
        locale.mcp_elicitation_title(&self.server_name)
    }

    pub(super) fn set_keymap_bindings(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        self.composer.set_keymap_bindings(keymap);
        self.list_keymap = keymap.list().clone();
        self.list_key_chord_matcher.reset();
    }

    fn handle_select_key(&mut self, key: KeyEvent) -> Option<AppServerResponse> {
        let options_len = self.current_options().len();
        match self
            .list_keymap
            .dispatch(&mut self.list_key_chord_matcher, key, false)
        {
            KeymapMatch::Completed(ListAction::MoveUp) => {
                self.move_select_option(options_len, false);
                return None;
            }
            KeymapMatch::Completed(ListAction::MoveDown) => {
                self.move_select_option(options_len, true);
                return None;
            }
            KeymapMatch::Completed(ListAction::Accept) => {
                self.commit_current_field();
                return self.advance_or_submit();
            }
            KeymapMatch::Completed(ListAction::Cancel) => {
                return Some(self.cancel_response());
            }
            KeymapMatch::Pending | KeymapMatch::Cancelled => return None,
            KeymapMatch::Completed(ListAction::MoveLeft) => {
                self.move_field(false);
                return None;
            }
            KeymapMatch::Completed(ListAction::MoveRight) => {
                self.move_field(true);
                return None;
            }
            KeymapMatch::Completed(ListAction::PageUp) => {
                self.move_field(false);
                return None;
            }
            KeymapMatch::Completed(ListAction::PageDown) => {
                self.move_field(true);
                return None;
            }
            KeymapMatch::Completed(ListAction::JumpTop | ListAction::JumpBottom) => {}
            KeymapMatch::PassThrough => {
                if self.handle_field_navigation(key) {
                    return None;
                }
            }
        }
        match key.code {
            KeyCode::Backspace | KeyCode::Delete => {
                if let Some((selected, committed)) = self.current_select_state_mut() {
                    *selected = None;
                    *committed = false;
                }
            }
            KeyCode::Char(' ') => self.commit_current_field(),
            KeyCode::Char(ch) => {
                let digit = ch.to_digit(10)?;
                if digit == 0 {
                    return None;
                }
                let index = digit as usize - 1;
                if index < options_len {
                    if let Some((selected, committed)) = self.current_select_state_mut() {
                        *selected = Some(index);
                        *committed = true;
                    }
                    return self.advance_or_submit();
                }
            }
            _ => {}
        }
        None
    }

    fn move_select_option(&mut self, options_len: usize, next: bool) {
        if options_len == 0 {
            return;
        }
        if let Some((selected, committed)) = self.current_select_state_mut() {
            *selected = Some(match (next, *selected) {
                (false, Some(0) | None) => options_len.saturating_sub(1),
                (false, Some(index)) => index.saturating_sub(1),
                (true, Some(index)) => (index + 1) % options_len,
                (true, None) => 0,
            });
            *committed = false;
        }
    }

    fn handle_field_navigation(&mut self, key: KeyEvent) -> bool {
        if self.is_select_field() {
            let previous = key.code == KeyCode::BackTab;
            let next = key.code == KeyCode::Tab;
            if previous || next {
                self.move_field(next);
                return true;
            }
            return false;
        }
        let previous = matches!(key.code, KeyCode::BackTab | KeyCode::PageUp)
            || key.code == KeyCode::Char('p') && key.modifiers == KeyModifiers::CONTROL;
        let next = matches!(key.code, KeyCode::Tab | KeyCode::PageDown)
            || key.code == KeyCode::Char('n') && key.modifiers == KeyModifiers::CONTROL;
        let horizontal_previous = self.is_select_field()
            && matches!(key.code, KeyCode::Left | KeyCode::Char('h'))
            && key.modifiers.is_empty();
        let horizontal_next = self.is_select_field()
            && matches!(key.code, KeyCode::Right | KeyCode::Char('l'))
            && key.modifiers.is_empty();
        if previous || horizontal_previous {
            self.move_field(false);
            true
        } else if next || horizontal_next {
            self.move_field(true);
            true
        } else {
            false
        }
    }

    fn move_field(&mut self, next: bool) {
        if self.fields.len() < 2 {
            return;
        }
        self.list_key_chord_matcher.reset();
        self.composer.flush_paste_burst_before_handoff();
        self.save_text_draft();
        let offset = if next { 1 } else { self.fields.len() - 1 };
        self.current_field = (self.current_field + offset) % self.fields.len();
        self.validation_error = false;
        self.submission_error = None;
        self.restore_text_field();
    }

    fn commit_current_field(&mut self) {
        let index = self.current_field;
        if self.is_text_field() {
            self.save_text_draft();
            if let Some(McpFieldState::Text { draft, committed }) = self.states.get_mut(index) {
                *committed = !draft.text_with_pending().trim().is_empty();
            }
        } else if let Some(McpFieldState::Select {
            selected,
            committed,
        }) = self.states.get_mut(index)
        {
            *committed = selected.is_some();
        }
        self.validation_error = false;
    }

    fn save_text_draft(&mut self) {
        if !self.is_text_field() {
            return;
        }
        if let Some(McpFieldState::Text { draft, committed }) =
            self.states.get_mut(self.current_field)
        {
            if self.composer.paste_burst_needs_frame() || !self.composer.draft_content_equals(draft)
            {
                *committed = false;
                self.validation_error = false;
            }
            *draft = self.composer.snapshot_draft();
        }
    }

    fn restore_text_field(&mut self) {
        let draft = match self.states.get(self.current_field) {
            Some(McpFieldState::Text { draft, .. }) => draft.clone(),
            _ => ComposerDraft::default(),
        };
        self.composer.replace_draft(draft);
    }

    fn advance_or_submit(&mut self) -> Option<AppServerResponse> {
        if self.current_field + 1 < self.fields.len() {
            self.move_field(true);
            None
        } else {
            self.submit_answers()
        }
    }

    fn submit_answers(&mut self) -> Option<AppServerResponse> {
        self.save_text_draft();
        let Some(index) = self
            .fields
            .iter()
            .enumerate()
            .find(|(index, field)| field.required && self.field_value(*index).is_none())
            .map(|(index, _)| index)
        else {
            if self.response_mode == McpResponseMode::ApprovalAction {
                let selected = self
                    .field_value(0)
                    .and_then(|value| value.as_str().map(str::to_owned));
                let (action, content, meta) = match selected.as_deref() {
                    Some(APPROVAL_ACCEPT_ONCE_VALUE) => (
                        McpServerElicitationAction::Accept,
                        Some(Value::Object(Map::new())),
                        None,
                    ),
                    Some(APPROVAL_ACCEPT_SESSION_VALUE) => (
                        McpServerElicitationAction::Accept,
                        Some(Value::Object(Map::new())),
                        Some(Map::from_iter([(
                            APPROVAL_PERSIST_KEY.to_string(),
                            Value::String(APPROVAL_PERSIST_SESSION_VALUE.to_string()),
                        )])),
                    ),
                    Some(APPROVAL_ACCEPT_ALWAYS_VALUE) => (
                        McpServerElicitationAction::Accept,
                        Some(Value::Object(Map::new())),
                        Some(Map::from_iter([(
                            APPROVAL_PERSIST_KEY.to_string(),
                            Value::String(APPROVAL_PERSIST_ALWAYS_VALUE.to_string()),
                        )])),
                    ),
                    Some(APPROVAL_DECLINE_VALUE) => {
                        (McpServerElicitationAction::Decline, None, None)
                    }
                    Some(APPROVAL_CANCEL_VALUE) => (McpServerElicitationAction::Cancel, None, None),
                    _ => return None,
                };
                self.done = true;
                return Some(AppServerResponse::McpElicitation {
                    id: self.id.clone(),
                    response: McpServerElicitationRequestResponse {
                        action,
                        content,
                        meta,
                    },
                });
            }
            let content = self
                .fields
                .iter()
                .enumerate()
                .filter_map(|(index, field)| {
                    self.field_value(index)
                        .map(|value| (field.id.clone(), value))
                })
                .collect::<Map<_, _>>();
            self.done = true;
            return Some(AppServerResponse::McpElicitation {
                id: self.id.clone(),
                response: McpServerElicitationRequestResponse {
                    action: McpServerElicitationAction::Accept,
                    content: Some(Value::Object(content)),
                    meta: None,
                },
            });
        };

        self.current_field = index;
        self.validation_error = true;
        self.restore_text_field();
        None
    }

    fn cancel_response(&mut self) -> AppServerResponse {
        self.done = true;
        AppServerResponse::McpElicitation {
            id: self.id.clone(),
            response: McpServerElicitationRequestResponse {
                action: McpServerElicitationAction::Cancel,
                content: None,
                meta: None,
            },
        }
    }

    fn field_value(&self, index: usize) -> Option<Value> {
        let field = self.fields.get(index)?;
        let state = self.states.get(index)?;
        match (&field.input, state) {
            (McpFieldInput::Text { .. }, McpFieldState::Text { draft, committed }) => committed
                .then(|| draft.text_with_pending().trim().to_string())
                .filter(|value| !value.is_empty())
                .map(Value::String),
            (
                McpFieldInput::Select { options, .. },
                McpFieldState::Select {
                    selected,
                    committed,
                },
            ) => committed
                .then(|| {
                    selected.and_then(|index| options.get(index).map(|option| option.value.clone()))
                })
                .flatten(),
            _ => None,
        }
    }

    fn current_options(&self) -> &[McpOption] {
        match self
            .fields
            .get(self.current_field)
            .map(|field| &field.input)
        {
            Some(McpFieldInput::Select { options, .. }) => options,
            _ => &[],
        }
    }

    fn current_select_state_mut(&mut self) -> Option<(&mut Option<usize>, &mut bool)> {
        match self.states.get_mut(self.current_field) {
            Some(McpFieldState::Select {
                selected,
                committed,
            }) => Some((selected, committed)),
            _ => None,
        }
    }

    fn is_select_field(&self) -> bool {
        matches!(
            self.fields
                .get(self.current_field)
                .map(|field| &field.input),
            Some(McpFieldInput::Select { .. })
        )
    }

    pub(super) fn is_text_field(&self) -> bool {
        !self.is_select_field()
    }

    #[cfg(test)]
    pub(super) fn is_complete(&self) -> bool {
        self.done
    }
}

mod input;
pub(super) mod render;
mod schema;
use schema::*;

#[cfg(test)]
#[path = "mcp_server_elicitation/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mcp_server_elicitation/input_tests.rs"]
mod input_tests;

#[cfg(test)]
#[path = "mcp_server_elicitation/stdio_tests.rs"]
mod stdio_tests;

#[cfg(all(test, unix))]
#[path = "mcp_server_elicitation/pty_tests.rs"]
mod pty_tests;
