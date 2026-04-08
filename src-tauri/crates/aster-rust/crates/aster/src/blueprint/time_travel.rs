//! 时光倒流系统
//!
//!
//! 提供：
//! 1. 检查点管理（创建、列出、删除）
//! 2. 回滚到任意检查点
//! 3. 分支执行（从检查点创建新分支）
//! 4. 历史比较和差异查看

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use super::task_tree_manager::TaskTreeManager;
use super::types::*;

// ============================================================================
// 检查点信息
// ============================================================================

/// 检查点信息（用于展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub checkpoint_type: CheckpointType,
    pub name: String,
    pub description: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub task_id: Option<String>,
    pub task_name: Option<String>,
    pub task_path: Option<Vec<String>>,
    pub status: String,
    pub can_restore: bool,
    pub has_code_changes: bool,
    pub code_changes_count: usize,
}

/// 检查点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckpointType {
    Task,
    Global,
}

/// 时间线视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineView {
    pub checkpoints: Vec<CheckpointInfo>,
    pub current_position: Option<String>,
    pub branches: Vec<BranchInfo>,
}

/// 分支信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub id: String,
    pub name: String,
    pub from_checkpoint: String,
    pub created_at: DateTime<Utc>,
    pub status: BranchStatus,
}

/// 分支状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchStatus {
    Active,
    Merged,
    Abandoned,
}

/// 差异信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffInfo {
    pub file_path: String,
    #[serde(rename = "type")]
    pub diff_type: DiffType,
    pub before_content: Option<String>,
    pub after_content: Option<String>,
    pub additions: usize,
    pub deletions: usize,
}

/// 差异类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffType {
    Added,
    Modified,
    Deleted,
}

/// 比较结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResult {
    pub from_checkpoint: String,
    pub to_checkpoint: String,
    pub task_changes: Vec<TaskChange>,
    pub code_changes: Vec<DiffInfo>,
    /// 时间差（毫秒）
    pub time_elapsed: i64,
}

/// 任务变更
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskChange {
    pub task_id: String,
    pub task_name: String,
    pub from_status: String,
    pub to_status: String,
    pub iterations: Option<u32>,
}

/// 检查点详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointDetails {
    pub checkpoint: CheckpointInfo,
    pub code_snapshots: Vec<CodeSnapshot>,
    pub test_result: Option<TestResult>,
}

// ============================================================================
// 时光倒流管理器
// ============================================================================

/// 时光倒流管理器
pub struct TimeTravelManager {
    branches: HashMap<String, BranchInfo>,
    current_branch: String,
}

impl Default for TimeTravelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeTravelManager {
    /// 创建新的时光倒流管理器
    pub fn new() -> Self {
        Self {
            branches: HashMap::new(),
            current_branch: "main".to_string(),
        }
    }

    // ------------------------------------------------------------------------
    // 检查点列表
    // ------------------------------------------------------------------------

    /// 获取所有检查点（按时间排序）
    pub fn get_all_checkpoints(&self, tree: &TaskTree) -> Vec<CheckpointInfo> {
        let mut checkpoints = Vec::new();

        // 收集全局检查点
        for gc in &tree.global_checkpoints {
            checkpoints.push(CheckpointInfo {
                id: gc.id.clone(),
                checkpoint_type: CheckpointType::Global,
                name: gc.name.clone(),
                description: gc.description.clone(),
                timestamp: gc.timestamp,
                task_id: None,
                task_name: None,
                task_path: None,
                status: "全局快照".to_string(),
                can_restore: gc.can_restore,
                has_code_changes: !gc.file_changes.is_empty(),
                code_changes_count: gc.file_changes.len(),
            });
        }

        // 收集任务检查点
        self.collect_task_checkpoints(&tree.root, &mut checkpoints, Vec::new());

        // 按时间倒序排序
        checkpoints.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        checkpoints
    }

    /// 递归收集任务检查点
    fn collect_task_checkpoints(
        &self,
        node: &TaskNode,
        result: &mut Vec<CheckpointInfo>,
        path: Vec<String>,
    ) {
        let mut current_path = path;
        current_path.push(node.name.clone());

        for cp in &node.checkpoints {
            result.push(CheckpointInfo {
                id: cp.id.clone(),
                checkpoint_type: CheckpointType::Task,
                name: cp.name.clone(),
                description: cp.description.clone(),
                timestamp: cp.timestamp,
                task_id: Some(node.id.clone()),
                task_name: Some(node.name.clone()),
                task_path: Some(current_path.clone()),
                status: format!("{:?}", cp.task_status),
                can_restore: cp.can_restore,
                has_code_changes: !cp.code_snapshot.is_empty(),
                code_changes_count: cp.code_snapshot.len(),
            });
        }

        for child in &node.children {
            self.collect_task_checkpoints(child, result, current_path.clone());
        }
    }

