//! Session Export Support
//!
//! Provides multi-format export functionality for sessions.

use crate::conversation::message::MessageContent;
use crate::session::{Session, SessionManager};
use anyhow::Result;

/// Export format options
#[derive(Debug, Clone, Copy, Default)]
pub enum ExportFormat {
    #[default]
    Json,
    Markdown,
    Html,
}

/// Export options
#[derive(Debug, Clone, Default)]
pub struct ExportOptions {
    /// Export format
    pub format: ExportFormat,
    /// Include messages in export
    pub include_messages: bool,
    /// Include metadata in export
    pub include_metadata: bool,
    /// Pretty print JSON output
    pub pretty_print: bool,
}

impl ExportOptions {
    pub fn new() -> Self {
        Self {
            format: ExportFormat::Json,
            include_messages: true,
            include_metadata: true,
            pretty_print: true,
        }
    }

    pub fn format(mut self, format: ExportFormat) -> Self {
        self.format = format;
        self
    }

    pub fn include_messages(mut self, include: bool) -> Self {
        self.include_messages = include;
        self
    }

    pub fn include_metadata(mut self, include: bool) -> Self {
        self.include_metadata = include;
        self
    }
}

/// Export a session to the specified format
pub async fn export_session(session_id: &str, options: ExportOptions) -> Result<String> {
    let session = SessionManager::get_session(session_id, options.include_messages).await?;

    match options.format {
        ExportFormat::Json => export_to_json(&session, &options),
        ExportFormat::Markdown => export_to_markdown(&session, &options),
        ExportFormat::Html => export_to_html(&session, &options),
    }
}

/// Export session to JSON format
fn export_to_json(session: &Session, options: &ExportOptions) -> Result<String> {
    if options.pretty_print {
        serde_json::to_string_pretty(session).map_err(Into::into)
    } else {
        serde_json::to_string(session).map_err(Into::into)
    }
}

/// Export session to Markdown format
fn export_to_markdown(session: &Session, options: &ExportOptions) -> Result<String> {
    let mut lines = Vec::new();

    // Title
    lines.push(format!("# {}", session.name));
    lines.push(String::new());

    // Metadata
    if options.include_metadata {
        lines.push("## Metadata".to_string());
        lines.push(String::new());
        lines.push(format!("- **ID:** {}", session.id));
        lines.push(format!("- **Created:** {}", session.created_at));
        lines.push(format!("- **Updated:** {}", session.updated_at));
        lines.push(format!(
            "- **Working Directory:** {}",
            session.working_dir.display()
        ));
        lines.push(format!("- **Messages:** {}", session.message_count));

        if let Some(tokens) = session.total_tokens {
            lines.push(format!("- **Total Tokens:** {}", tokens));
        }
        if let Some(input) = session.input_tokens {
            lines.push(format!("- **Input Tokens:** {}", input));
        }
        if let Some(output) = session.output_tokens {
            lines.push(format!("- **Output Tokens:** {}", output));
        }

        lines.push(String::new());
        lines.push("---".to_string());
        lines.push(String::new());
    }

    // Messages
    if options.include_messages {
        if let Some(conversation) = &session.conversation {
            lines.push("## Conversation".to_string());
            lines.push(String::new());

            for (i, message) in conversation.messages().iter().enumerate() {
                let role = match message.role {
                    rmcp::model::Role::User => "User",
                    rmcp::model::Role::Assistant => "Assistant",
                };

                lines.push(format!("### Message {}: {}", i + 1, role));
                lines.push(String::new());

                for content in &message.content {
                    match content {
                        MessageContent::Text(tc) => {
                            lines.push(tc.text.clone());
                        }
                        MessageContent::ToolRequest(tr) => {
                            lines.push(format!("**Tool:** {}", tr.to_readable_string()));
                            lines.push("```json".to_string());
                            if let Ok(json) = serde_json::to_string_pretty(&tr) {
                                lines.push(json);
                            }
                            lines.push("```".to_string());
                        }
                        MessageContent::ToolResponse(resp) => {
                            lines.push("**Tool Result:**".to_string());
                            lines.push("```".to_string());
                            match &resp.tool_result {
                                Ok(result) => {
                                    for item in &result.content {
                                        if let Some(text) = item.as_text() {
                                            lines.push(text.text.clone());
                                        } else {
                                            lines.push(format!("{:?}", item));
                                        }
                                    }
                                }
                                Err(e) => {
                                    lines.push(format!("Error: {:?}", e));
                                }
                            }
                            lines.push("```".to_string());
                        }
                        MessageContent::Thinking(t) => {
                            lines.push(format!("*Thinking: {}*", t.thinking));
                        }
                        _ => {}
                    }
                }

                lines.push(String::new());
                lines.push("---".to_string());
                lines.push(String::new());
            }
        }
    }

    Ok(lines.join("\n"))
}

