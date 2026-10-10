use std::ffi::OsString;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use app_server_client::{AppServerEvent, RemoteTransportConfig, StdioTransportConfig};
#[cfg(test)]
use app_server_protocol::protocol::v2::ServerNotification;
use futures::StreamExt;

use crate::app::event_dispatch::{EventContext, EventDispatch};
use crate::app::reconnect::{reconnect_session, ReconnectedSession};
use crate::app::{App, AppAction};
use crate::app_server_session::AppServerSession;
use crate::bottom_pane::FileSearchRequest;
use crate::chatwidget::ExternalEditorState;
use crate::clipboard_paste::paste_image_to_temp_png;
use crate::locale::Locale;
use crate::projection::TranscriptEntry;
use crate::resume_picker::{
    run_resume_picker_with_app_server, PickerAction, PickerLoadEvent, PickerState,
    SessionPickerAction, SessionStatus,
};
use crate::settings::{parse_settings_command, SettingsCommand};
use crate::tui::{Tui, TuiEvent};
use crate::view;

mod input_submission;

#[derive(Debug, Clone)]
pub struct TuiOptions {
    pub app_server_bin: PathBuf,
    pub app_server_args: Vec<OsString>,
    pub remote: Option<RemoteTransportConfig>,
    pub cwd: PathBuf,
    pub model: Option<String>,
    pub model_provider: Option<String>,
    pub reasoning_effort: Option<String>,
    pub permissions: Option<String>,
    pub approval_policy: Option<String>,
    pub approvals_reviewer: Option<String>,
    pub sandbox_policy: Option<String>,
    pub locale: Option<String>,
    pub resume_thread: Option<String>,
}

#[derive(Debug)]
struct FileSearchEvent {
    generation: u64,
    query: String,
    files: Vec<app_server_protocol::protocol::v2::FuzzyFileSearchResult>,
}

enum PendingCopyContext {
    LastResponse,
    ComposerSelection {
        clear_selection: bool,
    },
    TranscriptSelection {
        text: String,
        follow: bool,
        target: crate::app::TranscriptSelectionTarget,
    },
    ExportClipboard,
}

struct PendingCopy {
    id: u64,
    thread_id: Option<String>,
    context: PendingCopyContext,
}

const ACTIVE_TURN_FRAME_INTERVAL: Duration = Duration::from_millis(100);

