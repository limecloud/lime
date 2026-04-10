//! 配置管理命令
//!
//! 包含配置读取、保存、Provider 设置等命令。

use crate::app::types::{AppState, LogState};
use crate::app::utils::is_valid_bind_host;
use crate::config::{
    self,
    observer::{ConfigChangeEvent, RoutingChangeEvent},
    ConfigChangeSource, GlobalConfigManagerState,
};
use crate::services::environment_service::{
    apply_configured_environment, build_environment_preview,
};

/// 获取配置
#[tauri::command]
pub async fn get_config(state: tauri::State<'_, AppState>) -> Result<config::Config, String> {
    let s = state.read().await;
    Ok(s.config.clone())
}

/// 保存配置
#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, AppState>,
    config_manager: tauri::State<'_, GlobalConfigManagerState>,
    config: config::Config,
) -> Result<(), String> {
    let mut config = config;
    config.normalize_local_server_surface();
    config.normalize_workspace_preferences();
    let host = config.server.host.to_lowercase();

    tracing::info!(
        "[CONFIG] 保存配置请求: host={}, port={}",
        host,
        config.server.port
    );

    // 验证绑定地址
    if !is_valid_bind_host(&host) {
        tracing::warn!("[CONFIG] 无效的监听地址: {}", host);
        return Err(
            "无效的监听地址。允许的地址：127.0.0.1、localhost、::1、0.0.0.0、:: 或局域网 IP"
                .to_string(),
        );
    }

    {
        let mut s = state.write().await;
        s.config = config.clone();
    }

    let save_result = config_manager.0.save_config(&config).await;
    match save_result {
        Ok(()) => {
            apply_configured_environment(&config).await;
            tracing::info!("[CONFIG] 配置保存成功: host={}", config.server.host);
            Ok(())
        }
        Err(e) => {
            tracing::error!("[CONFIG] 配置保存失败: {}", e);
            Err(e)
        }
    }
}

/// 获取统一环境变量预览
#[tauri::command]
pub async fn get_environment_preview(
    state: tauri::State<'_, AppState>,
) -> Result<crate::services::environment_service::EnvironmentPreview, String> {
    let config = {
        let s = state.read().await;
        s.config.clone()
    };
    Ok(build_environment_preview(&config).await)
}

/// 获取默认 Provider
#[tauri::command]
pub async fn get_default_provider(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let s = state.read().await;
    Ok(s.config.default_provider.clone())
}

/// 设置默认 Provider
#[tauri::command]
pub async fn set_default_provider(
    state: tauri::State<'_, AppState>,
    logs: tauri::State<'_, LogState>,
    config_manager: tauri::State<'_, GlobalConfigManagerState>,
    provider: String,
) -> Result<String, String> {
    // 更新 AppState 中的配置
    let mut s = state.write().await;
    s.config.default_provider = provider.clone();
    s.config.routing.default_provider = provider.clone();

    // 同时更新运行中服务器的 default_provider_ref（向后兼容）
    {
        let mut dp = s.default_provider_ref.write().await;
        *dp = provider.clone();
    }

    // 同时更新运行中服务器的 router（如果服务器正在运行）
    if let Some(router_ref) = &s.router_ref {
        if let Ok(provider_type) = provider.parse::<crate::ProviderType>() {
            let mut router = router_ref.write().await;
            router.set_default_provider(provider_type);
        }
    }

    // 保存配置
    config::save_config(&s.config).map_err(|e| e.to_string())?;

    // 释放锁后通知观察者
    drop(s);

    // 通过 GlobalConfigManager 通知所有观察者
    let event = ConfigChangeEvent::RoutingChanged(RoutingChangeEvent {
        default_provider: Some(provider.clone()),
        model_aliases_changed: false,
        model_aliases: None,
        source: ConfigChangeSource::FrontendUI,
    });
    config_manager.0.subject().notify_event(event).await;

    logs.write()
        .await
        .add("info", &format!("默认 Provider 已切换为: {provider}"));

    tracing::info!("[CONFIG] 默认 Provider 已更新: {}", provider);
    Ok(provider)
}

