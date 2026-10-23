use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

use agent_protocol::{
    CollabAgentState, CollabAgentStatus, SortDirection, Thread, ThreadActiveFlag,
    ThreadHistoryChangeSet, ThreadId, ThreadItem, ThreadStatus, ThreadTurnsView, Turn, TurnId,
    TurnItemsView, TurnStatus,
};
use app_server_protocol::{AgentEvent, AgentSessionStatus};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thread_store::{
    AppendThreadItemsParams, ApplyThreadHistoryParams, ApplyThreadHistoryResult,
    ArchiveThreadParams, CreateProjectParams, CreateThreadParams, CreateThreadSectionParams,
    CreatedProject, DeleteThreadParams, DeleteThreadSectionParams, DeletedProject, ItemPage,
    ListItemsParams, ListProjectsParams, ListThreadSectionsParams, ListThreadsParams,
    ListTurnsParams, MoveProjectParams, MoveThreadToSectionParams, ProjectMoveOutcome,
    ReadThreadParams, RenameThreadSectionParams, SearchThreadsParams, StoreCursor, StoredProject,
    StoredProjectsPage, StoredThreadSection, ThreadMetadataPatch, ThreadPage, ThreadSearchPage,
    ThreadSectionPage, ThreadSpawnEdgeStatus, ThreadStore, ThreadStoreError, ThreadStoreFuture,
    ThreadStoreResult, TurnPage, UpdateProjectParams, UpdateThreadMetadataParams, UpdatedProject,
    PINNED_THREAD_SECTION_ID, PINNED_THREAD_SECTION_NAME,
};

use super::projection_rebuild::{projected_tables_are_empty, rebuild_projected_thread_snapshot};
use super::{ProjectionStore, StoredSession};

mod agent_graph;
mod archive;
mod event_batch;
mod goal;
mod goal_accounting;
mod goal_fork;
pub(in crate::runtime) mod goal_idle;
mod goal_projection;
#[cfg(test)]
mod goal_projection_tests;
mod goal_rebind;
mod history;
mod history_builder;
mod metadata;
mod persistence;
mod projects;
mod queries;
mod repair;
mod revert;
mod rollout;
mod search;
mod sections;
mod session;
pub(in crate::runtime) use session::canonical_thread_from_stored_session;

use history_builder::{normalize_persisted_change_set, normalize_replayed_change_set};

pub(crate) use goal::ThreadGoalStoreError;
pub(crate) use goal_rebind::ActiveTurnGoalBinding;
use persistence::{apply_change_set, create_thread_store_schema, refresh_thread_snapshot};
use queries::{
    ensure_thread_visible, hydrate_thread, hydrate_turn, is_pending_spawn_thread,
    persist_thread_snapshot, query_item_page, query_thread_page, query_turn_page, read_thread_row,
};

const MAX_PAGE_SIZE: u32 = 500;
const THREAD_STORE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CursorKind {
    Threads,
    Sections,
    Turns,
    Items,
}

#[derive(Debug, Serialize, Deserialize)]
struct CursorValue {
    kind: CursorKind,
    position: i64,
    id: String,
    #[serde(default)]
    inclusive: bool,
}

impl ProjectionStore {
    pub(super) fn ensure_canonical_thread_store(&self) -> Result<(), String> {
        let conn = self
            .open_thread_store()
            .map_err(|error| error.to_string())?;
        create_thread_store_schema(&conn, self.state_path() != self.thread_history_path())
            .map_err(|error| error.to_string())
    }

    pub(crate) fn is_pending_thread_spawn_sync(
        &self,
        thread_id: &ThreadId,
    ) -> ThreadStoreResult<bool> {
        let conn = self.open_thread_store()?;
        is_pending_spawn_thread(&conn, thread_id)
    }

    pub(super) fn create_empty_canonical_thread(
        &self,
        stored: &StoredSession,
    ) -> Result<(), String> {
        if super::session_is_ephemeral(&stored.session) {
            return Ok(());
        }
        self.create_thread_sync(CreateThreadParams {
            thread: canonical_thread_from_stored_session(stored),
        })
        .map_err(|error| error.to_string())
    }

