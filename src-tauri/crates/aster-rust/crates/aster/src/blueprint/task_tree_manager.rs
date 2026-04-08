//! 任务树管理器
//!
//!
//! 负责：
//! 1. 从蓝图生成任务树
//! 2. 任务树的 CRUD 操作
//! 3. 任务状态管理
//! 4. 检查点（时光倒流）管理
//! 5. 任务树统计

use anyhow::{anyhow, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::types::*;

// ============================================================================
// 任务树管理器
// ============================================================================

/// 任务树管理器
#[allow(dead_code)]
pub struct TaskTreeManager {
    /// 任务树存储
    task_trees: Arc<RwLock<HashMap<String, TaskTree>>>,
    /// 当前任务树 ID
    current_tree_id: Arc<RwLock<Option<String>>>,
    /// 当前蓝图引用
    current_blueprint: Arc<RwLock<Option<Blueprint>>>,
    /// 存储目录
    storage_dir: PathBuf,
}

impl TaskTreeManager {
    /// 创建新的任务树管理器
    pub fn new(storage_dir: PathBuf) -> Self {
        Self {
            task_trees: Arc::new(RwLock::new(HashMap::new())),
            current_tree_id: Arc::new(RwLock::new(None)),
            current_blueprint: Arc::new(RwLock::new(None)),
            storage_dir,
        }
    }

    /// 从默认目录创建
    pub fn with_default_dir() -> Self {
        let storage_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".aster")
            .join("task-trees");
        Self::new(storage_dir)
    }

    /// 设置当前蓝图
    pub async fn set_current_blueprint(&self, blueprint: Blueprint) {
        *self.current_blueprint.write().await = Some(blueprint);
    }

    /// 获取当前蓝图
    pub async fn get_current_blueprint(&self) -> Option<Blueprint> {
        self.current_blueprint.read().await.clone()
    }

    // ------------------------------------------------------------------------
    // 从蓝图生成任务树
    // ------------------------------------------------------------------------

    /// 从蓝图生成任务树
    pub async fn generate_from_blueprint(&self, blueprint: &Blueprint) -> Result<TaskTree> {
        // 保存蓝图引用
        *self.current_blueprint.write().await = Some(blueprint.clone());

        // 创建根任务节点
        let mut root_task = self.create_root_task(blueprint);

        // 为每个系统模块创建任务分支
        for module in &blueprint.modules {
            let module_task = self.create_module_task(module, &root_task.id, 1);
            root_task.children.push(module_task);
        }

        // 处理模块间的依赖关系
        self.resolve_dependencies(&mut root_task, &blueprint.modules);

        // 创建任务树
        let mut task_tree = TaskTree::new(blueprint.id.clone(), root_task);
        task_tree.stats = self.calculate_stats(&task_tree.root);

        // 保存
        let tree_id = task_tree.id.clone();
        self.task_trees
            .write()
            .await
            .insert(tree_id.clone(), task_tree.clone());
        *self.current_tree_id.write().await = Some(tree_id);

        Ok(task_tree)
    }

    /// 创建根任务
    fn create_root_task(&self, blueprint: &Blueprint) -> TaskNode {
        let mut task = TaskNode::new(
            format!("项目：{}", blueprint.name),
            blueprint.description.clone(),
            0,
        );
        task.priority = 100;
        task
    }

    /// 为系统模块创建任务分支
    fn create_module_task(&self, module: &SystemModule, parent_id: &str, depth: u32) -> TaskNode {
        let mut module_task = TaskNode::new(
            format!("模块：{}", module.name),
            module.description.clone(),
            depth,
        );
        module_task.parent_id = Some(parent_id.to_string());
        module_task.blueprint_module_id = Some(module.id.clone());
        module_task.priority = self.calculate_module_priority(module);
        module_task.metadata = Some(serde_json::json!({
            "moduleType": format!("{:?}", module.module_type),
            "techStack": module.tech_stack,
        }));

        // 为每个职责创建子任务
        for (i, responsibility) in module.responsibilities.iter().enumerate() {
            let resp_task =
                self.create_responsibility_task(responsibility, &module_task.id, depth + 1, i);
            module_task.children.push(resp_task);
        }

        // 为每个接口创建子任务
        for iface in &module.interfaces {
            let iface_task = self.create_interface_task(iface, &module_task.id, depth + 1);
            module_task.children.push(iface_task);
        }

        module_task
    }

    /// 为职责创建任务
    fn create_responsibility_task(
        &self,
        responsibility: &str,
        parent_id: &str,
        depth: u32,
        index: usize,
    ) -> TaskNode {
        let mut task = TaskNode::new(
            format!("功能：{}", responsibility),
            responsibility.to_string(),
            depth,
        );
        task.parent_id = Some(parent_id.to_string());
        task.priority = 50 - index as i32;

        // 为每个功能创建更细粒度的子任务
        let subtasks = self.decompose_responsibility(responsibility, &task.id, depth + 1);
        task.children = subtasks;

        task
    }

    /// 分解职责为更细粒度的任务
    fn decompose_responsibility(
        &self,
        responsibility: &str,
        parent_id: &str,
        depth: u32,
    ) -> Vec<TaskNode> {
        let subtask_templates = [
            ("设计", format!("设计 {} 的实现方案", responsibility)),
            ("测试用例", format!("编写 {} 的测试用例", responsibility)),
            ("实现", format!("实现 {}", responsibility)),
            ("集成测试", format!("{} 的集成测试", responsibility)),
        ];

        subtask_templates
            .iter()
            .enumerate()
            .map(|(i, (name, desc))| {
                let short_resp = if responsibility.len() > 20 {
                    // Find safe UTF-8 boundary for truncation
                    let truncate_at = responsibility
                        .char_indices()
                        .take_while(|(idx, _)| *idx < 20)
                        .last()
                        .map(|(idx, c)| idx + c.len_utf8())
                        .unwrap_or(0);
                    format!(
                        "{}...",
                        responsibility.get(..truncate_at).unwrap_or(responsibility)
                    )
                } else {
                    responsibility.to_string()
                };

                let mut task =
                    TaskNode::new(format!("{}：{}", name, short_resp), desc.clone(), depth);
                task.parent_id = Some(parent_id.to_string());
                task.priority = 40 - (i as i32 * 10);
                task
            })
            .collect()
    }

    /// 为接口创建任务
    fn create_interface_task(
        &self,
        iface: &ModuleInterface,
        parent_id: &str,
        depth: u32,
    ) -> TaskNode {
        let mut task = TaskNode::new(
            format!("接口：{}", iface.name),
            format!("{:?} 接口 - {}", iface.interface_type, iface.description),
            depth,
        );
        task.parent_id = Some(parent_id.to_string());
        task.priority = 30;
        task.metadata = Some(serde_json::json!({
            "interfaceType": format!("{:?}", iface.interface_type),
        }));
        task
    }

    /// 计算模块优先级
    fn calculate_module_priority(&self, module: &SystemModule) -> i32 {
        let type_priority = match module.module_type {
            ModuleType::Infrastructure => 90,
            ModuleType::Database => 85,
            ModuleType::Backend => 80,
            ModuleType::Service => 70,
            ModuleType::Frontend => 60,
            ModuleType::Other => 50,
        };

        // 依赖越少优先级越高
        let dep_penalty = module.dependencies.len() as i32 * 5;
        type_priority - dep_penalty
    }

    /// 解析模块间依赖关系
    fn resolve_dependencies(&self, root_task: &mut TaskNode, modules: &[SystemModule]) {
        // 创建模块 ID 到任务 ID 的映射
        let module_to_task: HashMap<String, String> = root_task
            .children
            .iter()
            .filter_map(|child| {
                child
                    .blueprint_module_id
                    .as_ref()
                    .map(|mid| (mid.clone(), child.id.clone()))
            })
            .collect();

        // 更新任务依赖
        for child in &mut root_task.children {
            if let Some(module_id) = &child.blueprint_module_id {
                if let Some(module) = modules.iter().find(|m| &m.id == module_id) {
                    for dep_module_id in &module.dependencies {
                        if let Some(dep_task_id) = module_to_task.get(dep_module_id) {
                            child.dependencies.push(dep_task_id.clone());
                        }
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // 任务状态管理
    // ------------------------------------------------------------------------

    /// 更新任务状态
    pub async fn update_task_status(
        &self,
        tree_id: &str,
        task_id: &str,
        status: TaskStatus,
    ) -> Result<TaskNode> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        let task = Self::find_task_mut(&mut tree.root, task_id)
            .ok_or_else(|| anyhow!("Task {} not found", task_id))?;

        let _previous_status = task.status;
        task.status = status;

        // 更新时间戳
        match status {
            TaskStatus::Coding | TaskStatus::TestWriting => {
                if task.started_at.is_none() {
                    task.started_at = Some(Utc::now());
                }
            }
            TaskStatus::Passed | TaskStatus::Approved => {
                task.completed_at = Some(Utc::now());
            }
            _ => {}
        }

        let task_clone = task.clone();

        // 更新统计
        tree.stats = self.calculate_stats(&tree.root);

        // 向上传播状态
        Self::propagate_status(&mut tree.root);

        Ok(task_clone)
    }

    /// 在树中查找任务（可变引用）
    fn find_task_mut<'a>(node: &'a mut TaskNode, task_id: &str) -> Option<&'a mut TaskNode> {
        if node.id == task_id {
            return Some(node);
        }

        for child in &mut node.children {
            if let Some(found) = Self::find_task_mut(child, task_id) {
                return Some(found);
            }
        }

        None
    }

    /// 在树中查找任务
    pub fn find_task<'a>(node: &'a TaskNode, task_id: &str) -> Option<&'a TaskNode> {
        if node.id == task_id {
            return Some(node);
        }

        for child in &node.children {
            if let Some(found) = Self::find_task(child, task_id) {
                return Some(found);
            }
        }

        None
    }

    /// 向上传播状态
    fn propagate_status(node: &mut TaskNode) {
        if node.children.is_empty() {
            return;
        }

        // 先递归处理子节点
        for child in &mut node.children {
            Self::propagate_status(child);
        }

        // 统计子任务状态
        let all_passed = node
            .children
            .iter()
            .all(|c| c.status == TaskStatus::Passed || c.status == TaskStatus::Approved);
        let any_failed = node
            .children
            .iter()
            .any(|c| c.status == TaskStatus::TestFailed || c.status == TaskStatus::Rejected);
        let any_running = node.children.iter().any(|c| {
            matches!(
                c.status,
                TaskStatus::Coding | TaskStatus::Testing | TaskStatus::TestWriting
            )
        });

        // 更新父节点状态
        if all_passed && node.status != TaskStatus::Approved {
            node.status = TaskStatus::Passed;
            node.completed_at = Some(Utc::now());
        } else if any_failed && node.status != TaskStatus::TestFailed {
            node.status = TaskStatus::TestFailed;
        } else if any_running && node.status == TaskStatus::Pending {
            node.status = TaskStatus::Coding;
            if node.started_at.is_none() {
                node.started_at = Some(Utc::now());
            }
        }
    }

    /// 检查任务是否可以开始
    pub async fn can_start_task(&self, tree_id: &str, task_id: &str) -> (bool, Vec<String>) {
        let trees = self.task_trees.read().await;
        let tree = match trees.get(tree_id) {
            Some(t) => t,
            None => return (false, vec!["任务树不存在".to_string()]),
        };

        let task = match Self::find_task(&tree.root, task_id) {
            Some(t) => t,
            None => return (false, vec!["任务不存在".to_string()]),
        };

        if task.status != TaskStatus::Pending && task.status != TaskStatus::Blocked {
            return (
                false,
                vec![format!("任务状态为 {:?}，不能开始", task.status)],
            );
        }

        let mut blockers = Vec::new();

        // 检查依赖
        for dep_id in &task.dependencies {
            if let Some(dep_task) = Self::find_task(&tree.root, dep_id) {
                if dep_task.status != TaskStatus::Passed && dep_task.status != TaskStatus::Approved
                {
                    blockers.push(format!(
                        "依赖任务 \"{}\" 尚未完成 ({:?})",
                        dep_task.name, dep_task.status
                    ));
                }
            }
        }

        (blockers.is_empty(), blockers)
    }

    /// 获取可执行的任务列表
    pub async fn get_executable_tasks(&self, tree_id: &str) -> Vec<TaskNode> {
        let trees = self.task_trees.read().await;
        let tree = match trees.get(tree_id) {
            Some(t) => t,
            None => return Vec::new(),
        };

        let mut executable = Vec::new();
        self.collect_executable_tasks(&tree.root, &mut executable, tree_id, &trees);

        // 按优先级排序
        executable.sort_by(|a, b| b.priority.cmp(&a.priority));
        executable
    }

    fn collect_executable_tasks(
        &self,
        node: &TaskNode,
        result: &mut Vec<TaskNode>,
        tree_id: &str,
        trees: &HashMap<String, TaskTree>,
    ) {
        if node.status == TaskStatus::Pending || node.status == TaskStatus::Blocked {
            // 简化检查：只检查依赖是否完成
            let can_start = node.dependencies.iter().all(|dep_id| {
                if let Some(tree) = trees.get(tree_id) {
                    if let Some(dep_task) = Self::find_task(&tree.root, dep_id) {
                        return dep_task.status == TaskStatus::Passed
                            || dep_task.status == TaskStatus::Approved;
                    }
                }
                false
            }) || node.dependencies.is_empty();

            if can_start {
                result.push(node.clone());
            }
        }

        for child in &node.children {
            self.collect_executable_tasks(child, result, tree_id, trees);
        }
    }

    // ------------------------------------------------------------------------
    // 检查点管理
    // ------------------------------------------------------------------------

    /// 创建任务检查点
    pub async fn create_task_checkpoint(
        &self,
        tree_id: &str,
        task_id: &str,
        name: String,
        description: Option<String>,
    ) -> Result<Checkpoint> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        let task = Self::find_task_mut(&mut tree.root, task_id)
            .ok_or_else(|| anyhow!("Task {} not found", task_id))?;

        // 收集代码快照
        let code_snapshot: Vec<CodeSnapshot> = task
            .code_artifacts
            .iter()
            .filter_map(|artifact| {
                if let (Some(path), Some(content)) = (&artifact.file_path, &artifact.content) {
                    Some(CodeSnapshot {
                        file_path: path.clone(),
                        content: content.clone(),
                        hash: Self::hash_content(content),
                    })
                } else {
                    None
                }
            })
            .collect();

        let checkpoint = Checkpoint {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            timestamp: Utc::now(),
            name,
            description,
            task_status: task.status,
            test_result: task.test_spec.as_ref().and_then(|s| s.last_result.clone()),
            code_snapshot,
            can_restore: true,
            metadata: None,
        };

        task.checkpoints.push(checkpoint.clone());

        Ok(checkpoint)
    }

    /// 创建全局检查点
    pub async fn create_global_checkpoint(
        &self,
        tree_id: &str,
        name: String,
        description: Option<String>,
    ) -> Result<GlobalCheckpoint> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        // 序列化整棵树
        let tree_snapshot = serde_json::to_string(&tree.root)?;

        // 收集所有文件变更
        let mut file_changes = Vec::new();
        Self::collect_file_changes(&tree.root, &mut file_changes);

        let checkpoint = GlobalCheckpoint {
            id: Uuid::new_v4().to_string(),
            tree_id: tree_id.to_string(),
            timestamp: Utc::now(),
            name,
            description,
            tree_snapshot,
            file_changes,
            can_restore: true,
        };

        tree.global_checkpoints.push(checkpoint.clone());

        Ok(checkpoint)
    }

    fn collect_file_changes(node: &TaskNode, changes: &mut Vec<FileChange>) {
        for artifact in &node.code_artifacts {
            if let Some(path) = &artifact.file_path {
                if artifact.artifact_type == ArtifactType::File {
                    changes.push(FileChange {
                        file_path: path.clone(),
                        change_type: FileChangeType::Create,
                        previous_content: None,
                        new_content: artifact.content.clone(),
                    });
                }
            }
        }

        for child in &node.children {
            Self::collect_file_changes(child, changes);
        }
    }

    fn hash_content(content: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// 回滚到任务检查点
    pub async fn rollback_to_checkpoint(
        &self,
        tree_id: &str,
        task_id: &str,
        checkpoint_id: &str,
    ) -> Result<TaskNode> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        // 先找到任务并完成所有修改，然后克隆结果
        let task_clone = {
            let task = Self::find_task_mut(&mut tree.root, task_id)
                .ok_or_else(|| anyhow!("Task {} not found", task_id))?;

            let checkpoint = task
                .checkpoints
                .iter()
                .find(|c| c.id == checkpoint_id)
                .ok_or_else(|| anyhow!("Checkpoint {} not found", checkpoint_id))?
                .clone();

            if !checkpoint.can_restore {
                return Err(anyhow!("Checkpoint {} cannot be restored", checkpoint_id));
            }

            // 恢复任务状态
            task.status = checkpoint.task_status;

            // 恢复测试结果
            if let Some(ref mut test_spec) = task.test_spec {
                test_spec.last_result = checkpoint.test_result.clone();
            }

            // 恢复代码（标记为待恢复的代码产出物）
            for snapshot in &checkpoint.code_snapshot {
                task.code_artifacts.push(CodeArtifact {
                    id: Uuid::new_v4().to_string(),
                    artifact_type: ArtifactType::File,
                    file_path: Some(snapshot.file_path.clone()),
                    content: Some(snapshot.content.clone()),
                    command: None,
                    created_at: Utc::now(),
                    checkpoint_id: Some(checkpoint.id.clone()),
                });
            }

            // 删除此检查点之后的所有检查点
            let checkpoint_index = task
                .checkpoints
                .iter()
                .position(|c| c.id == checkpoint_id)
                .unwrap_or(0);
            task.checkpoints.truncate(checkpoint_index + 1);

            task.clone()
        };

        // 更新统计（此时 task 的可变借用已结束）
        tree.stats = self.calculate_stats(&tree.root);

        Ok(task_clone)
    }

    /// 回滚到全局检查点
    pub async fn rollback_to_global_checkpoint(
        &self,
        tree_id: &str,
        checkpoint_id: &str,
    ) -> Result<TaskTree> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        let checkpoint = tree
            .global_checkpoints
            .iter()
            .find(|c| c.id == checkpoint_id)
            .ok_or_else(|| anyhow!("Global checkpoint {} not found", checkpoint_id))?
            .clone();

        if !checkpoint.can_restore {
            return Err(anyhow!(
                "Global checkpoint {} cannot be restored",
                checkpoint_id
            ));
        }

        // 恢复整棵树
        let restored_root: TaskNode = serde_json::from_str(&checkpoint.tree_snapshot)?;
        tree.root = restored_root;

        // 删除此检查点之后的所有检查点
        let checkpoint_index = tree
            .global_checkpoints
            .iter()
            .position(|c| c.id == checkpoint_id)
            .unwrap_or(0);
        tree.global_checkpoints.truncate(checkpoint_index + 1);

        // 更新统计
        tree.stats = self.calculate_stats(&tree.root);

        Ok(tree.clone())
    }

    // ------------------------------------------------------------------------
    // 动态任务细化
    // ------------------------------------------------------------------------

    /// 动态添加子任务
    pub async fn add_sub_task(
        &self,
        tree_id: &str,
        parent_task_id: &str,
        name: String,
        description: String,
        priority: i32,
    ) -> Result<TaskNode> {
        let mut trees = self.task_trees.write().await;
        let tree = trees
            .get_mut(tree_id)
            .ok_or_else(|| anyhow!("Task tree {} not found", tree_id))?;

        let parent_task = Self::find_task_mut(&mut tree.root, parent_task_id)
            .ok_or_else(|| anyhow!("Parent task {} not found", parent_task_id))?;

        let mut new_task = TaskNode::new(name, description, parent_task.depth + 1);
        new_task.parent_id = Some(parent_task_id.to_string());
        new_task.priority = priority;

        let task_clone = new_task.clone();
        parent_task.children.push(new_task);

        // 更新统计
        tree.stats = self.calculate_stats(&tree.root);

        Ok(task_clone)
    }

    // ------------------------------------------------------------------------
    // 统计
    // ------------------------------------------------------------------------

    /// 计算任务树统计
    pub fn calculate_stats(&self, root: &TaskNode) -> TaskTreeStats {
        let mut stats = TaskTreeStats::default();
        let mut total_depth = 0u64;

        fn traverse(node: &TaskNode, stats: &mut TaskTreeStats, total_depth: &mut u64) {
            stats.total_tasks += 1;
            *total_depth += node.depth as u64;

            if node.depth > stats.max_depth {
                stats.max_depth = node.depth;
            }

            match node.status {
                TaskStatus::Pending => stats.pending_tasks += 1,
                TaskStatus::Blocked => stats.blocked_tasks += 1,
                TaskStatus::Coding | TaskStatus::Testing | TaskStatus::TestWriting => {
                    stats.running_tasks += 1
                }
                TaskStatus::Passed | TaskStatus::Approved => stats.passed_tasks += 1,
                TaskStatus::TestFailed | TaskStatus::Rejected => stats.failed_tasks += 1,
                _ => {}
            }

            if node.test_spec.is_some() {
                stats.total_tests += 1;
                if let Some(ref spec) = node.test_spec {
                    if let Some(ref result) = spec.last_result {
                        if result.passed {
                            stats.passed_tests += 1;
                        } else {
                            stats.failed_tests += 1;
                        }
                    }
                }
            }

            for child in &node.children {
                traverse(child, stats, total_depth);
            }
        }

        traverse(root, &mut stats, &mut total_depth);

        stats.avg_depth = if stats.total_tasks > 0 {
            total_depth as f64 / stats.total_tasks as f64
        } else {
            0.0
        };

        stats.progress_percentage = if stats.total_tasks > 0 {
            ((stats.passed_tasks + stats.failed_tasks) as f64 / stats.total_tasks as f64) * 100.0
        } else {
            0.0
        };

        stats
    }

    // ------------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------------

    /// 获取任务树
    pub async fn get_task_tree(&self, id: &str) -> Option<TaskTree> {
        let trees = self.task_trees.read().await;
        trees.get(id).cloned()
    }

    /// 获取当前任务树
    pub async fn get_current_task_tree(&self) -> Option<TaskTree> {
        let current_id = self.current_tree_id.read().await;
        if let Some(id) = current_id.as_ref() {
            return self.get_task_tree(id).await;
        }
        None
    }

    /// 获取任务路径（从根到目标任务的路径）
    pub async fn get_task_path(&self, tree_id: &str, task_id: &str) -> Vec<TaskNode> {
        let trees = self.task_trees.read().await;
        let tree = match trees.get(tree_id) {
            Some(t) => t,
            None => return Vec::new(),
        };

        let mut path = Vec::new();
        Self::find_task_path(&tree.root, task_id, &mut path);
        path
    }

    fn find_task_path(node: &TaskNode, task_id: &str, path: &mut Vec<TaskNode>) -> bool {
        path.push(node.clone());

        if node.id == task_id {
            return true;
        }

        for child in &node.children {
            if Self::find_task_path(child, task_id, path) {
                return true;
            }
        }

        path.pop();
        false
    }

    /// 获取所有叶子任务
    pub async fn get_leaf_tasks(&self, tree_id: &str) -> Vec<TaskNode> {
        let trees = self.task_trees.read().await;
        let tree = match trees.get(tree_id) {
            Some(t) => t,
            None => return Vec::new(),
        };

        let mut leaves = Vec::new();
        Self::collect_leaf_tasks(&tree.root, &mut leaves);
        leaves
    }

    fn collect_leaf_tasks(node: &TaskNode, result: &mut Vec<TaskNode>) {
        if node.children.is_empty() {
            result.push(node.clone());
        } else {
            for child in &node.children {
                Self::collect_leaf_tasks(child, result);
            }
        }
    }
}

impl Default for TaskTreeManager {
    fn default() -> Self {
        Self::with_default_dir()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_generate_from_blueprint() {
        let manager = TaskTreeManager::default();

        let mut blueprint = Blueprint::new("测试项目".to_string(), "测试描述".to_string());

        blueprint.modules.push(SystemModule {
            id: Uuid::new_v4().to_string(),
            name: "后端模块".to_string(),
            description: "后端服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["用户认证".to_string(), "数据存储".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/backend".to_string()),
        });

        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        assert_eq!(tree.blueprint_id, blueprint.id);
        assert!(!tree.root.children.is_empty());
        assert!(tree.stats.total_tasks > 0);
    }

    #[tokio::test]
    async fn test_task_status_update() {
        let manager = TaskTreeManager::default();

        let blueprint = Blueprint::new("测试".to_string(), "描述".to_string());
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        // 获取第一个叶子任务
        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let updated = manager
                .update_task_status(&tree.id, &leaf.id, TaskStatus::Coding)
                .await
                .unwrap();

            assert_eq!(updated.status, TaskStatus::Coding);
            assert!(updated.started_at.is_some());
        }
    }
}
