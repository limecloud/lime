use anyhow::{anyhow, Result};
use aster::conversation::Conversation;
use aster::model::ModelConfig;
use aster::providers::api_client::{ApiClient, AuthMethod};
use aster::providers::base::Provider;
use aster::providers::openai::OpenAiProvider;
use aster::recipe::Recipe;
use aster::session::{
    ChatHistoryMatch, CommitOptions, CommitReport, ExtensionData, MemoryCategory, MemoryHealth,
    MemoryRecord, MemorySearchResult, MemoryStats, NoopSessionStore, Session, SessionInsights,
    SessionStore, SessionType, TokenStatsUpdate, TurnOutputSchemaStrategy,
};
use async_trait::async_trait;
use chrono::Utc;
use lime_agent::{build_session_execution_runtime, SessionConfigBuilder};
use lime_lib::services::artifact_output_schema_service::merge_turn_context_with_artifact_output_schema;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;
use tokio::sync::RwLock;
use uuid::Uuid;

fn build_openai_provider(model_config: ModelConfig) -> Result<OpenAiProvider> {
    let api_client = ApiClient::new(
        "https://api.deepseek.com".to_string(),
        AuthMethod::BearerToken("test-key".to_string()),
    )?;
    Ok(OpenAiProvider::new(api_client, model_config))
}

struct TestSessionStore {
    fallback: NoopSessionStore,
    sessions: RwLock<HashMap<String, Session>>,
}

impl Default for TestSessionStore {
    fn default() -> Self {
        Self {
            fallback: NoopSessionStore,
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

impl TestSessionStore {
    async fn create_user_session(&self, working_dir: PathBuf, name: &str) -> Result<Session> {
        <Self as SessionStore>::create_session(
            self,
            working_dir,
            name.to_string(),
            SessionType::User,
        )
        .await
    }
}

#[async_trait]
impl SessionStore for TestSessionStore {
    async fn create_session(
        &self,
        working_dir: PathBuf,
        name: String,
        session_type: SessionType,
    ) -> Result<Session> {
        let session = Session {
            id: format!("test-session-{}", Uuid::new_v4()),
            working_dir,
            name,
            user_set_name: false,
            session_type,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        };
        self.sessions
            .write()
            .await
            .insert(session.id.clone(), session.clone());
        Ok(session)
    }

    async fn get_session(&self, id: &str, _include_messages: bool) -> Result<Session> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("session not found: {id}"))
    }

    async fn add_message(
        &self,
        session_id: &str,
        message: &aster::conversation::message::Message,
    ) -> Result<()> {
        self.fallback.add_message(session_id, message).await
    }

    async fn replace_conversation(
        &self,
        session_id: &str,
        conversation: &Conversation,
    ) -> Result<()> {
        self.fallback
            .replace_conversation(session_id, conversation)
            .await
    }

    async fn list_sessions(&self) -> Result<Vec<Session>> {
        Ok(self.sessions.read().await.values().cloned().collect())
    }

    async fn list_sessions_by_types(&self, types: &[SessionType]) -> Result<Vec<Session>> {
        Ok(self
            .sessions
            .read()
            .await
            .values()
            .filter(|session| types.contains(&session.session_type))
            .cloned()
            .collect())
    }

    async fn delete_session(&self, id: &str) -> Result<()> {
        self.sessions.write().await.remove(id);
        Ok(())
    }

    async fn get_insights(&self) -> Result<SessionInsights> {
        Ok(SessionInsights {
            total_sessions: self.sessions.read().await.len(),
            total_tokens: 0,
        })
    }

    async fn export_session(&self, id: &str) -> Result<String> {
        self.fallback.export_session(id).await
    }

    async fn import_session(&self, json: &str) -> Result<Session> {
        self.fallback.import_session(json).await
    }

    async fn copy_session(&self, session_id: &str, new_name: String) -> Result<Session> {
        self.fallback.copy_session(session_id, new_name).await
    }

    async fn truncate_conversation(&self, session_id: &str, timestamp: i64) -> Result<()> {
        self.fallback
            .truncate_conversation(session_id, timestamp)
            .await
    }

    async fn update_session_name(
        &self,
        session_id: &str,
        name: String,
        user_set: bool,
    ) -> Result<()> {
        self.fallback
            .update_session_name(session_id, name, user_set)
            .await
    }

    async fn update_extension_data(
        &self,
        session_id: &str,
        extension_data: ExtensionData,
    ) -> Result<()> {
        self.fallback
            .update_extension_data(session_id, extension_data)
            .await
    }

    async fn update_token_stats(&self, session_id: &str, stats: TokenStatsUpdate) -> Result<()> {
        self.fallback.update_token_stats(session_id, stats).await
    }

    async fn update_provider_config(
        &self,
        session_id: &str,
        provider_name: Option<String>,
        model_config: Option<ModelConfig>,
    ) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("session not found: {session_id}"))?;
        session.provider_name = provider_name;
        session.model_config = model_config;
        session.updated_at = Utc::now();
        Ok(())
    }

    async fn update_recipe(
        &self,
        session_id: &str,
        recipe: Option<Recipe>,
        user_recipe_values: Option<HashMap<String, String>>,
    ) -> Result<()> {
        self.fallback
            .update_recipe(session_id, recipe, user_recipe_values)
            .await
    }

    async fn search_chat_history(
        &self,
        query: &str,
        limit: Option<usize>,
        after_date: Option<chrono::DateTime<chrono::Utc>>,
        before_date: Option<chrono::DateTime<chrono::Utc>>,
        exclude_session_id: Option<String>,
    ) -> Result<Vec<ChatHistoryMatch>> {
        self.fallback
            .search_chat_history(query, limit, after_date, before_date, exclude_session_id)
            .await
    }

    async fn commit_session(&self, id: &str, options: CommitOptions) -> Result<CommitReport> {
        self.fallback.commit_session(id, options).await
    }

    async fn search_memories(
        &self,
        query: &str,
        limit: Option<usize>,
        session_scope: Option<&str>,
        categories: Option<Vec<MemoryCategory>>,
    ) -> Result<Vec<MemorySearchResult>> {
        self.fallback
            .search_memories(query, limit, session_scope, categories)
            .await
    }

    async fn retrieve_context_memories(
        &self,
        session_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>> {
        self.fallback
            .retrieve_context_memories(session_id, query, limit)
            .await
    }

    async fn memory_stats(&self) -> Result<MemoryStats> {
        self.fallback.memory_stats().await
    }

    async fn memory_health(&self) -> Result<MemoryHealth> {
        self.fallback.memory_health().await
    }
}

