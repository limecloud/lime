use super::*;
use crate::locale::Locale;
use app_server_protocol::protocol::v2::{
    AgentMessageDeltaNotification, CommandExecutionOutputDeltaNotification,
    CommandExecutionRequestApprovalParams, CommandExecutionSource, FileUpdateChange,
    ItemCompletedNotification, ItemStartedNotification, PatchApplyStatus, PatchChangeKind,
    QueuedSubmission, ServerNotification, ServerRequest, ThreadItem, ToolRequestUserInputParams,
    ToolRequestUserInputQuestion, TurnDiffUpdatedNotification, TurnPlanStep, TurnPlanStepStatus,
    TurnPlanUpdatedNotification, UserInput,
};
use app_server_protocol::RequestId;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::layout::Position;
use ratatui::style::Modifier;
use ratatui::widgets::Wrap;
use ratatui::Terminal;

fn dispatch_connected_input(app: &mut App, event: Event) -> crate::app::AppAction {
    let event = match event {
        Event::Key(key) => crate::tui::TuiEvent::Key(key),
        Event::Paste(text) => crate::tui::TuiEvent::Paste(text),
        Event::Mouse(mouse) => crate::tui::TuiEvent::Mouse(mouse),
        Event::Resize(width, height) => {
            crate::tui::TuiEvent::Resize(ratatui::layout::Size { width, height })
        }
        Event::FocusGained => crate::tui::TuiEvent::FocusGained,
        Event::FocusLost => crate::tui::TuiEvent::FocusLost,
    };
    app.handle_tui_event(event, true)
}

fn apply_completed_message(app: &mut App, turn_id: &str, item: ThreadItem) {
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item,
            thread_id: "thread-1".to_string(),
            turn_id: turn_id.to_string(),
            completed_at_ms: 1,
        },
    ));
}

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| crate::terminal_hyperlinks::strip_osc8(buffer[(x, y)].symbol()))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

mod composer;
mod interaction;
mod navigation;
mod presentation;
mod suggestions;
