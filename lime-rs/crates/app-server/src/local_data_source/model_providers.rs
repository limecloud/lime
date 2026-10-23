use super::data_error;
use super::model_projection::model_info_from_value;
use super::model_projection::provider_info_from_value;
use super::model_projection::provider_key_info_from_value;
use super::values_from_serializable_vec;
use crate::runtime_backend::configured_provider_readiness;
use crate::RuntimeCoreError;
use app_server_protocol::ModelPreferencesListResponse;
use app_server_protocol::ModelProviderAliasListResponse;
use app_server_protocol::ModelProviderAliasReadParams;
use app_server_protocol::ModelProviderAliasReadResponse;
use app_server_protocol::ModelProviderCatalogListResponse;
use app_server_protocol::ModelProviderConfigExportParams;
use app_server_protocol::ModelProviderConfigExportResponse;
use app_server_protocol::ModelProviderConfigImportParams;
use app_server_protocol::ModelProviderConfigImportResponse;
use app_server_protocol::ModelProviderCreateParams;
use app_server_protocol::ModelProviderDeleteParams;
use app_server_protocol::ModelProviderDeleteResponse;
use app_server_protocol::ModelProviderFetchModelsParams;
use app_server_protocol::ModelProviderFetchModelsResponse;
use app_server_protocol::ModelProviderKeyCreateParams;
use app_server_protocol::ModelProviderKeyDeleteParams;
use app_server_protocol::ModelProviderKeyDeleteResponse;
use app_server_protocol::ModelProviderKeyUpdateParams;
use app_server_protocol::ModelProviderKeyWriteResponse;
use app_server_protocol::ModelProviderListResponse;
use app_server_protocol::ModelProviderMutationResponse;
use app_server_protocol::ModelProviderReadParams;
use app_server_protocol::ModelProviderReadResponse;
use app_server_protocol::ModelProviderSortOrdersUpdateParams;
use app_server_protocol::ModelProviderTestChatParams;
use app_server_protocol::ModelProviderTestChatResponse;
use app_server_protocol::ModelProviderTestConnectionParams;
use app_server_protocol::ModelProviderTestConnectionResponse;
use app_server_protocol::ModelProviderUiStateReadParams;
use app_server_protocol::ModelProviderUiStateReadResponse;
use app_server_protocol::ModelProviderUiStateWriteParams;
use app_server_protocol::ModelProviderUpdateParams;
use app_server_protocol::ModelProviderWriteResponse;
use app_server_protocol::ModelSyncStateReadResponse;
use app_server_protocol::ProviderModelConfig as ProtocolProviderModelConfig;
use lime_core::database::dao::api_key_provider::ApiKeyEntry;
use lime_core::database::dao::api_key_provider::ApiKeyProvider;
use lime_core::database::dao::api_key_provider::ApiProviderPromptCacheMode;
use lime_core::database::dao::api_key_provider::ApiProviderType;
use lime_core::database::dao::api_key_provider::ProviderWithKeys;
use lime_core::database::dao::route_state::RouteStateDao;
use lime_core::database::system_providers::get_system_providers;
use lime_core::database::system_providers::SystemProviderDef;
use lime_core::database::DbConnection;
use lime_core::models::model_registry::EnhancedModelMetadata;
use lime_core::models::model_registry::{
    ModelCapabilities as CoreModelCapabilities, ModelReasoningEffortOption,
    ModelReasoningEffortSupport, ProviderModelCapability as CoreProviderModelCapability,
    ProviderModelConfig as CoreProviderModelConfig,
};
use lime_core::models::runtime_api_key_credential_uuid;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use lime_services::model_registry_service::{
    FetchModelsResult, ModelRegistryService, ProviderModelCacheAccess,
};
use serde_json::json;
use serde_json::Map;
use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn read_model_route_generation(db: &DbConnection) -> Result<u64, RuntimeCoreError> {
    let conn = lime_core::database::lock_db(db).map_err(data_error)?;
    RouteStateDao::read_generation(&conn).map_err(data_error)
}

mod catalog;
pub(crate) use catalog::{has_model_provider_last_success, model_catalog};

