use super::*;
use crate::keymap::ListAction;

#[cfg(test)]
pub(super) fn render(frame: &mut Frame<'_>, picker: &PickerState) {
    render_with_locale(frame, picker, Locale::default());
}

pub(crate) fn render_with_locale(frame: &mut Frame<'_>, picker: &PickerState, locale: Locale) {
    let area = frame.area();
    if let Some(pager) = picker.transcript_pager.as_ref() {
        let transcript = picker.transcript_content(&pager.thread_id, area.width, locale);
        pager
            .overlay
            .render_transcript(frame, area, locale, &transcript);
        return;
    }
    let areas = super::layout::areas(area);
    let chrome = |rect: ratatui::layout::Rect| {
        ratatui::layout::Rect::new(
            rect.x.saturating_add(1),
            rect.y,
            rect.width.saturating_sub(2),
            rect.height,
        )
    };

    let header = chrome(areas.header);
    let title = locale
        .resume_picker_title(matches!(picker.action, SessionPickerAction::Fork))
        .to_string();
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            truncate_display(&title, usize::from(header.width)),
            Style::default().add_modifier(Modifier::BOLD),
        ))),
        header,
    );

    let toolbar = chrome(areas.toolbar);
    frame.render_widget(
        Paragraph::new(resume_toolbar_line(picker, locale, toolbar.width))
            .style(crate::style::muted_style()),
        toolbar,
    );
    let search = chrome(areas.search);
    frame.render_widget(
        Paragraph::new(resume_search_line(picker, locale, search.width))
            .style(Style::default().fg(Color::DarkGray)),
        search,
    );

    let list = ratatui::layout::Rect::new(
        areas.list.x.saturating_add(2),
        areas.list.y,
        areas
            .list
            .width
            .saturating_sub(PICKER_LIST_HORIZONTAL_INSET),
        areas.list.height,
    );
    render_session_list(frame, list, picker, locale);

    render_picker_footer(frame, areas.footer, picker, locale);
}

pub(super) fn resume_search_line(
    picker: &PickerState,
    locale: Locale,
    width: u16,
) -> Line<'static> {
    let search = if picker.query.is_empty() {
        locale.resume_search_placeholder().to_string()
    } else {
        format!("{}: {}", locale.resume_search_label(), picker.query)
    };
    Line::from(truncate_display(&search, usize::from(width)))
}

pub(super) fn resume_toolbar_line(
    picker: &PickerState,
    locale: Locale,
    width: u16,
) -> Line<'static> {
    let mut controls = vec![(
        ToolbarControl::Filter,
        "filter",
        locale.resume_filter_label(picker.show_all || picker.filter_cwd.is_none()),
    )];
    if picker.action == SessionPickerAction::Resume {
        controls.push((
            ToolbarControl::Status,
            "status",
            locale.resume_status_label(picker.status == SessionStatus::Archived),
        ));
    }
    controls.push((
        ToolbarControl::Sort,
        "sort",
        locale.resume_sort_label(picker.sort_key == ThreadSortKey::CreatedAt),
    ));
    let control_span = |control: ToolbarControl, text: String| {
        Span::styled(
            text,
            if control == picker.toolbar_focus {
                crate::style::active_tab_style()
            } else {
                crate::style::muted_style()
            },
        )
    };
    for compact in [false, true] {
        let mut spans = Vec::new();
        for (index, (control, kind, value)) in controls.iter().enumerate() {
            if index > 0 {
                spans.push(Span::raw(if compact { " " } else { "   " }));
            }
            let label = if compact {
                format!(" {value} ")
            } else {
                format!("{}: {value} ", locale.resume_toolbar_label(kind))
            };
            spans.push(control_span(*control, label));
        }
        let line = Line::from(spans);
        if crate::line_truncation::line_width(&line) <= usize::from(width) {
            return line;
        }
    }
    let (control, kind, value) = controls
        .into_iter()
        .find(|(control, _, _)| *control == picker.toolbar_focus)
        .expect("focused control belongs to the current picker action");
    let label = format!("{}: {value}", locale.resume_toolbar_label(kind));
    let text = if display_width(&label) <= usize::from(width) {
        label
    } else {
        value.to_string()
    };
    let mut line = truncate_line_with_ellipsis_if_overflow(
        Line::from(control_span(control, text)),
        usize::from(width),
    );
    // Even an ellipsis-only viewport must retain the focused control's contrast.
    for span in &mut line.spans {
        span.style = crate::style::active_tab_style();
    }
    line
}

