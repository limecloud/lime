use super::*;
use crate::agent_tools::catalog::LIME_RUN_SERVICE_SKILL_TOOL_NAME;
use crate::commands::aster_agent_cmd::service_skill_launch::{
    extract_service_scene_launch_context, ServiceSceneLaunchContext,
};
use crate::commands::modality_runtime_contracts::{
    voice_generation_runtime_contract, VOICE_GENERATION_CONTRACT_KEY,
    VOICE_GENERATION_EXECUTION_PROFILE_KEY, VOICE_GENERATION_EXECUTOR_ADAPTER_KEY,
    VOICE_GENERATION_EXECUTOR_BINDING_KEY, VOICE_GENERATION_MODALITY,
    VOICE_GENERATION_REQUIRED_CAPABILITIES, VOICE_GENERATION_ROUTING_SLOT,
};
use aster::session::{load_shared_session_runtime_snapshot, SessionRuntimeSnapshot};

const SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS: &[&str] = &[
    "LIME_SERVICE_SCENE_LAUNCH_CONTEXT",
    "PROXYCAST_SERVICE_SCENE_LAUNCH_CONTEXT",
];

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ServiceSkillRunToolInput {
    #[serde(default)]
    input: Option<String>,
    #[serde(default, rename = "waitForCompletion")]
    _wait_for_completion: Option<bool>,
    #[serde(default, rename = "pollAttempts")]
    _poll_attempts: Option<u32>,
    #[serde(default, rename = "pollIntervalMs")]
    _poll_interval_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct ServiceSceneRuntimeContractMetadata {
    contract_key: String,
    modality: String,
    required_capabilities: Vec<String>,
    routing_slot: String,
    runtime_contract: serde_json::Value,
    entry_source: Option<String>,
}

impl ServiceSceneRuntimeContractMetadata {
    fn metadata_value(&self) -> serde_json::Value {
        serde_json::json!({
            "contractKey": self.contract_key,
            "modality": self.modality,
            "requiredCapabilities": self.required_capabilities,
            "routingSlot": self.routing_slot,
            "runtimeContract": self.runtime_contract,
            "entrySource": self.entry_source,
        })
    }
}

#[derive(Clone)]
pub(crate) struct LimeRunServiceSkillTool;

impl LimeRunServiceSkillTool {
    fn new() -> Self {
        Self
    }

    fn normalize_optional_text(value: Option<&str>) -> Option<String> {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }

    fn read_runtime_contract_string(
        runtime_contract: &serde_json::Value,
        snake_path: &[&str],
        camel_path: &[&str],
    ) -> Option<String> {
        runtime_contract
            .pointer(&format!("/{}", snake_path.join("/")))
            .or_else(|| runtime_contract.pointer(&format!("/{}", camel_path.join("/"))))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn read_string_array(value: Option<&serde_json::Value>) -> Vec<String> {
        value
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    fn is_voice_generation_launch_context(launch_context: &ServiceSceneLaunchContext) -> bool {
        launch_context.modality_contract_key.as_deref() == Some(VOICE_GENERATION_CONTRACT_KEY)
            || launch_context.scene_key.as_deref() == Some("voice_runtime")
            || launch_context.entry_source.as_deref() == Some("at_voice_command")
            || launch_context.routing_slot.as_deref() == Some(VOICE_GENERATION_ROUTING_SLOT)
    }

    fn build_voice_generation_contract_metadata(
        launch_context: &ServiceSceneLaunchContext,
    ) -> Option<ServiceSceneRuntimeContractMetadata> {
        if !Self::is_voice_generation_launch_context(launch_context) {
            return None;
        }

        let default_runtime_contract = voice_generation_runtime_contract();
        let runtime_contract = launch_context
            .runtime_contract
            .clone()
            .unwrap_or(default_runtime_contract);
        let modality = launch_context
            .modality
            .clone()
            .or_else(|| {
                Self::read_runtime_contract_string(&runtime_contract, &["modality"], &["modality"])
            })
            .unwrap_or_else(|| VOICE_GENERATION_MODALITY.to_string());
        let required_capabilities = if launch_context.required_capabilities.is_empty() {
            let from_contract = Self::read_string_array(
                runtime_contract
                    .get("required_capabilities")
                    .or_else(|| runtime_contract.get("requiredCapabilities")),
            );
            if from_contract.is_empty() {
                VOICE_GENERATION_REQUIRED_CAPABILITIES
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect()
            } else {
                from_contract
            }
        } else {
            launch_context.required_capabilities.clone()
        };
        let routing_slot = launch_context
            .routing_slot
            .clone()
            .or_else(|| {
                Self::read_runtime_contract_string(
                    &runtime_contract,
                    &["routing_slot"],
                    &["routingSlot"],
                )
            })
            .unwrap_or_else(|| VOICE_GENERATION_ROUTING_SLOT.to_string());

        Some(ServiceSceneRuntimeContractMetadata {
            contract_key: VOICE_GENERATION_CONTRACT_KEY.to_string(),
            modality,
            required_capabilities,
            routing_slot,
            runtime_contract,
            entry_source: launch_context.entry_source.clone(),
        })
    }

    fn attach_modality_runtime_contract_metadata(
        mut tool_result: ToolResult,
        metadata: Option<&ServiceSceneRuntimeContractMetadata>,
    ) -> ToolResult {
        let Some(metadata) = metadata else {
            return tool_result;
        };

        tool_result = tool_result
            .with_metadata(
                "modality_contract_key",
                serde_json::json!(metadata.contract_key),
            )
            .with_metadata("modality", serde_json::json!(metadata.modality))
            .with_metadata(
                "required_capabilities",
                serde_json::json!(metadata.required_capabilities),
            )
            .with_metadata("routing_slot", serde_json::json!(metadata.routing_slot))
            .with_metadata("runtime_contract", metadata.runtime_contract.clone())
            .with_metadata("modality_runtime_contract", metadata.metadata_value());
        if let Some(entry_source) = metadata.entry_source.as_ref() {
            tool_result =
                tool_result.with_metadata("entry_source", serde_json::json!(entry_source));
        }
        tool_result
    }

    fn build_runtime_preflight_error_result(
        launch_context: &ServiceSceneLaunchContext,
        metadata: &ServiceSceneRuntimeContractMetadata,
        suffix: &str,
        message: String,
    ) -> ToolResult {
        let result_payload = serde_json::json!({
            "success": false,
            "compatOnly": true,
            "serviceSkill": {
                "id": launch_context.service_skill_id,
                "key": launch_context.service_skill_key,
                "title": launch_context.skill_title,
                "summary": launch_context.skill_summary,
            },
            "scene": {
                "sceneKey": launch_context.scene_key,
                "commandPrefix": launch_context.command_prefix,
            },
            "error": {
                "code": format!("{}_{}", metadata.contract_key, suffix),
                "message": message,
                "stage": "runtime_preflight",
                "retryable": false,
            }
        });

        let mut tool_result = ToolResult::error(message)
            .with_metadata("tool_family", serde_json::json!("service_skill"))
            .with_metadata("compat_only", serde_json::json!(true))
            .with_metadata("runtime_preflight", serde_json::json!(true))
            .with_metadata(
                "preflight_check",
                serde_json::json!(format!("{}_{}", metadata.contract_key, suffix)),
            )
            .with_metadata(
                "last_error",
                serde_json::json!({
                    "code": format!("{}_{}", metadata.contract_key, suffix),
                    "message": result_payload
                        .pointer("/error/message")
                        .and_then(serde_json::Value::as_str),
                    "stage": "runtime_preflight",
                    "retryable": false,
                }),
            )
            .with_metadata("normalized_status", serde_json::json!("failed"))
            .with_metadata("result", result_payload)
            .with_metadata(
                "service_skill_id",
                serde_json::json!(launch_context.service_skill_id),
            );
        if let Some(scene_key) = launch_context.scene_key.as_ref() {
            tool_result = tool_result.with_metadata("scene_key", serde_json::json!(scene_key));
        }
        Self::attach_modality_runtime_contract_metadata(tool_result, Some(metadata))
    }

    fn validate_voice_generation_runtime_preflight(
        launch_context: &ServiceSceneLaunchContext,
        metadata: &ServiceSceneRuntimeContractMetadata,
    ) -> Result<(), ToolResult> {
        let contract_key = Self::read_runtime_contract_string(
            &metadata.runtime_contract,
            &["contract_key"],
            &["contractKey"],
        )
        .ok_or_else(|| {
            Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "contract_key_missing",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract 缺少 contract_key，已阻止进入服务型兼容执行器。"
                ),
            )
        })?;
        if contract_key != VOICE_GENERATION_CONTRACT_KEY {
            return Err(Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "contract_key_mismatch",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract contract_key 必须是 {VOICE_GENERATION_CONTRACT_KEY}，收到 {contract_key}。"
                ),
            ));
        }

        let execution_profile_key = Self::read_runtime_contract_string(
            &metadata.runtime_contract,
            &["execution_profile", "profile_key"],
            &["executionProfile", "profileKey"],
        )
        .ok_or_else(|| {
            Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "execution_profile_missing",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract 缺少 execution_profile.profile_key，已阻止进入服务型兼容执行器。"
                ),
            )
        })?;
        if execution_profile_key != VOICE_GENERATION_EXECUTION_PROFILE_KEY {
            return Err(Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "execution_profile_mismatch",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} execution_profile 必须是 {VOICE_GENERATION_EXECUTION_PROFILE_KEY}，收到 {execution_profile_key}。"
                ),
            ));
        }

        let executor_adapter_key = Self::read_runtime_contract_string(
            &metadata.runtime_contract,
            &["executor_adapter", "adapter_key"],
            &["executorAdapter", "adapterKey"],
        )
        .ok_or_else(|| {
            Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "executor_adapter_missing",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract 缺少 executor_adapter.adapter_key，已阻止进入服务型兼容执行器。"
                ),
            )
        })?;
        if executor_adapter_key != VOICE_GENERATION_EXECUTOR_ADAPTER_KEY {
            return Err(Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "executor_adapter_mismatch",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} executor_adapter 必须是 {VOICE_GENERATION_EXECUTOR_ADAPTER_KEY}，收到 {executor_adapter_key}。"
                ),
            ));
        }

        let executor_kind = Self::read_runtime_contract_string(
            &metadata.runtime_contract,
            &["executor_binding", "executor_kind"],
            &["executorBinding", "executorKind"],
        )
        .ok_or_else(|| {
            Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "executor_binding_missing",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract 缺少 executor_binding.executor_kind，已阻止进入服务型兼容执行器。"
                ),
            )
        })?;
        let executor_binding_key = Self::read_runtime_contract_string(
            &metadata.runtime_contract,
            &["executor_binding", "binding_key"],
            &["executorBinding", "bindingKey"],
        )
        .ok_or_else(|| {
            Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "executor_binding_missing",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} runtime_contract 缺少 executor_binding.binding_key，已阻止进入服务型兼容执行器。"
                ),
            )
        })?;
        if executor_kind != "service_skill"
            || executor_binding_key != VOICE_GENERATION_EXECUTOR_BINDING_KEY
        {
            return Err(Self::build_runtime_preflight_error_result(
                launch_context,
                metadata,
                "executor_binding_mismatch",
                format!(
                    "{VOICE_GENERATION_CONTRACT_KEY} executor_binding 必须是 service_skill:{VOICE_GENERATION_EXECUTOR_BINDING_KEY}，收到 {executor_kind}:{executor_binding_key}。"
                ),
            ));
        }

        Ok(())
    }

    fn build_request_metadata_value(
        metadata: &HashMap<String, serde_json::Value>,
    ) -> Option<serde_json::Value> {
        if metadata.is_empty() {
            return None;
        }

        let map = metadata
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<serde_json::Map<String, serde_json::Value>>();
        Some(serde_json::Value::Object(map))
    }

    fn extract_launch_context_from_runtime_snapshot(
        snapshot: &SessionRuntimeSnapshot,
    ) -> Option<ServiceSceneLaunchContext> {
        snapshot
            .threads
            .iter()
            .flat_map(|thread| thread.turns.iter())
            .filter_map(|turn| {
                let request_metadata = turn
                    .context_override
                    .as_ref()
                    .and_then(|context| Self::build_request_metadata_value(&context.metadata))?;
                let launch_context = extract_service_scene_launch_context(Some(&request_metadata))?;
                Some((turn.updated_at, launch_context))
            })
            .max_by_key(|(updated_at, _)| *updated_at)
            .map(|(_, launch_context)| launch_context)
            .or_else(|| {
                snapshot
                    .threads
                    .iter()
                    .filter_map(|thread| {
                        let request_metadata =
                            Self::build_request_metadata_value(&thread.thread.metadata)?;
                        let launch_context =
                            extract_service_scene_launch_context(Some(&request_metadata))?;
                        Some((thread.thread.updated_at, launch_context))
                    })
                    .max_by_key(|(updated_at, _)| *updated_at)
                    .map(|(_, launch_context)| launch_context)
            })
    }

    fn resolve_launch_context_from_environment(
        context: &ToolContext,
    ) -> Option<ServiceSceneLaunchContext> {
        SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS
            .iter()
            .find_map(|key| {
                let raw = context.environment.get(*key)?;
                let parsed = serde_json::from_str::<serde_json::Value>(raw).ok()?;
                extract_service_scene_launch_context(Some(&parsed)).or_else(|| {
                    let wrapped = serde_json::json!({
                        "harness": {
                            "service_scene_launch": parsed,
                        }
                    });
                    extract_service_scene_launch_context(Some(&wrapped))
                })
            })
    }

    async fn resolve_launch_context(
        context: &ToolContext,
    ) -> Result<ServiceSceneLaunchContext, ToolError> {
        let session_id = context.session_id.trim();
        if !session_id.is_empty() {
            match load_shared_session_runtime_snapshot(session_id).await {
                Ok(snapshot) => {
                    if let Some(launch_context) =
                        Self::extract_launch_context_from_runtime_snapshot(&snapshot)
                    {
                        return Ok(launch_context);
                    }
                }
                Err(error) => {
                    tracing::debug!(
                        "[AsterAgent][ServiceSkillTool] 读取 runtime snapshot 失败，跳过 session launch context 解析: session_id={}, error={}",
                        session_id,
                        error
                    );
                }
            }
        }

        Self::resolve_launch_context_from_environment(context).ok_or_else(|| {
            ToolError::execution_failed(
                "当前回合未绑定服务型场景启动上下文，无法执行 lime_run_service_skill".to_string(),
            )
        })
    }

    fn resolve_effective_input(
        launch_context: &ServiceSceneLaunchContext,
        input: &ServiceSkillRunToolInput,
    ) -> Result<String, ToolError> {
        let effective_input = Self::normalize_optional_text(input.input.as_deref())
            .or_else(|| Self::normalize_optional_text(launch_context.user_input.as_deref()))
            .or_else(|| Self::normalize_optional_text(launch_context.raw_text.as_deref()))
            .ok_or_else(|| {
                ToolError::invalid_params("缺少服务型技能运行输入，请补充 input".to_string())
            })?;

        Ok(effective_input)
    }

    fn build_compat_payload(
        launch_context: &ServiceSceneLaunchContext,
        submitted_input: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "ok": false,
            "compatOnly": true,
            "submittedInput": submitted_input,
            "serviceSkill": {
                "id": launch_context.service_skill_id,
                "key": launch_context.service_skill_key,
                "title": launch_context.skill_title,
                "summary": launch_context.skill_summary,
            },
            "scene": {
                "sceneKey": launch_context.scene_key,
                "commandPrefix": launch_context.command_prefix,
            },
            "execution": {
                "launchKind": launch_context.launch_kind,
                "runnerType": launch_context.runner_type,
                "executionKind": launch_context.execution_kind,
                "executionLocation": launch_context.execution_location,
            },
            "message": "lime_run_service_skill 仅为历史兼容保留；current 服务型做法应直接在当前本地回合执行。",
        })
    }

    fn build_compat_summary(launch_context: &ServiceSceneLaunchContext) -> String {
        let title = launch_context
            .skill_title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("服务型技能");
        if launch_context.execution_kind.as_deref() == Some("automation_job") {
            return format!(
                "{title} 已切到本地主链：请直接在当前回合产出首轮结果或调度建议，不要再调用 lime_run_service_skill。"
            );
        }

        format!("{title} 已切到本地主链：请直接在当前回合继续执行，不再提交 OEM 云端运行。")
    }
}