    pub(super) fn open_thread_store(&self) -> ThreadStoreResult<Connection> {
        let conn = Connection::open(self.state_path()).map_err(store_error)?;
        conn.busy_timeout(THREAD_STORE_BUSY_TIMEOUT)
            .map_err(store_error)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(store_error)?;
        if self.state_path() != self.thread_history_path() {
            conn.execute(
                "ATTACH DATABASE ?1 AS thread_history",
                params![self.thread_history_path().to_string_lossy().as_ref()],
            )
            .map_err(store_error)?;
        }
        if self.state_path() != self.path() && self.thread_history_path() != self.path() {
            conn.execute(
                "ATTACH DATABASE ?1 AS projection",
                params![self.path().to_string_lossy().as_ref()],
            )
            .map_err(store_error)?;
        }
        Ok(conn)
    }

    fn create_thread_sync(&self, params: CreateThreadParams) -> ThreadStoreResult<()> {
        if !params.thread.turns.is_empty() {
            return Err(error("create_thread rejects embedded turns"));
        }
        validate_thread_identity(&params.thread)?;
        let thread = thread_without_turns(params.thread);
        let rollout_path = self
            .rollout_store()
            .map(|store| {
                let path = store.path_for_thread(&thread).map_err(error)?;
                let stored = store.storage_path(&path).map_err(error)?;
                Ok::<_, ThreadStoreError>((path, stored))
            })
            .transpose()?;
        let mut conn = self.open_thread_store()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        insert_thread_row(
            &tx,
            thread.clone(),
            rollout_path.as_ref().map(|(_, stored)| stored.as_str()),
        )?;
        if let (Some(store), Some((path, _))) = (self.rollout_store(), rollout_path.as_ref()) {
            store.ensure_thread(path, &thread).map_err(error)?;
        }
        tx.commit().map_err(store_error)
    }

    pub(crate) fn read_thread_sync(
        &self,
        params: ReadThreadParams,
    ) -> ThreadStoreResult<Option<Thread>> {
        let conn = self.open_thread_store()?;
        if is_pending_spawn_thread(&conn, &params.thread_id)? {
            return Ok(None);
        }
        let Some((mut thread, archived)) = read_thread_row(&conn, &params.thread_id)? else {
            return Ok(None);
        };
        if archived && !params.include_archived {
            return Ok(None);
        }
        hydrate_thread(&conn, &mut thread, params.turns_view)?;
        self.enrich_thread_agent_context(&conn, &mut thread)?;
        sections::hydrate_thread_section(&conn, &mut thread)?;
        Ok(Some(thread))
    }

    fn list_threads_sync(&self, params: ListThreadsParams) -> ThreadStoreResult<ThreadPage> {
        let conn = self.open_thread_store()?;
        let limit = page_limit(params.page.limit)?;
        let cursor = decode_cursor(params.page.cursor.as_ref(), CursorKind::Threads)?;
        let direction = params.page.sort_direction;
        if params.sort_by_section_position && !matches!(params.section.as_ref(), Some(Some(_))) {
            return Err(ThreadStoreError::invalid_request(
                "section_position sort requires a non-null section filter",
            ));
        }
        let mut rows = match params.section.as_ref() {
            Some(Some(section_id)) => sections::query_section_thread_page(
                &conn,
                params.include_archived,
                section_id,
                params.project.as_ref(),
                params.sort_by_section_position,
                direction,
                cursor.as_ref(),
                limit + 1,
            )?,
            Some(None) => sections::query_unsectioned_thread_page(
                &conn,
                params.include_archived,
                params.project.as_ref(),
                direction,
                cursor.as_ref(),
                limit + 1,
            )?,
            None => query_thread_page(
                &conn,
                params.include_archived,
                params.project.as_ref(),
                direction,
                cursor.as_ref(),
                limit + 1,
            )?,
        };
        let has_more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next_cursor = has_more
            .then(|| rows.last())
            .flatten()
            .map(|(_, position, id)| encode_cursor(CursorKind::Threads, *position, id))
            .transpose()?;
        let backwards_cursor = params
            .page
            .cursor
            .as_ref()
            .and_then(|_| rows.first())
            .map(|(_, position, id)| encode_cursor(CursorKind::Threads, *position, id))
            .transpose()?;
        for (thread, _, _) in &mut rows {
            self.enrich_thread_agent_context(&conn, thread)?;
            sections::hydrate_thread_section(&conn, thread)?;
        }
        Ok(ThreadPage {
            data: rows.into_iter().map(|(thread, _, _)| thread).collect(),
            next_cursor,
            backwards_cursor,
        })
    }

