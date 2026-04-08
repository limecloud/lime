//! Agent 协调器
//!
//!
//! 实现蜂王-蜜蜂协作模型：
//! - 主 Agent（蜂王）：全局视野，负责任务分配和协调
//! - 子 Agent（蜜蜂）：在各自的树枝上工作，执行具体任务

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use super::blueprint_manager::BlueprintManager;
use super::task_tree_manager::TaskTreeManager;
use super::types::*;

// ============================================================================
// 协调器配置
// ============================================================================

/// 协调器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoordinatorConfig {
    /// 最大并发 Worker 数量
    pub max_concurrent_workers: usize,
    /// Worker 任务超时时间（毫秒）
    pub worker_timeout: u64,
    /// 主循环间隔（毫秒）
    pub main_loop_interval: u64,
    /// 是否自动分配任务
    pub auto_assign_tasks: bool,
    /// Worker 模型选择策略
    pub model_strategy: ModelStrategy,
    /// 默认 Worker 模型
    pub default_worker_model: String,
}

impl Default for CoordinatorConfig {
    fn default() -> Self {
        Self {
            max_concurrent_workers: 5,
            worker_timeout: 300000,   // 5 分钟
            main_loop_interval: 5000, // 5 秒
            auto_assign_tasks: true,
            model_strategy: ModelStrategy::Adaptive,
            default_worker_model: "haiku".to_string(),
        }
    }
}

/// 模型选择策略
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStrategy {
    Fixed,
    Adaptive,
    RoundRobin,
}

// ============================================================================
// Agent 协调器
// ============================================================================

/// Agent 协调器
pub struct AgentCoordinator {
    config: CoordinatorConfig,
    queen: Option<QueenAgent>,
    workers: HashMap<String, WorkerAgent>,
    timeline: Vec<TimelineEvent>,
    is_running: bool,
}

impl Default for AgentCoordinator {
    fn default() -> Self {
        Self::new(CoordinatorConfig::default())
    }
}

impl AgentCoordinator {
    /// 创建新的协调器
    pub fn new(config: CoordinatorConfig) -> Self {
        Self {
            config,
            queen: None,
            workers: HashMap::new(),
            timeline: Vec::new(),
            is_running: false,
        }
    }

    // ------------------------------------------------------------------------
    // 蜂王初始化
    // ------------------------------------------------------------------------

    /// 初始化蜂王 Agent
    pub async fn initialize_queen(
        &mut self,
        blueprint_manager: &mut BlueprintManager,
        tree_manager: &mut TaskTreeManager,
        blueprint_id: &str,
    ) -> Result<&QueenAgent, String> {
        let blueprint = blueprint_manager
            .get_blueprint(blueprint_id)
            .await
            .ok_or_else(|| format!("蓝图 {} 不存在", blueprint_id))?;

        if blueprint.status != BlueprintStatus::Approved
            && blueprint.status != BlueprintStatus::Executing
        {
            return Err(format!(
                "蓝图必须是已批准状态才能执行，当前状态: {:?}",
                blueprint.status
            ));
        }

        // 生成任务树（如果还没有）
        let task_tree_id = if let Some(ref tree_id) = blueprint.task_tree_id {
            if tree_manager.get_task_tree(tree_id).await.is_some() {
                tree_id.clone()
            } else {
                let tree = tree_manager
                    .generate_from_blueprint(&blueprint)
                    .await
                    .map_err(|e| e.to_string())?;
                blueprint_manager
                    .start_execution(blueprint_id, tree.id.clone())
                    .await
                    .map_err(|e| e.to_string())?;
                tree.id
            }
        } else {
            let tree = tree_manager
                .generate_from_blueprint(&blueprint)
                .await
                .map_err(|e| e.to_string())?;
            blueprint_manager
                .start_execution(blueprint_id, tree.id.clone())
                .await
                .map_err(|e| e.to_string())?;
            tree.id
        };

        // 构建全局上下文
        let tree = tree_manager.get_task_tree(&task_tree_id).await.unwrap();
        let global_context = self.build_global_context(&blueprint, &tree);

        // 创建蜂王
        let queen = QueenAgent {
            id: Uuid::new_v4().to_string(),
            blueprint_id: blueprint_id.to_string(),
            task_tree_id,
            status: QueenStatus::Idle,
            worker_agents: Vec::new(),
            global_context,
            decisions: Vec::new(),
        };

        self.add_timeline_event(
            TimelineEventType::TaskStart,
            "蜂王初始化完成".to_string(),
            None,
            Some(queen.id.clone()),
        );

        self.queen = Some(queen);
        Ok(self.queen.as_ref().unwrap())
    }

