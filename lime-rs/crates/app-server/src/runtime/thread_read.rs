use super::session_lifecycle::stored_session_hidden_from_user_recents;
use super::status::{agent_turn_blocks_queue_resume, agent_turn_is_active};
use super::{ProjectionStore, RuntimeCore, RuntimeCoreError};
use agent_protocol::{PageCursor, TurnQueueState};
use app_server_protocol::protocol::v2::{
    ThreadLoadedListParams, ThreadLoadedListResponse, ThreadMetadataGitInfoUpdateParams,
    ThreadMetadataUpdateParams, ThreadSearchOccurrence, ThreadSearchOccurrencesParams,
    ThreadSearchOccurrencesResponse, ThreadSearchTextRange, ThreadSection,
    ThreadSectionCreateParams, ThreadSectionCreateResponse, ThreadSectionDeleteParams,
    ThreadSectionDeleteResponse, ThreadSectionListParams, ThreadSectionListResponse,
    ThreadSectionMoveParams, ThreadSectionMoveResponse, ThreadSectionUpdateParams,
    ThreadSectionUpdateResponse, ThreadSetNameParams, ThreadSetNameResponse,
};
use app_server_protocol::{
    ThreadItemsListParams, ThreadItemsListResponse, ThreadListParams, ThreadListResponse,
    ThreadReadParams, ThreadReadResponse, ThreadTurnsListParams, ThreadTurnsListResponse,
};
use thread_store::{
    ArchiveThreadParams, CreateThreadSectionParams as StoreCreateThreadSectionParams,
    DeleteThreadSectionParams as StoreDeleteThreadSectionParams,
    ListThreadSectionsParams as StoreListThreadSectionsParams, ListThreadsParams,
    MoveThreadToSectionParams as StoreMoveThreadToSectionParams, PageRequest, ReadThreadParams,
    RenameThreadSectionParams as StoreRenameThreadSectionParams,
    SearchThreadOccurrencesParams as StoreSearchThreadOccurrencesParams, StoreCursor,
    StoredThreadSection, ThreadMetadataPatch, ThreadStore, ThreadStoreErrorKind,
    UpdateThreadMetadataParams,
};

mod history_visibility;
mod runtime_snapshot;

#[cfg(test)]
use runtime_snapshot::ThreadExecutionState;
use runtime_snapshot::{normalize_thread_runtime_snapshot, normalize_turn_runtime_snapshots};

const DEFAULT_PAGE_LIMIT: u32 = 100;
const THREAD_SEARCH_OCCURRENCES_DEFAULT_LIMIT: usize = 50;
const THREAD_SEARCH_OCCURRENCES_MAX_LIMIT: usize = 250;

pub(crate) struct RuntimeThreadResumeSnapshot {
    pub thread: agent_protocol::Thread,
    pub active_turn_id: Option<agent_protocol::TurnId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThreadUnloadResult {
    Active,
    NotLoaded,
    Unloaded,
}

fn is_queued_turn(turn: &agent_protocol::Turn) -> bool {
    matches!(turn.queue, TurnQueueState::Queued { .. })
}

impl RuntimeCore {
    pub(crate) fn loaded_session_id_for_thread(&self, thread_id: &str) -> Option<String> {
        self.state
            .lock()
            .expect("runtime core state mutex poisoned")
            .sessions
            .values()
            .find(|stored| stored.session.thread_id == thread_id)
            .map(|stored| stored.session.session_id.clone())
    }

    pub(crate) fn loaded_thread_is_active(&self, thread_id: &str) -> Option<bool> {
        self.state
            .lock()
            .expect("runtime core state mutex poisoned")
            .sessions
            .values()
            .find(|stored| stored.session.thread_id == thread_id)
            .map(|stored| {
                stored
                    .turns
                    .iter()
                    .any(|turn| agent_turn_is_active(turn.status))
            })
    }

