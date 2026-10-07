//! Packs complete footer shortcuts without inventing bindings or splitting chords.

use ratatui::text::Line;
use ratatui::text::Span;

use crate::style::{footer_hint_label_style, key_hint_style};
use crate::width::display_width;

/// The same styled hint is measured and painted; keyboard tokens stay distinct from copy.
pub(crate) fn shortcut(keys: &str, label: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(keys.to_string(), key_hint_style()),
        Span::styled(format!(" {label}"), footer_hint_label_style().not_bold()),
    ])
}

pub(crate) fn display_key_label(key: &str) -> String {
    match key {
        "enter" => "Enter",
        "esc" => "Esc",
        "tab" => "Tab",
        "pgup" => "PgUp",
        "pgdn" => "PgDn",
        other => other,
    }
    .to_string()
}

fn compact_key_label(key: &str) -> &str {
    match key {
        "Enter" => "↵",
        "Esc" => "⎋",
        "Tab" => "⇥",
        "↑/↓" => "↑↓",
        "←/→" => "←→",
        other => other,
    }
}

/// The key and localized copy remain separate; layout never parses translated labels.
pub(crate) struct ShortcutHint {
    text: String,
    keys: Vec<String>,
}

impl ShortcutHint {
    pub(crate) fn new(key: &str, text: String) -> Self {
        Self {
            text,
            keys: vec![display_key_label(key)],
        }
    }

    /// A secondary hint may advertise another complete, executable shortcut when it is shorter.
    pub(crate) fn with_alternative_key(mut self, key: &str) -> Self {
        self.keys.push(display_key_label(key));
        self
    }

    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    pub(crate) fn fit(&self, width: usize) -> String {
        first_fitting_line(
            std::iter::once(self.text.clone())
                .chain(self.keys.iter().cloned())
                .chain(
                    self.keys
                        .iter()
                        .map(|key| compact_key_label(key).to_string()),
                )
                .map(Line::from),
            width,
        )
        .to_string()
    }
}

/// Preserve both primary actions where possible, then cancellation or the shorter executable key.
pub(crate) fn primary_action_hint(
    accept: Option<ShortcutHint>,
    cancel: Option<ShortcutHint>,
    width: usize,
) -> String {
    match (accept, cancel) {
        (Some(accept), Some(cancel)) => {
            let accept_key = &accept.keys[0];
            let cancel_key = &cancel.keys[0];
            let candidates = [
                format!("{} · {}", accept.text, cancel.text),
                format!("{accept_key} · {cancel_key}"),
                format!("{} · {cancel_key}", compact_key_label(accept_key)),
            ];
            // Concatenating a chord would make its final stroke ambiguous. Only the standard
            // single-key Enter/Esc pair has an unambiguous compact joined form.
            let joined = (accept_key == "Enter" && cancel_key == "Esc").then(|| "↵Esc".to_string());
            first_fitting_line(
                candidates
                    .into_iter()
                    .chain(joined)
                    .chain([cancel.fit(width), accept.fit(width)])
                    .map(Line::from),
                width,
            )
            .to_string()
        }
        (Some(hint), None) | (None, Some(hint)) => hint.fit(width),
        (None, None) => String::new(),
    }
}

/// Select a nonempty whole variant, so a missing action cannot hide a later executable hint.
pub(crate) fn first_fitting_line(
    candidates: impl IntoIterator<Item = Line<'static>>,
    width: usize,
) -> Line<'static> {
    candidates
        .into_iter()
        .find(|line| {
            let line_width = display_width(&line.to_string());
            line_width > 0 && line_width <= width
        })
        .unwrap_or_default()
}

pub(crate) fn wrap_hint_rows<T>(
    hints: impl IntoIterator<Item = T>,
    width: usize,
    separator_width: usize,
    hint_width: impl Fn(&T) -> usize,
) -> Vec<Vec<T>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut used = 0usize;
    for hint in hints {
        let hint_width = hint_width(&hint);
        let extra = if row.is_empty() {
            hint_width
        } else {
            separator_width.saturating_add(hint_width)
        };
        if !row.is_empty() && used.saturating_add(extra) > width {
            rows.push(std::mem::take(&mut row));
            used = 0;
        }
        used = used.saturating_add(if row.is_empty() { hint_width } else { extra });
        row.push(hint);
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}
