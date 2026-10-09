//! Resolve exec start, resume and fork through the shared App Server thread lifecycle.

use std::path::Path;

use anyhow::{bail, Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    SortDirection, ThreadForkParams, ThreadForkResponse, ThreadHistoryMode, ThreadListCwdFilter,
    ThreadListParams, ThreadListResponse, ThreadResumeParams, ThreadResumeResponse, ThreadSortKey,
    ThreadStartParams, ThreadStartResponse, METHOD_THREAD_FORK, METHOD_THREAD_LIST,
    METHOD_THREAD_RESUME, METHOD_THREAD_START,
};
use uuid::Uuid;

use super::cli::{Command, ResumeArgs};
use crate::{permission_settings, ConnectionArgs};

pub(super) async fn start_thread(
    handle: &RequestHandle,
    command: Option<&Command>,
    connection: &ConnectionArgs,
    cwd: &Path,
) -> Result<String> {
    match command {
        Some(Command::Fork(args)) => {
            let source = ResumeArgs {
                session_id: Some(args.session_id.clone()),
                all: true,
                ..Default::default()
            };
            let thread_id = resolve_resume_thread_id(handle, &source, cwd, None)
                .await?
                .with_context(|| format!("Session not found: {}", args.session_id))?;
            let response: ThreadForkResponse = handle
                .request(METHOD_THREAD_FORK, fork_params(thread_id, connection, cwd)?)
                .await
                .context("failed to fork App Server thread")?;
            return Ok(response.thread.id);
        }
        Some(Command::Resume(args)) => {
            if let Some(thread_id) =
                resolve_resume_thread_id(handle, args, cwd, connection.provider.as_deref()).await?
            {
                let response: ThreadResumeResponse = handle
                    .request(
                        METHOD_THREAD_RESUME,
                        ThreadResumeParams {
                            thread_id,
                            exclude_turns: true,
                            ..Default::default()
                        },
                    )
                    .await
                    .context("failed to resume App Server thread")?;
                return Ok(response.thread.id);
            }
        }
        None | Some(Command::Review(_)) => {}
    }
    let cwd = cwd.to_string_lossy().into_owned();
    let response: ThreadStartResponse = handle
        .request(
            METHOD_THREAD_START,
            ThreadStartParams {
                cwd: Some(cwd.clone()),
                runtime_workspace_roots: Some(vec![cwd]),
                model: connection.model.clone(),
                model_provider: connection.provider.clone(),
                history_mode: Some(ThreadHistoryMode::Paginated),
                ..Default::default()
            },
        )
        .await
        .context("failed to start App Server thread")?;
    Ok(response.thread.id)
}

fn fork_params(
    thread_id: String,
    connection: &ConnectionArgs,
    cwd: &Path,
) -> Result<ThreadForkParams> {
    let policy = permission_settings(connection)?;
    let cwd = cwd.to_string_lossy().into_owned();
    Ok(ThreadForkParams {
        thread_id,
        model: connection.model.clone(),
        model_provider: connection.provider.clone(),
        cwd: Some(cwd.clone()),
        runtime_workspace_roots: Some(vec![cwd]),
        approval_policy: policy.approval_policy.map(serde_json::Value::String),
        approvals_reviewer: policy.approvals_reviewer.map(serde_json::Value::String),
        sandbox: policy.sandbox_policy.map(serde_json::Value::String),
        permissions: connection.permissions.clone(),
        exclude_turns: true,
        defer_goal_continuation: true,
        ..Default::default()
    })
}

pub(super) async fn resolve_resume_thread_id(
    handle: &RequestHandle,
    args: &ResumeArgs,
    cwd: &Path,
    provider: Option<&str>,
) -> Result<Option<String>> {
    if !args.last {
        match args.session_id.as_deref() {
            Some(id) if Uuid::parse_str(id).is_ok() => return Ok(Some(id.to_owned())),
            None => return Ok(None),
            _ => {}
        }
    }
    let mut params = resume_list_params(args, cwd, provider);
    loop {
        let response: ThreadListResponse = handle
            .request(METHOD_THREAD_LIST, params.clone())
            .await
            .context("failed to resolve exec resume through thread/list")?;
        for thread in response.data {
            if args.last || thread.name.as_deref() == args.session_id.as_deref() {
                return Ok(Some(thread.id));
            }
        }
        let Some(cursor) = response.next_cursor else {
            return Ok(None);
        };
        if params.cursor.as_ref() == Some(&cursor) {
            bail!("thread/list returned a repeated resume cursor");
        }
        params.cursor = Some(cursor);
    }
}

fn resume_list_params(args: &ResumeArgs, cwd: &Path, provider: Option<&str>) -> ThreadListParams {
    ThreadListParams {
        limit: Some(100),
        sort_key: Some(ThreadSortKey::UpdatedAt),
        sort_direction: Some(SortDirection::Desc),
        archived: Some(false),
        cwd: (!args.all).then(|| ThreadListCwdFilter::One(cwd.to_string_lossy().into_owned())),
        model_providers: args
            .last
            .then(|| provider.map(|provider| vec![provider.to_owned()]))
            .flatten(),
        search_term: (!args.last).then(|| args.session_id.clone()).flatten(),
        ..Default::default()
    }
}

#[cfg(test)]
#[path = "thread_tests.rs"]
mod tests;
