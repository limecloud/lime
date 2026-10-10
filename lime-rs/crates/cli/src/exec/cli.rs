use std::path::PathBuf;

use clap::{Args, FromArgMatches, ValueEnum};

use crate::ConnectionArgs;

#[derive(Debug, Default, Args)]
pub(crate) struct ExecCli {
    #[command(subcommand)]
    pub(crate) command: Option<Command>,
    #[arg(value_name = "PROMPT")]
    pub(crate) prompt: Option<String>,
    #[arg(
        long = "image",
        short = 'i',
        value_name = "FILE",
        value_delimiter = ',',
        num_args = 1
    )]
    pub(crate) images: Vec<PathBuf>,
    /// Path to a JSON Schema file describing the model's final response shape.
    #[arg(long = "output-schema", value_name = "FILE", global = true)]
    pub(crate) output_schema: Option<PathBuf>,
    /// Print events to stdout as JSONL.
    #[arg(long, alias = "experimental-json", global = true)]
    pub(crate) json: bool,
    /// Specifies color settings for human-readable output.
    #[arg(long, value_enum, default_value_t = Color::Auto, global = true)]
    pub(crate) color: Color,
    #[arg(long, value_name = "LOCALE", global = true)]
    pub(crate) locale: Option<String>,
    /// Write the last successful agent message to this file.
    #[arg(
        long = "output-last-message",
        short = 'o',
        value_name = "FILE",
        global = true
    )]
    pub(crate) last_message_file: Option<PathBuf>,
    #[command(flatten)]
    pub(crate) connection: ExecSharedCliOptions,
}

#[derive(Debug, clap::Subcommand)]
pub(crate) enum Command {
    /// Resume a previous session by id or pick the most recent with --last.
    Resume(ResumeArgs),
    /// Fork a previous session by id into a new session.
    Fork(ForkArgs),
    /// Run a code review against the current repository.
    Review(ReviewArgs),
}

#[derive(Debug, Default, Args)]
pub(crate) struct ReviewArgs {
    #[command(flatten)]
    pub(super) connection: ConnectionArgs,
    /// Review staged, unstaged, and untracked changes.
    #[arg(long, conflicts_with_all = ["base", "commit", "prompt"])]
    pub(super) uncommitted: bool,
    /// Review changes against the given base branch.
    #[arg(long, value_name = "BRANCH", conflicts_with_all = ["uncommitted", "commit", "prompt"])]
    pub(super) base: Option<String>,
    /// Review the changes introduced by a commit.
    #[arg(long, value_name = "SHA", conflicts_with_all = ["uncommitted", "base", "prompt"])]
    pub(super) commit: Option<String>,
    /// Optional commit title to display in the review summary.
    #[arg(long = "title", value_name = "TITLE", requires = "commit", conflicts_with_all = ["uncommitted", "base", "prompt"])]
    pub(super) commit_title: Option<String>,
    /// Custom review instructions; use '-' to read from stdin.
    #[arg(value_name = "PROMPT")]
    pub(super) prompt: Option<String>,
}

#[derive(Debug, Args)]
pub(crate) struct ForkArgs {
    #[command(flatten)]
    pub(super) connection: ConnectionArgs,
    #[arg(value_name = "SESSION_ID")]
    pub(super) session_id: String,
    #[arg(
        long = "image",
        short = 'i',
        value_name = "FILE",
        value_delimiter = ',',
        num_args = 1
    )]
    pub(super) images: Vec<PathBuf>,
    #[arg(value_name = "PROMPT")]
    pub(super) prompt: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct ExecSharedCliOptions(ConnectionArgs);

impl ExecSharedCliOptions {
    pub(crate) fn into_inner(self) -> ConnectionArgs {
        self.0
    }
}

impl std::ops::Deref for ExecSharedCliOptions {
    type Target = ConnectionArgs;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for ExecSharedCliOptions {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Args for ExecSharedCliOptions {
    fn augment_args(cmd: clap::Command) -> clap::Command {
        mark_exec_global_args(ConnectionArgs::augment_args(cmd))
    }
    fn augment_args_for_update(cmd: clap::Command) -> clap::Command {
        mark_exec_global_args(ConnectionArgs::augment_args_for_update(cmd))
    }
}

impl FromArgMatches for ExecSharedCliOptions {
    fn from_arg_matches(matches: &clap::ArgMatches) -> Result<Self, clap::Error> {
        ConnectionArgs::from_arg_matches(matches).map(Self)
    }
    fn update_from_arg_matches(&mut self, matches: &clap::ArgMatches) -> Result<(), clap::Error> {
        self.0.update_from_arg_matches(matches)
    }
}

fn mark_exec_global_args(cmd: clap::Command) -> clap::Command {
    // Permission groups keep explicit child overrides; globalizing their bools loses that boundary.
    cmd.mut_arg("model", |arg| arg.global(true))
        .mut_arg("provider", |arg| arg.global(true))
}

#[derive(Debug, Args)]
struct ResumeArgsRaw {
    #[command(flatten)]
    connection: ConnectionArgs,
    #[arg(value_name = "SESSION_ID")]
    session_id: Option<String>,
    #[arg(long)]
    last: bool,
    #[arg(long)]
    all: bool,
    #[arg(value_name = "PROMPT")]
    prompt: Option<String>,
    #[arg(
        long = "image",
        short = 'i',
        value_name = "FILE",
        value_delimiter = ',',
        num_args = 1
    )]
    images: Vec<PathBuf>,
}

#[derive(Debug, Default)]
pub(crate) struct ResumeArgs {
    pub(super) connection: ConnectionArgs,
    pub(super) session_id: Option<String>,
    pub(super) last: bool,
    pub(super) all: bool,
    pub(super) prompt: Option<String>,
    pub(super) images: Vec<PathBuf>,
}

impl From<ResumeArgsRaw> for ResumeArgs {
    fn from(raw: ResumeArgsRaw) -> Self {
        let (session_id, prompt) = if raw.last && raw.prompt.is_none() {
            (None, raw.session_id)
        } else {
            (raw.session_id, raw.prompt)
        };
        Self {
            connection: raw.connection,
            session_id,
            last: raw.last,
            all: raw.all,
            prompt,
            images: raw.images,
        }
    }
}

impl Args for ResumeArgs {
    fn augment_args(cmd: clap::Command) -> clap::Command {
        ResumeArgsRaw::augment_args(cmd)
    }
    fn augment_args_for_update(cmd: clap::Command) -> clap::Command {
        ResumeArgsRaw::augment_args_for_update(cmd)
    }
}

impl FromArgMatches for ResumeArgs {
    fn from_arg_matches(matches: &clap::ArgMatches) -> Result<Self, clap::Error> {
        ResumeArgsRaw::from_arg_matches(matches).map(Self::from)
    }
    fn update_from_arg_matches(&mut self, matches: &clap::ArgMatches) -> Result<(), clap::Error> {
        *self = Self::from_arg_matches(matches)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, ValueEnum)]
pub(crate) enum Color {
    Always,
    Never,
    #[default]
    Auto,
}

impl Color {
    pub(super) fn use_ansi(self, is_terminal: bool, no_color: bool, term: Option<&str>) -> bool {
        match self {
            Self::Always => true,
            Self::Never => false,
            Self::Auto => is_terminal && !no_color && term != Some("dumb"),
        }
    }
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
