//! Decorative picker chrome yields to the actionable list on short terminals.

use ratatui::layout::Rect;

pub(super) struct PickerAreas {
    pub(super) header: Rect,
    pub(super) toolbar: Rect,
    pub(super) search: Rect,
    pub(super) list: Rect,
    pub(super) footer: Rect,
}

pub(super) fn areas(area: Rect) -> PickerAreas {
    let mut remaining = area.height;
    let list_minimum = remaining.min(1);
    remaining -= list_minimum;
    let mut footer = remaining.min(1);
    remaining -= footer;
    let search = remaining.min(1);
    remaining -= search;
    let toolbar = remaining.min(1);
    remaining -= toolbar;
    let header = remaining.min(1);
    remaining -= header;
    // Preserve two comfortable rows before restoring secondary hints and gaps.
    let footer_extra = remaining.saturating_sub(5).min(2);
    footer += footer_extra;
    remaining -= footer_extra;
    let gaps = remaining.saturating_sub(5).min(3);
    remaining -= gaps;
    let mut y = area.y;
    let mut section = |height| {
        let rect = Rect::new(area.x, y, area.width, height);
        y += height;
        rect
    };
    let header = section(header);
    section(u16::from(gaps >= 3));
    let toolbar = section(toolbar);
    section(u16::from(gaps >= 2));
    let search = section(search);
    section(u16::from(gaps >= 1));
    let list = section(list_minimum + remaining);
    let footer = section(footer);
    PickerAreas {
        header,
        toolbar,
        search,
        list,
        footer,
    }
}
