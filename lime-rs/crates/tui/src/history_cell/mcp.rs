//! MCP tool-call history cells.

use super::*;
use crate::locale::Locale;
use app_server_protocol::protocol::v2::{
    McpAuthStatus, McpServerConnectionStatus, McpServerStatus, McpServerStatusDetail,
};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

#[derive(Debug, Clone)]
pub(crate) struct McpInvocation {
    pub(crate) server: String,
    pub(crate) tool: String,
    pub(crate) arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct McpToolCallCell {
    pub(crate) call_id: String,
    pub(crate) invocation: McpInvocation,
    pub(crate) result: Option<String>,
    pub(crate) failed: bool,
}

impl McpToolCallCell {
    pub(crate) fn new(call_id: String, invocation: McpInvocation) -> Self {
        Self {
            call_id,
            invocation,
            result: None,
            failed: false,
        }
    }
}

impl HistoryCell for McpToolCallCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        self.display_hyperlink_lines(width)
            .into_iter()
            .map(|line| line.line)
            .collect()
    }

    fn display_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        let summary = self.result.clone().into_iter().collect();
        TranscriptHistoryCell::new(
            TranscriptEntry {
                id: self.call_id.clone(),
                kind: EntryKind::Mcp,
                text: format!("{}.{}", self.invocation.server, self.invocation.tool),
                streaming: self.result.is_none() && !self.failed,
                status: None,
                summary,
                activity_group: None,
                activity_detail: None,
            },
            Locale::default(),
            std::path::PathBuf::new(),
        )
        .display_hyperlink_lines(width)
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        self.display_lines(u16::MAX)
    }
}

#[derive(Debug, Default)]
pub(crate) struct McpInventoryLoadingCell;

impl HistoryCell for McpInventoryLoadingCell {
    fn display_lines(&self, _width: u16) -> Vec<Line<'static>> {
        vec![Line::from("Loading MCP inventory")]
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        self.display_lines(u16::MAX)
    }
}

