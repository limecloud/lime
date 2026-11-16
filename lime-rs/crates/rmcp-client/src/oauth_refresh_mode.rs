//! Selects the owner of MCP OAuth refresh and credential persistence.

/// MCP OAuth policy pinned for the lifetime of a connection.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum McpOAuthRefreshMode {
    /// Keep Lime's existing refresh and persistence path.
    #[default]
    Legacy,
    /// Let RMCP coordinate refresh through Lime's credential store.
    Coordinated,
}