    fn enrich_thread_agent_context(
        &self,
        conn: &Connection,
        thread: &mut Thread,
    ) -> ThreadStoreResult<()> {
        thread.parent_thread_id = None;
        thread.agent_path = None;
        thread.agent_nickname = None;
        thread.agent_role = None;
        thread.last_task_message = None;
        thread.agent_state = None;
        let Some(parent) = self.read_thread_spawn_parent_with_conn(conn, &thread.thread_id)? else {
            return Ok(());
        };
        thread.parent_thread_id = Some(parent.parent_thread_id.clone());
        if let Some(identity) = self.read_agent_identity_sync(thread.thread_id.clone())? {
            thread.agent_path = Some(identity.agent_path);
            thread.agent_nickname = non_empty_string(identity.nickname);
            thread.agent_role = non_empty_string(identity.role);
            thread.last_task_message = non_empty_string(identity.last_task_message);
        }
        thread.agent_state = Some(derive_agent_state(thread, parent.status));
        Ok(())
    }

    fn list_turns_sync(&self, params: ListTurnsParams) -> ThreadStoreResult<TurnPage> {
        let conn = self.open_thread_store()?;
        ensure_thread_visible(&conn, &params.thread_id, params.include_archived)?;
        let limit = page_limit(params.page.limit)?;
        let cursor = decode_cursor(params.page.cursor.as_ref(), CursorKind::Turns)?;
        let mut rows = query_turn_page(
            &conn,
            &params.thread_id,
            params.page.sort_direction,
            cursor.as_ref(),
            limit + 1,
        )?;
        let has_more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        for (turn, _, _) in &mut rows {
            hydrate_turn(&conn, turn, params.items_view)?;
        }
        let next_cursor = has_more
            .then(|| rows.last())
            .flatten()
            .map(|(_, ordinal, id)| encode_cursor(CursorKind::Turns, *ordinal, id))
            .transpose()?;
        let backwards_cursor = rows
            .first()
            .map(|(_, ordinal, id)| {
                encode_cursor_with_inclusive(CursorKind::Turns, *ordinal, id, true)
            })
            .transpose()?;
        Ok(TurnPage {
            data: rows.into_iter().map(|(turn, _, _)| turn).collect(),
            next_cursor,
            backwards_cursor,
        })
    }

    fn list_items_sync(&self, params: ListItemsParams) -> ThreadStoreResult<ItemPage> {
        let conn = self.open_thread_store()?;
        ensure_thread_visible(&conn, &params.thread_id, params.include_archived)?;
        let limit = page_limit(params.page.limit)?;
        let cursor = decode_cursor(params.page.cursor.as_ref(), CursorKind::Items)?;
        let mut rows = query_item_page(
            &conn,
            &params.thread_id,
            params.turn_id.as_ref(),
            params.page.sort_direction,
            cursor.as_ref(),
            limit + 1,
        )?;
        let has_more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next_cursor = has_more
            .then(|| rows.last())
            .flatten()
            .map(|(_, ordinal, id)| encode_cursor(CursorKind::Items, *ordinal, id))
            .transpose()?;
        let backwards_cursor = rows
            .first()
            .map(|(_, ordinal, id)| {
                encode_cursor_with_inclusive(CursorKind::Items, *ordinal, id, true)
            })
            .transpose()?;
        Ok(ItemPage {
            data: rows.into_iter().map(|(item, _, _)| item).collect(),
            next_cursor,
            backwards_cursor,
        })
    }

