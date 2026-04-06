use super::*;
use crate::agent_tools::catalog::LIME_RUN_SERVICE_SKILL_TOOL_NAME;
use crate::commands::aster_agent_cmd::service_skill_launch::{
    extract_service_scene_launch_context, ServiceSceneLaunchContext,
};
use aster::session::{load_shared_session_runtime_snapshot, SessionRuntimeSnapshot};

const DEFAULT_SERVICE_SKILL_POLL_ATTEMPTS: u32 = 6;
const DEFAULT_SERVICE_SKILL_POLL_INTERVAL_MS: u64 = 1_500;
const MAX_SERVICE_SKILL_POLL_ATTEMPTS: u32 = 20;
const MAX_SERVICE_SKILL_POLL_INTERVAL_MS: u64 = 8_000;
const TERMINAL_SERVICE_SKILL_STATUSES: &[&str] = &["success", "failed", "canceled", "timeout"];
const SERVICE_SCENE_LAUNCH_CONTEXT_ENV_KEYS: &[&str] = &[
    "LIME_SERVICE_SCENE_LAUNCH_CONTEXT",
    "PROXYCAST_SERVICE_SCENE_LAUNCH_CONTEXT",
];

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ServiceSkillRunToolInput {
    #[serde(default)]
    input: Option<String>,
    #[serde(default)]
    wait_for_completion: Option<bool>,
    #[serde(default)]
    poll_attempts: Option<u32>,
    #[serde(default)]
    poll_interval_ms: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ServiceSkillRunRecord {
    id: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    run_type: Option<String>,
    #[serde(default)]
    scene_id: Option<String>,
    #[serde(default)]
    service_skill_id: Option<String>,
    #[serde(default)]
    service_skill_key: Option<String>,
    #[serde(default)]
    executor_kind: Option<String>,
    #[serde(default)]
    input_summary: Option<String>,
    #[serde(default)]
    output_summary: Option<String>,
    #[serde(default)]
    output_text: Option<String>,
    #[serde(default)]
    error_code: Option<String>,
    #[serde(default)]
    error_message: Option<String>,
    #[serde(default)]
    fallback_applied: Option<bool>,
    #[serde(default)]
    fallback_kind: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    finished_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServiceSkillRunEnvelope {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<ServiceSkillRunRecord>,
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

    fn normalize_status(status: &str) -> String {
        status.trim().to_ascii_lowercase()
    }

    fn is_terminal_status(status: &str) -> bool {
        let normalized = Self::normalize_status(status);
        TERMINAL_SERVICE_SKILL_STATUSES
            .iter()
            .any(|candidate| normalized == *candidate)
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

    fn resolve_scene_base_url(
        launch_context: &ServiceSceneLaunchContext,
    ) -> Result<String, ToolError> {
        Self::normalize_optional_text(launch_context.oem_runtime.scene_base_url.as_deref())
            .ok_or_else(|| {
                ToolError::execution_failed(
                    "缺少 OEM sceneBaseUrl，请先完成 OEM 云端接线".to_string(),
                )
            })
    }

    fn resolve_session_token(
        launch_context: &ServiceSceneLaunchContext,
    ) -> Result<String, ToolError> {
        Self::normalize_optional_text(launch_context.oem_runtime.session_token.as_deref())
            .ok_or_else(|| {
                ToolError::execution_failed(
                    "缺少 OEM Session Token，请先登录或注入 OEM 云端会话".to_string(),
                )
            })
    }

    async fn request_run(
        client: &reqwest::Client,
        scene_base_url: &str,
        session_token: &str,
        path: &str,
        method: reqwest::Method,
        body: Option<serde_json::Value>,
    ) -> Result<ServiceSkillRunRecord, ToolError> {
        let url = format!("{}{}", scene_base_url.trim_end_matches('/'), path);
        let mut request = client
            .request(method, &url)
            .header(reqwest::header::ACCEPT, "application/json")
            .bearer_auth(session_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json");

        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request.send().await.map_err(|error| {
            ToolError::execution_failed(format!("请求服务型技能运行时失败: {error}"))
        })?;
        let status = response.status();
        let payload = response
            .json::<ServiceSkillRunEnvelope>()
            .await
            .map_err(|error| {
                ToolError::execution_failed(format!("解析服务型技能运行结果失败: {error}"))
            })?;

        if !status.is_success() {
            let message = payload
                .message
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("服务端返回失败");
            return Err(ToolError::execution_failed(format!(
                "服务型技能运行请求失败 ({}): {}",
                status.as_u16(),
                message
            )));
        }

        if let Some(code) = payload.code {
            if code >= 400 {
                return Err(ToolError::execution_failed(
                    payload
                        .message
                        .unwrap_or_else(|| "服务端返回非法运行结果".to_string()),
                ));
            }
        }

        payload.data.ok_or_else(|| {
            ToolError::execution_failed("服务端返回的 service skill run 记录为空".to_string())
        })
    }

    fn build_success_payload(
        launch_context: &ServiceSceneLaunchContext,
        run: &ServiceSkillRunRecord,
        submitted_input: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "ok": run.status == "success",
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
            "run": run,
        })
    }

    fn build_result_summary(
        launch_context: &ServiceSceneLaunchContext,
        run: &ServiceSkillRunRecord,
    ) -> String {
        let title = launch_context
            .skill_title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("服务型技能");
        let status = run.status.trim();

        if status == "success" {
            if let Some(summary) = Self::normalize_optional_text(run.output_summary.as_deref()) {
                return format!("{title} 执行完成：{summary}");
            }
            return format!("{title} 执行完成");
        }

        if Self::is_terminal_status(status) {
            if let Some(message) = Self::normalize_optional_text(run.error_message.as_deref()) {
                return format!("{title} 执行失败：{message}");
            }
            return format!("{title} 已结束，状态为 {status}");
        }

        if let Some(summary) = Self::normalize_optional_text(run.output_summary.as_deref()) {
            return format!("{title} 当前状态 {status}：{summary}");
        }
        format!("{title} 已提交云端，当前状态 {status}")
    }
}

#[async_trait]
impl Tool for LimeRunServiceSkillTool {
    fn name(&self) -> &str {
        LIME_RUN_SERVICE_SKILL_TOOL_NAME
    }

    fn description(&self) -> &str {
        "运行当前回合绑定的服务型技能场景，提交到 OEM Scene Runtime 并返回最新运行状态。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "可选补充输入。默认取当前 scene launch 里的 user_input 或 raw_text。"
                },
                "waitForCompletion": {
                    "type": "boolean",
                    "description": "是否在当前工具调用内短轮询等待一轮结果，默认 true。"
                },
                "pollAttempts": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "短轮询次数，默认 6。"
                },
                "pollIntervalMs": {
                    "type": "integer",
                    "minimum": 200,
                    "maximum": 8000,
                    "description": "轮询间隔毫秒数，默认 1500。"
                }
            },
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["service-skill", "scene", "cloud-runtime"],
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
        let scene_base_url = Self::resolve_scene_base_url(&launch_context)?;
        let session_token = Self::resolve_session_token(&launch_context)?;
        let wait_for_completion = input.wait_for_completion.unwrap_or(true);
        let poll_attempts = input
            .poll_attempts
            .unwrap_or(DEFAULT_SERVICE_SKILL_POLL_ATTEMPTS)
            .clamp(1, MAX_SERVICE_SKILL_POLL_ATTEMPTS);
        let poll_interval_ms = input
            .poll_interval_ms
            .unwrap_or(DEFAULT_SERVICE_SKILL_POLL_INTERVAL_MS)
            .clamp(200, MAX_SERVICE_SKILL_POLL_INTERVAL_MS);
        let client = reqwest::Client::new();

        let create_path = format!(
            "/v1/service-skills/{}/runs",
            urlencoding::encode(&launch_context.service_skill_id)
        );
        let mut run = Self::request_run(
            &client,
            &scene_base_url,
            &session_token,
            &create_path,
            reqwest::Method::POST,
            Some(serde_json::json!({
                "input": effective_input,
            })),
        )
        .await?;

        if wait_for_completion && !Self::is_terminal_status(&run.status) {
            for _ in 0..poll_attempts {
                tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms)).await;
                let run_path = format!(
                    "/v1/service-skills/runs/{}",
                    urlencoding::encode(run.id.as_str())
                );
                run = Self::request_run(
                    &client,
                    &scene_base_url,
                    &session_token,
                    &run_path,
                    reqwest::Method::GET,
                    None,
                )
                .await?;
                if Self::is_terminal_status(&run.status) {
                    break;
                }
            }
        }

        let payload = Self::build_success_payload(&launch_context, &run, &effective_input);
        let summary = Self::build_result_summary(&launch_context, &run);
        let serialized =
            serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        let mut result = if Self::normalize_status(&run.status) == "failed"
            || Self::normalize_status(&run.status) == "canceled"
            || Self::normalize_status(&run.status) == "timeout"
        {
            ToolResult::error(summary)
        } else {
            ToolResult::success(serialized)
        };

        result = result
            .with_metadata("tool_family", serde_json::json!("service_skill"))
            .with_metadata("result", payload)
            .with_metadata("run_status", serde_json::json!(run.status))
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
                            "kind": "cloud_scene",
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
                            "kind": "cloud_scene",
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
}
