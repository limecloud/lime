//! Width-aware shortcut reference above the composer; measurement and painting share one model.

use crossterm::event::{KeyCode, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::app::App;
use crate::bottom_pane::inset_footer_hint_area;
use crate::footer_hint::first_fitting_line;
use crate::keymap::{shortcut_label, EditorAction, GlobalKeymapAction, PagerKeymapAction};
use crate::locale::{Locale, ShortcutLabel as Label};
use crate::shortcut_help::Group;
use crate::style::{accent_style, footer_hint_label_style};
use crate::wrapping::word_wrap_lines;

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
        && app.chat_widget.status_line_setup.is_none()
        && app.chat_widget.terminal_title_setup.is_none()
        && app.chat_widget.pager_overlay.is_none()
        && !app.chat_widget.transcript_search.is_active()
        && !app.chat_widget.transcript_selection.is_active()
}

pub(crate) fn agents_hint(app: &App) -> Option<String> {
    app.chat_widget.agents_hint()
}

pub(crate) fn lines(app: &App, width: u16) -> Vec<Line<'static>> {
    let locale = app.chat_widget.locale;
    let label = |kind| locale.shortcut_label(kind);
    let mut compose = Group {
        title: label(Label::Compose),
        entries: Vec::new(),
    };
    for (key, kind) in [
        (
            shortcut_label(KeyCode::Char('/'), KeyModifiers::NONE),
            Label::Commands,
        ),
        (
            shortcut_label(KeyCode::Char('@'), KeyModifiers::NONE),
            Label::MentionFiles,
        ),
        (
            shortcut_label(KeyCode::Char('$'), KeyModifiers::NONE),
            Label::Skills,
        ),
    ] {
        compose.push(Some(key), label(kind));
    }
    compose.push(
        app.chat_widget
            .runtime_keymap
            .editor
            .primary_hint(EditorAction::InsertNewline),
        label(Label::NewLine),
    );
    for (key, kind) in [
        (
            shortcut_label(KeyCode::Char('v'), KeyModifiers::CONTROL),
            Label::PasteImage,
        ),
        (
            shortcut_label(KeyCode::Char('g'), KeyModifiers::CONTROL),
            Label::ExternalEditor,
        ),
        (
            shortcut_label(KeyCode::Char('r'), KeyModifiers::CONTROL),
            Label::SearchHistory,
        ),
    ] {
        compose.push(Some(key), label(kind));
    }
    let running = app.projection.active_turn_id().is_some();
    let mut session = Group {
        title: label(Label::Session),
        entries: Vec::new(),
    };
    session.push(
        Some(shortcut_label(KeyCode::Tab, KeyModifiers::NONE)),
        label(if running {
            Label::QueueMessage
        } else {
            Label::SendMessage
        }),
    );
    if !app.chat_widget.model_catalog.collaboration_modes.is_empty() && !running {
        session.push(
            Some(shortcut_label(KeyCode::Tab, KeyModifiers::SHIFT)),
            label(Label::ChangeMode),
        );
    }
    session.push(
        Some(shortcut_label(KeyCode::Char(','), KeyModifiers::ALT)),
        label(Label::LessReasoning),
    );
    session.push(
        Some(shortcut_label(KeyCode::Char('.'), KeyModifiers::ALT)),
        label(Label::MoreReasoning),
    );
    session.push(agents_hint(app), label(Label::Agents));
    session.push(
        Some(shortcut_label(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        label(if running {
            Label::Interrupt
        } else {
            Label::Quit
        }),
    );

    let keymap = app.chat_widget.runtime_keymap.transcript();
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
    transcript.push(
        Some(shortcut_label(KeyCode::F(4), KeyModifiers::NONE)),
        label(Label::InspectActivity),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::PageUp),
        label(Label::ScrollUp),
    );
    transcript.push(
        keymap.pager_hint(PagerKeymapAction::PageDown),
        label(Label::ScrollDown),
    );
    transcript.push(
        Some(shortcut_label(KeyCode::Char(' '), KeyModifiers::CONTROL)),
        label(Label::StartSelection),
    );
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
    let content = inset_footer_hint_area(Rect::new(0, 0, width, 1));
    u16::try_from(lines(app, content.width).len()).unwrap_or(u16::MAX)
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
    let content = inset_footer_hint_area(area);
    if content.is_empty() {
        return;
    }
    let mut body = lines(app, content.width);
    let height = usize::from(content.height);
    if body.len() > height {
        let mut footer = customization_lines(app.chat_widget.locale, content.width);
        footer.truncate(height);
        let body_height = height.saturating_sub(footer.len());
        body.truncate(body_height.saturating_sub(1));
        if body_height > 0 {
            body.push(Line::from(app.chat_widget.locale.shortcut_label(Label::Resize)).dim());
        }
        body.extend(footer);
    }
    frame.render_widget(Paragraph::new(body), content);
}

pub(crate) fn close_hint_text(locale: Locale, toggle_available: bool, width: usize) -> String {
    let label = locale.shortcut_label(Label::Close);
    let full = if toggle_available {
        format!("? / esc {label}")
    } else {
        format!("esc {label}")
    };
    first_fitting_line(
        [full, format!("esc {label}"), "esc".to_string()].map(Line::from),
        width,
    )
    .to_string()
}

#[cfg(test)]
#[path = "shortcut_overlay_tests.rs"]
mod tests;
