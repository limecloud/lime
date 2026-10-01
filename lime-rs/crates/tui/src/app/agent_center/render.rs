//! Codex command-center geometry: header/tabs/rule, task rows, details and compact footer.

use super::hints::hint_line;
use super::*;
use crate::bottom_pane::render_filled_tab_bar;
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Margin, Position, Rect};
use ratatui::style::{Style, Stylize};
use ratatui::text::Line;
use ratatui::widgets::{Clear, Paragraph, Widget};
use ratatui::Frame;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

pub(super) fn row(area: Rect, offset: u16, height: u16) -> Rect {
    let offset = offset.min(area.height);
    Rect::new(
        area.x,
        area.y + offset,
        area.width,
        height.min(area.height - offset),
    )
}

pub(super) fn line(text: impl Into<Line<'static>>, area: Rect, buf: &mut Buffer) {
    if !area.is_empty() {
        truncate_line_with_ellipsis_if_overflow(text.into(), usize::from(area.width))
            .render(row(area, 0, 1), buf);
    }
}

fn visible_suffix(input: &str, available: usize) -> &str {
    let mut start = input.len();
    let mut width = 0;
    for (offset, grapheme) in input.grapheme_indices(true).rev() {
        if width + grapheme.width() > available {
            break;
        }
        width += grapheme.width();
        start = offset;
    }
    &input[start..]
}

struct CenterLayout {
    header: Rect,
    list: Rect,
    gap: Rect,
    details: Rect,
    search: Rect,
    notice: Rect,
    footer: Rect,
}

impl AgentsOverviewView {
    fn center_layout(&self, area: Rect, has_notice: bool) -> CenterLayout {
        let footer_height = u16::from(area.height >= 2);
        let notice_height = u16::from(has_notice && area.height >= 7);
        let header_height = if area.height >= 6 { 3 } else { 0 };
        let footer = row(area, area.height - footer_height, footer_height);
        let notice = row(
            area,
            area.height - footer_height - notice_height,
            notice_height,
        );
        let header = row(area, 0, header_height);
        let body = row(
            area,
            header_height,
            notice.y.saturating_sub(header.bottom()),
        )
        .inner(Margin::new(2, 0));
        let [list, gap, details] = if body.width >= 90 {
            Layout::horizontal([
                Constraint::Min(46),
                Constraint::Length(3),
                Constraint::Length(38),
            ])
            .areas(body)
        } else {
            [body, Rect::default(), Rect::default()]
        };
        let search = row(list, 0, u16::from(self.editing_metadata()));
        let list = row(
            list,
            search.height,
            list.height.saturating_sub(search.height),
        );
        CenterLayout {
            header,
            list,
            gap,
            details,
            search,
            notice,
            footer,
        }
    }

    fn metadata(&self, locale: Locale) -> (String, &str) {
        use super::super::AgentsOverviewInputMode;
        match self.input_mode {
            Some(AgentsOverviewInputMode::Rename) => (
                format!("{} › ", locale.agent_center_label("Rename")),
                self.input(),
            ),
            Some(AgentsOverviewInputMode::NewTask) => (
                format!("{} › ", locale.agent_center_label("New task")),
                self.input(),
            ),
            None => (
                format!("{} › ", locale.agent_center_label("Search")),
                self.search(),
            ),
        }
    }

    pub(crate) fn cursor_pos(&self, area: Rect, locale: Locale) -> Option<(u16, u16)> {
        let layout = self.center_layout(area, false);
        if !self.editing_metadata() || layout.search.is_empty() {
            return None;
        }
        let (prefix, input) = self.metadata(locale);
        let available = usize::from(layout.search.width).saturating_sub(prefix.width() + 1);
        Some((
            layout.search.x
                + (prefix.width() + visible_suffix(input, available).width())
                    .min(usize::from(layout.search.width.saturating_sub(1)))
                    as u16,
            layout.search.y,
        ))
    }
}

pub(crate) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    view: &AgentsOverviewView,
    locale: Locale,
    notice: Option<&str>,
) {
    let reference = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0);
    render_at(frame, area, view, locale, reference, notice);
}

