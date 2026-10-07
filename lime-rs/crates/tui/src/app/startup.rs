//! Startup/session state helpers for the TUI application.
//!
//! The App Server owns thread creation and restoration. This module only keeps the startup
//! decision logic that can be evaluated without a second runtime or local session store.

use super::startup_prompts;
use super::App;
use crate::app_server_session::{AppServerSession, ThreadSettingsPatch};
use crate::resume_picker::SessionSelection;
use crate::runtime::TuiOptions;
use anyhow::Result;
use app_server_protocol::protocol::v2::{PromptHistoryReadResponse, SkillsListResponse};

#[derive(Debug)]
pub(crate) struct StartupSessionState {
    pub(crate) approval_policy: Option<String>,
    pub(crate) approvals_reviewer: Option<String>,
    pub(crate) sandbox_policy: Option<String>,
}

/// Project a server-backed skills response into the composer and startup warning state.
///
/// The response remains the App Server fact source; the TUI only keeps the enabled catalog needed
/// for completion and emits newly observed load errors through the existing startup prompt owner.
pub(crate) fn apply_skills_list_response(app: &mut App, response: SkillsListResponse) {
    let skills = response
        .data
        .iter()
        .flat_map(|entry| entry.skills.iter().cloned())
        .collect::<Vec<_>>();
    let errors = response
        .data
        .into_iter()
        .flat_map(|entry| entry.errors)
        .collect::<Vec<_>>();
    app.chat_widget.bottom_pane.set_skills(skills);
    let newly_active = app
        .chat_widget
        .skill_load_warnings
        .newly_active_errors(&errors);
    startup_prompts::emit_skill_load_warnings(app, &newly_active);
}

/// Startup records the snapshot metadata, not a bounded eager-loaded history vector.
fn apply_prompt_history_response(app: &mut App, response: PromptHistoryReadResponse) {
    if let (Some(thread_id), Ok(entry_count)) =
        (&app.thread_id, usize::try_from(response.entry_count))
    {
        app.chat_widget.bottom_pane.set_history_metadata(
            thread_id.clone(),
            response.log_id,
            entry_count,
        );
    }
}

/// Establish the canonical thread/session state before entering the interactive event loop.
///
/// The App Server remains the owner of thread lifecycle and persisted history. This function only
/// hydrates the TUI projection and copies the server-backed settings into the local view model.
pub(crate) async fn initialize_session(
    options: &TuiOptions,
    session: &mut AppServerSession,
    app: &mut App,
) -> Result<StartupSessionState> {
    let mut model = options.model.clone();
    let mut model_provider = options.model_provider.clone();
    let mut effort = options.reasoning_effort.clone();
    let mut permissions = options.permissions.clone();
    let permission_cwd;

    if let Some(thread_id) = options.resume_thread.clone() {
        let response = session.resume_thread(thread_id).await?;
        permission_cwd = response.cwd.clone();
        let paginated_history = response.thread.history_mode
            == app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated;
        let initial_cursor = response.items_backwards_cursor.clone();
        let resumed_thread_id = response.thread.id.clone();
        let initial_page = if paginated_history {
            session
                .hydrate_initial_thread_history(resumed_thread_id.clone(), initial_cursor)
                .await?
        } else {
            crate::app_server_session::InitialHistoryPage {
                items: Vec::new(),
                turns: None,
            }
        };
        app.hydrate_thread(response.thread);
        app.prepend_initial_history_page(initial_page);
        app.chat_widget
            .set_scrollback_has_older_history(session.has_older_history(&resumed_thread_id));
        if model.is_none() {
            model = Some(response.model);
        }
        if model_provider.is_none() {
            model_provider = Some(response.model_provider);
        }
        if effort.is_none() {
            effort = response.reasoning_effort;
        }
    } else {
        let response = session
            .start_thread(options.cwd.clone(), model.clone(), model_provider.clone())
            .await?;
        app.chat_widget
            .set_status_thread_name(response.thread.id.clone(), response.thread.name.clone());
        permission_cwd = response.cwd.clone();
        if model.is_none() {
            model = Some(response.model);
        }
        if model_provider.is_none() {
            model_provider = Some(response.model_provider);
        }
        if effort.is_none() {
            effort = response.reasoning_effort;
        }
    }

    let skill_cwd = std::path::PathBuf::from(&permission_cwd);
    crate::app::working_directory::sync_server_cwd(app, &skill_cwd);
    let permission_profiles = session
        .list_permission_profiles(Some(permission_cwd))
        .await?;
    app.chat_widget.set_permission_profiles(
        permission_profiles
            .data
            .into_iter()
            .filter(|profile| profile.allowed)
            .map(|profile| profile.id),
    );
    if permissions.is_none() {
        permissions = session.active_permission_profile().map(str::to_string);
    }
    match session.list_models(100).await {
        Ok(response) => app.chat_widget.set_model_catalog(response.data),
        Err(error) => app
            .projection
            .set_status(format!("model catalog unavailable: {error}")),
    }
    match session.list_skills(vec![skill_cwd]).await {
        Ok(response) => apply_skills_list_response(app, response),
        Err(error) => app
            .projection
            .set_status(format!("skills unavailable: {error}")),
    }
    app.set_thread_id(session.thread_id()?.to_string());
    let collaboration_modes = session.list_collaboration_modes().await.unwrap_or_default();
    app.chat_widget.set_collaboration_modes(collaboration_modes);
    session
        .update_settings_with_policy(
            ThreadSettingsPatch::new(
                model.clone(),
                model_provider.clone(),
                effort.clone(),
                permissions.clone(),
            )
            .with_policy(
                options.approval_policy.clone(),
                options.approvals_reviewer.clone(),
                options.sandbox_policy.clone(),
            ),
        )
        .await?;
    app.chat_widget.set_settings(
        model.clone(),
        model_provider.clone(),
        effort.clone(),
        permissions.clone(),
    );
    match session.read_prompt_history(1).await {
        Ok(history) => apply_prompt_history_response(app, history),
        Err(error) => app
            .projection
            .set_status(format!("prompt history unavailable: {error}")),
    }
    app.refresh_queued_submissions(session).await;

    Ok(StartupSessionState {
        approval_policy: options.approval_policy.clone(),
        approvals_reviewer: options.approvals_reviewer.clone(),
        sandbox_policy: options.sandbox_policy.clone(),
    })
}

