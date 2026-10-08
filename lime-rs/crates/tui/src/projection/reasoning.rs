//! Indexed summary facts are retained beside their renderable body, never mixed with raw content.

use std::collections::BTreeMap;

use crate::history_cell::split_reasoning_summary_parts;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ReasoningSummary {
    parts: BTreeMap<i64, String>,
}

impl ReasoningSummary {
    pub(crate) fn from_parts(parts: &[String]) -> Self {
        Self {
            parts: parts
                .iter()
                .enumerate()
                .map(|(index, part)| (index as i64, part.clone()))
                .collect(),
        }
    }

    pub(super) fn append(&mut self, index: i64, delta: &str) {
        self.parts.entry(index).or_default().push_str(delta);
    }

    pub(super) fn content(&self) -> String {
        let parts = self.parts.values().cloned().collect::<Vec<_>>();
        split_reasoning_summary_parts(&parts).1
    }

    pub(super) fn latest_status(&self) -> Option<String> {
        self.parts
            .values()
            .rev()
            .find_map(|part| latest_summary_line(part))
    }
}

fn latest_summary_line(text: &str) -> Option<String> {
    text.lines().rev().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with("<!--") {
            return None;
        }
        let line = line.trim_start_matches('#').trim();
        let line = if let Some(stripped) = line.strip_prefix("**") {
            let (bold, trailing) = stripped.split_once("**")?;
            format!("{bold}{trailing}")
        } else {
            line.to_string()
        };
        (!line.is_empty()).then_some(line)
    })
}

#[cfg(test)]
#[path = "reasoning_stdio_tests.rs"]
mod stdio_tests;
