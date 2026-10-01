use super::*;

/// Codex-shaped resume picker entry point backed by App Server's Thread list.
pub(crate) async fn run_resume_picker_with_app_server(
    options: &TuiOptions,
) -> Result<Option<String>> {
    run_session_picker_with_action(options, SessionPickerAction::Resume).await
}

async fn load_thread_page_with_handle(
    request_handle: RequestHandle,
    status: SessionStatus,
    filter_cwd: Option<&std::path::Path>,
    model_provider: Option<&str>,
    query: &str,
    sort_key: ThreadSortKey,
    cursor: Option<String>,
) -> Result<ThreadPage> {
    // Lime's current App Server owns the canonical index; do not switch to
    // Codex's private local state DB mode for later pages.
    let page: ThreadListResponse = request_handle
        .request(
            app_server_protocol::protocol::v2::METHOD_THREAD_LIST,
            ThreadListParams {
                cursor,
                limit: Some(MAX_THREADS),
                sort_key: Some(sort_key),
                sort_direction: Some(SortDirection::Desc),
                model_providers: model_provider.map(|provider| vec![provider.to_string()]),
                archived: Some(status == SessionStatus::Archived),
                cwd: filter_cwd
                    .map(|cwd| ThreadListCwdFilter::One(cwd.to_string_lossy().into_owned())),
                search_term: (!query.trim().is_empty()).then(|| query.trim().to_string()),
                ..ThreadListParams::default()
            },
        )
        .await?;
    Ok(ThreadPage {
        threads: filter_threads(page.data, query),
        next_cursor: page.next_cursor,
    })
}

pub(crate) fn spawn_thread_load(
    request_handle: RequestHandle,
    sender: &mpsc::UnboundedSender<PickerLoadEvent>,
    picker: &mut PickerState,
) {
    let cursor = picker
        .pagination
        .next_cursor
        .as_ref()
        .map(|cursor| match cursor {
            PageCursor::AppServer(cursor) => cursor.clone(),
        });
    if cursor.is_none() {
        picker.threads.clear();
        picker.selected = 0;
        picker.transcript_previews.clear();
        picker.preview_loading.clear();
        picker.expanded_thread_id = None;
        picker.transcripts.clear();
        picker.transcript_pager = None;
        picker.seen_cursors.clear();
    } else if let Some(cursor) = cursor.as_deref() {
        if !picker.seen_cursors.insert(cursor.to_string()) {
            picker.status_message =
                Some(format!("thread list pagination repeated cursor {cursor}"));
            return;
        }
    }
    let token = picker.begin_load();
    let status = picker.status;
    let cwd = (!picker.show_all)
        .then(|| picker.filter_cwd.clone())
        .flatten();
    let query = picker.query.clone();
    let sort_key = picker.sort_key;
    let model_provider = picker.model_provider.clone();
    let sender = sender.clone();
    tokio::spawn(async move {
        let result = load_thread_page_with_handle(
            request_handle,
            status,
            cwd.as_deref(),
            model_provider.as_deref(),
            &query,
            sort_key,
            cursor,
        )
        .await;
        let _ = sender.send(PickerLoadEvent::Threads { token, result });
    });
}

pub(crate) fn spawn_preview_load(
    request_handle: RequestHandle,
    sender: &mpsc::UnboundedSender<PickerLoadEvent>,
    picker: &mut PickerState,
    thread_id: String,
) {
    if !picker.preview_needs_load(&thread_id) {
        return;
    }
    picker.mark_preview_loading(thread_id.clone());
    let sender = sender.clone();
    tokio::spawn(async move {
        let result = load_transcript_preview_with_handle(request_handle, thread_id.clone()).await;
        let _ = sender.send(PickerLoadEvent::Preview { thread_id, result });
    });
}

pub(crate) fn spawn_transcript_load(
    request_handle: RequestHandle,
    sender: &mpsc::UnboundedSender<PickerLoadEvent>,
    thread_id: String,
) {
    let sender = sender.clone();
    tokio::spawn(async move {
        let result = crate::thread_transcript::load_session_transcript_with_handle(
            request_handle,
            thread_id.clone(),
        )
        .await;
        let _ = sender.send(PickerLoadEvent::Transcript { thread_id, result });
    });
}

async fn load_transcript_preview_with_handle(
    request_handle: RequestHandle,
    thread_id: String,
) -> std::io::Result<Vec<transcript_preview::TranscriptPreviewLine>> {
    transcript_preview::load_transcript_preview_with_handle(request_handle, thread_id).await
}