    fn delete_thread_sync(&self, params: DeleteThreadParams) -> ThreadStoreResult<()> {
        let mut conn = self.open_thread_store()?;
        let tx = conn.transaction().map_err(store_error)?;
        tx.execute(
            "DELETE FROM canonical_items WHERE thread_id = ?1",
            params![params.thread_id.as_str()],
        )
        .map_err(store_error)?;
        tx.execute(
            "DELETE FROM canonical_turns WHERE thread_id = ?1",
            params![params.thread_id.as_str()],
        )
        .map_err(store_error)?;
        tx.execute(
            "DELETE FROM canonical_history_applies WHERE thread_id = ?1",
            params![params.thread_id.as_str()],
        )
        .map_err(store_error)?;
        tx.execute(
            "DELETE FROM canonical_threads WHERE thread_id = ?1",
            params![params.thread_id.as_str()],
        )
        .map_err(store_error)?;
        tx.commit().map_err(store_error)
    }

    fn history_sequence_sync(&self, thread_id: ThreadId) -> ThreadStoreResult<Option<u64>> {
        let conn = self.open_thread_store()?;
        let value = conn
            .query_row(
                "SELECT last_sequence FROM canonical_threads WHERE thread_id = ?1",
                params![thread_id.as_str()],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(store_error)?
            .flatten();
        value
            .map(|sequence| from_i64(sequence, "history sequence"))
            .transpose()
    }
}

fn non_empty_string(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn derive_agent_state(thread: &Thread, edge_status: ThreadSpawnEdgeStatus) -> CollabAgentState {
    let latest_turn = thread.turns.iter().max_by(|left, right| {
        left.updated_at_ms
            .cmp(&right.updated_at_ms)
            .then_with(|| left.turn_id.as_str().cmp(right.turn_id.as_str()))
    });
    let status = match edge_status {
        ThreadSpawnEdgeStatus::Pending => CollabAgentStatus::NotFound,
        ThreadSpawnEdgeStatus::Closed => CollabAgentStatus::Shutdown,
        ThreadSpawnEdgeStatus::Open => match &thread.status {
            ThreadStatus::Active { .. } => CollabAgentStatus::Running,
            ThreadStatus::SystemError => CollabAgentStatus::Errored,
            ThreadStatus::NotLoaded | ThreadStatus::Idle => {
                match latest_turn.map(|turn| turn.status) {
                    Some(TurnStatus::InProgress) => CollabAgentStatus::Running,
                    Some(TurnStatus::Interrupted) => CollabAgentStatus::Interrupted,
                    Some(TurnStatus::Failed) => CollabAgentStatus::Errored,
                    Some(TurnStatus::Completed) => CollabAgentStatus::Completed,
                    None => CollabAgentStatus::PendingInit,
                }
            }
        },
    };
    let message = (status == CollabAgentStatus::Errored)
        .then(|| latest_turn.and_then(|turn| turn.error.as_ref()))
        .flatten()
        .map(|error| error.message.clone())
        .filter(|message| !message.trim().is_empty());
    CollabAgentState { status, message }
}

impl ThreadStore for ProjectionStore {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn create_thread(&self, params: CreateThreadParams) -> ThreadStoreFuture<'_, ()> {
        let store = self.clone();
        Box::pin(async move { store.create_thread_sync(params) })
    }

    fn read_thread(&self, params: ReadThreadParams) -> ThreadStoreFuture<'_, Option<Thread>> {
        let store = self.clone();
        Box::pin(async move { store.read_thread_sync(params) })
    }