fn validate_model_route(options: &TuiOptions) -> Result<()> {
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

fn spawn_file_search(
    request_handle: app_server_client::RequestHandle,
    cwd: PathBuf,
    request: FileSearchRequest,
    result_tx: tokio::sync::mpsc::UnboundedSender<FileSearchEvent>,
) {
    tokio::spawn(async move {
        match AppServerSession::fuzzy_file_search_request(
            request_handle,
            cwd,
            request.query.clone(),
        )
        .await
        {
            Ok(files) => {
                let _ = result_tx.send(FileSearchEvent {
                    generation: request.generation,
                    query: request.query,
                    files,
                });
            }
            Err(error) => {
                tracing::debug!("file search request failed: {error}");
            }
        }
    });
}

pub async fn run_tui(options: TuiOptions) -> Result<()> {
    validate_model_route(&options)?;
    let mut session = Some(connect_session(&options).await?);
    let local_settings = match crate::local_settings::LocalSettings::read(
        session
            .as_ref()
            .expect("session available while loading TUI settings"),
    )
    .await
    {
        Ok(settings) => settings,
        Err(error) => {
            let _ = session
                .take()
                .expect("session available after TUI settings failure")
                .shutdown()
                .await;
            return Err(error);
        }
    };
    let mut app = App::default();
    let (app_event_tx, mut app_event_rx) = tokio::sync::mpsc::unbounded_channel();
    let app_event_tx = crate::app_event_sender::AppEventSender::new(app_event_tx);
    app.chat_widget
        .bottom_pane
        .set_app_event_tx(app_event_tx.clone());
    let mut message_history = crate::app::message_history::MessageHistory::default();
    app.set_right_click_paste(local_settings.tui.right_click_paste);
    app.projection
        .set_show_raw_agent_reasoning(local_settings.show_raw_agent_reasoning);
    app.chat_widget.tui_config = local_settings.tui;
    app.chat_widget.config_version = local_settings.config_version;
    app.set_runtime_keymap(local_settings.keymap);
    app.set_cwd(options.cwd.clone());
    app.set_locale(Locale::resolve(options.locale.as_deref()));
    app.chat_widget
        .bottom_pane
        .set_agents_navigation_enabled(options.remote.is_none());
    app.begin_startup_input_boundary();
    let setup_result = crate::app::startup::initialize_session(
        &options,
        session.as_mut().expect("session available during setup"),
        &mut app,
    )
    .await;
    let (approval_policy, mut approvals_reviewer, mut sandbox_policy) = match setup_result {
        Ok(state) => (
            state.approval_policy,
            state.approvals_reviewer,
            state.sandbox_policy,
        ),
        Err(error) => {
            let _ = session
                .take()
                .expect("session available after setup failure")
                .shutdown()
                .await;
            return Err(error);
        }
    };
    let mut terminal = match Tui::enter().context("failed to initialize terminal") {
        Ok(terminal) => terminal,
        Err(error) => {
            let _ = session
                .take()
                .expect("session available before terminal setup")
                .shutdown()
                .await;
            return Err(error);
        }
    };
    let mut input = terminal.event_stream();
    let frame_requester = terminal.frame_requester();
    app.chat_widget
        .bottom_pane
        .set_frame_requester(frame_requester.clone());
    frame_requester.schedule_frame();
    let mut status_tick = tokio::time::interval(Duration::from_secs(1));
    status_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let run_result: Result<()> = async {
        let mut resume_picker_load_tx: Option<tokio::sync::mpsc::UnboundedSender<PickerLoadEvent>> =
            None;
        let mut resume_picker_load_rx: Option<tokio::sync::mpsc::UnboundedReceiver<PickerLoadEvent>> =
            None;
        let mut reconnect: Option<Pin<Box<dyn Future<Output = Result<ReconnectedSession>>>>> = None;
        let mut reconnect_thread_id: Option<String> = None;
        let mut reconnect_failed = false;
        let mut history_top_up_requested = true;
        let mut history_load_all_requested = false;
        let (file_search_tx, mut file_search_rx) =
            tokio::sync::mpsc::unbounded_channel::<FileSearchEvent>();
        let (mcp_login_tx, mut mcp_login_rx) =
            tokio::sync::mpsc::unbounded_channel::<crate::app::mcp_login::McpLoginStarted>();
        let mut pending_copy: Option<PendingCopy> = None;
        let mut draw_requested = false;
        loop {
            if let Some(active_session) = session.as_mut() {
                app.poll_backtrack_io(active_session, &app_event_tx);
            }
            if session.is_none() && reconnect.is_none() && !reconnect_failed {
                if let Some(thread_id) = reconnect_thread_id.as_deref() {
                    reconnect = Some(Box::pin(reconnect_session(
                        options.clone(),
                        thread_id.to_string(),
                        app.chat_widget.settings_patch()
                        .with_policy(
                            approval_policy.clone(),
                            approvals_reviewer.clone(),
                            sandbox_policy.clone(),
                        ),
                    )));
                } else {
                    reconnect_failed = true;
                    app.projection
                        .set_status("reconnect unavailable: thread id missing");
                }
            }
            if history_top_up_requested {
                history_top_up_requested = false;
                if let Some(active_session) = session.as_mut() {
                    if history_top_up_needed(&mut terminal, &app)? {
                        let _ = app.spawn_older_history_page_load(
                            active_session,
                            &app_event_tx,
                            crate::app_event::OlderHistoryLoadMode::TopUp,
                        );
                    }
                }
            }
            if let Some(delay) = app.chat_widget.bottom_pane.next_frame_delay(std::time::Instant::now()) {
                frame_requester.schedule_frame_in(delay);
            }
            if let Some(active_session) = session.as_ref() {
                if let (Some(picker), Some(sender)) =
                    (app.chat_widget.resume_picker_mut(), resume_picker_load_tx.as_ref())
                {
                    if let Some(thread_id) = picker.selected_thread_id().map(ToOwned::to_owned) {
                        crate::resume_picker::spawn_preview_load(
                            active_session.request_handle(),
                            sender,
                            picker,
                            thread_id,
                        );
                    }
                }
            }
            if std::mem::take(&mut draw_requested)
                && !app.chat_widget.handle_paste_burst_tick(&frame_requester, std::time::Instant::now())
            {
                terminal
                    .draw(
                        view::cursor_style(&app),
                        app.terminal_title_text(std::time::Instant::now()).as_deref(),
                        |frame| view::render(frame, &app),
                    )
                    .context("failed to render terminal")?;
            }

            if app.chat_widget.external_editor_state() == ExternalEditorState::Requested {
                app.launch_external_editor(&mut terminal).await;
                // Recreate crossterm input only from the normal async event loop. Eagerly polling
                // here races the previous reader's shutdown after an external editor and can
                // surface a transient EOF as the end of the TUI input stream.
                continue;
            }

            tokio::select! {
                app_event = app_event_rx.recv() => {
                    if let Some(event) = app_event {
                        match event {
                            crate::app_event::AppEvent::Backtrack(event) => app.handle_backtrack_event(event),
                            crate::app_event::AppEvent::ThreadHistoryReplaced { thread_id, generation, result } => {
                                if let Some(active_session) = session.as_mut() {
                                    app.handle_history_replaced(active_session, &thread_id, generation, result);
                                }
                            },
                            crate::app_event::AppEvent::OlderThreadHistoryLoaded {
                                thread_id,
                                cursor,
                                result,
                                mode,
                            } => {
                                let page_result = session.as_mut().map(|active_session| {
                                    app.handle_older_history_page_loaded(
                                        active_session,
                                        &thread_id,
                                        &cursor,
                                        result,
                                    )
                                });
                                match page_result {
                                    Some(Ok(true))
                                        if (mode == crate::app_event::OlderHistoryLoadMode::All
                                            || history_load_all_requested)
                                            && app.chat_widget.scrollback_has_older_history() =>
                                    {
                                        if let Some(active_session) = session.as_mut() {
                                            match app.spawn_older_history_page_load(
                                                active_session,
                                                &app_event_tx,
                                                crate::app_event::OlderHistoryLoadMode::All,
                                            ) {
                                                crate::app::history_pagination::OlderHistoryLoadStart::Unavailable => {
                                                    history_load_all_requested = false;
                                                    complete_history_load(&mut app);
                                                }
                                                crate::app::history_pagination::OlderHistoryLoadStart::Started
                                                | crate::app::history_pagination::OlderHistoryLoadStart::Pending => {}
                                            }
                                        }
                                    }
                                    Some(Ok(true))
                                        if mode == crate::app_event::OlderHistoryLoadMode::TopUp =>
                                    {
                                        clear_history_page_error(&mut app);
                                        if history_load_all_requested
                                            && !app.chat_widget.scrollback_has_older_history()
                                        {
                                            history_load_all_requested = false;
                                            complete_history_load(&mut app);
                                        } else if let Some(active_session) = session.as_mut() {
                                            if history_top_up_needed(&mut terminal, &app)? {
                                                let _ = app.spawn_older_history_page_load(
                                                    active_session,
                                                    &app_event_tx,
                                                    crate::app_event::OlderHistoryLoadMode::TopUp,
                                                );
                                            }
                                        }
                                    }
                                    Some(Ok(true)) => {
                                        if mode == crate::app_event::OlderHistoryLoadMode::All
                                            || history_load_all_requested
                                        {
                                            history_load_all_requested = false;
                                            complete_history_load(&mut app);
                                        } else {
                                            clear_history_page_error(&mut app);
                                        }
                                    }
                                    Some(Ok(false)) => {}
                                    Some(Err(error)) => {
                                        history_load_all_requested = false;
                                        fail_history_load(
                                            &mut app,
                                            &format!("history page failed: {error}"),
                                        );
                                    }
                                    None => {}
                                }
                            }
                            event => {
                                message_history.handle_event(
                                    event,
                                    &mut app,
                                    session.as_ref().map(AppServerSession::request_handle),
                                    &app_event_tx,
                                );
                            }
                        }
                        frame_requester.schedule_frame();
                    }
                }
                file_search_event = file_search_rx.recv() => {
                    if let Some(file_search_event) = file_search_event {
                        app.chat_widget.bottom_pane.on_file_search_result(
                            file_search_event.generation,
                            &file_search_event.query,
                            file_search_event.files,
                        );
                        frame_requester.schedule_frame();
                    }
                }
                resume_event = async {
                    match resume_picker_load_rx.as_mut() {
                        Some(receiver) => receiver.recv().await,
                        None => std::future::pending::<Option<PickerLoadEvent>>().await,
                    }
                }, if resume_picker_load_rx.is_some() => {
                    frame_requester.schedule_frame();
                    let Some(resume_event) = resume_event else {
                        resume_picker_load_rx = None;
                        resume_picker_load_tx = None;
                        continue;
                    };
                    let Some(picker) = app.chat_widget.resume_picker_mut() else {
                        continue;
                    };
                    match resume_event {
                        PickerLoadEvent::Threads { token, result } => match result {
                            Ok(page) => {
                                picker.apply_thread_page(token, page);
                                if (picker.threads.is_empty() && picker.has_more_pages()) || picker.has_pending_page_down() {
                                    if let Some(sender) = resume_picker_load_tx.as_ref() {
                                        crate::resume_picker::spawn_thread_load(
                                            session
                                                .as_ref()
                                                .expect("session available during resume picker")
                                                .request_handle(),
                                            sender,
                                            picker,
                                        );
                                    }
                                }
                            }
                            Err(error) if picker.load_token == token => {
                                picker.fail_thread_load(token, error);
                            }
                            Err(_) => {}
                        },
                        PickerLoadEvent::Preview { thread_id, result } => {
                            picker.set_transcript_preview(thread_id, result.unwrap_or_default());
                        }
                        PickerLoadEvent::Transcript { thread_id, result } => {
                            picker.set_transcript(thread_id, result);
                        }
                        PickerLoadEvent::Archive { thread_id, result } => {
                            picker.handle_archive_result(thread_id, result);
                        }
                        PickerLoadEvent::Unarchive { thread_id, result } => {
                            if let Some(crate::resume_picker::SessionSelection::Resume(target)) =
                                picker.handle_unarchive_result(thread_id, *result)
                            {
                                let thread_id = target.thread_id;
                                app.chat_widget.clear_resume_picker();
                                resume_picker_load_rx = None;
                                resume_picker_load_tx = None;
                                app.chat_widget.clear_agents_overview();
                                history_load_all_requested = false;
                                match app.resume_target_session(
                                    session
                                        .as_mut()
                                        .expect("session available during resume picker"),
                                    thread_id,
                                    &options,
                                )
                                .await
                                {
                                    Ok(()) => {
                                        history_top_up_requested = true;
                                        app.projection.set_status("archived session restored");
                                    }
                                    Err(error) => app
                                        .projection
                                        .set_status(format!("resume failed: {error}")),
                                }
                            }
                        }
                    }
                }
                _ = status_tick.tick(), if app.projection.active_turn_id().is_some() => {
                    frame_requester.schedule_frame();
                }
                event = input.next() => {
                    let Some(event) = event else { break };
                    let event = match event {
                        TuiEvent::Draw => {
                            if app.projection.active_turn_id().is_some() {
                                frame_requester.schedule_frame_in(ACTIVE_TURN_FRAME_INTERVAL);
                            }
                            TuiEvent::Draw
                        }
                        TuiEvent::Resize(size) => {
                            terminal.update_viewport(size, size.height);
                            history_top_up_requested = true;
                            TuiEvent::Resize(size)
                        }
                        event => event,
                    };
                    let connected = session.is_some();
                    let is_draw = matches!(&event, TuiEvent::Draw);
                    if is_draw {
                        draw_requested = true;
                    } else {
                        frame_requester.schedule_frame();
                    }
                    let event_for_clipboard = event.clone();
                    if let Some(id) = app.invalidate_clipboard_paste(&event_for_clipboard) {
                        terminal.clipboard.cancel(Some(id));
                    }
                    let action = app.handle_tui_event_runtime(event, connected);
                    if is_draw {
                        if let Some((id, result)) = terminal.clipboard.poll() {
                            app.finish_clipboard_paste(id, result);
                        }
                        if let Some((id, result)) = terminal.clipboard_copy.poll() {
                            if pending_copy.as_ref().is_some_and(|pending| pending.id == id) {
                                let pending = pending_copy
                                    .take()
                                    .expect("pending copy exists after matching completion");
                                let same_thread = pending.thread_id == app.thread_id;
                                apply_copy_completion(
                                    &mut app,
                                    pending.context,
                                    result,
                                    same_thread,
                                );
                            }
                        }
                    }
                    if connected {
                        if let Some(request) = app.chat_widget.bottom_pane.take_file_search_request() {
                            spawn_file_search(
                                session
                                    .as_ref()
                                    .expect("session available for file search")
                                    .request_handle(),
                                app.cwd.clone(),
                                request,
                                file_search_tx.clone(),
                            );
                        }
                    }
                    if !connected {
                        if matches!(action, AppAction::Quit) {
                            break;
                        }
                        continue;
                    }
                    let action = match app
                        .handle_event(
                            action,
                                EventContext {
                                    session: session
                                        .as_mut()
                                        .expect("session available during TUI action dispatch"),
                                    mcp_login_tx: &mcp_login_tx,
                                },
                        )
                        .await?
                    {
                        EventDispatch::Handled => continue,
                        EventDispatch::Unhandled(action) => action,
                    };
                    match action {
                        AppAction::Submit { text: prompt, text_elements } => {
                            if !app.can_accept_direct_input() {
                                continue;
                            }
                            if let Some(command) = parse_settings_command(&prompt) {
                                match command {
                                    Ok(SettingsCommand::Plan) => {
                                        let Some(collaboration_mode) =
                                            app.chat_widget.plan_mode()
                                        else {
                                            app.projection
                                                .set_status("plan mode unavailable on this server");
                                            continue;
                                        };
                                        match session
                                            .as_ref()
                                            .expect("session available during TUI")
                                            .update_collaboration_mode(collaboration_mode.clone())
                                            .await
                                        {
                                            Ok(()) => {
                                                app.chat_widget
                                                    .apply_collaboration_mode(collaboration_mode);
                                                app.projection.set_status("plan mode");
                                            }
                                            Err(error) => app.projection.set_status(error.to_string()),
                                        }
                                    }
                                    Ok(SettingsCommand::ModelPicker) => {
                                        match session
                                            .as_ref()
                                            .expect("session available during TUI")
                                            .list_models(100)
                                            .await
                                        {
                                            Ok(response) => {
                                                app.chat_widget.open_model_picker(response.data);
                                                app.projection.set_status("choose model");
                                            }
                                            Err(error) => {
                                                app.projection.set_status(error.to_string());
                                            }
                                        }
                                    }
                                    Ok(SettingsCommand::Model {
                                        model: model_value,
                                        provider,
                                    }) => {
                                        match session
                                            .as_ref()
                                            .expect("session available during TUI")
                                            .update_settings(
                                                Some(model_value.clone()),
                                                provider.clone(),
                                                None,
                                                None,
                                            )
                                            .await
                                        {
                                            Ok(()) => {
                                                app.chat_widget.apply_model_selection(
                                                    model_value,
                                                    provider,
                                                    None,
                                                );
                                                app.projection.set_status("settings updated");
                                            }
                                            Err(error) => app.projection.set_status(error.to_string()),
                                        }
                                    }
                                    Ok(SettingsCommand::Effort(value)) => {
                                        match session
                                            .as_ref()
                                            .expect("session available during TUI")
                                            .update_settings(None, None, Some(value.clone()), None)
                                            .await
                                        {
                                            Ok(()) => {
                                                app.chat_widget.apply_effort(value);
                                                app.projection.set_status("settings updated");
                                            }
                                            Err(error) => app.projection.set_status(error.to_string()),
                                        }
                                    }
                                    Ok(SettingsCommand::Permissions(value)) => {
                                        match session
                                            .as_ref()
                                            .expect("session available during TUI")
                                            .update_settings(None, None, None, Some(value.clone()))
                                            .await
                                        {
                                            Ok(()) => {
                                                sandbox_policy = None;
                                                approvals_reviewer = None;
                                                app.chat_widget.apply_permissions(value);
                                                app.projection.set_status("settings updated");
                                            }
                                            Err(error) => app.projection.set_status(error.to_string()),
                                        }
                                    }
                                    Err(error) => app.projection.set_status(error.to_string()),
                                }
                                continue;
                            }
                            input_submission::handle_submission(
                                &mut app,
                                session.as_ref().expect("session available during TUI"),
                                prompt,
                                text_elements,
                                false,
                            ).await;
                        }
                        AppAction::Queue { text: prompt, text_elements } => {
                            input_submission::handle_submission(
                                &mut app,
                                session.as_ref().expect("session available during TUI"),
                                prompt,
                                text_elements,
                                true,
                            ).await;
                        }
                        AppAction::EditQueuedSubmission(submission) => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .delete_queued_submission(submission.id.clone())
                                .await
                            {
                                Ok(true) if app.restore_queued_submission_for_edit(submission) => {
                                    app.projection.set_status("queued input editing");
                                }
                                Ok(true) => {
                                    app.refresh_queued_submissions(
                                        session.as_ref().expect("session available during TUI"),
                                    )
                                    .await;
                                    app.projection.set_status("queued input unavailable");
                                }
                                Ok(false) => {
                                    app.refresh_queued_submissions(
                                        session.as_ref().expect("session available during TUI"),
                                    )
                                    .await;
                                    app.projection.set_status("queued input unavailable");
                                }
                                Err(error) => app
                                    .projection
                                    .set_status(format!("queue edit failed: {error}")),
                            }
                        }
                        AppAction::CopyLastResponse => {
                            if let Some((id, context)) = queue_last_response_copy(
                                &mut terminal,
                                &mut app,
                                frame_requester.clone(),
                            ) {
                                pending_copy = Some(PendingCopy {
                                    id,
                                    thread_id: app.thread_id.clone(),
                                    context,
                                });
                            }
                        }
                        AppAction::CopyComposerSelection {
                            text,
                            clear_selection,
                        } => {
                            if let Some((id, context)) = queue_copy(
                                &mut terminal,
                                &mut app,
                                text,
                                PendingCopyContext::ComposerSelection { clear_selection },
                                frame_requester.clone(),
                            ) {
                                pending_copy = Some(PendingCopy {
                                    id,
                                    thread_id: app.thread_id.clone(),
                                    context,
                                });
                            }
                        }
                        AppAction::CopyTranscriptSelection {
                            text,
                            follow,
                            target,
                        } => {
                            if let Some((id, context)) = queue_copy(
                                &mut terminal,
                                &mut app,
                                text.clone(),
                                PendingCopyContext::TranscriptSelection {
                                    text,
                                    follow,
                                    target,
                                },
                                frame_requester.clone(),
                            ) {
                                pending_copy = Some(PendingCopy {
                                    id,
                                    thread_id: app.thread_id.clone(),
                                    context,
                                });
                            }
                        }
                        AppAction::OpenLink(destination) => match open_link(&destination) {
                            Ok(()) => app
                                .projection
                                .set_status(
                                    app.chat_widget
                                        .locale
                                        .transcript_link_opened(&destination),
                                ),
                            Err(error) => app
                                .projection
                                .set_status(
                                    app.chat_widget
                                        .locale
                                        .transcript_link_open_failed(&error),
                                ),
                        },
                        AppAction::ScheduleFrameIn(delay) => {
                            frame_requester.schedule_frame_in(delay);
                        }
                        AppAction::ExportTranscript { path } => {
                            let exported = prepare_export_transcript(
                                &mut app,
                                session.as_ref().expect("session available during TUI export"),
                                path,
                            )
                            .await;
                            if let Some(markdown) = exported {
                                if let Some((id, context)) = queue_copy(
                                    &mut terminal,
                                    &mut app,
                                    markdown,
                                    PendingCopyContext::ExportClipboard,
                                    frame_requester.clone(),
                                ) {
                                    pending_copy = Some(PendingCopy {
                                        id,
                                        thread_id: app.thread_id.clone(),
                                        context,
                                    });
                                }
                            }
                        }
                        AppAction::PasteImage => match paste_image_to_temp_png() {
                            Ok((path, info)) => {
                                app.attach_image(path);
                                app.projection.set_status(format!(
                                    "image attached: {}x{}",
                                    info.width, info.height
                                ));
                            }
                            Err(error) => app
                                .projection
                                .set_status(format!("image paste failed: {error}")),
                        },
                        AppAction::PasteClipboardText(source) => {
                            match terminal
                                .clipboard
                                .request_read(source, frame_requester.clone())
                            {
                                Ok(Some(id)) => {
                                    if !app.begin_clipboard_paste(id, source) {
                                        terminal.clipboard.cancel(Some(id));
                                    }
                                }
                                Ok(None) => app
                                    .projection
                                    .set_status(
                                        app.chat_widget.locale.status("clipboard is busy"),
                                    ),
                                Err(error) => app
                                    .projection
                                    .set_status(app.chat_widget.locale.status(&format!(
                                        "clipboard paste failed: {error}"
                                    ))),
                            }
                        }
                        AppAction::Interrupt => {
                            if let Some(turn_id) = app.projection.active_turn_id() {
                                let turn_id = turn_id.to_string();
                                match session
                                    .as_ref()
                                    .expect("session available during TUI")
                                    .interrupt(&turn_id)
                                    .await
                                {
                                    Ok(()) => app.projection.set_status("interrupting"),
                                    Err(error) if is_no_active_turn_error(&error) => break,
                                    Err(error) => return Err(error),
                                }
                            } else {
                                break;
                            }
                        }
                        AppAction::ScrollUp => {
                            let page_size = current_transcript_page_size(&mut terminal, &app)?;
                            app.scroll_up(page_size);
                            if app.chat_widget.scrollback_has_older_history() {
                                let active_session =
                                    session.as_mut().expect("session available during TUI");
                                let _ = app.spawn_older_history_page_load(
                                    active_session,
                                    &app_event_tx,
                                    crate::app_event::OlderHistoryLoadMode::OnePage,
                                );
                            }
                        }
                        AppAction::ScrollDown => {
                            let page_size = current_transcript_page_size(&mut terminal, &app)?;
                            app.scroll_down(page_size);
                        }
                        AppAction::ScrollRows(rows) => {
                            if rows < 0 {
                                app.scroll_up(rows.unsigned_abs());
                                if app.chat_widget.scrollback_has_older_history() {
                                    let active_session =
                                        session.as_mut().expect("session available during TUI");
                                    let _ = app.spawn_older_history_page_load(
                                        active_session,
                                        &app_event_tx,
                                        crate::app_event::OlderHistoryLoadMode::OnePage,
                                    );
                                }
                            } else {
                                app.scroll_down(rows.unsigned_abs());
                            }
                        }
                        AppAction::ScrollTop => app.scroll_top(),
                        AppAction::ScrollBottom => app.scroll_bottom(),
                        AppAction::LoadOlderHistory => {
                            if let Some(pager) = app.chat_widget.pager_overlay.as_ref() {
                                pager.begin_older_history_load();
                            }
                            if app.chat_widget.transcript_search.is_active() {
                                app.chat_widget.transcript_search.begin_history_load();
                            }
                            history_load_all_requested = true;
                            if let Some(active_session) = session.as_mut() {
                                if app.spawn_older_history_page_load(
                                    active_session,
                                    &app_event_tx,
                                    crate::app_event::OlderHistoryLoadMode::All,
                                ) == crate::app::history_pagination::OlderHistoryLoadStart::Unavailable {
                                    history_load_all_requested = false;
                                    complete_history_load(&mut app);
                                }
                            } else {
                                history_load_all_requested = false;
                                fail_history_load(&mut app, "history transport unavailable");
                            }
                        }
                        AppAction::OpenResumePicker => {
                            if app.chat_widget.resume_picker.is_none() {
                                let (load_tx, load_rx) = tokio::sync::mpsc::unbounded_channel();
                                let mut picker = PickerState::new(
                                    Vec::new(),
                                    SessionPickerAction::Resume,
                                    SessionStatus::Active,
                                    Some(app.cwd.clone()),
                                    false,
                                );
                                picker.set_model_provider_filter(
                                    app.chat_widget.model_provider.clone(),
                                );
                                picker.set_transcript_keymap(
                                    app.chat_widget.runtime_keymap.transcript().clone(),
                                );
                                picker.set_list_keymap(
                                    app.chat_widget.runtime_keymap.list().clone(),
                                );
                                crate::resume_picker::spawn_thread_load(
                                    session
                                        .as_ref()
                                        .expect("session available during resume picker")
                                        .request_handle(),
                                    &load_tx,
                                    &mut picker,
                                );
                                app.chat_widget.set_resume_picker(picker);
                                resume_picker_load_tx = Some(load_tx);
                                resume_picker_load_rx = Some(load_rx);
                            }
                        }
                        AppAction::ResumePicker(action) => {
                            let locale = app.chat_widget.locale;
                            let Some(picker) = app.chat_widget.resume_picker_mut() else {
                                continue;
                            };
                            let request_handle = session
                                .as_ref()
                                .expect("session available during resume picker")
                                .request_handle();
                            match action {
                                PickerAction::Select => {
                                    let selected = picker.selected_thread_id().map(ToOwned::to_owned);
                                    app.chat_widget.clear_resume_picker();
                                    resume_picker_load_rx = None;
                                    resume_picker_load_tx = None;
                                    app.chat_widget.clear_agents_overview();
                                    history_load_all_requested = false;
                                    if let Some(thread_id) = selected {
                                        app.projection
                                            .set_status(format!("resuming session {thread_id}"));
                                        match app.resume_target_session(
                                            session
                                                .as_mut()
                                                .expect("session available during resume picker"),
                                            thread_id,
                                            &options,
                                        )
                                        .await
                                        {
                                            Ok(()) => {
                                                history_top_up_requested = true;
                                            }
                                            Err(error) => app
                                                .projection
                                                .set_status(format!("resume failed: {error}")),
                                        }
                                    }
                                }
                                PickerAction::Restore => {
                                    if let Some(thread_id) =
                                        picker.request_unarchive_for_selected_session()
                                    {
                                        if let Some(sender) = resume_picker_load_tx.as_ref() {
                                            crate::resume_picker::spawn_unarchive_request(
                                                request_handle,
                                                sender,
                                                thread_id,
                                            );
                                        }
                                    }
                                }
                                PickerAction::Archive => {
                                    if let Some(thread_id) =
                                        picker.request_archive_for_selected_session()
                                    {
                                        if let Some(sender) = resume_picker_load_tx.as_ref() {
                                            crate::resume_picker::spawn_archive_request(
                                                request_handle,
                                                sender,
                                                thread_id,
                                            );
                                        }
                                    }
                                }
                                PickerAction::ToggleStatus
                                | PickerAction::ToggleFilter
                                | PickerAction::ToggleSort
                                | PickerAction::Reload => {
                                    match action {
                                        PickerAction::ToggleStatus => picker.toggle_status(),
                                        PickerAction::ToggleFilter => picker.toggle_filter(),
                                        PickerAction::ToggleSort => picker.toggle_sort(),
                                        PickerAction::Reload => {}
                                        _ => unreachable!(),
                                    }
                                    if let Some(sender) = resume_picker_load_tx.as_ref() {
                                        crate::resume_picker::spawn_thread_load(
                                            request_handle,
                                            sender,
                                            picker,
                                        );
                                    }
                                }
                                PickerAction::ToggleDensity => picker.toggle_density(),
                                PickerAction::ToggleExpanded => {
                                    if let Some(thread_id) = picker.toggle_selected_expansion() {
                                        if let Some(sender) = resume_picker_load_tx.as_ref() {
                                            crate::resume_picker::spawn_transcript_load(
                                                request_handle,
                                                sender,
                                                thread_id,
                                                app.projection.show_raw_agent_reasoning(),
                                            );
                                        }
                                    }
                                }
                                PickerAction::OpenTranscript => {
                                    if let Some(thread_id) = picker
                                        .open_transcript_pager(locale)
                                    {
                                        if let Some(sender) = resume_picker_load_tx.as_ref() {
                                            crate::resume_picker::spawn_transcript_load(
                                                request_handle,
                                                sender,
                                                thread_id,
                                                app.projection.show_raw_agent_reasoning(),
                                            );
                                        }
                                    }
                                }
                                PickerAction::MoveDown if picker.should_load_more() => {
                                    if let Some(sender) = resume_picker_load_tx.as_ref() {
                                        crate::resume_picker::spawn_thread_load(
                                            request_handle,
                                            sender,
                                            picker,
                                        );
                                    }
                                }
                                PickerAction::MoveUp
                                | PickerAction::MoveDown
                                | PickerAction::None
                                | PickerAction::Cancel => {}
                            }
                        }
                        AppAction::SwitchThread(thread_id) => {
                            history_load_all_requested = false;
                            match app.resume_target_session(
                                session.as_mut().expect("session available during TUI"),
                                thread_id,
                                &options,
                            )
                            .await
                            {
                                Ok(()) => {
                                    history_top_up_requested = true;
                                    app.projection.set_status("switched agent");
                                }
                                Err(error) => app.projection.set_status(format!(
                                    "agent switch failed: {error}"
                                )),
                            }
                        }
                        AppAction::DecreaseEffort
                        | AppAction::IncreaseEffort
                        | AppAction::PreviousPermissions
                        | AppAction::NextPermissions
                        | AppAction::Respond(_)
                        | AppAction::SelectModel(_)
                        | AppAction::StatusLineSetup { .. }
                        | AppAction::TerminalTitleSetup { .. }
                        | AppAction::ChangeCollaborationMode(_)
                        | AppAction::RefreshAgentsOverview
                        | AppAction::LoadMoreAgentsOverview
                        | AppAction::DispatchAgentsOverviewTask { .. }
                        | AppAction::RenameAgentsOverviewThread { .. }
                        | AppAction::StopAgentsOverviewThread { .. }
                        | AppAction::FetchMcpInventory { .. }
                        | AppAction::StartMcpLogin { .. } => {
                            unreachable!("App Server actions are handled by app::event_dispatch")
                        }
                        AppAction::Quit => break,
                        AppAction::None => {}
                    }
                }
                Some(event) = mcp_login_rx.recv() => {
                    app.finish_mcp_login_start(event, open_link);
                    frame_requester.schedule_frame();
                }
                event = async {
                    match session.as_mut() {
                        Some(session) => session.next_event().await,
                        None => std::future::pending::<Option<AppServerEvent>>().await,
                    }
                }, if session.is_some() => {
                    frame_requester.schedule_frame();
                    let event = event.unwrap_or_else(|| AppServerEvent::Disconnected {
                        message: "app-server event stream closed".to_string(),
                    });
                    let disconnected_message = match &event {
                        AppServerEvent::Disconnected { message } => Some(message.clone()),
                        _ => None,
                    };
                    app.handle_app_server_event(
                        session.as_ref().expect("session available during TUI"),
                        event,
                    )
                    .await;
                    if disconnected_message.is_some() {
                        let thread_id = session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_id()?
                            .to_string();
                            terminal
                                .draw(
                                    view::cursor_style(&app),
                                    app.terminal_title_text(std::time::Instant::now()).as_deref(),
                                    |frame| view::render(frame, &app),
                                )
                                .context("failed to render reconnecting state")?;
                            let old_session = session
                                .take()
                                .expect("session available during reconnect");
                            let _ = old_session.shutdown().await;
                            reconnect_thread_id = Some(thread_id);
                            reconnect_failed = false;
                    }
                }
                result = async {
                    match reconnect.as_mut() {
                        Some(future) => future.await,
                        None => std::future::pending::<Result<ReconnectedSession>>().await,
                    }
                }, if reconnect.is_some() => {
                    frame_requester.schedule_frame();
                    reconnect = None;
                    match result {
                        Ok(reconnected) => {
                            history_load_all_requested = false;
                            let active_profile = reconnected
                                .session
                                .active_permission_profile()
                                .map(str::to_string);
                            app.hydrate_thread(reconnected.thread);
                            crate::app::working_directory::sync_server_cwd(
                                &mut app,
                                reconnected.cwd,
                            );
                            app.prepend_initial_history_page(reconnected.history_page);
                            app.chat_widget.set_scrollback_has_older_history(
                                reconnected.scrollback_has_older_history,
                            );
                            app.chat_widget
                                .set_permission_profiles(reconnected.permission_profiles);
                            app.chat_widget.set_collaboration_modes(
                                reconnected
                                    .session
                                    .list_collaboration_modes()
                                    .await
                                    .unwrap_or_default(),
                            );
                            if options.permissions.is_none() {
                                if let Some(active_profile) = active_profile {
                                    app.chat_widget.apply_permissions(active_profile);
                                }
                            }
                            app.refresh_queued_submissions(&reconnected.session).await;
                            session = Some(reconnected.session);
                            reconnect_thread_id = None;
                            reconnect_failed = false;
                            app.projection.on_reconnected();
                            history_top_up_requested = true;
                        }
                        Err(error) => {
                            reconnect_failed = true;
                            tracing::debug!(%error, "app-server reconnect failed");
                            app.projection.set_status("reconnect failed");
                        }
                    }
                }
            }
        }
        Ok(())
    }
    .await;

    app.end_startup_input_boundary();
    let restore_result = terminal.restore().context("failed to restore terminal");
    let shutdown_result = match session {
        Some(session) => session.shutdown().await,
        None => Ok(()),
    };
    run_result?;
    restore_result?;
    shutdown_result
}

