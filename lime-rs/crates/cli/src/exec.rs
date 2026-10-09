//! Non-interactive product surface over the shared App Server transport and canonical events.

pub(crate) mod cli;
mod event_processor;
mod event_processor_with_human_output;
mod event_processor_with_jsonl_output;
mod exec_events;
mod locale;
mod prompt;
mod server_requests;
mod thread;

use std::env;
use std::io::{self, IsTerminal};
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{anyhow, bail, Context, Result};
use app_server_client::{AppServerEvent, ClientSession};
use app_server_protocol::protocol::v2::{
    ConfigReadParams, ConfigReadResponse, ReviewStartParams, ReviewStartResponse, ReviewTarget,
    ThreadSettingsUpdateParams, ThreadSettingsUpdateResponse, TurnStartParams, TurnStartResponse,
    TurnStatus, UserInput, METHOD_CONFIG_READ, METHOD_REVIEW_START, METHOD_THREAD_SETTINGS_UPDATE,
    METHOD_TURN_START,
};

use super::{
    cli_initialize_params, permission_settings, resolve_remote_endpoint, thread_stdio_config,
    ConnectionArgs,
};
use cli::{Command, ExecCli};
use event_processor::{EventProcessor, ExecResult};
use event_processor_with_human_output::{
    should_print_final_message_to_stdout, EventProcessorWithHumanOutput, ReasoningPolicy,
};
use event_processor_with_jsonl_output::{emit, EventProcessorWithJsonOutput};
use exec_events::{ThreadErrorEvent, ThreadEvent};
use locale::{Label, Locale};

#[derive(Debug, PartialEq)]
enum InitialOperation {
    ForkOnly,
    Review {
        review_request: ReviewTarget,
    },
    UserTurn {
        input: Vec<UserInput>,
        output_schema: Option<serde_json::Value>,
    },
}

pub(crate) async fn run(args: ExecCli) -> ExitCode {
    let machine_output = args.json;
    let with_ansi = args.color.use_ansi(
        io::stderr().is_terminal(),
        env::var_os("NO_COLOR").is_some(),
        env::var("TERM").ok().as_deref(),
    );
    let locale = Locale::resolve(args.locale.as_deref());
    let mut connection = args.connection.into_inner();
    let mut command = args.command;
    let child_connection = match &mut command {
        Some(Command::Resume(args)) => Some(&mut args.connection),
        Some(Command::Fork(args)) => Some(&mut args.connection),
        Some(Command::Review(args)) => Some(&mut args.connection),
        None => None,
    };
    if let Some(child) = child_connection {
        child.inherit_from(&connection);
        connection = std::mem::take(child);
    }
    let initial_operation = prompt::resolve_initial_operation(
        &mut command,
        args.prompt,
        args.images,
        args.last_message_file.is_some(),
        args.output_schema,
    );
    let result = match initial_operation {
        Ok(initial_operation) => {
            execute(
                connection,
                initial_operation,
                command,
                args.last_message_file,
                !machine_output,
                with_ansi,
                locale,
            )
            .await
        }
        Err(error) => Err(error),
    };
    match result {
        Ok(None) => ExitCode::SUCCESS,
        Ok(Some(output)) => {
            if !machine_output
                && should_print_final_message_to_stdout(
                    &output.output,
                    io::stdout().is_terminal(),
                    io::stderr().is_terminal(),
                )
            {
                println!("{}", output.output);
            }
            match output.status {
                TurnStatus::Completed => ExitCode::SUCCESS,
                TurnStatus::Interrupted => ExitCode::from(130),
                _ => ExitCode::FAILURE,
            }
        }
        Err(error) => {
            if machine_output {
                let _ = emit(
                    &ThreadEvent::Error(ThreadErrorEvent {
                        message: format!("{error:#}"),
                    }),
                    &mut io::stdout(),
                );
            } else {
                eprintln!("{error:#}");
            }
            ExitCode::FAILURE
        }
    }
}

