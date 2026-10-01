//! Section budgets share one plan for rendering and cursor placement.

use ratatui::layout::Rect;

pub(super) struct LayoutSections {
    pub(super) progress_area: Rect,
    pub(super) question_area: Rect,
    pub(super) options_area: Rect,
    pub(super) notes_area: Rect,
}

pub(super) fn menu_surface_inset(area: Rect) -> Rect {
    let horizontal = if area.width > 4 { 2 } else { 0 };
    let vertical = u16::from(area.height > 3);
    Rect::new(
        area.x + horizontal,
        area.y + vertical,
        area.width.saturating_sub(2 * horizontal),
        area.height.saturating_sub(2 * vertical),
    )
}

/// Notes and the selected action survive before descriptive content on short screens.
pub(super) fn layout_sections(
    area: Rect,
    question_height: u16,
    options_preferred: u16,
    notes_preferred: u16,
) -> LayoutSections {
    let mut remaining = area.height;
    let mut notes_height = notes_preferred.min(1).min(remaining);
    remaining -= notes_height;
    let mut options_height = options_preferred
        .min(if notes_height > 0 { 1 } else { 3 })
        .min(remaining);
    remaining -= options_height;
    let progress_height = remaining.min(1);
    remaining -= progress_height;
    let question_height = question_height.min(remaining);
    remaining -= question_height;
    let spacer_after_question = u16::from(remaining > 0 && options_height > 0);
    remaining -= spacer_after_question;
    let notes_extra = notes_preferred.saturating_sub(notes_height).min(remaining);
    notes_height += notes_extra;
    remaining -= notes_extra;
    options_height += options_preferred
        .saturating_sub(options_height)
        .min(remaining);

    let mut y = area.y;
    let mut next_area = |height| {
        let section = Rect::new(area.x, y, area.width, height);
        y += height;
        section
    };
    let progress_area = next_area(progress_height);
    let question_area = next_area(question_height);
    next_area(spacer_after_question);
    let options_area = next_area(options_height);
    let notes_area = next_area(notes_height);
    LayoutSections {
        progress_area,
        question_area,
        options_area,
        notes_area,
    }
}
