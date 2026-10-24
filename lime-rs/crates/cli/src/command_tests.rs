//! CLI parsing, connection selection and command contracts.

use crate::connection::{InteractiveRemoteOptions, PermissionSettings, SandboxModeCliArg};
use std::ffi::OsString;
use std::path::PathBuf;

use clap::{CommandFactory, Parser};

use super::*;

#[test]
fn explicit_app_server_path_has_highest_precedence() {
    let path = resolve_app_server_bin(Some(PathBuf::from("/tmp/custom-app-server")));
    assert_eq!(path, PathBuf::from("/tmp/custom-app-server"));
}

#[test]
fn exec_parser_keeps_options_out_of_multi_word_prompt() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "exec",
        "review this diff",
        "--json",
        "--cd",
        "/tmp/worktree",
        "--model",
        "gpt-test",
        "--provider",
        "openai-test",
        "--effort",
        "high",
        "--permissions",
        ":workspace",
        "--app-server-arg=--backend",
        "--app-server-arg=external",
    ])
    .expect("parse exec");
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
        panic!("expected exec command");
    };

    assert_eq!(args.prompt.as_deref(), Some("review this diff"));
    assert!(args.json);
    assert_eq!(args.connection.cwd, Some(PathBuf::from("/tmp/worktree")));
    assert_eq!(args.connection.model.as_deref(), Some("gpt-test"));
    assert_eq!(args.connection.provider.as_deref(), Some("openai-test"));
    assert_eq!(args.connection.effort.as_deref(), Some("high"));
    assert_eq!(args.connection.permissions.as_deref(), Some(":workspace"));
    assert_eq!(
        args.connection.app_server_args,
        vec![OsString::from("--backend"), OsString::from("external")]
    );
}

#[test]
fn approve_for_me_and_hidden_alias_lower_to_canonical_policy() {
    for flag in ["--approve-for-me", "--not-so-yolo"] {
        let cli = crate::MultitoolCli::try_parse_from(["lime", "exec", flag, "check"])
            .expect("parse approve-for-me");
        let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
            panic!("expected exec command");
        };
        let options = tui_options(args.connection.into_inner(), None, None).expect("lower policy");
        assert_eq!(options.approval_policy.as_deref(), Some("on-request"));
        assert_eq!(
            options.approvals_reviewer,
            Some(agent_protocol::ApprovalsReviewer::AutoReview)
        );
        assert_eq!(options.sandbox_policy.as_deref(), Some("workspace-write"));
    }
}

#[test]
fn not_so_yolo_alias_is_hidden_from_help() {
    let help = crate::MultitoolCli::command().render_help().to_string();
    assert!(!help.contains("--not-so-yolo"));
}

#[test]
fn dangerous_bypass_lowers_to_never_and_full_access() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "check",
    ])
    .expect("parse dangerous bypass");
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
        panic!("expected exec command");
    };
    let options = tui_options(args.connection.into_inner(), None, None).expect("lower policy");
    assert_eq!(options.approval_policy.as_deref(), Some("never"));
    assert_eq!(options.approvals_reviewer, None);
    assert_eq!(
        options.sandbox_policy.as_deref(),
        Some("danger-full-access")
    );
}

#[test]
fn permission_flags_are_mutually_exclusive_and_fail_closed() {
    for args in [
        &[
            "lime",
            "exec",
            "--approve-for-me",
            "--sandbox",
            "read-only",
            "check",
        ][..],
        &[
            "lime",
            "exec",
            "--approve-for-me",
            "--ask-for-approval",
            "never",
            "check",
        ][..],
        &[
            "lime",
            "exec",
            "--dangerously-bypass-approvals-and-sandbox",
            "--ask-for-approval",
            "on-request",
            "check",
        ][..],
        &[
            "lime",
            "exec",
            "--permissions",
            ":workspace",
            "--sandbox",
            "read-only",
            "check",
        ][..],
    ] {
        let error = crate::MultitoolCli::try_parse_from(args)
            .expect_err("conflicting permission flags must be rejected");
        assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
    }
}