pub(super) fn render_picker_footer(
    frame: &mut Frame<'_>,
    area: ratatui::layout::Rect,
    picker: &PickerState,
    locale: Locale,
) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let accept = picker.list_keymap.primary_hint(ListAction::Accept);
    let cancel = picker.list_keymap.primary_hint(ListAction::Cancel);
    let wide = [
        accept.as_deref().map(|key| {
            locale.resume_enter_hint(
                key,
                matches!(picker.action, SessionPickerAction::Fork),
                picker.status == SessionStatus::Archived,
            )
        }),
        cancel
            .as_deref()
            .map(|key| locale.resume_escape_hint(key, !picker.query.is_empty())),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" | ");
    let keys = [accept.as_deref(), cancel.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let compact = keys.join(" · ");
    let minimal = keys.join(" ");
    let budget = usize::from(area.width.saturating_sub(2));
    let primary = [
        wide,
        compact,
        minimal,
        cancel.unwrap_or_default(),
        accept.unwrap_or_default(),
    ]
    .into_iter()
    .find(|hint| display_width(hint) <= budget)
    .unwrap_or_default();
    if area.height == 1 {
        frame.render_widget(
            Paragraph::new(primary).style(crate::style::muted_style()),
            area,
        );
        return;
    }
    let progress = format!(
        " {} / {} ",
        if picker.threads.is_empty() {
            0
        } else {
            picker.selected.saturating_add(1)
        },
        picker.threads.len(),
    );
    let progress_width = display_width(&progress);
    let separator_width = usize::from(area.width).saturating_sub(progress_width);
    let separator = if progress_width < usize::from(area.width) {
        format!("{}{}", "─".repeat(separator_width), progress)
    } else {
        "─".repeat(usize::from(area.width))
    };
    frame.render_widget(
        Paragraph::new(separator).style(Style::default().fg(Color::DarkGray)),
        ratatui::layout::Rect::new(area.x, area.y, area.width, 1),
    );
    let hints = ratatui::layout::Rect::new(
        area.x.saturating_add(1),
        area.y.saturating_add(1),
        area.width.saturating_sub(2),
        area.height.saturating_sub(1),
    );
    frame.render_widget(
        Paragraph::new(primary).style(crate::style::muted_style()),
        ratatui::layout::Rect::new(hints.x, hints.y, hints.width, 1),
    );
    if hints.height > 1 {
        let secondary = if let Some(message) = picker.status_message.as_deref() {
            message.to_string()
        } else if picker.loading {
            locale.resume_loading().to_string()
        } else if picker.threads.is_empty() {
            locale.resume_empty().to_string()
        } else {
            format!(
                "{} | {} | {} | {}",
                locale.resume_controls_hint(
                    &[ListAction::MoveLeft, ListAction::MoveRight]
                        .into_iter()
                        .filter_map(|action| picker.list_keymap.primary_hint(action))
                        .collect::<Vec<_>>()
                        .join("/")
                ),
                locale.resume_expand_hint(),
                locale.resume_transcript_hint(),
                locale.resume_density_label(picker.density == SessionListDensity::Dense)
            )
        };
        frame.render_widget(
            Paragraph::new(truncate_display(&secondary, usize::from(hints.width)))
                .style(crate::style::muted_style()),
            ratatui::layout::Rect::new(hints.x, hints.y + 1, hints.width, 1),
        );
    }
}

fn visible_window(
    heights: &[usize],
    selected: usize,
    budget: usize,
    separator: usize,
) -> (usize, usize) {
    let mut start = selected;
    let mut used = heights[selected].min(budget);
    while start > 0
        && used
            .saturating_add(separator)
            .saturating_add(heights[start - 1])
            <= budget
    {
        start -= 1;
        used += separator + heights[start];
    }
    let mut end = selected + 1;
    while end < heights.len()
        && used.saturating_add(separator).saturating_add(heights[end]) <= budget
    {
        used += separator + heights[end];
        end += 1;
    }
    (start, end)
}

