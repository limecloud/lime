//! 蓝图管理器
//!
//!
//! 负责：
//! 1. 通过对话生成蓝图
//! 2. 蓝图的 CRUD 操作
//! 3. 蓝图签字确认流程
//! 4. 蓝图变更管理

use anyhow::{anyhow, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::types::*;

// ============================================================================
// 蓝图管理器
// ============================================================================

/// 蓝图管理器
#[allow(dead_code)]
pub struct BlueprintManager {
    /// 蓝图存储
    blueprints: Arc<RwLock<HashMap<String, Blueprint>>>,
    /// 当前蓝图 ID
    current_blueprint_id: Arc<RwLock<Option<String>>>,
    /// 存储目录
    storage_dir: PathBuf,
}

impl BlueprintManager {
    /// 创建新的蓝图管理器
    pub fn new(storage_dir: PathBuf) -> Self {
        Self {
            blueprints: Arc::new(RwLock::new(HashMap::new())),
            current_blueprint_id: Arc::new(RwLock::new(None)),
            storage_dir,
        }
    }

    /// 从默认目录创建
    pub fn with_default_dir() -> Self {
        let storage_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".aster")
            .join("blueprints");
        Self::new(storage_dir)
    }

    // ------------------------------------------------------------------------
    // 创建蓝图
    // ------------------------------------------------------------------------

    /// 创建新蓝图（草稿状态）
    ///
    /// 单蓝图约束：一个项目只有一个蓝图
    /// - 如果已有蓝图且处于 draft 状态，返回现有蓝图
    /// - 如果已有蓝图且处于其他状态，返回错误
    /// - 如果没有蓝图，创建新的
    pub async fn create_blueprint(&self, name: String, description: String) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;

        // 单蓝图约束：检查是否已有蓝图
        let existing: Vec<_> = blueprints.values().collect();

        if !existing.is_empty() {
            let existing_bp = existing[0];

            match existing_bp.status {
                BlueprintStatus::Draft => {
                    // 清空并重新生成
                    let mut bp = existing_bp.clone();
                    bp.name = name.clone();
                    bp.description = description;
                    bp.updated_at = Utc::now();
                    bp.modules.clear();
                    bp.business_processes.clear();
                    bp.nfrs.clear();
                    bp.change_history.push(BlueprintChange {
                        id: Uuid::new_v4().to_string(),
                        timestamp: Utc::now(),
                        change_type: ChangeType::Update,
                        description: format!("蓝图重新生成：{}", name),
                        previous_version: None,
                        changes: None,
                        author: ChangeAuthor::Agent,
                    });

                    blueprints.insert(bp.id.clone(), bp.clone());
                    *self.current_blueprint_id.write().await = Some(bp.id.clone());

                    return Ok(bp);
                }
                BlueprintStatus::Completed => {
                    // 可以创建新蓝图
                }
                _ => {
                    return Err(anyhow!(
                        "项目已有蓝图 \"{}\"（状态：{:?}）。请先完成或取消当前蓝图。",
                        existing_bp.name,
                        existing_bp.status
                    ));
                }
            }
        }

        // 创建新蓝图
        let blueprint = Blueprint::new(name, description);
        let id = blueprint.id.clone();

        blueprints.insert(id.clone(), blueprint.clone());
        *self.current_blueprint_id.write().await = Some(id);

        Ok(blueprint)
    }

    // ------------------------------------------------------------------------
    // 蓝图内容操作
    // ------------------------------------------------------------------------

    /// 添加业务流程
    pub async fn add_business_process(
        &self,
        blueprint_id: &str,
        process: BusinessProcess,
    ) -> Result<BusinessProcess> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        let mut new_process = process;
        if new_process.id.is_empty() {
            new_process.id = Uuid::new_v4().to_string();
        }

        blueprint.business_processes.push(new_process.clone());
        self.update_blueprint_internal(blueprint, &format!("添加业务流程：{}", new_process.name));

        Ok(new_process)
    }

    /// 添加系统模块
    pub async fn add_module(
        &self,
        blueprint_id: &str,
        module: SystemModule,
    ) -> Result<SystemModule> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        let mut new_module = module;
        if new_module.id.is_empty() {
            new_module.id = Uuid::new_v4().to_string();
        }

        blueprint.modules.push(new_module.clone());
        self.update_blueprint_internal(blueprint, &format!("添加系统模块：{}", new_module.name));

        Ok(new_module)
    }

    /// 添加非功能性要求
    pub async fn add_nfr(
        &self,
        blueprint_id: &str,
        nfr: NonFunctionalRequirement,
    ) -> Result<NonFunctionalRequirement> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        let mut new_nfr = nfr;
        if new_nfr.id.is_empty() {
            new_nfr.id = Uuid::new_v4().to_string();
        }

        blueprint.nfrs.push(new_nfr.clone());
        self.update_blueprint_internal(blueprint, &format!("添加非功能性要求：{}", new_nfr.name));

        Ok(new_nfr)
    }

    /// 内部更新蓝图
    fn update_blueprint_internal(&self, blueprint: &mut Blueprint, description: &str) {
        blueprint.updated_at = Utc::now();
        blueprint.change_history.push(BlueprintChange {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            change_type: ChangeType::Update,
            description: description.to_string(),
            previous_version: None,
            changes: None,
            author: ChangeAuthor::Agent,
        });
    }

    // ------------------------------------------------------------------------
    // 蓝图状态流转
    // ------------------------------------------------------------------------

    /// 提交蓝图审核
    pub async fn submit_for_review(&self, blueprint_id: &str) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Draft
            && blueprint.status != BlueprintStatus::Modified
        {
            return Err(anyhow!(
                "Cannot submit blueprint in {:?} status for review",
                blueprint.status
            ));
        }

        // 验证蓝图完整性
        let validation = self.validate_blueprint_internal(blueprint);
        if !validation.valid {
            return Err(anyhow!(
                "Blueprint validation failed: {}",
                validation.errors.join(", ")
            ));
        }

        blueprint.status = BlueprintStatus::Review;
        self.update_blueprint_internal(blueprint, "提交蓝图审核");

        Ok(blueprint.clone())
    }

    /// 批准蓝图（用户签字确认）
    pub async fn approve_blueprint(
        &self,
        blueprint_id: &str,
        approved_by: Option<String>,
    ) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Review {
            return Err(anyhow!(
                "Cannot approve blueprint in {:?} status",
                blueprint.status
            ));
        }

        let approver = approved_by.unwrap_or_else(|| "user".to_string());
        blueprint.status = BlueprintStatus::Approved;
        blueprint.approved_at = Some(Utc::now());
        blueprint.approved_by = Some(approver.clone());

        blueprint.change_history.push(BlueprintChange {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            change_type: ChangeType::Approve,
            description: format!("蓝图已批准，签字人：{}", approver),
            previous_version: None,
            changes: None,
            author: ChangeAuthor::User,
        });

        Ok(blueprint.clone())
    }

    /// 拒绝蓝图
    pub async fn reject_blueprint(&self, blueprint_id: &str, reason: &str) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Review {
            return Err(anyhow!(
                "Cannot reject blueprint in {:?} status",
                blueprint.status
            ));
        }

        blueprint.status = BlueprintStatus::Draft;
        blueprint.change_history.push(BlueprintChange {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            change_type: ChangeType::Reject,
            description: format!("蓝图被拒绝：{}", reason),
            previous_version: None,
            changes: None,
            author: ChangeAuthor::User,
        });

        Ok(blueprint.clone())
    }

    /// 开始执行蓝图
    pub async fn start_execution(
        &self,
        blueprint_id: &str,
        task_tree_id: String,
    ) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Approved {
            return Err(anyhow!(
                "Cannot execute blueprint in {:?} status. Must be approved first.",
                blueprint.status
            ));
        }

        blueprint.status = BlueprintStatus::Executing;
        blueprint.task_tree_id = Some(task_tree_id);
        self.update_blueprint_internal(blueprint, "开始执行蓝图");

        Ok(blueprint.clone())
    }

    /// 暂停执行
    pub async fn pause_execution(&self, blueprint_id: &str) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Executing {
            return Err(anyhow!(
                "Cannot pause blueprint in {:?} status",
                blueprint.status
            ));
        }

        blueprint.status = BlueprintStatus::Paused;
        blueprint.change_history.push(BlueprintChange {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            change_type: ChangeType::Pause,
            description: "执行已暂停".to_string(),
            previous_version: None,
            changes: None,
            author: ChangeAuthor::User,
        });

        Ok(blueprint.clone())
    }

    /// 恢复执行
    pub async fn resume_execution(&self, blueprint_id: &str) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Paused {
            return Err(anyhow!(
                "Cannot resume blueprint in {:?} status",
                blueprint.status
            ));
        }

        blueprint.status = BlueprintStatus::Executing;
        blueprint.change_history.push(BlueprintChange {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            change_type: ChangeType::Resume,
            description: "执行已恢复".to_string(),
            previous_version: None,
            changes: None,
            author: ChangeAuthor::User,
        });

        Ok(blueprint.clone())
    }

    /// 完成执行
    pub async fn complete_execution(&self, blueprint_id: &str) -> Result<Blueprint> {
        let mut blueprints = self.blueprints.write().await;
        let blueprint = blueprints
            .get_mut(blueprint_id)
            .ok_or_else(|| anyhow!("Blueprint {} not found", blueprint_id))?;

        blueprint.status = BlueprintStatus::Completed;
        self.update_blueprint_internal(blueprint, "蓝图执行完成");

        Ok(blueprint.clone())
    }

    // ------------------------------------------------------------------------
    // 验证
    // ------------------------------------------------------------------------

    /// 验证蓝图完整性
    /// 返回 (是否有效, 错误列表)
    fn validate_blueprint_internal(&self, blueprint: &Blueprint) -> ValidationResult {
        let mut errors = Vec::new();

        // 基本信息验证
        if blueprint.name.trim().is_empty() {
            errors.push("蓝图名称不能为空".to_string());
        }

        if blueprint.description.trim().is_empty() {
            errors.push("蓝图描述不能为空".to_string());
        }

        // 业务流程验证
        if blueprint.business_processes.is_empty() {
            errors.push("至少需要一个业务流程".to_string());
        }

        for process in &blueprint.business_processes {
            if process.steps.is_empty() {
                errors.push(format!("业务流程 \"{}\" 没有定义步骤", process.name));
            }
        }

        // 系统模块验证
        if blueprint.modules.is_empty() {
            errors.push("至少需要一个系统模块".to_string());
        }

        // 验证模块依赖关系
        let module_ids: std::collections::HashSet<_> =
            blueprint.modules.iter().map(|m| m.id.as_str()).collect();

        for module in &blueprint.modules {
            for dep_id in &module.dependencies {
                if !module_ids.contains(dep_id.as_str()) {
                    errors.push(format!(
                        "模块 \"{}\" 依赖了不存在的模块 ID: {}",
                        module.name, dep_id
                    ));
                }
            }
        }

        // 检测循环依赖
        if let Some(cycle_path) = self.detect_cyclic_dependencies(&blueprint.modules) {
            errors.push(format!("检测到模块循环依赖：{}", cycle_path.join(" -> ")));
        }

        ValidationResult {
            valid: errors.is_empty(),
            errors,
        }
    }

    /// 检测循环依赖（使用迭代方式避免生命周期问题）
    fn detect_cyclic_dependencies(&self, modules: &[SystemModule]) -> Option<Vec<String>> {
        use std::collections::{HashMap, HashSet};

        let module_map: HashMap<&str, &SystemModule> =
            modules.iter().map(|m| (m.id.as_str(), m)).collect();

        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();

        for module in modules {
            if visited.contains(module.id.as_str()) {
                continue;
            }

            // 使用栈模拟 DFS
            let mut stack: Vec<(&str, usize)> = vec![(&module.id, 0)];
            let mut path: Vec<String> = Vec::new();

            while let Some((current_id, dep_index)) = stack.pop() {
                if dep_index == 0 {
                    // 首次访问该节点
                    if rec_stack.contains(current_id) {
                        // 发现循环
                        path.push(current_id.to_string());
                        return Some(path);
                    }

                    visited.insert(current_id);
                    rec_stack.insert(current_id);
                    path.push(current_id.to_string());
                }

                if let Some(current_module) = module_map.get(current_id) {
                    let deps = &current_module.dependencies;

                    if dep_index < deps.len() {
                        // 还有依赖需要处理
                        stack.push((current_id, dep_index + 1));

                        let dep_id = &deps[dep_index];
                        if rec_stack.contains(dep_id.as_str()) {
                            // 发现循环
                            path.push(dep_id.clone());
                            return Some(path);
                        }

                        if !visited.contains(dep_id.as_str()) {
                            stack.push((dep_id, 0));
                        }
                    } else {
                        // 所有依赖都处理完了
                        rec_stack.remove(current_id);
                        path.pop();
                    }
                } else {
                    rec_stack.remove(current_id);
                    path.pop();
                }
            }
        }

        None
    }

    // ------------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------------

    /// 获取蓝图
    pub async fn get_blueprint(&self, id: &str) -> Option<Blueprint> {
        let blueprints = self.blueprints.read().await;
        blueprints.get(id).cloned()
    }

    /// 获取当前蓝图
    pub async fn get_current_blueprint(&self) -> Option<Blueprint> {
        let current_id = self.current_blueprint_id.read().await;
        if let Some(id) = current_id.as_ref() {
            return self.get_blueprint(id).await;
        }

        // 返回最新的蓝图
        let blueprints = self.blueprints.read().await;
        blueprints.values().max_by_key(|b| b.updated_at).cloned()
    }

    /// 设置当前蓝图
    pub async fn set_current_blueprint(&self, id: &str) -> Result<()> {
        let blueprints = self.blueprints.read().await;
        if !blueprints.contains_key(id) {
            return Err(anyhow!("Blueprint {} not found", id));
        }
        *self.current_blueprint_id.write().await = Some(id.to_string());
        Ok(())
    }

    /// 获取所有蓝图
    pub async fn get_all_blueprints(&self) -> Vec<Blueprint> {
        let blueprints = self.blueprints.read().await;
        blueprints.values().cloned().collect()
    }

    /// 按状态筛选蓝图
    pub async fn get_blueprints_by_status(&self, status: BlueprintStatus) -> Vec<Blueprint> {
        let blueprints = self.blueprints.read().await;
        blueprints
            .values()
            .filter(|b| b.status == status)
            .cloned()
            .collect()
    }

    // ------------------------------------------------------------------------
    // 删除
    // ------------------------------------------------------------------------

    /// 删除蓝图
    pub async fn delete_blueprint(&self, id: &str) -> Result<bool> {
        let mut blueprints = self.blueprints.write().await;

        if let Some(blueprint) = blueprints.get(id) {
            if blueprint.status == BlueprintStatus::Executing {
                return Err(anyhow!(
                    "Cannot delete blueprint that is currently executing"
                ));
            }
        }

        let removed = blueprints.remove(id).is_some();

        if removed {
            let mut current_id = self.current_blueprint_id.write().await;
            if current_id.as_ref() == Some(&id.to_string()) {
                *current_id = None;
            }
        }

        Ok(removed)
    }
}

