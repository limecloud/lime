use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::widgets::Clear;
use ratatui::Frame;

use super::scroll_state::ScrollState;
use super::selection_popup_common::{measure_rows_height, render_rows};
use super::selection_row_layout::SelectionRow;
use crate::locale::Locale;
use crate::slash_command::{command_filter, SlashCommand};

/// Actions returned to the composer host after handling one popup event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandPopupAction {
    Pass,
    Consumed,
    Cancel,
    Complete(SlashCommand),
    Execute(SlashCommand),
}

/// Slash-command completion state owned by the bottom pane composer.
///
/// The command catalog remains in `slash_command`; this type owns only the popup
/// lifecycle, selection, and terminal rendering. Keeping those responsibilities
/// together matches the Codex bottom-pane owner without introducing a second
/// command parser.
#[derive(Debug, Clone)]
pub(crate) struct CommandPopup {
    filter: String,
    state: ScrollState,
}

impl CommandPopup {
    pub(crate) fn for_composer(text: &str) -> Option<Self> {
        let filter = command_filter(text)?.to_ascii_lowercase();
        let mut popup = Self {
            filter,
            state: ScrollState::default(),
        };
        popup.state.clamp_selection(popup.matches().len());
        (!popup.matches().is_empty()).then_some(popup)
    }

    pub(crate) fn update(&mut self, text: &str) -> bool {
        let Some(filter) = command_filter(text) else {
            return false;
        };
        let filter = filter.to_ascii_lowercase();
        if self.filter != filter {
            self.state.reset();
        }
        self.filter = filter;
        let matches = self.matches();
        if matches.is_empty() {
            return false;
        }
        self.state.clamp_selection(matches.len());
        true
    }

    #[cfg(test)]
    fn commands(&self) -> Vec<SlashCommand> {
        self.matches()
    }

    pub(crate) fn selected(&self) -> Option<SlashCommand> {
        self.state
            .selected_idx
            .and_then(|index| self.matches().get(index).copied())
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> CommandPopupAction {
        let Event::Key(key) = event else {
            return CommandPopupAction::Pass;
        };
        if key.kind == KeyEventKind::Release {
            return CommandPopupAction::Pass;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('p')
                if key.code == KeyCode::Up || key.modifiers == KeyModifiers::CONTROL =>
            {
                let len = self.matches().len();
                self.state.move_up_wrap(len);
                CommandPopupAction::Consumed
            }
            KeyCode::Down | KeyCode::Char('n')
                if key.code == KeyCode::Down || key.modifiers == KeyModifiers::CONTROL =>
            {
                let len = self.matches().len();
                self.state.move_down_wrap(len);
                CommandPopupAction::Consumed
            }
            KeyCode::Esc => CommandPopupAction::Cancel,
            KeyCode::Tab => self
                .selected()
                .map(CommandPopupAction::Complete)
                .unwrap_or(CommandPopupAction::Consumed),
            KeyCode::Char('/') if key.modifiers.is_empty() => self
                .selected()
                .map(CommandPopupAction::Complete)
                .unwrap_or(CommandPopupAction::Pass),
            KeyCode::Enter if key.modifiers.is_empty() => self
                .selected()
                .map(|command| {
                    if command.requires_argument() {
                        CommandPopupAction::Complete(command)
                    } else {
                        CommandPopupAction::Execute(command)
                    }
                })
                .unwrap_or(CommandPopupAction::Consumed),
            _ => CommandPopupAction::Pass,
        }
    }

    fn matches(&self) -> Vec<SlashCommand> {
        SlashCommand::ALL
            .into_iter()
            .filter(|command| command.command().starts_with(&self.filter))
            .collect()
    }

    fn rows(&self, locale: Locale) -> Vec<SelectionRow> {
        self.matches()
            .into_iter()
            .enumerate()
            .map(|(index, command)| {
                let mut row = SelectionRow::new(
                    format!("/{}", command.command()),
                    Some(command.description(locale).to_string()),
                    vec![if Some(index) == self.state.selected_idx {
                        "› "
                    } else {
                        "  "
                    }
                    .into()],
                );
                row.match_indices = (!self.filter.is_empty())
                    .then(|| (1..1 + self.filter.chars().count()).collect());
                row
            })
            .collect()
    }
}

#[cfg(test)]
fn render(frame: &mut Frame<'_>, composer_area: Rect, popup: &CommandPopup, locale: Locale) {
    render_with_clip_top(frame, composer_area, popup, locale, 0);
}

pub(crate) fn render_with_clip_top(
    frame: &mut Frame<'_>,
    composer_area: Rect,
    popup: &CommandPopup,
    locale: Locale,
    clip_top: u16,
) {
    let rows = popup.rows(locale);
    if rows.is_empty() || composer_area.width == 0 {
        return;
    }
    let available_above = composer_area.y.saturating_sub(clip_top);
    let height = measure_rows_height(&rows, &popup.state, composer_area.width).min(available_above);
    if height == 0 {
        return;
    }
    let area = Rect::new(
        composer_area.x,
        composer_area.y.saturating_sub(height),
        composer_area.width,
        height,
    );
    frame.render_widget(Clear, area);
    render_rows(frame, area, &rows, &popup.state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    #[test]
    fn filters_by_prefix_and_wraps_selection() {
        let mut popup = CommandPopup::for_composer("/").expect("popup");
        assert_eq!(popup.selected(), Some(SlashCommand::Model));
        assert_eq!(
            popup.handle_event(&Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE,))),
            CommandPopupAction::Consumed
        );
        assert_eq!(popup.selected(), SlashCommand::ALL.last().copied());
        assert!(popup.update("/per"));
        assert_eq!(popup.commands(), vec![SlashCommand::Permissions]);
        assert_eq!(popup.selected(), Some(SlashCommand::Permissions));
        assert!(!popup.update("/unknown"));
    }

