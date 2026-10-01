//! Long pasted content remains in the draft; only registered atomic ranges expand on submission.

use super::ChatComposer;
use agent_protocol::TextElement;
use std::collections::{HashMap, VecDeque};

pub(super) const LARGE_PASTE_CHAR_THRESHOLD: usize = 1000;

impl ChatComposer {
    pub(super) fn insert_large_paste(&mut self, content: String) {
        self.reconcile_pending_pastes();
        let count = content.chars().count();
        let base = self.locale.pasted_content_label(count);
        let prefix = format!("{base} #");
        let suffix = self
            .draft
            .pending_pastes
            .iter()
            .filter_map(|(label, _)| {
                if label == &base {
                    Some(1)
                } else {
                    label.strip_prefix(&prefix)?.parse::<usize>().ok()
                }
            })
            .max()
            .unwrap_or(0);
        let label = if suffix == 0 {
            base
        } else {
            format!("{base} #{}", suffix + 1)
        };
        self.draft.textarea.insert_element(&label);
        self.draft.pending_pastes.push((label, content));
        self.reset_history_navigation();
        self.sync_completion_popup();
    }

    pub(super) fn reconcile_pending_pastes(&mut self) {
        self.draft
            .pending_pastes
            .retain(|(label, _)| self.draft.textarea.can_restore_element_payload(label));
    }

    pub(crate) fn current_text_with_pending(&self) -> String {
        Self::expand_pending_pastes(
            self.text(),
            self.draft.textarea.text_elements(),
            &self.draft.pending_pastes,
        )
        .0
    }

    pub(crate) fn expand_pending_pastes(
        text: &str,
        mut elements: Vec<TextElement>,
        pending_pastes: &[(String, String)],
    ) -> (String, Vec<TextElement>) {
        if pending_pastes.is_empty() || elements.is_empty() {
            return (text.to_string(), elements);
        }
        let mut pending_by_placeholder: HashMap<&str, VecDeque<&str>> = HashMap::new();
        for (placeholder, actual) in pending_pastes {
            pending_by_placeholder
                .entry(placeholder)
                .or_default()
                .push_back(actual);
        }
        elements.sort_by_key(|element| element.byte_range.start);
        let mut expanded = String::with_capacity(text.len());
        let mut position = 0;
        let mut rebuilt_elements = Vec::with_capacity(elements.len());
        for element in elements {
            let start = element.byte_range.start.min(text.len());
            let end = element.byte_range.end.min(text.len());
            if start > end {
                continue;
            }
            if start > position {
                expanded.push_str(&text[position..start]);
            }
            let element_text = &text[start..end];
            let placeholder = element.placeholder(text).map(str::to_string);
            let paste = placeholder
                .as_deref()
                .and_then(|label| pending_by_placeholder.get_mut(label))
                .and_then(VecDeque::pop_front);
            if let Some(content) = paste {
                expanded.push_str(content);
            } else {
                let start = expanded.len();
                expanded.push_str(element_text);
                rebuilt_elements.push(TextElement::new(start..expanded.len(), element.placeholder));
            }
            position = end;
        }
        expanded.push_str(&text[position..]);
        (expanded, rebuilt_elements)
    }
}

#[cfg(test)]
#[path = "pending_paste_tests.rs"]
mod tests;