fn is_no_active_turn_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        let message = cause.to_string().to_ascii_lowercase();
        message.contains("no active turn") || message.contains("turn_not_active")
    })
}

fn clear_history_page_error(app: &mut App) {
    if app.projection.status().starts_with("history page failed:") {
        app.projection.set_status("ready");
    }
}

fn complete_history_load(app: &mut App) {
    clear_history_page_error(app);
    if let Some(pager) = app.chat_widget.pager_overlay.as_ref() {
        pager.complete_older_history_load();
        pager.reset_transcript_anchor_at_top();
    }
    app.chat_widget.transcript_search.complete_history_load();
}

fn fail_history_load(app: &mut App, message: &str) {
    if let Some(pager) = app.chat_widget.pager_overlay.as_ref() {
        pager.fail_older_history_load();
    }
    app.chat_widget.transcript_search.fail_history_load();
    app.projection.set_status(message);
}

fn current_transcript_page_size(terminal: &mut Tui, app: &App) -> Result<usize> {
    let size = terminal
        .terminal_mut()
        .size()
        .context("failed to read terminal size")?;
    Ok(view::transcript_page_size(size.width, size.height, app))
}

fn history_top_up_needed(terminal: &mut Tui, app: &App) -> Result<bool> {
    if app.chat_widget.resume_picker.is_some()
        || app.chat_widget.pager_overlay.is_some()
        || app.chat_widget.export_picker.is_some()
        || app.chat_widget.status_line_setup.is_some()
        || app.chat_widget.terminal_title_setup.is_some()
        || app.chat_widget.model_picker.is_some()
        || app.chat_widget.agent_picker.is_some()
        || app.chat_widget.agents_overview.is_some()
    {
        return Ok(false);
    }
    if !app.chat_widget.scrollback_has_older_history() {
        return Ok(false);
    }
    let size = terminal
        .terminal_mut()
        .size()
        .context("failed to read terminal size for history top-up")?;
    let minimum_rows = view::transcript_page_size(size.width, size.height, app);
    Ok(crate::app::history_ui::rendered_transcript_row_count(app, size.width) < minimum_rows)
}

