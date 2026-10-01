//! The command center shares filtering and visual-row geometry across input and rendering.

mod hints;
mod input;
#[cfg(test)]
mod keymap_tests;
mod navigation;
pub(super) mod render;
pub(super) mod rows;

use super::{AgentsOverviewGroup, AgentsOverviewRow, AgentsOverviewView};

pub(super) const TASK_FILTERS: &[Option<AgentsOverviewGroup>] = &[
    None,
    Some(AgentsOverviewGroup::NeedsYou),
    Some(AgentsOverviewGroup::Working),
    Some(AgentsOverviewGroup::Ready),
    Some(AgentsOverviewGroup::Finished),
];

pub(super) fn display_title(row: &AgentsOverviewRow, fallback: &str) -> String {
    row.thread
        .name
        .as_deref()
        .unwrap_or(&row.thread.preview)
        .trim()
        .lines()
        .next()
        .filter(|title| !title.is_empty())
        .unwrap_or(fallback)
        .to_string()
}
