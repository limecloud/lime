use crate::McpServerConfig;
use serde::Deserialize;
use serde_json::Map as JsonMap;
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;
use std::path::Path;
use tracing::warn;

#[path = "agent_plugin_config.rs"]
mod agent_plugin_config;

pub use agent_plugin_config::parse_agent_plugin_mcp_config;

#[derive(Clone, Copy, Debug)]
enum PluginMcpSource<'a> {
    Host { root: &'a Path },
}

/// One plugin MCP server that could not be normalized into runtime configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginMcpServerParseError {
    pub name: String,
    pub message: String,
}

/// Valid servers and per-server errors parsed from one plugin MCP file.
#[derive(Debug, Default, PartialEq)]
pub struct PluginMcpConfigParseOutcome {
    pub servers: BTreeMap<String, McpServerConfig>,
    pub errors: Vec<PluginMcpServerParseError>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginMcpServersFile {
    mcp_servers: BTreeMap<String, JsonValue>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PluginMcpFile {
    McpServersObject(PluginMcpServersFile),
    ServerMap(BTreeMap<String, JsonValue>),
}

impl PluginMcpFile {
    fn into_mcp_servers(self) -> BTreeMap<String, JsonValue> {
        match self {
            Self::McpServersObject(file) => file.mcp_servers,
            Self::ServerMap(mcp_servers) => mcp_servers,
        }
    }
}

/// Parses wrapped or plain plugin MCP declarations without runtime normalization.
pub fn parse_plugin_mcp_declarations(
    contents: &str,
) -> Result<BTreeMap<String, JsonValue>, serde_json::Error> {
    serde_json::from_str::<PluginMcpFile>(contents).map(PluginMcpFile::into_mcp_servers)
}

/// Parses the two supported plugin MCP file shapes and normalizes each server.
///
/// Native plugin HTTP servers share the regular MCP transport configuration;
/// relative helper commands therefore use the session's local process cwd.
///
/// Invalid individual servers are returned as errors without discarding valid
/// siblings. A malformed top-level document fails the whole parse.
pub fn parse_plugin_mcp_config(
    plugin_root: &Path,
    contents: &str,
) -> Result<PluginMcpConfigParseOutcome, serde_json::Error> {
    parse_plugin_mcp_config_from(contents, PluginMcpSource::Host { root: plugin_root })
}

impl PluginMcpSource<'_> {
    fn display(self) -> String {
        match self {
            Self::Host { root } => root.display().to_string(),
        }
    }
}

fn parse_plugin_mcp_config_from(
    contents: &str,
    source: PluginMcpSource<'_>,
) -> Result<PluginMcpConfigParseOutcome, serde_json::Error> {
    let declarations = parse_plugin_mcp_declarations(contents)?;
    Ok(normalize_plugin_mcp_declarations(declarations, source))
}

fn normalize_plugin_mcp_declarations(
    declarations: BTreeMap<String, JsonValue>,
    source: PluginMcpSource<'_>,
) -> PluginMcpConfigParseOutcome {
    let mut outcome = PluginMcpConfigParseOutcome::default();

    for (name, config_value) in declarations {
        match normalize_plugin_mcp_server(config_value, source) {
            Ok(config) => {
                outcome.servers.insert(name, config);
            }
            Err(message) => outcome
                .errors
                .push(PluginMcpServerParseError { name, message }),
        }
    }

    outcome
}

fn normalize_plugin_mcp_server(
    value: JsonValue,
    source: PluginMcpSource<'_>,
) -> Result<McpServerConfig, String> {
    let object = normalize_plugin_mcp_server_value(value, source);
    serde_json::from_value::<McpServerConfig>(JsonValue::Object(object))
        .map_err(|err| err.to_string())
}

fn normalize_plugin_mcp_server_value(
    value: JsonValue,
    source: PluginMcpSource<'_>,
) -> JsonMap<String, JsonValue> {
    let mut object = match value {
        JsonValue::Object(object) => object,
        _ => return JsonMap::new(),
    };

    if let Some(JsonValue::String(transport_type)) = object.remove("type") {
        match transport_type.as_str() {
            "http" | "streamable_http" | "streamable-http" | "stdio" => {}
            other => {
                let plugin_display = source.display();
                warn!(
                    plugin = %plugin_display,
                    transport = other,
                    "plugin MCP server uses an unknown transport type"
                );
            }
        }
    }

    if let Some(JsonValue::Object(mut oauth)) = object.remove("oauth") {
        if let Some(callback_url) = oauth.remove("callbackUrl") {
            oauth
                .entry("callback_url".to_string())
                .or_insert(callback_url);
        }

        if let Some(callback_port) = oauth.remove("callbackPort") {
            oauth
                .entry("callback_port".to_string())
                .or_insert(callback_port);
        }

        if let Some(client_id) = oauth.remove("clientId") {
            oauth.entry("client_id".to_string()).or_insert(client_id);
        }

        if let Some(client_secret) = oauth.remove("clientSecret") {
            oauth
                .entry("client_secret".to_string())
                .or_insert(client_secret);
        }

        if !oauth.is_empty() {
            object.insert("oauth".to_string(), JsonValue::Object(oauth));
        }
    }

    let PluginMcpSource::Host { root } = source;
    if let Some(JsonValue::String(cwd)) = object.get("cwd") {
        if !Path::new(cwd).is_absolute() {
            object.insert(
                "cwd".to_string(),
                JsonValue::String(root.join(cwd).display().to_string()),
            );
        }
    }

    object
}

#[cfg(test)]
#[path = "plugin_config_tests.rs"]
mod tests;
