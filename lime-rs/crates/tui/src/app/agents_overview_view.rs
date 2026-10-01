//! Agents Overview selection state over canonical App Server thread metadata.
//! The command center owns terminal interaction, never a second session or history store.

#[path = "agent_center/mod.rs"]
mod command_center;
#[path = "agents_overview_render.rs"]
mod details;
#[path = "agents_overview_grouping.rs"]
mod grouping;

pub(crate) use command_center::render::render;
use command_center::TASK_FILTERS;
use grouping::AgentsOverviewGrouping;

use app_server_protocol::protocol::v2::{Thread, ThreadActiveFlag, ThreadStatus};
use std::cell::Cell;
use std::path::PathBuf;

use crate::keymap::{AgentsKeymap, KeyChordMatcher, ListKeymap};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum AgentsOverviewGroup {
    NeedsYou,
    Working,
    Ready,
    Finished,
}

impl AgentsOverviewGroup {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::NeedsYou => "Needs input",
            Self::Working => "Working",
            Self::Ready => "Ready",
            Self::Finished => "Inactive",
        }
    }

    pub(crate) fn for_status(status: &ThreadStatus) -> Self {
        match status {
            ThreadStatus::Active { active_flags }
                if active_flags.contains(&ThreadActiveFlag::WaitingOnApproval)
                    || active_flags.contains(&ThreadActiveFlag::WaitingOnUserInput) =>
            {
                Self::NeedsYou
            }
            ThreadStatus::Active { .. } => Self::Working,
            ThreadStatus::Idle => Self::Ready,
            ThreadStatus::SystemError => Self::NeedsYou,
            ThreadStatus::NotLoaded => Self::Finished,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AgentsOverviewRow {
    pub(crate) thread: Thread,
    pub(crate) group: AgentsOverviewGroup,
    pub(crate) is_current: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentsOverviewInputMode {
    NewTask,
    Rename,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum AgentsOverviewAction {
    None,
    Cancel,
    LoadMore,
    Select,
    Dispatch {
        prompt: String,
        cwd: Option<PathBuf>,
    },
    Rename {
        thread_id: String,
        name: String,
    },
    Stop {
        thread_id: String,
    },
    OpenResumePicker,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct AgentsOverviewView {
    pub(crate) rows: Vec<AgentsOverviewRow>,
    selected: usize,
    search: String,
    searching: bool,
    grouping: AgentsOverviewGrouping,
    status_filter: usize,
    help: bool,
    input: String,
    input_mode: Option<AgentsOverviewInputMode>,
    rename_target: Option<String>,
    task_cwd: Option<PathBuf>,
    has_more: bool,
    loading_more: bool,
    load_more_failed: bool,
    agents_keymap: AgentsKeymap,
    list_keymap: ListKeymap,
    key_chord_matcher: KeyChordMatcher,
    // Rendering and paging share visual-row geometry, including group headings and gaps.
    scroll: Cell<usize>,
    page_height: Cell<usize>,
}

impl AgentsOverviewView {
    #[cfg(test)]
    pub(crate) fn new(rows: Vec<AgentsOverviewRow>, selected_thread_id: Option<&str>) -> Self {
        Self::new_with_keymap(
            rows,
            selected_thread_id,
            AgentsKeymap::default(),
            ListKeymap::default(),
        )
    }

    pub(crate) fn new_with_keymap(
        rows: Vec<AgentsOverviewRow>,
        selected_thread_id: Option<&str>,
        agents_keymap: AgentsKeymap,
        list_keymap: ListKeymap,
    ) -> Self {
        let mut view = Self {
            rows,
            agents_keymap,
            list_keymap,
            ..Self::default()
        };
        view.selected = selected_thread_id
            .and_then(|id| {
                view.visible_rows()
                    .iter()
                    .position(|row| row.thread.id == id)
            })
            .or_else(|| view.visible_rows().iter().position(|row| row.is_current))
            .unwrap_or(0);
        view
    }

    pub(crate) fn selected_thread_id(&self) -> Option<&str> {
        self.selected_row().map(|row| row.thread.id.as_str())
    }

    pub(crate) fn selected_index(&self) -> Option<usize> {
        let count = self.item_count();
        (count > 0).then(|| self.selected.min(count - 1))
    }

    pub(crate) fn has_more(&self) -> bool {
        self.has_more
    }
    pub(crate) fn loading_more(&self) -> bool {
        self.loading_more
    }
    pub(crate) fn load_more_failed(&self) -> bool {
        self.load_more_failed
    }

    pub(crate) fn selected_is_load_more(&self) -> bool {
        self.has_more && self.selected == self.visible_rows().len()
    }

    pub(crate) fn set_pagination(
        &mut self,
        has_more: bool,
        loading_more: bool,
        load_more_failed: bool,
    ) {
        let was_load_more_selected = self.selected_is_load_more();
        self.has_more = has_more;
        self.loading_more = loading_more;
        self.load_more_failed = load_more_failed;
        if was_load_more_selected && has_more {
            self.selected = self.visible_rows().len();
        } else {
            self.clamp_selection();
        }
    }

    #[cfg(test)]
    pub(crate) fn is_searching(&self) -> bool {
        self.searching
    }
    pub(crate) fn search(&self) -> &str {
        &self.search
    }
    pub(crate) fn input(&self) -> &str {
        &self.input
    }
    #[cfg(test)]
    pub(crate) fn input_mode(&self) -> Option<AgentsOverviewInputMode> {
        self.input_mode
    }

    pub(crate) fn update_rows(&mut self, rows: Vec<AgentsOverviewRow>) {
        let selected = self.selected_thread_id().map(str::to_owned);
        let selected_load_more = self.selected_is_load_more();
        self.rows = rows;
        self.key_chord_matcher.reset();
        self.selected = selected
            .as_deref()
            .and_then(|id| {
                self.visible_rows()
                    .iter()
                    .position(|row| row.thread.id == id)
            })
            .unwrap_or_else(|| {
                if selected_load_more && self.has_more {
                    self.visible_rows().len()
                } else {
                    0
                }
            });
        self.clamp_selection();
    }

    pub(crate) fn visible_rows(&self) -> Vec<&AgentsOverviewRow> {
        let query = self.search.to_lowercase();
        let status = TASK_FILTERS[self.status_filter];
        let mut rows = self
            .rows
            .iter()
            .filter(|row| {
                let searchable = format!(
                    "{} {} {}",
                    row.thread.name.as_deref().unwrap_or_default(),
                    row.thread.preview,
                    row.thread.cwd.display(),
                )
                .to_lowercase();
                (query.is_empty() || searchable.contains(&query))
                    && (self.rename_target.as_deref() == Some(row.thread.id.as_str())
                        || status.is_none_or(|group| group == row.group))
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            let order = match self.grouping {
                AgentsOverviewGrouping::Project => left.thread.cwd.cmp(&right.thread.cwd),
                AgentsOverviewGrouping::Status => left.group.cmp(&right.group),
            };
            order
                .then_with(|| right.thread.updated_at.cmp(&left.thread.updated_at))
                .then_with(|| left.thread.id.cmp(&right.thread.id))
        });
        rows
    }

    pub(crate) fn selected_row(&self) -> Option<&AgentsOverviewRow> {
        self.visible_rows().get(self.selected).copied()
    }

    fn item_count(&self) -> usize {
        self.visible_rows().len() + usize::from(self.has_more)
    }

    fn clamp_selection(&mut self) {
        self.selected = self.selected.min(self.item_count().saturating_sub(1));
    }

    fn select_thread(&mut self, id: Option<&str>) {
        self.selected = id
            .and_then(|id| {
                self.visible_rows()
                    .iter()
                    .position(|row| row.thread.id == id)
            })
            .unwrap_or(0);
        self.clamp_selection();
    }

    fn move_selection(&mut self, forward: bool) {
        let count = self.item_count();
        if count == 0 {
            self.selected = 0;
            return;
        }
        self.selected = if forward {
            (self.selected + 1) % count
        } else {
            self.selected.checked_sub(1).unwrap_or(count - 1)
        };
    }

    fn editing_metadata(&self) -> bool {
        self.searching || self.input_mode.is_some()
    }
}

#[cfg(test)]
#[path = "agent_center_tests.rs"]
mod tests;