pub(super) fn render_session_list(
    frame: &mut Frame<'_>,
    area: ratatui::layout::Rect,
    picker: &PickerState,
    locale: Locale,
) {
    picker
        .view_rows
        .set((area.height > 0).then_some(usize::from(area.height)));
    if area.width == 0 || area.height == 0 {
        return;
    }
    frame.render_widget(Clear, area);
    if picker.threads.is_empty() {
        frame.render_widget(
            Paragraph::new(locale.resume_empty()).style(Style::default().fg(Color::DarkGray)),
            area,
        );
        return;
    }

    let selected = picker.selected.min(picker.threads.len().saturating_sub(1));
    let items = picker
        .threads
        .iter()
        .enumerate()
        .map(|(index, thread)| session_list_item(thread, picker, index, locale, area.width))
        .collect::<Vec<_>>();
    let heights = items
        .iter()
        .map(|lines| lines.len().max(1))
        .collect::<Vec<_>>();
    let separator = usize::from(picker.density == SessionListDensity::Comfortable);
    let mut show_more_above = false;
    let mut show_more_below = false;
    let mut window = visible_window(&heights, selected, usize::from(area.height), separator);
    // Re-budget only when the actual window hides rows. At least one action row survives.
    for _ in 0..3 {
        show_more_above = window.0 > 0 && area.height > 1;
        show_more_below = (window.1 < items.len() || picker.has_more_pages())
            && area.height > 1 + u16::from(show_more_above);
        let budget =
            usize::from(area.height) - usize::from(show_more_above) - usize::from(show_more_below);
        let next = visible_window(&heights, selected, budget, separator);
        if next == window {
            break;
        }
        window = next;
    }
    let (start, end) = window;

    let mut y = area.y;
    if show_more_above {
        frame.render_widget(
            Paragraph::new(locale.resume_more(true)).style(crate::style::muted_style()),
            ratatui::layout::Rect::new(area.x, y, area.width, 1),
        );
        y = y.saturating_add(1);
    }
    for lines in items.into_iter().take(end).skip(start) {
        let content_bottom = area.bottom().saturating_sub(u16::from(show_more_below));
        if y >= content_bottom {
            break;
        }
        for line in lines {
            if y >= content_bottom {
                break;
            }
            frame.render_widget(
                Paragraph::new(line),
                ratatui::layout::Rect::new(area.x, y, area.width, 1),
            );
            y = y.saturating_add(1);
        }
        if picker.density == SessionListDensity::Comfortable && y < content_bottom {
            y = y.saturating_add(1);
        }
    }
    if show_more_below {
        frame.render_widget(
            Paragraph::new(locale.resume_more(false)).style(crate::style::muted_style()),
            ratatui::layout::Rect::new(area.x, area.bottom().saturating_sub(1), area.width, 1),
        );
    }
}

pub(super) fn session_list_item(
    thread: &Thread,
    picker: &PickerState,
    index: usize,
    locale: Locale,
    width: u16,
) -> Vec<Line<'static>> {
    let width = usize::from(width);
    let preview = picker.transcript_preview_text(&thread.id);
    let title =
        thread_line_with_preview(thread, width.saturating_sub(2), locale, preview.as_deref());
    let is_selected = picker.selected == index;
    let is_expanded =
        is_selected && picker.expanded_thread_id.as_deref() == Some(thread.id.as_str());
    let marker = if is_selected {
        Span::styled(
            if is_expanded { "⌄ " } else { "› " },
            crate::style::selection_style(),
        )
    } else {
        Span::raw("  ")
    };
    let mut title = Line {
        style: title.style,
        alignment: title.alignment,
        spans: std::iter::once(marker).chain(title.spans).collect(),
    };
    if is_selected {
        title = selected_session_line(title, width);
    }
    if is_expanded {
        let mut lines = vec![title];
        lines.extend(render_expanded_session_details(
            thread,
            picker,
            width.saturating_sub(2),
            locale,
        ));
        lines
    } else if picker.density == SessionListDensity::Dense {
        vec![title]
    } else {
        let metadata = format!(
            "  {}  {}",
            thread.cwd.display(),
            if thread.updated_at == 0 {
                String::from("-")
            } else {
                thread.updated_at.to_string()
            }
        );
        vec![
            title,
            if is_selected {
                selected_session_line(
                    Line::from(Span::styled(
                        truncate_display(&metadata, width),
                        crate::style::muted_style(),
                    )),
                    width,
                )
            } else {
                Line::from(Span::styled(
                    truncate_display(&metadata, width),
                    Style::default().fg(Color::DarkGray),
                ))
            },
        ]
    }
}

