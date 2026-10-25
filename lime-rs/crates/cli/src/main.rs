mod connection;
mod dispatch;
mod exec;
mod marketplace_cmd;
mod mcp_cmd;
mod plugin_cmd;
mod queue_cmd;
mod review_cmd;
mod sandbox_setup;
#[cfg(not(windows))]
mod wsl_paths;

use std::collections::{BTreeMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::future::Future;
use std::io;
use std::path::PathBuf;
use std::process::{Command, ExitCode};

use anyhow::{bail, Context, Result};
use app_server_client::{ClientSession, RemoteTransportConfig, StdioTransportConfig};
use app_server_protocol::protocol::v2::{
    ExperimentalFeature, ExperimentalFeatureEnablementSetParams,
    ExperimentalFeatureEnablementSetResponse, ExperimentalFeatureListParams,
    ExperimentalFeatureListResponse, ExperimentalFeatureStage, MemoryResetResponse, Model,
    ModelListParams, ModelListResponse, SkillsListParams, SkillsListResponse, ThreadArchiveParams,
    ThreadArchiveResponse, ThreadDeleteParams, ThreadDeleteResponse, ThreadForkParams,
    ThreadForkResponse, ThreadListParams, ThreadListResponse, ThreadReadParams, ThreadReadResponse,
    ThreadUnarchiveParams, ThreadUnarchiveResponse, METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET,
    METHOD_EXPERIMENTAL_FEATURE_LIST, METHOD_MEMORY_RESET, METHOD_MODEL_LIST, METHOD_SKILLS_LIST,
    METHOD_THREAD_ARCHIVE, METHOD_THREAD_DELETE, METHOD_THREAD_FORK, METHOD_THREAD_LIST,
    METHOD_THREAD_READ, METHOD_THREAD_UNARCHIVE,
};
use app_server_protocol::{ClientCapabilities, ClientInfo, InitializeParams};
use clap::{Args, Parser, Subcommand as ClapSubcommand};
use clap_complete::Shell;
use connection::{permission_settings, ConnectionArgs};
use exec::cli::ExecCli;
use execpolicy::ExecPolicyCheckCommand;
use tui::TuiOptions;

const APP_SERVER_BIN_ENV: &str = "LIME_APP_SERVER_BIN";

#[derive(Debug, Args)]
pub(crate) struct TuiCli {
    #[command(flatten)]
    connection: ConnectionArgs,
    #[arg(long, value_name = "LOCALE")]
    locale: Option<String>,
}

#[derive(Debug, Args)]
pub(crate) struct ResumeCommand {
    /// 要恢复的 canonical Thread id。
    thread_id: Option<String>,
    #[command(flatten)]
    connection: ConnectionArgs,
    #[arg(long, value_name = "LOCALE")]
    locale: Option<String>,
}

#[derive(Debug, Args)]
pub(crate) struct ThreadCommand {
    #[command(subcommand)]
    command: ThreadSubcommand,
}

#[derive(Debug, Args)]
pub(crate) struct SkillsCli {
    #[command(subcommand)]
    command: SkillsSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum SkillsSubcommand {
    /// 读取 current executable Skill catalog。
    List(SkillsListArgs),
}

#[derive(Debug, Args)]
struct SkillsListArgs {
    #[arg(long = "skill-cwd", visible_alias = "cwds", value_name = "DIR")]
    skill_cwds: Vec<PathBuf>,
    #[arg(long)]
    force_reload: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, clap::Subcommand)]
enum ThreadSubcommand {
    /// 列出当前 App Server 可见的 Thread。
    List(ThreadListArgs),
    /// 读取一个 Thread 的 canonical metadata，可选完整 turns。
    Show(ThreadReadArgs),
}

#[derive(Debug, Args)]
struct ThreadListArgs {
    #[arg(long)]
    limit: Option<u32>,
    #[arg(long)]
    search: Option<String>,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct ThreadReadArgs {
    thread_id: String,
    #[arg(long)]
    include_turns: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
pub(crate) struct SessionArchiveCommand {
    thread_id: String,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
pub(crate) struct DeleteCommand {
    thread_id: String,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
pub(crate) struct ForkCommand {
    thread_id: String,
    #[arg(long)]
    last_turn_id: Option<String>,
    #[arg(long)]
    before_turn_id: Option<String>,
    #[arg(long)]
    exclude_turns: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

impl Default for TuiCli {
    fn default() -> Self {
        Self {
            connection: ConnectionArgs::default(),
            locale: None,
        }
    }
}

pub(crate) async fn run_interactive_tui(args: TuiCli) -> ExitCode {
    let options = match tui_options(args.connection, None, args.locale) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error:#}");
            return ExitCode::FAILURE;
        }
    };
    match tui::run_tui(options).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

pub(crate) async fn run_resume(args: ResumeCommand) -> ExitCode {
    let options = match tui_options(args.connection, args.thread_id, args.locale) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error:#}");
            return ExitCode::FAILURE;
        }
    };
    match tui::run_resume(options).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

pub(crate) async fn run_thread(command: ThreadCommand) -> ExitCode {
    report_json_result(run_thread_request(command).await)
}

fn report_json_result(result: Result<serde_json::Value>) -> ExitCode {
    match result {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

pub(crate) async fn run_archive(args: SessionArchiveCommand) -> ExitCode {
    run_thread_operation(
        args.connection,
        METHOD_THREAD_ARCHIVE,
        ThreadArchiveParams {
            thread_id: args.thread_id,
        },
    )
    .await
}

pub(crate) async fn run_unarchive(args: SessionArchiveCommand) -> ExitCode {
    run_thread_operation(
        args.connection,
        METHOD_THREAD_UNARCHIVE,
        ThreadUnarchiveParams {
            thread_id: args.thread_id,
        },
    )
    .await
}

pub(crate) async fn run_delete(args: DeleteCommand) -> ExitCode {
    run_thread_operation(
        args.connection,
        METHOD_THREAD_DELETE,
        ThreadDeleteParams {
            thread_id: args.thread_id,
        },
    )
    .await
}

pub(crate) async fn run_fork(args: ForkCommand) -> ExitCode {
    run_thread_operation(
        args.connection,
        METHOD_THREAD_FORK,
        ThreadForkParams {
            thread_id: args.thread_id,
            last_turn_id: args.last_turn_id,
            before_turn_id: args.before_turn_id,
            exclude_turns: args.exclude_turns,
            ..ThreadForkParams::default()
        },
    )
    .await
}

async fn run_thread_operation(
    connection: ConnectionArgs,
    method: &str,
    params: impl serde::Serialize,
) -> ExitCode {
    let result = match serde_json::to_value(params) {
        Ok(params) => request_thread_value(&connection, method, params).await,
        Err(error) => Err(error.into()),
    };
    report_json_result(result)
}

pub(crate) async fn run_skills(command: SkillsCli) -> ExitCode {
    let result = run_skills_request(command).await;
    match result {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

pub(crate) async fn run_skills_request(command: SkillsCli) -> Result<serde_json::Value> {
    let SkillsSubcommand::List(args) = command.command;
    let cwd = if args.skill_cwds.is_empty() {
        vec![args
            .connection
            .cwd
            .clone()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))]
    } else {
        args.skill_cwds
    };
    let session = start_session(&args.connection).await?;
    let request_handle = session.request_handle();
    let response: Result<SkillsListResponse, _> = request_handle
        .request(
            METHOD_SKILLS_LIST,
            SkillsListParams {
                cwds: cwd,
                force_reload: args.force_reload,
            },
        )
        .await;
    let shutdown = session.shutdown().await;
    let response = response?;
    shutdown?;
    Ok(serde_json::to_value(response)?)
}

async fn run_thread_request(command: ThreadCommand) -> Result<serde_json::Value> {
    let (connection, method, params) = match command.command {
        ThreadSubcommand::List(args) => (
            args.connection,
            METHOD_THREAD_LIST,
            serde_json::to_value(ThreadListParams {
                limit: args.limit,
                search_term: args.search,
                ..ThreadListParams::default()
            })?,
        ),
        ThreadSubcommand::Show(args) => (
            args.connection,
            METHOD_THREAD_READ,
            serde_json::to_value(ThreadReadParams {
                thread_id: args.thread_id,
                include_turns: args.include_turns,
            })?,
        ),
    };

    request_thread_value(&connection, method, params).await
}

async fn request_thread_value(
    connection: &ConnectionArgs,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let value = request_value(connection, method, params).await?;

    // Deserialize known responses here so a server drift cannot silently become
    // an untyped CLI success envelope.
    let value = match method {
        METHOD_THREAD_LIST => {
            serde_json::to_value(serde_json::from_value::<ThreadListResponse>(value)?)?
        }
        METHOD_THREAD_READ => {
            serde_json::to_value(serde_json::from_value::<ThreadReadResponse>(value)?)?
        }
        METHOD_THREAD_ARCHIVE => {
            serde_json::to_value(serde_json::from_value::<ThreadArchiveResponse>(value)?)?
        }
        METHOD_THREAD_UNARCHIVE => {
            serde_json::to_value(serde_json::from_value::<ThreadUnarchiveResponse>(value)?)?
        }
        METHOD_THREAD_DELETE => {
            serde_json::to_value(serde_json::from_value::<ThreadDeleteResponse>(value)?)?
        }
        METHOD_THREAD_FORK => {
            serde_json::to_value(serde_json::from_value::<ThreadForkResponse>(value)?)?
        }
        _ => unreachable!("thread method is exhaustive"),
    };
    Ok(value)
}

pub(crate) async fn request_value(
    connection: &ConnectionArgs,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let session = start_session(connection).await?;
    let response = session.request_handle().request_value(method, params).await;
    let shutdown = session.shutdown().await;
    let response = response?;
    shutdown?;
    Ok(response)
}

pub(crate) async fn start_session(connection: &ConnectionArgs) -> Result<ClientSession> {
    if let Some(config) = resolve_remote_endpoint(connection)? {
        return Ok(ClientSession::start_remote(config, cli_initialize_params()).await?);
    }
    Ok(
        ClientSession::start_stdio(thread_stdio_config(connection), cli_initialize_params())
            .await?,
    )
}

fn resolve_remote_endpoint(connection: &ConnectionArgs) -> Result<Option<RemoteTransportConfig>> {
    let Some(remote) = connection.remote.remote.clone() else {
        if connection.remote.remote_auth_token_env.is_some() {
            bail!("`--remote-auth-token-env` requires `--remote`.");
        }
        return Ok(None);
    };

    if connection.app_server.is_some() || !connection.app_server_args.is_empty() {
        bail!("`--remote` cannot be combined with `--app-server` or `--app-server-arg`.");
    }

    let auth_token = connection
        .remote
        .remote_auth_token_env
        .as_deref()
        .map(read_remote_auth_token_from_env_var)
        .transpose()?;
    Ok(Some(
        RemoteTransportConfig::new(remote).with_optional_auth_token(auth_token),
    ))
}

fn read_remote_auth_token_from_env_var_with<F>(env_var_name: &str, get_var: F) -> Result<String>
where
    F: FnOnce(&str) -> std::result::Result<String, env::VarError>,
{
    let auth_token = get_var(env_var_name)
        .with_context(|| format!("environment variable `{env_var_name}` is not set"))?;
    let auth_token = auth_token.trim().to_string();
    if auth_token.is_empty() {
        bail!("environment variable `{env_var_name}` is empty");
    }
    Ok(auth_token)
}

fn read_remote_auth_token_from_env_var(env_var_name: &str) -> Result<String> {
    read_remote_auth_token_from_env_var_with(env_var_name, |name| env::var(name))
}

pub(crate) fn thread_stdio_config(connection: &ConnectionArgs) -> StdioTransportConfig {
    let mut config =
        StdioTransportConfig::runtime(resolve_app_server_bin(connection.app_server.clone()));
    config
        .args
        .extend(connection.app_server_args.iter().cloned());
    config
}

pub(crate) fn cli_initialize_params() -> InitializeParams {
    InitializeParams {
        client_info: ClientInfo {
            name: "lime".to_string(),
            title: Some("Lime CLI".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
        capabilities: ClientCapabilities {
            event_methods: Vec::new(),
            experimental_api: true,
            opt_out_notification_methods: None,
        },
    }
}

fn tui_options(
    args: ConnectionArgs,
    resume_thread: Option<String>,
    locale: Option<String>,
) -> Result<TuiOptions> {
    let remote = resolve_remote_endpoint(&args)?;
    let permission_settings = permission_settings(&args)?;
    let cwd = args.workspace_cwd()?;
    Ok(TuiOptions {
        computer_use_targets: args.computer_use_targets,
        app_server_bin: resolve_app_server_bin(args.app_server),
        app_server_args: args.app_server_args,
        remote,
        cwd,
        model: args.model,
        model_provider: args.provider,
        reasoning_effort: args.effort,
        permissions: args.permissions,
        approval_policy: permission_settings.approval_policy,
        approvals_reviewer: permission_settings.approvals_reviewer,
        sandbox_policy: permission_settings.sandbox_policy,
        locale,
        resume_thread,
    })
}

pub(crate) fn resolve_app_server_bin(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(path) = explicit {
        #[cfg(not(windows))]
        {
            return PathBuf::from(wsl_paths::normalize_for_wsl(path));
        }
        #[cfg(windows)]
        {
            return path;
        }
    }
    if let Some(path) = env::var_os(APP_SERVER_BIN_ENV).filter(|value| !value.is_empty()) {
        #[cfg(not(windows))]
        {
            return PathBuf::from(wsl_paths::normalize_for_wsl(path));
        }
        #[cfg(windows)]
        {
            return PathBuf::from(path);
        }
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let sibling = parent.join(if cfg!(windows) {
                "app-server.exe"
            } else {
                "app-server"
            });
            if sibling.is_file() {
                return sibling;
            }
        }
    }
    PathBuf::from(if cfg!(windows) {
        "app-server.exe"
    } else {
        "app-server"
    })
}

#[derive(Debug, Args)]
#[command(disable_help_flag = true)]
pub(crate) struct AppServerCommand {
    /// Override the sibling app-server binary. Intended for packaging and tests.
    #[arg(long = "app-server-bin", value_name = "PATH", hide = true)]
    app_server_bin: Option<PathBuf>,

    /// Arguments forwarded unchanged to app-server.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    args: Vec<OsString>,
}

pub(crate) fn run(command: AppServerCommand) -> ExitCode {
    let app_server_bin = resolve_app_server_bin(command.app_server_bin);
    let mut child = Command::new(app_server_bin);
    child.args(command.args);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        let error = child.exec();
        eprintln!("failed to start app-server: {error}");
        ExitCode::FAILURE
    }

    #[cfg(not(unix))]
    {
        match child.status() {
            Ok(status) if status.success() => ExitCode::SUCCESS,
            Ok(status) => ExitCode::from(
                status
                    .code()
                    .and_then(|code| u8::try_from(code).ok())
                    .unwrap_or(1),
            ),
            Err(error) => {
                eprintln!("failed to start app-server: {error}");
                ExitCode::FAILURE
            }
        }
    }
}

#[derive(Debug, Args)]
pub(crate) struct DebugCommand {
    #[command(subcommand)]
    subcommand: DebugSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum DebugSubcommand {
    /// Render the current App Server model catalog as JSON.
    Models(DebugModelsCommand),
    /// Reset global memory state through App Server.
    #[command(hide = true)]
    ClearMemories(DebugClearMemoriesCommand),
}

#[derive(Debug, Args)]
struct DebugModelsCommand {
    /// Include hidden models from the App Server catalog.
    #[arg(long)]
    bundled: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct DebugClearMemoriesCommand {
    #[command(flatten)]
    connection: ConnectionArgs,
}

pub(crate) async fn run_debug_command(command: DebugCommand) -> ExitCode {
    match run_inner(command).await {
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

async fn run_inner(command: DebugCommand) -> Result<String> {
    match command.subcommand {
        DebugSubcommand::Models(args) => run_debug_models_command(args).await,
        DebugSubcommand::ClearMemories(args) => run_debug_clear_memories_command(args).await,
    }
}

async fn run_debug_models_command(command: DebugModelsCommand) -> Result<String> {
    let models = list_models(&command.connection, command.bundled).await?;
    Ok(serde_json::to_string_pretty(
        &serde_json::json!({ "models": models }),
    )?)
}

async fn run_debug_clear_memories_command(command: DebugClearMemoriesCommand) -> Result<String> {
    let response = request_value(
        &command.connection,
        METHOD_MEMORY_RESET,
        serde_json::Value::Null,
    )
    .await?;
    let _: MemoryResetResponse = serde_json::from_value(response)?;
    Ok("Cleared memory state.".to_string())
}

async fn list_models(connection: &ConnectionArgs, include_hidden: bool) -> Result<Vec<Model>> {
    let mut cursor = None;
    let mut models = Vec::new();
    let mut seen_cursors = HashSet::new();
    for _ in 0..256 {
        let response = request_value(
            connection,
            METHOD_MODEL_LIST,
            serde_json::to_value(ModelListParams {
                cursor,
                limit: None,
                include_hidden: Some(include_hidden),
            })?,
        )
        .await?;
        let response: ModelListResponse = serde_json::from_value(response)?;
        models.extend(response.data);
        let Some(next_cursor) = response.next_cursor else {
            return Ok(models);
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            bail!("model pagination repeated cursor {next_cursor}");
        }
        cursor = Some(next_cursor);
    }
    bail!("model pagination exceeded 256 pages")
}

#[derive(Debug, Args)]
pub(crate) struct FeaturesCli {
    #[command(subcommand)]
    sub: FeaturesSubcommand,
}

#[derive(Debug, clap::Subcommand)]
enum FeaturesSubcommand {
    /// List known features with their stage and effective state.
    List(FeatureListArgs),
    /// Enable a feature in the current Lime configuration.
    Enable(FeatureSetArgs),
    /// Disable a feature in the current Lime configuration.
    Disable(FeatureSetArgs),
}

#[derive(Debug, Args)]
struct FeatureListArgs {
    /// Emit the complete typed response as JSON.
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    connection: ConnectionArgs,
}

#[derive(Debug, Args)]
struct FeatureSetArgs {
    /// Feature key to update.
    feature: String,
    #[command(flatten)]
    connection: ConnectionArgs,
}

pub(crate) async fn run_features_command(command: FeaturesCli) -> ExitCode {
    match run_features_inner(command).await {
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

async fn run_features_inner(command: FeaturesCli) -> Result<String> {
    match command.sub {
        FeaturesSubcommand::List(args) => {
            let features = list_features(&args.connection).await?;
            if args.json {
                return Ok(serde_json::to_string_pretty(&serde_json::json!({
                    "data": features,
                    "nextCursor": null,
                }))?);
            }
            Ok(render_features(features))
        }
        FeaturesSubcommand::Enable(args) => set_feature(args, true).await,
        FeaturesSubcommand::Disable(args) => set_feature(args, false).await,
    }
}

async fn set_feature(args: FeatureSetArgs, enabled: bool) -> Result<String> {
    let features = list_features(&args.connection).await?;
    let Some(feature) = features.iter().find(|feature| feature.name == args.feature) else {
        bail!("Unknown feature flag: {}", args.feature);
    };
    let stage = feature.stage;
    let feature_name = feature.name.clone();
    let response = request_value(
        &args.connection,
        METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET,
        serde_json::to_value(ExperimentalFeatureEnablementSetParams {
            enablement: BTreeMap::from([(feature_name.clone(), enabled)]),
        })?,
    )
    .await?;
    let response: ExperimentalFeatureEnablementSetResponse = serde_json::from_value(response)?;
    if response.enablement.get(&feature_name) != Some(&enabled) {
        bail!("App Server did not apply feature flag: {feature_name}");
    }
    if enabled && stage == ExperimentalFeatureStage::UnderDevelopment {
        eprintln!("Under-development features enabled: {feature_name}.");
    }
    Ok(format!(
        "{} feature `{feature_name}`.",
        if enabled { "Enabled" } else { "Disabled" }
    ))
}

async fn list_features(connection: &ConnectionArgs) -> Result<Vec<ExperimentalFeature>> {
    let mut cursor = None;
    let mut features = Vec::new();
    let mut seen_cursors = HashSet::new();
    for _ in 0..256 {
        let response = request_value(
            connection,
            METHOD_EXPERIMENTAL_FEATURE_LIST,
            serde_json::to_value(ExperimentalFeatureListParams {
                cursor,
                limit: None,
                thread_id: None,
            })?,
        )
        .await?;
        let response: ExperimentalFeatureListResponse = serde_json::from_value(response)?;
        features.extend(response.data);
        let Some(next_cursor) = response.next_cursor else {
            features.sort_by(|left, right| left.name.cmp(&right.name));
            return Ok(features);
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            bail!("feature pagination repeated cursor {next_cursor}");
        }
        cursor = Some(next_cursor);
    }
    bail!("feature pagination exceeded 256 pages")
}

fn render_features(features: Vec<ExperimentalFeature>) -> String {
    let name_width = features
        .iter()
        .map(|feature| feature.name.len())
        .max()
        .unwrap_or_default();
    features
        .into_iter()
        .map(|feature| {
            format!(
                "{:<name_width$}  {:<17}  {}",
                feature.name,
                stage_str(feature.stage),
                feature.enabled,
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn stage_str(stage: ExperimentalFeatureStage) -> &'static str {
    match stage {
        ExperimentalFeatureStage::Beta => "beta",
        ExperimentalFeatureStage::UnderDevelopment => "under development",
        ExperimentalFeatureStage::Stable => "stable",
        ExperimentalFeatureStage::Deprecated => "deprecated",
        ExperimentalFeatureStage::Removed => "removed",
    }
}

/// Lime CLI
///
/// If no subcommand is specified, options are forwarded to the interactive TUI.
#[derive(Debug, Parser)]
#[command(
    name = "lime",
    version,
    about = "Lime CLI",
    subcommand_negates_reqs = true,
    override_usage = "lime [OPTIONS]\n       lime [OPTIONS] <COMMAND> [ARGS]"
)]
struct MultitoolCli {
    #[command(flatten)]
    interactive: TuiCli,

    #[command(subcommand)]
    subcommand: Option<Subcommand>,
}

#[derive(Debug, Parser)]
struct ExecpolicyCommand {
    #[command(subcommand)]
    sub: ExecpolicySubcommand,
}

#[derive(Debug, ClapSubcommand)]
enum ExecpolicySubcommand {
    /// Check execpolicy files against a command.
    #[command(name = "check")]
    Check(ExecPolicyCheckCommand),
}

#[derive(Debug, ClapSubcommand)]
enum Subcommand {
    /// Start the interactive TUI.
    Tui(TuiCli),

    /// Run Lime non-interactively.
    #[command(visible_alias = "e")]
    Exec(ExecCli),

    /// Run a code review non-interactively.
    Review(review_cmd::ReviewCommand),

    /// Resume a previous interactive thread.
    Resume(ResumeCommand),

    /// Queue a message for an existing Thread.
    Queue(queue_cmd::QueueCommand),

    /// Archive a saved Thread by id.
    Archive(SessionArchiveCommand),

    /// Permanently delete a saved Thread by id.
    Delete(DeleteCommand),

    /// Unarchive a saved Thread by id.
    Unarchive(SessionArchiveCommand),

    /// Fork a saved Thread by id.
    Fork(ForkCommand),

    /// Manage canonical threads through App Server.
    Thread(ThreadCommand),

    /// Inspect MCP server status through App Server.
    Mcp(mcp_cmd::McpCli),

    /// Inspect executable skills through App Server.
    Skills(SkillsCli),

    /// Manage plugins through App Server.
    Plugin(plugin_cmd::PluginCli),

    /// Start the sibling App Server with forwarded arguments.
    #[command(name = "app-server")]
    AppServer(AppServerCommand),

    /// Debug current App Server state.
    Debug(DebugCommand),

    /// Inspect and update experimental features.
    Features(FeaturesCli),

    /// Run commands within the host sandbox.
    Sandbox(HostSandboxArgs),

    /// Check execpolicy files against a command.
    #[command(name = "execpolicy")]
    Execpolicy(ExecpolicyCommand),

    /// Generate shell completion for the canonical `lime` command tree.
    Completion(CompletionCommand),
}

#[derive(Debug, clap::Args)]
struct CompletionCommand {
    #[arg(value_enum)]
    shell: Shell,
}

fn main() -> ExitCode {
    let cli = MultitoolCli::parse();
    run_async(dispatch::run_cli(cli))
}

#[cfg(target_os = "macos")]
type HostSandboxArgs = cli::SeatbeltCommand;
#[cfg(target_os = "linux")]
type HostSandboxArgs = cli::LandlockCommand;
#[cfg(target_os = "windows")]
type HostSandboxArgs = cli::WindowsCommand;

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
#[derive(Debug, clap::Args)]
struct HostSandboxArgs {
    #[arg(trailing_var_arg = true, required = true)]
    command: Vec<String>,
}

fn run_async(future: impl Future<Output = ExitCode>) -> ExitCode {
    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime.block_on(future),
        Err(error) => {
            let error = io::Error::other(format!("failed to initialize CLI runtime: {error}"));
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run_execpolicycheck(command: ExecPolicyCheckCommand) -> ExitCode {
    match command.run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod command_tests;
