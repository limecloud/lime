//! Normalize shared options once before dispatching a command.

use super::{
    exec, queue_cmd, review_cmd, run, run_agents, run_archive, run_debug_command, run_delete,
    run_execpolicycheck, run_features_command, run_fork, run_interactive_tui, run_resume,
    run_skills, run_thread, run_unarchive, sandbox_setup, DebugSubcommand, ExecpolicyCommand,
    ExecpolicySubcommand, FeaturesSubcommand, MultitoolCli, SkillsSubcommand, Subcommand,
    ThreadSubcommand,
};
use crate::connection::ConnectionArgs;
use clap::CommandFactory;
use clap_complete::generate;
use std::io::{self, Write};
use std::process::ExitCode;

#[cfg(test)]
mod tests;

pub(crate) fn inherit_root_options(cli: &mut MultitoolCli) {
    let Some(command) = cli.subcommand.as_mut() else {
        return;
    };
    let root = &cli.interactive.connection;
    if let Subcommand::Queue(args) = command {
        args.inherit_from(root);
    } else if let Some(connection) = command.connection_mut() {
        connection.inherit_from(root);
    }
    let locale = match command {
        Subcommand::Tui(args) => Some(&mut args.locale),
        Subcommand::Exec(args) => Some(&mut args.locale),
        Subcommand::Agents(args) => Some(&mut args.locale),
        Subcommand::Resume(args) => Some(&mut args.locale),
        _ => None,
    };
    if let Some(locale) = locale {
        if locale.is_none() {
            locale.clone_from(&cli.interactive.locale);
        }
    }
}

impl Subcommand {
    pub(crate) fn connection_mut(&mut self) -> Option<&mut ConnectionArgs> {
        Some(match self {
            Self::Tui(args) => &mut args.connection,
            Self::Exec(args) => &mut args.connection,
            Self::Agents(args) => &mut args.connection,
            Self::Resume(args) => &mut args.connection,
            Self::Review(args) => args.connection_mut(),
            Self::Queue(args) => args.connection_mut(),
            Self::Archive(args) | Self::Unarchive(args) => &mut args.connection,
            Self::Delete(args) => &mut args.connection,
            Self::Fork(args) => &mut args.connection,
            Self::Thread(args) => match &mut args.command {
                ThreadSubcommand::List(args) => &mut args.connection,
                ThreadSubcommand::Show(args) => &mut args.connection,
            },
            Self::Mcp(args) => args.connection_mut(),
            Self::Skills(args) => match &mut args.command {
                SkillsSubcommand::List(args) => &mut args.connection,
            },
            Self::Plugin(args) => args.connection_mut(),
            Self::Debug(args) => match &mut args.subcommand {
                DebugSubcommand::Models(args) => &mut args.connection,
                DebugSubcommand::ClearMemories(args) => &mut args.connection,
            },
            Self::Features(args) => match &mut args.sub {
                FeaturesSubcommand::List(args) => &mut args.connection,
                FeaturesSubcommand::Enable(args) | FeaturesSubcommand::Disable(args) => {
                    &mut args.connection
                }
            },
            Self::AppServer(_) | Self::Sandbox(_) | Self::Execpolicy(_) | Self::Completion(_) => {
                return None
            }
        })
    }
}

pub(crate) async fn run_cli(mut cli: MultitoolCli) -> ExitCode {
    inherit_root_options(&mut cli);
    let root_locale = cli.interactive.locale.clone();
    match cli.subcommand {
        None => run_interactive_tui(cli.interactive).await,
        Some(Subcommand::Tui(args)) => run_interactive_tui(args).await,
        Some(Subcommand::Exec(args)) => exec::run(args).await,
        Some(Subcommand::Agents(args)) => run_agents(args).await,
        Some(Subcommand::Resume(args)) => run_resume(args).await,
        Some(Subcommand::Review(args)) => review_cmd::run_review_command(args, root_locale).await,
        Some(Subcommand::Queue(args)) => queue_cmd::run_queue_command(args).await,
        Some(Subcommand::Archive(args)) => run_archive(args).await,
        Some(Subcommand::Delete(args)) => run_delete(args).await,
        Some(Subcommand::Unarchive(args)) => run_unarchive(args).await,
        Some(Subcommand::Fork(args)) => run_fork(args).await,
        Some(Subcommand::Thread(args)) => run_thread(args).await,
        Some(Subcommand::Mcp(args)) => args.run().await,
        Some(Subcommand::Skills(args)) => run_skills(args).await,
        Some(Subcommand::Plugin(args)) => args.run().await,
        Some(Subcommand::AppServer(args)) => run(args),
        Some(Subcommand::Debug(args)) => run_debug_command(args).await,
        Some(Subcommand::Features(args)) => run_features_command(args).await,
        Some(Subcommand::Sandbox(sandbox_cli)) => {
            let setup_command = sandbox_setup::parse_setup_command(&sandbox_cli.command);
            let result = match setup_command {
                Ok(Some(setup_cli)) => {
                    sandbox_setup::run(setup_cli, sandbox_cli.config_profile.clone())
                        .await
                        .map(|()| ExitCode::SUCCESS)
                }
                Ok(None) => {
                    #[cfg(target_os = "macos")]
                    let result = cli::run_command_under_seatbelt(sandbox_cli).await;
                    #[cfg(target_os = "linux")]
                    let result = cli::run_command_under_landlock(sandbox_cli).await;
                    #[cfg(target_os = "windows")]
                    let result = cli::run_command_under_windows_sandbox(sandbox_cli).await;
                    #[cfg(not(any(
                        target_os = "macos",
                        target_os = "linux",
                        target_os = "windows"
                    )))]
                    let result: anyhow::Result<ExitCode> = {
                        let _ = sandbox_cli.command;
                        Err(anyhow::anyhow!(
                            "`lime sandbox` is not supported on this operating system"
                        ))
                    };
                    result
                }
                Err(error) => Err(error),
            };

            match result {
                Ok(exit_code) => exit_code,
                Err(error) => {
                    eprintln!("{error:#}");
                    ExitCode::FAILURE
                }
            }
        }
        Some(Subcommand::Execpolicy(ExecpolicyCommand { sub })) => match sub {
            ExecpolicySubcommand::Check(command) => run_execpolicycheck(command),
        },
        Some(Subcommand::Completion(args)) => {
            let mut command = MultitoolCli::command();
            let mut output = io::stdout();
            generate(args.shell, &mut command, "lime", &mut output);
            let _ = output.flush();
            ExitCode::SUCCESS
        }
    }
}
