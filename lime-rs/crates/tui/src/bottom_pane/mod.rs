mod action_required_title;
mod approval_overlay;
mod approval_render;
mod chat_composer;
mod chat_composer_history;
pub(crate) mod command_popup;
mod composer;
pub(crate) mod custom_prompt_view;
mod effort_ignition;
mod effort_status_line;
mod file_search_popup;
mod footer;
mod input;
mod input_state;
pub(crate) mod list_selection_view;
mod mcp_server_elicitation;
pub(crate) mod multi_select_picker;
pub(crate) mod paste_burst;
pub(crate) mod pending_input_preview;
mod picker_rows;
mod render;
mod request_user_input;
mod scroll_state;
mod selection_popup_common;
pub(crate) mod selection_row_layout;
mod selection_tabs;
pub(crate) mod shortcut_overlay;
mod skill_popup;
pub(crate) mod status_line_setup;
pub(crate) mod status_surface_preview;
mod textarea;
pub(crate) mod title_setup;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MentionBinding {
    /// Visible mention sigil (`$` or `@`).
    pub(crate) sigil: char,
    /// Token text without the leading sigil.
    pub(crate) mention: String,
    /// Canonical target, such as an absolute SKILL.md path.
    pub(crate) path: String,
}

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use app_server_protocol::protocol::v2::{
    CommandExecutionRequestApprovalResponse, FileChangeRequestApprovalResponse,
    McpServerElicitationRequestResponse, PermissionsRequestApprovalResponse, ServerRequest,
    ToolRequestUserInputResponse,
};
use app_server_protocol::RequestId;
use crossterm::event::{Event, KeyEvent};

use action_required_title::{
    build_action_required_title_text, ActionRequiredItem, ACTION_REQUIRED_PREVIEW_PREFIX,
};
use approval_overlay::ApprovalOverlay;
use chat_composer::ChatComposer;
pub(crate) use chat_composer::{ComposerDraft, FileSearchRequest, InputResult};
use file_search_popup::FileSearchPopupAction;
use mcp_server_elicitation::McpServerElicitationOverlay;
use request_user_input::RequestUserInputOverlay;
use skill_popup::SkillPopupAction;
pub(crate) use textarea::{TextArea, TextAreaState};