    /// 获取时间线视图
    pub fn get_timeline_view(&self, tree: &TaskTree) -> TimelineView {
        let checkpoints = self.get_all_checkpoints(tree);
        let branches: Vec<BranchInfo> = self
            .branches
            .values()
            .filter(|b| b.status == BranchStatus::Active)
            .cloned()
            .collect();

        TimelineView {
            current_position: checkpoints.first().map(|c| c.id.clone()),
            checkpoints,
            branches,
        }
    }

    // ------------------------------------------------------------------------
    // 检查点操作
    // ------------------------------------------------------------------------

    /// 创建手动检查点
    pub async fn create_manual_checkpoint(
        &self,
        tree_manager: &mut TaskTreeManager,
        tree_id: &str,
        name: String,
        description: Option<String>,
        task_id: Option<&str>,
    ) -> Result<CheckpointInfo, String> {
        if let Some(tid) = task_id {
            // 创建任务检查点
            let checkpoint = tree_manager
                .create_task_checkpoint(tree_id, tid, name.clone(), description.clone())
                .await
                .map_err(|e| e.to_string())?;

            let tree = tree_manager
                .get_task_tree(tree_id)
                .await
                .ok_or_else(|| format!("任务树 {} 不存在", tree_id))?;
            let task = TaskTreeManager::find_task(&tree.root, tid);

            Ok(CheckpointInfo {
                id: checkpoint.id,
                checkpoint_type: CheckpointType::Task,
                name: checkpoint.name,
                description: checkpoint.description,
                timestamp: checkpoint.timestamp,
                task_id: Some(tid.to_string()),
                task_name: task.map(|t| t.name.clone()),
                task_path: None,
                status: format!("{:?}", checkpoint.task_status),
                can_restore: checkpoint.can_restore,
                has_code_changes: !checkpoint.code_snapshot.is_empty(),
                code_changes_count: checkpoint.code_snapshot.len(),
            })
        } else {
            // 创建全局检查点
            let checkpoint = tree_manager
                .create_global_checkpoint(tree_id, name.clone(), description.clone())
                .await
                .map_err(|e| e.to_string())?;

            Ok(CheckpointInfo {
                id: checkpoint.id,
                checkpoint_type: CheckpointType::Global,
                name: checkpoint.name,
                description: checkpoint.description,
                timestamp: checkpoint.timestamp,
                task_id: None,
                task_name: None,
                task_path: None,
                status: "全局快照".to_string(),
                can_restore: checkpoint.can_restore,
                has_code_changes: !checkpoint.file_changes.is_empty(),
                code_changes_count: checkpoint.file_changes.len(),
            })
        }
    }