/// 获取端点 Provider 配置
#[tauri::command]
pub async fn get_endpoint_providers(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let s = state.read().await;
    let ep = &s.config.endpoint_providers;
    Ok(serde_json::json!({
        "cursor": ep.cursor.clone(),
        "claude_code": ep.claude_code.clone(),
        "codex": ep.codex.clone(),
        "windsurf": ep.windsurf.clone(),
        "kiro": ep.kiro.clone(),
        "other": ep.other.clone()
    }))
}

/// 设置端点 Provider 配置
#[tauri::command]
pub async fn set_endpoint_provider(
    state: tauri::State<'_, AppState>,
    logs: tauri::State<'_, LogState>,
    config_manager: tauri::State<'_, GlobalConfigManagerState>,
    endpoint: String,
    provider: Option<String>,
) -> Result<String, String> {
    // 允许任意 Provider ID（包括自定义 Provider 的 UUID）
    // 不再强制验证为已知的 ProviderType

    let ep_config = {
        let mut s = state.write().await;

        // 使用 set_provider 方法设置对应的 provider
        if !s
            .config
            .endpoint_providers
            .set_provider(&endpoint, provider.clone())
        {
            return Err(format!("未知的客户端类型: {endpoint}"));
        }

        config::save_config(&s.config).map_err(|e| e.to_string())?;

        s.config.endpoint_providers.clone()
    };

    // 通过 GlobalConfigManager 通知所有观察者
    let event = ConfigChangeEvent::EndpointProvidersChanged(
        config::observer::EndpointProvidersChangeEvent {
            cursor: ep_config.cursor.clone(),
            claude_code: ep_config.claude_code.clone(),
            codex: ep_config.codex.clone(),
            windsurf: ep_config.windsurf.clone(),
            kiro: ep_config.kiro.clone(),
            other: ep_config.other.clone(),
            source: ConfigChangeSource::FrontendUI,
        },
    );
    config_manager.0.subject().notify_event(event).await;

    let provider_display = provider.as_deref().unwrap_or("默认");
    logs.write().await.add(
        "info",
        &format!("客户端 {endpoint} 的 Provider 已设置为: {provider_display}"),
    );

    tracing::info!(
        "[CONFIG] 端点 Provider 已更新: {} -> {}",
        endpoint,
        provider_display
    );
    Ok(provider_display.to_string())
}

