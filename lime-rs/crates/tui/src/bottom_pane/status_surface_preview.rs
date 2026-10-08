//! The status-line preview and passive bottom-pane footer lower the same real, optional facts.

use crate::bottom_pane::status_line_setup::StatusLineItem;
use crate::history_cell::sanitize_user_text;
use crate::locale::Locale;
use crate::status::helpers::token_usage_value;
use crate::style::{accent_style, muted_style};
use app_server_protocol::protocol::v2::ThreadTokenUsage;
use ratatui::text::{Line, Span};

#[derive(Clone, Debug, Default)]
pub(crate) struct StatusSurfacePreviewData {
    pub(crate) model: Option<String>,
    pub(crate) reasoning: Option<String>,
    pub(crate) current_dir: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) thread_name: Option<String>,
    pub(crate) raw_output: bool,
    pub(crate) task_progress: Option<(usize, usize)>,
    pub(crate) token_usage: Option<ThreadTokenUsage>,
}

impl StatusSurfacePreviewData {
    pub(crate) fn value_for(&self, item: StatusLineItem, locale: Locale) -> Option<String> {
        let value = match item {
            StatusLineItem::ModelName => self.model.clone(),
            StatusLineItem::ModelWithReasoning => self.model.as_ref().map(|model| {
                self.reasoning
                    .as_ref()
                    .filter(|effort| !effort.is_empty())
                    .map_or_else(|| model.clone(), |effort| format!("{model} {effort}"))
            }),
            StatusLineItem::Reasoning => self.reasoning.clone(),
            StatusLineItem::CurrentDir => self.current_dir.clone(),
            StatusLineItem::Status => self.status.as_ref().map(|status| locale.status(status)),
            StatusLineItem::Permissions => self.permissions.clone(),
            StatusLineItem::SessionId => self.session_id.clone(),
            StatusLineItem::ThreadName => self.thread_name.clone(),
            StatusLineItem::RawOutput => self
                .raw_output
                .then(|| locale.status_line_raw_label().to_string()),
            StatusLineItem::TaskProgress => self
                .task_progress
                .filter(|(_, total)| *total > 0)
                .map(|(completed, total)| locale.task_progress_value(completed, total)),
            item => self
                .token_usage
                .as_ref()
                .and_then(|usage| token_usage_value(item, usage, locale)),
        }?;
        let value = sanitize_user_text(value.into()).replace(['\r', '\n', '\t'], " ");
        (!value.is_empty()).then_some(value)
    }
    pub(crate) fn line(
        &self,
        ids: &[String],
        colors: bool,
        locale: Locale,
    ) -> Option<Line<'static>> {
        let values = ids
            .iter()
            .filter_map(|id| self.value_for(StatusLineItem::from_id(id)?, locale))
            .collect::<Vec<_>>();
        if values.is_empty() {
            return None;
        }
        let style = if colors {
            accent_style()
        } else {
            muted_style()
        };
        Some(Line::from(
            values
                .into_iter()
                .enumerate()
                .flat_map(|(index, value)| {
                    let mut spans = Vec::with_capacity(2);
                    if index > 0 {
                        spans.push(Span::styled(" · ", muted_style()));
                    }
                    spans.push(Span::styled(value, style));
                    spans
                })
                .collect::<Vec<_>>(),
        ))
    }
}