impl Default for BlueprintManager {
    fn default() -> Self {
        Self::with_default_dir()
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 生成蓝图摘要（用于展示）
pub fn generate_blueprint_summary(blueprint: &Blueprint) -> String {
    let mut lines = Vec::new();

    lines.push(format!("# 蓝图：{}", blueprint.name));
    lines.push(format!(
        "版本：{} | 状态：{:?}",
        blueprint.version, blueprint.status
    ));
    lines.push(String::new());
    lines.push("## 描述".to_string());
    lines.push(blueprint.description.clone());
    lines.push(String::new());

    if !blueprint.business_processes.is_empty() {
        lines.push(format!(
            "## 业务流程 ({})",
            blueprint.business_processes.len()
        ));
        for process in &blueprint.business_processes {
            lines.push(format!(
                "- **{}** ({:?}): {} 个步骤",
                process.name,
                process.process_type,
                process.steps.len()
            ));
        }
        lines.push(String::new());
    }

    if !blueprint.modules.is_empty() {
        lines.push(format!("## 系统模块 ({})", blueprint.modules.len()));
        for module in &blueprint.modules {
            let deps = if !module.dependencies.is_empty() {
                format!(" [依赖: {}]", module.dependencies.len())
            } else {
                String::new()
            };
            lines.push(format!(
                "- **{}** ({:?}){}: {} 项职责",
                module.name,
                module.module_type,
                deps,
                module.responsibilities.len()
            ));
        }
        lines.push(String::new());
    }

    if !blueprint.nfrs.is_empty() {
        lines.push(format!("## 非功能性要求 ({})", blueprint.nfrs.len()));
        for nfr in &blueprint.nfrs {
            lines.push(format!(
                "- **{}** ({:?}, {:?})",
                nfr.name, nfr.category, nfr.priority
            ));
        }
        lines.push(String::new());
    }

    if let Some(approved_at) = &blueprint.approved_at {
        lines.push("---".to_string());
        lines.push(format!(
            "✅ 已批准：{} by {}",
            approved_at.to_rfc3339(),
            blueprint.approved_by.as_deref().unwrap_or("unknown")
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_blueprint() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试蓝图".to_string(), "测试描述".to_string())
            .await
            .unwrap();

        assert_eq!(bp.name, "测试蓝图");
        assert_eq!(bp.status, BlueprintStatus::Draft);
    }

    #[tokio::test]
    async fn test_single_blueprint_constraint() {
        let manager = BlueprintManager::default();

        // 创建第一个蓝图
        let bp1 = manager
            .create_blueprint("蓝图1".to_string(), "描述1".to_string())
            .await
            .unwrap();

        // 再次创建应该返回同一个蓝图（因为是 draft 状态）
        let bp2 = manager
            .create_blueprint("蓝图2".to_string(), "描述2".to_string())
            .await
            .unwrap();

        assert_eq!(bp1.id, bp2.id);
        assert_eq!(bp2.name, "蓝图2");
    }
}
