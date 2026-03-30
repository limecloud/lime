use crate::aster_runtime_support::{
    clear_aster_runtime_queued_turns, enqueue_aster_runtime_turn, list_aster_runtime_queued_turns,
    prepare_aster_runtime_queue_resumption, queued_turn_event_name_from_runtime,
    queued_turn_runtime_from_task, queued_turn_snapshot_from_runtime,
    remove_aster_runtime_queued_turn,
};
use crate::protocol::AgentEvent as RuntimeAgentEvent;
use crate::{QueuedTurnSnapshot, QueuedTurnTask};
use aster::session::{
    require_shared_session_runtime_queue_service, QueuedTurnRuntime, RuntimeQueueSubmitResult,
};
use futures::future::BoxFuture;
use serde_json::Value;
use std::sync::Arc;

pub type RuntimeQueueExecutor<C> =
    Arc<dyn Fn(C, Value) -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

pub type RuntimeQueueEventEmitter = Arc<dyn Fn(String, RuntimeAgentEvent) + Send + Sync + 'static>;

fn emit_runtime_queue_event(
    emitter: &RuntimeQueueEventEmitter,
    event_name: &str,
    event: RuntimeAgentEvent,
) {
    emitter(event_name.to_string(), event);
}

fn spawn_runtime_turn_task<C>(
    session_id: String,
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
    payload: Value,
) where
    C: Clone + Send + Sync + 'static,
{
    tokio::spawn(async move {
        let result = executor(context.clone(), payload).await;
        if let Err(error) = continue_runtime_queue_after_turn(
            session_id,
            context.clone(),
            executor.clone(),
            emitter.clone(),
        )
        .await
        {
            tracing::warn!("[AsterAgent][Queue] 调度下一条排队 turn 失败: {}", error);
        }
        if let Err(error) = result {
            tracing::warn!("[AsterAgent][Queue] 队列任务执行失败: {}", error);
        }
    });
}

async fn continue_runtime_queue_after_turn<C>(
    session_id: String,
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
) -> Result<bool, String>
where
    C: Clone + Send + Sync + 'static,
{
    start_next_runtime_queue_turn(session_id, false, context, executor, emitter).await
}

async fn start_next_runtime_queue_turn<C>(
    session_id: String,
    acquire_gate: bool,
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
) -> Result<bool, String>
where
    C: Clone + Send + Sync + 'static,
{
    let runtime_queue_service = require_shared_session_runtime_queue_service()
        .map_err(|error| format!("读取 runtime queue service 失败: {error}"))?;
    let next_queued_turn = match if acquire_gate {
        runtime_queue_service.resume_if_idle(&session_id).await
    } else {
        runtime_queue_service
            .finish_turn_and_take_next(&session_id)
            .await
    } {
        Ok(next_queued_turn) => next_queued_turn,
        Err(error) => {
            return Err(format!("读取下一条 runtime queue turn 失败: {}", error));
        }
    };
    let Some(next_queued_turn) = next_queued_turn else {
        return Ok(false);
    };

    let event_name = queued_turn_event_name_from_runtime(&next_queued_turn);
    emit_runtime_queue_event(
        &emitter,
        &event_name,
        RuntimeAgentEvent::QueueStarted {
            session_id: session_id.clone(),
            queued_turn_id: next_queued_turn.queued_turn_id.clone(),
        },
    );

    spawn_runtime_turn_task(
        session_id,
        context,
        executor,
        emitter,
        next_queued_turn.payload,
    );
    Ok(true)
}

pub async fn resume_runtime_queue_if_needed<C>(
    session_id: String,
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
) -> Result<bool, String>
where
    C: Clone + Send + Sync + 'static,
{
    if list_aster_runtime_queued_turns(&session_id)
        .await?
        .is_empty()
    {
        return Ok(false);
    }

    start_next_runtime_queue_turn(session_id, true, context, executor, emitter).await
}

pub async fn submit_runtime_turn<C>(
    queued_task: QueuedTurnTask<Value>,
    queue_if_busy: bool,
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
) -> Result<(), String>
where
    C: Clone + Send + Sync + 'static,
{
    let runtime_queue_service = require_shared_session_runtime_queue_service()
        .map_err(|error| format!("读取 runtime queue service 失败: {error}"))?;
    let session_id = queued_task.session_id.clone();
    let _ = resume_runtime_queue_if_needed(
        session_id.clone(),
        context.clone(),
        executor.clone(),
        emitter.clone(),
    )
    .await?;

    match runtime_queue_service
        .submit_turn(queued_turn_runtime_from_task(&queued_task), queue_if_busy)
        .await
        .map_err(|error| format!("提交 runtime queue turn 失败: {error}"))?
    {
        RuntimeQueueSubmitResult::StartNow => {
            spawn_runtime_turn_task(session_id, context, executor, emitter, queued_task.payload);
            Ok(())
        }
        RuntimeQueueSubmitResult::Busy => Err("当前会话仍在生成，无法立即开始执行".to_string()),
        RuntimeQueueSubmitResult::Enqueued {
            queued_turn,
            position,
        } => {
            emit_runtime_queue_event(
                &emitter,
                &queued_turn_event_name_from_runtime(&queued_turn),
                RuntimeAgentEvent::QueueAdded {
                    session_id,
                    queued_turn: queued_turn_snapshot_from_runtime(&queued_turn, position),
                },
            );
            Ok(())
        }
    }
}

