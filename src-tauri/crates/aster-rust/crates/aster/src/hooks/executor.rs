//! Hook 执行器
//!
//! 执行各种类型的 hooks

use super::registry::global_registry;
use super::types::*;
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::warn;

/// 替换命令中的环境变量占位符
fn replace_command_variables(command: &str, input: &HookInput) -> String {
    command
        .replace("$TOOL_NAME", input.tool_name.as_deref().unwrap_or(""))
        .replace(
            "$EVENT",
            &input.event.map(|e| e.to_string()).unwrap_or_default(),
        )
        .replace("$SESSION_ID", input.session_id.as_deref().unwrap_or(""))
}

/// 执行 Command Hook
async fn execute_command_hook(hook: &CommandHookConfig, input: &HookInput) -> HookResult {
    let timeout_duration = Duration::from_millis(hook.timeout);
    let command = replace_command_variables(&hook.command, input);

    // 准备环境变量
    let mut env: HashMap<String, String> = std::env::vars().collect();
    env.extend(hook.env.clone());
    env.insert(
        "CLAUDE_HOOK_EVENT".to_string(),
        input.event.map(|e| e.to_string()).unwrap_or_default(),
    );
    env.insert(
        "CLAUDE_HOOK_TOOL_NAME".to_string(),
        input.tool_name.clone().unwrap_or_default(),
    );
    env.insert(
        "CLAUDE_HOOK_SESSION_ID".to_string(),
        input.session_id.clone().unwrap_or_default(),
    );

    // 准备输入 JSON
    let input_json = serde_json::to_string(input).unwrap_or_default();

    let mut cmd = Command::new("sh");
    cmd.arg("-c")
        .arg(&command)
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let result = timeout(timeout_duration, async {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return HookResult::failure(format!("Failed to spawn: {}", e));
            }
        };

        // 写入 stdin
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input_json.as_bytes()).await;
        }

        match child.wait_with_output().await {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                if !output.status.success() {
                    // 尝试解析 JSON 输出以获取阻塞消息
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                        if json.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                            let message = json
                                .get("message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Blocked by hook")
                                .to_string();
                            return HookResult::blocked(message);
                        }
                    }
                    return HookResult::failure(if stderr.is_empty() {
                        format!("Hook exited with code {:?}", output.status.code())
                    } else {
                        stderr
                    });
                }

                HookResult::success(Some(stdout))
            }
            Err(e) => HookResult::failure(format!("Failed to wait: {}", e)),
        }
    })
    .await;

    match result {
        Ok(r) => r,
        Err(_) => HookResult::failure("Hook execution timed out".to_string()),
    }
}

/// 执行 URL Hook
async fn execute_url_hook(hook: &UrlHookConfig, input: &HookInput) -> HookResult {
    let timeout_duration = Duration::from_millis(hook.timeout);

    let payload = serde_json::json!({
        "event": input.event,
        "toolName": input.tool_name,
        "toolInput": input.tool_input,
        "toolOutput": input.tool_output,
        "message": input.message,
        "sessionId": input.session_id,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "tool_use_id": input.tool_use_id,
        "error": input.error,
        "error_type": input.error_type,
        "is_interrupt": input.is_interrupt,
        "is_timeout": input.is_timeout,
        "agent_id": input.agent_id,
        "agent_type": input.agent_type,
        "result": input.result,
        "notification_type": input.notification_type,
        "source": input.source,
        "reason": input.reason,
        "trigger": input.trigger,
        "currentTokens": input.current_tokens,
    });

    let client = reqwest::Client::new();
    let mut request = match hook.method {
        HttpMethod::Get => client.get(&hook.url),
        HttpMethod::Post => client.post(&hook.url),
        HttpMethod::Put => client.put(&hook.url),
        HttpMethod::Patch => client.patch(&hook.url),
    };

    request = request
        .header("Content-Type", "application/json")
        .header("User-Agent", "Aster-Hooks/1.0");

    for (key, value) in &hook.headers {
        request = request.header(key, value);
    }

    if hook.method != HttpMethod::Get {
        request = request.json(&payload);
    }

    let result = timeout(timeout_duration, request.send()).await;

    match result {
        Ok(Ok(response)) => {
            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return HookResult::failure(format!("HTTP {}: {}", status, text));
            }

            let text = response.text().await.unwrap_or_default();

            // 尝试解析 JSON 响应
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if json.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                    let message = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Blocked by hook")
                        .to_string();
                    return HookResult::blocked(message);
                }
            }

            HookResult::success(Some(text))
        }
        Ok(Err(e)) => HookResult::failure(format!("Request failed: {}", e)),
        Err(_) => HookResult::failure("Hook request timed out".to_string()),
    }
}

/// 执行 MCP Hook（占位实现）
async fn execute_mcp_hook(hook: &McpHookConfig, _input: &HookInput) -> HookResult {
    // TODO: 实现 MCP 工具调用
    warn!(
        "MCP hook not fully implemented: server={}, tool={}",
        hook.server, hook.tool
    );
    HookResult::success(None)
}

/// 执行 Prompt Hook（占位实现）
async fn execute_prompt_hook(_hook: &PromptHookConfig, _input: &HookInput) -> HookResult {
    // TODO: 实现 LLM 提示评估
    warn!("Prompt hook not fully implemented");
    HookResult::success(None)
}

