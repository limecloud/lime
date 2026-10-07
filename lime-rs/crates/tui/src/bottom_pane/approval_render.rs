//! Approval presentation yields header space before hiding an actionable decision.

use super::approval_overlay::{ApprovalOverlay, ApprovalRequest};
use super::scroll_state::ScrollState;
use super::selection_popup_common::{measure_rows_height, render_rows};
use super::selection_row_layout::{line_to_owned, SelectionRow};
use super::{BottomPane, PendingInteraction};
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::style::{attention_style, muted_style};
use crate::wrapping::{word_wrap_line, RtOptions};
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

pub(super) fn details(pane: &BottomPane, locale: Locale) -> Option<(String, Vec<Line<'static>>)> {
    let Some(PendingInteraction::Approval(approval)) = pane.current() else {
        return None;
    };
    let (kind, details) = match &approval.request {
        ApprovalRequest::Exec { params, .. } => (
            "command",
            vec![
                params.command.clone().unwrap_or_default(),
                params.cwd.clone().unwrap_or_default(),
                params.reason.clone().unwrap_or_default(),
            ],
        ),
        ApprovalRequest::ApplyPatch { params, .. } => (
            "file",
            vec![
                params.grant_root.clone().unwrap_or_default(),
                params.reason.clone().unwrap_or_default(),
            ],
        ),
        ApprovalRequest::Permissions { params, .. } => (
            "permissions",
            vec![
                params.cwd.clone(),
                params.reason.clone().unwrap_or_default(),
                serde_json::to_string(&params.permissions).unwrap_or_default(),
            ],
        ),
    };
    let title = locale.approval_title(kind).to_string();
    let mut lines = vec![Line::from(title.clone()).bold()];
    lines.extend(
        details
            .into_iter()
            .filter(|detail| !detail.is_empty())
            .map(|detail| Line::styled(detail, muted_style())),
    );
    Some((title, lines))
}

fn header(pane: &BottomPane, locale: Locale, width: u16) -> Vec<Line<'static>> {
    let Some((_, mut lines)) = details(pane, locale) else {
        return Vec::new();
    };
    if let Some(title) = pane.action_required_title(locale) {
        lines.insert(0, Line::styled(title, attention_style()));
    }
    lines
        .iter()
        .flat_map(|line| {
            word_wrap_line(line, RtOptions::new(usize::from(width.max(1))))
                .into_iter()
                .map(line_to_owned)
        })
        .collect()
}

fn rows(approval: &ApprovalOverlay, locale: Locale) -> Vec<SelectionRow> {
    approval
        .option_labels()
        .into_iter()
        .enumerate()
        .map(|(index, label)| {
            SelectionRow::new(
                format!("{}. {}", index + 1, locale.approval_option(&label)),
                None,
                vec![if index == approval.selected {
                    "› "
                } else {
                    "  "
                }
                .into()],
            )
        })
        .collect()
}

fn state(approval: &ApprovalOverlay) -> ScrollState {
    ScrollState {
        selected_idx: Some(approval.selected),
        scroll_top: 0,
    }
}

pub(super) fn desired_height(pane: &BottomPane, locale: Locale, width: u16) -> u16 {
    let Some(PendingInteraction::Approval(approval)) = pane.current() else {
        return 0;
    };
    let header = header(pane, locale, width.saturating_sub(4));
    let rows = rows(approval, locale);
    u16::try_from(header.len())
        .unwrap_or(u16::MAX)
        .saturating_add(measure_rows_height(&rows, &state(approval), width))
        .saturating_add(2)
        .clamp(5, 18)
}

pub(super) fn footer_hint(approval: &ApprovalOverlay, locale: Locale, width: usize) -> String {
    use crate::footer_hint::{primary_action_hint, ShortcutHint};
    let (confirm_key, cancel_key) = approval.action_hint_keys();
    primary_action_hint(
        confirm_key.map(|key| ShortcutHint::new(&key, locale.approval_confirm_hint(&key))),
        cancel_key.map(|key| ShortcutHint::new(&key, locale.approval_cancel_hint(&key))),
        width,
    )
}

pub(super) fn render(frame: &mut Frame<'_>, area: Rect, pane: &BottomPane, locale: Locale) {
    let Some(PendingInteraction::Approval(approval)) = pane.current() else {
        return;
    };
    if area.is_empty() {
        return;
    }
    frame.render_widget(Clear, area);
    let content_x = area.x + 2.min(area.width.saturating_sub(1));
    let header_width = area.right().saturating_sub(content_x).saturating_sub(2);
    let header = header(pane, locale, header_width);
    let rows = rows(approval, locale);
    let state = state(approval);
    let row_height = measure_rows_height(&rows, &state, area.width);
    let minimum_rows = row_height.min(3).min(area.height);
    let header_height = u16::try_from(header.len())
        .unwrap_or(u16::MAX)
        .min(area.height.saturating_sub(minimum_rows));
    let gap =
        u16::from(header_height > 0 && area.height.saturating_sub(header_height) > minimum_rows);
    let clipped = usize::from(header_height) < header.len();
    let visible_header = header_height.saturating_sub(u16::from(clipped));
    frame.render_widget(
        Paragraph::new(
            header
                .iter()
                .take(usize::from(visible_header))
                .cloned()
                .collect::<Vec<_>>(),
        ),
        Rect::new(content_x, area.y, header_width, visible_header),
    );
    if clipped && header_height > 0 {
        let line = truncate_line_with_ellipsis_if_overflow(
            Line::from(locale.approval_header_elision(header.len())).dim(),
            usize::from(header_width),
        );
        frame.render_widget(
            Paragraph::new(line),
            Rect::new(content_x, area.y + visible_header, header_width, 1),
        );
    }
    let list_y = area.y + header_height + gap;
    render_rows(
        frame,
        Rect::new(
            area.x,
            list_y,
            area.width,
            area.bottom().saturating_sub(list_y),
        ),
        &rows,
        &state,
    );
}

#[cfg(test)]
#[path = "approval_render_tests.rs"]
mod tests;