pub async fn clear_runtime_queue(
    session_id: &str,
    emitter: RuntimeQueueEventEmitter,
) -> Result<Vec<QueuedTurnRuntime>, String> {
    let cleared = clear_aster_runtime_queued_turns(session_id).await?;
    if cleared.is_empty() {
        return Ok(cleared);
    }

    let queued_turn_ids = cleared
        .iter()
        .map(|queued_turn| queued_turn.queued_turn_id.clone())
        .collect::<Vec<_>>();
    for queued_turn in &cleared {
        emit_runtime_queue_event(
            &emitter,
            &queued_turn_event_name_from_runtime(queued_turn),
            RuntimeAgentEvent::QueueCleared {
                session_id: session_id.to_string(),
                queued_turn_ids: queued_turn_ids.clone(),
            },
        );
    }

    Ok(cleared)
}

pub async fn list_runtime_queue_snapshots(
    session_id: &str,
) -> Result<Vec<QueuedTurnSnapshot>, String> {
    Ok(list_aster_runtime_queued_turns(session_id)
        .await?
        .iter()
        .enumerate()
        .map(|(index, queued_turn)| queued_turn_snapshot_from_runtime(queued_turn, index + 1))
        .collect())
}

pub async fn remove_runtime_queued_turn(
    session_id: &str,
    queued_turn_id: &str,
    emitter: RuntimeQueueEventEmitter,
) -> Result<bool, String> {
    let queued_turns = list_aster_runtime_queued_turns(session_id).await?;
    let Some(existing) = queued_turns
        .into_iter()
        .find(|queued_turn| queued_turn.queued_turn_id == queued_turn_id)
    else {
        return Ok(false);
    };

    let removed = remove_aster_runtime_queued_turn(queued_turn_id).await?;
    let Some(queued_turn) = removed else {
        return Ok(false);
    };

    emit_runtime_queue_event(
        &emitter,
        &queued_turn_event_name_from_runtime(&existing),
        RuntimeAgentEvent::QueueRemoved {
            session_id: session_id.to_string(),
            queued_turn_id: queued_turn.queued_turn_id,
        },
    );
    Ok(true)
}

pub async fn promote_runtime_queued_turn(
    session_id: &str,
    queued_turn_id: &str,
) -> Result<bool, String> {
    let queued_turns = list_aster_runtime_queued_turns(session_id).await?;
    if queued_turns.is_empty() {
        return Ok(false);
    }

    if queued_turns
        .first()
        .map(|queued_turn| queued_turn.queued_turn_id == queued_turn_id)
        .unwrap_or(false)
    {
        return Ok(true);
    }

    let Some(target_index) = queued_turns
        .iter()
        .position(|queued_turn| queued_turn.queued_turn_id == queued_turn_id)
    else {
        return Ok(false);
    };

    let mut reordered_turns = Vec::with_capacity(queued_turns.len());
    reordered_turns.push(queued_turns[target_index].clone());
    reordered_turns.extend(
        queued_turns
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != target_index)
            .map(|(_, queued_turn)| queued_turn.clone()),
    );

    let original_turns = queued_turns;
    clear_aster_runtime_queued_turns(session_id).await?;

    for queued_turn in &reordered_turns {
        if let Err(error) = enqueue_aster_runtime_turn(queued_turn.clone()).await {
            clear_aster_runtime_queued_turns(session_id).await?;
            for original_turn in original_turns {
                enqueue_aster_runtime_turn(original_turn).await?;
            }
            return Err(error);
        }
    }

    Ok(true)
}

pub async fn resume_persisted_runtime_queues_on_startup<C>(
    context: C,
    executor: RuntimeQueueExecutor<C>,
    emitter: RuntimeQueueEventEmitter,
) -> Result<usize, String>
where
    C: Clone + Send + Sync + 'static,
{
    let session_ids = prepare_aster_runtime_queue_resumption().await?;
    if session_ids.is_empty() {
        return Ok(0);
    }

    let mut resumed = 0usize;
    for session_id in session_ids {
        if resume_runtime_queue_if_needed(
            session_id.clone(),
            context.clone(),
            executor.clone(),
            emitter.clone(),
        )
        .await?
        {
            resumed += 1;
            tracing::info!(
                "[AsterAgent][Queue] 启动阶段已恢复会话排队执行: session_id={}",
                session_id
            );
        }
    }

    Ok(resumed)
}