pub(crate) fn spawn_archive_request(
    request_handle: RequestHandle,
    sender: &mpsc::UnboundedSender<PickerLoadEvent>,
    thread_id: String,
) {
    let sender = sender.clone();
    tokio::spawn(async move {
        let result = request_handle
            .request::<_, app_server_protocol::protocol::v2::ThreadArchiveResponse>(
                METHOD_THREAD_ARCHIVE,
                ThreadArchiveParams {
                    thread_id: thread_id.clone(),
                },
            )
            .await
            .map(|_| ())
            .map_err(anyhow::Error::from);
        let _ = sender.send(PickerLoadEvent::Archive { thread_id, result });
    });
}

pub(crate) fn spawn_unarchive_request(
    request_handle: RequestHandle,
    sender: &mpsc::UnboundedSender<PickerLoadEvent>,
    thread_id: String,
) {
    let sender = sender.clone();
    tokio::spawn(async move {
        let result = request_handle
            .request::<_, ThreadUnarchiveResponse>(
                METHOD_THREAD_UNARCHIVE,
                ThreadUnarchiveParams {
                    thread_id: thread_id.clone(),
                },
            )
            .await
            .map_err(anyhow::Error::from);
        let _ = sender.send(PickerLoadEvent::Unarchive {
            thread_id,
            result: Box::new(result),
        });
    });
}

