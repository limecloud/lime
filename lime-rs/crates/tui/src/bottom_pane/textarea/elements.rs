//! Placeholder ranges are atomic edits, never inferred from matching ordinary text.

use super::*;

#[derive(Clone, Debug)]
pub(super) struct TextElement {
    pub(super) id: u64,
    pub(super) range: Range<usize>,
    placeholder: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextElementSnapshot {
    pub(crate) id: u64,
    pub(crate) range: Range<usize>,
    pub(crate) text: String,
    pub(crate) placeholder: Option<String>,
}

impl TextArea {
    pub(crate) fn element_payloads(&self) -> Vec<String> {
        self.text_element_snapshots()
            .into_iter()
            .map(|element| element.text)
            .collect()
    }

    pub(crate) fn text_elements(&self) -> Vec<agent_protocol::TextElement> {
        self.text_element_snapshots()
            .into_iter()
            .map(|element| agent_protocol::TextElement::new(element.range, element.placeholder))
            .collect()
    }

    /// Rename only a registered element, preserving cursor and neighboring atomic ranges.
    pub(crate) fn replace_element_payload(&mut self, old: &str, new: &str) -> bool {
        let Some(index) = self
            .elements
            .iter()
            .position(|element| self.text.get(element.range.clone()) == Some(old))
        else {
            return false;
        };
        let element = self.elements[index].clone();
        let range = element.range;
        self.replace_range(range.clone(), new);
        if !new.is_empty() {
            self.elements.push(TextElement {
                id: element.id,
                range: range.start..range.start + new.len(),
                placeholder: element.placeholder.map(|_| new.to_owned()),
            });
            self.elements.sort_by_key(|element| element.range.start);
        }
        true
    }

    pub(crate) fn insert_element(&mut self, text: &str) -> u64 {
        self.delete_mouse_selection();
        let start = self.nearest_atomic_boundary(self.cursor);
        self.insert_str_at(start, text);
        let id = self.add_element(start..start + text.len(), Some(text.to_owned()));
        self.set_cursor(start + text.len());
        id
    }

    fn add_element(&mut self, range: Range<usize>, placeholder: Option<String>) -> u64 {
        let id = self.next_element_id;
        self.next_element_id = self.next_element_id.saturating_add(1);
        self.elements.push(TextElement {
            id,
            range,
            placeholder,
        });
        self.elements.sort_by_key(|element| element.range.start);
        id
    }

    pub(crate) fn add_element_range(&mut self, range: Range<usize>) -> Option<u64> {
        let placeholder = self.text.get(range.clone()).map(str::to_owned);
        self.add_element_range_with_placeholder(range, placeholder)
    }

    fn add_element_range_with_placeholder(
        &mut self,
        range: Range<usize>,
        placeholder: Option<String>,
    ) -> Option<u64> {
        if range.is_empty()
            || self.text.get(range.clone()).is_none()
            || self
                .elements
                .iter()
                .any(|element| range.start < element.range.end && element.range.start < range.end)
        {
            return None;
        }
        Some(self.add_element(range, placeholder))
    }

    pub(crate) fn element_id_for_exact_range(&self, range: Range<usize>) -> Option<u64> {
        self.elements
            .iter()
            .find(|element| element.range == range)
            .map(|element| element.id)
    }

    pub(crate) fn text_element_ranges(&self) -> impl Iterator<Item = &Range<usize>> {
        self.elements.iter().map(|element| &element.range)
    }

    pub(crate) fn set_text_with_elements(
        &mut self,
        text: &str,
        elements: &[agent_protocol::TextElement],
    ) {
        self.set_text_clearing_elements(text);
        for element in elements {
            let range = element.byte_range.start..element.byte_range.end;
            if self.text.get(range.clone()).is_some_and(|value| {
                element
                    .placeholder
                    .as_deref()
                    .is_none_or(|placeholder| placeholder == value)
            }) {
                self.add_element_range_with_placeholder(range, element.placeholder.clone());
            }
        }
    }

    pub(crate) fn text_element_snapshots(&self) -> Vec<TextElementSnapshot> {
        self.elements
            .iter()
            .filter_map(|element| {
                self.text
                    .get(element.range.clone())
                    .map(|text| TextElementSnapshot {
                        id: element.id,
                        range: element.range.clone(),
                        text: text.to_string(),
                        placeholder: element.placeholder.clone(),
                    })
            })
            .collect()
    }

    pub(crate) fn can_restore_element_payload(&self, payload: &str) -> bool {
        self.elements
            .iter()
            .any(|element| self.text.get(element.range.clone()) == Some(payload))
    }

    pub(crate) fn restore_text_elements(&mut self, elements: &[TextElementSnapshot]) {
        self.elements.clear();
        let mut elements = elements.iter().collect::<Vec<_>>();
        elements.sort_by_key(|element| element.range.start);
        for element in elements {
            if element.range.is_empty()
                || self.text.get(element.range.clone()) != Some(element.text.as_str())
                || element
                    .placeholder
                    .as_deref()
                    .is_some_and(|placeholder| placeholder != element.text)
                || self
                    .elements
                    .last()
                    .is_some_and(|previous| previous.range.end > element.range.start)
            {
                continue;
            }
            self.elements.push(TextElement {
                id: element.id,
                range: element.range.clone(),
                placeholder: element.placeholder.clone(),
            });
            self.next_element_id = self.next_element_id.max(element.id.saturating_add(1));
        }
        self.cursor = self.nearest_atomic_boundary(self.cursor);
    }

    pub(super) fn nearest_atomic_boundary(&self, pos: usize) -> usize {
        let pos = self.nearest_char_boundary(pos.min(self.text.len()));
        self.elements
            .iter()
            .map(|element| &element.range)
            .find(|range| range.start < pos && pos < range.end)
            .map_or(pos, |range| {
                if pos - range.start < range.end - pos {
                    range.start
                } else {
                    range.end
                }
            })
    }

    pub(super) fn atomic_edit_range(&self, range: Range<usize>) -> Range<usize> {
        let mut start = self.nearest_char_boundary(range.start.min(self.text.len()));
        let mut end = self.nearest_char_boundary(range.end.min(self.text.len()));
        if start == end {
            let boundary = self.nearest_atomic_boundary(start);
            return boundary..boundary;
        }
        for element in &self.elements {
            if element.range.start < end && start < element.range.end {
                start = start.min(element.range.start);
                end = end.max(element.range.end);
            }
        }
        start..end
    }

    pub(super) fn shift_elements(&mut self, start: usize, end: usize, inserted: usize) {
        let delta = inserted as isize - (end - start) as isize;
        self.elements.retain_mut(|element| {
            let range = &mut element.range;
            if range.end <= start {
                true
            } else if range.start >= end {
                range.start = range.start.saturating_add_signed(delta);
                range.end = range.end.saturating_add_signed(delta);
                true
            } else {
                false
            }
        });
    }

    pub(super) fn render_elements(
        &self,
        area: Rect,
        buf: &mut Buffer,
        visible: Range<usize>,
        y: u16,
    ) {
        for element in &self.elements {
            let start = element.range.start.max(visible.start);
            let end = element.range.end.min(visible.end);
            if start >= end {
                continue;
            }
            let offset = display_width(&self.text[visible.start..start]);
            if offset >= usize::from(area.width) {
                continue;
            }
            let x = area.x + offset as u16;
            buf.set_stringn(
                x,
                y,
                text_for_display(&self.text[start..end]),
                usize::from(area.width) - offset,
                Style::default().fg(ratatui::style::Color::Cyan),
            );
        }
    }
}

#[cfg(test)]
#[path = "elements_tests.rs"]
mod tests;
