//! Connection options and transport construction for the terminal Host.

use crate::app_server_session::AppServerSession;
use anyhow::{bail, Result};
use app_server_client::{RemoteTransportConfig, StdioTransportConfig};
use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct TuiOptions {
    pub computer_use_targets: Vec<app_server_protocol::protocol::v2::ComputerUseTargetIdentity>,
    pub app_server_bin: PathBuf,
    pub app_server_args: Vec<OsString>,
    pub remote: Option<RemoteTransportConfig>,
    pub cwd: Option<PathBuf>,
    pub model: Option<String>,
    pub model_provider: Option<String>,
    pub reasoning_effort: Option<String>,
    pub permissions: Option<String>,
    pub approval_policy: Option<String>,
    pub approvals_reviewer: Option<agent_protocol::ApprovalsReviewer>,
    pub sandbox_policy: Option<String>,
    pub locale: Option<String>,
    pub resume_thread: Option<String>,
}

pub(super) fn validate_model_route(options: &TuiOptions) -> Result<()> {
    match (&options.model, &options.model_provider) {
        (Some(model), Some(provider)) if model.trim().is_empty() || provider.trim().is_empty() => {
            bail!("model and provider must not be empty")
        }
        (Some(_), None) | (None, Some(_)) => {
            bail!("--model and --provider must be specified together")
        }
        _ => Ok(()),
    }
}

pub(crate) async fn connect_session(options: &TuiOptions) -> Result<AppServerSession> {
    validate_model_route(options)?;
    let mut session = if let Some(remote) = options.remote.clone() {
        AppServerSession::connect_remote(remote).await
    } else {
        AppServerSession::connect(stdio_config(options)?).await
    }?;
    if let Err(error) = session
        .request_handle()
        .setup_computer_use_targets(&options.computer_use_targets)
        .await
    {
        let _ = session.shutdown().await;
        return Err(error.into());
    }
    Ok(session)
}

pub(crate) fn stdio_config(options: &TuiOptions) -> Result<StdioTransportConfig> {
    validate_model_route(options)?;
    let mut config = StdioTransportConfig::runtime(&options.app_server_bin);
    config.args.extend(options.app_server_args.iter().cloned());
    Ok(config)
}