async fn run_session_picker_with_action(
    options: &TuiOptions,
    action: SessionPickerAction,
) -> Result<Option<String>> {
    let session = connect_session(options).await?;
    let local_settings = crate::local_settings::LocalSettings::read(&session).await?;
    let request_handle = session.request_handle();
    let (load_tx, mut load_rx) = mpsc::unbounded_channel();
    let mut picker = PickerState::new(
        Vec::new(),
        action,
        SessionStatus::Active,
        Some(options.cwd.clone()),
        false,
    );
    picker.set_model_provider_filter(options.model_provider.clone());
    picker.set_transcript_keymap(local_settings.keymap.transcript().clone());
    picker.set_list_keymap(local_settings.keymap.list().clone());
    spawn_thread_load(request_handle.clone(), &load_tx, &mut picker);
    let locale = Locale::resolve(options.locale.as_deref());
    let mut terminal = match Tui::enter().context("failed to initialize terminal") {
        Ok(terminal) => terminal,
        Err(error) => {
            let _ = session.shutdown().await;
            return Err(error);
        }
    };
    let mut input = terminal.event_stream();
    let frame_requester = terminal.frame_requester();
    let mut _clipboard_lease = None;
    let mut pending_copy: Option<(u64, bool, usize)> = None;
    let selected = loop {
        if let Some(thread_id) = picker.selected_thread_id().map(ToOwned::to_owned) {
            spawn_preview_load(request_handle.clone(), &load_tx, &mut picker, thread_id);
        }
        terminal
            .terminal_mut()
            .draw(|frame| render_with_locale(frame, &picker, locale))
            .context("failed to render session picker")?;
        tokio::select! {
            load_event = load_rx.recv() => {
                let Some(load_event) = load_event else { break None; };
                match load_event {
                    PickerLoadEvent::Threads { token, result } => match result {
                        Ok(page) => {
                            picker.apply_thread_page(token, page);
                            if (picker.threads.is_empty() && picker.has_more_pages()) || picker.has_pending_page_down()
                            {
                                spawn_thread_load(request_handle.clone(), &load_tx, &mut picker);
                            }
                        }
                        Err(error) if token == picker.load_token => {
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
                        let selection = picker.handle_unarchive_result(thread_id, *result);
                        if let Some(crate::resume_picker::SessionSelection::Resume(target)) = selection {
                            break Some(target.thread_id);
                        }
                    }
                }
            }
            event = input.next() => {
                let Some(event) = event else { break None; };
                let event = match event {
                    TuiEvent::Key(key) => Event::Key(key),
                    TuiEvent::Paste(text) => Event::Paste(text),
                    TuiEvent::Mouse(mouse) => Event::Mouse(mouse),
                    TuiEvent::Resize(size) => Event::Resize(size.width, size.height),
                    TuiEvent::FocusGained => Event::FocusGained,
                    TuiEvent::FocusLost => Event::FocusLost,
                    TuiEvent::Draw => {
                        if let Some((id, result)) = terminal.clipboard_copy.poll() {
                            if pending_copy.as_ref().is_some_and(|pending| pending.0 == id) {
                                let (_, follow, characters) = pending_copy
                                    .take()
                                    .expect("pending picker copy exists after completion");
                                let result = result
                                    .clipboard
                                    .map(|outcome| outcome.store(&mut _clipboard_lease));
                                if let Some(pager) = picker.transcript_pager.as_mut() {
                                    pager.overlay.apply_transcript_copy_result(
                                        follow,
                                        characters,
                                        &result,
                                    );
                                }
                                if let Err(error) = result {
                                    tracing::warn!(%error, "failed to copy transcript selection");
                                }
                            }
                        }
                        if picker.tick_transcript_selection()
                            || picker.transcript_search_needs_frame()
                        {
                            frame_requester
                                .schedule_frame_in(crate::tui::TARGET_FRAME_INTERVAL);
                        }
                        continue;
                    }
                    TuiEvent::Resume => {
                        picker.end_transcript_drag();
                        continue;
                    }
                };
                if let Some(pager) = picker.transcript_pager.as_mut() {
                    match pager.overlay.handle_event(&event) {
                        PagerAction::Close => {
                            // The worker still drains a late native response, but the closed
                            // pager must not let that response paint a future overlay.
                            pending_copy = None;
                            picker.transcript_pager = None;
                        }
                        PagerAction::Consumed | PagerAction::LoadOlderHistory => {}
                        PagerAction::ScheduleFrame => frame_requester
                            .schedule_frame_in(crate::tui::TARGET_FRAME_INTERVAL),
                        PagerAction::ContinueTranscriptSelection => frame_requester
                            .schedule_frame_in(crate::tui::TARGET_FRAME_INTERVAL),
                        PagerAction::CopyTranscriptSelection { text, follow } => {
                            let characters = text.chars().count();
                            match terminal
                                .clipboard_copy
                                .request_copy(text, frame_requester.clone())
                            {
                                Ok(Some(id)) => {
                                    pending_copy = Some((id, follow, characters));
                                }
                                Ok(None) => {
                                    let result = Err("copy already in progress".to_string());
                                    pager.overlay.apply_transcript_copy_result(
                                        follow,
                                        characters,
                                        &result,
                                    );
                                }
                                Err(error) => {
                                    let result = Err(error);
                                    pager.overlay.apply_transcript_copy_result(
                                        follow,
                                        characters,
                                        &result,
                                    );
                                }
                            }
                        }
                        PagerAction::OpenLink(destination) => {
                            if let Err(error) = crate::runtime::open_link(&destination) {
                                tracing::warn!(%error, "failed to open transcript link");
                            }
                        }
                    }
                    continue;
                }
                let action = picker.handle_event(event);
                match action {
                    PickerAction::Select => break picker.selected_thread_id().map(ToOwned::to_owned),
                    PickerAction::Restore => {
                        if let Some(thread_id) = picker.request_unarchive_for_selected_session() {
                            spawn_unarchive_request(request_handle.clone(), &load_tx, thread_id);
                        }
                    }
                    PickerAction::Archive => {
                        if let Some(thread_id) = picker.request_archive_for_selected_session() {
                            spawn_archive_request(request_handle.clone(), &load_tx, thread_id);
                        }
                    }
                    PickerAction::ToggleStatus | PickerAction::ToggleFilter | PickerAction::ToggleSort | PickerAction::Reload => {
                        match action {
                            PickerAction::ToggleStatus => picker.toggle_status(),
                            PickerAction::ToggleFilter => picker.toggle_filter(),
                            PickerAction::ToggleSort => picker.toggle_sort(),
                            PickerAction::Reload => {}
                            _ => unreachable!(),
                        }
                        spawn_thread_load(request_handle.clone(), &load_tx, &mut picker);
                    }
                    PickerAction::ToggleDensity => {
                        picker.density = picker.density.toggle();
                    }
                    PickerAction::ToggleExpanded => {
                        if let Some(thread_id) = picker.toggle_selected_expansion() {
                            spawn_transcript_load(request_handle.clone(), &load_tx, thread_id);
                        }
                    }
                    PickerAction::OpenTranscript => {
                        if let Some(thread_id) = picker.open_transcript_pager(locale) {
                            spawn_transcript_load(request_handle.clone(), &load_tx, thread_id);
                        }
                    }
                    PickerAction::Cancel => break None,
                    PickerAction::MoveDown if picker.should_load_more() => {
                        spawn_thread_load(request_handle.clone(), &load_tx, &mut picker);
                    }
                    PickerAction::None | PickerAction::MoveUp | PickerAction::MoveDown => {}
                }
            }
        }
    };
    let restore_result = terminal.restore().context("failed to restore terminal");
    let shutdown_result = session.shutdown().await;
    restore_result?;
    shutdown_result?;
    Ok(selected)
}
