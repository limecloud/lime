use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use std::time::Instant;

use super::mcp_server_elicitation;
use super::request_user_input::render as request_user_input_render;
use super::{BottomPane, PendingInteraction};
use crate::locale::Locale;
use crate::style::attention_style;

pub(crate) fn desired_height_with_locale_for_width(
    pane: &BottomPane,
    locale: Locale,
    width: u16,
) -> u16 {
    if !pane.is_active() {
        return pane.composer.desired_height_for_width(width).clamp(3, 12);
    }
    if matches!(pane.current(), Some(PendingInteraction::Approval(_))) {
        return super::approval_render::desired_height(pane, locale, width);
    }
    if let Some(PendingInteraction::UserInput(request)) = pane.current() {
        return request_user_input_render::desired_height(request, locale, width);
    }
    // The interaction surface only has top/bottom borders, so its text width is the full
    // terminal width. Measuring with a narrower width would under-allocate the pane and clip
    // wrapped CJK/emoji content on narrow terminals.
    let content_width = width.max(1);
    let content = lines_with_locale(pane, locale, usize::from(content_width), Instant::now());
    let lines = Paragraph::new(content)
        .wrap(Wrap { trim: false })
        .line_count(content_width)
        .saturating_add(2);
    u16::try_from(lines).unwrap_or(u16::MAX).clamp(5, 18)
}

pub(crate) fn render_with_locale(
    frame: &mut Frame<'_>,
    area: Rect,
    pane: &BottomPane,
    locale: Locale,
) {
    if !pane.is_active() {
        pane.composer.render(frame, area, locale);
        return;
    }
    if matches!(pane.current(), Some(PendingInteraction::Approval(_))) {
        super::approval_render::render(frame, area, pane, locale);
        return;
    }
    if let Some(PendingInteraction::UserInput(request)) = pane.current() {
        request_user_input_render::render(frame, area, request, locale);
        return;
    }
    let block = Block::default()
        .borders(Borders::TOP | Borders::BOTTOM)
        .border_style(attention_style());
    let inner = block.inner(area);
    let content = lines_with_locale(pane, locale, inner.width as usize, Instant::now());
    frame.render_widget(
        Paragraph::new(content.clone())
            .block(block)
            .wrap(Wrap { trim: false }),
        area,
    );

    if let Some(PendingInteraction::McpElicitation(request)) = pane.current() {
        mcp_server_elicitation::render::set_cursor_position(frame, inner, request, &content);
    }
}

impl BottomPane {
    /// Paint popup layers after the footer, using the same composer layout and state.
    pub(crate) fn render_popups(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
        clip_top: u16,
    ) {
        if self.is_active() {
            return;
        }
        if let Some(popup) = self.composer.command_popup() {
            super::command_popup::render_with_clip_top(frame, area, popup, locale, clip_top);
        }
        if let Some(popup) = self.composer.file_search_popup() {
            popup.render_with_clip_top(frame, area, locale, clip_top);
        }
        if let Some(popup) = self.composer.skill_popup() {
            popup.render_with_clip_top(frame, area, locale, clip_top);
        }
    }
}

fn lines_with_locale(
    pane: &BottomPane,
    locale: Locale,
    width: usize,
    _now: Instant,
) -> Vec<Line<'static>> {
    let mut lines = match pane.current() {
        Some(PendingInteraction::McpElicitation(request)) => {
            mcp_server_elicitation::render::lines_with_locale_with_width(request, locale, width)
        }
        Some(PendingInteraction::Approval(_) | PendingInteraction::UserInput(_)) | None => {
            Vec::new()
        }
    };
    if let Some(title) = pane.action_required_title(locale) {
        lines.insert(0, Line::styled(title, crate::style::attention_style()));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{
        ServerRequest, ToolRequestUserInputOption, ToolRequestUserInputParams,
        ToolRequestUserInputQuestion,
    };
    use app_server_protocol::RequestId;
    use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

    fn request_with_options(count: usize) -> ServerRequest {
        ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(31),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "choice".to_string(),
                    header: "Next step".to_string(),
                    question: "Choose the next step for this task".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: Some(
                        (0..count)
                            .map(|index| ToolRequestUserInputOption {
                                label: format!("Choice {index}"),
                                description: "A deliberately long description for narrow layout"
                                    .to_string(),
                            })
                            .collect(),
                    ),
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        }
    }

    #[test]
    fn request_input_routes_to_the_unbordered_menu_renderer() {
        let mut pane = BottomPane::default();
        pane.enqueue(request_with_options(12))
            .expect("queue request user input");
        for _ in 0..11 {
            pane.handle_event(Event::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)));
        }

        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 18)).unwrap();
        terminal
            .draw(|frame| render_with_locale(frame, frame.area(), &pane, Locale::EnUs))
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(text.contains("› 12. Choice 11"), "{text}");
        assert!(!text.contains('─'), "{text}");
    }

    #[test]
    fn narrow_height_uses_the_same_width_as_rendered_content() {
        let mut pane = BottomPane::default();
        pane.enqueue(request_with_options(2))
            .expect("queue request user input");
        let width = 12u16;
        let Some(PendingInteraction::UserInput(request)) = pane.current() else {
            panic!("expected input request");
        };
        assert_eq!(
            desired_height_with_locale_for_width(&pane, Locale::EnUs, width),
            request_user_input_render::desired_height(request, Locale::EnUs, width)
        );
    }
}