/// Resume without an explicit id using the same canonical thread picker as Codex.
/// The picker session is short-lived; the selected thread is then resumed by the
/// normal TUI runtime so there is only one conversation owner.
pub async fn run_resume(mut options: TuiOptions) -> Result<()> {
    if options.resume_thread.is_none() {
        let selected = run_resume_picker_with_app_server(&options).await?;
        let Some(thread_id) = selected else {
            return Ok(());
        };
        options.resume_thread = Some(thread_id);
    }
    run_tui(options).await
}

fn queue_last_response_copy(
    terminal: &mut Tui,
    app: &mut App,
    frames: crate::tui::FrameRequester,
) -> Option<(u64, PendingCopyContext)> {
    let response = app.projection.final_answer();
    let response = crate::markdown_render::followup_labels(&response);
    if response.is_empty() {
        app.projection.set_status("no agent response to copy");
        return None;
    }
    queue_copy(
        terminal,
        app,
        response.into_owned(),
        PendingCopyContext::LastResponse,
        frames,
    )
}

fn queue_copy(
    terminal: &mut Tui,
    app: &mut App,
    text: String,
    context: PendingCopyContext,
    frames: crate::tui::FrameRequester,
) -> Option<(u64, PendingCopyContext)> {
    let publish_primary = matches!(
        &context,
        PendingCopyContext::TranscriptSelection {
            target: crate::app::TranscriptSelectionTarget::MainTranscript
                | crate::app::TranscriptSelectionTarget::MainPager,
            follow: false,
            ..
        }
    );
    match terminal
        .clipboard_copy
        .request_copy_with_primary(text, frames, publish_primary)
    {
        Ok(Some(id)) => {
            app.projection.set_status("copying…");
            Some((id, context))
        }
        Ok(None) => {
            app.projection.set_status("copy already in progress");
            None
        }
        Err(error) => {
            app.projection.set_status(format!("copy failed: {error}"));
            None
        }
    }
}