/// 根据 API Key Provider 更新环境变量
///
/// 当用户切换本机默认 Provider 的凭证来源时调用
/// 会更新 ~/.claude/settings.json 和 shell 配置文件中的环境变量
#[tauri::command]
pub async fn update_provider_env_vars(
    state: tauri::State<'_, AppState>,
    config_manager: tauri::State<'_, GlobalConfigManagerState>,
    logs: tauri::State<'_, LogState>,
    provider_type: String,
    api_host: String,
    api_key: Option<String>,
) -> Result<(), String> {
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_services::live_sync::write_env_to_shell_config;
    use serde_json::{json, Value};
    use std::fs;

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;

    // 根据 provider_type 确定要更新的环境变量
    // 参考 Claude Code 文档：https://code.claude.com/docs/en/llm-gateway
    let parsed_api_provider_type = provider_type.parse::<ApiProviderType>().ok();
    let env_vars = build_provider_env_vars(&provider_type, &api_host, api_key.as_deref());

    if parsed_api_provider_type.is_none() {
        logs.write().await.add(
            "info",
            &format!("Provider 类型 '{provider_type}' 使用默认 OPENAI_BASE_URL"),
        );
    }

    // 1. 更新 ~/.claude/settings.json
    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // 确保目录存在
    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    }

    // 读取现有配置
    let mut settings: Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // 更新 env 字段
    let settings_obj = settings.as_object_mut().ok_or("Invalid settings format")?;
    if !settings_obj.contains_key("env") {
        settings_obj.insert("env".to_string(), json!({}));
    }

    if let Some(env_obj) = settings_obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        for (key, value) in &env_vars {
            env_obj.insert(key.clone(), json!(value));
        }
    }

    // 写入配置文件
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, content).map_err(|e| e.to_string())?;

    // 2. 更新 shell 配置文件
    if let Err(e) = write_env_to_shell_config(&env_vars) {
        logs.write()
            .await
            .add("warn", &format!("写入 shell 配置文件失败: {e}"));
        // 不中断流程
    }

    let next_config = {
        let mut s = state.write().await;
        upsert_environment_overrides(&mut s.config, &env_vars);
        s.config.clone()
    };
    config_manager.0.save_config(&next_config).await?;
    apply_configured_environment(&next_config).await;

    logs.write().await.add(
        "info",
        &format!(
            "已更新 {} 环境变量，并同步到统一环境配置: {}",
            provider_type,
            env_vars
                .iter()
                .map(|(k, _)| k.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    );

    tracing::info!(
        "[CONFIG] Provider 环境变量已更新: type={}, api_host={}",
        provider_type,
        api_host
    );

    Ok(())
}

fn upsert_environment_overrides(config: &mut config::Config, env_vars: &[(String, String)]) {
    for (key, value) in env_vars {
        let trimmed_key = key.trim();
        if trimmed_key.is_empty() {
            continue;
        }

        if let Some(existing) = config
            .environment
            .variables
            .iter_mut()
            .rev()
            .find(|entry| entry.key.trim().eq_ignore_ascii_case(trimmed_key))
        {
            existing.key = trimmed_key.to_string();
            existing.value = value.clone();
            existing.enabled = true;
            continue;
        }

        config
            .environment
            .variables
            .push(lime_core::config::EnvironmentVariableOverride {
                key: trimmed_key.to_string(),
                value: value.clone(),
                enabled: true,
            });
    }
}

fn build_provider_env_vars(
    provider_type: &str,
    api_host: &str,
    api_key: Option<&str>,
) -> Vec<(String, String)> {
    use lime_core::database::dao::api_key_provider::{ApiProviderType, ProviderProtocolFamily};

    let push_if_key = |vars: &mut Vec<(String, String)>, key_name: &str| {
        if let Some(value) = api_key {
            vars.push((key_name.to_string(), value.to_string()));
        }
    };

    match provider_type.to_lowercase().as_str() {
        // Anthropic 兼容类型 - 包括大多数第三方 Provider
        // 如 DeepSeek、智谱、MiniMax、OpenRouter、AiHubMix 等
        "anthropic" | "anthropic-compatible" => {
            let mut vars = vec![
                ("ANTHROPIC_HOST".to_string(), api_host.to_string()),
                ("ANTHROPIC_BASE_URL".to_string(), api_host.to_string()),
            ];
            push_if_key(&mut vars, "ANTHROPIC_AUTH_TOKEN");
            vars
        }
        // OpenAI 兼容类型 - 用于 Codex 等
        "openai" | "openai-response" => {
            let mut vars = vec![("OPENAI_BASE_URL".to_string(), api_host.to_string())];
            push_if_key(&mut vars, "OPENAI_API_KEY");
            vars
        }
        // Gemini 类型
        "gemini" => {
            let mut vars = vec![("GEMINI_API_BASE_URL".to_string(), api_host.to_string())];
            push_if_key(&mut vars, "GEMINI_API_KEY");
            vars
        }
        // Azure OpenAI 类型
        "azure-openai" => {
            let mut vars = vec![("AZURE_OPENAI_BASE_URL".to_string(), api_host.to_string())];
            push_if_key(&mut vars, "AZURE_OPENAI_API_KEY");
            vars
        }
        // Google Vertex AI 类型
        "vertexai" => {
            let mut vars = vec![(
                "ANTHROPIC_VERTEX_BASE_URL".to_string(),
                api_host.to_string(),
            )];
            push_if_key(&mut vars, "GOOGLE_APPLICATION_CREDENTIALS");
            vars
        }
        // AWS Bedrock 类型
        "aws-bedrock" => {
            // Bedrock 通常使用 AWS 凭证，不需要单独的 API Key
            vec![
                (
                    "ANTHROPIC_BEDROCK_BASE_URL".to_string(),
                    api_host.to_string(),
                ),
                ("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string()),
            ]
        }
        // Ollama 本地部署
        "ollama" => vec![
            ("OLLAMA_BASE_URL".to_string(), api_host.to_string()),
            ("OLLAMA_HOST".to_string(), api_host.to_string()),
        ],
        _ => {
            // 未知类型尽量按已注册 ApiProviderType 的协议族生成环境变量
            if let Ok(api_type) = provider_type.parse::<ApiProviderType>() {
                match api_type.runtime_spec().protocol_family {
                    ProviderProtocolFamily::Anthropic => {
                        let mut vars = vec![
                            ("ANTHROPIC_HOST".to_string(), api_host.to_string()),
                            ("ANTHROPIC_BASE_URL".to_string(), api_host.to_string()),
                        ];
                        push_if_key(&mut vars, "ANTHROPIC_AUTH_TOKEN");
                        vars
                    }
                    ProviderProtocolFamily::OpenAiCompatible
                    | ProviderProtocolFamily::Codex
                    | ProviderProtocolFamily::Gemini
                    | ProviderProtocolFamily::AzureOpenai
                    | ProviderProtocolFamily::Vertexai
                    | ProviderProtocolFamily::AwsBedrock
                    | ProviderProtocolFamily::Ollama => {
                        let mut vars = vec![("OPENAI_BASE_URL".to_string(), api_host.to_string())];
                        push_if_key(&mut vars, "OPENAI_API_KEY");
                        vars
                    }
                }
            } else {
                // 兜底：保守使用 OpenAI 兼容变量，避免误导为 Anthropic
                let mut vars = vec![("OPENAI_BASE_URL".to_string(), api_host.to_string())];
                push_if_key(&mut vars, "OPENAI_API_KEY");
                vars
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{build_provider_env_vars, upsert_environment_overrides};
    use lime_core::config::Config;

    #[test]
    fn test_build_provider_env_vars_explicit_anthropic_compatible() {
        let vars = build_provider_env_vars(
            "anthropic-compatible",
            "https://open.bigmodel.cn/api/anthropic",
            Some("k1"),
        );

        assert_eq!(
            vars,
            vec![
                (
                    "ANTHROPIC_HOST".to_string(),
                    "https://open.bigmodel.cn/api/anthropic".to_string()
                ),
                (
                    "ANTHROPIC_BASE_URL".to_string(),
                    "https://open.bigmodel.cn/api/anthropic".to_string()
                ),
                ("ANTHROPIC_AUTH_TOKEN".to_string(), "k1".to_string()),
            ]
        );
    }

    #[test]
    fn test_build_provider_env_vars_openai_family_defaults() {
        let vars = build_provider_env_vars("new-api", "https://relay.example.com", Some("k2"));
        assert_eq!(
            vars,
            vec![
                (
                    "OPENAI_BASE_URL".to_string(),
                    "https://relay.example.com".to_string()
                ),
                ("OPENAI_API_KEY".to_string(), "k2".to_string()),
            ]
        );
    }

    #[test]
    fn test_build_provider_env_vars_unknown_provider_fallback() {
        let vars = build_provider_env_vars("custom-unknown", "https://proxy.example.com", None);
        assert_eq!(
            vars,
            vec![(
                "OPENAI_BASE_URL".to_string(),
                "https://proxy.example.com".to_string()
            )]
        );
    }

    #[test]
    fn test_upsert_environment_overrides_updates_existing_key() {
        let mut config = Config::default();
        config
            .environment
            .variables
            .push(lime_core::config::EnvironmentVariableOverride {
                key: "OPENAI_BASE_URL".to_string(),
                value: "http://old".to_string(),
                enabled: false,
            });

        upsert_environment_overrides(
            &mut config,
            &[("OPENAI_BASE_URL".to_string(), "http://new".to_string())],
        );

        assert_eq!(config.environment.variables.len(), 1);
        assert_eq!(config.environment.variables[0].value, "http://new");
        assert!(config.environment.variables[0].enabled);
    }
}