    #[test]
    fn enter_executes_immediate_commands_and_completes_argument_commands() {
        let event = Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let mut model = CommandPopup::for_composer("/m").expect("model popup");
        assert_eq!(
            model.handle_event(&event),
            CommandPopupAction::Execute(SlashCommand::Model)
        );
        let mut effort = CommandPopup::for_composer("/e").expect("effort popup");
        assert_eq!(
            effort.handle_event(&event),
            CommandPopupAction::Complete(SlashCommand::Effort)
        );
    }

    #[test]
    fn control_navigation_matches_codex_list_bindings() {
        let mut popup = CommandPopup::for_composer("/").expect("popup");
        let first = popup.selected().expect("first command");

        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::CONTROL,
        )));
        let second = popup.selected().expect("second command");
        assert_ne!(second, first);

        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('p'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(popup.selected(), Some(first));

        for ch in ['j', 'k'] {
            assert_eq!(
                popup.handle_event(&Event::Key(KeyEvent::new(
                    KeyCode::Char(ch),
                    KeyModifiers::CONTROL,
                ))),
                CommandPopupAction::Pass
            );
            assert_eq!(popup.selected(), Some(first));
        }
    }

    #[test]
    fn repeated_navigation_wraps_but_altgr_does_not_navigate() {
        let mut popup = CommandPopup::for_composer("/").unwrap();
        let first = popup.selected();
        let repeat = |code, modifiers| {
            Event::Key(KeyEvent::new_with_kind(
                code,
                modifiers,
                KeyEventKind::Repeat,
            ))
        };
        assert_eq!(
            popup.handle_event(&repeat(KeyCode::Up, KeyModifiers::NONE)),
            CommandPopupAction::Consumed
        );
        assert_eq!(popup.selected(), popup.commands().last().copied());
        assert_eq!(
            popup.handle_event(&repeat(KeyCode::Char('n'), KeyModifiers::CONTROL)),
            CommandPopupAction::Consumed
        );
        assert_eq!(popup.selected(), first);
        for ch in ['p', 'n'] {
            assert_eq!(
                popup.handle_event(&repeat(
                    KeyCode::Char(ch),
                    KeyModifiers::CONTROL | KeyModifiers::ALT
                )),
                CommandPopupAction::Pass
            );
            assert_eq!(popup.selected(), first);
        }
    }

    #[test]
    fn non_key_and_key_release_events_do_not_change_popup_state() {
        let mut popup = CommandPopup::for_composer("/m").expect("popup");
        let selected = popup.selected();
        assert_eq!(
            popup.handle_event(&Event::Resize(20, 5)),
            CommandPopupAction::Pass
        );
        assert_eq!(popup.selected(), selected);
        let mut release = KeyEvent::new(KeyCode::Down, KeyModifiers::NONE);
        release.kind = KeyEventKind::Release;
        assert_eq!(
            popup.handle_event(&Event::Key(release)),
            CommandPopupAction::Pass
        );
        assert_eq!(popup.selected(), selected);
    }

    #[test]
    fn empty_filter_keeps_catalog_order_and_narrow_render_is_bounded() {
        let popup = CommandPopup::for_composer("/").expect("popup");
        assert_eq!(popup.commands().first(), Some(&SlashCommand::Model));
        let mut terminal = Terminal::new(TestBackend::new(10, 4)).expect("terminal");
        terminal
            .draw(|frame| render(frame, Rect::new(0, 3, 10, 1), &popup, Locale::EnUs))
            .expect("draw");
        let row = (0..10)
            .map(|x| terminal.backend().buffer()[(x, 2)].symbol())
            .collect::<String>();
        assert!(row.chars().count() <= 10);
    }

    #[test]
    fn test_backend_renders_commands_and_localized_descriptions() {
        let popup = CommandPopup::for_composer("/").expect("popup");
        let mut terminal = Terminal::new(TestBackend::new(72, 10)).expect("terminal");
        terminal
            .draw(|frame| render(frame, Rect::new(0, 8, 72, 2), &popup, Locale::ZhCn))
            .expect("draw");
        let buffer = terminal.backend().buffer();
        let text = (0..buffer.area.height)
            .map(|y| {
                (0..buffer.area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let compact = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();

        assert!(text.contains("/model"));
        assert!(compact.contains("选择模型"), "{text}");
        assert!(text.contains("/title"));
    }

    #[test]
    fn long_catalog_keeps_selected_row_visible_with_a_bounded_popup() {
        let mut popup = CommandPopup::for_composer("/").expect("popup");
        for _ in 0..10 {
            let _ = popup.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Down,
                KeyModifiers::NONE,
            )));
        }
        let selected = popup.selected().expect("selected command");
        let mut terminal = Terminal::new(TestBackend::new(72, 16)).expect("terminal");
        terminal
            .draw(|frame| render(frame, Rect::new(0, 15, 72, 1), &popup, Locale::EnUs))
            .expect("draw");
        let buffer = terminal.backend().buffer();
        let rows_with_marker = (0..buffer.area.height)
            .filter(|y| {
                let row = (0..buffer.area.width)
                    .map(|x| buffer[(x, *y)].symbol())
                    .collect::<String>();
                row.contains(&format!("› /{}", selected.command()))
            })
            .count();
        assert_eq!(rows_with_marker, 1);
        assert!(popup.commands().len() > super::super::selection_row_layout::MAX_POPUP_ROWS);
    }

    #[test]
    fn changing_filter_resets_selection_after_scrolling() {
        let mut popup = CommandPopup::for_composer("/").unwrap();
        for _ in 0..10 {
            popup.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Down,
                KeyModifiers::NONE,
            )));
        }
        assert!(popup.state.scroll_top > 0);
        assert!(popup.update("/p"));
        assert_eq!(popup.selected(), Some(SlashCommand::Plan));
        assert_eq!(popup.state.scroll_top, 0);
        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Down,
            KeyModifiers::NONE,
        )));
        let selected = popup.selected();
        assert!(popup.update("/p"));
        assert_eq!(popup.selected(), selected);
    }

    #[test]
    fn localized_wrapped_rows_keep_later_choices_visible_on_short_terminals() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in [20, 28, 40, 80] {
                let mut popup = CommandPopup::for_composer("/p").unwrap();
                popup.handle_event(&Event::Key(KeyEvent::new(
                    KeyCode::Down,
                    KeyModifiers::NONE,
                )));
                let mut terminal = Terminal::new(TestBackend::new(width, 6)).unwrap();
                terminal
                    .draw(|frame| render(frame, Rect::new(0, 5, width, 1), &popup, locale))
                    .unwrap();
                let text = terminal
                    .backend()
                    .buffer()
                    .content
                    .iter()
                    .map(|cell| cell.symbol())
                    .collect::<String>();
                assert!(text.contains("› /per"), "{locale:?} {width}: {text}");
            }
        }
    }
}
