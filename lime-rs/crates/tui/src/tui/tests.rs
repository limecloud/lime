use super::*;
use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;

#[test]
fn handoff_repaint_preserves_styled_unicode_and_atomic_composer_labels() {
    let mut terminal = RatatuiTerminal::new(TestBackend::new(36, 4)).unwrap();
    let visible_frame = terminal
        .draw(|frame| {
            frame.render_widget(
                Line::styled(
                    "› 界🙂 [Image #1]",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                frame.area(),
            );
        })
        .unwrap()
        .buffer
        .clone();
    terminal.clear().unwrap();
    terminal
        .draw(|frame| repaint_visible_frame(frame, &visible_frame))
        .unwrap();
    assert_eq!(terminal.backend().buffer(), &visible_frame);
}

#[test]
fn handoff_repaint_clips_a_smaller_terminal_without_moving_the_saved_viewport() {
    let mut visible_frame = Buffer::empty(Rect::new(2, 1, 6, 2));
    visible_frame.set_string(2, 1, "abcdef", Style::default());
    visible_frame.set_string(2, 2, "ghijkl", Style::default());
    let mut terminal = RatatuiTerminal::new(TestBackend::new(20, 6)).unwrap();
    terminal.backend_mut().resize(5, 2);
    terminal
        .draw(|frame| repaint_visible_frame(frame, &visible_frame))
        .unwrap();
    assert_eq!(
        terminal.backend().buffer(),
        &Buffer::with_lines(["     ", "  abc"])
    );
}

#[test]
fn handoff_repaint_leaves_newly_visible_cells_empty_after_terminal_growth() {
    let visible_frame = Buffer::with_lines(["XY", "界"]);
    let mut terminal = RatatuiTerminal::new(TestBackend::new(2, 2)).unwrap();
    terminal
        .draw(|frame| frame.render_widget("old", frame.area()))
        .unwrap();
    terminal.backend_mut().resize(8, 4);
    terminal
        .draw(|frame| repaint_visible_frame(frame, &visible_frame))
        .unwrap();
    assert_eq!(
        terminal.backend().buffer(),
        &Buffer::with_lines(["XY      ", "界      ", "        ", "        "])
    );
}