    /// 回滚到检查点
    pub async fn rollback(
        &self,
        tree_manager: &mut TaskTreeManager,
        tree_id: &str,
        checkpoint_id: &str,
    ) -> Result<(), String> {
        let tree = tree_manager
            .get_task_tree(tree_id)
            .await
            .ok_or_else(|| format!("任务树 {} 不存在", tree_id))?;

        let checkpoints = self.get_all_checkpoints(&tree);
        let checkpoint = checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
            .ok_or_else(|| format!("检查点 {} 不存在", checkpoint_id))?;

        if !checkpoint.can_restore {
            return Err(format!("检查点 {} 无法恢复", checkpoint_id));
        }

        match checkpoint.checkpoint_type {
            CheckpointType::Global => {
                tree_manager
                    .rollback_to_global_checkpoint(tree_id, checkpoint_id)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            CheckpointType::Task => {
                let task_id = checkpoint
                    .task_id
                    .as_ref()
                    .ok_or_else(|| "任务检查点缺少 task_id".to_string())?;
                tree_manager
                    .rollback_to_checkpoint(tree_id, task_id, checkpoint_id)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
        }
    }

    /// 预览回滚效果
    pub fn preview_rollback(
        &self,
        tree: &TaskTree,
        checkpoint_id: &str,
    ) -> Result<CompareResult, String> {
        let checkpoints = self.get_all_checkpoints(tree);
        let _target = checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
            .ok_or_else(|| format!("检查点 {} 不存在", checkpoint_id))?;

        let current = checkpoints
            .first()
            .ok_or_else(|| "没有当前检查点".to_string())?;

        self.compare_checkpoints(tree, checkpoint_id, &current.id)
    }

    // ------------------------------------------------------------------------
    // 分支管理
    // ------------------------------------------------------------------------

    /// 从检查点创建新分支
    pub async fn create_branch(
        &mut self,
        tree_manager: &mut TaskTreeManager,
        tree_id: &str,
        checkpoint_id: &str,
        branch_name: String,
    ) -> Result<BranchInfo, String> {
        let tree = tree_manager
            .get_task_tree(tree_id)
            .await
            .ok_or_else(|| format!("任务树 {} 不存在", tree_id))?;

        let checkpoints = self.get_all_checkpoints(&tree);
        let _checkpoint = checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
            .ok_or_else(|| format!("检查点 {} 不存在", checkpoint_id))?;

        let branch = BranchInfo {
            id: Uuid::new_v4().to_string(),
            name: branch_name,
            from_checkpoint: checkpoint_id.to_string(),
            created_at: Utc::now(),
            status: BranchStatus::Active,
        };

        // 回滚到检查点
        self.rollback(tree_manager, tree_id, checkpoint_id).await?;

        self.branches.insert(branch.id.clone(), branch.clone());

        Ok(branch)
    }

    /// 切换分支
    pub fn switch_branch(&mut self, branch_id: &str) -> Result<(), String> {
        if !self.branches.contains_key(branch_id) {
            return Err(format!("分支 {} 不存在", branch_id));
        }

        self.current_branch = branch_id.to_string();
        Ok(())
    }

    /// 获取当前分支
    pub fn get_current_branch(&self) -> &str {
        &self.current_branch
    }

    /// 获取所有分支
    pub fn get_branches(&self) -> Vec<&BranchInfo> {
        self.branches.values().collect()
    }

    // ------------------------------------------------------------------------
    // 比较和差异
    // ------------------------------------------------------------------------

    /// 比较两个检查点
    pub fn compare_checkpoints(
        &self,
        tree: &TaskTree,
        from_checkpoint_id: &str,
        to_checkpoint_id: &str,
    ) -> Result<CompareResult, String> {
        let checkpoints = self.get_all_checkpoints(tree);

        let from = checkpoints
            .iter()
            .find(|c| c.id == from_checkpoint_id)
            .ok_or_else(|| format!("检查点 {} 不存在", from_checkpoint_id))?;

        let to = checkpoints
            .iter()
            .find(|c| c.id == to_checkpoint_id)
            .ok_or_else(|| format!("检查点 {} 不存在", to_checkpoint_id))?;

        let time_elapsed = to.timestamp.timestamp_millis() - from.timestamp.timestamp_millis();

        // TODO: 实际实现需要比较两个快照的任务状态和代码内容
        Ok(CompareResult {
            from_checkpoint: from_checkpoint_id.to_string(),
            to_checkpoint: to_checkpoint_id.to_string(),
            task_changes: Vec::new(),
            code_changes: Vec::new(),
            time_elapsed,
        })
    }

    /// 查看检查点详情
    pub fn get_checkpoint_details(
        &self,
        tree: &TaskTree,
        checkpoint_id: &str,
    ) -> Option<CheckpointDetails> {
        // 查找全局检查点
        if let Some(gc) = tree
            .global_checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
        {
            return Some(CheckpointDetails {
                checkpoint: CheckpointInfo {
                    id: gc.id.clone(),
                    checkpoint_type: CheckpointType::Global,
                    name: gc.name.clone(),
                    description: gc.description.clone(),
                    timestamp: gc.timestamp,
                    task_id: None,
                    task_name: None,
                    task_path: None,
                    status: "全局快照".to_string(),
                    can_restore: gc.can_restore,
                    has_code_changes: !gc.file_changes.is_empty(),
                    code_changes_count: gc.file_changes.len(),
                },
                code_snapshots: gc
                    .file_changes
                    .iter()
                    .map(|fc| CodeSnapshot {
                        file_path: fc.file_path.clone(),
                        content: fc.new_content.clone().unwrap_or_default(),
                        hash: String::new(),
                    })
                    .collect(),
                test_result: None,
            });
        }

        // 查找任务检查点
        self.find_task_checkpoint(&tree.root, checkpoint_id)
    }

    /// 在任务树中查找检查点
    fn find_task_checkpoint(
        &self,
        node: &TaskNode,
        checkpoint_id: &str,
    ) -> Option<CheckpointDetails> {
        for cp in &node.checkpoints {
            if cp.id == checkpoint_id {
                return Some(CheckpointDetails {
                    checkpoint: CheckpointInfo {
                        id: cp.id.clone(),
                        checkpoint_type: CheckpointType::Task,
                        name: cp.name.clone(),
                        description: cp.description.clone(),
                        timestamp: cp.timestamp,
                        task_id: Some(node.id.clone()),
                        task_name: Some(node.name.clone()),
                        task_path: None,
                        status: format!("{:?}", cp.task_status),
                        can_restore: cp.can_restore,
                        has_code_changes: !cp.code_snapshot.is_empty(),
                        code_changes_count: cp.code_snapshot.len(),
                    },
                    code_snapshots: cp.code_snapshot.clone(),
                    test_result: cp.test_result.clone(),
                });
            }
        }

        for child in &node.children {
            if let Some(details) = self.find_task_checkpoint(child, checkpoint_id) {
                return Some(details);
            }
        }

        None
    }

    // ------------------------------------------------------------------------
    // 可视化辅助
    // ------------------------------------------------------------------------

    /// 生成检查点树形图（用于终端显示）
    pub fn generate_checkpoint_tree(&self, tree: &TaskTree) -> String {
        let checkpoints = self.get_all_checkpoints(tree);
        let mut lines = Vec::new();

        lines.push("检查点时间线".to_string());
        lines.push("============".to_string());
        lines.push(String::new());

        for (i, cp) in checkpoints.iter().enumerate() {
            let is_last = i == checkpoints.len() - 1;
            let prefix = if is_last { "└── " } else { "├── " };
            let type_icon = if cp.checkpoint_type == CheckpointType::Global {
                "🌍"
            } else {
                "📌"
            };
            let status_icon = if cp.can_restore { "✅" } else { "⚠️" };

            lines.push(format!(
                "{}{} {} {}",
                prefix, type_icon, cp.name, status_icon
            ));

            let indent = if is_last { "    " } else { "│   " };
            lines.push(format!(
                "{}📅 {}",
                indent,
                cp.timestamp.format("%Y-%m-%d %H:%M:%S")
            ));

            if let Some(ref task_name) = cp.task_name {
                lines.push(format!("{}📁 {}", indent, task_name));
            }

            lines.push(format!("{}💾 {} 个文件变更", indent, cp.code_changes_count));
            lines.push(indent.to_string());
        }

        lines.join("\n")
    }

    /// 生成时间线 ASCII 图
    pub fn generate_timeline_ascii(&self, tree: &TaskTree) -> String {
        let checkpoints = self.get_all_checkpoints(tree);
        let mut lines = Vec::new();

        lines.push(String::new());
        lines.push("时间线 →".to_string());
        lines.push(String::new());

        // 绘制时间线
        let mut timeline = "○".to_string();
        for _ in 0..checkpoints.len().saturating_sub(1) {
            timeline.push_str("───●");
        }
        timeline.push_str("───◉ (当前)");
        lines.push(timeline);

        // 绘制标签
        let mut labels = String::new();
        for cp in checkpoints.iter().rev() {
            let short_name: String = cp.name.chars().take(10).collect();
            let display_name = if cp.name.chars().count() > 10 {
                format!("{}..", short_name)
            } else {
                short_name
            };
            labels.push_str(&format!("{:<15}", display_name));
        }
        lines.push(labels);

        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_travel_manager_creation() {
        let manager = TimeTravelManager::new();
        assert_eq!(manager.get_current_branch(), "main");
        assert!(manager.get_branches().is_empty());
    }

    #[test]
    fn test_checkpoint_type_serialization() {
        let task_type = CheckpointType::Task;
        let global_type = CheckpointType::Global;

        let task_json = serde_json::to_string(&task_type).unwrap();
        let global_json = serde_json::to_string(&global_type).unwrap();

        assert_eq!(task_json, "\"task\"");
        assert_eq!(global_json, "\"global\"");
    }
}
