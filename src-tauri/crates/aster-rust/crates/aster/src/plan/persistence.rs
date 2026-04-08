//! Plan 持久化管理器
//!
//! 负责保存、加载、管理计划

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::types::*;

/// 计划存储目录
fn get_plans_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("plans")
}

/// 模板存储目录
fn get_templates_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("plan-templates")
}

/// 版本存储目录
fn get_versions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("plan-versions")
}

/// 计划过期天数
const PLAN_EXPIRY_DAYS: u64 = 90;

/// Plan 持久化管理器
pub struct PlanPersistenceManager;

impl PlanPersistenceManager {
    /// 确保目录存在
    fn ensure_dirs() {
        for dir in [get_plans_dir(), get_templates_dir(), get_versions_dir()] {
            if !dir.exists() {
                let _ = fs::create_dir_all(&dir);
            }
        }
    }

    /// 生成计划 ID
    pub fn generate_plan_id() -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let uuid_str = Uuid::new_v4().to_string();
        let random = uuid_str.get(..8).unwrap_or(&uuid_str);
        format!("plan-{:x}-{}", timestamp, random)
    }

    /// 获取计划文件路径
    fn get_plan_file_path(id: &str) -> PathBuf {
        get_plans_dir().join(format!("{}.json", id))
    }

    /// 获取版本文件路径
    fn get_version_file_path(plan_id: &str, version: u32) -> PathBuf {
        get_versions_dir().join(format!("{}-v{}.json", plan_id, version))
    }

    /// 保存计划
    pub fn save_plan(plan: &mut SavedPlan, create_version: bool) -> Result<(), String> {
        Self::ensure_dirs();

        let now = current_timestamp();
        plan.metadata.updated_at = now;

        if plan.metadata.created_at == 0 {
            plan.metadata.created_at = now;
            plan.metadata.version = 1;
        }

        let file_path = Self::get_plan_file_path(&plan.metadata.id);

        // 如果需要创建版本，先保存旧版本
        if create_version && file_path.exists() {
            if let Ok(old_plan) = Self::load_plan(&plan.metadata.id) {
                let _ = Self::save_version(&old_plan);
                plan.metadata.version = old_plan.metadata.version + 1;
            }
        }

        let data = serde_json::to_string_pretty(plan)
            .map_err(|e| format!("Failed to serialize plan: {}", e))?;

        fs::write(&file_path, data).map_err(|e| format!("Failed to write plan file: {}", e))?;

        Ok(())
    }

    /// 加载计划
    pub fn load_plan(id: &str) -> Result<SavedPlan, String> {
        let file_path = Self::get_plan_file_path(id);

        if !file_path.exists() {
            return Err(format!("Plan not found: {}", id));
        }

        let data = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read plan file: {}", e))?;

        let plan: SavedPlan =
            serde_json::from_str(&data).map_err(|e| format!("Failed to parse plan: {}", e))?;

        if Self::is_expired(&plan) {
            return Err("Plan has expired".to_string());
        }

        Ok(plan)
    }

    /// 删除计划
    pub fn delete_plan(id: &str, delete_versions: bool) -> Result<(), String> {
        let file_path = Self::get_plan_file_path(id);

        if file_path.exists() {
            fs::remove_file(&file_path).map_err(|e| format!("Failed to delete plan: {}", e))?;
        }

        if delete_versions {
            if let Ok(versions) = Self::list_versions(id) {
                for version in versions {
                    let version_path = Self::get_version_file_path(id, version.version);
                    let _ = fs::remove_file(version_path);
                }
            }
        }

        Ok(())
    }

    /// 列出所有计划
    pub fn list_plans(options: &PlanListOptions) -> Vec<SavedPlan> {
        Self::ensure_dirs();

        let plans_dir = get_plans_dir();
        let mut plans = Vec::new();

        if let Ok(entries) = fs::read_dir(&plans_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                        if let Ok(plan) = Self::load_plan(id) {
                            plans.push(plan);
                        }
                    }
                }
            }
        }

        // 应用过滤和排序
        plans = Self::apply_filters(plans, options);
        plans = Self::apply_sorting(plans, options);

        // 应用分页
        let offset = options.offset.unwrap_or(0);
        let limit = options.limit.unwrap_or(plans.len());
        plans.into_iter().skip(offset).take(limit).collect()
    }

    /// 应用过滤器
    fn apply_filters(mut plans: Vec<SavedPlan>, options: &PlanListOptions) -> Vec<SavedPlan> {
        // 搜索过滤
        if let Some(ref search) = options.search {
            let search_lower = search.to_lowercase();
            plans.retain(|p| {
                p.metadata.title.to_lowercase().contains(&search_lower)
                    || p.metadata
                        .description
                        .to_lowercase()
                        .contains(&search_lower)
                    || p.summary.to_lowercase().contains(&search_lower)
            });
        }

        // 标签过滤
        if let Some(ref tags) = options.tags {
            plans.retain(|p| {
                p.metadata
                    .tags
                    .as_ref()
                    .is_some_and(|plan_tags| tags.iter().any(|t| plan_tags.contains(t)))
            });
        }

        // 状态过滤
        if let Some(ref statuses) = options.status {
            plans.retain(|p| statuses.contains(&p.metadata.status));
        }

        // 优先级过滤
        if let Some(ref priorities) = options.priority {
            plans.retain(|p| {
                p.metadata
                    .priority
                    .as_ref()
                    .is_some_and(|pr| priorities.contains(pr))
            });
        }

        // 工作目录过滤
        if let Some(ref wd) = options.working_directory {
            plans.retain(|p| p.metadata.working_directory.starts_with(wd));
        }

        plans
    }

    /// 应用排序
    fn apply_sorting(mut plans: Vec<SavedPlan>, options: &PlanListOptions) -> Vec<SavedPlan> {
        let sort_by = options.sort_by.unwrap_or(SortField::UpdatedAt);
        let sort_order = options.sort_order.unwrap_or(SortOrder::Desc);

        plans.sort_by(|a, b| {
            let cmp = match sort_by {
                SortField::CreatedAt => a.metadata.created_at.cmp(&b.metadata.created_at),
                SortField::UpdatedAt => a.metadata.updated_at.cmp(&b.metadata.updated_at),
                SortField::Title => a.metadata.title.cmp(&b.metadata.title),
                SortField::Priority => {
                    let pa = priority_to_num(a.metadata.priority.as_ref());
                    let pb = priority_to_num(b.metadata.priority.as_ref());
                    pa.cmp(&pb)
                }
                SortField::Status => {
                    format!("{:?}", a.metadata.status).cmp(&format!("{:?}", b.metadata.status))
                }
            };

            match sort_order {
                SortOrder::Asc => cmp,
                SortOrder::Desc => cmp.reverse(),
            }
        });

        plans
    }

    /// 检查计划是否过期
    fn is_expired(plan: &SavedPlan) -> bool {
        let now = current_timestamp();
        let age_ms = now.saturating_sub(plan.metadata.created_at);
        let expiry_ms = PLAN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        age_ms > expiry_ms
    }

    /// 保存版本
    pub fn save_version(plan: &SavedPlan) -> Result<(), String> {
        Self::ensure_dirs();

        let version = plan.metadata.version;
        let version_path = Self::get_version_file_path(&plan.metadata.id, version);

        let data = serde_json::to_string_pretty(plan)
            .map_err(|e| format!("Failed to serialize version: {}", e))?;

        fs::write(&version_path, data)
            .map_err(|e| format!("Failed to write version file: {}", e))?;

        Ok(())
    }

    /// 列出计划的所有版本
    pub fn list_versions(plan_id: &str) -> Result<Vec<PlanVersion>, String> {
        let versions_dir = get_versions_dir();
        let mut versions = Vec::new();

        let current_plan = Self::load_plan(plan_id).ok();
        let current_version = current_plan
            .as_ref()
            .map(|p| p.metadata.version)
            .unwrap_or(1);

        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if !filename.starts_with(plan_id) || !filename.ends_with(".json") {
                    continue;
                }

                if let Some(version) = extract_version_number(filename) {
                    let metadata = fs::metadata(&path).ok();
                    let created_at = metadata
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    versions.push(PlanVersion {
                        version,
                        plan_id: plan_id.to_string(),
                        created_at,
                        change_summary: format!("Version {}", version),
                        author: None,
                        is_current: version == current_version,
                    });
                }
            }
        }

        versions.sort_by(|a, b| b.version.cmp(&a.version));
        Ok(versions)
    }

    /// 恢复到指定版本
    pub fn restore_version(plan_id: &str, version: u32) -> Result<(), String> {
        let version_path = Self::get_version_file_path(plan_id, version);

        if !version_path.exists() {
            return Err(format!("Version {} not found", version));
        }

        let data = fs::read_to_string(&version_path)
            .map_err(|e| format!("Failed to read version: {}", e))?;

        let mut plan: SavedPlan =
            serde_json::from_str(&data).map_err(|e| format!("Failed to parse version: {}", e))?;

        // 保存当前版本
        if let Ok(current) = Self::load_plan(plan_id) {
            let _ = Self::save_version(&current);
        }

        plan.metadata.updated_at = current_timestamp();
        Self::save_plan(&mut plan, false)
    }

    /// 更新计划状态
    pub fn update_plan_status(
        id: &str,
        status: PlanStatus,
        approved_by: Option<&str>,
        rejection_reason: Option<&str>,
    ) -> Result<(), String> {
        let mut plan = Self::load_plan(id)?;

        plan.metadata.status = status;
        plan.metadata.updated_at = current_timestamp();

        if matches!(status, PlanStatus::Approved) {
            if let Some(by) = approved_by {
                plan.metadata.approved_by = Some(by.to_string());
                plan.metadata.approved_at = Some(current_timestamp());
            }
        }

        if matches!(status, PlanStatus::Rejected) {
            if let Some(reason) = rejection_reason {
                plan.metadata.rejection_reason = Some(reason.to_string());
            }
        }

        if matches!(status, PlanStatus::Completed) {
            plan.completed_at = Some(current_timestamp());
        }

        Self::save_plan(&mut plan, true)
    }

    /// 导出计划
    pub fn export_plan(plan_id: &str, options: &PlanExportOptions) -> Result<String, String> {
        let plan = Self::load_plan(plan_id)?;

        match options.format {
            ExportFormat::Json => Self::export_as_json(&plan, options),
            ExportFormat::Markdown => Ok(Self::export_as_markdown(&plan, options)),
            ExportFormat::Html => Ok(Self::export_as_html(&plan, options)),
        }
    }

    fn export_as_json(plan: &SavedPlan, _options: &PlanExportOptions) -> Result<String, String> {
        serde_json::to_string_pretty(plan).map_err(|e| format!("Failed to export as JSON: {}", e))
    }

    fn export_as_markdown(plan: &SavedPlan, options: &PlanExportOptions) -> String {
        let mut lines = Vec::new();

        lines.push(format!("# {}", plan.metadata.title));
        lines.push(String::new());

        if options.include_metadata {
            lines.push("## Metadata".to_string());
            lines.push(format!("- Status: {:?}", plan.metadata.status));
            lines.push(format!("- Priority: {:?}", plan.metadata.priority));
            lines.push(String::new());
        }

        lines.push("## Summary".to_string());
        lines.push(plan.summary.clone());
        lines.push(String::new());

        lines.push("## Implementation Steps".to_string());
        for step in &plan.steps {
            lines.push(format!("### Step {}: {}", step.step, step.description));
            lines.push(format!("- Complexity: {:?}", step.complexity));
            lines.push(format!("- Files: {}", step.files.join(", ")));
            lines.push(String::new());
        }

        if options.include_risks && !plan.risks.is_empty() {
            lines.push("## Risks".to_string());
            for risk in &plan.risks {
                lines.push(format!("- **[{:?}]** {}", risk.level, risk.description));
            }
            lines.push(String::new());
        }

        lines.join("\n")
    }

    fn export_as_html(plan: &SavedPlan, options: &PlanExportOptions) -> String {
        let markdown = Self::export_as_markdown(plan, options);
        format!(
            r#"<!DOCTYPE html>
<html><head><title>{}</title></head>
<body><pre>{}</pre></body></html>"#,
            plan.metadata.title, markdown
        )
    }
}

// 辅助函数

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn priority_to_num(priority: Option<&Priority>) -> u8 {
    match priority {
        Some(Priority::Low) => 1,
        Some(Priority::Medium) => 2,
        Some(Priority::High) => 3,
        Some(Priority::Critical) => 4,
        None => 0,
    }
}

fn extract_version_number(filename: &str) -> Option<u32> {
    let re = regex::Regex::new(r"-v(\d+)\.json$").ok()?;
    let caps = re.captures(filename)?;
    caps.get(1)?.as_str().parse().ok()
}
