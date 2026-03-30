use super::*;
use crate::services::site_capability_service::{
    get_site_adapter, run_site_adapter_with_optional_save, RunSiteAdapterRequest,
    SiteAdapterDefinition, SiteAdapterRunResult,
};

const SERVICE_SKILL_LAUNCH_BROWSER_DENY_PATTERNS: &[&str] = &[
    "mcp__lime-browser__*",
    "browser_*",
    "mcp__playwright__*",
    "playwright*",
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

pub(crate) fn should_lock_service_skill_launch_to_site_tools(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    extract_service_skill_launch_site_adapter_context(request_metadata).is_some()
}

pub(crate) fn service_skill_launch_browser_deny_patterns() -> &'static [&'static str] {
    SERVICE_SKILL_LAUNCH_BROWSER_DENY_PATTERNS
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
}
