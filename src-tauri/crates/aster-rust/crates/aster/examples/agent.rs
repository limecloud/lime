use aster::agents::{Agent, AgentEvent, ExtensionConfig, SessionConfig};
use aster::config::{DEFAULT_EXTENSION_DESCRIPTION, DEFAULT_EXTENSION_TIMEOUT};
use aster::conversation::message::Message;
use aster::providers::create_with_named_model;
use aster::providers::databricks::DATABRICKS_DEFAULT_MODEL;
use aster::session::session_manager::SessionType;
use aster::session::SessionManager;
use dotenvy::dotenv;
use futures::StreamExt;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenv();

    let provider = create_with_named_model("databricks", DATABRICKS_DEFAULT_MODEL).await?;

    let agent = Agent::new();

    let session = SessionManager::create_session(
        PathBuf::default(),
        "max-turn-test".to_string(),
        SessionType::Hidden,
    )
    .await?;

    let _ = agent.update_provider(provider, &session.id).await;

    let config = ExtensionConfig::stdio(
        "developer",
        "./target/debug/aster",
        DEFAULT_EXTENSION_DESCRIPTION,
        DEFAULT_EXTENSION_TIMEOUT,
    )
    .with_args(vec!["mcp", "developer"]);
    agent.add_extension(config).await?;

    println!("Extensions:");
    for extension in agent.list_extensions().await {
        println!("  {}", extension);
    }

    let session_config = SessionConfig {
        id: session.id,
        thread_id: None,
        turn_id: None,
        schedule_id: None,
        max_turns: None,
        retry_config: None,
        system_prompt: None,
        include_context_trace: None,
        turn_context: None,
    };

    let user_message = Message::user()
        .with_text("can you summarize the readme.md in this dir using just a haiku?");

    let mut stream = agent.reply(user_message, session_config, None).await?;

    while let Some(event) = stream.next().await {
        match event? {
            AgentEvent::TurnStarted { turn } => {
                println!(
                    "turn started: thread_id={}, turn_id={}",
                    turn.thread_id, turn.id
                );
            }
            AgentEvent::ItemStarted { item } => {
                println!("item started: id={}, sequence={}", item.id, item.sequence);
            }
            AgentEvent::ItemUpdated { item } => {
                println!("item updated: id={}, sequence={}", item.id, item.sequence);
            }
            AgentEvent::ItemCompleted { item } => {
                println!("item completed: id={}, status={:?}", item.id, item.status);
            }
            AgentEvent::Message(message) => {
                println!("{}", serde_json::to_string_pretty(&message)?);
                println!("\n");
            }
            AgentEvent::McpNotification(_)
            | AgentEvent::ModelChange { .. }
            | AgentEvent::HistoryReplaced(_)
            | AgentEvent::ContextCompactionStarted { .. }
            | AgentEvent::ContextCompactionCompleted { .. }
            | AgentEvent::ContextCompactionWarning { .. }
            | AgentEvent::ContextTrace { .. } => {}
        }
    }

    Ok(())
}