#[async_trait]
impl Tool for LimeRunServiceSkillTool {
    fn name(&self) -> &str {
        LIME_RUN_SERVICE_SKILL_TOOL_NAME
    }

    fn description(&self) -> &str {
        "兼容旧会话的服务型做法运行工具。current 主链已改为本地 Agent 直接执行，不再提交 OEM 云端运行。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "兼容参数：可选补充输入，默认取当前 scene launch 里的 user_input 或 raw_text。"
                },
                "waitForCompletion": {
                    "type": "boolean",
                    "description": "兼容参数：当前已忽略，不再触发云端轮询。"
                },
                "pollAttempts": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "兼容参数：当前已忽略。"
                },
                "pollIntervalMs": {
                    "type": "integer",
                    "minimum": 200,
                    "maximum": 8000,
                    "description": "兼容参数：当前已忽略。"
                }
            },
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["service-skill", "scene", "compat"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ServiceSkillRunToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let launch_context = Self::resolve_launch_context(context).await?;
        let runtime_contract_metadata =
            Self::build_voice_generation_contract_metadata(&launch_context);
        if let Some(metadata) = runtime_contract_metadata.as_ref() {
            if let Err(tool_result) =
                Self::validate_voice_generation_runtime_preflight(&launch_context, metadata)
            {
                return Ok(tool_result);
            }
        }
        let effective_input = Self::resolve_effective_input(&launch_context, &input)?;
        let payload = Self::build_compat_payload(&launch_context, &effective_input);
        let summary = Self::build_compat_summary(&launch_context);
        let mut result = ToolResult::error(summary.clone());

        result = result
            .with_metadata("tool_family", serde_json::json!("service_skill"))
            .with_metadata("compat_only", serde_json::json!(true))
            .with_metadata("result", payload)
            .with_metadata("compat_summary", serde_json::json!(summary))
            .with_metadata(
                "service_skill_id",
                serde_json::json!(launch_context.service_skill_id),
            );

        if let Some(scene_key) = launch_context.scene_key.as_ref() {
            result = result.with_metadata("scene_key", serde_json::json!(scene_key));
        }

        Ok(Self::attach_modality_runtime_contract_metadata(
            result,
            runtime_contract_metadata.as_ref(),
        ))
    }
}

