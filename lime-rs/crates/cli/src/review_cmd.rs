//! The top-level review command uses the same non-interactive execution surface as exec review.

use std::process::ExitCode;

use clap::Args;

use crate::exec::cli::{Command, ExecCli, ReviewArgs};
use crate::ConnectionArgs;

#[derive(Debug, Args)]
pub(crate) struct ReviewCommand {
    #[command(flatten)]
    args: ReviewArgs,
}

pub(crate) async fn run_review_command(
    command: ReviewCommand,
    root_connection: ConnectionArgs,
    root_locale: Option<String>,
) -> ExitCode {
    let mut exec_cli = ExecCli {
        command: Some(Command::Review(command.args)),
        locale: root_locale,
        ..ExecCli::default()
    };
    exec_cli.connection.inherit_from(&root_connection);
    crate::exec::run(exec_cli).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MultitoolCli, Subcommand};
    use clap::Parser;

    #[test]
    fn top_level_review_uses_the_same_target_contract() {
        for target in [
            vec!["--uncommitted"],
            vec!["--base", "main"],
            vec!["--commit", "abc", "--title", "检查"],
            vec!["检查错误处理"],
            vec!["-"],
        ] {
            let mut argv = vec!["lime", "review"];
            argv.extend(target);
            let cli = MultitoolCli::try_parse_from(argv).unwrap();
            assert!(matches!(cli.subcommand, Some(Subcommand::Review(_))));
        }
    }

    #[test]
    fn top_level_review_rejects_conflicting_targets_and_exec_only_output_options() {
        for options in [
            vec!["--uncommitted", "--base", "main"],
            vec!["--base", "main", "--title", "title"],
            vec!["--title", "title"],
            vec!["--commit", "abc", "instructions"],
            vec!["--uncommitted", "--json"],
            vec!["--uncommitted", "-o", "answer.txt"],
        ] {
            let mut argv = vec!["lime", "review"];
            argv.extend(options);
            assert!(MultitoolCli::try_parse_from(argv).is_err());
        }
    }

    #[test]
    fn top_level_review_preserves_root_options_and_uses_human_output_defaults() {
        let cli = MultitoolCli::try_parse_from([
            "lime",
            "--locale",
            "zh-CN",
            "--model",
            "root-model",
            "--provider",
            "root-provider",
            "review",
            "--uncommitted",
            "--model",
            "child-model",
            "--cd",
            "/tmp/review",
        ])
        .unwrap();
        assert_eq!(cli.interactive.locale.as_deref(), Some("zh-CN"));
        assert_eq!(
            cli.interactive.connection.model.as_deref(),
            Some("root-model")
        );
        let Some(Subcommand::Review(_)) = cli.subcommand else {
            panic!("expected review")
        };
        let exec_defaults = ExecCli::default();
        assert!(!exec_defaults.json);
        assert_eq!(exec_defaults.color, crate::exec::cli::Color::Auto);
        assert!(exec_defaults.last_message_file.is_none());
    }
}