    pub(crate) async fn can_accept_direct_input(
        &self,
        thread_id: &str,
    ) -> Result<bool, RuntimeCoreError> {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err(RuntimeCoreError::InvalidRequest(
                "threadId is required to check direct-input policy".to_string(),
            ));
        }
        if let Some(thread) = self.loaded_ephemeral_thread(thread_id) {
            return Ok(thread.parent_thread_id.is_none());
        }
        let thread = self
            .canonical_thread_store()?
            .read_thread(ReadThreadParams {
                thread_id: agent_protocol::ThreadId::new(thread_id),
                include_archived: true,
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| RuntimeCoreError::Backend(format!("thread not found: {thread_id}")))?;
        Ok(thread.parent_thread_id.is_none())
    }

    pub fn list_loaded_threads(
        &self,
        params: ThreadLoadedListParams,
    ) -> Result<ThreadLoadedListResponse, RuntimeCoreError> {
        let mut data = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned")
            .sessions
            .values()
            .filter(|stored| !stored_session_hidden_from_user_recents(stored))
            .map(|stored| stored.session.thread_id.clone())
            .collect::<Vec<_>>();
        if data.is_empty() {
            return Ok(ThreadLoadedListResponse {
                data,
                next_cursor: None,
            });
        }

        data.sort_unstable();
        data.dedup();
        let total = data.len();
        let start = match params.cursor {
            Some(cursor) => {
                let cursor = uuid::Uuid::parse_str(&cursor)
                    .map_err(|_| {
                        RuntimeCoreError::InvalidRequest(format!("invalid cursor: {cursor}"))
                    })?
                    .to_string();
                match data.binary_search(&cursor) {
                    Ok(index) => index + 1,
                    Err(index) => index,
                }
            }
            None => 0,
        };
        let limit = params.limit.unwrap_or(total as u32).max(1) as usize;
        let end = start.saturating_add(limit).min(total);
        let page = data[start..end].to_vec();
        let next_cursor = page.last().filter(|_| end < total).cloned();
        Ok(ThreadLoadedListResponse {
            data: page,
            next_cursor,
        })
    }

    pub async fn set_thread_name(
        &self,
        params: ThreadSetNameParams,
    ) -> Result<ThreadSetNameResponse, RuntimeCoreError> {
        let thread_id = params.thread_id.trim();
        if thread_id.is_empty() {
            return Err(RuntimeCoreError::InvalidRequest(
                "threadId is required for thread/name/set".to_string(),
            ));
        }
        let name = params.name.trim();
        if name.is_empty() {
            return Err(RuntimeCoreError::InvalidRequest(
                "thread name must not be empty".to_string(),
            ));
        }
        let store = self.canonical_thread_store()?;
        store
            .update_thread_metadata(UpdateThreadMetadataParams {
                thread_id: agent_protocol::ThreadId::new(thread_id.to_string()),
                patch: ThreadMetadataPatch {
                    name: Some(Some(name.to_string())),
                    ..Default::default()
                },
                include_archived: false,
            })
            .await
            .map_err(store_error)?;
        Ok(ThreadSetNameResponse {})
    }

    pub async fn update_thread_metadata(
        &self,
        params: ThreadMetadataUpdateParams,
    ) -> Result<agent_protocol::Thread, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let thread_id = agent_protocol::ThreadId::new(params.thread_id);
        let current = store
            .read_thread(ReadThreadParams {
                thread_id: thread_id.clone(),
                include_archived: true,
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| RuntimeCoreError::Backend(format!("thread not found: {thread_id}")))?;
        let mut metadata = current.metadata;
        let metadata = metadata_object(&mut metadata);
        if let Some(project_id) = params.project_id {
            if project_id.is_empty() {
                metadata.remove("projectId");
                metadata.remove("project_id");
            } else {
                metadata.insert(
                    "projectId".to_string(),
                    serde_json::Value::String(project_id),
                );
            }
        }
        if let Some(git_info) = params.git_info {
            apply_git_info_patch(metadata, git_info);
        }
        store
            .update_thread_metadata(UpdateThreadMetadataParams {
                thread_id,
                patch: ThreadMetadataPatch {
                    metadata: Some(Some(serde_json::Value::Object(metadata.clone()))),
                    ..Default::default()
                },
                include_archived: true,
            })
            .await
            .map_err(store_error)
    }

