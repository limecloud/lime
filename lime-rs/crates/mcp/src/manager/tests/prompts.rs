use crate::manager::McpClientManager;
use crate::types::{McpContent, McpError};
use rmcp::{
    model::{
        GetPromptRequestParams, GetPromptResult, PromptMessage, PromptMessageRole,
        ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    RoleServer, ServerHandler, ServiceExt,
};

#[derive(Clone)]
struct ExactTargetPromptServer(&'static str);

impl ServerHandler for ExactTargetPromptServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_prompts().build())
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(
            PromptMessageRole::User,
            self.0,
        )])
        .with_description(format!("{}:{}", self.0, request.name)))
    }
}

async fn add_exact_target_prompt_server(
    manager: &McpClientManager,
    name: &'static str,
) -> tokio::task::JoinHandle<()> {
    let (server_transport, client_transport) = tokio::io::duplex(4096);
    let server_handle = tokio::spawn(async move {
        let service = ExactTargetPromptServer(name)
            .serve(server_transport)
            .await
            .expect("start exact target prompt server");
        service
            .waiting()
            .await
            .expect("wait for exact target prompt server");
    });
    let client = crate::client_service::LimeMcpClientService::new(name.to_string(), None)
        .serve(client_transport)
        .await
        .expect("start exact target prompt client");
    let mut wrapper = super::common::create_test_client(name);
    wrapper.set_running_service(client);
    manager
        .add_client(name.to_string(), wrapper)
        .await
        .expect("add exact target prompt client");
    server_handle
}

