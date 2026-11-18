use crate::types::{McpServerConfig, McpServerTransport};
use serde::{Deserialize, Serialize};

const OAUTH_RUNTIME_NOT_IMPLEMENTED: &str = "oauth_runtime_not_implemented";
const OAUTH_LOGIN_REQUIRED: &str = "oauth_login_required";

/// MCP server 授权可用性快照。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct McpServerAuthStatus {
    pub mode: String,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_plan: Option<McpServerAuthActionPlan>,
}

/// MCP 授权链路下一步动作投影。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct McpServerAuthActionPlan {
    pub kind: String,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_runtime: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_resource: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
}

pub trait McpServerAuthExt {
    fn has_oauth_settings(&self) -> bool;
    fn has_unsupported_oauth_runtime_settings(&self) -> bool;
    fn auth_status(&self) -> McpServerAuthStatus;
    fn oauth_scopes(&self) -> Option<Vec<String>>;
    fn auth_status_with_credentials(&self, has_credentials: bool) -> McpServerAuthStatus;
}

impl McpServerAuthExt for McpServerConfig {
    fn has_oauth_settings(&self) -> bool {
        self.oauth.is_some()
            || non_empty_string(self.oauth_resource.as_deref()).is_some()
            || configured_scopes(self).is_some()
    }

    fn has_unsupported_oauth_runtime_settings(&self) -> bool {
        self.oauth
            .as_ref()
            .and_then(|oauth| non_empty_string(oauth.client_id.as_deref()))
            .is_some()
            || non_empty_string(self.oauth_resource.as_deref()).is_some()
    }

    fn auth_status(&self) -> McpServerAuthStatus {
        self.auth_status_with_credentials(false)
    }

    fn oauth_scopes(&self) -> Option<Vec<String>> {
        configured_scopes(self)
    }

    fn auth_status_with_credentials(&self, has_credentials: bool) -> McpServerAuthStatus {
        if self.has_oauth_settings() {
            let unsupported = self.has_unsupported_oauth_runtime_settings();
            if !unsupported && has_credentials {
                return McpServerAuthStatus {
                    mode: "oauth".to_string(),
                    available: true,
                    reason_code: None,
                    action_plan: None,
                };
            }
            return McpServerAuthStatus {
                mode: "oauth".to_string(),
                available: !unsupported,
                reason_code: Some(if unsupported {
                    OAUTH_RUNTIME_NOT_IMPLEMENTED.to_string()
                } else {
                    OAUTH_LOGIN_REQUIRED.to_string()
                }),
                action_plan: Some(McpServerAuthActionPlan {
                    kind: "oauth_login".to_string(),
                    state: if unsupported {
                        "runtime_not_connected".to_string()
                    } else {
                        "login_required".to_string()
                    },
                    required_runtime: Some("mcp_server_oauth_login".to_string()),
                    scopes: configured_scopes(self),
                    oauth_resource: non_empty_string(self.oauth_resource.as_deref()),
                    client_id: self
                        .oauth
                        .as_ref()
                        .and_then(|oauth| non_empty_string(oauth.client_id.as_deref())),
                }),
            };
        }

        match &self.transport {
            McpServerTransport::StreamableHttp {
                bearer_token_env_var,
                http_headers,
                env_http_headers,
                ..
            } if bearer_token_env_var.is_some()
                || http_headers
                    .as_ref()
                    .is_some_and(|headers| !headers.is_empty())
                || env_http_headers
                    .as_ref()
                    .is_some_and(|headers| !headers.is_empty()) =>
            {
                McpServerAuthStatus {
                    mode: "static_headers".to_string(),
                    available: true,
                    reason_code: None,
                    action_plan: None,
                }
            }
            _ => McpServerAuthStatus {
                mode: "none".to_string(),
                available: true,
                reason_code: None,
                action_plan: None,
            },
        }
    }
}

fn configured_scopes(config: &McpServerConfig) -> Option<Vec<String>> {
    let scopes = config.scopes.as_ref()?;
    let scopes = scopes
        .iter()
        .filter_map(|scope| non_empty_string(Some(scope)))
        .collect::<Vec<_>>();
    (!scopes.is_empty()).then_some(scopes)
}

