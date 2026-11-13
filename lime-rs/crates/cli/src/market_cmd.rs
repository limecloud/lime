//! Independent market resources use the shared App Server installation and runtime.
use crate::connection::ConnectionArgs;
use anyhow::{bail, Result};
use app_server_protocol::protocol::v2::*;
use clap::{Args, ValueEnum};
use std::process::ExitCode;

#[derive(Debug, Args)]
pub(crate) struct MarketCli {
    #[command(subcommand)]
    subcommand: MarketSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum MarketSubcommand {
    /// List one page of shared skills or MCP servers.
    List(ListArgs),
    /// Read the published resource and its installation requirements.
    Read(ResourceArgs),
    /// Install the selected release, or resume its original installation.
    Install(InstallArgs),
    /// List resources installed for the current account.
    Installed(InstalledArgs),
    /// List unfinished installations with their original selected releases.
    Pending(InstalledArgs),
    /// Cancel a local installation only after all dispatched requests are resolved.
    Cancel(CancelArgs),
    /// Check acquisition status without changing local installations.
    Reconcile(InstalledArgs),
    /// Enable an installed resource.
    Enable(ResourceArgs),
    /// Disable an installed resource.
    Disable(ResourceArgs),
    /// Remove a local installation without revoking its market acquisition.
    Uninstall(ResourceArgs),
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Kind {
    Skill,
    Mcp,
}

impl From<Kind> for MarketResourceKind {
    fn from(value: Kind) -> Self {
        match value {
            Kind::Skill => Self::Skill,
            Kind::Mcp => Self::Mcp,
        }
    }
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long, value_enum)]
    kind: Kind,
    #[arg(long)]
    query: Option<String>,
    #[arg(long)]
    cursor: Option<String>,
    #[arg(long)]
    limit: Option<u32>,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct ResourceArgs {
    item_id: String,
    #[arg(long, value_enum)]
    kind: Kind,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct InstalledArgs {
    #[arg(long, value_enum)]
    kind: Option<Kind>,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct InstallArgs {
    #[command(flatten)]
    resource: ResourceArgs,
    /// Exact release from a prior market read; all three identity fields are required together.
    #[arg(long, requires_all=["manifest_sha256", "archive_sha256"])]
    release_id: Option<String>,
    #[arg(long, requires = "release_id")]
    manifest_sha256: Option<String>,
    #[arg(long, requires = "release_id")]
    archive_sha256: Option<String>,
    /// Reuse this value when recording a new installation operation externally.
    #[arg(long)]
    attempt_id: Option<String>,
}

#[derive(Debug, Args)]
struct CancelArgs {
    #[command(flatten)]
    resource: ResourceArgs,
    /// Original attempt returned by `lime market pending`.
    #[arg(long)]
    attempt_id: String,
}

impl MarketCli {
    pub(crate) fn connection_mut(&mut self) -> &mut ConnectionArgs {
        match &mut self.subcommand {
            MarketSubcommand::List(a) => &mut a.connection,
            MarketSubcommand::Installed(a)
            | MarketSubcommand::Pending(a)
            | MarketSubcommand::Reconcile(a) => &mut a.connection,
            MarketSubcommand::Cancel(a) => &mut a.resource.connection,
            MarketSubcommand::Install(a) => &mut a.resource.connection,
            MarketSubcommand::Read(a)
            | MarketSubcommand::Enable(a)
            | MarketSubcommand::Disable(a)
            | MarketSubcommand::Uninstall(a) => &mut a.connection,
        }
    }

    pub(crate) async fn run(self) -> ExitCode {
        match self.run_inner().await {
            Ok(value) => {
                println!("{value}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{error:#}");
                ExitCode::FAILURE
            }
        }
    }

    async fn run_inner(self) -> Result<String> {
        let value = match self.subcommand {
            MarketSubcommand::List(a) => {
                request(
                    &a.connection,
                    METHOD_MARKET_LIST,
                    MarketListParams {
                        kind: a.kind.into(),
                        query: a.query,
                        cursor: a.cursor,
                        limit: a.limit,
                    },
                )
                .await?
            }
            MarketSubcommand::Read(a) => read(&a).await?,
            MarketSubcommand::Pending(a) => {
                request(
                    &a.connection,
                    METHOD_MARKET_PENDING,
                    MarketPendingParams {
                        kind: a.kind.map(Into::into),
                    },
                )
                .await?
            }
            MarketSubcommand::Reconcile(a) => {
                request(
                    &a.connection,
                    METHOD_MARKET_RECONCILE,
                    MarketReconcileParams {
                        kind: a.kind.map(Into::into),
                    },
                )
                .await?
            }
            MarketSubcommand::Cancel(a) => {
                request(
                    &a.resource.connection,
                    METHOD_MARKET_INSTALL_CANCEL,
                    MarketInstallCancelParams {
                        item_id: a.resource.item_id,
                        kind: a.resource.kind.into(),
                        install_attempt_id: a.attempt_id,
                    },
                )
                .await?
            }
            MarketSubcommand::Installed(a) => {
                request(
                    &a.connection,
                    METHOD_MARKET_INSTALLED,
                    MarketInstalledParams {
                        kind: a.kind.map(Into::into),
                    },
                )
                .await?
            }
            MarketSubcommand::Install(a) => {
                let pending: MarketPendingResponse = serde_json::from_value(
                    request(
                        &a.resource.connection,
                        METHOD_MARKET_PENDING,
                        MarketPendingParams {
                            kind: Some(a.resource.kind.into()),
                        },
                    )
                    .await?,
                )?;
                if pending
                    .errors
                    .iter()
                    .any(|e| e.item_id == a.resource.item_id)
                {
                    bail!("invalid_market_install_attempt");
                }
                let original = pending
                    .attempts
                    .into_iter()
                    .find(|p| p.resource.item_id == a.resource.item_id);
                let reference = match (a.release_id, a.manifest_sha256, a.archive_sha256) {
                    (Some(id), Some(manifest_sha256), Some(archive_sha256)) => {
                        MarketReleaseReference {
                            id,
                            manifest_sha256,
                            archive_sha256,
                        }
                    }
                    (None, None, None) => match &original {
                        Some(attempt) => attempt.resource.release.clone(),
                        None => {
                            let response: MarketReadResponse =
                                serde_json::from_value(read(&a.resource).await?)?;
                            response.resource.release
                        }
                    },
                    _ => bail!("The release ID and both SHA-256 values are required together."),
                };
                if original
                    .as_ref()
                    .is_some_and(|p| p.resource.release != reference)
                {
                    bail!("market_install_pending_other_release");
                }
                let install_attempt_id = original
                    .map(|p| p.install_attempt_id)
                    .or(a.attempt_id)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                request(
                    &a.resource.connection,
                    METHOD_MARKET_INSTALL,
                    MarketInstallParams {
                        item_id: a.resource.item_id,
                        kind: a.resource.kind.into(),
                        release: reference,
                        install_attempt_id,
                    },
                )
                .await?
            }
            MarketSubcommand::Enable(a) => enabled(a, true).await?,
            MarketSubcommand::Disable(a) => enabled(a, false).await?,
            MarketSubcommand::Uninstall(a) => {
                request(
                    &a.connection,
                    METHOD_MARKET_UNINSTALL,
                    MarketUninstallParams {
                        item_id: a.item_id,
                        kind: a.kind.into(),
                    },
                )
                .await?
            }
        };
        Ok(serde_json::to_string_pretty(&value)?)
    }
}

async fn read(a: &ResourceArgs) -> Result<serde_json::Value> {
    request(
        &a.connection,
        METHOD_MARKET_READ,
        MarketReadParams {
            item_id: a.item_id.clone(),
            kind: a.kind.into(),
            release: None,
        },
    )
    .await
}

async fn enabled(a: ResourceArgs, enabled: bool) -> Result<serde_json::Value> {
    request(
        &a.connection,
        METHOD_MARKET_ENABLED_SET,
        MarketEnabledSetParams {
            item_id: a.item_id,
            kind: a.kind.into(),
            enabled,
        },
    )
    .await
}

async fn request(
    connection: &ConnectionArgs,
    method: &str,
    params: impl serde::Serialize,
) -> Result<serde_json::Value> {
    crate::request_value(connection, method, serde_json::to_value(params)?).await
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    #[test]
    fn market_commands_require_type_and_complete_release_identity() {
        for args in [
            vec!["lime", "market", "list", "--kind", "skill"],
            vec![
                "lime",
                "market",
                "install",
                "item_research",
                "--kind",
                "mcp",
            ],
            vec!["lime", "market", "installed"],
            vec!["lime", "market", "pending"],
            vec!["lime", "market", "reconcile", "--kind", "mcp"],
            vec![
                "lime",
                "market",
                "cancel",
                "item_research",
                "--kind",
                "skill",
                "--attempt-id",
                "original-attempt-1234",
            ],
            vec![
                "lime",
                "market",
                "disable",
                "item_research",
                "--kind",
                "skill",
            ],
            vec![
                "lime",
                "market",
                "uninstall",
                "item_research",
                "--kind",
                "mcp",
            ],
        ] {
            assert!(crate::MultitoolCli::try_parse_from(args).is_ok());
        }
        for args in [
            vec!["lime", "market", "install", "item_research"],
            vec![
                "lime",
                "market",
                "cancel",
                "item_research",
                "--kind",
                "skill",
            ],
            vec!["lime", "market", "list", "--kind", "plugin"],
            vec![
                "lime",
                "market",
                "install",
                "item_research",
                "--kind",
                "skill",
                "--release-id",
                "rel_one",
            ],
        ] {
            assert!(crate::MultitoolCli::try_parse_from(args).is_err());
        }
    }
}
