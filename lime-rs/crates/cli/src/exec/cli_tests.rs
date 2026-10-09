use super::*;
use clap::Parser;

fn parse(args: &[&str]) -> ExecCli {
    let cli = crate::MultitoolCli::try_parse_from(args).unwrap();
    let Some(crate::Subcommand::Exec(args)) = cli.subcommand else {
        panic!("expected exec");
    };
    args
}

#[test]
fn output_schema_is_global_across_root_resume_and_fork() {
    for argv in [
        vec!["lime", "exec", "--output-schema", "shape.json", "prompt"],
        vec![
            "lime",
            "exec",
            "--output-schema",
            "shape.json",
            "resume",
            "source",
            "prompt",
        ],
        vec![
            "lime",
            "exec",
            "resume",
            "source",
            "prompt",
            "--output-schema",
            "shape.json",
        ],
        vec![
            "lime",
            "exec",
            "--output-schema",
            "shape.json",
            "fork",
            "source",
            "prompt",
        ],
        vec![
            "lime",
            "exec",
            "fork",
            "source",
            "prompt",
            "--output-schema",
            "shape.json",
        ],
    ] {
        assert_eq!(
            parse(&argv).output_schema,
            Some(PathBuf::from("shape.json"))
        );
    }
    assert!(
        crate::MultitoolCli::try_parse_from(["lime", "exec", "prompt", "--output-schema"]).is_err()
    );
}

#[test]
fn exec_color_and_locale_leave_quoted_prompt_and_connection_intact() {
    let args = parse(&[
        "lime",
        "exec",
        "--color",
        "always",
        "--locale",
        "zh-TW",
        "--model",
        "model",
        "--provider",
        "provider",
        "check files",
    ]);
    assert_eq!(args.color, Color::Always);
    assert_eq!(args.locale.as_deref(), Some("zh-TW"));
    assert_eq!(args.prompt.as_deref(), Some("check files"));
    assert_eq!(args.connection.model.as_deref(), Some("model"));
    assert_eq!(args.connection.provider.as_deref(), Some("provider"));
    assert!(crate::MultitoolCli::try_parse_from(["lime", "exec", "--color", "bright"]).is_err());
    assert!(crate::MultitoolCli::try_parse_from(["lime", "exec", "check", "files"]).is_err());
}

#[test]
fn resume_options_before_and_after_subcommand_use_one_global_contract() {
    for args in [
        vec![
            "lime",
            "exec",
            "--json",
            "--model",
            "model",
            "--provider",
            "provider",
            "-o",
            "answer.txt",
            "resume",
            "session",
            "follow up",
        ],
        vec![
            "lime",
            "exec",
            "resume",
            "session",
            "follow up",
            "--json",
            "--model",
            "model",
            "--provider",
            "provider",
            "-o",
            "answer.txt",
        ],
    ] {
        let args = parse(&args);
        assert!(args.json);
        assert_eq!(
            args.last_message_file.as_deref(),
            Some(std::path::Path::new("answer.txt"))
        );
        assert_eq!(args.connection.model.as_deref(), Some("model"));
        assert_eq!(args.connection.provider.as_deref(), Some("provider"));
        let Some(Command::Resume(resume)) = args.command else {
            panic!("expected resume");
        };
        assert_eq!(resume.session_id.as_deref(), Some("session"));
        assert_eq!(resume.prompt.as_deref(), Some("follow up"));
    }
}

#[test]
fn resume_last_reinterprets_single_positional_and_keeps_explicit_second_prompt() {
    for (positional, id, prompt) in [
        (vec![], None, None),
        (vec!["follow up"], None, Some("follow up")),
        (vec!["id", "follow up"], Some("id"), Some("follow up")),
    ] {
        let mut argv = vec!["lime", "exec", "resume", "--last", "--all"];
        argv.extend(positional);
        let Some(Command::Resume(args)) = parse(&argv).command else {
            panic!("expected resume");
        };
        assert!(args.last && args.all);
        assert_eq!(args.session_id.as_deref(), id);
        assert_eq!(args.prompt.as_deref(), prompt);
    }
    assert_eq!(parse(&["lime", "exec", "-"]).prompt.as_deref(), Some("-"));
    assert!(parse(&["lime", "exec", "--experimental-json", "check"]).json);
}

#[test]
fn resume_permissions_and_transport_do_not_bypass_conflict_checks() {
    let args = parse(&[
        "lime",
        "exec",
        "resume",
        "--last",
        "check",
        "--approve-for-me",
        "--remote",
        "ws://127.0.0.1:1234",
        "--remote-auth-token-env",
        "TOKEN",
    ]);
    let Some(Command::Resume(resume)) = args.command else {
        panic!("expected resume");
    };
    assert!(resume.connection.approve_for_me);
    assert_eq!(
        resume.connection.remote.remote.as_deref(),
        Some("ws://127.0.0.1:1234")
    );
    assert!(crate::MultitoolCli::try_parse_from([
        "lime",
        "exec",
        "resume",
        "--last",
        "check",
        "--approve-for-me",
        "--sandbox",
        "read-only"
    ])
    .is_err());
}

