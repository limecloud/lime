//! Canonical, borderless status presentation for the TUI.
//!
//! The App remains the owner of session facts. This module only formats those facts for the
//! terminal; it does not fetch usage, account or provider state locally.

mod format;
pub(crate) mod helpers;

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::bottom_pane::status_line_setup::StatusLineItem;
use crate::line_truncation::line_width;
use crate::locale::Locale;
use crate::wrapping::{word_wrap_lines, RtOptions};
use app_server_protocol::protocol::v2::ThreadTokenUsage;

use self::format::FieldFormatter;

pub(crate) struct StatusFacts<'a> {
    pub(crate) thread_id: Option<&'a str>,
    pub(crate) model: Option<&'a str>,
    pub(crate) provider: Option<&'a str>,
    pub(crate) effort: Option<&'a str>,
    pub(crate) permissions: Option<&'a str>,
    pub(crate) cwd: &'a str,
    pub(crate) status: &'a str,
    pub(crate) token_usage: Option<&'a ThreadTokenUsage>,
}

#[derive(Clone, Debug)]
pub(crate) struct StatusSnapshot {
    thread_id: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    effort: Option<String>,
    permissions: Option<String>,
    cwd: String,
    status: String,
    token_usage: Option<ThreadTokenUsage>,
}

impl StatusSnapshot {
    pub(crate) fn from_facts(facts: StatusFacts<'_>) -> Self {
        Self {
            thread_id: facts.thread_id.map(str::to_owned),
            model: facts.model.map(str::to_owned),
            provider: facts.provider.map(str::to_owned),
            effort: facts.effort.map(str::to_owned),
            permissions: facts.permissions.map(str::to_owned),
            cwd: facts.cwd.to_owned(),
            status: facts.status.to_owned(),
            token_usage: facts.token_usage.cloned(),
        }
    }

    fn fields(&self, locale: Locale) -> Vec<(&'static str, String)> {
        let value = |value: Option<&String>| {
            value
                .map(String::as_str)
                .filter(|value| !value.is_empty())
                .unwrap_or(locale.not_set_label())
                .to_owned()
        };
        let status = if self.status.is_empty() {
            locale.ready_label().to_owned()
        } else {
            locale.status(&self.status)
        };
        let mut fields = vec![
            (locale.thread_label(), value(self.thread_id.as_ref())),
            (locale.model_label(), value(self.model.as_ref())),
            (locale.provider_label(), value(self.provider.as_ref())),
            (locale.effort_label(), value(self.effort.as_ref())),
            (locale.permissions_label(), value(self.permissions.as_ref())),
            (locale.cwd_label(), self.cwd.clone()),
            (locale.state_label(), status),
        ];
        if let Some(usage) = &self.token_usage {
            for item in [
                StatusLineItem::UsedTokens,
                StatusLineItem::TotalInputTokens,
                StatusLineItem::TotalOutputTokens,
                StatusLineItem::ContextWindowSize,
                StatusLineItem::ContextRemaining,
                StatusLineItem::ContextUsed,
            ] {
                if let Some(value) = helpers::token_usage_value(item, usage, locale) {
                    fields.push((locale.token_usage_item_name(item), value));
                }
            }
        }
        fields
    }

    pub(crate) fn lines(&self, locale: Locale, width: u16) -> Vec<Line<'static>> {
        let width = usize::from(width);
        if width == 0 {
            return Vec::new();
        }
        let fields = self.fields(locale);
        let formatter = FieldFormatter::from_labels(fields.iter().map(|(label, _)| *label));
        let continuation = if formatter.value_width(width) > 0 {
            formatter.continuation()
        } else {
            Line::from(Span::raw("  "))
        };
        let options = RtOptions::new(width)
            .subsequent_indent(continuation)
            .word_splitter(textwrap::WordSplitter::NoHyphenation);