#[allow(dead_code)]
impl App {
    /// Whether startup must wait for the initial session target before routing thread events.
    ///
    /// Resume and fork targets already identify their session. Fresh and exit selections need
    /// the normal startup path to establish or intentionally skip a primary thread first.
    pub(crate) fn should_wait_for_initial_session(selection: &SessionSelection) -> bool {
        matches!(
            selection,
            SessionSelection::StartFresh | SessionSelection::Exit
        )
    }

    /// Whether an active thread event receiver may be consumed during startup.
    pub(crate) fn should_handle_active_thread_events(
        waiting_for_initial_session: bool,
        has_active_thread_receiver: bool,
    ) -> bool {
        !waiting_for_initial_session && has_active_thread_receiver
    }

    /// Stop the startup wait once the primary thread has been configured.
    pub(crate) fn should_stop_waiting_for_initial_session(
        waiting_for_initial_session: bool,
        primary_thread_id: Option<&str>,
    ) -> bool {
        waiting_for_initial_session && primary_thread_id.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resume_picker::SessionTarget;
    use app_server_protocol::protocol::v2::{SkillMetadata, SkillScope, SkillsListEntry};
    use std::path::PathBuf;

    fn target() -> SessionTarget {
        SessionTarget {
            path: Some(PathBuf::from("/tmp/session")),
            thread_id: "thread-1".to_string(),
            history_mode: None,
        }
    }

    #[test]
    fn startup_waiting_gate_is_only_for_fresh_or_exit_session_selection() {
        assert!(App::should_wait_for_initial_session(
            &SessionSelection::StartFresh
        ));
        assert!(App::should_wait_for_initial_session(
            &SessionSelection::Exit
        ));
        assert!(!App::should_wait_for_initial_session(
            &SessionSelection::AgentsOverview
        ));
        assert!(!App::should_wait_for_initial_session(
            &SessionSelection::Resume(target())
        ));
        assert!(!App::should_wait_for_initial_session(
            &SessionSelection::Fork(target())
        ));
    }

    #[test]
    fn startup_waiting_gate_holds_active_thread_events_until_primary_thread_configured() {
        assert!(!App::should_stop_waiting_for_initial_session(true, None));
        assert!(App::should_stop_waiting_for_initial_session(
            true,
            Some("thread-1")
        ));
        assert!(!App::should_handle_active_thread_events(true, true));
        assert!(App::should_handle_active_thread_events(false, true));
    }

    #[test]
    fn startup_waiting_gate_not_applied_for_resume_or_fork_session_selection() {
        assert!(!App::should_wait_for_initial_session(
            &SessionSelection::Resume(target())
        ));
        assert!(!App::should_wait_for_initial_session(
            &SessionSelection::Fork(target())
        ));
        assert!(!App::should_handle_active_thread_events(false, false));
        assert!(!App::should_stop_waiting_for_initial_session(
            false,
            Some("thread-1")
        ));
    }

    #[test]
    fn prompt_history_page_recall_starts_at_newest_and_traverses_toward_older() {
        use app_server_protocol::protocol::v2::PromptHistoryEntry;
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

        let mut app = App::default();
        app.set_thread_id("thread".into());
        apply_prompt_history_response(
            &mut app,
            PromptHistoryReadResponse {
                log_id: "log".into(),
                entry_count: 2,
                data: ["newest", "oldest"]
                    .into_iter()
                    .enumerate()
                    .map(|(index, text)| PromptHistoryEntry {
                        offset: (1 - index) as u64,
                        thread_id: "thread".into(),
                        ts: 1,
                        text: text.into(),
                    })
                    .collect(),
                next_cursor: None,
            },
        );
        for (offset, text) in [(1, "newest"), (0, "oldest")] {
            app.chat_widget.bottom_pane.on_history_lookup_response(
                "thread",
                crate::app_event::HistoryLookupResponse::Entry {
                    log_id: "log".into(),
                    offset,
                    entry: Some(text.into()),
                },
            );
        }
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "newest");
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "oldest");
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "newest");
    }

    #[test]
    fn skills_list_projection_keeps_only_enabled_catalog_entries() {
        let mut app = App::default();
        apply_skills_list_response(
            &mut app,
            SkillsListResponse {
                data: vec![SkillsListEntry {
                    cwd: PathBuf::from("/workspace"),
                    skills: vec![
                        SkillMetadata {
                            name: "enabled".to_string(),
                            description: "available".to_string(),
                            short_description: None,
                            interface: None,
                            dependencies: None,
                            path: PathBuf::from("/skills/enabled/SKILL.md"),
                            scope: SkillScope::User,
                            enabled: true,
                        },
                        SkillMetadata {
                            name: "disabled".to_string(),
                            description: "hidden".to_string(),
                            short_description: None,
                            interface: None,
                            dependencies: None,
                            path: PathBuf::from("/skills/disabled/SKILL.md"),
                            scope: SkillScope::User,
                            enabled: false,
                        },
                    ],
                    errors: Vec::new(),
                }],
            },
        );

        assert_eq!(
            app.chat_widget
                .bottom_pane
                .skills()
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            vec!["enabled"]
        );
    }
}