fn selected_session_line(mut line: Line<'static>, width: usize) -> Line<'static> {
    let style = crate::style::selection_style();
    let padding = width.saturating_sub(crate::line_truncation::line_width(&line));
    line.spans.push(Span::raw(" ".repeat(padding)));
    line.style = style;
    for span in &mut line.spans {
        span.style = style.patch(span.style).not_dim();
        span.style.fg = style.fg;
        span.style.bg = style.bg;
    }
    line
}

pub(super) fn render_expanded_session_details(
    thread: &Thread,
    picker: &PickerState,
    width: usize,
    locale: Locale,
) -> Vec<Line<'static>> {
    let indent = "  ";
    let available = width.saturating_sub(display_width(indent));
    let title = thread
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(thread.preview.as_str());
    let cwd = center_truncate_path(&thread.cwd.to_string_lossy(), available.saturating_sub(16));
    let state = match &thread.status {
        ThreadStatus::Active { .. } => "active",
        ThreadStatus::Idle => "idle",
        ThreadStatus::NotLoaded => "not loaded",
        ThreadStatus::SystemError => "error",
    };
    let mut lines = vec![
        metadata_line(
            locale.thread_label(),
            &format!("{title} ({})", thread.id),
            width,
        ),
        metadata_line(locale.cwd_label(), &cwd, width),
        metadata_line(locale.state_label(), &locale.thread_state(state), width),
        metadata_line(
            locale.created_label(),
            &thread.created_at.to_string(),
            width,
        ),
        metadata_line(
            locale.updated_label(),
            &thread.updated_at.to_string(),
            width,
        ),
    ];

    match picker.transcripts.get(&thread.id) {
        Some(SessionTranscriptState::Loading) => {
            lines.push(Line::from(Span::styled(
                truncate_display(
                    &format!("{indent}{}", locale.resume_transcript_loading()),
                    width,
                ),
                Style::default().fg(Color::DarkGray),
            )));
        }
        Some(SessionTranscriptState::Failed) => {
            lines.push(Line::from(Span::styled(
                truncate_display(
                    &format!("{indent}{}", locale.resume_transcript_failed()),
                    width,
                ),
                Style::default().fg(Color::Red),
            )));
        }
        Some(SessionTranscriptState::Loaded(entries)) if entries.is_empty() => {
            lines.push(Line::from(Span::styled(
                truncate_display(
                    &format!("{indent}{}", locale.resume_transcript_empty()),
                    width,
                ),
                Style::default().fg(Color::DarkGray),
            )));
        }
        Some(SessionTranscriptState::Loaded(entries)) => {
            lines.push(Line::from(Span::styled(
                truncate_display(&format!("{indent}{}", locale.transcript_title()), width),
                Style::default().add_modifier(Modifier::BOLD),
            )));
            for entry in entries {
                lines.extend(
                    render_transcript_entry_lines_wrapped(
                        entry,
                        u16::try_from(width).unwrap_or(u16::MAX),
                        locale,
                        &thread.cwd,
                    )
                    .into_iter()
                    .map(|line| line.line),
                );
            }
        }
        None => {}
    }
    lines
}

pub(super) fn metadata_line(label: &str, value: &str, width: usize) -> Line<'static> {
    let prefix = format!("  {label}: ");
    if width == 0 {
        return Line::default();
    }
    if display_width(&prefix) >= width {
        return Line::from(Span::styled(
            truncate_display(&prefix, width),
            Style::default().fg(Color::DarkGray),
        ));
    }
    let available = width.saturating_sub(display_width(&prefix));
    Line::from(vec![
        Span::styled(prefix, Style::default().fg(Color::DarkGray)),
        Span::raw(truncate_display(value, available)),
    ])
}

pub(super) fn thread_line_with_preview(
    thread: &Thread,
    width: usize,
    locale: Locale,
    transcript_preview: Option<&str>,
) -> Line<'static> {
    let title = thread
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| {
            let preview = transcript_preview.unwrap_or(thread.preview.as_str());
            if preview.trim().is_empty() {
                locale.untitled_conversation()
            } else {
                preview
            }
        });
    let state = match &thread.status {
        ThreadStatus::Active { .. } => "active",
        ThreadStatus::Idle => "idle",
        ThreadStatus::NotLoaded => "not loaded",
        ThreadStatus::SystemError => "error",
    };
    let cwd = thread.cwd.to_string_lossy();
    let max_width = width.saturating_sub(2);
    let state_text = format!("[{}]", locale.thread_state(state));
    let reserved = display_width(&format!("{title}  {state_text}  "));
    let cwd = center_truncate_path(&cwd, max_width.saturating_sub(reserved));
    let truncated = truncate_display(&format!("{title}  {state_text}  {cwd}"), max_width);
    Line::from(Span::raw(truncated))
}

pub(super) fn truncate_display(text: &str, max_width: usize) -> String {
    truncate_line_with_ellipsis_if_overflow(Line::from(text.to_owned()), max_width).to_string()
}