#[test]
fn deepseek_reasoner_should_not_use_openai_native_output_schema() -> Result<()> {
    let deepseek_model = ModelConfig::new("deepseek-reasoner")?;
    let deepseek_provider = build_openai_provider(deepseek_model.clone())?;
    assert!(
        !deepseek_provider.supports_native_output_schema_with_model(&deepseek_model),
        "deepseek-reasoner 不应被判定为 OpenAI native output schema 模型"
    );

    let codex_model = ModelConfig::new("gpt-5.3-codex")?;
    let codex_provider = build_openai_provider(codex_model.clone())?;
    assert!(
        codex_provider.supports_native_output_schema_with_model(&codex_model),
        "gpt-5.3-codex 应保持 native output schema 能力"
    );

    Ok(())
}

#[tokio::test]
async fn artifact_runtime_should_mark_deepseek_reasoner_as_final_output_tool() -> Result<()> {
    let working_dir = tempdir()?;
    let store = Arc::new(TestSessionStore::default());
    let session = store
        .create_user_session(
            working_dir.path().to_path_buf(),
            "deepseek artifact runtime",
        )
        .await?;
    let agent = aster::agents::Agent::new().with_session_store(store.clone());

    let model_config = ModelConfig::new("deepseek-reasoner")?;
    let provider = Arc::new(build_openai_provider(model_config.clone())?);
    agent.update_provider(provider, &session.id).await?;

    let request_metadata = json!({
        "artifact": {
            "artifact_mode": "draft",
            "artifact_stage": "stage2",
            "artifact_kind": "report",
            "source_policy": "required"
        }
    });
    let turn_context = merge_turn_context_with_artifact_output_schema(
        Some(aster::session::TurnContextOverride {
            model: Some("deepseek-reasoner".to_string()),
            ..aster::session::TurnContextOverride::default()
        }),
        Some(&request_metadata),
    )
    .expect("turn context");
    assert!(turn_context.output_schema.is_some());

    let session_config = SessionConfigBuilder::new(&session.id)
        .thread_id("thread-deepseek")
        .turn_id("turn-deepseek")
        .turn_context(turn_context)
        .build();

    agent
        .ensure_runtime_turn_initialized(&session_config, Some("生成 Artifact 文档".to_string()))
        .await?;

    let snapshot = agent.runtime_snapshot(&session.id).await?;
    let turn = snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .find(|turn| turn.id == "turn-deepseek")
        .expect("runtime turn");

    assert_eq!(turn.status, aster::session::TurnStatus::Running);
    let output_schema_runtime = turn
        .output_schema_runtime
        .as_ref()
        .expect("output schema runtime");
    assert_eq!(
        output_schema_runtime.strategy,
        TurnOutputSchemaStrategy::FinalOutputTool
    );
    assert_eq!(
        output_schema_runtime.model_name.as_deref(),
        Some("deepseek-reasoner")
    );

    let updated_session = store.get_session(&session.id, false).await?;
    let execution_runtime = build_session_execution_runtime(
        &session.id,
        Some(&updated_session),
        None,
        Some(&snapshot),
        Some("deepseek".to_string()),
    )
    .expect("execution runtime");

    assert_eq!(
        execution_runtime
            .output_schema_runtime
            .as_ref()
            .map(|runtime| runtime.strategy),
        Some(TurnOutputSchemaStrategy::FinalOutputTool)
    );
    assert_eq!(
        execution_runtime.model_name.as_deref(),
        Some("deepseek-reasoner")
    );
    assert_eq!(
        execution_runtime.latest_turn_status.as_deref(),
        Some("running")
    );

    Ok(())
}