pub(crate) use footer::{inset_footer_hint_area, FooterMode, FooterProps};
pub(crate) use input::ChatWidgetAction;
pub(crate) use input_state::BottomPaneInputState;
pub(crate) use render::{desired_height_with_locale_for_width, render_with_locale};
pub(crate) use selection_tabs::render_filled_tab_bar;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalImageAttachment {
    pub(crate) placeholder: String,
    pub(crate) path: std::path::PathBuf,
    pub(crate) detail: Option<agent_protocol::ImageDetail>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RemoteImageAttachment {
    pub(crate) url: String,
    pub(crate) detail: Option<agent_protocol::ImageDetail>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AppServerResponse {
    Command {
        id: RequestId,
        response: CommandExecutionRequestApprovalResponse,
    },
    FileChange {
        id: RequestId,
        response: FileChangeRequestApprovalResponse,
    },
    Permissions {
        id: RequestId,
        response: PermissionsRequestApprovalResponse,
    },
    UserInput {
        id: RequestId,
        response: ToolRequestUserInputResponse,
    },
    McpElicitation {
        id: RequestId,
        response: McpServerElicitationRequestResponse,
    },
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
enum PendingInteraction {
    Approval(ApprovalOverlay),
    UserInput(RequestUserInputOverlay),
    McpElicitation(McpServerElicitationOverlay),
}

impl PendingInteraction {
    fn set_keymap_bindings(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        match self {
            Self::UserInput(request) => request.set_keymap_bindings(keymap),
            Self::McpElicitation(request) => request.set_keymap_bindings(keymap),
            Self::Approval(approval) => approval.set_keymap_bindings(keymap),
        }
    }

    fn from_server_request(request: ServerRequest) -> Result<Self, Box<ServerRequest>> {
        match request {
            request @ (ServerRequest::ItemCommandExecutionRequestApproval { .. }
            | ServerRequest::ItemFileChangeRequestApproval { .. }
            | ServerRequest::ItemPermissionsRequestApproval { .. }) => Ok(Self::Approval(
                ApprovalOverlay::from_server_request(request),
            )),
            ServerRequest::ItemToolRequestUserInput { id, params } => {
                Ok(Self::UserInput(RequestUserInputOverlay::new(id, params)))
            }
            ServerRequest::McpServerElicitationRequest { id, params } => {
                McpServerElicitationOverlay::from_server_request(id.clone(), &params)
                    .map(Self::McpElicitation)
                    .ok_or_else(|| {
                        Box::new(ServerRequest::McpServerElicitationRequest { id, params })
                    })
            }
            request => Err(Box::new(request)),
        }
    }

    fn handle_key_event(&mut self, key: KeyEvent) -> Option<AppServerResponse> {
        match self {
            Self::Approval(approval) => approval.handle_key_event(key),
            Self::UserInput(request) => request.handle_key_event(key),
            Self::McpElicitation(request) => request.handle_key_event(key),
        }
    }

    fn pre_draw_tick(&mut self, now: Instant) -> Option<AppServerResponse> {
        match self {
            Self::UserInput(request) => request.pre_draw_tick(now),
            Self::Approval(_) | Self::McpElicitation(_) => None,
        }
    }

    fn next_frame_delay(&self, now: Instant) -> Option<Duration> {
        match self {
            Self::UserInput(request) => request.next_frame_delay(now),
            Self::Approval(_) | Self::McpElicitation(_) => None,
        }
    }

    fn action_required_item(&self) -> ActionRequiredItem {
        match self {
            Self::Approval(_) => ActionRequiredItem::Approval,
            Self::UserInput(_) => ActionRequiredItem::UserInput,
            Self::McpElicitation(_) => ActionRequiredItem::McpElicitation,
        }
    }

    fn action_required_value(&self, locale: crate::locale::Locale) -> Option<String> {
        match self {
            Self::Approval(approval) => {
                let kind = match &approval.request {
                    approval_overlay::ApprovalRequest::Exec { .. } => "command",
                    approval_overlay::ApprovalRequest::ApplyPatch { .. } => "file",
                    approval_overlay::ApprovalRequest::Permissions { .. } => "permissions",
                };
                Some(locale.approval_title(kind).to_string())
            }
            Self::UserInput(request) => request.action_required_label(locale),
            Self::McpElicitation(request) => Some(request.action_required_label(locale)),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct BottomPane {
    composer: ChatComposer,
    queue: VecDeque<PendingInteraction>,
    keymap: crate::keymap::RuntimeKeymap,
}

impl BottomPane {
    pub(crate) fn set_keymap_bindings(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        self.keymap = keymap.clone();
        self.composer.set_keymap_bindings(keymap);
        for request in &mut self.queue {
            request.set_keymap_bindings(keymap);
        }
    }

    pub(crate) fn approval_details_for_key(
        &self,
        key: KeyEvent,
        locale: crate::locale::Locale,
    ) -> Option<(String, Vec<ratatui::text::Line<'static>>)> {
        use crossterm::event::{KeyCode, KeyEventKind, KeyModifiers};
        let modifiers = key.modifiers;
        if key.kind == KeyEventKind::Press
            && matches!(key.code, KeyCode::Char('a' | 'A'))
            && (modifiers == KeyModifiers::CONTROL
                || modifiers == KeyModifiers::CONTROL | KeyModifiers::SHIFT)
        {
            approval_render::details(self, locale)
        } else {
            None
        }
    }

    pub(crate) fn enqueue(&mut self, request: ServerRequest) -> Result<(), Box<ServerRequest>> {
        let mut interaction = PendingInteraction::from_server_request(request)?;
        interaction.set_keymap_bindings(&self.keymap);
        self.queue.push_back(interaction);
        Ok(())
    }

    pub(crate) fn supports_request(request: &ServerRequest) -> bool {
        match request {
            ServerRequest::McpServerElicitationRequest { id, params } => {
                McpServerElicitationOverlay::from_server_request(id.clone(), params).is_some()
            }
            ServerRequest::DynamicToolCall { .. } => false,
            ServerRequest::CurrentTimeRead { .. }
            | ServerRequest::ItemCommandExecutionRequestApproval { .. }
            | ServerRequest::ItemFileChangeRequestApproval { .. }
            | ServerRequest::ItemPermissionsRequestApproval { .. }
            | ServerRequest::ItemToolRequestUserInput { .. } => true,
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        !self.queue.is_empty()
    }

    /// Returns a localized, display-only title for the visible interaction request.
    ///
    /// The request queue remains the only state owner. This helper deliberately does not expose
    /// request ids or synthesize a status transition; it only supplies the shared presentation
    /// line consumed by the interaction renderer.
    pub(crate) fn action_required_title(&self, locale: crate::locale::Locale) -> Option<String> {
        let request = self.current()?;
        let item = request.action_required_item();
        let prefix = format!(
            "{ACTION_REQUIRED_PREVIEW_PREFIX} {}",
            locale.action_required_label()
        );
        Some(build_action_required_title_text(
            &prefix,
            [item],
            &[],
            |candidate| (candidate == item).then(|| request.action_required_value(locale))?,
        ))
    }

    pub(crate) fn footer_hint_lines(
        &self,
        locale: crate::locale::Locale,
        width: usize,
    ) -> Option<Vec<String>> {
        match self.queue.front() {
            Some(PendingInteraction::Approval(approval)) => {
                Some(vec![approval_render::footer_hint(approval, locale, width)])
            }
            Some(PendingInteraction::UserInput(request)) => {
                Some(request.footer_hint_lines(locale, width))
            }
            // MCP renders its action hints inside the elicitation surface. Keep the outer footer
            // reserved but blank so global composer shortcuts do not compete with the same actions.
            Some(PendingInteraction::McpElicitation(_)) => Some(Vec::new()),
            None => None,
        }
    }

    pub(crate) fn footer_required_height(
        &self,
        locale: crate::locale::Locale,
        width: usize,
    ) -> u16 {
        match self.queue.front() {
            Some(PendingInteraction::UserInput(request)) => {
                request.footer_required_height(locale, width).max(1)
            }
            Some(PendingInteraction::Approval(_))
            | Some(PendingInteraction::McpElicitation(_))
            | None => 1,
        }
    }

    pub(crate) fn clear_interactions(&mut self) {
        self.queue.clear();
    }

    fn current(&self) -> Option<&PendingInteraction> {
        self.queue.front()
    }

    fn handle_interaction_event(&mut self, event: Event) -> Option<AppServerResponse> {
        match event {
            Event::Key(key) => self.handle_interaction_key(key),
            Event::Paste(text) => {
                match self.queue.front_mut() {
                    Some(PendingInteraction::UserInput(request)) => {
                        request.handle_paste(&text);
                    }
                    Some(PendingInteraction::McpElicitation(request)) => {
                        request.handle_paste(&text);
                    }
                    _ => return None,
                }
                None
            }
            _ => None,
        }
    }

    fn handle_interaction_key(&mut self, key: KeyEvent) -> Option<AppServerResponse> {
        let response = self.queue.front_mut()?.handle_key_event(key)?;
        self.queue.pop_front();
        Some(response)
    }

    pub(crate) fn pre_draw_tick(&mut self, now: Instant) -> Option<AppServerResponse> {
        if self.composer.handle_paste_burst_flush(now) {
            self.composer.sync_completion_popup();
        }
        let response = self.queue.front_mut()?.pre_draw_tick(now)?;
        self.queue.pop_front();
        Some(response)
    }

    pub(crate) fn next_frame_delay(&self, now: Instant) -> Option<Duration> {
        let composer = self
            .composer
            .paste_burst_needs_frame()
            .then_some(crate::tui::TARGET_FRAME_INTERVAL);
        let interaction = self
            .queue
            .front()
            .and_then(|view| view.next_frame_delay(now));
        match (composer, interaction) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

#[cfg(test)]
mod keymap_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{
        CommandExecutionRequestApprovalParams, DynamicToolCallParams, DynamicToolCallPhase,
        ToolRequestUserInputOption, ToolRequestUserInputParams, ToolRequestUserInputQuestion,
    };
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use serde_json::json;

    fn key(code: KeyCode) -> Event {
        Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    #[test]
    fn queues_requests_and_resolves_them_in_arrival_order() {
        let mut pane = BottomPane::default();
        pane.enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(1),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");
        pane.enqueue(ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(2),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "mode".to_string(),
                    header: "Mode".to_string(),
                    question: "Choose a mode".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: Some(vec![ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    }]),
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        })
        .expect("queue user input");

        assert_eq!(
            pane.action_required_title(crate::locale::Locale::EnUs),
            Some("[ ! ] Action required Approve command?".to_string())
        );

        let first = pane.handle_interaction_event(key(KeyCode::Enter));
        assert!(matches!(
            first,
            Some(AppServerResponse::Command {
                id: RequestId::Integer(1),
                ..
            })
        ));
        assert!(pane.is_active());

        let second = pane.handle_interaction_event(key(KeyCode::Enter));
        assert!(matches!(
            second,
            Some(AppServerResponse::UserInput {
                id: RequestId::Integer(2),
                ..
            })
        ));
        assert!(!pane.is_active());
    }

    #[test]
    fn action_required_title_localizes_the_shared_prefix() {
        let mut pane = BottomPane::default();
        pane.enqueue(ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(8),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "mode".to_string(),
                    header: "Mode".to_string(),
                    question: "Choose a mode".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: None,
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        })
        .expect("queue user input");

        for (locale, label) in [
            (crate::locale::Locale::ZhCn, "需要操作"),
            (crate::locale::Locale::ZhTw, "需要操作"),
            (crate::locale::Locale::EnUs, "Action required"),
            (crate::locale::Locale::JaJp, "操作が必要"),
            (crate::locale::Locale::KoKr, "조치 필요"),
        ] {
            let title = pane
                .action_required_title(locale)
                .expect("action-required title");
            assert!(title.contains(label), "{locale:?}: {title}");
            assert!(title.ends_with(" Mode"), "{locale:?}: {title}");
        }
    }

    #[test]
    fn mcp_footer_projection_blanks_the_outer_composer_footer() {
        let mut pane = BottomPane::default();
        let request = serde_json::from_value::<ServerRequest>(json!({
            "method": "mcpServer/elicitation/request",
            "id": 7,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "serverName": "form-server",
                "mode": "form",
                "message": "Choose a value",
                "requestedSchema": {
                    "type": "object",
                    "properties": {
                        "confirmed": { "type": "boolean" }
                    }
                }
            }
        }))
        .expect("MCP elicitation request");
        pane.enqueue(request).expect("queue MCP elicitation");

        assert_eq!(
            pane.footer_hint_lines(crate::locale::Locale::EnUs, 80),
            Some(Vec::new())
        );
    }

    #[test]
    fn unsupported_requests_return_for_rejection() {
        let mut pane = BottomPane::default();
        let dynamic_tool = ServerRequest::DynamicToolCall {
            id: RequestId::Integer(3),
            params: DynamicToolCallParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                call_id: "call-1".to_string(),
                namespace: None,
                tool: "browser.open".to_string(),
                arguments: json!({}),
                phase: DynamicToolCallPhase::Preflight,
                approval_token: None,
            },
        };
        assert!(matches!(
            pane.enqueue(dynamic_tool),
            Err(request) if matches!(*request, ServerRequest::DynamicToolCall { .. })
        ));

        let mcp_elicitation = serde_json::from_value::<ServerRequest>(json!({
            "method": "mcpServer/elicitation/request",
            "id": 4,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "serverName": "form-server",
                "mode": "form",
                "message": "Choose a value",
                "requestedSchema": { "type": "object", "properties": {} }
            }
        }))
        .expect("MCP elicitation request");
        assert!(pane.enqueue(mcp_elicitation).is_ok());
        assert!(pane.is_active());
        assert!(matches!(
            pane.handle_interaction_event(key(KeyCode::Enter)),
            Some(AppServerResponse::McpElicitation {
                response: McpServerElicitationRequestResponse {
                    action: app_server_protocol::protocol::v2::McpServerElicitationAction::Accept,
                    content: Some(_),
                    ..
                },
                ..
            })
        ));
        assert!(!pane.is_active());

        let unsupported_tool_suggestion = serde_json::from_value::<ServerRequest>(json!({
            "method": "mcpServer/elicitation/request",
            "id": 6,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "serverName": "form-server",
                "mode": "form",
                "_meta": { "codex_approval_kind": "tool_suggestion" },
                "message": "Install a tool",
                "requestedSchema": { "type": "object", "properties": {} }
            }
        }))
        .expect("tool suggestion MCP elicitation request");
        assert!(matches!(
            pane.enqueue(unsupported_tool_suggestion),
            Err(request) if matches!(*request, ServerRequest::McpServerElicitationRequest { .. })
        ));
        assert!(!pane.is_active());

        let supported_mcp_elicitation = serde_json::from_value::<ServerRequest>(json!({
            "method": "mcpServer/elicitation/request",
            "id": 5,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "serverName": "form-server",
                "mode": "form",
                "message": "Choose a value",
                "requestedSchema": {
                    "type": "object",
                    "properties": {
                        "confirmed": { "type": "boolean" }
                    },
                    "required": ["confirmed"]
                }
            }
        }))
        .expect("supported MCP elicitation request");
        assert!(pane.enqueue(supported_mcp_elicitation).is_ok());
        assert!(pane.is_active());
    }
}
