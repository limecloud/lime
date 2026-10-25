//! Shared CLI connection options and permission-group inheritance.

use anyhow::{bail, Result};
use clap::{Args, ValueEnum};
use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Debug, Default, Args, Clone)]
pub(crate) struct ConnectionArgs {
    /// Request native confirmation for this exact target before starting the session.
    #[arg(long = "computer-use-target", value_name = "JSON", value_parser = parse_computer_use_target)]
    pub(crate) computer_use_targets:
        Vec<app_server_protocol::protocol::v2::ComputerUseTargetIdentity>,
    #[arg(long = "app-server", value_name = "PATH")]
    pub(crate) app_server: Option<PathBuf>,
    #[arg(
        long = "app-server-arg",
        value_name = "ARG",
        allow_hyphen_values = true,
        hide = true
    )]
    pub(crate) app_server_args: Vec<OsString>,
    #[command(flatten)]
    pub(crate) remote: InteractiveRemoteOptions,
    #[arg(long = "cd", short = 'C', value_name = "DIR")]
    pub(crate) cwd: Option<PathBuf>,
    #[arg(long)]
    pub(crate) model: Option<String>,
    #[arg(long, visible_alias = "model-provider")]
    pub(crate) provider: Option<String>,
    #[arg(long, value_name = "EFFORT")]
    pub(crate) effort: Option<String>,
    #[arg(long, value_name = "PROFILE")]
    pub(crate) permissions: Option<String>,
    /// Select the sandbox policy for model-generated commands.
    #[arg(
        long = "sandbox",
        short = 's',
        value_enum,
        conflicts_with_all = ["approve_for_me", "permissions"]
    )]
    pub(crate) sandbox_mode: Option<SandboxModeCliArg>,
    /// Route approval requests through automatic review using workspace-write.
    #[arg(
        long = "approve-for-me",
        alias = "not-so-yolo",
        conflicts_with_all = [
            "sandbox_mode",
            "dangerously_bypass_approvals_and_sandbox",
            "approval_policy",
            "permissions"
        ]
    )]
    pub(crate) approve_for_me: bool,
    /// Configure when the model must ask for approval before executing commands.
    #[arg(
        long = "ask-for-approval",
        short = 'a',
        value_enum,
        conflicts_with_all = ["approve_for_me", "dangerously_bypass_approvals_and_sandbox"]
    )]
    pub(crate) approval_policy: Option<ApprovalPolicyCliArg>,
    /// Skip confirmation prompts and sandboxing. Intended only for externally sandboxed hosts.
    #[arg(
        long = "dangerously-bypass-approvals-and-sandbox",
        alias = "yolo",
        conflicts_with_all = ["approve_for_me", "approval_policy", "permissions"]
    )]
    pub(crate) dangerously_bypass_approvals_and_sandbox: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub(crate) enum SandboxModeCliArg {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl SandboxModeCliArg {
    fn as_policy(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::DangerFullAccess => "danger-full-access",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub(crate) enum ApprovalPolicyCliArg {
    OnRequest,
    Never,
}

impl ApprovalPolicyCliArg {
    fn as_policy(self) -> &'static str {
        match self {
            Self::OnRequest => "on-request",
            Self::Never => "never",
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct PermissionSettings {
    pub(crate) approval_policy: Option<String>,
    pub(crate) approvals_reviewer: Option<agent_protocol::ApprovalsReviewer>,
    pub(crate) sandbox_policy: Option<String>,
}

pub(crate) fn permission_settings(args: &ConnectionArgs) -> Result<PermissionSettings> {
    if args.permissions.is_some()
        && (args.sandbox_mode.is_some()
            || args.approve_for_me
            || args.dangerously_bypass_approvals_and_sandbox)
    {
        bail!("`--permissions` cannot be combined with an explicit sandbox mode");
    }

    if args.approve_for_me {
        return Ok(PermissionSettings {
            approval_policy: Some(
                args.approval_policy
                    .map(ApprovalPolicyCliArg::as_policy)
                    .unwrap_or("on-request")
                    .to_string(),
            ),
            approvals_reviewer: Some(agent_protocol::ApprovalsReviewer::AutoReview),
            sandbox_policy: Some("workspace-write".to_string()),
        });
    }

    if args.dangerously_bypass_approvals_and_sandbox {
        return Ok(PermissionSettings {
            approval_policy: Some(
                args.approval_policy
                    .map(ApprovalPolicyCliArg::as_policy)
                    .unwrap_or("never")
                    .to_string(),
            ),
            approvals_reviewer: None,
            sandbox_policy: Some("danger-full-access".to_string()),
        });
    }

    Ok(PermissionSettings {
        approval_policy: args
            .approval_policy
            .map(ApprovalPolicyCliArg::as_policy)
            .map(str::to_string),
        approvals_reviewer: None,
        sandbox_policy: args
            .sandbox_mode
            .map(SandboxModeCliArg::as_policy)
            .map(str::to_string),
    })
}

impl ConnectionArgs {
    pub(crate) fn workspace_cwd(&self) -> Result<Option<PathBuf>> {
        if self.cwd.is_some() || self.remote.remote.is_some() {
            return Ok(self.cwd.clone());
        }
        Ok(Some(std::env::current_dir()?))
    }

    pub(crate) fn inherit_from(&mut self, root: &Self) {
        if self.computer_use_targets.is_empty() {
            self.computer_use_targets
                .clone_from(&root.computer_use_targets);
        }
        let child_sandbox_group_selected = self.sandbox_mode.is_some()
            || self.approve_for_me
            || self.dangerously_bypass_approvals_and_sandbox
            || self.permissions.is_some();
        let child_approval_group_selected = self.approval_policy.is_some()
            || self.approve_for_me
            || self.dangerously_bypass_approvals_and_sandbox;

        let child_remote = self.remote.remote.is_some();
        let child_local = self.app_server.is_some() || !self.app_server_args.is_empty();
        if !child_remote {
            if self.app_server.is_none() {
                self.app_server.clone_from(&root.app_server);
            }
            if self.app_server_args.is_empty()
                && (!child_local || self.app_server == root.app_server)
            {
                self.app_server_args.clone_from(&root.app_server_args);
            }
        }
        if !child_local && !child_remote {
            self.remote.remote.clone_from(&root.remote.remote);
        }
        let same_remote = root.remote.remote.is_none() || self.remote.remote == root.remote.remote;
        if !child_local && same_remote && self.remote.remote_auth_token_env.is_none() {
            self.remote
                .remote_auth_token_env
                .clone_from(&root.remote.remote_auth_token_env);
        }
        if self.cwd.is_none() {
            self.cwd.clone_from(&root.cwd);
        }
        if self.model.is_none() {
            self.model.clone_from(&root.model);
        }
        if self.provider.is_none() {
            self.provider.clone_from(&root.provider);
        }
        if self.effort.is_none() {
            self.effort.clone_from(&root.effort);
        }
        if self.permissions.is_none() && !child_sandbox_group_selected {
            self.permissions.clone_from(&root.permissions);
        }

        if !child_sandbox_group_selected {
            if self.permissions.is_none() {
                if root.approve_for_me {
                    // Keep the root approve-for-me sandbox while allowing a child approval
                    // policy to override only the approval half of the group.
                    self.approve_for_me = true;
                } else if root.dangerously_bypass_approvals_and_sandbox {
                    self.dangerously_bypass_approvals_and_sandbox = true;
                } else {
                    self.sandbox_mode = root.sandbox_mode;
                }
            }
            if !child_approval_group_selected {
                self.approval_policy = root.approval_policy;
            }
        } else if self.permissions.is_some()
            && self.sandbox_mode.is_none()
            && !self.approve_for_me
            && !self.dangerously_bypass_approvals_and_sandbox
        {
            // A child permissions profile replaces a root sandbox group while preserving
            // an independently selected approval policy.
            if self.approval_policy.is_none() {
                self.approval_policy = root.approval_policy;
            }
        } else if self.approval_policy.is_none()
            && !self.approve_for_me
            && !self.dangerously_bypass_approvals_and_sandbox
        {
            // A child sandbox mode replaces the root sandbox group but keeps an independent
            // root approval policy when one was explicitly selected.
            self.approval_policy = root.approval_policy;
        }
    }
}

fn parse_computer_use_target(
    value: &str,
) -> std::result::Result<app_server_protocol::protocol::v2::ComputerUseTargetIdentity, String> {
    serde_json::from_str(value)
        .map_err(|error| format!("invalid Computer Use target JSON: {error}"))
}

#[derive(Debug, Default, Args, Clone)]
pub(crate) struct InteractiveRemoteOptions {
    /// Connect to an App Server WebSocket instead of spawning a local process.
    #[arg(long = "remote", value_name = "URL")]
    pub(crate) remote: Option<String>,
    /// Environment variable containing the remote App Server bearer token.
    #[arg(long = "remote-auth-token-env", value_name = "ENV_VAR")]
    pub(crate) remote_auth_token_env: Option<String>,
}
