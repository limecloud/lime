//! Marketplace commands use the same App Server owner as Desktop and TUI.

use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    ConfigReadResponse, MarketplaceAddParams, MarketplaceAddResponse, MarketplaceRemoveParams,
    MarketplaceRemoveResponse, MarketplaceUpgradeParams, MarketplaceUpgradeResponse,
    PluginListParams, PluginListResponse, METHOD_CONFIG_READ, METHOD_MARKETPLACE_ADD,
    METHOD_MARKETPLACE_REMOVE, METHOD_MARKETPLACE_UPGRADE, METHOD_PLUGIN_LIST,
};
use clap::Args;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::connection::ConnectionArgs;

#[derive(Debug, Args)]
pub(crate) struct MarketplaceCli {
    #[command(subcommand)]
    subcommand: MarketplaceSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum MarketplaceSubcommand {
    /// Add a local or Git marketplace source.
    Add(AddArgs),
    /// List marketplaces and their roots.
    List(ListArgs),
    /// Refresh one or all configured Git marketplace snapshots.
    Upgrade(UpgradeArgs),
    /// Remove a configured source without uninstalling its plugins.
    Remove(RemoveArgs),
}

#[derive(Debug, Args)]
struct AddArgs {
    #[arg(value_name = "SOURCE")]
    source: String,
    #[arg(long = "ref", value_name = "REF")]
    ref_name: Option<String>,
    #[arg(long = "sparse", value_name = "PATH", action = clap::ArgAction::Append)]
    sparse_paths: Vec<String>,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct UpgradeArgs {
    #[arg(value_name = "MARKETPLACE_NAME")]
    marketplace_name: Option<String>,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct RemoveArgs {
    #[arg(value_name = "MARKETPLACE_NAME")]
    marketplace_name: String,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

impl MarketplaceCli {
    pub(crate) fn connection_mut(&mut self) -> &mut ConnectionArgs {
        match &mut self.subcommand {
            MarketplaceSubcommand::Add(args) => &mut args.connection,
            MarketplaceSubcommand::List(args) => &mut args.connection,
            MarketplaceSubcommand::Upgrade(args) => &mut args.connection,
            MarketplaceSubcommand::Remove(args) => &mut args.connection,
        }
    }

    pub(crate) async fn run(self) -> Result<String> {
        match self.subcommand {
            MarketplaceSubcommand::Add(args) => {
                let response: MarketplaceAddResponse = request(
                    &args.connection,
                    METHOD_MARKETPLACE_ADD,
                    MarketplaceAddParams {
                        source: resolve_source(&args.source, &args.connection)?,
                        ref_name: args.ref_name,
                        sparse_paths: Some(args.sparse_paths),
                    },
                )
                .await?;
                if args.json {
                    return Ok(serde_json::to_string_pretty(&response)?);
                }
                Ok(format!(
                    "{} marketplace `{}`.\nInstalled marketplace root: {}",
                    if response.already_added {
                        "Already added"
                    } else {
                        "Added"
                    },
                    response.marketplace_name,
                    response.installed_root.display()
                ))
            }
            MarketplaceSubcommand::List(args) => list(args).await,
            MarketplaceSubcommand::Upgrade(args) => {
                let response: MarketplaceUpgradeResponse = request(
                    &args.connection,
                    METHOD_MARKETPLACE_UPGRADE,
                    MarketplaceUpgradeParams {
                        marketplace_name: args.marketplace_name,
                    },
                )
                .await?;
                for error in &response.errors {
                    eprintln!(
                        "Failed to upgrade marketplace `{}`: {}",
                        error.marketplace_name, error.message
                    );
                }
                anyhow::ensure!(
                    response.errors.is_empty(),
                    "{} upgrade failure(s) occurred.",
                    response.errors.len()
                );
                if args.json {
                    return Ok(serde_json::to_string_pretty(&response)?);
                }
                Ok(format!(
                    "Selected {} Git marketplace(s); upgraded {} snapshot(s).",
                    response.selected_marketplaces.len(),
                    response.upgraded_roots.len()
                ))
            }
            MarketplaceSubcommand::Remove(args) => {
                let response: MarketplaceRemoveResponse = request(
                    &args.connection,
                    METHOD_MARKETPLACE_REMOVE,
                    MarketplaceRemoveParams {
                        marketplace_name: args.marketplace_name,
                    },
                )
                .await?;
                if args.json {
                    return Ok(serde_json::to_string_pretty(&response)?);
                }
                Ok(format!(
                    "Removed marketplace `{}`.{}",
                    response.marketplace_name,
                    response
                        .installed_root
                        .map(|root| format!(
                            "\nRemoved installed marketplace root: {}",
                            root.display()
                        ))
                        .unwrap_or_default()
                ))
            }
        }
    }
}

fn resolve_source(source: &str, connection: &ConnectionArgs) -> Result<String> {
    if source == "."
        || source == ".."
        || ["./", "../", ".\\", "..\\"]
            .iter()
            .any(|prefix| source.starts_with(*prefix))
    {
        let cwd = connection.cwd.clone().unwrap_or(std::env::current_dir()?);
        return Ok(std::fs::canonicalize(cwd.join(source))
            .context("resolve local marketplace source")?
            .to_string_lossy()
            .into_owned());
    }
    Ok(source.to_string())
}

async fn request<T: serde::de::DeserializeOwned>(
    connection: &ConnectionArgs,
    method: &str,
    params: impl serde::Serialize,
) -> Result<T> {
    let value = crate::request_value(connection, method, serde_json::to_value(params)?).await?;
    Ok(serde_json::from_value(value)?)
}

async fn list(args: ListArgs) -> Result<String> {
    let cwd = std::fs::canonicalize(
        args.connection
            .cwd
            .clone()
            .unwrap_or(std::env::current_dir()?),
    )?;
    let response: PluginListResponse = request(
        &args.connection,
        METHOD_PLUGIN_LIST,
        PluginListParams {
            cwds: Some(vec![cwd]),
            ..Default::default()
        },
    )
    .await?;
    anyhow::ensure!(
        response.marketplace_load_errors.is_empty(),
        "failed to load marketplace(s): {:?}",
        response.marketplace_load_errors
    );
    let config: ConfigReadResponse =
        request(&args.connection, METHOD_CONFIG_READ, json!({})).await?;
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for market in response.marketplaces {
        let Some(path) = market.path else {
            continue;
        };
        let root = marketplace_root(&path)?;
        if !seen.insert(root.clone()) {
            continue;
        }
        let mut entry = json!({"name": market.name, "root": root});
        if let Some(source) = config
            .config
            .get("marketplaces")
            .and_then(|markets| markets.get(&market.name))
        {
            if let (Some(kind), Some(location)) = (
                source.get("source_type").and_then(Value::as_str),
                source.get("source").and_then(Value::as_str),
            ) {
                let configured = if kind == "local" {
                    Path::new(location) == root
                } else {
                    root.ends_with(Path::new(".tmp/marketplaces").join(&market.name))
                };
                if configured {
                    entry["marketplaceSource"] = json!({"sourceType": kind, "source": location});
                }
            }
        }
        entries.push(entry);
    }
    if args.json {
        return Ok(serde_json::to_string_pretty(
            &json!({"marketplaces": entries}),
        )?);
    }
    if entries.is_empty() {
        return Ok("No plugin marketplaces in scope.".into());
    }
    Ok(std::iter::once("MARKETPLACE  ROOT".into())
        .chain(entries.into_iter().map(|entry| {
            format!(
                "{}  {}",
                entry["name"].as_str().unwrap_or_default(),
                entry["root"].as_str().unwrap_or_default()
            )
        }))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn marketplace_root(path: &Path) -> Result<PathBuf> {
    for layout in [
        ".agents/plugins/marketplace.json",
        ".agents/plugins/api_marketplace.json",
        ".claude-plugin/marketplace.json",
        ".cursor-plugin/marketplace.json",
    ] {
        if path.ends_with(layout) {
            let mut root = path.to_path_buf();
            for _ in Path::new(layout).components() {
                root.pop();
            }
            return Ok(root);
        }
    }
    anyhow::bail!(
        "marketplace file is outside a supported layout: {}",
        path.display()
    )
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    #[test]
    fn marketplace_commands_share_connection_and_upstream_source_flags() {
        for args in [
            vec![
                "lime",
                "plugin",
                "marketplace",
                "add",
                "owner/repo",
                "--ref",
                "main",
                "--sparse",
                "plugins/foo",
                "--json",
                "-C",
                "/tmp",
            ],
            vec!["lime", "plugin", "marketplace", "list", "--json"],
            vec!["lime", "plugin", "marketplace", "upgrade"],
            vec![
                "lime",
                "plugin",
                "marketplace",
                "upgrade",
                "debug",
                "--json",
            ],
            vec!["lime", "plugin", "marketplace", "remove", "debug", "--json"],
        ] {
            assert!(crate::MultitoolCli::try_parse_from(args).is_ok());
        }
    }
}