    // ------------------------------------------------------------------------
    // Worker 管理
    // ------------------------------------------------------------------------

    /// 创建 Worker Agent（蜜蜂）
    pub fn create_worker(&mut self, task_id: String) -> Result<&WorkerAgent, String> {
        let queen = self
            .queen
            .as_ref()
            .ok_or_else(|| "蜂王未初始化".to_string())?;

        // 检查并发限制
        let active_count = self
            .workers
            .values()
            .filter(|w| w.status != WorkerStatus::Idle)
            .count();

        if active_count >= self.config.max_concurrent_workers {
            return Err(format!(
                "已达到最大并发 Worker 数量: {}",
                self.config.max_concurrent_workers
            ));
        }

        let worker = WorkerAgent {
            id: Uuid::new_v4().to_string(),
            queen_id: queen.id.clone(),
            task_id: task_id.clone(),
            status: WorkerStatus::Idle,
            tdd_cycle: TddCycleState::default(),
            history: Vec::new(),
        };

        let worker_id = worker.id.clone();
        self.workers.insert(worker_id.clone(), worker);

        self.add_timeline_event(
            TimelineEventType::TaskStart,
            format!("Worker 创建: {}", worker_id),
            None,
            Some(worker_id.clone()),
        );

        Ok(self.workers.get(&worker_id).unwrap())
    }

    /// 分配任务给 Worker
    pub async fn assign_task(
        &mut self,
        tree_manager: &mut TaskTreeManager,
        worker_id: &str,
        task_id: &str,
    ) -> Result<(), String> {
        let queen = self
            .queen
            .as_ref()
            .ok_or_else(|| "蜂王未初始化".to_string())?;

        // 检查任务是否可以开始
        let (can_start, blockers) = tree_manager
            .can_start_task(&queen.task_tree_id, task_id)
            .await;
        if !can_start {
            return Err(format!(
                "任务 {} 无法开始: {}",
                task_id,
                blockers.join(", ")
            ));
        }

        // 更新 Worker 状态
        let worker = self
            .workers
            .get_mut(worker_id)
            .ok_or_else(|| format!("Worker {} 不存在", worker_id))?;

        worker.task_id = task_id.to_string();
        worker.status = WorkerStatus::TestWriting;

        // 记录决策
        self.record_decision(
            DecisionType::TaskAssignment,
            format!("分配任务 {} 给 Worker {}", task_id, worker_id),
            "根据优先级和依赖关系选择".to_string(),
        );

        self.add_timeline_event(
            TimelineEventType::TaskStart,
            format!("任务分配: {}", task_id),
            Some(task_id.to_string()),
            Some(worker_id.to_string()),
        );

        Ok(())
    }

    /// Worker 完成任务
    pub fn worker_complete_task(&mut self, worker_id: &str) -> Result<(), String> {
        let worker = self
            .workers
            .get_mut(worker_id)
            .ok_or_else(|| format!("Worker {} 不存在", worker_id))?;

        let task_id = worker.task_id.clone();
        worker.status = WorkerStatus::Idle;
        worker.tdd_cycle.test_passed = true;

        self.add_timeline_event(
            TimelineEventType::TaskComplete,
            format!("Worker 完成任务: {}", task_id),
            Some(task_id),
            Some(worker_id.to_string()),
        );

        Ok(())
    }

    /// Worker 任务失败
    pub fn worker_fail_task(&mut self, worker_id: &str, error: &str) -> Result<(), String> {
        let worker = self
            .workers
            .get_mut(worker_id)
            .ok_or_else(|| format!("Worker {} 不存在", worker_id))?;

        let task_id = worker.task_id.clone();
        worker.status = WorkerStatus::Idle;

        self.add_timeline_event(
            TimelineEventType::TestFail,
            format!("Worker 任务失败: {} - {}", task_id, error),
            Some(task_id),
            Some(worker_id.to_string()),
        );

        Ok(())
    }

    // ------------------------------------------------------------------------
    // 决策和时间线
    // ------------------------------------------------------------------------

    /// 记录蜂王决策
    pub fn record_decision(
        &mut self,
        decision_type: DecisionType,
        description: String,
        reasoning: String,
    ) {
        if let Some(ref mut queen) = self.queen {
            let decision = AgentDecision {
                id: Uuid::new_v4().to_string(),
                timestamp: Utc::now(),
                decision_type,
                description,
                reasoning,
                result: None,
            };
            queen.decisions.push(decision);
        }
    }