#[tokio::test]
async fn test_list_prompts_returns_empty_when_no_servers() {
    let manager = McpClientManager::new(None);

    // 没有运行的服务器时，应该返回空列表
    let result = manager.list_prompts().await.unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn test_get_prompt_not_found() {
    let manager = McpClientManager::new(None);

    // 获取不存在的提示词
    let result = manager
        .get_prompt(
            "missing-server",
            "nonexistent_prompt",
            serde_json::Map::new(),
        )
        .await;

    // 应该返回错误
    assert!(result.is_err());
    match result {
        Err(McpError::ServerNotRunning(name)) => {
            assert_eq!(name, "missing-server");
        }
        _ => panic!("Expected ServerNotRunning error"),
    }
}

#[tokio::test]
async fn get_prompt_rejects_empty_exact_target_before_dispatch() {
    let manager = McpClientManager::new(None);

    assert!(matches!(
        manager
            .get_prompt(" ", "summarize", serde_json::Map::new())
            .await,
        Err(McpError::ConfigError(_))
    ));
    assert!(matches!(
        manager
            .get_prompt("docs", " ", serde_json::Map::new())
            .await,
        Err(McpError::ConfigError(_))
    ));
}

#[tokio::test]
async fn get_prompt_routes_same_name_to_exact_server() {
    let manager = McpClientManager::new(None);
    let server_a = add_exact_target_prompt_server(&manager, "server-a").await;
    let server_b = add_exact_target_prompt_server(&manager, "server-b").await;

    let result = manager
        .get_prompt("server-b", "shared", serde_json::Map::new())
        .await
        .expect("get prompt from exact server");

    assert_eq!(result.description.as_deref(), Some("server-b:shared"));
    match &result.messages[0].content {
        McpContent::Text { text } => assert_eq!(text, "server-b"),
        other => panic!("expected text content, got {other:?}"),
    }

    manager
        .stop_server("server-a")
        .await
        .expect("stop server-a");
    manager
        .stop_server("server-b")
        .await
        .expect("stop server-b");
    server_a.await.expect("join server-a");
    server_b.await.expect("join server-b");
}

#[test]
fn test_convert_prompt_to_definition() {
    // 创建一个 rmcp Prompt
    let prompt = rmcp::model::Prompt::new(
        "test_prompt",
        Some("A test prompt description"),
        Some(vec![
            rmcp::model::PromptArgument::new("arg1")
                .with_description("First argument")
                .with_required(true),
            rmcp::model::PromptArgument::new("arg2")
                .with_description("Second argument")
                .with_required(false),
        ]),
    )
    .with_title("Test Prompt Title");

    // 转换为 McpPromptDefinition
    let definition =
        McpClientManager::convert_prompt_to_definition(prompt, "test_server".to_string());

    // 验证转换结果
    assert_eq!(definition.name, "test_prompt");
    assert_eq!(
        definition.description,
        Some("A test prompt description".to_string())
    );
    assert_eq!(definition.server_name, "test_server");
    assert_eq!(definition.arguments.len(), 2);

    // 验证第一个参数
    assert_eq!(definition.arguments[0].name, "arg1");
    assert_eq!(
        definition.arguments[0].description,
        Some("First argument".to_string())
    );
    assert!(definition.arguments[0].required);

    // 验证第二个参数
    assert_eq!(definition.arguments[1].name, "arg2");
    assert_eq!(
        definition.arguments[1].description,
        Some("Second argument".to_string())
    );
    assert!(!definition.arguments[1].required);
}

#[test]
fn test_convert_prompt_to_definition_no_arguments() {
    // 创建一个没有参数的 rmcp Prompt
    let prompt = rmcp::model::Prompt::new("simple_prompt", None::<String>, None);

    // 转换为 McpPromptDefinition
    let definition = McpClientManager::convert_prompt_to_definition(prompt, "server1".to_string());

    // 验证转换结果
    assert_eq!(definition.name, "simple_prompt");
    assert!(definition.description.is_none());
    assert_eq!(definition.server_name, "server1");
    assert!(definition.arguments.is_empty());
}

#[test]
fn test_convert_prompt_message_user() {
    // 创建一个用户消息
    let msg = rmcp::model::PromptMessage::new_text(
        rmcp::model::PromptMessageRole::User,
        "Hello, assistant!",
    );

    // 转换为 McpPromptMessage
    let mcp_msg = McpClientManager::convert_prompt_message(msg);

    // 验证转换结果
    assert_eq!(mcp_msg.role, "user");
    match mcp_msg.content {
        McpContent::Text { text } => {
            assert_eq!(text, "Hello, assistant!");
        }
        _ => panic!("Expected Text content"),
    }
}

#[test]
fn test_convert_prompt_message_assistant() {
    // 创建一个助手消息
    let msg = rmcp::model::PromptMessage::new_text(
        rmcp::model::PromptMessageRole::Assistant,
        "Hello, user!",
    );

    // 转换为 McpPromptMessage
    let mcp_msg = McpClientManager::convert_prompt_message(msg);

    // 验证转换结果
    assert_eq!(mcp_msg.role, "assistant");
    match mcp_msg.content {
        McpContent::Text { text } => {
            assert_eq!(text, "Hello, user!");
        }
        _ => panic!("Expected Text content"),
    }
}

#[test]
fn test_convert_prompt_message_content_text() {
    // 创建文本内容
    let content = rmcp::model::PromptMessageContent::Text {
        text: "Test text content".to_string(),
    };

    // 转换为 McpContent
    let mcp_content = McpClientManager::convert_prompt_message_content(content);

    // 验证转换结果
    match mcp_content {
        McpContent::Text { text } => {
            assert_eq!(text, "Test text content");
        }
        _ => panic!("Expected Text content"),
    }
}

#[test]
fn test_convert_get_prompt_result() {
    // 创建 GetPromptResult
    let result = rmcp::model::GetPromptResult::new(vec![
        rmcp::model::PromptMessage::new_text(rmcp::model::PromptMessageRole::User, "User message"),
        rmcp::model::PromptMessage::new_text(
            rmcp::model::PromptMessageRole::Assistant,
            "Assistant response",
        ),
    ])
    .with_description("Test prompt result");

    // 转换为 McpPromptResult
    let mcp_result = McpClientManager::convert_get_prompt_result(result);

    // 验证转换结果
    assert_eq!(
        mcp_result.description,
        Some("Test prompt result".to_string())
    );
    assert_eq!(mcp_result.messages.len(), 2);
    assert_eq!(mcp_result.messages[0].role, "user");
    assert_eq!(mcp_result.messages[1].role, "assistant");
}

// ========================================================================
// 资源管理测试（Task 4.5）
// ========================================================================