        let mut lines = vec![Line::default()];
        let title = Line::from(vec![
            Span::raw("  "),
            Span::styled(">_ ", Style::default().add_modifier(Modifier::DIM)),
            Span::styled("Lime", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                format!(" (v{})", env!("CARGO_PKG_VERSION")),
                Style::default().add_modifier(Modifier::DIM),
            ),
        ]);
        lines.extend(word_wrap_lines(
            [title],
            RtOptions::new(width)
                .subsequent_indent(Line::from(Span::raw("  ")))
                .word_splitter(textwrap::WordSplitter::NoHyphenation),
        ));
        lines.push(Line::default());
        for (label, value) in fields {
            let field = formatter.line(label, value);
            let wrapped = word_wrap_lines([field.clone()], options.clone());
            if wrapped.iter().any(|line| line_width(line) > width) {
                lines.extend(word_wrap_lines(
                    [field],
                    RtOptions::new(width).word_splitter(textwrap::WordSplitter::NoHyphenation),
                ));
            } else {
                lines.extend(wrapped);
            }
        }
        lines
    }

    /// Unwrapped source lines used when a status surface is copied or inspected without a frame.
    pub(crate) fn raw_lines(&self, locale: Locale) -> Vec<Line<'static>> {
        let fields = self.fields(locale);
        let formatter = FieldFormatter::from_labels(fields.iter().map(|(label, _)| *label));
        fields
            .into_iter()
            .map(|(label, value)| formatter.line(label, value))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_truncation::line_width;

    fn snapshot() -> StatusSnapshot {
        StatusSnapshot {
            thread_id: Some("00000000-0000-0000-0000-000000000123".to_string()),
            model: Some("fixture-model".to_string()),
            provider: Some("fixture-provider".to_string()),
            effort: Some("high".to_string()),
            permissions: Some(":workspace with network access".to_string()),
            cwd: "/workspace/projects/界界/ｶﾞﾞ/a-very-long-directory-name/codex".to_string(),
            status: "running".to_string(),
            token_usage: None,
        }
    }

    #[test]
    fn status_wraps_values_without_exceeding_terminal_width() {
        let snapshot = snapshot();
        for width in [7, 12, 17, 24, 40, 80] {
            let lines = snapshot.lines(Locale::EnUs, width);
            assert!(
                lines
                    .iter()
                    .all(|line| line_width(line) <= usize::from(width)),
                "overwide status row at {width}: {:?}",
                lines
                    .iter()
                    .map(|line| (line_width(line), line.to_string()))
                    .collect::<Vec<_>>()
            );
            let text = lines.iter().map(Line::to_string).collect::<String>();
            let compact = text
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>();
            assert!(compact.contains("00000000-0000-0000-0000-000000000123"));
            assert!(compact.contains("/workspace/projects/界界/ｶﾞﾞ/a-very-long-directory-name/codex"));
        }
    }

    #[test]
    fn status_uses_ready_when_projection_has_no_state() {
        let snapshot = StatusSnapshot {
            thread_id: None,
            model: None,
            provider: None,
            effort: None,
            permissions: None,
            cwd: "/workspace".to_string(),
            status: String::new(),
            token_usage: None,
        };
        let text = snapshot
            .lines(Locale::EnUs, 80)
            .iter()
            .map(Line::to_string)
            .collect::<String>();
        assert!(text.contains("ready"));
        assert!(text.contains("not set"));
    }

    #[test]
    fn usage_wraps_and_copy_uses_the_same_fields_without_unknown_defaults() {
        let mut snapshot = snapshot();
        let count = serde_json::json!({
            "totalTokens": 31000, "inputTokens": 30000, "cachedInputTokens": 10000,
            "outputTokens": 1000, "reasoningOutputTokens": 500
        });
        snapshot.token_usage = Some(
            serde_json::from_value(serde_json::json!({
                "total": count, "last": count, "modelContextWindow": 128000
            }))
            .unwrap(),
        );
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let copied = snapshot.raw_lines(locale);
            for width in [7, 12, 24, 80] {
                let rendered = snapshot.lines(locale, width);
                assert!(rendered
                    .iter()
                    .all(|line| line_width(line) <= usize::from(width)));
                let compact = |text: String| {
                    text.chars()
                        .filter(|ch| !ch.is_whitespace())
                        .collect::<String>()
                };
                let text = compact(rendered.iter().map(Line::to_string).collect());
                for line in &copied {
                    assert!(
                        text.contains(&compact(line.to_string())),
                        "locale={locale:?}, width={width}"
                    );
                }
            }
        }
        snapshot.token_usage.as_mut().unwrap().model_context_window = None;
        let text = snapshot
            .raw_lines(Locale::EnUs)
            .iter()
            .map(Line::to_string)
            .collect::<String>();
        assert!(text.contains("21K used"));
        assert!(!text.contains("Context"));
        assert!(!text.contains("100%"));
        snapshot.token_usage = None;
        let text = snapshot
            .raw_lines(Locale::EnUs)
            .iter()
            .map(Line::to_string)
            .collect::<String>();
        assert!(!text.contains("tokens"));
    }
}