pub(crate) async fn list_model_preferences(
    model_registry_service: &ModelRegistryService,
) -> Result<ModelPreferencesListResponse, RuntimeCoreError> {
    let preferences = model_registry_service
        .get_all_preferences()
        .await
        .map_err(data_error)?;
    Ok(ModelPreferencesListResponse {
        preferences: values_from_serializable_vec(preferences)?,
    })
}

pub(crate) async fn read_model_sync_state(
    model_registry_service: &ModelRegistryService,
) -> Result<ModelSyncStateReadResponse, RuntimeCoreError> {
    Ok(ModelSyncStateReadResponse {
        sync_state: serde_json::to_value(model_registry_service.get_sync_state().await)
            .map_err(data_error)?,
    })
}

pub(crate) fn list_model_providers(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
) -> Result<ModelProviderListResponse, RuntimeCoreError> {
    let providers = api_key_provider_service
        .get_all_providers(db)
        .map_err(data_error)?
        .iter()
        .map(|provider| provider_with_keys_to_value(provider, api_key_provider_service))
        .map(|provider| provider_info_from_value(&provider))
        .collect();
    Ok(ModelProviderListResponse { providers })
}

pub(crate) fn list_model_provider_catalog(
) -> Result<ModelProviderCatalogListResponse, RuntimeCoreError> {
    let providers: Vec<Value> = get_system_providers()
        .into_iter()
        .map(system_provider_to_value)
        .collect();
    Ok(ModelProviderCatalogListResponse {
        providers: providers.iter().map(provider_info_from_value).collect(),
    })
}

pub(crate) fn read_model_provider(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderReadParams,
) -> Result<ModelProviderReadResponse, RuntimeCoreError> {
    let provider = api_key_provider_service
        .get_provider(db, &params.provider_id)
        .map_err(data_error)?
        .map(|provider| provider_with_keys_to_value(&provider, api_key_provider_service))
        .map(|provider| provider_info_from_value(&provider));
    Ok(ModelProviderReadResponse { provider })
}

pub(crate) fn create_model_provider(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderCreateParams,
) -> Result<ModelProviderWriteResponse, RuntimeCoreError> {
    let provider_type = params
        .provider_type
        .parse::<ApiProviderType>()
        .map_err(data_error)?;
    let provider = api_key_provider_service
        .add_custom_provider(
            db,
            params.name,
            provider_type,
            params.api_host,
            params.api_version,
            params.project,
            params.location,
            params.region,
            parse_prompt_cache_mode(params.prompt_cache_mode)?,
        )
        .map_err(data_error)?;
    let provider = provider_to_value(&provider, 0);
    Ok(ModelProviderWriteResponse {
        provider: provider_info_from_value(&provider),
    })
}

