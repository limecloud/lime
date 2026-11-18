//! Exact MCP registration identity, separate from model-visible names and execution location.
//!
//! An unscoped key identifies a thread-wide declaration. A scoped key distinguishes
//! same-named declarations by environment; neither form is a model-facing tool name.

use serde::Deserialize;
use serde::Serialize;

/// The exact identity of one MCP server registration.
///
/// The optional environment is registration scope, not necessarily the server's
/// execution location. Unscoped registrations may execute on a remote environment.
/// Its display form is for diagnostics, not for serialization or lookup.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct McpServerKey {
    #[serde(rename = "server_name")]
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scoped_environment_id: Option<String>,
}

impl McpServerKey {
    /// Identifies a thread-wide declaration by its configured name.
    pub fn unscoped(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            scoped_environment_id: None,
        }
    }

    /// Identifies a declaration contributed by a particular environment.
    pub fn in_environment(environment: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            scoped_environment_id: Some(environment.into()),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn scoped_environment_id(&self) -> Option<&str> {
        self.scoped_environment_id.as_deref()
    }
}

impl std::fmt::Display for McpServerKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.scoped_environment_id() {
            Some(environment) => write!(formatter, "{} (environment {environment})", self.name()),
            None => formatter.write_str(self.name()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::McpServerKey;

    #[test]
    fn unscoped_key_uses_server_name() {
        let key = McpServerKey::unscoped("files");
        assert_eq!(key.name(), "files");
        assert_eq!(key.scoped_environment_id(), None);
        assert_eq!(key.to_string(), "files");
    }

    #[test]
    fn scoped_key_distinguishes_environment() {
        let key = McpServerKey::in_environment("remote", "files");
        assert_eq!(key.name(), "files");
        assert_eq!(key.scoped_environment_id(), Some("remote"));
        assert_eq!(key.to_string(), "files (environment remote)");
    }

    #[test]
    fn same_name_different_scope_is_not_equal() {
        assert_ne!(
            McpServerKey::unscoped("files"),
            McpServerKey::in_environment("remote", "files")
        );
    }
}
