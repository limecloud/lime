//! Width-aware shortcut reference above the composer; measurement and painting share one model.

use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::app::App;
use crate::keymap::{EditorAction, GlobalKeymapAction, PagerKeymapAction};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::{Locale, ShortcutLabel as Label};
use crate::shortcut_help::Group;
use crate::style::{accent_style, footer_hint_label_style};
use crate::wrapping::word_wrap_lines;

pub(crate) fn toggle_available(app: &App) -> bool {
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    [KeyModifiers::NONE, KeyModifiers::SHIFT]
        .into_iter()
        .all(|modifiers| {
            !app.runtime_keymap
                .transcript()
                .reserves_global_key(KeyEvent::new(KeyCode::Char('?'), modifiers))
        })
}

pub(crate) fn visible(app: &App) -> bool {
    app.chat_widget
        .bottom_pane
        .composer
        .shortcut_overlay_visible()
        && !app.chat_widget.bottom_pane.is_active()
        && app.chat_widget.model_picker.is_none()
        && app.chat_widget.agent_picker.is_none()
        && app.chat_widget.agents_overview.is_none()
        && app.chat_widget.resume_picker.is_none()
        && app.chat_widget.export_picker.is_none()
        && app.chat_widget.pager_overlay.is_none()
        && !app.chat_widget.transcript_search.is_active()
        && !app.chat_widget.transcript_selection.is_active()
}

pub(crate) fn agents_hint(app: &App) -> Option<String> {
    app.runtime_keymap
        .transcript()
        .global_hint(GlobalKeymapAction::OpenAgents)
        .or_else(|| {
            app.chat_widget
                .bottom_pane
                .composer
                .agents_navigation_available()
                .then(|| "←".to_string())
        })
}

pub(crate) fn lines(app: &App, width: u16) -> Vec<Line<'static>> {
    let locale = app.locale;
    let label = |kind| locale.shortcut_label(kind);
    let mut compose = Group {
        title: label(Label::Compose),
        entries: Vec::new(),
    };
    for (key, kind) in [
        ("/", Label::Commands),
        ("@", Label::MentionFiles),
        ("$", Label::Skills),
    ] {
        compose.push(Some(key.into()), label(kind));
    }
    compose.push(
        app.runtime_keymap
            .editor
            .primary_hint(EditorAction::InsertNewline),
        label(Label::NewLine),
    );
    for (key, kind) in [
        ("ctrl+v", Label::PasteImage),
        ("ctrl+g", Label::ExternalEditor),
        ("ctrl+r", Label::SearchHistory),
    ] {
        compose.push(Some(key.into()), label(kind));
    }
    let running = app.projection.active_turn_id().is_some();
    let mut session = Group {
        title: label(Label::Session),
        entries: Vec::new(),
    };
    session.push(
        Some("tab".into()),
        label(if running {
            Label::QueueMessage
        } else {
            Label::SendMessage
        }),
    );
    if !app.chat_widget.model_catalog.collaboration_modes.is_empty() && !running {
        session.push(Some("shift+tab".into()), label(Label::ChangeMode));
    }
    session.push(Some("alt+,".into()), label(Label::LessReasoning));
    session.push(Some("alt+.".into()), label(Label::MoreReasoning));
    session.push(agents_hint(app), label(Label::Agents));
    session.push(
        Some("ctrl+c".into()),
        label(if running {
            Label::Interrupt
        } else {
            Label::Quit
        }),
    );

    let keymap = app.runtime_keymap.transcript();
    let mut transcript = Group {
        title: label(Label::Transcript),
        entries: Vec::new(),
    };
    transcript.push(
        keymap.global_hint(GlobalKeymapAction::OpenTranscript),
        label(Label::OpenTranscript),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::Find),
        label(Label::FindText),
    );
    transcript.push(Some("f4".into()), label(Label::InspectActivity));
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::PageUp),
        label(Label::ScrollUp),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::PageDown),
        label(Label::ScrollDown),
    );
    transcript.push(Some("ctrl+space".into()), label(Label::StartSelection));
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::JumpTop),
        label(Label::Top),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::JumpBottom),
        label(Label::Latest),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::Close),
        label(Label::Close),
    );

    let mut result = vec![Line::from(label(Label::Title)).bold(), Line::default()];
    result.extend(crate::shortcut_help::group_lines(
        [compose, session, transcript],
        width,
    ));
    result.push(Line::default());
    result.extend(customization_lines(locale, width));
    word_wrap_lines(&result, usize::from(width.max(1)))
}

pub(crate) fn desired_height(app: &App, width: u16) -> u16 {
    u16::try_from(lines(app, width.saturating_sub(1)).len()).unwrap_or(u16::MAX)
}

fn customization_lines(locale: Locale, width: u16) -> Vec<Line<'static>> {
    // Lime has a real config/read keymap contract, not a /keymap command; never advertise a dead action.
    word_wrap_lines(
        [Line::from(vec![
            Span::styled("tui.keymap", accent_style().not_bold()),
            Span::styled(
                format!(" {}", locale.shortcut_label(Label::Customize)),
                footer_hint_label_style(),
            ),
        ])],
        usize::from(width.max(1)),
    )
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, app: &App) {
    if area.is_empty() {
        return;
    }
    frame.render_widget(Clear, area);
    let content = Rect::new(
        area.x.saturating_add(1),
        area.y,
        area.width.saturating_sub(1),
        area.height,
    );
    if content.is_empty() {
        return;
    }
    let mut body = lines(app, content.width);
    let height = usize::from(content.height);
    if body.len() > height {
        let mut footer = customization_lines(app.locale, content.width);
        footer.truncate(height);
        let body_height = height.saturating_sub(footer.len());
        body.truncate(body_height.saturating_sub(1));
        if body_height > 0 {
            body.push(Line::from(app.locale.shortcut_label(Label::Resize)).dim());
        }
        body.extend(footer);
    }
    frame.render_widget(Paragraph::new(body), content);
}

pub(crate) fn render_close_hint(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let width = usize::from(area.width.saturating_sub(1));
    let label = app.locale.shortcut_label(Label::Close);
    let full = if toggle_available(app) {
        format!("? / esc {label}")
    } else {
        format!("esc {label}")
    };
    let text = if crate::width::display_width(&full) <= width {
        full
    } else {
        format!("esc {label}")
    };
    let line = Line::from(Span::styled(format!(" {text}"), footer_hint_label_style()));
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(line, width + 1)),
        area,
    );
}

#[cfg(test)]
#[path = "shortcut_overlay_tests.rs"]
mod tests;
