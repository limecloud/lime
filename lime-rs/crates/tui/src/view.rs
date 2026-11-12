use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::app::{App, FullscreenSurface};
use crate::bottom_pane;
use crate::bottom_pane::pending_input_preview;
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::model_picker;
use crate::status_indicator_widget;
use std::time::Instant;

/// The visible input surface owns the cursor shape; hidden composer state cannot override it.
pub(crate) fn cursor_style(app: &App) -> crossterm::cursor::SetCursorStyle {
    use crossterm::cursor::SetCursorStyle;
    let widget = &app.chat_widget;
    if app.fullscreen_surface().is_some() {
        return SetCursorStyle::DefaultUserShape;
    }
    if let Some(picker) = &widget.export_picker {
        return picker.cursor_style();
    }
    if !widget.bottom_pane.is_active()
        && (widget.model_picker.is_some()
            || widget.copy_picker.is_some()
            || widget.status_line_setup.is_some()
            || widget.terminal_title_setup.is_some()
            || widget.agent_picker.is_some()
            || app.transcript_view.search.is_active())
    {
        return SetCursorStyle::DefaultUserShape;
    }
    widget.bottom_pane.cursor_style()
}

pub(crate) fn render(frame: &mut Frame<'_>, app: &App) {
    let area = frame.area();
    let fullscreen = app.fullscreen_surface();
    if let Some(picker) = app
        .chat_widget
        .resume_picker
        .as_ref()
        .filter(|_| fullscreen == Some(FullscreenSurface::ResumePicker))
    {
        app.transcript_view.follow_control.clear();
        frame.render_widget(Clear, area);
        crate::resume_picker::render_with_locale(frame, picker, app.chat_widget.locale);
        return;
    }
    if let Some(pager) = app
        .chat_widget
        .pager_overlay
        .as_ref()
        .filter(|_| fullscreen == Some(FullscreenSurface::Pager))
    {
        app.transcript_view.follow_control.clear();
        if pager.is_transcript() {
            let transcript =
                crate::app::history_ui::render_transcript_pager_content(app, area.width);
            pager.render_transcript(frame, area, app.chat_widget.locale, &transcript);
        } else {
            pager.render(frame, area, app.chat_widget.locale, &[]);
        }
        return;
    }
    if let Some(overview) = app
        .chat_widget
        .agents_overview
        .as_ref()
        .filter(|_| fullscreen == Some(FullscreenSurface::AgentsOverview))
    {
        // A fullscreen surface must not start or schedule effects hidden underneath it.
        app.transcript_view.follow_control.clear();
        let notice = transient_status(app).map(|status| app.chat_widget.locale.status(&status));
        crate::app::agents_overview_view::render(
            frame,
            area,
            &overview.view,
            app.chat_widget.locale,
            notice.as_deref(),
        );
        return;
    }
    let active_elapsed = app.active_turn_elapsed(Instant::now());
    let chunks = screen_chunks(area, app, active_elapsed);
    let picker_active = app.chat_widget.model_picker.is_some()
        || app.chat_widget.copy_picker.is_some()
        || app.chat_widget.status_line_setup.is_some()
        || app.chat_widget.terminal_title_setup.is_some()
        || app.chat_widget.agent_picker.is_some()
        || app.chat_widget.export_picker.is_some();

    app.render_owned_transcript(frame, chunks.transcript);
    if !app.chat_widget.bottom_pane.is_active() {
        if let Some(elapsed) = active_elapsed {
            let inline_status = active_status_message(app);
            status_indicator_widget::render_with_messages(
                frame,
                chunks.status,
                app.chat_widget.locale,
                elapsed,
                inline_status.as_deref(),
                app.projection.hook_status_message(),
                app.chat_widget.tui_config.animations,
            );
        } else if let Some(status) = transient_status(app) {
            render_transient_status(frame, chunks.status, app.chat_widget.locale, &status);
        }
        pending_input_preview::render(
            frame,
            chunks.preview,
            app.chat_widget.queued_submissions(),
            app.chat_widget.locale,
        );
    }
    if let Some(picker) = app.chat_widget.export_picker.as_ref() {
        crate::chatwidget::transcript_export::render_picker(
            frame,
            chunks.input,
            picker,
            app.chat_widget.locale,
        );
    } else if app.chat_widget.bottom_pane.is_active() {
        bottom_pane::render_with_locale(
            frame,
            chunks.input,
            &app.chat_widget.bottom_pane,
            app.chat_widget.locale,
        );
    } else {
        if let Some(picker) = app.chat_widget.copy_picker.as_ref() {
            picker.render(frame, chunks.input, app.chat_widget.locale);
        } else if let Some(picker) = app.chat_widget.terminal_title_setup.as_ref() {
            picker.render(
                frame,
                chunks.input,
                app.chat_widget.locale,
                app.terminal_title_text(Instant::now()),
            );
        } else if let Some(picker) = app.chat_widget.status_line_setup.as_ref() {
            picker.render(
                frame,
                chunks.input,
                app.chat_widget.locale,
                &app.status_surface_data(),
            );
        } else if let Some(menu) = app.chat_widget.config_menu.as_ref() {
            crate::app::config_menu::render(frame, chunks.input, menu, app.chat_widget.locale);
        } else if let Some(picker) = app.chat_widget.permissions_picker.as_ref() {
            crate::app::permissions_picker::render(
                frame,
                chunks.input,
                picker,
                app.chat_widget.locale,
            );
        } else if let Some(picker) = app.chat_widget.effort_picker.as_ref() {
            crate::app::effort_picker::render(frame, chunks.input, picker, app.chat_widget.locale);
        } else if let Some(picker) = app.chat_widget.review_picker.as_ref() {
            crate::app::review_picker::render(frame, chunks.input, picker, app.chat_widget.locale);
        } else if let Some(prompt) = app.chat_widget.confirm_prompt.as_ref() {
            crate::app::confirm_prompt::render(frame, chunks.input, prompt, app.chat_widget.locale);
        } else if let Some(picker) = app.chat_widget.model_picker.as_ref() {
            model_picker::render_with_locale(frame, chunks.input, picker, app.chat_widget.locale);
        } else if let Some(picker) = app.chat_widget.agent_picker.as_ref() {
            crate::app::agent_picker::render(frame, chunks.input, picker, app.chat_widget.locale);
        } else {
            if bottom_pane::shortcut_overlay::visible(app) {
                bottom_pane::shortcut_overlay::render(frame, chunks.shortcuts, app);
            }
            bottom_pane::render_with_locale(
                frame,
                chunks.input,
                &app.chat_widget.bottom_pane,
                app.chat_widget.locale,
            );
        }
    }
    let follow_area = (!app.chat_widget.bottom_pane.is_active()
        && !app.chat_widget.bottom_pane.popup_active()
        && app.chat_widget.model_picker.is_none()
        && app.chat_widget.copy_picker.is_none()
        && app.chat_widget.agents_overview.is_none()
        && app.chat_widget.export_picker.is_none()
        && app.chat_widget.status_line_setup.is_none()
        && app.chat_widget.terminal_title_setup.is_none()
        && app.chat_widget.agent_picker.is_none())
    .then(|| Rect::new(chunks.input.x, chunks.input.y, chunks.input.width, 1));
    if app.transcript_view.footer.render_search_query(
        frame,
        follow_area,
        app.chat_widget.locale,
        &app.transcript_view.search,
    ) || app
        .transcript_view
        .composer_gap
        .render(frame, follow_area, app.chat_widget.locale)
    {
        app.transcript_view.follow_control.clear();
    } else {
        app.transcript_view.follow_control.render(
            frame,
            follow_area,
            app.chat_widget.locale,
            app.transcript_view.viewport.tail_visible(),
            app.transcript_view.viewport.unseen_activity(),
        );
    }
    if app.chat_widget.bottom_pane.is_active()
        || (!picker_active
            && !app.transcript_view.footer.render_status(
                frame,
                chunks.footer,
                app.chat_widget.locale,
                &app.transcript_view.search,
                app.transcript_view.selection.is_active(),
            ))
    {
        let mut footer_props = app.chat_widget.footer_props(
            area.width,
            app.projection.active_turn_id().is_some(),
            app.thread_id.as_deref(),
            app.primary_thread_id.as_deref(),
        );
        let items = app.chat_widget.status_line_items();
        footer_props.status_line_enabled = !items.is_empty();
        let data = app.status_surface_data();
        footer_props.context_window_percent = data
            .token_usage
            .as_ref()
            .and_then(crate::status::helpers::percent_of_context_window_remaining);
        footer_props.context_window_used_tokens = data
            .token_usage
            .as_ref()
            .map(|usage| usage.total.total_tokens.max(0));
        footer_props.status_line_value = data.line(
            &items,
            app.chat_widget.tui_config.status_line_use_colors,
            app.chat_widget.locale,
        );
        app.chat_widget
            .bottom_pane
            .render_footer(frame, chunks.footer, &footer_props);
    }
    if !app.chat_widget.bottom_pane.is_active() && !picker_active {
        app.chat_widget.bottom_pane.render_popups(
            frame,
            chunks.input,
            app.chat_widget.locale,
            chunks.transcript.y,
        );
    }
}