pub(crate) fn update_model_provider(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderUpdateParams,
) -> Result<ModelProviderWriteResponse, RuntimeCoreError> {
    let provider_type = params
        .provider_type
        .map(|value| value.parse::<ApiProviderType>())
        .transpose()
        .map_err(data_error)?;
    let models = params
        .models
        .map(|models| {
            models
                .into_iter()
                .map(provider_model_config_to_core)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let provider = api_key_provider_service
        .update_provider(
            db,
            &params.provider_id,
            params.name,
            provider_type,
            params.api_host,
            params.enabled,
            params.sort_order,
            params.api_version,
            params.project,
            params.location,
            params.region,
            parse_prompt_cache_mode(params.prompt_cache_mode)?,
            models,
        )
        .map_err(data_error)?;
    let api_key_count = api_key_provider_service
        .get_provider(db, &params.provider_id)
        .map_err(data_error)?
        .map(|provider| provider.api_keys.len())
        .unwrap_or(0);
    let provider = provider_to_value(&provider, api_key_count);
    Ok(ModelProviderWriteResponse {
        provider: provider_info_from_value(&provider),
    })
}

fn provider_model_config_to_core(
    model: ProtocolProviderModelConfig,
) -> Result<CoreProviderModelConfig, RuntimeCoreError> {
    Ok(CoreProviderModelConfig {
        id: model.id,
        display_name: model.display_name,
        capability: model
            .capability
            .map(|capability| {
                Ok(CoreProviderModelCapability {
                    task_families: parse_provider_capability_values(
                        "taskFamilies",
                        capability.task_families,
                    )?,
                    input_modalities: parse_provider_capability_values(
                        "inputModalities",
                        capability.input_modalities,
                    )?,
                    output_modalities: parse_provider_capability_values(
                        "outputModalities",
                        capability.output_modalities,
                    )?,
                    runtime_features: parse_provider_capability_values(
                        "runtimeFeatures",
                        capability.runtime_features,
                    )?,
                    capabilities: CoreModelCapabilities {
                        vision: capability.capabilities.vision,
                        tools: capability.capabilities.tools,
                        streaming: capability.capabilities.streaming,
                        json_mode: capability.capabilities.json_mode,
                        function_calling: capability.capabilities.function_calling,
                        reasoning: capability.capabilities.reasoning,
                        supports_reasoning_summaries: capability
                            .capabilities
                            .supports_reasoning_summaries,
                        support_verbosity: capability.capabilities.support_verbosity,
                        reasoning_effort: capability
                            .capabilities
                            .reasoning_effort
                            .map(|support| {
                                Ok(ModelReasoningEffortSupport {
                                    supported: support.supported,
                                    levels: support.levels,
                                    options: support
                                        .options
                                        .into_iter()
                                        .map(|option| ModelReasoningEffortOption {
                                            id: option.id,
                                            value: option.value,
                                            label: option.label,
                                            description: option.description,
                                            default: option.default,
                                        })
                                        .collect(),
                                    default: support.default,
                                    source: support
                                        .source
                                        .map(|source| {
                                            parse_provider_capability_value(
                                                "reasoningEffort.source",
                                                source,
                                            )
                                        })
                                        .transpose()?,
                                })
                            })
                            .transpose()?,
                    },
                })
            })
            .transpose()?,
    })
}

fn parse_provider_capability_values<T>(
    field: &str,
    values: Vec<String>,
) -> Result<Vec<T>, RuntimeCoreError>
where
    T: serde::de::DeserializeOwned,
{
    values
        .into_iter()
        .map(|value| parse_provider_capability_value(field, value))
        .collect()
}

fn parse_provider_capability_value<T>(field: &str, value: String) -> Result<T, RuntimeCoreError>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(Value::String(value.clone())).map_err(|error| {
        data_error(format!(
            "Provider model capability {field} contains invalid value `{value}`: {error}"
        ))
    })
}

pub(crate) fn delete_model_provider(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderDeleteParams,
) -> Result<ModelProviderDeleteResponse, RuntimeCoreError> {
    let deleted = api_key_provider_service
        .delete_custom_provider(db, &params.provider_id)
        .map_err(data_error)?;
    Ok(ModelProviderDeleteResponse { deleted })
}

pub(crate) fn update_model_provider_sort_orders(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderSortOrdersUpdateParams,
) -> Result<ModelProviderMutationResponse, RuntimeCoreError> {
    let sort_orders = params
        .sort_orders
        .into_iter()
        .map(|item| (item.provider_id, item.sort_order))
        .collect();
    api_key_provider_service
        .update_provider_sort_orders(db, sort_orders)
        .map_err(data_error)?;
    Ok(ModelProviderMutationResponse::default())
}

pub(crate) fn export_model_provider_config(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderConfigExportParams,
) -> Result<ModelProviderConfigExportResponse, RuntimeCoreError> {
    let config = api_key_provider_service
        .export_config(db, params.include_keys.unwrap_or(false))
        .map_err(data_error)?;
    let config_json = serde_json::to_string_pretty(&config).map_err(data_error)?;
    Ok(ModelProviderConfigExportResponse { config_json })
}

pub(crate) fn import_model_provider_config(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderConfigImportParams,
) -> Result<ModelProviderConfigImportResponse, RuntimeCoreError> {
    let result = api_key_provider_service
        .import_config(db, &params.config_json)
        .map_err(data_error)?;
    Ok(ModelProviderConfigImportResponse {
        success: result.success,
        imported_providers: result.imported_providers,
        imported_api_keys: result.imported_api_keys,
        skipped_providers: result.skipped_providers,
        errors: result.errors,
    })
}

pub(crate) async fn test_model_provider_connection(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderTestConnectionParams,
) -> Result<ModelProviderTestConnectionResponse, RuntimeCoreError> {
    let result = api_key_provider_service
        .test_connection_with_fallback_models(
            db,
            &params.provider_id,
            params.model_name,
            Vec::new(),
        )
        .await
        .map_err(data_error)?;
    Ok(ModelProviderTestConnectionResponse {
        success: result.success,
        latency_ms: result.latency_ms,
        error: result.error,
        models: result.models,
    })
}

pub(crate) async fn test_model_provider_chat(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderTestChatParams,
) -> Result<ModelProviderTestChatResponse, RuntimeCoreError> {
    let result = api_key_provider_service
        .test_chat_with_fallback_models(
            db,
            &params.provider_id,
            params.model_name,
            params.prompt,
            Vec::new(),
        )
        .await
        .map_err(data_error)?;
    Ok(ModelProviderTestChatResponse {
        success: result.success,
        latency_ms: result.latency_ms,
        error: result.error,
        content: result.content,
        raw: result.raw,
    })
}

pub(crate) async fn fetch_model_provider_models(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    model_registry_service: &ModelRegistryService,
    params: ModelProviderFetchModelsParams,
) -> Result<ModelProviderFetchModelsResponse, RuntimeCoreError> {
    let provider = api_key_provider_service
        .get_provider(db, &params.provider_id)
        .map_err(data_error)?
        .ok_or_else(|| data_error(format!("Provider 不存在: {}", params.provider_id)))?;
    let api_host = provider.provider.api_host.clone();
    if api_host.trim().is_empty() {
        return Err(data_error("Provider 没有配置 API Host"));
    }
    let provider_type = provider.provider.effective_provider_type();
    let requires_api_key = ModelRegistryService::requires_api_key_for_model_fetch(
        &params.provider_id,
        &api_host,
        provider_type,
    );
    let api_key = if requires_api_key {
        api_key_provider_service
            .get_next_api_key(db, &params.provider_id)
            .map_err(data_error)?
            .ok_or_else(|| {
                data_error(format!(
                    "Provider {} 没有可用的 API Key",
                    params.provider_id
                ))
            })?
    } else {
        api_key_provider_service
            .get_next_api_key(db, &params.provider_id)
            .map_err(data_error)?
            .unwrap_or_default()
    };
    let result = model_registry_service
        .fetch_models_from_api_with_hints(
            &params.provider_id,
            &api_host,
            &api_key,
            Some(provider_type),
            &provider.provider.models,
        )
        .await
        .map_err(data_error)?;
    fetch_models_result_to_response(result)
}

pub(crate) fn create_model_provider_key(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderKeyCreateParams,
) -> Result<ModelProviderKeyWriteResponse, RuntimeCoreError> {
    let key = api_key_provider_service
        .add_api_key(
            db,
            &params.provider_id,
            &params.api_key,
            params.alias,
            params.replace_existing.unwrap_or(false),
        )
        .map_err(data_error)?;
    Ok(ModelProviderKeyWriteResponse {
        key: provider_key_info_from_value(&api_key_to_value(&key, api_key_provider_service)),
    })
}

pub(crate) fn update_model_provider_key(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderKeyUpdateParams,
) -> Result<ModelProviderKeyWriteResponse, RuntimeCoreError> {
    let key = if let Some(enabled) = params.enabled {
        api_key_provider_service
            .toggle_api_key(db, &params.key_id, enabled)
            .map_err(data_error)?
    } else {
        api_key_provider_service
            .update_api_key_alias(db, &params.key_id, params.alias.clone())
            .map_err(data_error)?
    };
    let key = if params.enabled.is_some() && params.alias.is_some() {
        api_key_provider_service
            .update_api_key_alias(db, &params.key_id, params.alias)
            .map_err(data_error)?
    } else {
        key
    };
    Ok(ModelProviderKeyWriteResponse {
        key: provider_key_info_from_value(&api_key_to_value(&key, api_key_provider_service)),
    })
}

pub(crate) fn delete_model_provider_key(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderKeyDeleteParams,
) -> Result<ModelProviderKeyDeleteResponse, RuntimeCoreError> {
    let deleted = api_key_provider_service
        .delete_api_key(db, &params.key_id)
        .map_err(data_error)?;
    Ok(ModelProviderKeyDeleteResponse { deleted })
}

pub(crate) fn read_model_provider_ui_state(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderUiStateReadParams,
) -> Result<ModelProviderUiStateReadResponse, RuntimeCoreError> {
    let value = api_key_provider_service
        .get_ui_state(db, &params.key)
        .map_err(data_error)?;
    Ok(ModelProviderUiStateReadResponse { value })
}

pub(crate) fn write_model_provider_ui_state(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderService,
    params: ModelProviderUiStateWriteParams,
) -> Result<ModelProviderMutationResponse, RuntimeCoreError> {
    api_key_provider_service
        .set_ui_state(db, &params.key, &params.value)
        .map_err(data_error)?;
    Ok(ModelProviderMutationResponse::default())
}

pub(crate) async fn read_model_provider_alias(
    model_registry_service: &ModelRegistryService,
    params: ModelProviderAliasReadParams,
) -> Result<ModelProviderAliasReadResponse, RuntimeCoreError> {
    Ok(ModelProviderAliasReadResponse {
        config: model_registry_service
            .get_provider_alias_config(&params.provider)
            .await
            .map(serde_json::to_value)
            .transpose()
            .map_err(data_error)?,
    })
}

pub(crate) async fn list_model_provider_aliases(
    model_registry_service: &ModelRegistryService,
) -> Result<ModelProviderAliasListResponse, RuntimeCoreError> {
    let mut configs = Map::new();
    for (provider, config) in model_registry_service.get_all_alias_configs().await {
        configs.insert(provider, serde_json::to_value(config).map_err(data_error)?);
    }
    Ok(ModelProviderAliasListResponse { configs })
}

fn provider_with_keys_to_value(
    provider_with_keys: &ProviderWithKeys,
    service: &ApiKeyProviderService,
) -> Value {
    let provider = &provider_with_keys.provider;
    let api_keys: Vec<Value> = provider_with_keys
        .api_keys
        .iter()
        .map(|api_key| api_key_to_value(api_key, service))
        .collect();
    json!({
        "id": provider.id,
        "name": provider.name,
        "type": provider.effective_provider_type().to_string(),
        "api_host": provider.api_host,
        "is_system": provider.is_system,
        "group": provider.group.to_string(),
        "enabled": provider.enabled,
        "sort_order": provider.sort_order,
        "api_version": provider.api_version,
        "project": provider.project,
        "location": provider.location,
        "region": provider.region,
        "models": provider.models,
        "prompt_cache_mode": provider.effective_prompt_cache_mode().map(|mode| mode.to_string()),
        "api_key_count": provider_with_keys.api_keys.len(),
        "created_at": provider.created_at.to_rfc3339(),
        "updated_at": provider.updated_at.to_rfc3339(),
        "api_keys": api_keys,
    })
}

fn provider_to_value(provider: &ApiKeyProvider, api_key_count: usize) -> Value {
    json!({
        "id": provider.id,
        "name": provider.name,
        "type": provider.effective_provider_type().to_string(),
        "api_host": provider.api_host,
        "is_system": provider.is_system,
        "group": provider.group.to_string(),
        "enabled": provider.enabled,
        "sort_order": provider.sort_order,
        "api_version": provider.api_version,
        "project": provider.project,
        "location": provider.location,
        "region": provider.region,
        "models": provider.models,
        "prompt_cache_mode": provider.effective_prompt_cache_mode().map(|mode| mode.to_string()),
        "api_key_count": api_key_count,
        "created_at": provider.created_at.to_rfc3339(),
        "updated_at": provider.updated_at.to_rfc3339(),
    })
}

fn api_key_to_value(api_key: &ApiKeyEntry, service: &ApiKeyProviderService) -> Value {
    let api_key_masked = service
        .decrypt_api_key(&api_key.api_key_encrypted)
        .map(|decrypted| mask_api_key(&decrypted))
        .unwrap_or_else(|_| "****".to_string());
    json!({
        "id": api_key.id,
        "provider_id": api_key.provider_id,
        "api_key_masked": api_key_masked,
        "alias": api_key.alias,
        "enabled": api_key.enabled,
        "usage_count": api_key.usage_count,
        "error_count": api_key.error_count,
        "last_used_at": api_key.last_used_at.map(|value| value.to_rfc3339()),
        "created_at": api_key.created_at.to_rfc3339(),
    })
}

fn fetch_models_result_to_response(
    result: FetchModelsResult,
) -> Result<ModelProviderFetchModelsResponse, RuntimeCoreError> {
    let models = values_from_serializable_vec(result.models)?;
    Ok(ModelProviderFetchModelsResponse {
        models: models.iter().map(model_info_from_value).collect(),
        source: serde_json::to_value(result.source)
            .map_err(data_error)?
            .as_str()
            .unwrap_or("Error")
            .to_string(),
        error: result.error,
        request_url: result.request_url,
        diagnostic_hint: result.diagnostic_hint,
        error_kind: result
            .error_kind
            .map(serde_json::to_value)
            .transpose()
            .map_err(data_error)?
            .and_then(|value| value.as_str().map(str::to_string)),
        should_prompt_error: result.should_prompt_error,
        from_cache: result.from_cache,
    })
}

fn parse_prompt_cache_mode(
    value: Option<String>,
) -> Result<Option<ApiProviderPromptCacheMode>, RuntimeCoreError> {
    value
        .map(|mode| {
            mode.parse::<ApiProviderPromptCacheMode>()
                .map_err(data_error)
        })
        .transpose()
}

fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        "****".to_string()
    } else {
        let prefix: String = chars[..6].iter().collect();
        let suffix: String = chars[chars.len() - 4..].iter().collect();
        format!("{prefix}****{suffix}")
    }
}