#[test]
fn root_permission_flags_inherit_and_later_exec_flags_override() {
    let mut cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "--approve-for-me",
        "exec",
        "--sandbox",
        "read-only",
        "check",
    ])
    .expect("parse root and exec permission flags");
    let root = cli.interactive.connection.clone();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand.as_mut() else {
        panic!("expected exec command");
    };
    args.connection.inherit_from(&root);
    assert_eq!(
        args.connection.sandbox_mode,
        Some(SandboxModeCliArg::ReadOnly)
    );
    assert!(!args.connection.approve_for_me);
    assert_eq!(
        permission_settings(&args.connection).expect("lower override"),
        PermissionSettings {
            approval_policy: None,
            approvals_reviewer: None,
            sandbox_policy: Some("read-only".to_string()),
        }
    );
}

#[test]
fn root_permission_flags_apply_to_exec_when_subcommand_is_unspecified() {
    let mut cli =
        crate::MultitoolCli::try_parse_from(["lime", "--approve-for-me", "exec", "check"])
            .expect("parse root permission flags");
    let root = cli.interactive.connection.clone();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand.as_mut() else {
        panic!("expected exec command");
    };
    args.connection.inherit_from(&root);
    assert!(args.connection.approve_for_me);
    assert_eq!(
        permission_settings(&args.connection)
            .expect("lower inherited policy")
            .sandbox_policy
            .as_deref(),
        Some("workspace-write")
    );
}

#[test]
fn child_permissions_profile_replaces_root_sandbox_group() {
    let mut cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "--approve-for-me",
        "exec",
        "--permissions",
        ":workspace",
        "check",
    ])
    .expect("parse root approve and child profile");
    let root = cli.interactive.connection.clone();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand.as_mut() else {
        panic!("expected exec command");
    };
    args.connection.inherit_from(&root);
    assert_eq!(args.connection.permissions.as_deref(), Some(":workspace"));
    assert!(!args.connection.approve_for_me);
    assert!(args.connection.sandbox_mode.is_none());
    assert_eq!(args.connection.approval_policy, None);
    assert_eq!(
        permission_settings(&args.connection).expect("profile policy"),
        PermissionSettings::default()
    );
}

#[test]
fn child_approval_policy_overrides_only_root_approve_for_me_approval() {
    let mut cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "--approve-for-me",
        "exec",
        "--ask-for-approval",
        "never",
        "check",
    ])
    .expect("parse root approve and child approval");
    let root = cli.interactive.connection.clone();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand.as_mut() else {
        panic!("expected exec command");
    };
    args.connection.inherit_from(&root);
    let options = tui_options(args.connection.clone(), None, None).expect("lower override");
    assert_eq!(options.approval_policy.as_deref(), Some("never"));
    assert_eq!(
        options.approvals_reviewer,
        Some(agent_protocol::ApprovalsReviewer::AutoReview)
    );
    assert_eq!(options.sandbox_policy.as_deref(), Some("workspace-write"));
}

#[test]
fn child_sandbox_keeps_independent_root_approval_policy() {
    let mut cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "read-only",
        "check",
    ])
    .expect("parse root approval and child sandbox");
    let root = cli.interactive.connection.clone();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand.as_mut() else {
        panic!("expected exec command");
    };
    args.connection.inherit_from(&root);
    let options = tui_options(args.connection.clone(), None, None).expect("lower override");
    assert_eq!(options.approval_policy.as_deref(), Some("never"));
    assert_eq!(options.sandbox_policy.as_deref(), Some("read-only"));
}

#[test]
fn working_directory_flag_matches_codex_cd_shape() {
    let long_form =
        crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "--cd", "/tmp/long-form"])
            .expect("parse --cd");
    let short_form =
        crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "-C", "/tmp/short-form"])
            .expect("parse -C");

    let Some(crate::Subcommand::Exec(long_args)) = long_form.subcommand else {
        panic!("expected long-form exec command");
    };
    let Some(crate::Subcommand::Exec(short_args)) = short_form.subcommand else {
        panic!("expected short-form exec command");
    };
    assert_eq!(
        long_args.connection.cwd,
        Some(PathBuf::from("/tmp/long-form"))
    );
    assert_eq!(
        short_args.connection.cwd,
        Some(PathBuf::from("/tmp/short-form"))
    );
}

