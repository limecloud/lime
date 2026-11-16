use super::*;
use super::ConnectorAppInfo;
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn discoverable_tool_enums_use_expected_wire_names() {
    assert_eq!(
        json!({
            "tool_type": DiscoverableToolType::Connector,
            "action_type": DiscoverableToolAction::Install,
        }),
        json!({
            "tool_type": "connector",
            "action_type": "install",
        })
    );
}

#[test]
fn filter_request_plugin_install_discoverable_tools_for_lime_tui_omits_plugins() {
    let discoverable_tools = vec![
        DiscoverableTool::Connector(Box::new(ConnectorAppInfo {
            id: "connector_google_calendar".to_string(),
            name: "Google Calendar".to_string(),
            description: Some("Plan events and schedules.".to_string()),
            install_url: Some("https://example.test/google-calendar".to_string()),
        })),
        DiscoverableTool::Plugin(Box::new(DiscoverablePluginInfo {
            id: "slack@openai-curated".to_string(),
            remote_plugin_id: None,
            name: "Slack".to_string(),
            description: Some("Search Slack messages".to_string()),
            has_skills: true,
            mcp_server_names: vec!["slack".to_string()],
            app_connector_ids: vec!["connector_slack".to_string()],
        })),
    ];

    assert_eq!(
        filter_request_plugin_install_discoverable_tools_for_client(
            discoverable_tools,
            Some("lime-tui"),
        ),
        vec![DiscoverableTool::Connector(Box::new(ConnectorAppInfo {
            id: "connector_google_calendar".to_string(),
            name: "Google Calendar".to_string(),
            description: Some("Plan events and schedules.".to_string()),
            install_url: Some("https://example.test/google-calendar".to_string()),
        }))]
    );
}