fn non_empty_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::McpServerTransport;
    use std::collections::HashMap;

    fn oauth_config() -> McpServerConfig {
        McpServerConfig {
            transport: McpServerTransport::StreamableHttp {
                url: "https://example.com/mcp".to_string(),
                bearer_token_env_var: None,
                http_headers: None,
                env_http_headers: None,
                http_headers_helper: None,
            },
            environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
            enabled: true,
            startup_timeout_sec: Some(std::time::Duration::from_secs(30)),
            tool_timeout_sec: None,
            enabled_tools: None,
            disabled_tools: None,
            required: false,
            supports_parallel_tool_calls: false,
            scopes: Some(vec!["search.read".to_string(), " ".to_string()]),
            oauth: Some(crate::types::McpServerOAuthConfig {
                client_id: Some("lime-client".to_string()),
                ..Default::default()
            }),
            oauth_resource: Some("https://example.com".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn oauth_status_reports_elicitation_action_plan() {
        let status = oauth_config().auth_status();

        assert_eq!(status.mode, "oauth");
        assert!(!status.available);
        assert_eq!(
            status.reason_code.as_deref(),
            Some("oauth_runtime_not_implemented")
        );

        let plan = status.action_plan.expect("oauth should expose action plan");
        assert_eq!(plan.kind, "oauth_login");
        assert_eq!(plan.state, "runtime_not_connected");
        assert_eq!(
            plan.required_runtime.as_deref(),
            Some("mcp_server_oauth_login")
        );
        assert_eq!(
            plan.scopes.as_deref(),
            Some(&["search.read".to_string()][..])
        );
        assert_eq!(plan.oauth_resource.as_deref(), Some("https://example.com"));
        assert_eq!(plan.client_id.as_deref(), Some("lime-client"));
    }

    #[test]
    fn dynamic_oauth_status_reports_login_required() {
        let mut config = oauth_config();
        config.oauth = None;
        config.oauth_resource = None;

        let status = config.auth_status();

        assert_eq!(status.mode, "oauth");
        assert!(status.available);
        assert_eq!(status.reason_code.as_deref(), Some("oauth_login_required"));
        let plan = status.action_plan.expect("oauth should expose action plan");
        assert_eq!(plan.kind, "oauth_login");
        assert_eq!(plan.state, "login_required");
        assert_eq!(
            plan.required_runtime.as_deref(),
            Some("mcp_server_oauth_login")
        );
        assert_eq!(
            plan.scopes.as_deref(),
            Some(&["search.read".to_string()][..])
        );
    }

    #[test]
    fn dynamic_oauth_status_reports_authorized_when_credentials_exist() {
        let mut config = oauth_config();
        config.oauth = None;
        config.oauth_resource = None;

        let status = config.auth_status_with_credentials(true);

        assert_eq!(status.mode, "oauth");
        assert!(status.available);
        assert_eq!(status.reason_code, None);
        assert_eq!(status.action_plan, None);
    }

    #[test]
    fn static_header_status_has_no_action_plan() {
        let config = McpServerConfig {
            transport: McpServerTransport::StreamableHttp {
                url: "https://example.com/mcp".to_string(),
                bearer_token_env_var: Some("MCP_TOKEN".to_string()),
                http_headers: Some(HashMap::from([(
                    "X-Trace".to_string(),
                    "trace-1".to_string(),
                )])),
                env_http_headers: None,
                http_headers_helper: None,
            },
            environment_id: crate::types::DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
            enabled: true,
            startup_timeout_sec: Some(std::time::Duration::from_secs(30)),
            tool_timeout_sec: None,
            enabled_tools: None,
            disabled_tools: None,
            required: false,
            supports_parallel_tool_calls: false,
            scopes: None,
            oauth: None,
            oauth_resource: None,
            ..Default::default()
        };

        let status = config.auth_status();
        assert_eq!(status.mode, "static_headers");
        assert!(status.available);
        assert!(status.action_plan.is_none());
    }
}
