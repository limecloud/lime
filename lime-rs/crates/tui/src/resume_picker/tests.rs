use super::render::*;
use super::*;
use app_server_protocol::protocol::v2::{SessionSource, ThreadActiveFlag, ThreadHistoryMode};
use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::path::PathBuf;

fn thread(id: &str, preview: &str, ephemeral: bool) -> Thread {
    Thread {
        id: id.to_string(),
        extra: None,
        session_id: format!("session-{id}"),
        forked_from_id: None,
        parent_thread_id: None,
        preview: preview.to_string(),
        ephemeral,
        section: None,
        section_entered_at: None,
        project_id: None,
        history_mode: ThreadHistoryMode::default(),
        model_provider: "fixture".to_string(),
        created_at: 1,
        updated_at: 1,
        recency_at: None,
        status: ThreadStatus::Active {
            active_flags: vec![ThreadActiveFlag::WaitingOnUserInput],
        },
        path: None,
        cwd: PathBuf::from("/workspace"),
        cli_version: "test".to_string(),
        source: SessionSource::Cli,
        can_accept_direct_input: Some(true),
        thread_source: None,
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: None,
        turns: Vec::new(),
    }
}

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[path = "tests/keymap.rs"]
mod keymap;
#[path = "tests/navigation.rs"]
mod navigation;
#[path = "tests/rendering.rs"]
mod rendering;
#[path = "tests/toolbar.rs"]
mod toolbar;
