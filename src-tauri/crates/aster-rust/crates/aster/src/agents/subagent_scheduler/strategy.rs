//! 调度策略模块
//!
//! 根据任务特征自动选择最优调度策略

use serde::{Deserialize, Serialize};

use super::types::SubAgentTask;

/// 调度策略
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SchedulingStrategy {
    /// 单 Agent 直接执行（简单任务）
    SingleAgent,
    /// 串行执行（有依赖的任务）
    Sequential,
    /// 并行执行（独立任务）
    Parallel,
    /// 广度优先并行（研究任务）
    BreadthFirst,
    /// 自适应（根据任务特征自动选择）
    #[default]
    Adaptive,
}

/// 任务复杂度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskComplexity {
    /// 简单任务（单次 LLM 调用）
    Simple,
    /// 中等任务（需要多步骤）
    Medium,
    /// 复杂任务（需要多个子任务）
    Complex,
    /// 研究任务（需要广泛探索）
    Research,
}

/// 策略选择器
pub struct StrategySelector;

impl StrategySelector {
    /// 根据任务列表自动选择策略
    pub fn select(tasks: &[SubAgentTask]) -> SchedulingStrategy {
        if tasks.is_empty() {
            return SchedulingStrategy::SingleAgent;
        }

        if tasks.len() == 1 {
            return SchedulingStrategy::SingleAgent;
        }

        // 检查是否有依赖关系
        let has_dependencies = tasks.iter().any(|t| t.has_dependencies());

        // 检查任务类型分布
        let task_types: Vec<&str> = tasks.iter().map(|t| t.task_type.as_str()).collect();
        let is_research = task_types
            .iter()
            .any(|t| matches!(*t, "research" | "explore" | "search" | "analyze"));

        // 检查是否高度可并行化
        let parallelizable_ratio = if has_dependencies {
            let independent_count = tasks.iter().filter(|t| !t.has_dependencies()).count();
            independent_count as f64 / tasks.len() as f64
        } else {
            1.0
        };

        // 策略选择逻辑
        if is_research && parallelizable_ratio > 0.7 {
            SchedulingStrategy::BreadthFirst
        } else if has_dependencies && parallelizable_ratio < 0.3 {
            SchedulingStrategy::Sequential
        } else if parallelizable_ratio > 0.5 {
            SchedulingStrategy::Parallel
        } else {
            SchedulingStrategy::Sequential
        }
    }

    /// 估算任务复杂度
    pub fn estimate_complexity(task: &SubAgentTask) -> TaskComplexity {
        // 基于任务类型估算
        let type_complexity = match task.task_type.as_str() {
            "explore" | "search" => TaskComplexity::Simple,
            "analyze" | "review" => TaskComplexity::Medium,
            "code" | "implement" => TaskComplexity::Complex,
            "research" | "investigate" => TaskComplexity::Research,
            _ => TaskComplexity::Medium,
        };

        // 基于 prompt 长度调整
        let prompt_len = task.prompt.len();
        if prompt_len > 1000 {
            match type_complexity {
                TaskComplexity::Simple => TaskComplexity::Medium,
                TaskComplexity::Medium => TaskComplexity::Complex,
                _ => type_complexity,
            }
        } else {
            type_complexity
        }
    }

    /// 根据复杂度推荐并发数
    pub fn recommended_concurrency(complexity: TaskComplexity) -> usize {
        match complexity {
            TaskComplexity::Simple => 10,
            TaskComplexity::Medium => 5,
            TaskComplexity::Complex => 3,
            TaskComplexity::Research => 8,
        }
    }

    /// 根据复杂度推荐模型
    pub fn recommended_model(complexity: TaskComplexity) -> &'static str {
        match complexity {
            TaskComplexity::Simple => "haiku",
            TaskComplexity::Medium => "sonnet",
            TaskComplexity::Complex => "opus",
            TaskComplexity::Research => "sonnet",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_single_task() {
        let tasks = vec![SubAgentTask::new("t1", "explore", "分析")];
        assert_eq!(
            StrategySelector::select(&tasks),
            SchedulingStrategy::SingleAgent
        );
    }

    #[test]
    fn test_select_parallel_tasks() {
        // 使用 code 类型，避免被识别为研究任务
        let tasks = vec![
            SubAgentTask::new("t1", "code", "实现1"),
            SubAgentTask::new("t2", "code", "实现2"),
            SubAgentTask::new("t3", "code", "实现3"),
        ];
        assert_eq!(
            StrategySelector::select(&tasks),
            SchedulingStrategy::Parallel
        );
    }

    #[test]
    fn test_select_sequential_tasks() {
        let tasks = vec![
            SubAgentTask::new("t1", "code", "实现1"),
            SubAgentTask::new("t2", "code", "实现2").with_dependencies(vec!["t1"]),
            SubAgentTask::new("t3", "code", "实现3").with_dependencies(vec!["t2"]),
        ];
        assert_eq!(
            StrategySelector::select(&tasks),
            SchedulingStrategy::Sequential
        );
    }

    #[test]
    fn test_select_research_tasks() {
        let tasks = vec![
            SubAgentTask::new("t1", "research", "研究1"),
            SubAgentTask::new("t2", "research", "研究2"),
            SubAgentTask::new("t3", "research", "研究3"),
        ];
        assert_eq!(
            StrategySelector::select(&tasks),
            SchedulingStrategy::BreadthFirst
        );
    }

    #[test]
    fn test_estimate_complexity() {
        let simple = SubAgentTask::new("t1", "explore", "简单任务");
        let complex = SubAgentTask::new("t2", "code", "复杂任务");

        assert_eq!(
            StrategySelector::estimate_complexity(&simple),
            TaskComplexity::Simple
        );
        assert_eq!(
            StrategySelector::estimate_complexity(&complex),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn test_recommended_model() {
        assert_eq!(
            StrategySelector::recommended_model(TaskComplexity::Simple),
            "haiku"
        );
        assert_eq!(
            StrategySelector::recommended_model(TaskComplexity::Complex),
            "opus"
        );
    }
}
