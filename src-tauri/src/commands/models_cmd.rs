//! 模型配置命令模块
//!
//! 提供动态模型配置的 Tauri 命令

use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::config::{save_config, ModelInfo, ModelsConfig, ProviderModelsConfig};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

/// 获取模型配置
#[tauri::command]
pub async fn get_models_config(app_state: State<'_, AppState>) -> Result<ModelsConfig, String> {
    let state = app_state.read().await;
    Ok(state.config.models.clone())
}

/// 保存模型配置
#[tauri::command]
pub async fn save_models_config(
    app_state: State<'_, AppState>,
    config: ModelsConfig,
) -> Result<(), String> {
    let mut state = app_state.write().await;
    state.config.models = config;
    // 保存配置到文件
    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取指定 Provider 的模型列表
#[tauri::command]
pub async fn get_provider_models(
    app_state: State<'_, AppState>,
    provider: String,
) -> Result<Vec<String>, String> {
    let state = app_state.read().await;
    let models = state
        .config
        .models
        .providers
        .get(&provider)
        .map(|p| {
            p.models
                .iter()
                .filter(|m| m.enabled)
                .map(|m| m.id.clone())
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

/// 简化的 Provider 配置（用于前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleProviderConfig {
    pub label: String,
    pub models: Vec<String>,
}

/// 凭证池 Provider 别名已退役；模型列表统一走模型注册表。
const ALIAS_PROVIDERS: &[&str] = &[];

/// 别名配置文件名映射（某些 Provider 共享同一个别名配置）
fn get_alias_config_key(provider: &str) -> &str {
    provider
}

/// 获取所有 Provider 的简化配置（用于前端下拉框）
/// 模型列表统一来自模型注册表。
#[tauri::command]
pub async fn get_all_provider_models(
    app_state: State<'_, AppState>,
    model_registry_state: State<'_, ModelRegistryState>,
) -> Result<HashMap<String, SimpleProviderConfig>, String> {
    let state = app_state.read().await;

    // 获取别名配置
    let alias_configs = {
        let guard = model_registry_state.read().await;
        if let Some(service) = guard.as_ref() {
            let configs = service.get_all_alias_configs().await;
            tracing::info!(
                "[get_all_provider_models] 加载了 {} 个别名配置: {:?}",
                configs.len(),
                configs.keys().collect::<Vec<_>>()
            );
            configs
        } else {
            tracing::warn!("[get_all_provider_models] ModelRegistryService 未初始化");
            HashMap::new()
        }
    };

    let result: HashMap<String, SimpleProviderConfig> = state
        .config
        .models
        .providers
        .iter()
        .map(|(key, value)| {
            // 对于别名 Provider，优先使用别名配置中的模型列表
            let models = if ALIAS_PROVIDERS.contains(&key.as_str()) {
                // 使用映射获取实际的别名配置文件名
                let alias_config_key = get_alias_config_key(key);
                if let Some(alias_config) = alias_configs.get(alias_config_key) {
                    tracing::info!(
                        "[get_all_provider_models] {} 使用别名配置 {}: {:?}",
                        key,
                        alias_config_key,
                        alias_config.models
                    );
                    alias_config.models.clone()
                } else {
                    tracing::warn!(
                        "[get_all_provider_models] {} 没有找到别名配置 {}，使用用户配置",
                        key,
                        alias_config_key
                    );
                    // 降级到用户配置
                    value
                        .models
                        .iter()
                        .filter(|m| m.enabled)
                        .map(|m| m.id.clone())
                        .collect()
                }
            } else {
                value
                    .models
                    .iter()
                    .filter(|m| m.enabled)
                    .map(|m| m.id.clone())
                    .collect()
            };

            (
                key.clone(),
                SimpleProviderConfig {
                    label: value.label.clone(),
                    models,
                },
            )
        })
        .collect();
    Ok(result)
}

/// 添加模型到指定 Provider
#[tauri::command]
pub async fn add_model_to_provider(
    app_state: State<'_, AppState>,
    provider: String,
    model_id: String,
    model_name: Option<String>,
) -> Result<(), String> {
    let mut state = app_state.write().await;

    if let Some(provider_config) = state.config.models.providers.get_mut(&provider) {
        // 检查是否已存在
        if provider_config.models.iter().any(|m| m.id == model_id) {
            return Err(format!("模型 {model_id} 已存在于 {provider} 中"));
        }
        provider_config.models.push(ModelInfo {
            id: model_id,
            name: model_name,
            enabled: true,
        });
    } else {
        return Err(format!("Provider {provider} 不存在"));
    }

    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 从指定 Provider 移除模型
#[tauri::command]
pub async fn remove_model_from_provider(
    app_state: State<'_, AppState>,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    let mut state = app_state.write().await;

    if let Some(provider_config) = state.config.models.providers.get_mut(&provider) {
        provider_config.models.retain(|m| m.id != model_id);
    } else {
        return Err(format!("Provider {provider} 不存在"));
    }

    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换模型启用状态
#[tauri::command]
pub async fn toggle_model_enabled(
    app_state: State<'_, AppState>,
    provider: String,
    model_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut state = app_state.write().await;

    if let Some(provider_config) = state.config.models.providers.get_mut(&provider) {
        if let Some(model) = provider_config.models.iter_mut().find(|m| m.id == model_id) {
            model.enabled = enabled;
        } else {
            return Err(format!("模型 {model_id} 不存在于 {provider} 中"));
        }
    } else {
        return Err(format!("Provider {provider} 不存在"));
    }

    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 添加新的 Provider
#[tauri::command]
pub async fn add_provider(
    app_state: State<'_, AppState>,
    provider_id: String,
    label: String,
) -> Result<(), String> {
    let mut state = app_state.write().await;

    if state.config.models.providers.contains_key(&provider_id) {
        return Err(format!("Provider {provider_id} 已存在"));
    }

    state.config.models.providers.insert(
        provider_id,
        ProviderModelsConfig {
            label,
            models: vec![],
        },
    );

    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 移除 Provider
#[tauri::command]
pub async fn remove_provider(
    app_state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), String> {
    let mut state = app_state.write().await;

    if state.config.models.providers.remove(&provider_id).is_none() {
        return Err(format!("Provider {provider_id} 不存在"));
    }

    save_config(&state.config).map_err(|e| e.to_string())?;
    Ok(())
}
