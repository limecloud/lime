use super::*;
use clap::Parser;
use std::path::PathBuf;

fn parse(command: &[&str]) -> MultitoolCli {
    let mut argv = vec![
        "lime",
        "--remote",
        "ws://127.0.0.1:43210",
        "--remote-auth-token-env",
        "TEST_HOST_TOKEN",
        "--cd",
        "/fixture/root",
        "--model",
        "root-model",
        "--provider",
        "root-provider",
        "--effort",
        "high",
        "--permissions",
        ":read-only",
    ];
    argv.extend_from_slice(command);
    let mut cli = MultitoolCli::try_parse_from(argv).expect("parse command");
    inherit_root_options(&mut cli);
    cli
}

#[test]
fn all_server_commands_inherit_root_connection_and_run_options() {
    let commands: &[&[&str]] = &[
        &["login"],
        &["login", "status"],
        &["logout"],
        &["tui"],
        &["exec", "check"],
        &["resume", "thread-1"],
        &["review", "--uncommitted"],
        &["queue", "--thread", "thread-1", "--message", "later"],
        &["queue", "list", "--thread", "thread-1"],
        &["archive", "thread-1"],
        &["delete", "thread-1"],
        &["unarchive", "thread-1"],
        &["fork", "thread-1"],
        &["thread", "list"],
        &["thread", "show", "thread-1"],
        &["mcp", "list"],
        &["mcp", "get", "fixture"],
        &[
            "mcp",
            "add",
            "fixture",
            "--url",
            "http://127.0.0.1:43211/mcp",
        ],
        &["mcp", "remove", "fixture"],
        &["mcp", "start", "fixture"],
        &["mcp", "stop", "fixture"],
        &["mcp", "login", "fixture"],
        &["mcp", "logout", "fixture"],
        &["skills", "list"],
        &["plugin", "list"],
        &["plugin", "add", "/fixture/plugin"],
        &["plugin", "read", "fixture"],
        &["plugin", "search", "fixture"],
        &["plugin", "remove", "fixture"],
        &["plugin", "enable", "fixture"],
        &["plugin", "disable", "fixture"],
        &["features", "list"],
        &["features", "enable", "fixture"],
        &["features", "disable", "fixture"],
        &["debug", "models"],
        &["debug", "clear-memories"],
    ];
    for command in commands {
        let mut cli = parse(command);
        let options = cli
            .subcommand
            .as_mut()
            .unwrap()
            .connection_mut()
            .expect("server connection");
        assert_eq!(
            options.remote.remote.as_deref(),
            Some("ws://127.0.0.1:43210"),
            "{command:?}"
        );
        assert_eq!(
            options.remote.remote_auth_token_env.as_deref(),
            Some("TEST_HOST_TOKEN"),
            "{command:?}"
        );
        assert!(options.app_server.is_none(), "{command:?}");
        assert_eq!(
            options.cwd,
            Some(PathBuf::from("/fixture/root")),
            "{command:?}"
        );
        assert_eq!(options.model.as_deref(), Some("root-model"), "{command:?}");
        assert_eq!(
            options.provider.as_deref(),
            Some("root-provider"),
            "{command:?}"
        );
        assert_eq!(options.effort.as_deref(), Some("high"), "{command:?}");
        assert_eq!(
            options.permissions.as_deref(),
            Some(":read-only"),
            "{command:?}"
        );
    }
}

#[test]
fn child_target_and_permission_group_override_the_root() {
    for command in [
        vec!["mcp", "list"],
        vec!["plugin", "list"],
        vec!["thread", "list"],
        vec!["queue", "list", "--thread", "thread-1"],
        vec!["review", "--uncommitted"],
    ] {
        let mut command = command;
        command.extend([
            "--remote",
            "ws://127.0.0.1:43212",
            "--cd",
            "/fixture/child",
            "--sandbox",
            "workspace-write",
        ]);
        let mut cli = parse(&command);
        let options = cli.subcommand.as_mut().unwrap().connection_mut().unwrap();
        assert_eq!(
            options.remote.remote.as_deref(),
            Some("ws://127.0.0.1:43212")
        );
        assert!(
            options.remote.remote_auth_token_env.is_none(),
            "a new target does not inherit another host's token"
        );
        assert_eq!(options.cwd, Some(PathBuf::from("/fixture/child")));
        assert!(
            options.permissions.is_none(),
            "child sandbox replaces root permission profile"
        );
        assert_eq!(
            crate::connection::permission_settings(options)
                .unwrap()
                .sandbox_policy
                .as_deref(),
            Some("workspace-write")
        );
    }
}

#[test]
fn queue_list_inherits_intermediate_options_before_root_options() {
    let mut cli = parse(&[
        "queue",
        "--remote",
        "ws://127.0.0.1:43213",
        "--cd",
        "/fixture/queue",
        "list",
        "--thread",
        "thread-1",
    ]);
    let options = cli.subcommand.as_mut().unwrap().connection_mut().unwrap();
    assert_eq!(
        options.remote.remote.as_deref(),
        Some("ws://127.0.0.1:43213")
    );
    assert_eq!(options.cwd, Some(PathBuf::from("/fixture/queue")));
    assert_eq!(options.model.as_deref(), Some("root-model"));
}

#[test]
fn child_transport_replaces_root_transport_without_fallback_or_credentials() {
    let mut remote_root = parse(&["thread", "list", "--app-server", "/fixture/child-server"]);
    let options = remote_root
        .subcommand
        .as_mut()
        .unwrap()
        .connection_mut()
        .unwrap();
    assert!(options.remote.remote.is_none());
    assert!(options.remote.remote_auth_token_env.is_none());
    assert_eq!(
        options.app_server,
        Some(PathBuf::from("/fixture/child-server"))
    );

    let mut local_root = MultitoolCli::try_parse_from([
        "lime",
        "--app-server",
        "/fixture/root-server",
        "--app-server-arg=--stdio",
        "mcp",
        "list",
        "--remote",
        "ws://127.0.0.1:43214",
    ])
    .unwrap();
    inherit_root_options(&mut local_root);
    let options = local_root
        .subcommand
        .as_mut()
        .unwrap()
        .connection_mut()
        .unwrap();
    assert!(options.app_server.is_none());
    assert!(options.app_server_args.is_empty());
    assert_eq!(
        options.remote.remote.as_deref(),
        Some("ws://127.0.0.1:43214")
    );

    for (child_server, inherits_args) in [
        ("/fixture/root-server", true),
        ("/fixture/child-server", false),
    ] {
        let mut cli = MultitoolCli::try_parse_from([
            "lime",
            "--app-server",
            "/fixture/root-server",
            "--app-server-arg=--data-dir=/fixture/root-data",
            "mcp",
            "list",
            "--app-server",
            child_server,
        ])
        .unwrap();
        inherit_root_options(&mut cli);
        let options = cli.subcommand.as_mut().unwrap().connection_mut().unwrap();
        assert_eq!(options.app_server, Some(PathBuf::from(child_server)));
        assert_eq!(
            !options.app_server_args.is_empty(),
            inherits_args,
            "a different local Host must not inherit another Host's data directory"
        );
    }
}
