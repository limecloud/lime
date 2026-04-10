use super::*;
use crate::agent_tools::catalog::{
    LIME_SITE_INFO_TOOL_NAME, LIME_SITE_RUN_TOOL_NAME, LIME_SITE_SEARCH_TOOL_NAME,
};
use crate::services::site_capability_service::{
    get_site_adapter, run_site_adapter_with_optional_save, RunSiteAdapterRequest,
    SiteAdapterDefinition, SiteAdapterRunResult,
};
use lime_agent::AgentToolResult;
use std::collections::HashMap;

const SERVICE_SKILL_LAUNCH_BROWSER_DENY_PATTERNS: &[&str] = &[
    "mcp__lime-browser__*",
    "browser_*",
    "mcp__playwright__*",
    "playwright*",
];

const SERVICE_SKILL_LAUNCH_REPEAT_SITE_TOOL_DENY_PATTERNS: &[&str] = &[
    LIME_SITE_RUN_TOOL_NAME,
    LIME_SITE_SEARCH_TOOL_NAME,
    LIME_SITE_INFO_TOOL_NAME,
];

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ServiceSkillLaunchSiteAdapterContext {
    pub(crate) adapter_name: String,
    pub(crate) args: serde_json::Value,
    pub(crate) profile_key: Option<String>,
    pub(crate) target_id: Option<String>,
    pub(crate) content_id: Option<String>,
    pub(crate) project_id: Option<String>,
    pub(crate) save_title: Option<String>,
    pub(crate) skill_title: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ServiceSkillLaunchPreloadExecution {
    pub(crate) request: RunSiteAdapterRequest,
    pub(crate) adapter: Option<SiteAdapterDefinition>,
    pub(crate) result: SiteAdapterRunResult,
}

#[derive(Debug, Clone)]
pub(crate) struct ServiceSkillPreloadToolProjection {
    pub(crate) tool_name: String,
    pub(crate) tool_id: String,
    pub(crate) arguments: String,
    pub(crate) result: AgentToolResult,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ServiceSceneLaunchOemRuntimeContext {
    pub(crate) scene_base_url: Option<String>,
    pub(crate) tenant_id: Option<String>,
    pub(crate) session_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ServiceSceneLaunchContext {
    pub(crate) raw_text: Option<String>,
    pub(crate) user_input: Option<String>,
    pub(crate) scene_key: Option<String>,
    pub(crate) command_prefix: Option<String>,
    pub(crate) service_skill_id: String,
    pub(crate) service_skill_key: Option<String>,
    pub(crate) skill_title: Option<String>,
    pub(crate) skill_summary: Option<String>,
    pub(crate) project_id: Option<String>,
    pub(crate) content_id: Option<String>,
    pub(crate) entry_source: Option<String>,
    pub(crate) oem_runtime: ServiceSceneLaunchOemRuntimeContext,
}

fn extract_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalized_optional_object(
    value: Option<&serde_json::Value>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    value.and_then(serde_json::Value::as_object)
}

fn sanitize_service_skill_preload_id_segment(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    sanitized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn build_service_skill_preload_tool_id(execution: &ServiceSkillLaunchPreloadExecution) -> String {
    let adapter = sanitize_service_skill_preload_id_segment(&execution.request.adapter_name);
    let target = execution
        .result
        .target_id
        .as_deref()
        .map(sanitize_service_skill_preload_id_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".to_string());
    format!("service-skill-preload:{adapter}:{target}")
}

fn build_service_skill_preload_output(execution: &ServiceSkillLaunchPreloadExecution) -> String {
    let skill_title = execution
        .request
        .skill_title
        .as_deref()
        .unwrap_or(execution.request.adapter_name.as_str());
    let mut lines = Vec::new();

    if execution.result.ok {
        lines.push(format!("已完成站点技能预执行：{skill_title}。"));
    } else {
        lines.push(format!("站点技能预执行失败：{skill_title}。"));
    }

    lines.push(format!("- 适配器：{}", execution.request.adapter_name));
    lines.push(format!("- 入口页面：{}", execution.result.entry_url));

    if let Some(source_url) = execution.result.source_url.as_deref() {
        lines.push(format!("- 当前页面：{source_url}"));
    }

    if let Some(saved_content) = execution.result.saved_content.as_ref() {
        lines.push(format!("- 已保存内容：{}", saved_content.title));
        if let Some(path) = saved_content.markdown_relative_path.as_deref() {
            lines.push(format!("- Markdown 文件：{path}"));
        }
        if let Some(image_count) = saved_content.image_count {
            let image_dir = saved_content
                .images_relative_dir
                .as_deref()
                .map(|value| format!(" · {value}"))
                .unwrap_or_default();
            lines.push(format!("- 图片资源：{image_count} 张{image_dir}"));
        }
    }

    if let Some(project_id) = execution.result.saved_project_id.as_deref() {
        lines.push(format!("- 保存项目：{project_id}"));
    }

    if let Some(error_code) = execution.result.error_code.as_deref() {
        lines.push(format!("- 错误码：{error_code}"));
    }
    if let Some(error_message) = execution.result.error_message.as_deref() {
        lines.push(format!("- 错误说明：{error_message}"));
    }
    if let Some(report_hint) = execution.result.report_hint.as_deref() {
        lines.push(format!("- 处理建议：{report_hint}"));
    }
    if let Some(auth_hint) = execution.result.auth_hint.as_deref() {
        lines.push(format!("- 登录提示：{auth_hint}"));
    }

    lines.join("\n")
}

pub(crate) fn build_service_skill_preload_tool_projection(
    execution: &ServiceSkillLaunchPreloadExecution,
) -> Result<ServiceSkillPreloadToolProjection, String> {
    let arguments = serde_json::json!({
        "adapter_name": execution.request.adapter_name.clone(),
        "args": execution.request.args.clone(),
        "profile_key": execution.request.profile_key.clone(),
        "target_id": execution.request.target_id.clone(),
        "content_id": execution.request.content_id.clone(),
        "project_id": execution.request.project_id.clone(),
        "save_title": execution.request.save_title.clone(),
        "require_attached_session": execution.request.require_attached_session,
        "skill_title": execution.request.skill_title.clone(),
        "execution_origin": "preload",
    });
    let mut metadata = HashMap::from([
        ("tool_family".to_string(), serde_json::json!("site")),
        ("execution_origin".to_string(), serde_json::json!("preload")),
        ("preload".to_string(), serde_json::json!(true)),
        (
            "adapter_name".to_string(),
            serde_json::json!(execution.request.adapter_name.clone()),
        ),
        (
            "skill_title".to_string(),
            serde_json::json!(execution.request.skill_title.clone()),
        ),
        (
            "result".to_string(),
            serde_json::to_value(&execution.result).unwrap_or_default(),
        ),
    ]);
    if let Some(adapter) = execution.adapter.as_ref() {
        metadata.insert(
            "adapter_source_kind".to_string(),
            serde_json::json!(adapter.source_kind),
        );
        metadata.insert(
            "adapter_source_version".to_string(),
            serde_json::json!(adapter.source_version),
        );
    }

    Ok(ServiceSkillPreloadToolProjection {
        tool_name: "lime_site_run".to_string(),
        tool_id: build_service_skill_preload_tool_id(execution),
        arguments: serde_json::to_string(&arguments)
            .map_err(|error| format!("序列化站点技能预执行参数失败: {error}"))?,
        result: AgentToolResult {
            success: execution.result.ok,
            output: build_service_skill_preload_output(execution),
            error: execution.result.error_message.clone(),
            images: None,
            metadata: Some(metadata),
        },
    })
}

fn ensure_harness_workbench_chat_mode(value: &mut serde_json::Value, launch_keys: &[&str]) {
    let Some(root) = value.as_object_mut() else {
        return;
    };
    let harness = if root.contains_key("harness") {
        match root
            .get_mut("harness")
            .and_then(serde_json::Value::as_object_mut)
        {
            Some(harness) => harness,
            None => return,
        }
    } else {
        root
    };

    let has_launch = launch_keys.iter().any(|key| {
        harness
            .get(*key)
            .and_then(serde_json::Value::as_object)
            .is_some()
    });
    if !has_launch {
        return;
    }

    harness.insert(
        "chat_mode".to_string(),
        serde_json::Value::String("workbench".to_string()),
    );
}

pub(crate) fn extract_service_skill_launch_site_adapter_context(
    request_metadata: Option<&serde_json::Value>,
) -> Option<ServiceSkillLaunchSiteAdapterContext> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["service_skill_launch", "serviceSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "site_adapter".to_string());
    if kind != "site_adapter" {
        return None;
    }

    let adapter_name = extract_object_string(launch, &["adapter_name", "adapterName"])?;
    let launch_readiness = normalized_optional_object(launch.get("launch_readiness"));
    let browser_assist =
        extract_harness_nested_object(request_metadata, &["browser_assist", "browserAssist"]);
    let profile_key = launch_readiness
        .and_then(|value| extract_object_string(value, &["profile_key", "profileKey"]))
        .or_else(|| {
            browser_assist
                .and_then(|value| extract_object_string(value, &["profile_key", "profileKey"]))
        });
    let target_id =
        launch_readiness.and_then(|value| extract_object_string(value, &["target_id", "targetId"]));

    Some(ServiceSkillLaunchSiteAdapterContext {
        adapter_name,
        args: launch
            .get("args")
            .cloned()
            .filter(|value| value.is_object())
            .unwrap_or_else(|| serde_json::json!({})),
        profile_key,
        target_id,
        content_id: extract_object_string(launch, &["content_id", "contentId"]),
        project_id: extract_object_string(launch, &["project_id", "projectId"]),
        save_title: extract_object_string(launch, &["save_title", "saveTitle"]),
        skill_title: extract_object_string(launch, &["skill_title", "skillTitle"]),
    })
}

pub(crate) fn extract_service_scene_launch_context(
    request_metadata: Option<&serde_json::Value>,
) -> Option<ServiceSceneLaunchContext> {
    let launch = extract_harness_nested_object(
        request_metadata,
        &["service_scene_launch", "serviceSceneLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "cloud_scene".to_string());
    if kind != "cloud_scene" {
        return None;
    }

    let service_scene_run = launch
        .get("service_scene_run")
        .or_else(|| launch.get("serviceSceneRun"))
        .and_then(serde_json::Value::as_object)?;
    let service_skill_id = extract_object_string(
        service_scene_run,
        &["skill_id", "skillId", "linked_skill_id", "linkedSkillId"],
    )?;
    let oem_runtime = service_scene_run
        .get("oem_runtime")
        .or_else(|| service_scene_run.get("oemRuntime"))
        .and_then(serde_json::Value::as_object);

    Some(ServiceSceneLaunchContext {
        raw_text: extract_object_string(service_scene_run, &["raw_text", "rawText"]),
        user_input: extract_object_string(service_scene_run, &["user_input", "userInput"]),
        scene_key: extract_object_string(service_scene_run, &["scene_key", "sceneKey"]),
        command_prefix: extract_object_string(
            service_scene_run,
            &["command_prefix", "commandPrefix"],
        ),
        service_skill_id,
        service_skill_key: extract_object_string(service_scene_run, &["skill_key", "skillKey"]),
        skill_title: extract_object_string(service_scene_run, &["skill_title", "skillTitle"]),
        skill_summary: extract_object_string(service_scene_run, &["skill_summary", "skillSummary"]),
        project_id: extract_object_string(service_scene_run, &["project_id", "projectId"]),
        content_id: extract_object_string(service_scene_run, &["content_id", "contentId"]),
        entry_source: extract_object_string(service_scene_run, &["entry_source", "entrySource"]),
        oem_runtime: ServiceSceneLaunchOemRuntimeContext {
            scene_base_url: oem_runtime.and_then(|value| {
                extract_object_string(value, &["scene_base_url", "sceneBaseUrl"])
            }),
            tenant_id: oem_runtime
                .and_then(|value| extract_object_string(value, &["tenant_id", "tenantId"])),
            session_token: oem_runtime
                .and_then(|value| extract_object_string(value, &["session_token", "sessionToken"])),
        },
    })
}

pub(crate) fn prepare_service_scene_launch_request_metadata(
    request_metadata: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let mut metadata = request_metadata.cloned()?;
    ensure_harness_workbench_chat_mode(
        &mut metadata,
        &["service_scene_launch", "serviceSceneLaunch"],
    );

    Some(metadata)
}

pub(crate) fn should_lock_service_skill_launch_to_site_tools(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    extract_service_skill_launch_site_adapter_context(request_metadata).is_some()
}

pub(crate) fn service_skill_launch_browser_deny_patterns() -> &'static [&'static str] {
    SERVICE_SKILL_LAUNCH_BROWSER_DENY_PATTERNS
}

pub(crate) fn service_skill_launch_repeat_site_tool_deny_patterns() -> &'static [&'static str] {
    SERVICE_SKILL_LAUNCH_REPEAT_SITE_TOOL_DENY_PATTERNS
}

pub(crate) fn build_service_skill_launch_run_request(
    request_metadata: Option<&serde_json::Value>,
) -> Option<RunSiteAdapterRequest> {
    let context = extract_service_skill_launch_site_adapter_context(request_metadata)?;
    Some(RunSiteAdapterRequest {
        adapter_name: context.adapter_name,
        args: context.args,
        profile_key: context.profile_key,
        target_id: context.target_id,
        timeout_ms: None,
        content_id: context.content_id,
        project_id: context.project_id,
        save_title: context.save_title,
        require_attached_session: Some(true),
        skill_title: context.skill_title,
    })
}

pub(crate) async fn preload_service_skill_launch_execution(
    db: &DbConnection,
    request_metadata: Option<&serde_json::Value>,
) -> Result<Option<ServiceSkillLaunchPreloadExecution>, String> {
    let Some(request) = build_service_skill_launch_run_request(request_metadata) else {
        return Ok(None);
    };

    let adapter = get_site_adapter(&request.adapter_name);
    let result = run_site_adapter_with_optional_save(db, request.clone()).await;

    Ok(Some(ServiceSkillLaunchPreloadExecution {
        request,
        adapter,
        result,
    }))
}

pub(crate) fn append_service_skill_launch_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !should_lock_service_skill_launch_to_site_tools(request_metadata) {
        return;
    }

    let session_id = session_id.trim();
    let conditions = if session_id.is_empty() {
        Vec::new()
    } else {
        vec![PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::Equals,
            value: serde_json::json!(session_id),
            validator: None,
            description: Some("仅对当前站点技能启动回合生效".to_string()),
        }]
    };

    for pattern in service_skill_launch_browser_deny_patterns() {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1250,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "站点技能启动回合已锁定为 site adapter 执行，禁止直接回退到底层浏览器兼容工具"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for pattern in service_skill_launch_repeat_site_tool_deny_patterns() {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1250,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "站点技能启动回合已完成系统预执行，禁止在同回合重复调用站点执行工具".to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}
