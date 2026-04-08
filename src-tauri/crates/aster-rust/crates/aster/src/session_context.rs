use crate::conversation::message::ActionRequiredScope;
use crate::session::TurnContextOverride;
use futures::{Stream, StreamExt};
use tokio::task_local;

pub const SESSION_ID_HEADER: &str = "aster-session-id";

task_local! {
    pub static SESSION_ID: Option<String>;
}

task_local! {
    pub static ACTION_SCOPE: ActionRequiredScope;
}

task_local! {
    pub static TURN_CONTEXT: Option<TurnContextOverride>;
}

pub async fn with_session_id<F>(session_id: Option<String>, f: F) -> F::Output
where
    F: std::future::Future,
{
    if let Some(id) = session_id {
        SESSION_ID.scope(Some(id), f).await
    } else {
        f.await
    }
}

pub fn current_session_id() -> Option<String> {
    SESSION_ID.try_with(|id| id.clone()).ok().flatten()
}

pub async fn with_action_scope<F>(scope: ActionRequiredScope, f: F) -> F::Output
where
    F: std::future::Future,
{
    let session_id = scope.session_id.clone();
    if let Some(id) = session_id {
        SESSION_ID
            .scope(Some(id), ACTION_SCOPE.scope(scope, f))
            .await
    } else {
        ACTION_SCOPE.scope(scope, f).await
    }
}

pub async fn with_turn_context<F>(turn_context: Option<TurnContextOverride>, f: F) -> F::Output
where
    F: std::future::Future,
{
    TURN_CONTEXT.scope(turn_context, f).await
}

pub async fn with_runtime_scope<F>(
    scope: ActionRequiredScope,
    turn_context: Option<TurnContextOverride>,
    f: F,
) -> F::Output
where
    F: std::future::Future,
{
    with_action_scope(scope, with_turn_context(turn_context, f)).await
}

pub fn current_action_scope() -> Option<ActionRequiredScope> {
    ACTION_SCOPE.try_with(|scope| scope.clone()).ok()
}

pub fn current_turn_context() -> Option<TurnContextOverride> {
    TURN_CONTEXT
        .try_with(|turn_context| turn_context.clone())
        .ok()
        .flatten()
}

pub fn scope_stream<S>(
    scope: ActionRequiredScope,
    turn_context: Option<TurnContextOverride>,
    stream: S,
) -> impl Stream<Item = S::Item> + Send
where
    S: Stream + Unpin + Send,
{
    futures::stream::unfold(
        (scope, turn_context, stream),
        |(scope, turn_context, mut stream)| async move {
            let next = with_runtime_scope(scope.clone(), turn_context.clone(), async {
                stream.next().await
            })
            .await;
            next.map(|item| (item, (scope, turn_context, stream)))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn test_turn_context() -> TurnContextOverride {
        let mut metadata = HashMap::new();
        metadata.insert("provider".to_string(), serde_json::json!("openai"));
        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    #[tokio::test]
    async fn test_session_id_available_when_set() {
        with_session_id(Some("test-session-123".to_string()), async {
            assert_eq!(current_session_id(), Some("test-session-123".to_string()));
        })
        .await;
    }

    #[tokio::test]
    async fn test_session_id_none_when_not_set() {
        let id = current_session_id();
        assert_eq!(id, None);
    }

    #[tokio::test]
    async fn test_session_id_none_when_explicitly_none() {
        with_session_id(None, async {
            assert_eq!(current_session_id(), None);
        })
        .await;
    }

    #[tokio::test]
    async fn test_session_id_scoped_correctly() {
        assert_eq!(current_session_id(), None);

        with_session_id(Some("outer-session".to_string()), async {
            assert_eq!(current_session_id(), Some("outer-session".to_string()));

            with_session_id(Some("inner-session".to_string()), async {
                assert_eq!(current_session_id(), Some("inner-session".to_string()));
            })
            .await;

            assert_eq!(current_session_id(), Some("outer-session".to_string()));
        })
        .await;

        assert_eq!(current_session_id(), None);
    }

    #[tokio::test]
    async fn test_session_id_across_await_points() {
        with_session_id(Some("persistent-session".to_string()), async {
            assert_eq!(current_session_id(), Some("persistent-session".to_string()));

            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

            assert_eq!(current_session_id(), Some("persistent-session".to_string()));
        })
        .await;
    }

    #[tokio::test]
    async fn test_action_scope_sets_session_context() {
        let scope = ActionRequiredScope {
            session_id: Some("session-1".to_string()),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        with_action_scope(scope.clone(), async {
            assert_eq!(current_session_id(), Some("session-1".to_string()));
            assert_eq!(current_action_scope(), Some(scope));
        })
        .await;
    }

    #[tokio::test]
    async fn test_turn_context_available_when_set() {
        let turn_context = test_turn_context();

        with_turn_context(Some(turn_context.clone()), async {
            assert_eq!(current_turn_context(), Some(turn_context));
        })
        .await;
    }

    #[tokio::test]
    async fn test_runtime_scope_sets_action_scope_and_turn_context() {
        let scope = ActionRequiredScope {
            session_id: Some("session-2".to_string()),
            thread_id: Some("thread-2".to_string()),
            turn_id: Some("turn-2".to_string()),
        };
        let turn_context = test_turn_context();

        with_runtime_scope(scope.clone(), Some(turn_context.clone()), async {
            assert_eq!(current_session_id(), Some("session-2".to_string()));
            assert_eq!(current_action_scope(), Some(scope));
            assert_eq!(current_turn_context(), Some(turn_context));
        })
        .await;
    }
}