fn system_provider_to_value(provider: SystemProviderDef) -> Value {
    json!({
        "id": provider.id,
        "name": provider.name,
        "type": provider.provider_type.to_string(),
        "api_host": provider.api_host,
        "group": provider.group.to_string(),
        "sort_order": provider.sort_order,
        "api_version": provider.api_version,
        "legacy_ids": legacy_provider_ids(provider.id),
    })
}

fn legacy_provider_ids(provider_id: &str) -> Vec<String> {
    match provider_id {
        "lime-hub" => vec![format!("{}{}", "lobe", "hub")],
        "google" => vec!["gemini".to_string()],
        "zhipuai" => vec!["zhipu".to_string()],
        "alibaba" => vec!["dashscope".to_string(), "qwen".to_string()],
        "moonshotai" => vec!["moonshot".to_string()],
        "xai" => vec!["grok".to_string()],
        "github-models" => vec!["github".to_string()],
        "github-copilot" => vec!["copilot".to_string()],
        "google-vertex" => vec!["vertexai".to_string()],
        "azure-openai" => vec!["azure".to_string()],
        "amazon-bedrock" => vec!["aws-bedrock".to_string(), "bedrock".to_string()],
        "togetherai" => vec!["together".to_string()],
        "fireworks-ai" => vec!["fireworks".to_string(), "fireworksai".to_string()],
        "xiaomi" => vec!["mimo".to_string(), "xiaomimimo".to_string()],
        "siliconflow" => vec!["silicon".to_string(), "siliconcloud".to_string()],
        "302ai" => vec!["ai302".to_string()],
        "new-api" => vec!["newapi".to_string()],
        "vercel-gateway" => vec!["vercelaigateway".to_string()],
        "fal" => vec!["falai".to_string()],
        "yi" => vec!["zeroone".to_string()],
        "infini" => vec!["infiniai".to_string()],
        "doubao" => vec!["volcengine".to_string()],
        "airgate-openai-images" => vec!["airgate".to_string(), "k8ray".to_string()],
        "baidu-cloud" => vec!["wenxin".to_string()],
        "tencent-cloud-ti" => vec!["tencentcloud".to_string()],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests;