    /// 添加时间线事件
    pub fn add_timeline_event(
        &mut self,
        event_type: TimelineEventType,
        description: String,
        task_id: Option<String>,
        agent_id: Option<String>,
    ) {
        let event = TimelineEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            event_type,
            task_id,
            agent_id,
            description,
            data: None,
        };
        self.timeline.push(event);
    }

    /// 获取时间线
    pub fn get_timeline(&self) -> &[TimelineEvent] {
        &self.timeline
    }

    // ------------------------------------------------------------------------
    // 上下文构建
    // ------------------------------------------------------------------------

    /// 构建全局上下文
    fn build_global_context(&self, blueprint: &Blueprint, tree: &TaskTree) -> String {
        let mut lines = Vec::new();

        lines.push("# 项目全局上下文".to_string());
        lines.push(String::new());

        lines.push(format!(
            "## 蓝图: {} (v{})",
            blueprint.name, blueprint.version
        ));
        lines.push(blueprint.description.clone());
        lines.push(String::new());

        // 模块边界
        lines.push("## 模块边界（你必须严格遵守）".to_string());
        for module in &blueprint.modules {
            lines.push(format!("### {}", module.name));
            lines.push(format!("- 类型: {:?}", module.module_type));
            let responsibilities = module
                .responsibilities
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("、");
            lines.push(format!("- 职责: {}", responsibilities));
            if let Some(ref tech) = module.tech_stack {
                lines.push(format!("- 技术栈: {}", tech.join(" + ")));
            }
            let root = module
                .root_path
                .clone()
                .unwrap_or_else(|| format!("src/{}", module.name.to_lowercase()));
            lines.push(format!("- 根路径: {}", root));
            lines.push(String::new());
        }

        // 任务树统计
        lines.push("## 任务树统计".to_string());
        lines.push(format!("- 总任务数: {}", tree.stats.total_tasks));
        lines.push(format!("- 待执行: {}", tree.stats.pending_tasks));
        lines.push(format!("- 执行中: {}", tree.stats.running_tasks));
        lines.push(format!("- 已完成: {}", tree.stats.passed_tasks));
        lines.push(format!("- 进度: {:.1}%", tree.stats.progress_percentage));

        lines.join("\n")
    }

    // ------------------------------------------------------------------------
    // 查询方法
    // ------------------------------------------------------------------------

    /// 获取蜂王状态
    pub fn get_queen(&self) -> Option<&QueenAgent> {
        self.queen.as_ref()
    }

    /// 获取所有 Worker
    pub fn get_workers(&self) -> Vec<&WorkerAgent> {
        self.workers.values().collect()
    }

    /// 获取指定 Worker
    pub fn get_worker(&self, worker_id: &str) -> Option<&WorkerAgent> {
        self.workers.get(worker_id)
    }

    /// 获取空闲 Worker
    pub fn get_idle_workers(&self) -> Vec<&WorkerAgent> {
        self.workers
            .values()
            .filter(|w| w.status == WorkerStatus::Idle)
            .collect()
    }

    /// 获取活跃 Worker 数量
    pub fn get_active_worker_count(&self) -> usize {
        self.workers
            .values()
            .filter(|w| w.status != WorkerStatus::Idle)
            .count()
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.is_running
    }

    /// 获取配置
    pub fn get_config(&self) -> &CoordinatorConfig {
        &self.config
    }

    /// 更新配置
    pub fn update_config(&mut self, config: CoordinatorConfig) {
        self.config = config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coordinator_creation() {
        let coordinator = AgentCoordinator::default();
        assert!(coordinator.queen.is_none());
        assert!(coordinator.workers.is_empty());
        assert!(!coordinator.is_running());
    }

    #[test]
    fn test_config_defaults() {
        let config = CoordinatorConfig::default();
        assert_eq!(config.max_concurrent_workers, 5);
        assert_eq!(config.worker_timeout, 300000);
        assert!(config.auto_assign_tasks);
    }

    #[test]
    fn test_timeline_event() {
        let mut coordinator = AgentCoordinator::default();
        coordinator.add_timeline_event(
            TimelineEventType::TaskStart,
            "测试事件".to_string(),
            None,
            None,
        );

        assert_eq!(coordinator.get_timeline().len(), 1);
        assert_eq!(coordinator.get_timeline()[0].description, "测试事件");
    }
}