pub(crate) fn render_at(
    frame: &mut Frame<'_>,
    area: Rect,
    view: &AgentsOverviewView,
    locale: Locale,
    reference: i64,
    notice: Option<&str>,
) {
    frame.render_widget(Clear, area);
    let notice = notice.filter(|_| !view.editing_metadata() && !view.help);
    let layout = view.center_layout(area, notice.is_some());
    let inset = |area: Rect| area.inner(Margin::new(2, 0));
    let grouping = match view.grouping {
        super::super::grouping::AgentsOverviewGrouping::Project => "Project",
        super::super::grouping::AgentsOverviewGrouping::Status => "Status",
    };
    let group_key = view
        .agents_keymap
        .primary_hint(crate::keymap::AgentsKeymapAction::ToggleGrouping)
        .unwrap_or_default();
    let labels = ["All", "Needs you", "Working", "Ready", "Inactive"]
        .iter()
        .zip(TASK_FILTERS)
        .map(|(label, group)| {
            let count = view
                .rows
                .iter()
                .filter(|row| group.is_none_or(|group| row.group == group))
                .count();
            format!("{} {count}", locale.agent_center_label(label))
        })
        .collect::<Vec<_>>();
    let buf = frame.buffer_mut();
    line(
        vec![
            locale.agent_center_label("Agent command center").bold(),
            format!(
                "  {}: {}  {group_key}",
                locale.agent_center_label("Group"),
                locale.agent_center_label(grouping)
            )
            .dim(),
        ],
        inset(layout.header),
        buf,
    );
    let mut tabs = inset(row(layout.header, 1, 1));
    let filter_hint = hint_line(&[(
        if view.editing_metadata() {
            String::new()
        } else {
            view.center_filter_hint()
        },
        locale.agent_center_label("filter").into(),
    )]);
    if tabs.width >= 80 && filter_hint.width() > 0 {
        let width = (filter_hint.width() as u16).min(tabs.width);
        filter_hint.render(
            Rect::new(tabs.right() - width, tabs.y, width, tabs.height),
            buf,
        );
        tabs.width = tabs.width.saturating_sub(width + 2);
    }
    render_filled_tab_bar(
        &labels.iter().map(String::as_str).collect::<Vec<_>>(),
        view.status_filter,
        tabs,
        buf,
    );
    line(
        "─".repeat(usize::from(area.width.saturating_sub(4))).dim(),
        inset(row(layout.header, 2, 1)),
        buf,
    );
    if view.editing_metadata() {
        let (label, input) = view.metadata(locale);
        let available = usize::from(layout.search.width).saturating_sub(label.width() + 1);
        buf.set_style(layout.search, crate::style::active_tab_style());
        line(
            vec![
                label.cyan().bold(),
                visible_suffix(input, available).to_string().into(),
            ],
            layout.search,
            buf,
        );
    }
    line(
        view.center_footer_line(locale, inset(layout.footer).width),
        inset(layout.footer),
        buf,
    );
    if let Some(notice) = notice {
        line(notice.to_owned().dim(), inset(layout.notice), buf);
    }
    if view.help {
        let body = inset(row(
            area,
            layout.header.height,
            layout.footer.y.saturating_sub(layout.header.bottom()),
        ));
        let mut lines = crate::wrapping::word_wrap_lines(
            view.center_help_lines(locale, body.width),
            usize::from(body.width.max(1)),
        );
        if lines.len() > usize::from(body.height) {
            lines.truncate(usize::from(body.height.saturating_sub(1)));
            if body.height > 0 {
                lines.push(
                    locale
                        .agent_center_label("… resize to see all")
                        .dim()
                        .into(),
                );
            }
        }
        Paragraph::new(lines).render(body, buf);
        return;
    }
    for y in layout.gap.y..layout.gap.bottom() {
        if layout.gap.width > 1 {
            buf[(layout.gap.x + 1, y)]
                .set_symbol("│")
                .set_style(Style::default().dim());
        }
    }
    view.render_center_rows(layout.list, buf, locale, reference);
    if !layout.details.is_empty() {
        super::super::details::render_details(layout.details, buf, view, locale);
    }
    if let Some((x, y)) = view.cursor_pos(area, locale) {
        frame.set_cursor_position(Position::new(x, y));
    }
}