/// Export session to HTML format
fn export_to_html(session: &Session, options: &ExportOptions) -> Result<String> {
    let mut html = String::new();

    // HTML header
    html.push_str("<!DOCTYPE html>\n");
    html.push_str("<html lang=\"en\">\n");
    html.push_str("<head>\n");
    html.push_str("  <meta charset=\"UTF-8\">\n");
    html.push_str("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
    html.push_str(&format!(
        "  <title>{}</title>\n",
        escape_html(&session.name)
    ));
    html.push_str("  <style>\n");
    html.push_str(HTML_STYLES);
    html.push_str("  </style>\n");
    html.push_str("</head>\n");
    html.push_str("<body>\n");

    // Title
    html.push_str(&format!("  <h1>{}</h1>\n", escape_html(&session.name)));

    // Metadata
    if options.include_metadata {
        html.push_str("  <div class=\"metadata\">\n");
        html.push_str("    <h2>Session Information</h2>\n");
        html.push_str("    <ul>\n");
        html.push_str(&format!(
            "      <li><strong>ID:</strong> {}</li>\n",
            escape_html(&session.id)
        ));
        html.push_str(&format!(
            "      <li><strong>Created:</strong> {}</li>\n",
            session.created_at
        ));
        html.push_str(&format!(
            "      <li><strong>Updated:</strong> {}</li>\n",
            session.updated_at
        ));
        html.push_str(&format!(
            "      <li><strong>Working Directory:</strong> <code>{}</code></li>\n",
            escape_html(&session.working_dir.to_string_lossy())
        ));
        html.push_str(&format!(
            "      <li><strong>Messages:</strong> {}</li>\n",
            session.message_count
        ));

        if let Some(tokens) = session.total_tokens {
            html.push_str(&format!(
                "      <li><strong>Total Tokens:</strong> {}</li>\n",
                tokens
            ));
        }

        html.push_str("    </ul>\n");
        html.push_str("  </div>\n");
    }

    // Messages
    if options.include_messages {
        if let Some(conversation) = &session.conversation {
            html.push_str("  <h2>Conversation</h2>\n");

            for (i, message) in conversation.messages().iter().enumerate() {
                let (role, class) = match message.role {
                    rmcp::model::Role::User => ("User", "user-message"),
                    rmcp::model::Role::Assistant => ("Assistant", "assistant-message"),
                };

                html.push_str(&format!("  <div class=\"message {}\">\n", class));
                html.push_str(&format!("    <h3>Message {}: {}</h3>\n", i + 1, role));

                for content in &message.content {
                    match content {
                        MessageContent::Text(tc) => {
                            html.push_str(&format!(
                                "    <p>{}</p>\n",
                                escape_html(&tc.text).replace('\n', "<br>")
                            ));
                        }
                        MessageContent::ToolRequest(tr) => {
                            html.push_str("    <div class=\"tool-use\">\n");
                            html.push_str(&format!(
                                "      <strong>Tool:</strong> {}\n",
                                escape_html(&tr.to_readable_string())
                            ));
                            if let Ok(json) = serde_json::to_string_pretty(&tr) {
                                html.push_str(&format!(
                                    "      <pre><code>{}</code></pre>\n",
                                    escape_html(&json)
                                ));
                            }
                            html.push_str("    </div>\n");
                        }
                        MessageContent::ToolResponse(resp) => {
                            html.push_str("    <div class=\"tool-result\">\n");
                            html.push_str("      <strong>Tool Result:</strong>\n");
                            html.push_str("      <pre><code>");
                            match &resp.tool_result {
                                Ok(result) => {
                                    for item in &result.content {
                                        if let Some(text) = item.as_text() {
                                            html.push_str(&escape_html(&text.text));
                                        } else {
                                            html.push_str(&escape_html(&format!("{:?}", item)));
                                        }
                                    }
                                }
                                Err(e) => {
                                    html.push_str(&escape_html(&format!("Error: {:?}", e)));
                                }
                            }
                            html.push_str("</code></pre>\n");
                            html.push_str("    </div>\n");
                        }
                        _ => {}
                    }
                }

                html.push_str("  </div>\n");
            }
        }
    }

    // HTML footer
    html.push_str("</body>\n");
    html.push_str("</html>\n");

    Ok(html)
}

/// HTML escape helper
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}

/// HTML styles for export
const HTML_STYLES: &str = r#"
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { border-bottom: 2px solid #007acc; padding-bottom: 10px; }
    h2 { color: #007acc; margin-top: 30px; }
    h3 { color: #555; }
    .metadata {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .metadata ul { list-style: none; padding: 0; }
    .metadata li { padding: 5px 0; }
    .metadata strong { color: #007acc; }
    .message {
      margin: 20px 0;
      padding: 15px;
      border-radius: 5px;
    }
    .user-message {
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
    }
    .assistant-message {
      background: #f3e5f5;
      border-left: 4px solid #9c27b0;
    }
    .tool-use {
      background: #fff3e0;
      padding: 10px;
      border-radius: 3px;
      margin: 10px 0;
    }
    .tool-result {
      background: #e8f5e9;
      padding: 10px;
      border-radius: 3px;
      margin: 10px 0;
    }
    pre {
      background: #f5f5f5;
      padding: 10px;
      border-radius: 3px;
      overflow-x: auto;
    }
    code { font-family: "Courier New", monospace; }
"#;

/// Bulk export multiple sessions
pub async fn bulk_export_sessions(
    session_ids: &[String],
    format: ExportFormat,
) -> std::collections::HashMap<String, Result<String>> {
    let mut results = std::collections::HashMap::new();

    for id in session_ids {
        let options = ExportOptions::new().format(format);
        let result = export_session(id, options).await;
        results.insert(id.clone(), result);
    }

    results
}

/// Export session to file
pub async fn export_session_to_file(
    session_id: &str,
    file_path: &std::path::Path,
    format: ExportFormat,
) -> Result<()> {
    let options = ExportOptions::new().format(format);
    let content = export_session(session_id, options).await?;
    std::fs::write(file_path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_html() {
        assert_eq!(escape_html("<script>"), "&lt;script&gt;");
        assert_eq!(escape_html("a & b"), "a &amp; b");
        assert_eq!(escape_html("\"quoted\""), "&quot;quoted&quot;");
    }

    #[test]
    fn test_export_options_builder() {
        let options = ExportOptions::new()
            .format(ExportFormat::Markdown)
            .include_messages(false)
            .include_metadata(true);

        assert!(matches!(options.format, ExportFormat::Markdown));
        assert!(!options.include_messages);
        assert!(options.include_metadata);
    }
}