#[derive(Debug, Clone, Copy)]
struct ScreenChunks {
    transcript: Rect,
    status: Rect,
    preview: Rect,
    shortcuts: Rect,
    input: Rect,
    footer: Rect,
}

fn screen_chunks(
    area: Rect,
    app: &App,
    active_elapsed: Option<std::time::Duration>,
) -> ScreenChunks {
    let picker_active = app.chat_widget.model_picker.is_some()
        || app.chat_widget.copy_picker.is_some()
        || app.chat_widget.status_line_setup.is_some()
        || app.chat_widget.terminal_title_setup.is_some()
        || app.chat_widget.agent_picker.is_some()
        || app.chat_widget.export_picker.is_some();
    let status_height = if app.chat_widget.bottom_pane.is_active() || picker_active {
        0
    } else if let Some(elapsed) = active_elapsed {
        let inline_status = active_status_message(app);
        status_indicator_widget::desired_height_with_messages(
            area.width,
            app.chat_widget.locale,
            elapsed,
            inline_status.as_deref(),
            app.projection.hook_status_message(),
        )
    } else if transient_status(app).is_some() {
        1
    } else {
        0
    };
    let preview_height = if app.chat_widget.bottom_pane.is_active() || picker_active {
        0
    } else {
        pending_input_preview::desired_height(
            app.chat_widget.queued_submissions(),
            area.width,
            app.chat_widget.locale,
        )
        .min(8)
        .min(area.height.saturating_sub(6 + status_height))
    };
    let input_height = if let Some(picker) = app.chat_widget.export_picker.as_ref() {
        crate::chatwidget::transcript_export::desired_height(
            picker,
            app.chat_widget.locale,
            area.width,
        )
        .min(area.height.saturating_sub(1))
    } else if app.chat_widget.bottom_pane.is_active() {
        bottom_pane::desired_height_with_locale_for_width(
            &app.chat_widget.bottom_pane,
            app.chat_widget.locale,
            area.width,
        )
    } else if let Some(picker) = app.chat_widget.copy_picker.as_ref() {
        picker
            .desired_height(app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.terminal_title_setup.as_ref() {
        picker
            .desired_height(app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.status_line_setup.as_ref() {
        picker
            .desired_height(app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(menu) = app.chat_widget.config_menu.as_ref() {
        crate::app::config_menu::desired_height(menu, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.permissions_picker.as_ref() {
        crate::app::permissions_picker::desired_height(picker, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.effort_picker.as_ref() {
        crate::app::effort_picker::desired_height(picker, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.review_picker.as_ref() {
        crate::app::review_picker::desired_height(picker, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(prompt) = app.chat_widget.confirm_prompt.as_ref() {
        crate::app::confirm_prompt::desired_height(prompt, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.model_picker.as_ref() {
        model_picker::desired_height(picker, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else if let Some(picker) = app.chat_widget.agent_picker.as_ref() {
        crate::app::agent_picker::desired_height(picker, app.chat_widget.locale, area.width)
            .min(area.height.saturating_sub(1))
    } else {
        let desired = bottom_pane::desired_height_with_locale_for_width(
            &app.chat_widget.bottom_pane,
            app.chat_widget.locale,
            area.width,
        );
        desired.min(
            area.height
                .saturating_sub(preview_height)
                .saturating_sub(status_height)
                .saturating_sub(2)
                .max(1),
        )
    };
    let footer_height = if app.chat_widget.export_picker.is_some()
        || picker_active && !app.chat_widget.bottom_pane.is_active()
    {
        0
    } else if app.chat_widget.bottom_pane.is_active() {
        app.chat_widget.bottom_pane.footer_required_height(
            app.chat_widget.locale,
            usize::from(bottom_pane::inset_footer_hint_area(area).width),
        )
    } else {
        1
    }
    .min(area.height.saturating_sub(1).max(1));
    let shortcuts_height = if bottom_pane::shortcut_overlay::visible(app) {
        bottom_pane::shortcut_overlay::desired_height(app, area.width).min(
            area.height
                .saturating_sub(status_height)
                .saturating_sub(preview_height)
                .saturating_sub(input_height)
                .saturating_sub(footer_height)
                .saturating_sub(1),
        )
    } else {
        0
    };
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(status_height),
            Constraint::Length(preview_height),
            Constraint::Length(shortcuts_height),
            Constraint::Length(input_height),
            Constraint::Length(footer_height),
        ])
        .split(area);
    ScreenChunks {
        transcript: chunks[0],
        status: chunks[1],
        preview: chunks[2],
        shortcuts: chunks[3],
        input: chunks[4],
        footer: chunks[5],
    }
}

fn transient_status(app: &App) -> Option<String> {
    let status = app.status_value();
    if status.is_empty() || status == "ready" {
        None
    } else {
        Some(status)
    }
}

fn active_status_message(app: &App) -> Option<String> {
    let status = transient_status(app)?;
    if status == "running" {
        None
    } else {
        Some(app.chat_widget.locale.status(&status))
    }
}

fn render_transient_status(
    frame: &mut Frame<'_>,
    area: Rect,
    locale: crate::locale::Locale,
    status: &str,
) {
    if area.is_empty() {
        return;
    }
    let line = Line::from(vec![
        Span::styled("• ", crate::style::accent_style()),
        Span::styled(locale.status(status), crate::style::muted_style()),
    ]);
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(
            line,
            usize::from(area.width),
        )),
        area,
    );
}

pub(crate) fn transcript_page_size(width: u16, height: u16, app: &App) -> usize {
    let transcript = screen_chunks(
        Rect::new(0, 0, width, height),
        app,
        app.active_turn_elapsed(Instant::now()),
    )
    .transcript;
    usize::from(transcript.height.saturating_sub(1).max(1))
}

#[cfg(test)]
fn transcript_scroll_offset(
    rendered_line_count: usize,
    area: Rect,
    distance_from_bottom: usize,
) -> u16 {
    let max_scroll = rendered_line_count.saturating_sub(usize::from(area.height));
    let offset = max_scroll.saturating_sub(distance_from_bottom.min(max_scroll));
    u16::try_from(offset).unwrap_or(u16::MAX)
}

#[cfg(test)]
mod tests;