    pub async fn archive_thread(
        &self,
        thread_id: agent_protocol::ThreadId,
    ) -> Result<bool, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let current = store
            .read_thread(ReadThreadParams {
                thread_id: thread_id.clone(),
                include_archived: true,
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| RuntimeCoreError::Backend(format!("thread not found: {thread_id}")))?;
        if current.archived {
            return Ok(false);
        }
        let session_id = current.session_id.to_string();
        let loaded = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned")
            .sessions
            .contains_key(&session_id);
        if loaded {
            self.session_loops
                .shutdown(&session_id)
                .await
                .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
            self.backend
                .close_session(&session_id, thread_id.as_str())
                .await?;
            let mut state = self
                .state
                .lock()
                .expect("runtime core state mutex poisoned");
            state.thread_elicitation_counts.remove(thread_id.as_str());
            state.thread_goal_continuations.remove(&session_id);
            state.sessions.remove(&session_id);
        }
        store
            .archive_thread(ArchiveThreadParams { thread_id })
            .await
            .map_err(store_error)?;
        Ok(true)
    }

    pub async fn unarchive_thread(
        &self,
        thread_id: agent_protocol::ThreadId,
    ) -> Result<agent_protocol::Thread, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let current = store
            .read_thread(ReadThreadParams {
                thread_id: thread_id.clone(),
                include_archived: true,
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(store_error)?;
        if let Some(thread) = current.filter(|thread| thread.archived) {
            self.restore_thread_worktree(&thread).await?;
        }
        store
            .unarchive_thread(ArchiveThreadParams { thread_id })
            .await
            .map_err(store_error)
    }

    pub(crate) async fn resume_thread(
        &self,
        thread_id: agent_protocol::ThreadId,
    ) -> Result<RuntimeThreadResumeSnapshot, RuntimeCoreError> {
        let mut response = self
            .read_thread(ThreadReadParams {
                thread_id,
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await?;
        if self
            .resolve_legacy_thread_working_directory(&response.thread)
            .await?
        {
            response = self
                .read_thread(ThreadReadParams {
                    thread_id: response.thread.thread_id.clone(),
                    turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
                })
                .await?;
        }
        let session_id = response.thread.session_id.clone();
        self.restore_thread_worktree(&response.thread).await?;
        self.hydrate_thread_session(&response.thread).await?;
        let active_turn_id = self
            .session_loops
            .snapshot(session_id.as_str())
            .await
            .map_err(|error| {
                RuntimeCoreError::Backend(format!(
                    "read runtime session snapshot for thread resume: {error}"
                ))
            })?
            .and_then(|snapshot| snapshot.active_turn_id)
            .map(agent_protocol::TurnId::new);
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let thread_is_idle = active_turn_id.is_none()
            && state
                .sessions
                .get(session_id.as_str())
                .is_some_and(|stored| {
                    !stored
                        .turns
                        .iter()
                        .any(|turn| agent_turn_blocks_queue_resume(turn.status))
                });
        self.projection_store
            .as_deref()
            .ok_or_else(|| {
                RuntimeCoreError::Backend("thread goal store is unavailable".to_string())
            })?
            .restore_thread_goal_accounting_sync(response.thread.thread_id.as_str(), thread_is_idle)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        drop(state);
        Ok(RuntimeThreadResumeSnapshot {
            thread: response.thread,
            active_turn_id,
        })
    }

    pub async fn read_thread(
        &self,
        params: ThreadReadParams,
    ) -> Result<ThreadReadResponse, RuntimeCoreError> {
        if let Some(thread) = self.loaded_ephemeral_thread(params.thread_id.as_str()) {
            if params.turns_view != agent_protocol::ThreadTurnsView::NotLoaded {
                return Err(RuntimeCoreError::InvalidRequest(
                    "ephemeral threads do not support includeTurns".to_string(),
                ));
            }
            return Ok(ThreadReadResponse { thread });
        }
        let store = self.canonical_thread_store()?;
        let thread_id = params.thread_id.clone();
        let turns_view = params.turns_view;
        let mut thread = store
            .read_thread(ReadThreadParams {
                thread_id: params.thread_id,
                include_archived: true,
                turns_view,
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| RuntimeCoreError::Backend(format!("thread not found: {thread_id}")))?;
        if let Some(product) = self
            .projection_store
            .as_deref()
            .map(|store| store.read_thread_product_projection(thread.session_id.as_str()))
            .transpose()
            .map_err(RuntimeCoreError::Backend)?
            .flatten()
        {
            merge_thread_product_projection(&mut thread.metadata, product);
        }
        let execution = self
            .thread_execution_state(thread.thread_id.as_str())
            .await?;
        self.refresh_terminal_turns(&thread.thread_id, &mut thread.turns, &execution)
            .await?;
        normalize_thread_runtime_snapshot(&mut thread, &execution);
        thread.turns.retain(|turn| !is_queued_turn(turn));
        Ok(ThreadReadResponse { thread })
    }

    pub async fn list_threads(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResponse, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let turns_view = params.turns_view;
        let page = store
            .list_threads(ListThreadsParams {
                include_archived: params.include_archived,
                page: store_page(params.page)?,
                section: params.section,
                project: params.project,
                sort_by_section_position: params.sort_by_section_position,
            })
            .await
            .map_err(store_error)?;
        let mut data = page.data;
        if !matches!(turns_view, agent_protocol::ThreadTurnsView::NotLoaded) {
            for thread in &mut data {
                let Some(hydrated) = store
                    .read_thread(ReadThreadParams {
                        thread_id: thread.thread_id.clone(),
                        include_archived: true,
                        turns_view,
                    })
                    .await
                    .map_err(store_error)?
                else {
                    return Err(RuntimeCoreError::Backend(format!(
                        "listed thread disappeared during hydration: {}",
                        thread.thread_id
                    )));
                };
                *thread = hydrated;
            }
        }
        for thread in &mut data {
            let execution = self
                .thread_execution_state(thread.thread_id.as_str())
                .await?;
            self.refresh_terminal_turns(&thread.thread_id, &mut thread.turns, &execution)
                .await?;
            normalize_thread_runtime_snapshot(thread, &execution);
            thread.turns.retain(|turn| !is_queued_turn(turn));
        }
        Ok(ThreadListResponse {
            data,
            next_cursor: page.next_cursor.map(StoreCursor::into_string),
            backwards_cursor: page.backwards_cursor.map(StoreCursor::into_string),
        })
    }

    pub async fn list_thread_sections(
        &self,
        params: ThreadSectionListParams,
    ) -> Result<ThreadSectionListResponse, RuntimeCoreError> {
        let cursor = params
            .cursor
            .map(StoreCursor::new)
            .transpose()
            .map_err(|error| RuntimeCoreError::InvalidRequest(error.to_string()))?;
        let page = self
            .canonical_thread_store()?
            .list_thread_sections(StoreListThreadSectionsParams {
                cursor,
                limit: params.limit.unwrap_or(100).clamp(1, 500),
            })
            .await
            .map_err(store_error)?;
        Ok(ThreadSectionListResponse {
            data: page.data.into_iter().map(project_section).collect(),
            next_cursor: page.next_cursor.map(StoreCursor::into_string),
        })
    }

    pub async fn create_thread_section(
        &self,
        params: ThreadSectionCreateParams,
    ) -> Result<ThreadSectionCreateResponse, RuntimeCoreError> {
        let section = self
            .canonical_thread_store()?
            .create_thread_section(StoreCreateThreadSectionParams { name: params.name })
            .await
            .map_err(store_error)?;
        Ok(ThreadSectionCreateResponse {
            section: project_section(section),
        })
    }

    pub async fn update_thread_section(
        &self,
        params: ThreadSectionUpdateParams,
    ) -> Result<ThreadSectionUpdateResponse, RuntimeCoreError> {
        let section_id = params.section_id.clone();
        let section = self
            .canonical_thread_store()?
            .rename_thread_section(StoreRenameThreadSectionParams {
                section_id,
                name: params.name,
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| {
                RuntimeCoreError::InvalidRequest(format!(
                    "thread section not found: {}",
                    params.section_id
                ))
            })?;
        Ok(ThreadSectionUpdateResponse {
            section: project_section(section),
        })
    }

    pub async fn delete_thread_section(
        &self,
        params: ThreadSectionDeleteParams,
    ) -> Result<ThreadSectionDeleteResponse, RuntimeCoreError> {
        let deleted = self
            .canonical_thread_store()?
            .delete_thread_section(StoreDeleteThreadSectionParams {
                section_id: params.section_id.clone(),
            })
            .await
            .map_err(store_error)?;
        if !deleted {
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "thread section not found: {}",
                params.section_id
            )));
        }
        Ok(ThreadSectionDeleteResponse {})
    }

    pub async fn move_thread_to_section(
        &self,
        params: ThreadSectionMoveParams,
    ) -> Result<ThreadSectionMoveResponse, RuntimeCoreError> {
        self.canonical_thread_store()?
            .move_thread_to_section(StoreMoveThreadToSectionParams {
                thread_id: agent_protocol::ThreadId::new(params.thread_id),
                section: params.section_id,
                before_thread_id: params.before_thread_id.map(agent_protocol::ThreadId::new),
            })
            .await
            .map_err(store_error)?;
        Ok(ThreadSectionMoveResponse {})
    }

    pub async fn search_thread_occurrences(
        &self,
        params: ThreadSearchOccurrencesParams,
    ) -> Result<ThreadSearchOccurrencesResponse, RuntimeCoreError> {
        if params.search_term.trim().is_empty() {
            return Err(RuntimeCoreError::InvalidRequest(
                "thread/searchOccurrences requires a non-empty searchTerm".to_string(),
            ));
        }
        let cursor = params
            .cursor
            .map(StoreCursor::new)
            .transpose()
            .map_err(|error| RuntimeCoreError::InvalidRequest(error.to_string()))?;
        let page_size = params
            .limit
            .map(|value| value as usize)
            .unwrap_or(THREAD_SEARCH_OCCURRENCES_DEFAULT_LIMIT)
            .clamp(1, THREAD_SEARCH_OCCURRENCES_MAX_LIMIT);
        let page = self
            .canonical_thread_store()?
            .search_thread_occurrences(StoreSearchThreadOccurrencesParams {
                thread_id: agent_protocol::ThreadId::new(params.thread_id),
                search_term: params.search_term,
                cursor,
                page_size,
            })
            .await
            .map_err(search_store_error)?;
        Ok(ThreadSearchOccurrencesResponse {
            data: page
                .data
                .into_iter()
                .map(|occurrence| ThreadSearchOccurrence {
                    turn_id: occurrence.turn_id.as_str().to_string(),
                    item_id: occurrence.item_id.as_str().to_string(),
                    snippet: occurrence.snippet,
                    snippet_match_range: ThreadSearchTextRange {
                        start: occurrence.snippet_match_range.start,
                        end: occurrence.snippet_match_range.end,
                    },
                    turn_cursor: occurrence.turn_cursor.into_string(),
                })
                .collect(),
            next_cursor: page.next_cursor.map(StoreCursor::into_string),
        })
    }

    pub(crate) fn canonical_thread_store(&self) -> Result<&dyn ThreadStore, RuntimeCoreError> {
        self.projection_store
            .as_deref()
            .map(|store| store as &dyn ThreadStore)
            .ok_or_else(|| {
                RuntimeCoreError::Backend("canonical thread store is unavailable".to_string())
            })
    }

    pub(crate) fn canonical_projection_store(&self) -> Result<&ProjectionStore, RuntimeCoreError> {
        self.projection_store.as_deref().ok_or_else(|| {
            RuntimeCoreError::Backend("canonical thread store is unavailable".to_string())
        })
    }
}

fn merge_thread_product_projection(metadata: &mut serde_json::Value, product: serde_json::Value) {
    let Some(product) = product.as_object() else {
        return;
    };
    if !metadata.is_object() {
        *metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    let Some(metadata) = metadata.as_object_mut() else {
        return;
    };
    metadata.extend(product.clone());
}

fn metadata_object(
    metadata: &mut serde_json::Value,
) -> &mut serde_json::Map<String, serde_json::Value> {
    if !metadata.is_object() {
        *metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    metadata
        .as_object_mut()
        .expect("metadata was normalized to an object")
}

fn apply_git_info_patch(
    metadata: &mut serde_json::Map<String, serde_json::Value>,
    patch: ThreadMetadataGitInfoUpdateParams,
) {
    let legacy = metadata.remove("git_info");
    let current = metadata.remove("gitInfo").or(legacy);
    let mut git_info = current
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    apply_clearable_string(&mut git_info, "sha", patch.sha);
    apply_clearable_string(&mut git_info, "branch", patch.branch);
    apply_clearable_string(&mut git_info, "originUrl", patch.origin_url);
    if !git_info.is_empty() {
        metadata.insert("gitInfo".to_string(), serde_json::Value::Object(git_info));
    }
}

fn apply_clearable_string(
    object: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<Option<String>>,
) {
    match value {
        Some(Some(value)) => {
            object.insert(key.to_string(), serde_json::Value::String(value));
        }
        Some(None) => {
            object.remove(key);
        }
        None => {}
    }
}

fn store_page(page: PageCursor) -> Result<PageRequest, RuntimeCoreError> {
    let cursor = page
        .cursor
        .map(StoreCursor::new)
        .transpose()
        .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
    Ok(PageRequest {
        cursor,
        limit: page.limit.unwrap_or(DEFAULT_PAGE_LIMIT),
        sort_direction: page.sort_direction,
    })
}

fn store_error(error: thread_store::ThreadStoreError) -> RuntimeCoreError {
    match error.kind() {
        ThreadStoreErrorKind::InvalidRequest | ThreadStoreErrorKind::ThreadNotFound => {
            RuntimeCoreError::InvalidRequest(error.to_string())
        }
        ThreadStoreErrorKind::Unsupported => RuntimeCoreError::MethodNotFound(error.to_string()),
        ThreadStoreErrorKind::Internal => RuntimeCoreError::Backend(error.to_string()),
    }
}

fn project_section(section: StoredThreadSection) -> ThreadSection {
    ThreadSection {
        id: section.id,
        name: section.name,
    }
}

fn search_store_error(error: thread_store::ThreadStoreError) -> RuntimeCoreError {
    match error.kind() {
        ThreadStoreErrorKind::InvalidRequest | ThreadStoreErrorKind::ThreadNotFound => {
            RuntimeCoreError::InvalidRequest(error.to_string())
        }
        ThreadStoreErrorKind::Unsupported => RuntimeCoreError::MethodNotFound(error.to_string()),
        ThreadStoreErrorKind::Internal => {
            RuntimeCoreError::Backend(format!("failed to search thread occurrences: {error}"))
        }
    }
}

#[cfg(test)]
mod tests;
