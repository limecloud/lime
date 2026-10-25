use super::*;
use std::path::PathBuf;

#[test]
fn loads_native_inline_map_and_file_wrapper_and_isolates_invalid_sibling() {
    let root = tempfile::tempdir().unwrap();
    let servers = serde_json::json!({
        "local": {"command":"node", "cwd":"scripts"},
        "remote": {"type":"http", "url":"https://example.com/mcp"},
        "invalid": 1,
    });
    for value in [servers.clone(), serde_json::json!({"mcpServers":servers})] {
        let outcome = parse_plugin_mcp_config(root.path(), &value.to_string()).unwrap();
        assert_eq!(outcome.servers.len(), 2);
        assert_eq!(outcome.errors.len(), 1);
        assert_eq!(
            outcome.servers["local"].sanitized_cwd(),
            Some(root.path().join("scripts"))
        );
    }
}

fn plugin_root() -> PathBuf {
    std::env::current_dir()
        .expect("current directory")
        .join("plugin-root")
}

#[test]
fn agent_plugin_mcp_skips_invalid_server_without_disabling_siblings() {
    let plugin_root = plugin_root();
    let outcome = parse_agent_plugin_mcp_config(
        &plugin_root,
        &plugin_root.join("data"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers": {
            "valid":{"type":"stdio","command":"python"},
            "reserved":{"type":"stdio","command":"python","env":{"PLUGIN_ROOT":"bad"}}
          }
        }"#,
    )
    .expect("parse Agent Plugins MCP config");

    assert_eq!(outcome.servers.keys().collect::<Vec<_>>(), vec!["valid"]);
    assert_eq!(outcome.errors.len(), 1);
    assert_eq!(outcome.errors[0].name, "reserved");
    assert!(outcome.errors[0]
        .message
        .contains("reserved variable `PLUGIN_ROOT`"));
}

#[test]
fn agent_plugin_mcp_preserves_server_named_mcp_servers() {
    let plugin_root = plugin_root();
    let outcome = parse_agent_plugin_mcp_config(
        &plugin_root,
        &plugin_root.join("data"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers": {
            "mcpServers":{"type":"stdio","command":"first"},
            "sibling":{"type":"stdio","command":"second"}
          }
        }"#,
    )
    .expect("parse Agent Plugins MCP config");

    assert!(outcome.errors.is_empty());
    assert_eq!(
        outcome.servers.keys().collect::<Vec<_>>(),
        vec!["mcpServers", "sibling"]
    );
}

#[test]
fn agent_plugin_mcp_preserves_arbitrary_server_names() {
    let plugin_root = plugin_root();
    let outcome = parse_agent_plugin_mcp_config(
        &plugin_root,
        &plugin_root.join("data"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers":{"agent.smoke / local":{"type":"stdio","command":"python"}}
        }"#,
    )
    .expect("parse Agent Plugins MCP config");

    assert!(outcome.errors.is_empty());
    assert!(outcome.servers.contains_key("agent.smoke / local"));
}

#[test]
fn agent_plugin_mcp_rejects_explicit_null_optional_fields() {
    let plugin_root = plugin_root();
    let outcome = parse_agent_plugin_mcp_config(
        &plugin_root,
        &plugin_root.join("data"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers":{
            "cwd":{"type":"stdio","command":"python","cwd":null},
            "headers":{"type":"streamable-http","url":"https://example.com/mcp","headers":null}
          }
        }"#,
    )
    .expect("parse Agent Plugins MCP config");

    assert!(outcome.servers.is_empty());
    assert_eq!(outcome.errors.len(), 2);
    assert!(outcome
        .errors
        .iter()
        .any(|error| error.message.contains("`cwd`")));
    assert!(outcome
        .errors
        .iter()
        .any(|error| error.message.contains("`headers`")));
}

#[test]
fn agent_plugin_mcp_rejects_unsupported_schema() {
    let plugin_root = plugin_root();
    let error = parse_agent_plugin_mcp_config(
        &plugin_root,
        &plugin_root.join("data"),
        r#"{"$schema":"https://agent-plugins.org/schemas/2.0.0/mcp.schema.json","mcpServers":{}}"#,
    )
    .expect_err("unsupported schema");

    assert!(error
        .to_string()
        .contains("unsupported Agent Plugins MCP schema"));
}