async fn execute(
    connection: ConnectionArgs,
    initial_operation: InitialOperation,
    command: Option<Command>,
    last_message_file: Option<PathBuf>,
    human_output: bool,
    with_ansi: bool,
    locale: Locale,
) -> Result<Option<ExecResult>> {
    validate_model_route(&connection)?;
    let policy = permission_settings(&connection)?;
    let mut session = if let Some(remote) = resolve_remote_endpoint(&connection)? {
        ClientSession::start_remote(remote, cli_initialize_params()).await?
    } else {
        ClientSession::start_stdio(thread_stdio_config(&connection), cli_initialize_params())
            .await?
    };
    let execution = async {
        let handle = session.request_handle();
        let config: ConfigReadResponse = handle
            .request(METHOD_CONFIG_READ, ConfigReadParams::default())
            .await
            .context("failed to read exec settings through App Server config/read")?;
        let reasoning = ReasoningPolicy::from_config(config.config)?;
        let cwd = match connection.cwd.clone() {
            Some(cwd) => cwd,
            None => env::current_dir()?,
        };
        let thread_id = thread::start_thread(&handle, command.as_ref(), &connection, &cwd).await?;
        let cwd = cwd.to_string_lossy().into_owned();
        if !human_output {
            emit(
                &EventProcessorWithJsonOutput::thread_started_event(thread_id.clone()),
                &mut io::stdout(),
            )?;
        }
        let settings = ThreadSettingsUpdateParams {
            thread_id: thread_id.clone(),
            model: connection.model,
            model_provider: connection.provider,
            effort: connection.effort,
            permissions: connection.permissions,
            approval_policy: policy.approval_policy.map(serde_json::Value::String),
            approvals_reviewer: policy.approvals_reviewer.map(serde_json::Value::String),
            sandbox_policy: policy.sandbox_policy.map(serde_json::Value::String),
            ..Default::default()
        };
        if settings.has_updates() {
            let _: ThreadSettingsUpdateResponse = handle
                .request(METHOD_THREAD_SETTINGS_UPDATE, settings)
                .await
                .context("failed to update App Server thread settings")?;
        }
        let (thread_id, turn_id) = match initial_operation {
            InitialOperation::ForkOnly => {
                if human_output {
                    eprintln!("{}: {thread_id}", locale.label(Label::SessionId));
                }
                return Ok(None);
            }
            InitialOperation::UserTurn {
                input,
                output_schema,
            } => {
                let response: TurnStartResponse = handle
                    .request(
                        METHOD_TURN_START,
                        TurnStartParams {
                            thread_id: thread_id.clone(),
                            cwd: Some(cwd.clone()),
                            runtime_workspace_roots: Some(vec![cwd]),
                            input,
                            output_schema,
                            ..Default::default()
                        },
                    )
                    .await
                    .context("failed to start turn")?;
                (thread_id, response.turn.id)
            }
            InitialOperation::Review { review_request } => {
                let response: ReviewStartResponse = handle
                    .request(
                        METHOD_REVIEW_START,
                        ReviewStartParams {
                            thread_id,
                            target: review_request,
                            delivery: None,
                        },
                    )
                    .await
                    .context("failed to start review")?;
                (response.review_thread_id, response.turn.id)
            }
        };
        let mut processor = if human_output {
            EventProcessor::new(
                thread_id,
                turn_id,
                EventProcessorWithHumanOutput::create_with_ansi(with_ansi, reasoning, locale),
            )
        } else {
            let mut processor = EventProcessor::new_json(thread_id, turn_id);
            processor.start_turn(&mut io::stdout())?;
            processor
        };
        processor.set_last_message_file(last_message_file);
        loop {
            let event = session
                .next_event()
                .await
                .ok_or_else(|| anyhow!("App Server disconnected before turn completion"))?;
            match event {
                AppServerEvent::ServerNotification(notification) => {
                    let result = if human_output {
                        processor.process(*notification, &mut io::stderr())?
                    } else {
                        processor.process(*notification, &mut io::stdout())?
                    };
                    if let Some(result) = result {
                        return Ok(Some(result));
                    }
                }
                AppServerEvent::ServerRequest(request) => {
                    server_requests::respond(&handle, *request).await?
                }
                AppServerEvent::Disconnected { message } => bail!(message),
                AppServerEvent::Lagged { .. } => {}
            }
        }
    }
    .await;
    let shutdown = session.shutdown().await;
    match execution {
        Ok(result) => {
            shutdown?;
            Ok(result)
        }
        Err(error) => Err(error),
    }
}

fn validate_model_route(connection: &ConnectionArgs) -> Result<()> {
    match (&connection.model, &connection.provider) {
        (Some(model), Some(provider)) if model.trim().is_empty() || provider.trim().is_empty() => {
            bail!("model and provider must not be empty")
        }
        (Some(_), None) | (None, Some(_)) => {
            bail!("--model and --provider must be specified together")
        }
        _ => Ok(()),
    }
}