    fn list_threads(&self, params: ListThreadsParams) -> ThreadStoreFuture<'_, ThreadPage> {
        let store = self.clone();
        Box::pin(async move { store.list_threads_sync(params) })
    }

    fn list_thread_sections(
        &self,
        params: ListThreadSectionsParams,
    ) -> ThreadStoreFuture<'_, ThreadSectionPage> {
        let store = self.clone();
        Box::pin(async move { sections::list_thread_sections(&store, params) })
    }

    fn create_thread_section(
        &self,
        params: CreateThreadSectionParams,
    ) -> ThreadStoreFuture<'_, StoredThreadSection> {
        let store = self.clone();
        Box::pin(async move { sections::create_thread_section(&store, params) })
    }

    fn rename_thread_section(
        &self,
        params: RenameThreadSectionParams,
    ) -> ThreadStoreFuture<'_, Option<StoredThreadSection>> {
        let store = self.clone();
        Box::pin(async move { sections::rename_thread_section(&store, params) })
    }

    fn delete_thread_section(
        &self,
        params: DeleteThreadSectionParams,
    ) -> ThreadStoreFuture<'_, bool> {
        let store = self.clone();
        Box::pin(async move { sections::delete_thread_section(&store, params) })
    }

    fn move_thread_to_section(
        &self,
        params: MoveThreadToSectionParams,
    ) -> ThreadStoreFuture<'_, ()> {
        let store = self.clone();
        Box::pin(async move { sections::move_thread_to_section(&store, params) })
    }

    fn search_threads(
        &self,
        params: SearchThreadsParams,
    ) -> ThreadStoreFuture<'_, ThreadSearchPage> {
        let store = self.clone();
        Box::pin(async move { search::search_threads(&store, params) })
    }

    fn append_items(
        &self,
        params: AppendThreadItemsParams,
    ) -> ThreadStoreFuture<'_, ApplyThreadHistoryResult> {
        let store = self.clone();
        Box::pin(async move { store.append_items_sync(params) })
    }

    fn apply_history(
        &self,
        params: ApplyThreadHistoryParams,
    ) -> ThreadStoreFuture<'_, ApplyThreadHistoryResult> {
        let store = self.clone();
        Box::pin(async move { store.apply_history_sync(params) })
    }

    fn list_turns(&self, params: ListTurnsParams) -> ThreadStoreFuture<'_, TurnPage> {
        let store = self.clone();
        Box::pin(async move { store.list_turns_sync(params) })
    }

    fn list_items(&self, params: ListItemsParams) -> ThreadStoreFuture<'_, ItemPage> {
        let store = self.clone();
        Box::pin(async move { store.list_items_sync(params) })
    }

    fn search_thread_occurrences(
        &self,
        params: thread_store::SearchThreadOccurrencesParams,
    ) -> ThreadStoreFuture<'_, thread_store::ThreadOccurrenceSearchPage> {
        let store = self.clone();
        Box::pin(async move { search::search_thread_occurrences(&store, params) })
    }

    fn update_thread_metadata(
        &self,
        params: UpdateThreadMetadataParams,
    ) -> ThreadStoreFuture<'_, Thread> {
        let store = self.clone();
        Box::pin(async move { store.update_thread_metadata_sync(params) })
    }

    fn archive_thread(&self, params: ArchiveThreadParams) -> ThreadStoreFuture<'_, ()> {
        let store = self.clone();
        Box::pin(async move { store.set_archived_sync(params, true).map(|_| ()) })
    }

    fn unarchive_thread(&self, params: ArchiveThreadParams) -> ThreadStoreFuture<'_, Thread> {
        let store = self.clone();
        Box::pin(async move {
            store
                .set_archived_sync(params, false)?
                .ok_or_else(|| error("unarchive did not return a thread"))
        })
    }

    fn delete_thread(&self, params: DeleteThreadParams) -> ThreadStoreFuture<'_, ()> {
        let store = self.clone();
        Box::pin(async move { store.delete_thread_sync(params) })
    }

    fn history_sequence(&self, thread_id: ThreadId) -> ThreadStoreFuture<'_, Option<u64>> {
        let store = self.clone();
        Box::pin(async move { store.history_sequence_sync(thread_id) })
    }

    fn list_projects(
        &self,
        params: ListProjectsParams,
    ) -> ThreadStoreFuture<'_, StoredProjectsPage> {
        let store = self.clone();
        Box::pin(async move { projects::list_projects(&store, params) })
    }

    fn read_project(&self, project_id: String) -> ThreadStoreFuture<'_, Option<StoredProject>> {
        let store = self.clone();
        Box::pin(async move { projects::read_project(&store, project_id) })
    }

    fn create_project(&self, params: CreateProjectParams) -> ThreadStoreFuture<'_, CreatedProject> {
        let store = self.clone();
        Box::pin(async move { projects::create_project(&store, params) })
    }

    fn update_project(
        &self,
        params: UpdateProjectParams,
    ) -> ThreadStoreFuture<'_, Option<UpdatedProject>> {
        let store = self.clone();
        Box::pin(async move { projects::update_project(&store, params) })
    }

    fn move_project(
        &self,
        params: MoveProjectParams,
    ) -> ThreadStoreFuture<'_, Option<ProjectMoveOutcome>> {
        let store = self.clone();
        Box::pin(async move { projects::move_project(&store, params) })
    }

    fn delete_project(&self, project_id: String) -> ThreadStoreFuture<'_, Option<DeletedProject>> {
        let store = self.clone();
        Box::pin(async move { projects::delete_project(&store, project_id) })
    }
}

