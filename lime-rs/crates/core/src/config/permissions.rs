use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    #[default]
    #[serde(alias = "on-failure")]
    OnRequest,
    Never,
    Untrusted,
}

impl ApprovalPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OnRequest => "on-request",
            Self::Never => "never",
            Self::Untrusted => "untrusted",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    #[default]
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl SandboxMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::DangerFullAccess => "danger-full-access",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxWorkspaceWrite {
    #[serde(default)]
    pub network_access: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn permission_defaults_are_typed_and_use_current_approval_semantics() {
        assert_eq!(ApprovalPolicy::default(), ApprovalPolicy::OnRequest);
        assert_eq!(SandboxMode::default(), SandboxMode::ReadOnly);
        assert!(!SandboxWorkspaceWrite::default().network_access);
        assert_eq!(
            serde_json::from_value::<ApprovalPolicy>(json!("on-failure")).unwrap(),
            ApprovalPolicy::OnRequest
        );
        assert!(serde_json::from_value::<ApprovalPolicy>(json!("always")).is_err());
        assert!(serde_json::from_value::<SandboxMode>(json!("unrestricted")).is_err());
        assert!(
            serde_json::from_value::<SandboxWorkspaceWrite>(json!({"network_access":"true"}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<SandboxWorkspaceWrite>(json!({"networkAccess":true})).is_err()
        );
    }
}
