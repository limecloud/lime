use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use anyhow::{Context, Result};
use app_server_client::AppServerEvent;
use futures::StreamExt;

use crate::app::event_dispatch::{EventContext, EventDispatch};
use crate::app::reconnect::{reconnect_session, ReconnectedSession};
use crate::app::AppAction;
use crate::app_server_session::AppServerSession;
use crate::chatwidget::ExternalEditorState;
use crate::resume_picker::{
    PickerAction, PickerLoadEvent, PickerState, SessionPickerAction, SessionStatus,
};
use crate::settings::{parse_settings_command, SettingsCommand};
use crate::tui::{Tui, TuiEvent};
use crate::view;

pub(crate) mod actions;
pub(crate) mod connection;
mod file_search;
mod history;
mod input_submission;
mod render;
pub(crate) mod resume;
mod startup;

use actions::{is_no_active_turn_error, open_link, prepare_export_transcript};
use connection::TuiOptions;
use file_search::{spawn_file_search, FileSearchEvent};
use history::{
    clear_history_page_error, complete_history_load, current_transcript_page_size,
    fail_history_load, history_top_up_needed,
};

pub async fn run_tui(options: TuiOptions) -> Result<()> {
    let (app_event_tx, mut app_event_rx) = tokio::sync::mpsc::unbounded_channel();
    let app_event_tx = crate::app_event_sender::AppEventSender::new(app_event_tx);
    let startup::InitializedApp {
        mut app,
        session,
        settings,
    } = startup::initialize_app(&options, &app_event_tx).await?;
    let mut session = Some(session);
    let mut message_history = crate::app::message_history::MessageHistory::default();
    let approval_policy = settings.approval_policy;
    let mut approvals_reviewer = settings.approvals_reviewer;
    let mut sandbox_policy = settings.sandbox_policy;
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
                            approvals_reviewer,
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
            if std::mem::take(&mut draw_requested) {
                render::draw(&mut terminal, &app)?;
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
                                            if let Some(pager) = app.chat_widget.pager_overlay.as_ref().filter(|pager| pager.is_transcript()) {
                                                pager.complete_older_history_load();
                                            }
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
                                crate::app::agents_overview_loading::draw(
                                    &mut terminal,
                                    &app,
                                )
                                .context("failed to render archived session loading state")?;
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
                    let input_at = input.input_time();
                    terminal.screen_size_for_event(&event)?;
                    let event = match event {
                        TuiEvent::Draw => {
                            if app.projection.active_turn_id().is_some() {
                                frame_requester.schedule_frame_in(render::ACTIVE_TURN_FRAME_INTERVAL);
                            }
                            TuiEvent::Draw
                        }
                        TuiEvent::Resize(size) => {
                            history_top_up_requested = true;
                            TuiEvent::Resize(size)
                        }
                        event => event,
                    };
                    let connected = session.is_some();
                    let is_draw = matches!(&event, TuiEvent::Draw);
                    if !is_draw {
                        frame_requester.schedule_frame();
                    }
                    let event_for_clipboard = event.clone();
                    app.invalidate_clipboard_paste(&event_for_clipboard);
                    let action = if is_draw {
                        let Some(action) = render::prepare_draw(
                            &mut app, connected, &frame_requester, std::time::Instant::now(),
                            input_at,
                        ) else { continue; };
                        draw_requested = true;
                        action
                    } else {
                        app.handle_tui_event_runtime(event, connected, input_at)
                    };
                    if is_draw {
                        app.finish_clipboard(&mut terminal);
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
                        AppAction::CopyLastResponse => app.copy_last_response(&mut terminal),
                        AppAction::SelectTranscriptCopy => app.select_transcript_copy(),
                        AppAction::CopySelection { text, label, format } => {
                            app.copy_selection(&mut terminal, text, label, format);
                        }
                        AppAction::CopyComposerSelection { text } => {
                            app.copy_composer_selection(&mut terminal, text);
                        }
                        AppAction::CopyTranscriptSelection { text, format, follow, target } => {
                            app.copy_transcript_selection(&mut terminal, text, format, follow, target);
                        }
                        AppAction::PublishPrimarySelection { target } => {
                            app.publish_primary_selection(&mut terminal, target);
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
                                app.copy_export(&mut terminal, markdown);
                            }
                        }
                        AppAction::PasteImage => app.paste_image(&terminal),
                        AppAction::PasteClipboardText(source) => {
                            app.paste_clipboard_text(&mut terminal, source);
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
                            let mode = app.history_load_mode();
                            if let Some(pager) = app.chat_widget.pager_overlay.as_ref() {
                                pager.begin_older_history_load();
                            }
                            if app.transcript_view.search.is_active() {
                                app.transcript_view.search.begin_history_load();
                            }
                            history_load_all_requested = mode == crate::app_event::OlderHistoryLoadMode::All;
                            if let Some(active_session) = session.as_mut() {
                                if app.spawn_older_history_page_load(
                                    active_session,
                                    &app_event_tx,
                                    mode,
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
                        AppAction::ArchiveThread => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_archive(thread_id)
                                .await
                            {
                                Ok(()) => {
                                    let archived =
                                        app.chat_widget.locale.archived_thread().to_string();
                                    match app
                                        .start_new_thread(
                                            session.as_mut().expect("session available during TUI"),
                                        )
                                        .await
                                    {
                                        Ok(()) => app.projection.set_status(archived),
                                        Err(error) => app
                                            .projection
                                            .set_status(format!("{archived}; {error}")),
                                    }
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ListExperimentalFeatures => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .experimental_feature_list()
                                .await
                            {
                                Ok(response) => {
                                    let locale = app.chat_widget.locale;
                                    let mut lines: Vec<ratatui::text::Line<'static>> = response
                                        .data
                                        .iter()
                                        .map(|feature| {
                                            let state = if feature.enabled {
                                                locale.experimental_enabled_label()
                                            } else {
                                                locale.experimental_disabled_label()
                                            };
                                            let name = feature
                                                .display_name
                                                .clone()
                                                .unwrap_or_else(|| feature.name.clone());
                                            let description =
                                                feature.description.clone().unwrap_or_default();
                                            ratatui::text::Line::from(format!(
                                                "• {name} ({}) — {state} · {description}",
                                                feature.name
                                            ))
                                        })
                                        .collect();
                                    if lines.is_empty() {
                                        lines.push(ratatui::text::Line::from(
                                            locale.experimental_empty_message(),
                                        ));
                                    }
                                    app.chat_widget.open_text_pager(
                                        locale.experimental_title().to_string(),
                                        lines,
                                    );
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::SetExperimentalFeature { name, enabled } => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .experimental_feature_set(name.clone(), enabled)
                                .await
                            {
                                Ok(()) => app.projection.set_status(
                                    app.chat_widget.locale.experimental_updated(&name, enabled),
                                ),
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::SelectPermissions(profile) => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .update_settings(None, None, None, Some(profile.clone()))
                                .await
                            {
                                Ok(()) => {
                                    app.chat_widget.apply_permissions(profile);
                                    app.projection.set_status("settings updated");
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::SelectEffort(value) => {
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
                        AppAction::ResetMemory => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .memory_reset()
                                .await
                            {
                                Ok(()) => app
                                    .projection
                                    .set_status(app.chat_widget.locale.memory_reset_done()),
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ChangeWorkingDirectory(path) => {
                            let locale = app.chat_widget.locale;
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status(locale.cd_requires_session());
                                continue;
                            };
                            if app.projection.active_turn_id().is_some()
                                || !app.chat_widget.queued_submissions.is_empty()
                            {
                                app.projection.set_status(locale.cd_requires_idle());
                                continue;
                            }
                            if !path.is_dir() {
                                let display = path.display().to_string();
                                app.projection
                                    .set_status(locale.cd_not_a_directory(&display));
                                continue;
                            }
                            let requested = path.display().to_string();
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .update_thread_cwd(thread_id, requested.clone())
                                .await
                            {
                                Ok(_) => {
                                    let changed = crate::app::working_directory::sync_server_cwd(
                                        &mut app,
                                        &requested,
                                    );
                                    app.projection.set_status(if changed {
                                        locale.cd_changed(&requested)
                                    } else {
                                        locale.cd_unchanged().to_string()
                                    });
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::SetMemoryMode(enabled) => {
                            let locale = app.chat_widget.locale;
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection
                                    .set_status(locale.memory_requires_session());
                                continue;
                            };
                            let mode = if enabled {
                                app_server_protocol::protocol::v2::ThreadMemoryMode::Enabled
                            } else {
                                app_server_protocol::protocol::v2::ThreadMemoryMode::Disabled
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_memory_mode_set(thread_id, mode)
                                .await
                            {
                                Ok(_) => {
                                    app.chat_widget.memory_mode = Some(enabled);
                                    app.projection.set_status(if enabled {
                                        locale.memory_mode_enabled()
                                    } else {
                                        locale.memory_mode_disabled()
                                    });
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::GoalCommand(command) => {
                            let locale = app.chat_widget.locale;
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status(locale.goal_requires_session());
                                continue;
                            };
                            let session_ref = session
                                .as_ref()
                                .expect("session available during TUI");
                            match command.as_str() {
                                "show" => {
                                    match session_ref.thread_goal_get(thread_id).await {
                                        Ok(response) => {
                                            let lines: Vec<ratatui::text::Line<'static>> =
                                                match response.goal {
                                                    Some(goal) => {
                                                        let status = match goal.status {
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::Active => {
                                                                locale.goal_status_active()
                                                            }
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::Paused => {
                                                                locale.goal_status_paused()
                                                            }
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::Blocked => {
                                                                locale.goal_status_blocked()
                                                            }
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::UsageLimited => {
                                                                locale.goal_status_usage_limited()
                                                            }
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::BudgetLimited => {
                                                                locale.goal_status_budget_limited()
                                                            }
                                                            app_server_protocol::protocol::v2::ThreadGoalStatus::Complete => {
                                                                locale.goal_status_complete()
                                                            }
                                                        };
                                                        let mut lines = vec![
                                                            ratatui::text::Line::from(format!(
                                                                "{}: {}",
                                                                locale.goal_objective_label(),
                                                                goal.objective
                                                            )),
                                                            ratatui::text::Line::from(format!(
                                                                "{}: {status}",
                                                                locale.goal_status_label()
                                                            )),
                                                            ratatui::text::Line::from(format!(
                                                                "{}: {}",
                                                                locale.goal_tokens_label(),
                                                                goal.tokens_used
                                                            )),
                                                            ratatui::text::Line::from(format!(
                                                                "{}: {}s",
                                                                locale.goal_time_label(),
                                                                goal.time_used_seconds
                                                            )),
                                                        ];
                                                        if let Some(budget) = goal.token_budget {
                                                            lines.push(ratatui::text::Line::from(
                                                                format!(
                                                                    "budget: {budget}"
                                                                ),
                                                            ));
                                                        }
                                                        lines
                                                    }
                                                    None => vec![ratatui::text::Line::from(
                                                        locale.goal_none(),
                                                    )],
                                                };
                                            app.chat_widget.open_text_pager(
                                                locale.goal_title().to_string(),
                                                lines,
                                            );
                                        }
                                        Err(error) => {
                                            app.projection.set_status(error.to_string())
                                        }
                                    }
                                }
                                "clear" => {
                                    match session_ref.thread_goal_clear(thread_id).await {
                                        Ok(_) => {
                                            app.projection.set_status(locale.goal_cleared())
                                        }
                                        Err(error) => {
                                            app.projection.set_status(error.to_string())
                                        }
                                    }
                                }
                                "pause" => {
                                    match session_ref
                                        .thread_goal_set(
                                            thread_id,
                                            None,
                                            Some(app_server_protocol::protocol::v2::ThreadGoalStatus::Paused),
                                        )
                                        .await
                                    {
                                        Ok(_) => {
                                            app.projection.set_status(locale.goal_paused())
                                        }
                                        Err(error) => {
                                            app.projection.set_status(error.to_string())
                                        }
                                    }
                                }
                                "resume" => {
                                    match session_ref
                                        .thread_goal_set(
                                            thread_id,
                                            None,
                                            Some(app_server_protocol::protocol::v2::ThreadGoalStatus::Active),
                                        )
                                        .await
                                    {
                                        Ok(_) => {
                                            app.projection.set_status(locale.goal_resumed())
                                        }
                                        Err(error) => {
                                            app.projection.set_status(error.to_string())
                                        }
                                    }
                                }
                                other if other.starts_with("set:") => {
                                    let objective =
                                        other.trim_start_matches("set:").to_string();
                                    match session_ref
                                        .thread_goal_set(thread_id, Some(objective), None)
                                        .await
                                    {
                                        Ok(_) => app.projection.set_status(locale.goal_set()),
                                        Err(error) => {
                                            app.projection.set_status(error.to_string())
                                        }
                                    }
                                }
                                _ => app.projection.set_status(locale.goal_usage()),
                            }
                        }
                        AppAction::InsertComposerText(text) => {
                            app.chat_widget.bottom_pane.insert_str(&text);
                        }
                        AppAction::ListPlugins => {
                            let locale = app.chat_widget.locale;
                            let cwd = app.cwd.clone();
                            let installed = match session.as_ref() {
                                Some(session) => {
                                    match tokio::time::timeout(
                                        std::time::Duration::from_secs(5),
                                        session.plugin_installed(cwd),
                                    )
                                    .await
                                    {
                                        Ok(result) => result.map_err(|error| error.to_string()),
                                        Err(_) => Err("plugin list timed out".to_string()),
                                    }
                                }
                                None => Err("session unavailable".to_string()),
                            };
                            let (entries, message) = match installed {
                                Ok(response) => {
                                    let mut entries = Vec::new();
                                    for marketplace in response.marketplaces {
                                        for plugin in marketplace.plugins {
                                            if !plugin.installed {
                                                continue;
                                            }
                                            let name = plugin
                                                .interface
                                                .as_ref()
                                                .and_then(|interface| {
                                                    interface.display_name.clone()
                                                })
                                                .unwrap_or(plugin.name.clone());
                                            let version = plugin
                                                .version
                                                .or(plugin.local_version)
                                                .unwrap_or_else(|| "?".to_string());
                                            entries.push(crate::app::plugin_picker::PluginEntry {
                                                id: plugin.id,
                                                name,
                                                version,
                                                enabled: plugin.enabled,
                                            });
                                        }
                                    }
                                    (entries, None)
                                }
                                Err(error) => (
                                    Vec::new(),
                                    Some(locale.plugins_unavailable(&error)),
                                ),
                            };
                            app.chat_widget.open_plugin_picker(
                                crate::app::plugin_picker::PluginPicker::new(entries, message),
                            );
                        }
                        AppAction::SearchPlugins(term) => {
                            let locale = app.chat_widget.locale;
                            let cwd = app.cwd.clone();
                            let results = match session.as_ref() {
                                Some(session) => {
                                    match tokio::time::timeout(
                                        std::time::Duration::from_secs(5),
                                        session.plugin_search(term.clone(), cwd),
                                    )
                                    .await
                                    {
                                        Ok(result) => result.map_err(|error| error.to_string()),
                                        Err(_) => Err("plugin search timed out".to_string()),
                                    }
                                }
                                None => Err("session unavailable".to_string()),
                            };
                            let lines: Vec<ratatui::text::Line<'static>> = match results {
                                Ok(response) => {
                                    let mut lines = Vec::new();
                                    for result in response.data {
                                        let name = result
                                            .plugin
                                            .interface
                                            .as_ref()
                                            .and_then(|interface| interface.display_name.clone())
                                            .unwrap_or(result.plugin.name.clone());
                                        let state = if result.plugin.installed {
                                            format!(" · {}", locale.plugin_installed_label())
                                        } else {
                                            String::new()
                                        };
                                        lines.push(ratatui::text::Line::from(format!(
                                            "• {name} — {}{state}",
                                            result.marketplace_name
                                        )));
                                        if let Some(description) = result
                                            .plugin
                                            .interface
                                            .as_ref()
                                            .and_then(|interface| {
                                                interface.short_description.clone()
                                            })
                                        {
                                            lines.push(ratatui::text::Line::from(format!(
                                                "  {description}"
                                            )));
                                        }
                                    }
                                    if lines.is_empty() {
                                        lines.push(ratatui::text::Line::from(
                                            locale.plugins_search_empty(&term),
                                        ));
                                    }
                                    lines
                                }
                                Err(error) => vec![ratatui::text::Line::from(
                                    locale.plugins_unavailable(&error),
                                )],
                            };
                            app.chat_widget
                                .open_text_pager(locale.plugins_title().to_string(), lines);
                        }
                        AppAction::InstallPluginRequest(name) => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.plugin_install_failed("session unavailable"));
                                continue;
                            };
                            let cwd = app.cwd.clone();
                            let listed = match tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                session_ref.plugin_list(cwd),
                            )
                            .await
                            {
                                Ok(result) => result.map_err(|error| error.to_string()),
                                Err(_) => Err("plugin list timed out".to_string()),
                            };
                            match listed {
                                Ok(response) => {
                                    let mut selected = None;
                                    let mut already_installed = false;
                                    'outer: for marketplace in response.marketplaces {
                                        for plugin in marketplace.plugins {
                                            let matches = plugin.name.eq_ignore_ascii_case(&name)
                                                || plugin.id.eq_ignore_ascii_case(&name);
                                            if !matches {
                                                continue;
                                            }
                                            if plugin.installed {
                                                already_installed = true;
                                                break 'outer;
                                            }
                                            selected = Some((
                                                marketplace.name.clone(),
                                                marketplace.path.clone(),
                                                plugin.remote_release.clone(),
                                            ));
                                            break 'outer;
                                        }
                                    }
                                    if already_installed {
                                        app.projection
                                            .set_status(locale.plugin_already_installed(&name));
                                    } else if let Some((
                                        marketplace_name,
                                        marketplace_path,
                                        remote_release,
                                    )) = selected
                                    {
                                        let remote_marketplace_name = marketplace_path
                                            .is_none()
                                            .then_some(marketplace_name);
                                        app.chat_widget.open_confirm_prompt(
                                            crate::app::confirm_prompt::ConfirmPrompt::install_plugin(
                                                name.clone(),
                                                marketplace_path
                                                    .map(|path| path.to_string_lossy().into_owned()),
                                                remote_marketplace_name,
                                                remote_release,
                                            ),
                                        );
                                    } else {
                                        app.projection
                                            .set_status(locale.plugin_not_found(&name));
                                    }
                                }
                                Err(error) => app
                                    .projection
                                    .set_status(locale.plugin_install_failed(&error)),
                            }
                        }
                        AppAction::InstallPlugin {
                            plugin_name,
                            marketplace_path,
                            remote_marketplace_name,
                            remote_release,
                        } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.plugin_install_failed("session unavailable"));
                                continue;
                            };
                            match session_ref
                                .plugin_install(
                                    marketplace_path.map(std::path::PathBuf::from),
                                    remote_marketplace_name,
                                    plugin_name.clone(),
                                    remote_release,
                                )
                                .await
                            {
                                Ok(_) => app
                                    .projection
                                    .set_status(locale.plugin_installed(&plugin_name)),
                                Err(error) => app.projection.set_status(
                                    locale.plugin_install_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::UninstallPlugin { plugin_id, name } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.plugin_uninstall_failed("session unavailable"));
                                continue;
                            };
                            match session_ref.plugin_uninstall(plugin_id).await {
                                Ok(_) => app.projection.set_status(locale.plugin_uninstalled(&name)),
                                Err(error) => app
                                    .projection
                                    .set_status(locale.plugin_uninstall_failed(&format!("{error:#}"))),
                            }
                        }
                        AppAction::ShowDiff => {
                            let locale = app.chat_widget.locale;
                            let cwd = app.cwd.clone();
                            match crate::app::git_diff::collect_git_diff(&cwd).await {
                                Ok(crate::app::git_diff::DiffCollection::NotARepository) => {
                                    app.chat_widget.open_text_pager(
                                        locale.diff_title().to_string(),
                                        vec![ratatui::text::Line::from(
                                            locale.diff_not_a_repository(),
                                        )],
                                    );
                                }
                                Ok(crate::app::git_diff::DiffCollection::Clean) => {
                                    app.chat_widget.open_text_pager(
                                        locale.diff_title().to_string(),
                                        vec![ratatui::text::Line::from(locale.diff_clean())],
                                    );
                                }
                                Ok(crate::app::git_diff::DiffCollection::Diff(diff)) => {
                                    let lines: Vec<ratatui::text::Line<'static>> = diff
                                        .lines()
                                        .take(2000)
                                        .map(|line| ratatui::text::Line::from(line.to_string()))
                                        .collect();
                                    app.chat_widget.open_text_pager(
                                        locale.diff_title().to_string(),
                                        lines,
                                    );
                                }
                                Err(error) => app.projection.set_status(error),
                            }
                        }
                        AppAction::ListWarnings => {
                            let locale = app.chat_widget.locale;
                            let mut lines: Vec<ratatui::text::Line<'static>> = Vec::new();
                            for (name, error) in app.chat_widget.mcp_startup_warnings.entries() {
                                let text = match error {
                                    Some(error) => format!(
                                        "{} {name}: {error}",
                                        locale.warnings_mcp_label()
                                    ),
                                    None => format!("{} {name}", locale.warnings_mcp_label()),
                                };
                                lines.push(ratatui::text::Line::from(text));
                            }
                            for (path, message) in
                                app.chat_widget.skill_load_warnings.active_entries()
                            {
                                lines.push(ratatui::text::Line::from(format!(
                                    "{} {}: {message}",
                                    locale.warnings_skills_label(),
                                    path.display()
                                )));
                            }
                            if lines.is_empty() {
                                lines.push(ratatui::text::Line::from(locale.warnings_empty()));
                            }
                            app.chat_widget
                                .open_text_pager(locale.warnings_title().to_string(), lines);
                        }
                        AppAction::ShowUsage => {
                            let locale = app.chat_widget.locale;
                            let usage = app.status_surface_data().token_usage;
                            let lines: Vec<ratatui::text::Line<'static>> = match usage {
                                Some(usage) => {
                                    let mut lines = vec![
                                        ratatui::text::Line::from(format!(
                                            "{}: {}",
                                            locale.usage_total_label(),
                                            usage.total.total_tokens
                                        )),
                                        ratatui::text::Line::from(format!(
                                            "{}: {}",
                                            locale.usage_input_label(),
                                            usage.total.input_tokens
                                        )),
                                        ratatui::text::Line::from(format!(
                                            "{}: {}",
                                            locale.usage_output_label(),
                                            usage.total.output_tokens
                                        )),
                                        ratatui::text::Line::from(format!(
                                            "{}: {}",
                                            locale.usage_last_turn_label(),
                                            usage.last.total_tokens
                                        )),
                                    ];
                                    if let Some(window) = usage.model_context_window {
                                        lines.push(ratatui::text::Line::from(format!(
                                            "{}: {window}",
                                            locale.usage_context_window_label()
                                        )));
                                    }
                                    lines
                                }
                                None => vec![ratatui::text::Line::from(locale.usage_empty())],
                            };
                            app.chat_widget
                                .open_text_pager(locale.usage_title().to_string(), lines);
                        }
                        AppAction::ShowMemoryStatus => {
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .memory_status()
                                .await
                            {
                                Ok(status) => {
                                    let locale = app.chat_widget.locale;
                                    let ready = if status.v2_ready {
                                        locale.memory_ready_label()
                                    } else {
                                        locale.memory_not_ready_label()
                                    };
                                    let lines = vec![
                                        ratatui::text::Line::from(format!(
                                            "{}: {}",
                                            locale.memory_consolidated_label(),
                                            status.v2_consolidated_threads
                                        )),
                                        ratatui::text::Line::from(format!(
                                            "{}: {ready}",
                                            locale.memory_ready_label()
                                        )),
                                    ];
                                    app.chat_widget
                                        .open_text_pager(locale.memory_title().to_string(), lines);
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ToggleStatusLineColors => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.config_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let enabled = !app.chat_widget.tui_config.status_line_use_colors;
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "tui.status_line_use_colors".to_string(),
                                value: serde_json::json!(enabled),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(if enabled {
                                    locale.status_line_colors_enabled()
                                } else {
                                    locale.status_line_colors_disabled()
                                }),
                                Err(error) => app.projection.set_status(
                                    locale.config_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::CycleRightClickPaste => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.config_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let next = match app.chat_widget.tui_config.right_click_paste {
                                lime_core::config::RightClickPaste::Auto => {
                                    lime_core::config::RightClickPaste::On
                                }
                                lime_core::config::RightClickPaste::On => {
                                    lime_core::config::RightClickPaste::Off
                                }
                                lime_core::config::RightClickPaste::Off => {
                                    lime_core::config::RightClickPaste::Auto
                                }
                            };
                            let value = match next {
                                lime_core::config::RightClickPaste::Auto => "auto",
                                lime_core::config::RightClickPaste::On => "on",
                                lime_core::config::RightClickPaste::Off => "off",
                            };
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "tui.right_click_paste".to_string(),
                                value: serde_json::json!(value),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => {
                                    let status = match next {
                                        lime_core::config::RightClickPaste::Auto => {
                                            locale.right_click_paste_auto()
                                        }
                                        lime_core::config::RightClickPaste::On => {
                                            locale.right_click_paste_on()
                                        }
                                        lime_core::config::RightClickPaste::Off => {
                                            locale.right_click_paste_off()
                                        }
                                    };
                                    app.projection.set_status(status);
                                }
                                Err(error) => app.projection.set_status(
                                    locale.config_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::ToggleAutoRecap => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.config_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let enabled = !app.chat_widget.tui_config.auto_recap;
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "tui.auto_recap".to_string(),
                                value: serde_json::json!(enabled),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(if enabled {
                                    locale.auto_recap_enabled()
                                } else {
                                    locale.auto_recap_disabled()
                                }),
                                Err(error) => app
                                    .projection
                                    .set_status(locale.config_save_failed(&error.to_string())),
                            }
                        }
                        AppAction::ToggleAnimations => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.config_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let enabled = !app.chat_widget.tui_config.animations;
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "tui.animations".to_string(),
                                value: serde_json::json!(enabled),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(if enabled {
                                    locale.animations_enabled()
                                } else {
                                    locale.animations_disabled()
                                }),
                                Err(error) => app.projection.set_status(
                                    locale.config_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::ResetKeybinding { path } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.keymap_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let defaults = crate::keymap::RuntimeKeymap::default().describe();
                            let specs = defaults
                                .into_iter()
                                .find(|entry| entry.path == path)
                                .map(|entry| entry.specs)
                                .unwrap_or_default();
                            let value = if specs.len() == 1 {
                                serde_json::json!(specs[0])
                            } else {
                                serde_json::json!(specs)
                            };
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: path.clone(),
                                value,
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(locale.keymap_reset()),
                                Err(error) => app.projection.set_status(
                                    locale.keymap_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::UnbindKeybinding { path } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.keymap_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: path.clone(),
                                value: serde_json::json!([]),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(locale.keymap_unbound()),
                                Err(error) => app.projection.set_status(
                                    locale.keymap_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::WriteKeybinding { path, spec } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.keymap_save_failed("session unavailable"),
                                );
                                continue;
                            };
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: path.clone(),
                                value: serde_json::json!(spec),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Replace,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => app.projection.set_status(locale.keymap_saved()),
                                Err(error) => app.projection.set_status(
                                    locale.keymap_save_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::SetSkillEnabled {
                            path,
                            name,
                            enabled,
                        } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.skill_toggle_failed("session unavailable"));
                                continue;
                            };
                            match session_ref
                                .skills_config_write(path.clone(), name.clone(), enabled)
                                .await
                            {
                                Ok(response) => {
                                    let mut skills =
                                        app.chat_widget.bottom_pane.skills().to_vec();
                                    for skill in &mut skills {
                                        if skill.path == path {
                                            skill.enabled = response.effective_enabled;
                                        }
                                    }
                                    app.chat_widget.bottom_pane.set_skills(skills);
                                    app.projection.set_status(if response.effective_enabled {
                                        locale.skill_enabled(&name)
                                    } else {
                                        locale.skill_disabled(&name)
                                    });
                                }
                                Err(error) => app.projection.set_status(
                                    locale.skill_toggle_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::GenerateRecap(trigger) => {
                            let locale = app.chat_widget.locale;
                            let automatic = trigger == crate::app::recap::RecapTrigger::Automatic;
                            if app.projection.active_turn_id().is_some() {
                                if !automatic {
                                    app.projection.set_status(locale.recap_wait_for_turn());
                                }
                                continue;
                            }
                            if app.recap.is_pending() {
                                if !automatic {
                                    app.projection.set_status(locale.recap_in_progress());
                                }
                                continue;
                            }
                            let history =
                                crate::app::recap::recap_history(app.projection.entries());
                            if history.is_empty() {
                                if !automatic {
                                    app.projection.set_status(locale.recap_empty());
                                }
                                continue;
                            }
                            let Some(session_ref) = session.as_ref() else {
                                if !automatic {
                                    app.projection.set_status(locale.recap_failed());
                                }
                                continue;
                            };
                            let model = app.chat_widget.model.clone();
                            let provider = app.chat_widget.model_provider.clone();
                            let cwd = app.cwd.display().to_string();
                            match session_ref
                                .start_recap_request(model, provider, cwd, history)
                                .await
                            {
                                Ok(thread_id) => {
                                    app.recap.begin(thread_id, trigger);
                                    if !automatic {
                                        app.projection.set_status(locale.recap_generating());
                                    }
                                }
                                Err(error) => {
                                    if automatic {
                                        app.recap.schedule_retry(std::time::Instant::now());
                                    } else {
                                        app.projection.set_status(
                                            locale.recap_failed_with(&format!("{error:#}")),
                                        );
                                    }
                                }
                            }
                        }
                        AppAction::RunShellCommand(command) => {
                            let locale = app.chat_widget.locale;
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status(
                                    locale.shell_command_failed("session not started"),
                                );
                                continue;
                            };
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.shell_command_failed("session unavailable"),
                                );
                                continue;
                            };
                            match session_ref
                                .thread_shell_command(thread_id, command.clone())
                                .await
                            {
                                Ok(_) => app
                                    .projection
                                    .set_status(locale.shell_command_started(&command)),
                                Err(error) => app.projection.set_status(
                                    locale.shell_command_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::SetHookEnabled { key, enabled } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.hook_update_failed("session unavailable"));
                                continue;
                            };
                            let value = serde_json::json!({ key: { "enabled": enabled } });
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "hooks.state".to_string(),
                                value,
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Upsert,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => {
                                    app.projection
                                        .set_status(locale.hook_enabled_updated(enabled))
                                }
                                Err(error) => app.projection.set_status(
                                    locale.hook_update_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::TrustHooks { hooks } => {
                            let locale = app.chat_widget.locale;
                            if hooks.is_empty() {
                                continue;
                            }
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.hook_update_failed("session unavailable"));
                                continue;
                            };
                            let mut state = serde_json::Map::new();
                            for (key, hash) in &hooks {
                                state.insert(
                                    key.clone(),
                                    serde_json::json!({ "trusted_hash": hash }),
                                );
                            }
                            let edit = app_server_protocol::protocol::v2::ConfigEdit {
                                key_path: "hooks.state".to_string(),
                                value: serde_json::Value::Object(state),
                                merge_strategy:
                                    app_server_protocol::protocol::v2::MergeStrategy::Upsert,
                            };
                            match app.apply_tui_preferences(session_ref, vec![edit]).await {
                                Ok(()) => {
                                    app.projection.set_status(locale.hooks_trusted(hooks.len()))
                                }
                                Err(error) => app.projection.set_status(
                                    locale.hook_update_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::ListProcesses => {
                            let locale = app.chat_widget.locale;
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status(
                                    locale.ps_terminate_failed("session not started"),
                                );
                                continue;
                            };
                            let Some(session_ref) = session.as_ref() else {
                                app.projection.set_status(
                                    locale.ps_terminate_failed("session unavailable"),
                                );
                                continue;
                            };
                            match session_ref.background_terminals_list(thread_id).await {
                                Ok(response) => {
                                    let entries = response
                                        .data
                                        .into_iter()
                                        .map(|terminal| {
                                            crate::app::process_list::ProcessEntry {
                                                process_id: terminal.process_id,
                                                command: terminal.command,
                                                cwd: terminal.cwd,
                                                os_pid: terminal.os_pid,
                                                cpu_percent: terminal.cpu_percent,
                                                rss_kb: terminal.rss_kb,
                                            }
                                        })
                                        .collect();
                                    app.chat_widget.open_process_list(
                                        crate::app::process_list::ProcessList::new(entries, None),
                                    );
                                }
                                Err(error) => {
                                    let message =
                                        locale.ps_terminate_failed(&format!("{error:#}"));
                                    app.chat_widget.open_process_list(
                                        crate::app::process_list::ProcessList::new(
                                            Vec::new(),
                                            Some(message),
                                        ),
                                    );
                                }
                            }
                        }
                        AppAction::TerminateProcess {
                            thread_id,
                            process_id,
                            command,
                        } => {
                            let locale = app.chat_widget.locale;
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(locale.ps_terminate_failed("session unavailable"));
                                continue;
                            };
                            match session_ref
                                .background_terminals_terminate(thread_id, process_id)
                                .await
                            {
                                Ok(_) => app
                                    .projection
                                    .set_status(locale.ps_terminated(&command)),
                                Err(error) => app.projection.set_status(
                                    locale.ps_terminate_failed(&format!("{error:#}")),
                                ),
                            }
                        }
                        AppAction::ListHooks => {
                            let Some(session_ref) = session.as_ref() else {
                                app.projection
                                    .set_status(app.chat_widget.locale.hooks_empty());
                                continue;
                            };
                            let cwd = app.cwd.clone();
                            match session_ref
                                .hooks_list(cwd.display().to_string())
                                .await {
                                Ok(response) => {
                                    let mut events: Vec<
                                        crate::app::hooks_browser::HookEventView,
                                    > = Vec::new();
                                    for entry in response.data {
                                        let mut first_handler = true;
                                        for hook in entry.hooks {
                                            let event = serde_json::to_value(&hook.event_name)
                                                .ok()
                                                .and_then(|value| {
                                                    value.as_str().map(str::to_string)
                                                })
                                                .unwrap_or_else(|| {
                                                    format!("{:?}", hook.event_name)
                                                });
                                            let summary = match &hook.handler {
                                                app_server_protocol::protocol::v2::HookHandlerMetadata::Command {
                                                    command,
                                                    r#async,
                                                } => {
                                                    if *r#async {
                                                        format!("cmd: {command} (async)")
                                                    } else {
                                                        format!("cmd: {command}")
                                                    }
                                                }
                                                app_server_protocol::protocol::v2::HookHandlerMetadata::McpTool {
                                                    server,
                                                    tool,
                                                } => format!("mcp: {server}/{tool}"),
                                                app_server_protocol::protocol::v2::HookHandlerMetadata::Prompt {} => {
                                                    "prompt".to_string()
                                                }
                                                app_server_protocol::protocol::v2::HookHandlerMetadata::Agent {} => {
                                                    "agent".to_string()
                                                }
                                            };
                                            let handler =
                                                crate::app::hooks_browser::HookHandlerView {
                                                    key: hook.key.clone(),
                                                    summary,
                                                    source: format!("{:?}", hook.source)
                                                        .to_lowercase(),
                                                    timeout_sec: hook.timeout_sec,
                                                    enabled: hook.enabled,
                                                    needs_review: matches!(
                                                        hook.trust_status,
                                                        app_server_protocol::protocol::v2::HookTrustStatus::Untrusted
                                                            | app_server_protocol::protocol::v2::HookTrustStatus::Modified
                                                    ),
                                                    is_managed: hook.is_managed,
                                                    current_hash: hook.current_hash.clone(),
                                                    warnings: if first_handler {
                                                        entry.warnings.clone()
                                                    } else {
                                                        Vec::new()
                                                    },
                                                    errors: if first_handler {
                                                        entry
                                                            .errors
                                                            .iter()
                                                            .map(|error| error.message.clone())
                                                            .collect()
                                                    } else {
                                                        Vec::new()
                                                    },
                                                };
                                            first_handler = false;
                                            match events
                                                .iter_mut()
                                                .find(|candidate| candidate.event == event)
                                            {
                                                Some(existing) => {
                                                    existing.handlers.push(handler)
                                                }
                                                None => events.push(
                                                    crate::app::hooks_browser::HookEventView {
                                                        event,
                                                        handlers: vec![handler],
                                                    },
                                                ),
                                            }
                                        }
                                    }
                                    app.chat_widget.open_hooks_browser(events);
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::OpenConfigPanel => {
                            app.chat_widget.open_config_menu();
                        }
                        AppAction::OpenModelPicker => {
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
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::OpenEffortPicker => {
                            app.chat_widget.open_effort_picker();
                        }
                        AppAction::OpenPermissionsPicker => {
                            if app.chat_widget.permission_profiles.is_empty() {
                                app.projection.set_status(
                                    app.chat_widget.locale.permissions_picker_empty(),
                                );
                            } else {
                                app.chat_widget.open_permissions_picker();
                            }
                        }
                        AppAction::OpenTitleSetup => {
                            app.chat_widget.show_terminal_title_setup();
                        }
                        AppAction::OpenStatusLineSetup => {
                            app.chat_widget.show_status_line_setup();
                        }
                        AppAction::ClearConversation => {
                            let session = session.as_mut().expect("session available during TUI");
                            let restored = app
                                .start_new_thread(session)
                                .await
                                .map(|()| app.chat_widget.locale.cleared_conversation())
                                .map_err(|error| error.to_string());
                            match restored {
                                Ok(status) => app.projection.set_status(status),
                                Err(error) => app.projection.set_status(error),
                            }
                        }
                        AppAction::ReviewBaseBranch { branch } => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .review_start(
                                    thread_id,
                                    app_server_protocol::protocol::v2::ReviewTarget::BaseBranch {
                                        branch,
                                    },
                                )
                                .await
                            {
                                Ok(response) => {
                                    app.start_turn(response.turn.id);
                                    app.projection
                                        .set_status(app.chat_widget.locale.review_started());
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ReviewCommit { sha } => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .review_start(
                                    thread_id,
                                    app_server_protocol::protocol::v2::ReviewTarget::Commit {
                                        sha,
                                        title: None,
                                    },
                                )
                                .await
                            {
                                Ok(response) => {
                                    app.start_turn(response.turn.id);
                                    app.projection
                                        .set_status(app.chat_widget.locale.review_started());
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ReviewUncommitted => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .review_start(
                                    thread_id,
                                    app_server_protocol::protocol::v2::ReviewTarget::UncommittedChanges,
                                )
                                .await
                            {
                                Ok(response) => {
                                    app.start_turn(response.turn.id);
                                    app.projection
                                        .set_status(app.chat_widget.locale.review_started());
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::ForkThread => {
                            match app
                                .fork_current_thread(
                                    session.as_mut().expect("session available during TUI"),
                                )
                                .await
                            {
                                Ok(()) => {}
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::DeleteThread => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_delete(thread_id)
                                .await
                            {
                                Ok(()) => {
                                    let deleted =
                                        app.chat_widget.locale.deleted_thread().to_string();
                                    match app
                                        .start_new_thread(
                                            session.as_mut().expect("session available during TUI"),
                                        )
                                        .await
                                    {
                                        Ok(()) => app.projection.set_status(deleted),
                                        Err(error) => app
                                            .projection
                                            .set_status(format!("{deleted}; {error}")),
                                    }
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::CompactThread => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection.set_status("no active thread");
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_compact_start(thread_id)
                                .await
                            {
                                Ok(()) => app
                                    .projection
                                    .set_status(app.chat_widget.locale.compacting_thread()),
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::RenameThread { name } => {
                            let Some(thread_id) = app.thread_id.clone() else {
                                app.projection
                                    .set_status(app.chat_widget.locale.rename_usage());
                                continue;
                            };
                            match session
                                .as_ref()
                                .expect("session available during TUI")
                                .thread_set_name(thread_id.clone(), name.clone())
                                .await
                            {
                                Ok(()) => {
                                    app.chat_widget
                                        .set_status_thread_name(thread_id, Some(name.clone()));
                                    app.projection
                                        .set_status(app.chat_widget.locale.renamed_thread(&name));
                                }
                                Err(error) => app.projection.set_status(error.to_string()),
                            }
                        }
                        AppAction::StartNewThread => {
                            history_load_all_requested = false;
                            crate::app::agents_overview_loading::draw(&mut terminal, &app)
                                .context("failed to render new thread loading state")?;
                            match app
                                .start_new_thread(
                                    session.as_mut().expect("session available during TUI"),
                                )
                                .await
                            {
                                Ok(()) => {}
                                Err(error) => app
                                    .projection
                                    .set_status(format!("new thread failed: {error}")),
                            }
                        }
                        AppAction::SwitchThread(thread_id) => {
                            history_load_all_requested = false;
                            // The loop cannot process scheduled frames while awaiting
                            // the resume RPC, so show the loading state immediately.
                            // The title carries the same label because a transient
                            // frame alone cannot be observed by PTY-driven checks.
                            crate::app::agents_overview_loading::draw(&mut terminal, &app)
                                .context("failed to render agent loading state")?;
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

#[cfg(test)]
#[path = "runtime_pty_tests.rs"]
mod pty_tests;

#[cfg(test)]
#[path = "runtime/tests.rs"]
mod tests;