/// Convert the App Server-owned MCP inventory into bounded pager lines.
///
/// Only status/auth/tool names are rendered here. The TUI does not inspect client-local config or
/// provider-specific payloads, so unknown fields remain outside the presentation contract.
pub(crate) fn mcp_inventory_lines(
    statuses: &[McpServerStatus],
    detail: McpServerStatusDetail,
    locale: Locale,
) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from("/mcp"),
        Line::from(""),
        Line::from(Span::styled(
            format!("🔌  {}", locale.mcp_inventory_title()),
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
    ];
    let mut statuses = statuses.iter().collect::<Vec<_>>();
    statuses.sort_by(|left, right| left.name.cmp(&right.name));
    if statuses.is_empty() {
        lines.push(Line::from(locale.mcp_no_servers()));
        return lines;
    }
    if matches!(detail, McpServerStatusDetail::Full)
        && statuses.iter().all(|status| status.tools.is_empty())
    {
        lines.push(Line::from(locale.mcp_no_tools_available()));
        lines.push(Line::from(""));
    }
    for status in statuses {
        let state = locale.mcp_status(mcp_connection_status_label(
            status.runtime_status,
            status.auth_status,
        ));
        let count = status.tools.len();
        lines.push(Line::from(format!(
            "  • {}: {} ({} {})",
            status.name,
            state,
            count,
            locale.mcp_tool_unit(count),
        )));
        if matches!(detail, McpServerStatusDetail::ToolsAndAuthOnly) {
            continue;
        }
        let auth = locale.mcp_auth_status(mcp_auth_status_label(status.auth_status));
        lines.push(Line::from(format!(
            "    • {}: {auth}",
            locale.mcp_auth_label(),
        )));

        let mut names = status.tools.keys().cloned().collect::<Vec<_>>();
        names.sort();
        let tools = if names.is_empty() {
            locale.mcp_none().to_string()
        } else {
            names.join(", ")
        };
        lines.push(Line::from(format!(
            "    • {}: {tools}",
            locale.mcp_tools_label()
        )));

        if status.resources.is_empty() {
            lines.push(Line::from(format!(
                "    • {}: {}",
                locale.mcp_resources_label(),
                locale.mcp_none()
            )));
        } else {
            let values = status
                .resources
                .iter()
                .map(|resource| {
                    format!(
                        "{} ({})",
                        resource.title.as_deref().unwrap_or(&resource.name),
                        resource.uri
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(Line::from(format!(
                "    • {}: {values}",
                locale.mcp_resources_label()
            )));
        }

        if status.resource_templates.is_empty() {
            lines.push(Line::from(format!(
                "    • {}: {}",
                locale.mcp_resource_templates_label(),
                locale.mcp_none()
            )));
        } else {
            let values = status
                .resource_templates
                .iter()
                .map(|template| {
                    format!(
                        "{} ({})",
                        template.title.as_deref().unwrap_or(&template.name),
                        template.uri_template
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(Line::from(format!(
                "    • {}: {values}",
                locale.mcp_resource_templates_label()
            )));
        }
        lines.push(Line::from(""));
    }
    if matches!(detail, McpServerStatusDetail::ToolsAndAuthOnly) {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            locale.mcp_use_verbose(),
            Style::default().add_modifier(Modifier::DIM),
        )));
    }
    lines
}

fn mcp_connection_status_label(
    status: Option<McpServerConnectionStatus>,
    auth_status: McpAuthStatus,
) -> &'static str {
    match status {
        Some(McpServerConnectionStatus::Connected) => "connected",
        Some(McpServerConnectionStatus::Starting) => "starting",
        Some(McpServerConnectionStatus::AuthenticationRequired) => "authentication required",
        Some(McpServerConnectionStatus::Failed) => "failed",
        Some(McpServerConnectionStatus::NotStarted) => "not started",
        Some(McpServerConnectionStatus::Disabled) => "disabled",
        Some(McpServerConnectionStatus::Cancelled) => "cancelled",
        None if matches!(auth_status, McpAuthStatus::NotLoggedIn) => "authentication required",
        None => "unknown",
    }
}

fn mcp_auth_status_label(status: McpAuthStatus) -> &'static str {
    match status {
        McpAuthStatus::Unknown => "unknown",
        McpAuthStatus::Unsupported => "unsupported",
        McpAuthStatus::NotLoggedIn => "not logged in",
        McpAuthStatus::BearerToken => "bearer token",
        McpAuthStatus::OAuth => "OAuth",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::McpTool;
    use std::collections::HashMap;

    fn line_text(line: &Line<'static>) -> String {
        line.spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect()
    }

    fn status(name: &str, tool: &str) -> McpServerStatus {
        let mut tools = HashMap::new();
        tools.insert(
            tool.to_string(),
            McpTool {
                name: tool.to_string(),
                title: None,
                description: None,
                input_schema: serde_json::json!({}),
                output_schema: None,
                annotations: None,
                icons: None,
                meta: None,
            },
        );
        McpServerStatus {
            name: name.to_string(),
            runtime_status: Some(McpServerConnectionStatus::Connected),
            plugin_id: None,
            server_info: None,
            tools,
            resources: Vec::new(),
            resource_templates: Vec::new(),
            auth_status: McpAuthStatus::BearerToken,
        }
    }

    #[test]
    fn inventory_is_sorted_and_full_detail_includes_tool_counts_and_names() {
        let lines = mcp_inventory_lines(
            &[status("zeta", "z-tool"), status("alpha", "a-tool")],
            McpServerStatusDetail::Full,
            Locale::EnUs,
        );
        let text = lines.iter().map(line_text).collect::<Vec<_>>();
        assert_eq!(text[4], "  • alpha: connected (1 tool)");
        assert_eq!(text[5], "    • Auth: Bearer token");
        assert_eq!(text[6], "    • Tools: a-tool");
        assert_eq!(text[7], "    • Resources: (none)");
        assert_eq!(text[8], "    • Resource templates: (none)");
        assert!(text[10].starts_with("  • zeta: connected"));
    }

    #[test]
    fn compact_inventory_matches_upstream_summary_shape() {
        let lines = mcp_inventory_lines(
            &[status("alpha", "a-tool")],
            McpServerStatusDetail::ToolsAndAuthOnly,
            Locale::EnUs,
        );
        let text = lines.iter().map(line_text).collect::<Vec<_>>();
        assert_eq!(text[4], "  • alpha: connected (1 tool)");
        assert!(text.iter().all(|line| !line.contains("Auth:")));
        assert_eq!(text[6], "Use /mcp verbose for tools and resources.");
    }

    #[test]
    fn full_inventory_uses_upstream_empty_tool_label() {
        let mut empty = status("alpha", "a-tool");
        empty.tools.clear();
        let lines = mcp_inventory_lines(&[empty], McpServerStatusDetail::Full, Locale::EnUs);
        let text = lines.iter().map(line_text).collect::<Vec<_>>();
        assert_eq!(text[8], "    • Tools: (none)");
    }

    #[test]
    fn full_inventory_preserves_resource_order_from_app_server() {
        let mut server = status("alpha", "a-tool");
        server.resources = vec![
            app_server_protocol::protocol::v2::McpResource {
                annotations: None,
                name: "zeta".to_string(),
                title: None,
                uri: "file:///zeta".to_string(),
                description: None,
                mime_type: None,
                size: None,
                icons: None,
                meta: None,
            },
            app_server_protocol::protocol::v2::McpResource {
                annotations: None,
                name: "alpha".to_string(),
                title: None,
                uri: "file:///alpha".to_string(),
                description: None,
                mime_type: None,
                size: None,
                icons: None,
                meta: None,
            },
        ];
        let lines = mcp_inventory_lines(&[server], McpServerStatusDetail::Full, Locale::EnUs);
        let text = lines.iter().map(line_text).collect::<Vec<_>>();
        assert_eq!(text[5], "    • Auth: Bearer token");
        assert_eq!(
            text[7],
            "    • Resources: zeta (file:///zeta), alpha (file:///alpha)"
        );
    }

    #[test]
    fn inventory_empty_state_is_localized() {
        let lines = mcp_inventory_lines(&[], McpServerStatusDetail::ToolsAndAuthOnly, Locale::ZhCn);
        let text = lines.iter().map(line_text).collect::<Vec<_>>();
        assert_eq!(text[4], "未配置 MCP 服务器。");
    }
}