fn apply_metadata_patch(thread: &mut Thread, patch: ThreadMetadataPatch) {
    if let Some(name) = patch.name {
        thread.name = name;
    }
    if let Some(preview) = patch.preview {
        thread.preview = preview;
    }
    if let Some(model_provider) = patch.model_provider {
        thread.model_provider = model_provider;
    }
    if let Some(forked_from_id) = patch.forked_from_id {
        thread.forked_from_id = Some(forked_from_id);
    }
    if let Some(product) = patch.product {
        thread.product = product;
    }
    if let Some(updated_at_ms) = patch.updated_at_ms {
        thread.updated_at_ms = updated_at_ms;
    }
    if let Some(recency_at_ms) = patch.advance_recency_at_ms {
        thread.recency_at_ms = Some(
            thread
                .recency_at_ms
                .map_or(recency_at_ms, |current| current.max(recency_at_ms)),
        );
    }
    if let Some(metadata) = patch.metadata {
        thread.metadata = metadata.unwrap_or(serde_json::Value::Null);
    }
    if !patch.metadata_values.is_empty() {
        if !thread.metadata.is_object() {
            thread.metadata = serde_json::Value::Object(Default::default());
        }
        thread
            .metadata
            .as_object_mut()
            .expect("metadata object")
            .extend(patch.metadata_values);
    }
}

fn validate_change_set(params: &ApplyThreadHistoryParams) -> ThreadStoreResult<()> {
    if params.changes.sequence > i64::MAX as u64 {
        return Err(error("history sequence exceeds SQLite range"));
    }
    if params
        .changes
        .rollback_to_sequence
        .is_some_and(|target| target >= params.changes.sequence)
    {
        return Err(error("rollback target must precede the applied sequence"));
    }
    for turn in &params.changes.changed_turns {
        if turn.session_id != params.session_id || turn.thread_id != params.thread_id {
            return Err(error("turn identity does not match history change set"));
        }
    }
    for item in &params.changes.changed_items {
        if item.session_id != params.session_id || item.thread_id != params.thread_id {
            return Err(error("item identity does not match history change set"));
        }
        if item.sequence > params.changes.sequence {
            return Err(error(format!(
                "item sequence {} exceeds history sequence {}",
                item.sequence, params.changes.sequence
            )));
        }
    }
    Ok(())
}

fn validate_append_items(params: &AppendThreadItemsParams) -> ThreadStoreResult<()> {
    if params.sequence > i64::MAX as u64 {
        return Err(error("history sequence exceeds SQLite range"));
    }
    for item in &params.items {
        if item.session_id != params.session_id || item.thread_id != params.thread_id {
            return Err(error("item identity does not match append parameters"));
        }
    }
    Ok(())
}

fn validate_thread_identity(thread: &Thread) -> ThreadStoreResult<()> {
    if thread.session_id.as_str().trim().is_empty() || thread.thread_id.as_str().trim().is_empty() {
        return Err(error("thread identity must not be empty"));
    }
    Ok(())
}

fn insert_thread_row(
    conn: &Connection,
    thread: Thread,
    rollout_path: Option<&str>,
) -> ThreadStoreResult<()> {
    validate_thread_identity(&thread)?;
    let thread = thread_without_turns(thread);
    let encoded = encode_json(&thread)?;
    conn.execute(
        "INSERT INTO canonical_threads (
            thread_id, session_id, thread_json, created_at_ms, updated_at_ms,
            recency_at_ms, archived, last_sequence, rollout_path
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)",
        params![
            thread.thread_id.as_str(),
            thread.session_id.as_str(),
            encoded,
            thread.created_at_ms,
            thread.updated_at_ms,
            thread.recency_at_ms,
            i64::from(thread.archived),
            rollout_path,
        ],
    )
    .map_err(|source| error(format!("cannot create canonical thread: {source}")))?;
    Ok(())
}