#[test]
fn legacy_cwd_flag_is_rejected() {
    let error =
        crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "--cwd", "/tmp/legacy"])
            .expect_err("legacy --cwd must not remain a current CLI option");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn remote_connection_flags_match_codex_shape() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "exec",
        "check",
        "--remote",
        "wss://cloud.example/rpc",
        "--remote-auth-token-env",
        "LIME_REMOTE_TOKEN",
    ])
    .expect("parse remote exec");
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
        panic!("expected exec command");
    };
    assert_eq!(
        args.connection.remote.remote.as_deref(),
        Some("wss://cloud.example/rpc")
    );
    assert_eq!(
        args.connection.remote.remote_auth_token_env.as_deref(),
        Some("LIME_REMOTE_TOKEN")
    );
}

#[test]
fn remote_auth_token_env_requires_remote_endpoint() {
    let connection = ConnectionArgs {
        app_server: None,
        app_server_args: Vec::new(),
        remote: InteractiveRemoteOptions {
            remote: None,
            remote_auth_token_env: Some("LIME_REMOTE_TOKEN".to_string()),
        },
        cwd: None,
        model: None,
        provider: None,
        effort: None,
        permissions: None,
        sandbox_mode: None,
        approve_for_me: false,
        approval_policy: None,
        dangerously_bypass_approvals_and_sandbox: false,
    };
    let error =
        resolve_remote_endpoint(&connection).expect_err("remote auth without endpoint must fail");
    assert!(error.to_string().contains("requires `--remote`"));
}

#[test]
fn remote_auth_token_env_missing_fails_before_connecting() {
    let connection = ConnectionArgs {
        app_server: None,
        app_server_args: Vec::new(),
        remote: InteractiveRemoteOptions {
            remote: Some("wss://cloud.example/rpc".to_string()),
            remote_auth_token_env: Some("LIME_REMOTE_TOKEN_MISSING_FOR_TEST_9A7C".to_string()),
        },
        cwd: None,
        model: None,
        provider: None,
        effort: None,
        permissions: None,
        sandbox_mode: None,
        approve_for_me: false,
        approval_policy: None,
        dangerously_bypass_approvals_and_sandbox: false,
    };
    let error = resolve_remote_endpoint(&connection)
        .expect_err("missing remote auth env must fail before transport startup");
    assert!(error.to_string().contains("is not set"));
}

#[test]
fn tui_options_lower_remote_url_without_local_process_settings() {
    let connection = ConnectionArgs {
        app_server: None,
        app_server_args: Vec::new(),
        remote: InteractiveRemoteOptions {
            remote: Some("ws://127.0.0.1:4500/rpc".to_string()),
            remote_auth_token_env: None,
        },
        cwd: Some(PathBuf::from("/tmp/worktree")),
        model: None,
        provider: None,
        effort: None,
        permissions: None,
        sandbox_mode: None,
        approve_for_me: false,
        approval_policy: None,
        dangerously_bypass_approvals_and_sandbox: false,
    };
    let options = tui_options(connection, None, None).expect("remote options");
    assert_eq!(
        options
            .remote
            .as_ref()
            .map(|config| config.websocket_url.as_str()),
        Some("ws://127.0.0.1:4500/rpc")
    );
    assert!(options.remote.as_ref().unwrap().auth_token.is_none());
    assert_eq!(options.cwd, Some(PathBuf::from("/tmp/worktree")));
}

#[test]
fn remote_workspace_omits_local_defaults_and_keeps_explicit_server_paths() {
    for cwd in [
        None,
        Some("/server/does-not-exist-locally"),
        Some(r"C:\server\workspace"),
    ] {
        let connection = ConnectionArgs {
            remote: InteractiveRemoteOptions {
                remote: Some("ws://127.0.0.1:4500/rpc".into()),
                ..Default::default()
            },
            cwd: cwd.map(PathBuf::from),
            ..Default::default()
        };
        assert_eq!(connection.workspace_cwd().unwrap(), cwd.map(PathBuf::from));
        assert_eq!(
            tui_options(connection, None, None).unwrap().cwd,
            cwd.map(PathBuf::from)
        );
    }
    assert_eq!(
        ConnectionArgs::default().workspace_cwd().unwrap(),
        Some(std::env::current_dir().unwrap())
    );
}

