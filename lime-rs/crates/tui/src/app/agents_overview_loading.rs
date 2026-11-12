//! Immediate feedback while a selected agent session resumes.
//!
//! The event loop cannot process scheduled frames while it awaits the resume
//! RPC, so this screen is drawn directly through the same renderer.

use crate::app::App;
use crate::locale::Locale;
use crate::tui::Tui;
use ratatui::style::Stylize;
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub(crate) fn draw(tui: &mut Tui, app: &App) -> std::io::Result<()> {
    let label = app.chat_widget.locale.agent_center_label("Loading task…");
    tui.draw(crate::view::cursor_style(app), Some(label), |frame| {
        render(frame, app.chat_widget.locale)
    })
}

pub(crate) fn render(frame: &mut Frame<'_>, locale: Locale) {
    let area = frame.area();
    let lines = textwrap::wrap(
        locale.agent_center_label("Loading task…"),
        usize::from(area.width.max(1)),
    )
    .into_iter()
    .map(|line| ratatui::text::Line::from(line.into_owned()).bold())
    .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(lines), area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale::Locale;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    fn screen(locale: Locale) -> String {
        let mut terminal = Terminal::new(TestBackend::new(40, 6)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, locale))
            .expect("draw loading screen");
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    #[test]
    fn renders_without_panicking_in_a_one_column_viewport() {
        let mut terminal = Terminal::new(TestBackend::new(1, 1)).expect("test terminal");
        terminal
            .draw(|frame| render(frame, Locale::EnUs))
            .expect("narrow loading screen");
    }

    #[test]
    fn draws_the_localized_loading_task_label() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let expected = locale.agent_center_label("Loading task…");
            let screen = screen(locale);
            // Wide glyphs leave their continuation cell blank in the buffer.
            let compact = |text: &str| {
                text.chars()
                    .filter(|character| !character.is_whitespace())
                    .collect::<String>()
            };
            assert!(
                compact(&screen).contains(&compact(expected)),
                "{locale:?} must render {expected:?}; screen: {screen:?}"
            );
        }
    }
}