pub(super) fn register_service_skill_tools_to_registry(registry: &mut aster::tools::ToolRegistry) {
    if !registry.contains(LIME_RUN_SERVICE_SKILL_TOOL_NAME) {
        registry.register(Box::new(LimeRunServiceSkillTool::new()));
    }
}

pub(super) fn unregister_service_skill_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
) {
    registry.unregister(LIME_RUN_SERVICE_SKILL_TOOL_NAME);
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::session::{ThreadRuntime, ThreadRuntimeSnapshot, TurnContextOverride, TurnRuntime};
    use chrono::{Duration as ChronoDuration, Utc};
    use std::path::PathBuf;

    fn metadata_map(value: serde_json::Value) -> HashMap<String, serde_json::Value> {
        value
            .as_object()
            .expect("metadata should be object")
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    }

    #[test]
    fn should_extract_latest_service_scene_launch_context_from_runtime_snapshot() {
        let now = Utc::now();
        let mut older_turn = TurnRuntime::new(
            "turn-older",
            "session-1",
            "thread-1",
            Some("旧 turn".to_string()),
            Some(TurnContextOverride {
                metadata: metadata_map(serde_json::json!({
                        "harness": {
                            "service_scene_launch": {
                            "kind": "local_service_skill",
                            "service_scene_run": {
                                "skill_id": "skill-older",
                                "scene_key": "scene-older",
                                "user_input": "旧输入",
                                "oem_runtime": {
                                    "scene_base_url": "https://example.com/scene-api",
                                    "session_token": "older-token"
                                }
                            }
                        }
                    }
                })),
                ..TurnContextOverride::default()
            }),
        );
        older_turn.updated_at = now;

        let mut latest_turn = TurnRuntime::new(
            "turn-latest",
            "session-1",
            "thread-1",
            Some("新 turn".to_string()),
            Some(TurnContextOverride {
                metadata: metadata_map(serde_json::json!({
                        "harness": {
                            "service_scene_launch": {
                            "kind": "local_service_skill",
                            "service_scene_run": {
                                "skill_id": "skill-latest",
                                "scene_key": "scene-latest",
                                "user_input": "最新输入",
                                "oem_runtime": {
                                    "scene_base_url": "https://example.com/scene-api",
                                    "session_token": "latest-token"
                                }
                            }
                        }
                    }
                })),
                ..TurnContextOverride::default()
            }),
        );
        latest_turn.updated_at = now + ChronoDuration::seconds(5);

        let mut thread =
            ThreadRuntime::new("thread-1", "session-1", PathBuf::from("/tmp/service-scene"));
        thread.updated_at = latest_turn.updated_at;

        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![older_turn, latest_turn],
                items: Vec::new(),
            }],
        };

        let launch_context =
            LimeRunServiceSkillTool::extract_launch_context_from_runtime_snapshot(&snapshot)
                .expect("should resolve launch context");

        assert_eq!(launch_context.service_skill_id, "skill-latest");
        assert_eq!(launch_context.scene_key.as_deref(), Some("scene-latest"));
        assert_eq!(launch_context.user_input.as_deref(), Some("最新输入"));
        assert_eq!(
            launch_context.oem_runtime.session_token.as_deref(),
            Some("latest-token")
        );
    }

    #[test]
    fn should_extract_launch_context_from_environment_payload() {
        let context = ToolContext::new(PathBuf::from("/tmp/service-scene")).with_environment(
            HashMap::from([(
                SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS[0].to_string(),
                serde_json::json!({
                    "kind": "cloud_scene",
                    "service_scene_run": {
                        "skill_id": "skill-env",
                        "scene_key": "scene-env",
                        "user_input": "环境输入",
                        "oem_runtime": {
                            "scene_base_url": "https://example.com/scene-api",
                            "session_token": "env-token"
                        }
                    }
                })
                .to_string(),
            )]),
        );

        let launch_context =
            LimeRunServiceSkillTool::resolve_launch_context_from_environment(&context)
                .expect("should resolve env launch context");

        assert_eq!(launch_context.service_skill_id, "skill-env");
        assert_eq!(launch_context.scene_key.as_deref(), Some("scene-env"));
        assert_eq!(
            launch_context.oem_runtime.scene_base_url.as_deref(),
            Some("https://example.com/scene-api")
        );
    }

    #[tokio::test]
    async fn should_return_compat_guard_result_when_tool_is_called() {
        let tool = LimeRunServiceSkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp/service-scene")).with_environment(
            HashMap::from([(
                SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS[0].to_string(),
                serde_json::json!({
                    "kind": "local_service_skill",
                    "service_scene_run": {
                        "skill_id": "skill-local",
                        "skill_title": "趋势日报",
                        "scene_key": "daily-trend-brief",
                        "execution_kind": "agent_turn",
                        "user_input": "帮我整理今天的 AI Agent 趋势"
                    }
                })
                .to_string(),
            )]),
        );

        let result = tool
            .execute(serde_json::json!({}), &context)
            .await
            .expect("tool should return compat guard result");

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .is_some_and(|value| value.contains("已切到本地主链")));
        assert_eq!(
            result.metadata.get("compat_only"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            result.metadata.get("service_skill_id"),
            Some(&serde_json::json!("skill-local"))
        );
    }

    #[tokio::test]
    async fn should_attach_voice_generation_contract_to_compat_guard_result() {
        let tool = LimeRunServiceSkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp/service-scene")).with_environment(
            HashMap::from([(
                SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS[0].to_string(),
                serde_json::json!({
                    "kind": "local_service_skill",
                    "service_scene_run": {
                        "skill_id": "voice-skill-1",
                        "skill_title": "视频配音",
                        "scene_key": "voice_runtime",
                        "entry_source": "at_voice_command",
                        "execution_kind": "agent_turn",
                        "user_input": "给这段新品文案做一版温暖配音",
                        "modality_contract_key": "voice_generation",
                        "modality": "audio",
                        "required_capabilities": ["text_generation", "voice_generation"],
                        "routing_slot": "voice_generation_model",
                        "runtime_contract": {
                            "contract_key": "voice_generation",
                            "modality": "audio",
                            "routing_slot": "voice_generation_model",
                            "executor_binding": {
                                "executor_kind": "service_skill",
                                "binding_key": "voice_runtime"
                            },
                            "execution_profile": {
                                "profile_key": "voice_generation_profile"
                            },
                            "executor_adapter": {
                                "adapter_key": "service_skill:voice_runtime"
                            }
                        }
                    }
                })
                .to_string(),
            )]),
        );

        let result = tool
            .execute(serde_json::json!({}), &context)
            .await
            .expect("tool should return compat guard result");

        assert!(!result.success);
        assert_eq!(
            result.metadata.get("compat_only"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(result.metadata.get("runtime_preflight"), None);
        assert_eq!(
            result.metadata.get("modality_contract_key"),
            Some(&serde_json::json!("voice_generation"))
        );
        assert_eq!(
            result
                .metadata
                .get("runtime_contract")
                .and_then(|value| value.pointer("/executor_adapter/adapter_key"))
                .and_then(serde_json::Value::as_str),
            Some("service_skill:voice_runtime")
        );
        assert_eq!(
            result
                .metadata
                .get("modality_runtime_contract")
                .and_then(|value| value.pointer("/runtimeContract/executor_binding/binding_key"))
                .and_then(serde_json::Value::as_str),
            Some("voice_runtime")
        );
    }

    #[tokio::test]
    async fn should_reject_voice_generation_wrong_executor_adapter() {
        let tool = LimeRunServiceSkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp/service-scene")).with_environment(
            HashMap::from([(
                SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS[0].to_string(),
                serde_json::json!({
                    "kind": "local_service_skill",
                    "service_scene_run": {
                        "skill_id": "voice-skill-1",
                        "skill_title": "视频配音",
                        "scene_key": "voice_runtime",
                        "entry_source": "at_voice_command",
                        "execution_kind": "agent_turn",
                        "user_input": "给这段新品文案做一版温暖配音",
                        "modality_contract_key": "voice_generation",
                        "routing_slot": "voice_generation_model",
                        "runtime_contract": {
                            "contract_key": "voice_generation",
                            "modality": "audio",
                            "routing_slot": "voice_generation_model",
                            "executor_binding": {
                                "executor_kind": "service_skill",
                                "binding_key": "voice_runtime"
                            },
                            "execution_profile": {
                                "profile_key": "voice_generation_profile"
                            },
                            "executor_adapter": {
                                "adapter_key": "scene_cloud:voice_runtime"
                            }
                        }
                    }
                })
                .to_string(),
            )]),
        );

        let result = tool
            .execute(serde_json::json!({}), &context)
            .await
            .expect("tool should return preflight guard result");

        assert!(!result.success);
        assert_eq!(
            result.metadata.get("runtime_preflight"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            result.metadata.get("preflight_check"),
            Some(&serde_json::json!(
                "voice_generation_executor_adapter_mismatch"
            ))
        );
        assert_eq!(
            result
                .metadata
                .get("last_error")
                .and_then(|value| value.get("stage"))
                .and_then(serde_json::Value::as_str),
            Some("runtime_preflight")
        );
        assert_eq!(
            result.metadata.get("normalized_status"),
            Some(&serde_json::json!("failed"))
        );
        assert_eq!(
            result.metadata.get("modality_contract_key"),
            Some(&serde_json::json!("voice_generation"))
        );
    }
}