fn apply_copy_completion(
    app: &mut App,
    context: PendingCopyContext,
    completion: crate::clipboard_copy::worker::CopyCompletion,
    apply_feedback: bool,
) {
    let status = completion
        .clipboard
        .map(|outcome| outcome.store(&mut app.chat_widget.clipboard_lease));
    let surface_active = match &context {
        PendingCopyContext::TranscriptSelection { target, .. } => match target {
            crate::app::TranscriptSelectionTarget::MainTranscript => {
                app.chat_widget.transcript_selection.is_active()
            }
            crate::app::TranscriptSelectionTarget::MainPager => app
                .chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(crate::pager_overlay::PagerOverlay::has_transcript_selection),
            crate::app::TranscriptSelectionTarget::ResumePicker => {
                app.chat_widget.resume_picker.is_some()
            }
        },
        _ => true,
    };
    if apply_feedback && surface_active {
        if let Some(primary) = completion.primary {
            let _ =
                primary.map(|outcome| outcome.store(&mut app.chat_widget.primary_clipboard_lease));
        }
    }
    if !apply_feedback || !surface_active {
        return;
    }
    match context {
        PendingCopyContext::LastResponse => match status {
            Ok(crate::clipboard_copy::CopyStatus::Confirmed) => {
                app.projection.set_status("copied last response");
            }
            Ok(crate::clipboard_copy::CopyStatus::Unconfirmed) => {
                app.projection.set_status("copy unconfirmed");
            }
            Err(error) => app.projection.set_status(format!("copy failed: {error}")),
        },
        PendingCopyContext::ComposerSelection { clear_selection } => match status {
            Ok(crate::clipboard_copy::CopyStatus::Confirmed) => {
                if clear_selection {
                    app.chat_widget.bottom_pane.clear_mouse_selection();
                }
                app.projection.set_status("copy confirmed");
            }
            Ok(crate::clipboard_copy::CopyStatus::Unconfirmed) => {
                app.projection.set_status("copy unconfirmed");
            }
            Err(error) => app.projection.set_status(format!("copy failed: {error}")),
        },
        PendingCopyContext::TranscriptSelection {
            text,
            follow,
            target,
        } => {
            let characters = text.chars().count();
            match target {
                crate::app::TranscriptSelectionTarget::MainTranscript => {
                    app.chat_widget
                        .transcript_composer_gap
                        .show_copy_feedback(&status, characters);
                    if matches!(status, Ok(crate::clipboard_copy::CopyStatus::Confirmed)) {
                        app.finish_main_transcript_selection(follow);
                    }
                }
                crate::app::TranscriptSelectionTarget::MainPager => {
                    if let Some(pager) = app.chat_widget.pager_overlay.as_mut() {
                        pager.apply_transcript_copy_result(follow, characters, &status);
                    }
                }
                crate::app::TranscriptSelectionTarget::ResumePicker => {
                    if let Some(picker) = app.chat_widget.resume_picker_mut() {
                        picker.apply_transcript_copy_result(follow, characters, &status);
                    }
                }
            }
            match status {
                Ok(crate::clipboard_copy::CopyStatus::Confirmed) => {
                    app.projection
                        .set_status(format!("copy confirmed: {characters}"));
                }
                Ok(crate::clipboard_copy::CopyStatus::Unconfirmed) => {
                    app.projection.set_status("copy unconfirmed");
                }
                Err(error) => app.projection.set_status(format!("copy failed: {error}")),
            }
        }
        PendingCopyContext::ExportClipboard => match status {
            Ok(crate::clipboard_copy::CopyStatus::Confirmed) => app
                .projection
                .set_status("exported conversation to clipboard"),
            Ok(crate::clipboard_copy::CopyStatus::Unconfirmed) => {
                app.projection.set_status("copy unconfirmed");
            }
            Err(error) => app.projection.set_status(format!("export failed: {error}")),
        },
    }
}