#[test]
fn auto_color_requires_capable_tty_and_explicit_modes_override_environment() {
    for (tty, no_color, term) in [
        (false, false, Some("xterm-256color")),
        (true, true, Some("xterm-256color")),
        (true, false, Some("dumb")),
    ] {
        assert!(!Color::Auto.use_ansi(tty, no_color, term));
        assert!(Color::Always.use_ansi(tty, no_color, term));
        assert!(!Color::Never.use_ansi(tty, no_color, term));
    }
    assert!(Color::Auto.use_ansi(true, false, Some("xterm-256color")));
}

#[test]
fn fork_requires_source_and_keeps_optional_prompt_and_child_overrides() {
    assert!(crate::MultitoolCli::try_parse_from(["lime", "exec", "fork"]).is_err());
    for argv in [
        vec![
            "lime", "exec", "--json", "--model", "model", "fork", "source",
        ],
        vec![
            "lime", "exec", "fork", "source", "--json", "--model", "model",
        ],
    ] {
        let args = parse(&argv);
        assert!(args.json);
        assert_eq!(args.connection.model.as_deref(), Some("model"));
        let Some(Command::Fork(fork)) = args.command else {
            panic!("expected fork")
        };
        assert_eq!(fork.session_id, "source");
        assert_eq!(fork.prompt, None);
    }
    let args = parse(&[
        "lime",
        "exec",
        "--approve-for-me",
        "fork",
        "exact name",
        "-",
        "--sandbox",
        "read-only",
    ]);
    let Some(Command::Fork(mut fork)) = args.command else {
        panic!("expected fork")
    };
    fork.connection.inherit_from(&args.connection);
    assert!(!fork.connection.approve_for_me);
    assert_eq!(
        fork.connection.sandbox_mode,
        Some(crate::SandboxModeCliArg::ReadOnly)
    );
    assert_eq!(fork.prompt.as_deref(), Some("-"));
}

#[test]
fn images_use_single_argument_comma_lists_and_accumulate_across_exec_levels() {
    for command in ["resume", "fork"] {
        let args = parse(&[
            "lime",
            "exec",
            "-i",
            "root-a.png,root-b.png",
            command,
            "source",
            "--image",
            "child-a.png,child-b.png",
            "--image",
            "child-c.png",
            "inspect",
        ]);
        assert_eq!(
            args.images,
            [PathBuf::from("root-a.png"), PathBuf::from("root-b.png")]
        );
        let (images, prompt) = match args.command.unwrap() {
            Command::Resume(args) => (args.images, args.prompt),
            Command::Fork(args) => (args.images, args.prompt),
            Command::Review(_) => panic!("image test expects resume or fork"),
        };
        assert_eq!(
            images,
            [
                PathBuf::from("child-a.png"),
                PathBuf::from("child-b.png"),
                PathBuf::from("child-c.png")
            ]
        );
        assert_eq!(prompt.as_deref(), Some("inspect"));
    }
}

#[test]
fn review_args_match_codex_targets_and_global_output_options() {
    for argv in [
        vec![
            "lime",
            "exec",
            "--json",
            "-o",
            "review.txt",
            "review",
            "--commit",
            "abc",
            "--title",
            "subject",
        ],
        vec![
            "lime",
            "exec",
            "review",
            "--commit",
            "abc",
            "--title",
            "subject",
            "--json",
            "-o",
            "review.txt",
        ],
    ] {
        let args = parse(&argv);
        assert!(args.json);
        assert_eq!(args.last_message_file, Some(PathBuf::from("review.txt")));
        let Some(Command::Review(review)) = args.command else {
            panic!("expected review");
        };
        assert_eq!(review.commit.as_deref(), Some("abc"));
        assert_eq!(review.commit_title.as_deref(), Some("subject"));
    }
    for target in ["--uncommitted", "--base", "--commit"] {
        let mut argv = vec!["lime", "exec", "review", target];
        if target != "--uncommitted" {
            argv.push("reference");
        }
        assert!(matches!(parse(&argv).command, Some(Command::Review(_))));
    }
    let Some(Command::Review(args)) = parse(&["lime", "exec", "review", "-"]).command else {
        panic!("review stdin");
    };
    assert_eq!(args.prompt.as_deref(), Some("-"));
}

#[test]
fn review_targets_conflict_and_title_requires_commit() {
    for tail in [
        vec!["--uncommitted", "--base", "main"],
        vec!["--uncommitted", "--commit", "abc"],
        vec!["--base", "main", "--commit", "abc"],
        vec!["--uncommitted", "custom"],
        vec!["--base", "main", "custom"],
        vec!["--commit", "abc", "custom"],
        vec!["--title", "subject"],
        vec!["--base", "main", "--title", "subject"],
    ] {
        let mut argv = vec!["lime", "exec", "review"];
        argv.extend(tail);
        assert!(
            crate::MultitoolCli::try_parse_from(&argv).is_err(),
            "{argv:?}"
        );
    }
}