#[test]
fn remote_connection_rejects_local_app_server_overrides() {
    let connection = ConnectionArgs {
        app_server: Some(PathBuf::from("app-server")),
        app_server_args: Vec::new(),
        remote: InteractiveRemoteOptions {
            remote: Some("wss://cloud.example/rpc".to_string()),
            remote_auth_token_env: None,
        },
        cwd: None,
        model: None,
        provider: None,
        effort: None,
        permissions: None,
        sandbox_mode: None,
        approve_for_me: false,
        approval_policy: None,
        dangerously_bypass_approvals_and_sandbox: false,
    };
    let error = resolve_remote_endpoint(&connection)
        .expect_err("remote and local app-server overrides must be exclusive");
    assert!(error.to_string().contains("cannot be combined"));
}

#[test]
fn read_remote_auth_token_from_env_var_trims_values() {
    let token = read_remote_auth_token_from_env_var_with("LIME_REMOTE_TOKEN", |_| {
        Ok("  bearer-secret  ".to_string())
    })
    .expect("trim remote token");
    assert_eq!(token, "bearer-secret");
}

#[test]
fn read_remote_auth_token_from_env_var_reports_missing_values() {
    let error = read_remote_auth_token_from_env_var_with("LIME_REMOTE_TOKEN", |_| {
        Err(env::VarError::NotPresent)
    })
    .expect_err("missing token");
    assert!(error.to_string().contains("is not set"));
}

#[test]
fn read_remote_auth_token_from_env_var_rejects_empty_values() {
    let error =
        read_remote_auth_token_from_env_var_with("LIME_REMOTE_TOKEN", |_| Ok("  \n".to_string()))
            .expect_err("empty token");
    assert!(error.to_string().contains("is empty"));
}

#[test]
fn exec_parser_uses_codex_json_events_flag_and_rejects_retired_jsonl() {
    let cli = crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "--json"])
        .expect("parse exec");
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
        panic!("expected exec command");
    };
    assert!(args.json);

    let error = crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "--jsonl"])
        .expect_err("retired flag must not remain as an alias");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn resume_parser_keeps_thread_identity_separate_from_connection_options() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "resume",
        "thread-42",
        "--cd",
        "/tmp/worktree",
        "--app-server",
        "/tmp/app-server",
        "--locale",
        "zh-CN",
    ])
    .expect("parse resume");
    let Some(crate::Subcommand::Resume(args)) = cli.subcommand else {
        panic!("expected resume command");
    };

    assert_eq!(args.thread_id.as_deref(), Some("thread-42"));
    assert_eq!(args.locale.as_deref(), Some("zh-CN"));
    assert_eq!(args.connection.cwd, Some(PathBuf::from("/tmp/worktree")));
    assert_eq!(
        args.connection.app_server,
        Some(PathBuf::from("/tmp/app-server"))
    );
}

#[test]
fn resume_without_id_selects_from_the_tui_session_picker() {
    let cli = crate::MultitoolCli::try_parse_from(["lime", "resume"]).expect("parse resume picker");
    let Some(crate::Subcommand::Resume(args)) = cli.subcommand else {
        panic!("expected resume command");
    };
    assert!(args.thread_id.is_none());
}

#[test]
fn top_level_fork_keeps_v2_identity_and_history_flags() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "fork",
        "thread-42",
        "--last-turn-id",
        "turn-7",
        "--exclude-turns",
    ])
    .expect("parse top-level fork");
    let Some(crate::Subcommand::Fork(args)) = cli.subcommand else {
        panic!("expected fork command");
    };

    assert_eq!(args.thread_id, "thread-42");
    assert_eq!(args.last_turn_id.as_deref(), Some("turn-7"));
    assert!(args.exclude_turns);
}

#[test]
fn mcp_list_parser_matches_codex_command_shape() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "mcp",
        "list",
        "--app-server",
        "/tmp/app-server",
    ])
    .expect("parse mcp list");
    let Some(crate::Subcommand::Mcp(command)) = cli.subcommand else {
        panic!("expected mcp command");
    };
    let crate::mcp_cmd::McpSubcommand::List(args) = command.subcommand else {
        panic!("expected mcp list command");
    };
    assert!(!args.json);
    assert_eq!(
        args.connection.app_server,
        Some(PathBuf::from("/tmp/app-server"))
    );
}