#[cfg(test)]
fn copy_last_response_with(
    app: &mut App,
    copy: impl FnOnce(&str) -> Result<crate::clipboard_copy::CopyOutcome, String>,
) {
    let response = app.projection.final_answer();
    let response = crate::markdown_render::followup_labels(&response);
    if response.is_empty() {
        app.projection.set_status("no agent response to copy");
        return;
    }
    match copy(response.as_ref()) {
        Ok(outcome) => match outcome.store(&mut app.chat_widget.clipboard_lease) {
            crate::clipboard_copy::CopyStatus::Confirmed => {
                app.projection.set_status("copied last response");
            }
            crate::clipboard_copy::CopyStatus::Unconfirmed => {
                app.projection.set_status("copy unconfirmed");
            }
        },
        Err(error) => app.projection.set_status(format!("copy failed: {error}")),
    }
}

#[cfg(test)]
fn copy_composer_selection_with(
    app: &mut App,
    text: &str,
    clear_selection: bool,
    copy: impl FnOnce(&str) -> Result<crate::clipboard_copy::CopyOutcome, String>,
) {
    match copy(text) {
        Ok(outcome) => match outcome.store(&mut app.chat_widget.clipboard_lease) {
            crate::clipboard_copy::CopyStatus::Confirmed => {
                if clear_selection {
                    app.chat_widget.bottom_pane.clear_mouse_selection();
                }
                app.projection
                    .set_status(format!("copy confirmed: {}", text.chars().count()));
            }
            crate::clipboard_copy::CopyStatus::Unconfirmed => {
                app.projection.set_status("copy unconfirmed");
            }
        },
        Err(error) => app.projection.set_status(format!("copy failed: {error}")),
    }
}

pub(crate) fn open_link(destination: &str) -> Result<(), String> {
    open_link_with(destination, |destination| {
        webbrowser::open(destination).map_err(|error| error.to_string())
    })
}

fn open_link_with(
    destination: &str,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let destination = crate::terminal_hyperlinks::web_destination(destination)
        .ok_or_else(|| "link destination must be a valid HTTP(S) URL".to_string())?;
    open(&destination)
}

