use super::*;
use crate::agent_tools::catalog::LIME_RUN_SERVICE_SKILL_TOOL_NAME;
use crate::commands::aster_agent_cmd::service_skill_launch::{
    extract_service_scene_launch_context, ServiceSceneLaunchContext,
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

        Ok(result)
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
}