#[test]
fn skills_list_parser_accepts_multiple_cwds_and_force_reload() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "skills",
        "list",
        "--skill-cwd",
        "/tmp/one",
        "--skill-cwd",
        "/tmp/two",
        "--force-reload",
    ])
    .expect("parse skills list");
    let Some(crate::Subcommand::Skills(command)) = cli.subcommand else {
        panic!("expected skills command");
    };
    let SkillsSubcommand::List(args) = command.command;
    assert_eq!(
        args.skill_cwds,
        vec![PathBuf::from("/tmp/one"), PathBuf::from("/tmp/two")]
    );
    assert!(args.force_reload);
}

#[test]
fn execpolicy_check_parser_matches_codex_command_shape() {
    let cli = crate::MultitoolCli::try_parse_from([
        "lime",
        "execpolicy",
        "check",
        "--rules",
        "/tmp/policy.rules",
        "--pretty",
        "git",
        "push",
        "origin",
        "main",
    ])
    .expect("parse execpolicy check");
    let Some(crate::Subcommand::Execpolicy(command)) = cli.subcommand else {
        panic!("expected execpolicy command");
    };
    let crate::ExecpolicySubcommand::Check(check) = command.sub;
    assert_eq!(check.rules, [PathBuf::from("/tmp/policy.rules")]);
    assert!(check.pretty);
    assert_eq!(check.command, ["git", "push", "origin", "main"]);
}

#[cfg(test)]
mod app_server_tests {
    use clap::Parser;

    #[test]
    fn app_server_forwards_help_and_transport_flags() {
        let cli = crate::MultitoolCli::try_parse_from([
            "lime",
            "app-server",
            "--help",
            "--listen",
            "ws://127.0.0.1:4512",
        ])
        .expect("parse app-server passthrough");
        let Some(crate::Subcommand::AppServer(command)) = cli.subcommand else {
            panic!("expected app-server command");
        };
        assert_eq!(
            command.args,
            ["--help", "--listen", "ws://127.0.0.1:4512"].map(std::ffi::OsString::from)
        );
    }
}

#[cfg(test)]
mod debug_tests {
    use clap::Parser;

    #[test]
    fn debug_models_parses_bundled_flag() {
        let cli = crate::MultitoolCli::try_parse_from(["lime", "debug", "models", "--bundled"])
            .expect("parse debug models");
        assert!(matches!(cli.subcommand, Some(crate::Subcommand::Debug(_))));
    }

    #[test]
    fn debug_clear_memories_is_registered() {
        let cli = crate::MultitoolCli::try_parse_from(["lime", "debug", "clear-memories"])
            .expect("parse debug clear-memories");
        assert!(matches!(cli.subcommand, Some(crate::Subcommand::Debug(_))));
    }
}

#[cfg(test)]
mod features_tests {
    use app_server_protocol::protocol::v2::ExperimentalFeature;
    use clap::Parser;

    use super::*;

    #[test]
    fn features_enable_and_disable_parse_feature_name() {
        for action in ["enable", "disable"] {
            let cli = crate::MultitoolCli::try_parse_from(["lime", "features", action, "workspace_dependencies"])
                .expect("parse feature toggle");
            assert!(matches!(
                cli.subcommand,
                Some(crate::Subcommand::Features(_))
            ));
        }
    }

    #[test]
    fn feature_list_is_sorted_alphabetically() {
        let feature = |name: &str| ExperimentalFeature {
            name: name.to_string(),
            stage: ExperimentalFeatureStage::Stable,
            display_name: None,
            description: None,
            announcement: None,
            enabled: false,
            default_enabled: false,
        };
        let mut features = vec![feature("zeta"), feature("alpha")];
        features.sort_by(|left, right| left.name.cmp(&right.name));
        let output = render_features(features);
        assert_eq!(
            output
                .lines()
                .map(|line| line.split_whitespace().next().unwrap())
                .collect::<Vec<_>>(),
            vec!["alpha", "zeta"]
        );
    }
}