#[cfg(test)]
fn copy_transcript_selection_with(
    app: &mut App,
    text: &str,
    follow: bool,
    target: crate::app::TranscriptSelectionTarget,
    copy: impl FnOnce(&str) -> Result<crate::clipboard_copy::CopyOutcome, String>,
) {
    let characters = text.chars().count();
    let result = copy(text).map(|outcome| outcome.store(&mut app.chat_widget.clipboard_lease));
    // Codex keeps the X11 PRIMARY selection available while the user keeps a transcript
    // selection active. It is independent from CLIPBOARD, so retain a second lease instead of
    // replacing the normal copy lease. Unsupported/remote terminals fail closed and keep the
    // regular copy result authoritative.
    if !follow
        && matches!(
            target,
            crate::app::TranscriptSelectionTarget::MainTranscript
                | crate::app::TranscriptSelectionTarget::MainPager
        )
    {
        if let Ok(outcome) = crate::clipboard_copy::copy_to_primary(text) {
            let _ = outcome.store(&mut app.chat_widget.primary_clipboard_lease);
        }
    }
    match target {
        crate::app::TranscriptSelectionTarget::MainTranscript => {
            app.chat_widget
                .transcript_composer_gap
                .show_copy_feedback(&result, characters);
            if matches!(result, Ok(crate::clipboard_copy::CopyStatus::Confirmed)) {
                app.finish_main_transcript_selection(follow);
            }
        }
        crate::app::TranscriptSelectionTarget::MainPager => {
            if let Some(pager) = app.chat_widget.pager_overlay.as_mut() {
                pager.apply_transcript_copy_result(follow, characters, &result);
            }
        }
        crate::app::TranscriptSelectionTarget::ResumePicker => {
            if let Some(picker) = app.chat_widget.resume_picker_mut() {
                picker.apply_transcript_copy_result(follow, characters, &result);
            }
        }
    }
    match result {
        Ok(crate::clipboard_copy::CopyStatus::Confirmed) => {
            app.projection
                .set_status(format!("copy confirmed: {characters}"));
        }
        Ok(crate::clipboard_copy::CopyStatus::Unconfirmed) => {
            app.projection.set_status("copy unconfirmed");
        }
        Err(error) => app.projection.set_status(format!("copy failed: {error}")),
    }
}

async fn prepare_export_transcript(
    app: &mut App,
    session: &AppServerSession,
    path: Option<std::path::PathBuf>,
) -> Option<String> {
    let live_entries = app.projection.entries();
    let entries = match session.thread_id() {
        Ok(thread_id) => match crate::thread_transcript::load_session_transcript(
            session.request_handle(),
            thread_id.to_string(),
            app.projection.show_raw_agent_reasoning(),
        )
        .await
        {
            Ok(entries) => merge_export_entries(entries, live_entries),
            Err(_) => live_entries.to_vec(),
        },
        Err(_) => live_entries.to_vec(),
    };
    let markdown = match crate::app::transcript_export::render_markdown_transcript(&entries) {
        Ok(markdown) => markdown,
        Err(error) => {
            app.projection.set_status(format!("export failed: {error}"));
            return None;
        }
    };
    match path {
        Some(path) => {
            match crate::app::transcript_export::write_transcript(&app.cwd, &path, &markdown) {
                Ok(path) => app
                    .projection
                    .set_status(format!("exported conversation to {}", path.display())),
                Err(error) => app.projection.set_status(format!("export failed: {error}")),
            }
            None
        }
        None => Some(markdown),
    }
}

fn merge_export_entries(
    mut persisted: Vec<TranscriptEntry>,
    live: &[TranscriptEntry],
) -> Vec<TranscriptEntry> {
    for live_entry in live {
        if let Some(persisted_entry) = persisted
            .iter_mut()
            .find(|persisted_entry| persisted_entry.id == live_entry.id)
        {
            *persisted_entry = live_entry.clone();
        } else {
            persisted.push(live_entry.clone());
        }
    }
    persisted
}

pub(crate) async fn connect_session(options: &TuiOptions) -> Result<AppServerSession> {
    if let Some(remote) = options.remote.clone() {
        AppServerSession::connect_remote(remote).await
    } else {
        AppServerSession::connect(stdio_config(options)?).await
    }
}

pub(crate) fn stdio_config(options: &TuiOptions) -> Result<StdioTransportConfig> {
    validate_model_route(options)?;
    let mut config = StdioTransportConfig::runtime(&options.app_server_bin);
    config.args.extend(options.app_server_args.iter().cloned());
    Ok(config)
}