fn canonical_history_matches(thread: &Thread, changes: &ThreadHistoryChangeSet) -> bool {
    let expected_turn_ids = changes
        .changed_turns
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect::<HashSet<_>>();
    let actual_turn_ids = thread
        .turns
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect::<HashSet<_>>();
    if expected_turn_ids != actual_turn_ids {
        return false;
    }

    let actual_items = thread
        .turns
        .iter()
        .flat_map(|turn| &turn.items)
        .map(|item| (item.item_id.as_str(), item))
        .collect::<HashMap<_, _>>();
    actual_items.len() == changes.changed_items.len()
        && changes.changed_items.iter().all(|expected| {
            actual_items
                .get(expected.item_id.as_str())
                .is_some_and(|actual| *actual == expected)
        })
}

fn thread_without_turns(mut thread: Thread) -> Thread {
    thread.turns.clear();
    thread.turns_view = ThreadTurnsView::NotLoaded;
    // Agent identity and status are joined from the durable graph/identity stores on read.
    thread.parent_thread_id = None;
    thread.agent_path = None;
    thread.agent_nickname = None;
    thread.agent_role = None;
    thread.last_task_message = None;
    thread.agent_state = None;
    thread
}

fn turn_without_items(mut turn: Turn) -> Turn {
    turn.items.clear();
    turn.items_view = TurnItemsView::NotLoaded;
    turn
}

fn page_limit(limit: u32) -> ThreadStoreResult<u32> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(error(format!(
            "page limit must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }
    Ok(limit)
}

fn encode_cursor(kind: CursorKind, position: i64, id: &str) -> ThreadStoreResult<StoreCursor> {
    encode_cursor_with_inclusive(kind, position, id, false)
}

fn encode_cursor_with_inclusive(
    kind: CursorKind,
    position: i64,
    id: &str,
    inclusive: bool,
) -> ThreadStoreResult<StoreCursor> {
    let json = serde_json::to_vec(&CursorValue {
        kind,
        position,
        id: id.to_string(),
        inclusive,
    })
    .map_err(store_error)?;
    StoreCursor::new(URL_SAFE_NO_PAD.encode(json)).map_err(error)
}

fn decode_cursor(
    cursor: Option<&StoreCursor>,
    expected_kind: CursorKind,
) -> ThreadStoreResult<Option<CursorValue>> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor.as_str())
        .map_err(|_| error("invalid store cursor"))?;
    let decoded: CursorValue =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid store cursor"))?;
    if decoded.kind != expected_kind || decoded.id.is_empty() {
        return Err(error("store cursor belongs to another collection"));
    }
    Ok(Some(decoded))
}

fn change_fingerprint(params: &ApplyThreadHistoryParams) -> ThreadStoreResult<String> {
    let bytes = serde_json::to_vec(params).map_err(store_error)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn encode_json<T: Serialize>(value: &T) -> ThreadStoreResult<String> {
    serde_json::to_string(value).map_err(store_error)
}

fn decode_json<T: serde::de::DeserializeOwned>(value: &str) -> ThreadStoreResult<T> {
    serde_json::from_str(value).map_err(store_error)
}

fn to_i64(value: u64, field: &str) -> ThreadStoreResult<i64> {
    i64::try_from(value).map_err(|_| error(format!("{field} exceeds SQLite range")))
}

fn from_i64(value: i64, field: &str) -> ThreadStoreResult<u64> {
    u64::try_from(value).map_err(|_| error(format!("{field} is negative")))
}

fn error(message: impl Into<String>) -> ThreadStoreError {
    ThreadStoreError::new(message)
}

fn store_error(source: impl std::fmt::Display) -> ThreadStoreError {
    error(source.to_string())
}
