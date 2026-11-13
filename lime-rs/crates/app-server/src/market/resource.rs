use super::wire::Release;
use lime_mcp::{McpServerConfig, McpServerTransport};
use lime_skills::{AgentSkillMetadata, AgentSkillScope};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(crate) fn skill(root: &Path, release: &Release) -> Result<AgentSkillMetadata, String> {
    let entry = &release
        .manifest
        .skill
        .as_ref()
        .ok_or("market skill entry missing")?
        .entry;
    lime_skills::load_agent_skill_from_file(
        &release.manifest.name,
        &root.join(entry),
        AgentSkillScope::App,
    )
}

pub(crate) fn mcp_name(identity: &str, release: &Release) -> String {
    let digest = Sha256::digest(format!("{identity}:{}", release.id).as_bytes());
    format!("market_{}", &hex::encode(digest)[..24])
}

pub(crate) fn mcp_config(
    root: &Path,
    release: &Release,
    name: &str,
) -> Result<McpServerConfig, String> {
    let mcp = release
        .manifest
        .mcp
        .as_ref()
        .ok_or("market MCP entry missing")?;
    let transport = match mcp.transport.as_str() {
        "http" => McpServerTransport::StreamableHttp {
            url: mcp.endpoint.clone().ok_or("market MCP endpoint missing")?,
            bearer_token_env_var: (mcp.auth.r#type == "bearer")
                .then(|| format!("LIME_MCP_{}_TOKEN", name.to_ascii_uppercase())),
            http_headers: None,
            env_http_headers: None,
        },
        "stdio" => {
            // A bearer header / browser OAuth cannot authenticate a local stdio process.
            if mcp.auth.r#type != "none" {
                return Err("market_stdio_auth_unsupported".into());
            }
            let executable = root.join(
                mcp.executable
                    .as_ref()
                    .ok_or("market MCP executable missing")?,
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if std::fs::metadata(&executable)
                    .map_err(|_| "market MCP executable unavailable")?
                    .permissions()
                    .mode()
                    & 0o111
                    == 0
                {
                    return Err("market MCP executable is not executable".into());
                }
            }
            McpServerTransport::Stdio {
                command: executable.to_str().ok_or("invalid market MCP path")?.into(),
                args: mcp.arguments.clone(),
                env: Default::default(),
                env_vars: Vec::new(),
                cwd: Some(root.to_str().ok_or("invalid market MCP path")?.into()),
            }
        }
        _ => return Err("market MCP transport unsupported".into()),
    };
    Ok(McpServerConfig {
        transport,
        enabled: true,
        enabled_tools: Some(mcp.tools.clone()),
        scopes: (mcp.auth.r#type == "oauth2").then(|| mcp.auth.scopes.clone()),
        oauth: (mcp.auth.r#type == "oauth2").then(Default::default),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests;
