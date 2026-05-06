//! Workspace-local generated skill 的 runtime binding 只读投影。
//!
//! P3C 第一刀只计算 readiness / gate，不把 Skill 注入 Query Loop 或 SkillTool。

use crate::services::capability_draft_service::{
    list_workspace_registered_skills, CapabilityDraftRegistrationSummary,
    ListWorkspaceRegisteredSkillsRequest,
};
use lime_core::models::{SkillResourceSummary, SkillStandardCompliance};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeListWorkspaceSkillBindingsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(default)]
    pub caller: Option<String>,
    #[serde(default)]
    pub workbench: bool,
    #[serde(default, alias = "browser_assist")]
    pub browser_assist: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentRuntimeWorkspaceSkillBindingSurfaceSnapshot {
    pub workbench: bool,
    pub browser_assist: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentRuntimeWorkspaceSkillBindingRequestSnapshot {
    pub workspace_root: String,
    pub caller: String,
    pub surface: AgentRuntimeWorkspaceSkillBindingSurfaceSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeWorkspaceSkillBindingStatus {
    ReadyForManualEnable,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentRuntimeWorkspaceSkillBindingRecord {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub registered_skill_directory: String,
    pub registration: CapabilityDraftRegistrationSummary,
    pub permission_summary: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub allowed_tools: Vec<String>,
    pub resource_summary: SkillResourceSummary,
    pub standard_compliance: SkillStandardCompliance,
    pub runtime_binding_target: String,
    pub binding_status: AgentRuntimeWorkspaceSkillBindingStatus,
    pub binding_status_reason: String,
    pub next_gate: String,
    pub query_loop_visible: bool,
    pub tool_runtime_visible: bool,
    pub launch_enabled: bool,
    pub runtime_gate: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentRuntimeWorkspaceSkillBindingCounts {
    pub registered_total: usize,
    pub ready_for_manual_enable_total: usize,
    pub blocked_total: usize,
    pub query_loop_visible_total: usize,
    pub tool_runtime_visible_total: usize,
    pub launch_enabled_total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentRuntimeWorkspaceSkillBindings {
    pub request: AgentRuntimeWorkspaceSkillBindingRequestSnapshot,
    pub warnings: Vec<String>,
    pub counts: AgentRuntimeWorkspaceSkillBindingCounts,
    pub bindings: Vec<AgentRuntimeWorkspaceSkillBindingRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSkillRuntimeEnableBinding {
    pub directory: String,
    pub registered_skill_directory: String,
    pub skill_name: String,
    pub source_draft_id: String,
    pub source_verification_report_id: String,
    pub permission_summary: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSkillRuntimeEnableProjection {
    pub workspace_root: String,
    pub source: String,
    pub approval: String,
    pub allowed_skill_names: Vec<String>,
    pub bindings: Vec<WorkspaceSkillRuntimeEnableBinding>,
}

fn normalize_caller(caller: Option<&str>) -> String {
    lime_core::tool_calling::normalize_tool_caller(caller)
        .unwrap_or_else(|| "assistant".to_string())
}

fn resolve_binding_status(
    standard_compliance: &SkillStandardCompliance,
    registration: &CapabilityDraftRegistrationSummary,
) -> (
    AgentRuntimeWorkspaceSkillBindingStatus,
    String,
    String,
    String,
) {
    if !standard_compliance.validation_errors.is_empty() {
        return (
            AgentRuntimeWorkspaceSkillBindingStatus::Blocked,
            format!(
                "Agent Skills 标准检查仍有 {} 个问题，不能进入 runtime binding。",
                standard_compliance.validation_errors.len()
            ),
            "fix_agent_skill_standard".to_string(),
            "标准检查未通过；修复后才允许进入 Query Loop / tool_runtime 接入评估。".to_string(),
        );
    }

    if registration.source_verification_report_id.is_none() {
        return (
            AgentRuntimeWorkspaceSkillBindingStatus::Blocked,
            "缺少来源 verification report，不能证明该 Skill 通过了 P2 gate。".to_string(),
            "restore_verification_provenance".to_string(),
            "缺少 verification provenance；需要重新验证并注册。".to_string(),
        );
    }

    (
        AgentRuntimeWorkspaceSkillBindingStatus::ReadyForManualEnable,
        "已具备后续 workspace catalog binding 候选资格；当前仍未注入 Query Loop 或 tool_runtime。"
            .to_string(),
        "manual_runtime_enable".to_string(),
        "等待 P3C 后续把该 workspace skill 显式绑定到 Query Loop metadata 与 tool_runtime 授权裁剪。"
            .to_string(),
    )
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn extract_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(serde_json::Value::as_str)
        .and_then(|value| normalize_optional_text(Some(value)))
}

fn extract_harness_nested_object<'a>(
    request_metadata: Option<&'a serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    let root = request_metadata?.as_object()?;
    let harness = root.get("harness").and_then(serde_json::Value::as_object);
    keys.iter().find_map(|key| {
        root.get(*key)
            .and_then(serde_json::Value::as_object)
            .or_else(|| harness.and_then(|object| object.get(*key)?.as_object()))
    })
}

fn normalize_workspace_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(format!("workspaceRoot 必须是绝对路径: {}", path.display()));
    }
    Ok(path)
}

fn path_is_under(parent: &Path, child: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn collect_requested_enable_directories(
    enable_object: &serde_json::Map<String, serde_json::Value>,
) -> Vec<String> {
    enable_object
        .get("bindings")
        .or_else(|| enable_object.get("enabled_bindings"))
        .or_else(|| enable_object.get("enabledBindings"))
        .and_then(serde_json::Value::as_array)
        .map(|bindings| {
            bindings
                .iter()
                .filter_map(serde_json::Value::as_object)
                .filter_map(|binding| {
                    extract_object_string(
                        binding,
                        &["directory", "skill_directory", "skillDirectory"],
                    )
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn workspace_skill_runtime_enable_skill_names(directory: &str) -> Vec<String> {
    vec![
        format!("project:{}", directory.trim()),
        directory.trim().to_string(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect()
}

pub fn resolve_workspace_skill_runtime_enable(
    request_metadata: Option<&serde_json::Value>,
    workspace_root: &str,
) -> Result<Option<WorkspaceSkillRuntimeEnableProjection>, String> {
    let Some(enable_object) = extract_harness_nested_object(
        request_metadata,
        &[
            "workspace_skill_runtime_enable",
            "workspaceSkillRuntimeEnable",
        ],
    ) else {
        return Ok(None);
    };

    let workspace_root_path = normalize_workspace_path(workspace_root)?;
    if let Some(metadata_workspace_root) =
        extract_object_string(enable_object, &["workspace_root", "workspaceRoot"])
    {
        let metadata_workspace_root_path = normalize_workspace_path(&metadata_workspace_root)?;
        if metadata_workspace_root_path != workspace_root_path {
            return Err(format!(
                "workspace skill runtime enable 的 workspaceRoot 与当前会话不一致: metadata={}, current={}",
                metadata_workspace_root_path.display(),
                workspace_root_path.display()
            ));
        }
    }

    let requested_directories = collect_requested_enable_directories(enable_object);
    if requested_directories.is_empty() {
        return Err("workspace skill runtime enable 缺少 bindings[].directory".to_string());
    }

    let binding_snapshot =
        list_workspace_skill_bindings(AgentRuntimeListWorkspaceSkillBindingsRequest {
            workspace_root: workspace_root.to_string(),
            caller: Some("assistant".to_string()),
            workbench: true,
            browser_assist: false,
        })?;
    let binding_by_directory = binding_snapshot
        .bindings
        .into_iter()
        .map(|binding| (binding.directory.clone(), binding))
        .collect::<HashMap<_, _>>();

    let workspace_skills_root = workspace_root_path.join(".agents").join("skills");
    let canonical_workspace_skills_root =
        workspace_skills_root.canonicalize().map_err(|error| {
            format!(
                "无法解析 workspace skills root {}: {error}",
                workspace_skills_root.display()
            )
        })?;
    let mut seen = HashSet::new();
    let mut allowed_skill_names = Vec::new();
    let mut enabled_bindings = Vec::new();

    for directory in requested_directories {
        if !seen.insert(directory.clone()) {
            continue;
        }
        let binding = binding_by_directory
            .get(&directory)
            .ok_or_else(|| format!("workspace skill 未注册或不可发现: {directory}"))?;
        if binding.binding_status != AgentRuntimeWorkspaceSkillBindingStatus::ReadyForManualEnable {
            return Err(format!(
                "workspace skill '{}' 当前不可启用: {}",
                directory, binding.binding_status_reason
            ));
        }

        let registered_dir = PathBuf::from(&binding.registered_skill_directory);
        let canonical_registered_dir = registered_dir.canonicalize().map_err(|error| {
            format!(
                "无法解析 workspace skill '{}' 的注册目录 {}: {error}",
                directory,
                registered_dir.display()
            )
        })?;
        if !registered_dir.is_absolute()
            || !path_is_under(&canonical_workspace_skills_root, &canonical_registered_dir)
        {
            return Err(format!(
                "workspace skill '{}' 的注册目录不在当前 workspace .agents/skills 下",
                directory
            ));
        }

        let source_verification_report_id = binding
            .registration
            .source_verification_report_id
            .clone()
            .ok_or_else(|| {
                format!(
                    "workspace skill '{}' 缺少 verification provenance",
                    directory
                )
            })?;
        allowed_skill_names.extend(workspace_skill_runtime_enable_skill_names(&directory));
        enabled_bindings.push(WorkspaceSkillRuntimeEnableBinding {
            directory,
            registered_skill_directory: binding.registered_skill_directory.clone(),
            skill_name: format!("project:{}", binding.directory),
            source_draft_id: binding.registration.source_draft_id.clone(),
            source_verification_report_id,
            permission_summary: binding.permission_summary.clone(),
        });
    }

    Ok(Some(WorkspaceSkillRuntimeEnableProjection {
        workspace_root: workspace_root.to_string(),
        source: extract_object_string(enable_object, &["source"])
            .unwrap_or_else(|| "manual_session_enable".to_string()),
        approval: extract_object_string(enable_object, &["approval"])
            .unwrap_or_else(|| "manual".to_string()),
        allowed_skill_names,
        bindings: enabled_bindings,
    }))
}

pub fn list_workspace_skill_bindings(
    request: AgentRuntimeListWorkspaceSkillBindingsRequest,
) -> Result<AgentRuntimeWorkspaceSkillBindings, String> {
    let caller = normalize_caller(request.caller.as_deref());
    let registered_skills =
        list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: request.workspace_root.clone(),
        })?;

    let mut bindings = Vec::with_capacity(registered_skills.len());
    for skill in registered_skills {
        let (binding_status, binding_status_reason, next_gate, runtime_gate) =
            resolve_binding_status(&skill.standard_compliance, &skill.registration);

        bindings.push(AgentRuntimeWorkspaceSkillBindingRecord {
            key: format!("workspace_skill:{}", skill.directory),
            name: skill.name,
            description: skill.description,
            directory: skill.directory,
            registered_skill_directory: skill.registered_skill_directory,
            registration: skill.registration,
            permission_summary: skill.permission_summary,
            metadata: skill.metadata,
            allowed_tools: skill.allowed_tools,
            resource_summary: skill.resource_summary,
            standard_compliance: skill.standard_compliance,
            runtime_binding_target: "workspace_skill".to_string(),
            binding_status,
            binding_status_reason,
            next_gate,
            query_loop_visible: false,
            tool_runtime_visible: false,
            launch_enabled: false,
            runtime_gate,
        });
    }

    bindings.sort_by(|left, right| {
        right
            .registration
            .registered_at
            .cmp(&left.registration.registered_at)
            .then_with(|| left.directory.cmp(&right.directory))
    });

    let ready_for_manual_enable_total = bindings
        .iter()
        .filter(|binding| {
            binding.binding_status == AgentRuntimeWorkspaceSkillBindingStatus::ReadyForManualEnable
        })
        .count();
    let blocked_total = bindings
        .iter()
        .filter(|binding| {
            binding.binding_status == AgentRuntimeWorkspaceSkillBindingStatus::Blocked
        })
        .count();
    let query_loop_visible_total = bindings
        .iter()
        .filter(|binding| binding.query_loop_visible)
        .count();
    let tool_runtime_visible_total = bindings
        .iter()
        .filter(|binding| binding.tool_runtime_visible)
        .count();
    let launch_enabled_total = bindings
        .iter()
        .filter(|binding| binding.launch_enabled)
        .count();

    Ok(AgentRuntimeWorkspaceSkillBindings {
        request: AgentRuntimeWorkspaceSkillBindingRequestSnapshot {
            workspace_root: request.workspace_root,
            caller,
            surface: AgentRuntimeWorkspaceSkillBindingSurfaceSnapshot {
                workbench: request.workbench,
                browser_assist: request.browser_assist,
            },
        },
        warnings: vec![
            "P3C 当前只返回 runtime binding readiness；不会 reload Skill，也不会注入默认 tool surface。"
                .to_string(),
        ],
        counts: AgentRuntimeWorkspaceSkillBindingCounts {
            registered_total: bindings.len(),
            ready_for_manual_enable_total,
            blocked_total,
            query_loop_visible_total,
            tool_runtime_visible_total,
            launch_enabled_total,
        },
        bindings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::capability_draft_service::{
        create_capability_draft, register_capability_draft, verify_capability_draft,
        CapabilityDraftFileInput, CreateCapabilityDraftRequest, RegisterCapabilityDraftRequest,
        VerifyCapabilityDraftRequest,
    };
    use std::fs;
    use tempfile::TempDir;

    fn standard_verifiable_request(root: &std::path::Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "只读 CLI 报告草案".to_string(),
            description: "把只读 CLI 输出整理成 Markdown 报告。".to_string(),
            user_goal: "每天读取本地 CLI 输出并保存趋势摘要。".to_string(),
            source_kind: "cli".to_string(),
            source_refs: vec!["trendctl --help".to_string()],
            permission_summary: vec![
                "Level 0 只读发现".to_string(),
                "允许执行本地 CLI，但只读取输出，不做外部写操作".to_string(),
            ],
            generated_files: vec![
                CapabilityDraftFileInput {
                    relative_path: "SKILL.md".to_string(),
                    content: [
                        "---",
                        "name: 只读 CLI 报告",
                        "description: 把本地只读 CLI 输出整理成 Markdown 报告。",
                        "---",
                        "",
                        "# 只读 CLI 报告",
                        "",
                        "## 何时使用",
                        "当用户需要把本地只读 CLI 输出整理为 Markdown 报告时使用。",
                        "",
                        "## 输入",
                        "- topic: 报告主题",
                        "",
                        "## 执行步骤",
                        "1. 读取用户提供的只读 CLI 输出或 fixture。",
                        "2. 提炼趋势、异常和后续建议。",
                        "",
                        "## 输出",
                        "- markdown_report: 生成的 Markdown 摘要",
                    ]
                    .join("\n"),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/input.schema.json".to_string(),
                    content: r#"{"type":"object","required":["topic"],"properties":{"topic":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/output.schema.json".to_string(),
                    content: r#"{"type":"object","required":["markdown_report"],"properties":{"markdown_report":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "examples/input.sample.json".to_string(),
                    content: r#"{"topic":"AI Agent"}"#.to_string(),
                },
            ],
        }
    }

    fn request_for(root: &std::path::Path) -> AgentRuntimeListWorkspaceSkillBindingsRequest {
        AgentRuntimeListWorkspaceSkillBindingsRequest {
            workspace_root: root.to_string_lossy().to_string(),
            caller: None,
            workbench: true,
            browser_assist: false,
        }
    }

    #[test]
    fn list_workspace_skill_bindings_returns_empty_without_registered_skills() {
        let temp = TempDir::new().unwrap();

        let result = list_workspace_skill_bindings(request_for(temp.path())).unwrap();

        assert_eq!(result.counts.registered_total, 0);
        assert!(result.bindings.is_empty());
        assert_eq!(result.request.caller, "assistant");
        assert!(result.warnings[0].contains("只返回 runtime binding readiness"));
    }

    #[test]
    fn list_workspace_skill_bindings_rejects_relative_workspace_root() {
        let error = list_workspace_skill_bindings(AgentRuntimeListWorkspaceSkillBindingsRequest {
            workspace_root: "relative/workspace".to_string(),
            caller: None,
            workbench: false,
            browser_assist: false,
        })
        .unwrap_err();

        assert!(error.contains("workspaceRoot 必须是绝对路径"));
    }

    #[test]
    fn registered_skill_becomes_ready_for_manual_enable_binding_candidate() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let result = list_workspace_skill_bindings(request_for(temp.path())).unwrap();

        assert_eq!(result.counts.registered_total, 1);
        assert_eq!(result.counts.ready_for_manual_enable_total, 1);
        assert_eq!(result.counts.blocked_total, 0);
        assert_eq!(result.counts.query_loop_visible_total, 0);
        assert_eq!(result.counts.tool_runtime_visible_total, 0);
        let binding = &result.bindings[0];
        assert_eq!(
            binding.binding_status,
            AgentRuntimeWorkspaceSkillBindingStatus::ReadyForManualEnable
        );
        assert_eq!(binding.runtime_binding_target, "workspace_skill");
        assert_eq!(binding.next_gate, "manual_runtime_enable");
        assert!(!binding.query_loop_visible);
        assert!(!binding.tool_runtime_visible);
        assert!(!binding.launch_enabled);
        assert_eq!(
            binding.registration.source_draft_id,
            created.manifest.draft_id
        );
    }

    #[test]
    fn explicit_runtime_enable_projects_ready_binding_allowlist() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let metadata = serde_json::json!({
            "harness": {
                "workspace_skill_runtime_enable": {
                    "source": "manual_session_enable",
                    "approval": "manual",
                    "workspace_root": temp.path().to_string_lossy(),
                    "bindings": [{
                        "directory": registered.registration.skill_directory
                    }]
                }
            }
        });

        let projection =
            resolve_workspace_skill_runtime_enable(Some(&metadata), &temp.path().to_string_lossy())
                .unwrap()
                .expect("runtime enable projection");

        assert_eq!(projection.source, "manual_session_enable");
        assert_eq!(projection.approval, "manual");
        assert!(projection.allowed_skill_names.contains(&format!(
            "project:{}",
            registered.registration.skill_directory
        )));
        assert!(projection
            .allowed_skill_names
            .contains(&registered.registration.skill_directory));
        assert_eq!(projection.bindings.len(), 1);
        assert_eq!(
            projection.bindings[0].source_draft_id,
            created.manifest.draft_id
        );
    }

    #[test]
    fn explicit_runtime_enable_rejects_unregistered_binding() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join(".agents/skills")).unwrap();
        let metadata = serde_json::json!({
            "harness": {
                "workspace_skill_runtime_enable": {
                    "bindings": [{ "directory": "missing-skill" }]
                }
            }
        });

        let error =
            resolve_workspace_skill_runtime_enable(Some(&metadata), &temp.path().to_string_lossy())
                .unwrap_err();

        assert!(error.contains("未注册或不可发现"));
    }

    #[test]
    fn registered_skill_without_verification_provenance_is_blocked() {
        let temp = TempDir::new().unwrap();
        let skill_dir = temp.path().join(".agents/skills/capability-manual");
        fs::create_dir_all(skill_dir.join(".lime")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            [
                "---",
                "name: 手工能力",
                "description: 缺少 verification provenance 的手工注册能力。",
                "---",
                "",
                "# 手工能力",
                "",
                "## 何时使用",
                "当需要验证缺少来源报告的注册能力时使用。",
            ]
            .join("\n"),
        )
        .unwrap();
        let registration = CapabilityDraftRegistrationSummary {
            registration_id: "capreg-manual".to_string(),
            registered_at: "2026-05-06T00:00:00.000Z".to_string(),
            skill_directory: "capability-manual".to_string(),
            registered_skill_directory: skill_dir.to_string_lossy().to_string(),
            source_draft_id: "capdraft-manual".to_string(),
            source_verification_report_id: None,
            generated_file_count: 1,
            permission_summary: vec!["Level 0 只读发现".to_string()],
        };
        fs::write(
            skill_dir.join(".lime/registration.json"),
            serde_json::to_string_pretty(&registration).unwrap(),
        )
        .unwrap();

        let result = list_workspace_skill_bindings(request_for(temp.path())).unwrap();

        assert_eq!(result.counts.registered_total, 1);
        assert_eq!(result.counts.ready_for_manual_enable_total, 0);
        assert_eq!(result.counts.blocked_total, 1);
        assert_eq!(
            result.bindings[0].binding_status,
            AgentRuntimeWorkspaceSkillBindingStatus::Blocked
        );
        assert_eq!(
            result.bindings[0].next_gate,
            "restore_verification_provenance"
        );
    }

    #[test]
    fn registered_non_standard_skill_is_blocked() {
        let temp = TempDir::new().unwrap();
        let skill_dir = temp.path().join(".agents/skills/capability-broken");
        fs::create_dir_all(skill_dir.join(".lime")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "# 缺少标准 frontmatter\n\n这个文件故意不符合 Agent Skills 标准。",
        )
        .unwrap();
        let registration = CapabilityDraftRegistrationSummary {
            registration_id: "capreg-broken".to_string(),
            registered_at: "2026-05-06T00:10:00.000Z".to_string(),
            skill_directory: "capability-broken".to_string(),
            registered_skill_directory: skill_dir.to_string_lossy().to_string(),
            source_draft_id: "capdraft-broken".to_string(),
            source_verification_report_id: Some("capver-broken".to_string()),
            generated_file_count: 1,
            permission_summary: vec!["Level 0 只读发现".to_string()],
        };
        fs::write(
            skill_dir.join(".lime/registration.json"),
            serde_json::to_string_pretty(&registration).unwrap(),
        )
        .unwrap();

        let result = list_workspace_skill_bindings(request_for(temp.path())).unwrap();

        assert_eq!(result.counts.registered_total, 1);
        assert_eq!(result.counts.ready_for_manual_enable_total, 0);
        assert_eq!(result.counts.blocked_total, 1);
        assert_eq!(
            result.bindings[0].binding_status,
            AgentRuntimeWorkspaceSkillBindingStatus::Blocked
        );
        assert_eq!(result.bindings[0].next_gate, "fix_agent_skill_standard");
        assert!(!result.bindings[0]
            .standard_compliance
            .validation_errors
            .is_empty());
    }
}