/// 执行 Agent Hook（占位实现）
async fn execute_agent_hook(hook: &AgentHookConfig, _input: &HookInput) -> HookResult {
    // TODO: 实现代理验证器
    warn!("Agent hook not fully implemented: type={}", hook.agent_type);
    HookResult::success(None)
}

/// 执行单个 hook
async fn execute_hook(hook: &HookConfig, input: &HookInput) -> HookResult {
    match hook {
        HookConfig::Command(c) => execute_command_hook(c, input).await,
        HookConfig::Url(c) => execute_url_hook(c, input).await,
        HookConfig::Mcp(c) => execute_mcp_hook(c, input).await,
        HookConfig::Prompt(c) => execute_prompt_hook(c, input).await,
        HookConfig::Agent(c) => execute_agent_hook(c, input).await,
    }
}

/// 运行所有匹配的 hooks
pub async fn run_hooks(input: HookInput) -> Vec<HookResult> {
    let event = match input.event {
        Some(e) => e,
        None => return vec![],
    };

    let registry = global_registry();
    let matching_hooks = registry.get_matching(event, input.tool_name.as_deref());
    let mut results = Vec::new();

    for hook in &matching_hooks {
        let result = execute_hook(hook, &input).await;
        let is_blocked = result.blocked;
        let is_blocking = hook.is_blocking();
        results.push(result);

        // 如果 hook 阻塞且是 blocking 类型，停止执行后续 hooks
        if is_blocked && is_blocking {
            break;
        }
    }

    results
}

/// 检查是否有任何 hook 阻塞操作
pub fn is_blocked(results: &[HookResult]) -> (bool, Option<String>) {
    for result in results {
        if result.blocked {
            return (true, result.block_message.clone());
        }
    }
    (false, None)
}

/// PreToolUse hook 辅助函数
pub async fn run_pre_tool_use_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    session_id: Option<String>,
) -> (bool, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::PreToolUse),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        session_id,
        ..Default::default()
    })
    .await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// PostToolUse hook 辅助函数
pub async fn run_post_tool_use_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_output: String,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::PostToolUse),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_output: Some(tool_output),
        session_id,
        ..Default::default()
    })
    .await;
}

/// UserPromptSubmit hook
pub async fn run_user_prompt_submit_hooks(
    prompt: &str,
    session_id: Option<String>,
) -> (bool, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::UserPromptSubmit),
        message: Some(prompt.to_string()),
        session_id,
        ..Default::default()
    })
    .await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// Stop hook
pub async fn run_stop_hooks(reason: Option<String>, session_id: Option<String>) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::Stop),
        message: reason,
        session_id,
        ..Default::default()
    })
    .await;
}

/// PreCompact hook
pub async fn run_pre_compact_hooks(
    session_id: Option<String>,
    current_tokens: Option<u64>,
    trigger: Option<CompactTrigger>,
) -> (bool, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::PreCompact),
        current_tokens,
        trigger,
        session_id,
        ..Default::default()
    })
    .await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// PostToolUseFailure hook
#[allow(clippy::too_many_arguments)]
pub async fn run_post_tool_use_failure_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: String,
    error: String,
    error_type: HookErrorType,
    is_interrupt: bool,
    is_timeout: bool,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::PostToolUseFailure),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_use_id: Some(tool_use_id),
        error: Some(error),
        error_type: Some(error_type),
        is_interrupt: Some(is_interrupt),
        is_timeout: Some(is_timeout),
        session_id,
        ..Default::default()
    })
    .await;
}

/// SessionStart hook
pub async fn run_session_start_hooks(session_id: String, source: Option<SessionSource>) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SessionStart),
        source,
        session_id: Some(session_id),
        ..Default::default()
    })
    .await;
}

/// SessionEnd hook
pub async fn run_session_end_hooks(session_id: String, reason: Option<SessionEndReason>) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SessionEnd),
        reason,
        session_id: Some(session_id),
        ..Default::default()
    })
    .await;
}

/// SubagentStart hook
pub async fn run_subagent_start_hooks(
    agent_id: String,
    agent_type: String,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SubagentStart),
        agent_id: Some(agent_id),
        agent_type: Some(agent_type),
        session_id,
        ..Default::default()
    })
    .await;
}

/// SubagentStop hook
pub async fn run_subagent_stop_hooks(
    agent_id: String,
    agent_type: String,
    result: Option<serde_json::Value>,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SubagentStop),
        agent_id: Some(agent_id),
        agent_type: Some(agent_type),
        result,
        session_id,
        ..Default::default()
    })
    .await;
}

/// PermissionRequest hook
pub async fn run_permission_request_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: Option<String>,
    session_id: Option<String>,
) -> (Option<HookDecision>, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::PermissionRequest),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_use_id,
        session_id,
        ..Default::default()
    })
    .await;

    for result in &results {
        if let Some(output) = &result.output {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
                if let Some(decision) = json.get("decision").and_then(|v| v.as_str()) {
                    let d = match decision {
                        "allow" => HookDecision::Allow,
                        "deny" => HookDecision::Deny,
                        _ => continue,
                    };
                    let message = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    return (Some(d), message);
                }
            }
        }
    }

    (None, None)
}

/// Notification hook
pub async fn run_notification_hooks(
    message: &str,
    notification_type: Option<NotificationType>,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::Notification),
        message: Some(message.to_string()),
        notification_type,
        session_id,
        ..Default::default()
    })
    .await;
}