#[cfg(test)]
#[path = "runtime_pty_tests.rs"]
mod pty_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::{EntryKind, EntryStatus};
    use app_server_protocol::protocol::v2::AgentMessageDeltaNotification;
    use crossterm::event::{Event, MouseButton, MouseEvent, MouseEventKind};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use std::cell::RefCell;
    use std::ffi::OsString;

    fn transcript_entry(id: &str, text: &str, status: Option<EntryStatus>) -> TranscriptEntry {
        TranscriptEntry {
            id: id.to_string(),
            kind: EntryKind::Assistant,
            text: text.to_string(),
            streaming: status == Some(EntryStatus::Running),
            status,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }
    }

    fn app_with_transcript_selection() -> App {
        let mut pager = crate::pager_overlay::PagerOverlay::transcript(crate::locale::Locale::EnUs);
        let lines = vec![crate::terminal_hyperlinks::HyperlinkLine::from(
            "alpha beta",
        )];
        let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
        terminal
            .draw(|frame| {
                pager.render(frame, frame.area(), crate::locale::Locale::EnUs, &lines);
            })
            .expect("draw");
        for (kind, column) in [
            (MouseEventKind::Down(MouseButton::Left), 0),
            (MouseEventKind::Drag(MouseButton::Left), 5),
            (MouseEventKind::Up(MouseButton::Left), 5),
        ] {
            assert_eq!(
                pager.handle_event(&Event::Mouse(MouseEvent {
                    kind,
                    column,
                    row: 1,
                    modifiers: crossterm::event::KeyModifiers::NONE,
                })),
                crate::pager_overlay::PagerAction::Consumed
            );
        }
        assert!(pager.has_transcript_selection());
        let mut app = App::default();
        app.chat_widget.set_pager_overlay(pager);
        app
    }

    fn app_with_main_transcript_selection() -> App {
        let app = App::default();
        let lines = vec![crate::terminal_hyperlinks::HyperlinkLine::from(
            "alpha beta",
        )];
        app.chat_widget.transcript_selection.update_layout(
            ratatui::layout::Rect::new(0, 0, 40, 3),
            0,
            &lines,
        );
        assert_eq!(
            app.chat_widget
                .transcript_selection
                .handle_event(&Event::Key(crossterm::event::KeyEvent::new(
                    crossterm::event::KeyCode::Char(' '),
                    crossterm::event::KeyModifiers::CONTROL,
                ),)),
            Some(crate::transcript_view::TranscriptSelectionAction::Consumed)
        );
        for _ in 0..5 {
            app.chat_widget
                .transcript_selection
                .handle_event(&Event::Key(crossterm::event::KeyEvent::new(
                    crossterm::event::KeyCode::Right,
                    crossterm::event::KeyModifiers::NONE,
                )));
        }
        app.chat_widget
            .transcript_selection
            .note_resume_distance_from_bottom(4);
        app
    }

    #[test]
    fn export_merge_keeps_persisted_order_and_latest_live_entries() {
        let persisted = vec![
            transcript_entry("history", "older", Some(EntryStatus::Completed)),
            transcript_entry("shared", "persisted", Some(EntryStatus::Completed)),
        ];
        let live = vec![
            transcript_entry("shared", "streaming", Some(EntryStatus::Running)),
            transcript_entry("live", "new", Some(EntryStatus::Running)),
        ];

        let merged = merge_export_entries(persisted, &live);

        assert_eq!(
            merged
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["history", "shared", "live"]
        );
        assert_eq!(merged[1].text, "streaming");
        assert_eq!(merged[1].status, Some(EntryStatus::Running));
        assert_eq!(merged[2], live[1]);
    }

    #[test]
    fn model_route_requires_model_and_provider_together() {
        let options = TuiOptions {
            app_server_bin: PathBuf::from("app-server"),
            app_server_args: Vec::new(),
            remote: None,
            cwd: PathBuf::from("."),
            model: Some("gpt-test".to_string()),
            model_provider: None,
            reasoning_effort: None,
            permissions: None,
            approval_policy: None,
            approvals_reviewer: None,
            sandbox_policy: None,
            locale: None,
            resume_thread: None,
        };

        assert_eq!(
            validate_model_route(&options)
                .expect_err("partial route must fail")
                .to_string(),
            "--model and --provider must be specified together"
        );
    }

    #[test]
    fn successful_history_retry_clears_only_the_history_page_error() {
        let mut app = App::default();
        app.projection
            .set_status("history page failed: transport unavailable");

        clear_history_page_error(&mut app);

        assert_eq!(app.projection.status(), "ready");

        app.projection.set_status("running");
        clear_history_page_error(&mut app);
        assert_eq!(app.projection.status(), "running");
    }

    #[test]
    fn stdio_config_appends_host_arguments_after_the_current_runtime_default() {
        let options = TuiOptions {
            app_server_bin: PathBuf::from("custom-app-server"),
            app_server_args: vec![OsString::from("--backend"), OsString::from("external")],
            remote: None,
            cwd: PathBuf::from("."),
            model: Some("fixture-model".to_string()),
            model_provider: Some("fixture-provider".to_string()),
            reasoning_effort: None,
            permissions: None,
            approval_policy: None,
            approvals_reviewer: None,
            sandbox_policy: None,
            locale: None,
            resume_thread: None,
        };

        let config = stdio_config(&options).expect("stdio config");
        assert_eq!(
            config.args,
            vec![
                OsString::from("--stdio"),
                OsString::from("--backend"),
                OsString::from("runtime"),
                OsString::from("--backend"),
                OsString::from("external"),
            ]
        );
    }

    #[test]
    fn copy_uses_last_canonical_agent_markdown_and_reports_outcome() {
        let mut app = App::default();
        app.projection.apply(ServerNotification::AgentMessageDelta(
            AgentMessageDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "message-1".to_string(),
                delta: "**answer** with `code` :codex-followup[continue]{prompt=\"private\"}"
                    .to_string(),
            },
        ));
        let copied = RefCell::new(String::new());

        copy_last_response_with(&mut app, |text| {
            copied.replace(text.to_string());
            Ok(crate::clipboard_copy::CopyOutcome::Copied(Some(
                crate::clipboard_copy::ClipboardLease::test(),
            )))
        });

        assert_eq!(copied.into_inner(), "**answer** with `code` continue");
        assert_eq!(app.projection.status(), "copied last response");
        assert!(app.chat_widget.clipboard_lease.is_some());

        let mut empty = App::default();
        copy_last_response_with(&mut empty, |_| panic!("clipboard must not be called"));
        assert_eq!(empty.projection.status(), "no agent response to copy");
    }

    #[test]
    fn composer_copy_clears_selection_only_after_confirmation() {
        use crossterm::event::{
            KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
        };
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;

        let mut app = App::default();
        app.chat_widget.bottom_pane.insert_str("hello world");
        let area = Rect::new(0, 0, 20, 1);
        let mut buffer = Buffer::empty(area);
        app.chat_widget
            .bottom_pane
            .render_composer_textarea(area, &mut buffer);
        for (kind, column) in [
            (MouseEventKind::Down(MouseButton::Left), 1),
            (MouseEventKind::Drag(MouseButton::Left), 5),
            (MouseEventKind::Up(MouseButton::Left), 5),
        ] {
            assert!(app.chat_widget.bottom_pane.handle_mouse(MouseEvent {
                kind,
                column,
                row: 0,
                modifiers: KeyModifiers::NONE,
            }));
        }

        copy_composer_selection_with(&mut app, "ello", true, |_| {
            Ok(crate::clipboard_copy::CopyOutcome::Requested)
        });
        assert_eq!(app.projection.status(), "copy unconfirmed");
        assert!(app
            .chat_widget
            .bottom_pane
            .copy_selection_request(&TuiEvent::Key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT,
            )))
            .is_some());

        copy_composer_selection_with(&mut app, "ello", true, |_| {
            Ok(crate::clipboard_copy::CopyOutcome::Copied(Some(
                crate::clipboard_copy::ClipboardLease::test(),
            )))
        });

        assert!(app.chat_widget.clipboard_lease.is_some());
        assert_eq!(app.projection.status(), "copy confirmed: 4");
        assert!(app
            .chat_widget
            .bottom_pane
            .copy_selection_request(&TuiEvent::Key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT,
            )))
            .is_none());
    }

    #[test]
    fn transcript_copy_clears_selection_only_after_success() {
        let mut app = app_with_transcript_selection();
        let copied = RefCell::new(String::new());
        copy_transcript_selection_with(
            &mut app,
            "alpha",
            false,
            crate::app::TranscriptSelectionTarget::MainPager,
            |text| {
                copied.replace(text.to_string());
                Ok(crate::clipboard_copy::CopyOutcome::Copied(Some(
                    crate::clipboard_copy::ClipboardLease::test(),
                )))
            },
        );

        assert_eq!(copied.into_inner(), "alpha");
        assert!(app.chat_widget.clipboard_lease.is_some());
        assert_eq!(app.projection.status(), "copy confirmed: 5");
        assert!(!app
            .chat_widget
            .pager_overlay
            .as_ref()
            .expect("pager")
            .has_transcript_selection());

        let mut failed = app_with_transcript_selection();
        copy_transcript_selection_with(
            &mut failed,
            "alpha",
            true,
            crate::app::TranscriptSelectionTarget::MainPager,
            |_| Err("offline".to_string()),
        );
        assert_eq!(failed.projection.status(), "copy failed: offline");
        assert!(failed
            .chat_widget
            .pager_overlay
            .as_ref()
            .expect("pager")
            .has_transcript_selection());

        let mut unconfirmed = app_with_transcript_selection();
        copy_transcript_selection_with(
            &mut unconfirmed,
            "alpha",
            true,
            crate::app::TranscriptSelectionTarget::MainPager,
            |_| Ok(crate::clipboard_copy::CopyOutcome::Requested),
        );
        assert_eq!(unconfirmed.projection.status(), "copy unconfirmed");
        let pager = unconfirmed
            .chat_widget
            .pager_overlay
            .as_ref()
            .expect("pager");
        assert!(pager.has_transcript_selection());
    }

    #[test]
    fn main_transcript_copy_preserves_reading_position_unless_enter_follows() {
        let mut confirmed = app_with_main_transcript_selection();
        copy_transcript_selection_with(
            &mut confirmed,
            "alpha",
            false,
            crate::app::TranscriptSelectionTarget::MainTranscript,
            |_| {
                Ok(crate::clipboard_copy::CopyOutcome::Copied(Some(
                    crate::clipboard_copy::ClipboardLease::test(),
                )))
            },
        );
        assert!(!confirmed.chat_widget.transcript_selection.is_active());
        assert_eq!(confirmed.chat_widget.transcript_scroll, 4);

        let mut failed = app_with_main_transcript_selection();
        copy_transcript_selection_with(
            &mut failed,
            "alpha",
            false,
            crate::app::TranscriptSelectionTarget::MainTranscript,
            |_| Err("offline".to_string()),
        );
        assert!(failed.chat_widget.transcript_selection.is_active());

        let mut unconfirmed = app_with_main_transcript_selection();
        copy_transcript_selection_with(
            &mut unconfirmed,
            "alpha",
            true,
            crate::app::TranscriptSelectionTarget::MainTranscript,
            |_| Ok(crate::clipboard_copy::CopyOutcome::Requested),
        );
        assert!(unconfirmed.chat_widget.transcript_selection.is_active());

        let mut follow = app_with_main_transcript_selection();
        follow.chat_widget.transcript_scroll = 9;
        copy_transcript_selection_with(
            &mut follow,
            "alpha",
            true,
            crate::app::TranscriptSelectionTarget::MainTranscript,
            |_| {
                Ok(crate::clipboard_copy::CopyOutcome::Copied(Some(
                    crate::clipboard_copy::ClipboardLease::test(),
                )))
            },
        );
        assert!(!follow.chat_widget.transcript_selection.is_active());
        assert_eq!(follow.chat_widget.transcript_scroll, 0);
    }

    #[test]
    fn transcript_link_opening_validates_destination_and_propagates_failure() {
        let opened = RefCell::new(String::new());
        open_link_with("https://example.com/docs", |destination| {
            opened.replace(destination.to_string());
            Ok(())
        })
        .expect("valid destination");
        assert_eq!(opened.into_inner(), "https://example.com/docs");

        assert_eq!(
            open_link_with("file:///tmp/private", |_| panic!("must fail closed")),
            Err("link destination must be a valid HTTP(S) URL".to_string())
        );
        assert_eq!(
            open_link_with("https://example.com", |_| Err(
                "browser unavailable".to_string()
            )),
            Err("browser unavailable".to_string())
        );
    }
}
