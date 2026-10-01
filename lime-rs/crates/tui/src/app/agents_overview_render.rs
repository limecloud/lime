//! Read-only task details reuse canonical metadata and the shared Markdown renderer.

use super::AgentsOverviewView;
use crate::locale::Locale;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::widgets::{Paragraph, Widget};

pub(super) fn render_details(
    area: Rect,
    buf: &mut Buffer,
    view: &AgentsOverviewView,
    locale: Locale,
) {
    let Some(task) = view.selected_row() else {
        return;
    };
    let width = usize::from(area.width);
    let (status, dot) = super::command_center::rows::status(task, locale);
    let title =
        super::command_center::display_title(task, locale.agent_center_label("Untitled task"));
    let mut lines = vec![
        Line::from(locale.agent_center_label("Task details").bold()),
        Line::default(),
        crate::line_truncation::truncate_line_with_ellipsis_if_overflow(
            Line::from(title.bold()),
            width,
        ),
        Line::from(vec![dot, " ".into(), status.into()]),
        Line::default(),
        Line::from(locale.agent_center_label("Project").dim()),
        Line::from(task.thread.cwd.display().to_string()),
    ];
    if let Some(branch) = task
        .thread
        .git_info
        .as_ref()
        .and_then(|git| git.branch.as_ref())
    {
        lines.extend([
            Line::default(),
            locale.agent_center_label("Branch").dim().into(),
            branch.clone().into(),
        ]);
    }
    lines.extend([
        Line::default(),
        locale.agent_center_label("Prompt").dim().into(),
    ]);
    let preview = task
        .thread
        .preview
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .take(512)
        .collect::<String>();
    let prompt = if preview.is_empty() {
        locale.agent_center_label("No prompt available.")
    } else {
        &preview
    };
    let prompt = crate::markdown_render::render_markdown_lines_with_width_and_cwd(
        prompt,
        ratatui::style::Style::default(),
        Some(width),
        task.thread.cwd.as_path(),
    );
    let mut prompt =
        crate::wrapping::word_wrap_lines(prompt.into_iter().map(|line| line.line), width);
    if prompt.len() > 2 {
        prompt.truncate(2);
        prompt[1] = "…".dim().into();
    }
    lines.extend(prompt);
    Paragraph::new(crate::wrapping::word_wrap_lines(lines, width)).render(area, buf);
}

#[cfg(test)]
mod tests {
    use super::super::render;
    use super::*;
    use crate::app::agents_overview_view::{AgentsOverviewGroup, AgentsOverviewRow};
    use app_server_protocol::protocol::v2::{SessionSource, ThreadHistoryMode, ThreadStatus};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use std::path::PathBuf;

    fn row(id: &str) -> AgentsOverviewRow {
        AgentsOverviewRow {
            thread: app_server_protocol::protocol::v2::Thread {
                id: id.to_string(),
                extra: None,
                session_id: id.to_string(),
                forked_from_id: None,
                parent_thread_id: None,
                preview: "preview".to_string(),
                ephemeral: false,
                section: None,
                section_entered_at: None,
                project_id: None,
                history_mode: ThreadHistoryMode::Legacy,
                model_provider: "test".to_string(),
                created_at: 1,
                updated_at: 1,
                recency_at: Some(1),
                status: ThreadStatus::Idle,
                path: None,
                cwd: PathBuf::from("/workspace"),
                cli_version: "test".to_string(),
                source: SessionSource::Cli,
                can_accept_direct_input: Some(true),
                thread_source: None,
                agent_nickname: None,
                agent_role: None,
                git_info: None,
                name: Some(id.to_string()),
                turns: Vec::new(),
            },
            group: AgentsOverviewGroup::Ready,
            is_current: false,
        }
    }

    #[test]
    fn overview_render_is_bounded_on_wide_and_narrow_terminals() {
        let view = AgentsOverviewView::new(vec![row("alpha"), row("beta")], None);
        for (width, height) in [(120, 30), (24, 10), (16, 8)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
            terminal
                .draw(|frame| render(frame, frame.area(), &view, Locale::EnUs, None))
                .expect("draw");
        }
    }

    #[test]
    fn overview_render_shows_localized_new_task_input_without_overflow() {
        let mut view = AgentsOverviewView::new(vec![row("alpha")], None);
        view.handle_event(crossterm::event::Event::Key(
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Char('n'),
                crossterm::event::KeyModifiers::NONE,
            ),
        ));
        for character in "检查任务".chars() {
            view.handle_event(crossterm::event::Event::Key(
                crossterm::event::KeyEvent::new(
                    crossterm::event::KeyCode::Char(character),
                    crossterm::event::KeyModifiers::NONE,
                ),
            ));
        }
        let mut terminal = Terminal::new(TestBackend::new(24, 10)).expect("terminal");
        terminal
            .draw(|frame| render(frame, frame.area(), &view, Locale::ZhCn, None))
            .expect("draw");
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        let compact = text.chars().filter(|character| !character.is_whitespace());
        let compact = compact.collect::<String>();
        assert!(compact.contains("新建任务"), "{text}");
        assert!(compact.contains("检查任务"), "{text}");
    }

    #[test]
    fn overview_render_uses_selection_row_for_status_and_current_context() {
        let mut current = row("current");
        current.group = AgentsOverviewGroup::Ready;
        current.is_current = true;
        current.thread.cwd = PathBuf::from("/workspace/project");
        let view = AgentsOverviewView::new(vec![current], Some("current"));
        let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");
        terminal
            .draw(|frame| render(frame, frame.area(), &view, Locale::EnUs, None))
            .expect("draw");
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        assert!(text.contains("○"), "selection row marker missing: {text}");
        assert!(text.contains("current"), "current context missing: {text}");
        assert!(text.contains("Ready"), "status description missing: {text}");
        let compact = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        assert!(compact.contains("/"), "cwd prefix missing: {text}");
        assert!(compact.contains("workspace/"), "cwd prefix missing: {text}");
        assert!(compact.contains("project"), "cwd tail missing: {text}");
    }

    #[test]
    fn overview_render_exposes_show_more_and_retry_states() {
        let mut view = AgentsOverviewView::new(vec![row("current")], None);
        view.set_pagination(true, false, false);
        let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");
        terminal
            .draw(|frame| render(frame, frame.area(), &view, Locale::EnUs, None))
            .expect("draw");
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        assert!(text.contains("Show more"), "show more row missing: {text}");

        view.set_pagination(true, false, true);
        terminal
            .draw(|frame| render(frame, frame.area(), &view, Locale::EnUs, None))
            .expect("draw");
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        assert!(
            text.contains("Show more (retry)"),
            "retry row missing: {text}"
        );
    }
}
