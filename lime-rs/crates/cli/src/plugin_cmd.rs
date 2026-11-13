use std::process::ExitCode;

use anyhow::Result;
use app_server_protocol::protocol::v2::{
    PluginInstallParams, PluginInstallResponse, PluginListParams, PluginListResponse,
    PluginMarketplaceEntry, PluginReadParams, PluginReadResponse, PluginSearchParams,
    PluginSearchResponse, PluginSearchScope, PluginUninstallParams, PluginUninstallResponse,
    METHOD_PLUGIN_INSTALL, METHOD_PLUGIN_LIST, METHOD_PLUGIN_READ, METHOD_PLUGIN_SEARCH,
    METHOD_PLUGIN_UNINSTALL,
};
use clap::{Args, ValueEnum};

use crate::connection::ConnectionArgs;

#[derive(Debug, Args)]
pub(crate) struct PluginCli {
    #[command(subcommand)]
    subcommand: PluginSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum PluginSubcommand {
    /// Manage marketplace sources and snapshots.
    Marketplace(crate::marketplace_cmd::MarketplaceCli),
    /// Install a plugin from a configured marketplace.
    Add(AddPluginArgs),
    /// List plugins visible to the current App Server.
    List(ListPluginsArgs),
    /// Read one plugin and all of its declared capabilities.
    Read(PluginIdArgs),
    /// Search the current plugin catalog.
    Search(PluginSearchArgs),
    /// Uninstall a plugin.
    Remove(RemovePluginArgs),
    /// Enable an installed plugin.
    Enable(PluginIdArgs),
    /// Disable an installed plugin.
    Disable(PluginIdArgs),
}

#[derive(Debug, Args)]
struct AddPluginArgs {
    #[arg(value_name = "PLUGIN[@MARKETPLACE]")]
    plugin: String,
    #[arg(long, short = 'm')]
    marketplace: Option<String>,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct ListPluginsArgs {
    #[arg(long, short = 'm')]
    marketplace: Option<String>,
    /// Include uninstalled marketplace plugins in JSON output.
    #[arg(long, requires = "json")]
    available: bool,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct PluginIdArgs {
    #[arg(value_name = "PLUGIN")]
    plugin_id: String,
    #[arg(long, short = 'm')]
    marketplace: Option<String>,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct RemovePluginArgs {
    #[arg(value_name = "PLUGIN")]
    plugin_id: String,
    #[arg(long, short = 'm')]
    marketplace: Option<String>,
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct PluginSearchArgs {
    #[arg(value_name = "QUERY")]
    query: String,
    #[arg(long, value_enum)]
    scope: Option<SearchScope>,
    #[arg(long)]
    cursor: Option<String>,
    #[arg(long)]
    limit: Option<u32>,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum SearchScope {
    Global,
    Workspace,
    Personal,
}

impl From<SearchScope> for PluginSearchScope {
    fn from(value: SearchScope) -> Self {
        match value {
            SearchScope::Global => Self::Global,
            SearchScope::Workspace => Self::Workspace,
            SearchScope::Personal => Self::Personal,
        }
    }
}

impl PluginCli {
    pub(crate) fn connection_mut(&mut self) -> &mut ConnectionArgs {
        match &mut self.subcommand {
            PluginSubcommand::Marketplace(args) => args.connection_mut(),
            PluginSubcommand::Add(args) => &mut args.connection,
            PluginSubcommand::List(args) => &mut args.connection,
            PluginSubcommand::Read(args)
            | PluginSubcommand::Enable(args)
            | PluginSubcommand::Disable(args) => &mut args.connection,
            PluginSubcommand::Search(args) => &mut args.connection,
            PluginSubcommand::Remove(args) => &mut args.connection,
        }
    }

    pub(crate) async fn run(self) -> ExitCode {
        match run_inner(self).await {
            Ok(output) => {
                println!("{output}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{error:#}");
                ExitCode::FAILURE
            }
        }
    }
}

async fn run_inner(command: PluginCli) -> Result<String> {
    match command.subcommand {
        PluginSubcommand::Marketplace(command) => command.run().await,
        PluginSubcommand::Add(args) => run_plugin_add(args).await,
        PluginSubcommand::List(args) => run_plugin_list(args).await,
        PluginSubcommand::Read(args) => run_plugin_read(args).await,
        PluginSubcommand::Search(args) => run_plugin_search(args).await,
        PluginSubcommand::Remove(args) => run_plugin_remove(args).await,
        PluginSubcommand::Enable(args) => set_enabled(args, true).await,
        PluginSubcommand::Disable(args) => set_enabled(args, false).await,
    }
}

async fn run_plugin_add(args: AddPluginArgs) -> Result<String> {
    let (plugin_name, marketplace_name) =
        parse_selection(&args.plugin, args.marketplace.as_deref())?;
    let marketplace =
        resolve_marketplace(&args.connection, &marketplace_name, &plugin_name).await?;
    let response = request(
        &args.connection,
        METHOD_PLUGIN_INSTALL,
        PluginInstallParams {
            remote_release: None,
            marketplace_path: marketplace.path,
            remote_marketplace_name: None,
            install_attempt_id: None,
            plugin_name: plugin_name.clone(),
        },
    )
    .await?;
    let response: PluginInstallResponse = serde_json::from_value(response)?;
    if args.json {
        return Ok(serde_json::to_string_pretty(&response)?);
    }
    Ok(format!(
        "Added plugin `{plugin_name}` from marketplace `{marketplace_name}`."
    ))
}

async fn catalog(connection: &ConnectionArgs) -> Result<PluginListResponse> {
    let cwd = plugin_cwd(connection)?;
    let response = request(
        connection,
        METHOD_PLUGIN_LIST,
        PluginListParams {
            cwds: Some(vec![cwd]),
            ..Default::default()
        },
    )
    .await?;
    Ok(serde_json::from_value(response)?)
}

fn plugin_cwd(connection: &ConnectionArgs) -> Result<std::path::PathBuf> {
    let cwd = connection.cwd.clone().unwrap_or(std::env::current_dir()?);
    Ok(std::fs::canonicalize(cwd)?)
}

async fn resolve_marketplace(
    connection: &ConnectionArgs,
    name: &str,
    plugin_name: &str,
) -> Result<PluginMarketplaceEntry> {
    let response = catalog(connection).await?;
    let mut matches = response.marketplaces.into_iter().filter(|marketplace| {
        marketplace.name == name
            && marketplace
                .plugins
                .iter()
                .any(|plugin| plugin.name == plugin_name)
    });
    let marketplace = matches.next().ok_or_else(|| {
        anyhow::anyhow!(
            "Plugin `{plugin_name}@{name}` not found; marketplace errors: {:?}",
            response.marketplace_load_errors
        )
    })?;
    anyhow::ensure!(
        matches.next().is_none(),
        "Marketplace `{name}` matched multiple roots"
    );
    anyhow::ensure!(
        marketplace.path.is_some(),
        "Remote marketplace installation is unavailable"
    );
    Ok(marketplace)
}

async fn run_plugin_list(args: ListPluginsArgs) -> Result<String> {
    let mut response = catalog(&args.connection).await?;
    response.marketplaces.retain(|marketplace| {
        args.marketplace
            .as_ref()
            .is_none_or(|name| &marketplace.name == name)
    });
    if args.json && !args.available {
        for marketplace in &mut response.marketplaces {
            marketplace.plugins.retain(|plugin| plugin.installed);
        }
        response
            .marketplaces
            .retain(|marketplace| !marketplace.plugins.is_empty());
    }
    if args.json {
        return Ok(serde_json::to_string_pretty(&response)?);
    }
    Ok(render_plugin_table(response))
}

async fn run_plugin_read(args: PluginIdArgs) -> Result<String> {
    let (plugin_name, marketplace_name) =
        parse_selection(&args.plugin_id, args.marketplace.as_deref())?;
    let marketplace =
        resolve_marketplace(&args.connection, &marketplace_name, &plugin_name).await?;
    let response = request(
        &args.connection,
        METHOD_PLUGIN_READ,
        PluginReadParams {
            remote_release: None,
            marketplace_path: marketplace.path,
            remote_marketplace_name: None,
            plugin_name,
        },
    )
    .await?;
    let response: PluginReadResponse = serde_json::from_value(response)?;
    Ok(serde_json::to_string_pretty(&response)?)
}

async fn run_plugin_search(args: PluginSearchArgs) -> Result<String> {
    let cwd = plugin_cwd(&args.connection)?;
    let response = request(
        &args.connection,
        METHOD_PLUGIN_SEARCH,
        PluginSearchParams {
            search_term: args.query,
            scope: args.scope.map(Into::into),
            cwds: Some(vec![cwd.to_string_lossy().into_owned()]),
            cursor: args.cursor,
            limit: args.limit,
        },
    )
    .await?;
    let response: PluginSearchResponse = serde_json::from_value(response)?;
    Ok(serde_json::to_string_pretty(&response)?)
}

async fn run_plugin_remove(args: RemovePluginArgs) -> Result<String> {
    let (name, marketplace) = parse_selection(&args.plugin_id, args.marketplace.as_deref())?;
    let plugin_id = format!("{name}@{marketplace}");
    let response = request(
        &args.connection,
        METHOD_PLUGIN_UNINSTALL,
        PluginUninstallParams {
            plugin_id: plugin_id.clone(),
        },
    )
    .await?;
    let response: PluginUninstallResponse = serde_json::from_value(response)?;
    if args.json {
        return Ok(serde_json::to_string_pretty(&response)?);
    }
    Ok(format!("Removed plugin `{plugin_id}`."))
}

async fn set_enabled(args: PluginIdArgs, enabled: bool) -> Result<String> {
    let (name, marketplace) = parse_selection(&args.plugin_id, args.marketplace.as_deref())?;
    let plugin_id = format!("{name}@{marketplace}");
    let key = serde_json::to_string(&plugin_id)?;
    let response = request(&args.connection, app_server_protocol::protocol::v2::METHOD_CONFIG_BATCH_WRITE,
        serde_json::json!({"edits":[{"keyPath":format!("plugins.{key}.enabled"), "value":enabled, "mergeStrategy":"replace"}], "reloadUserConfig":true})).await?;
    if args.json {
        return Ok(serde_json::to_string_pretty(&response)?);
    }
    Ok(format!(
        "{} plugin `{}`.",
        if enabled { "Enabled" } else { "Disabled" },
        plugin_id
    ))
}

async fn request(
    connection: &ConnectionArgs,
    method: &str,
    params: impl serde::Serialize,
) -> Result<serde_json::Value> {
    crate::request_value(connection, method, serde_json::to_value(params)?).await
}

fn render_plugin_table(response: PluginListResponse) -> String {
    let mut lines = vec!["PLUGIN  STATUS  VERSION".to_string()];
    for marketplace in response.marketplaces {
        for plugin in marketplace.plugins {
            let status = if !plugin.installed {
                "not installed"
            } else if plugin.enabled {
                "installed, enabled"
            } else {
                "installed, disabled"
            };
            lines.push(format!(
                "{}  {}  {}",
                plugin.id,
                status,
                plugin.local_version.or(plugin.version).unwrap_or_default()
            ));
        }
    }
    if lines.len() == 1 {
        lines[0] = "No plugins found.".to_string();
    }
    for error in response.marketplace_load_errors {
        lines.push(format!(
            "{}: {}",
            error.marketplace_path.display(),
            error.message
        ));
    }
    lines.join("\n")
}

fn parse_selection(plugin: &str, marketplace: Option<&str>) -> Result<(String, String)> {
    let (name, market) = match (plugin.rsplit_once('@'), marketplace) {
        (Some((name, market)), Some(selected)) => {
            anyhow::ensure!(
                market == selected,
                "Plugin marketplace conflicts with --marketplace"
            );
            (name, market)
        }
        (Some(pair), None) => pair,
        (None, Some(market)) => (plugin, market),
        (None, None) => anyhow::bail!("Plugin requires --marketplace or PLUGIN@MARKETPLACE"),
    };
    for (value, label) in [(name, "plugin"), (market, "marketplace")] {
        anyhow::ensure!(
            !value.is_empty()
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')),
            "Invalid {label}: {value}"
        );
    }
    Ok((name.to_string(), market.to_string()))
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    #[test]
    fn selectors_reject_direct_paths_and_conflicting_markets() {
        assert!(super::parse_selection("/tmp/plugin", None).is_err());
        assert!(super::parse_selection("sample@one", Some("two")).is_err());
        assert_eq!(
            super::parse_selection("sample", Some("one")).unwrap(),
            ("sample".to_string(), "one".to_string())
        );
        for flag in ["--source", "--expected-digest", "--marketplace-path"] {
            assert!(crate::MultitoolCli::try_parse_from([
                "lime",
                "plugin",
                "add",
                "sample@one",
                flag,
                "legacy"
            ])
            .is_err());
        }
    }

    #[test]
    fn plugin_add_list_and_remove_parse_under_plugin() {
        for args in [
            vec!["lime", "plugin", "add", "sample@debug"],
            vec!["lime", "plugin", "list", "--json"],
            vec!["lime", "plugin", "remove", "sample", "--json"],
        ] {
            let cli = crate::MultitoolCli::try_parse_from(args).expect("parse plugin command");
            assert!(matches!(cli.subcommand, Some(crate::Subcommand::Plugin(_))));
        }
    }

    #[test]
    fn plugin_search_uses_the_shared_working_directory() {
        let cli = crate::MultitoolCli::try_parse_from([
            "lime",
            "plugin",
            "search",
            "surface",
            "-C",
            "/tmp/workspace",
        ])
        .expect("parse plugin search");
        assert!(matches!(cli.subcommand, Some(crate::Subcommand::Plugin(_))));
    }

    #[test]
    fn plugin_list_available_requires_json_and_accepts_repo_cwd() {
        let error = crate::MultitoolCli::try_parse_from(["lime", "plugin", "list", "--available"])
            .expect_err("available output must be JSON");
        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );

        let cli = crate::MultitoolCli::try_parse_from([
            "lime",
            "plugin",
            "list",
            "--available",
            "--json",
            "-C",
            "/tmp/workspace",
            "--marketplace",
            "debug",
        ])
        .expect("parse plugin list catalog options");
        assert!(matches!(cli.subcommand, Some(crate::Subcommand::Plugin(_))));
    }
}
