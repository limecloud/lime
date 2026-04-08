//! 任务粒度自动控制机制
//!
//! 功能：
//! 1. 评估任务复杂度
//! 2. 检查任务是否需要拆分（过粗）
//! 3. 检查任务是否需要合并（过细）
//! 4. 自动调整任务树粒度
//!
//! 目标：
//! - 避免任务过细（219 任务 vs 8 模块）
//! - 避免任务过粗（无法并行执行）
//! - 保持任务粒度适中（便于 TDD 循环）
//!

use super::types::{SystemModule, TaskNode, TaskTree};

// ============================================================================
// 配置接口
// ============================================================================

/// 粒度控制配置
#[derive(Debug, Clone)]
pub struct GranularityConfig {
    /// 最小复杂度（低于此值需要合并）
    pub min_task_complexity: f64,
    /// 最大复杂度（高于此值需要拆分）
    pub max_task_complexity: f64,
    /// 理想执行时间（分钟）
    pub ideal_task_duration: u32,
    /// 最小执行时间（分钟）
    pub min_task_duration: u32,
    /// 最大执行时间（分钟）
    pub max_task_duration: u32,
    /// 最大树深度
    pub max_depth: u32,
    /// 最小树深度
    pub min_depth: u32,
    /// 单节点最大子任务数
    pub max_children_per_node: u32,
    /// 单节点最小子任务数
    pub min_children_per_node: u32,
    /// 每个任务预计的代码行数
    pub estimated_lines_per_task: u32,
    /// 每个任务最大代码行数
    pub max_lines_per_task: u32,
    /// 每个任务最小代码行数
    pub min_lines_per_task: u32,
}

impl Default for GranularityConfig {
    fn default() -> Self {
        Self {
            min_task_complexity: 15.0,
            max_task_complexity: 75.0,
            ideal_task_duration: 30,
            min_task_duration: 10,
            max_task_duration: 120,
            max_depth: 5,
            min_depth: 2,
            max_children_per_node: 10,
            min_children_per_node: 2,
            estimated_lines_per_task: 100,
            max_lines_per_task: 300,
            min_lines_per_task: 20,
        }
    }
}

// ============================================================================
// 复杂度评分
// ============================================================================

/// 复杂度因子
#[derive(Debug, Clone, Default)]
pub struct ComplexityFactors {
    /// 代码量因子（0-1）
    pub code_size: f64,
    /// 依赖复杂度（0-1）
    pub dependencies: f64,
    /// 接口复杂度（0-1）
    pub interfaces: f64,
    /// 测试覆盖度（0-1）
    pub test_coverage: f64,
    /// 描述长度因子（0-1）
    pub description_length: f64,
    /// 子任务数量因子（0-1）
    pub children_count: f64,
}

/// 复杂度权重
#[derive(Debug, Clone)]
pub struct ComplexityWeights {
    pub code_size: f64,
    pub dependencies: f64,
    pub interfaces: f64,
    pub test_coverage: f64,
    pub description_length: f64,
    pub children_count: f64,
}

impl Default for ComplexityWeights {
    fn default() -> Self {
        Self {
            code_size: 0.3,
            dependencies: 0.2,
            interfaces: 0.15,
            test_coverage: 0.15,
            description_length: 0.1,
            children_count: 0.1,
        }
    }
}

/// 诊断信息
#[derive(Debug, Clone, Default)]
pub struct ComplexityDiagnostic {
    /// 估算的代码行数
    pub estimated_lines: u32,
    /// 估算的执行时间（分钟）
    pub estimated_duration: u32,
    /// 有依赖
    pub has_dependencies: bool,
    /// 有接口
    pub has_interfaces: bool,
    /// 有测试
    pub has_tests: bool,
    /// 树深度
    pub depth: u32,
    /// 子任务数
    pub children_count: usize,
}

/// 复杂度评分
#[derive(Debug, Clone)]
pub struct ComplexityScore {
    /// 总分（0-100）
    pub total: f64,
    /// 细分因子
    pub factors: ComplexityFactors,
    /// 权重配置
    pub weights: ComplexityWeights,
    /// 诊断信息
    pub diagnostic: ComplexityDiagnostic,
}

// ============================================================================
// 拆分/合并建议
// ============================================================================

/// 拆分策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitStrategy {
    /// 按功能拆分
    ByFunction,
    /// 按层次拆分
    ByLayer,
    /// 按依赖拆分
    ByDependency,
    /// 按接口拆分
    ByInterface,
}

/// 拆分建议项
#[derive(Debug, Clone)]
pub struct SuggestedSplit {
    pub name: String,
    pub description: String,
    pub strategy: SplitStrategy,
}

/// 拆分建议
#[derive(Debug, Clone)]
pub struct SplitSuggestion {
    pub task_id: String,
    pub task_name: String,
    pub reason: String,
    pub complexity: f64,
    pub suggested_splits: Vec<SuggestedSplit>,
}

/// 合并策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeStrategy {
    /// 相关功能合并
    RelatedFunctions,
    /// 简单批量合并
    SimpleBatch,
    /// 同文件合并
    SameFile,
}

/// 合并建议
#[derive(Debug, Clone)]
pub struct MergeSuggestion {
    pub task_ids: Vec<String>,
    pub task_names: Vec<String>,
    pub reason: String,
    pub avg_complexity: f64,
    pub suggested_name: String,
    pub suggested_description: String,
    pub strategy: MergeStrategy,
}

/// 问题严重程度
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueSeverity {
    High,
    Medium,
    Low,
}

/// 问题类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueType {
    TooDeep,
    TooShallow,
    TooManyChildren,
    TooFewChildren,
    Unbalanced,
}

/// 结构问题
#[derive(Debug, Clone)]
pub struct StructureIssue {
    pub issue_type: IssueType,
    pub task_id: Option<String>,
    pub task_name: Option<String>,
    pub description: String,
    pub severity: IssueSeverity,
}

/// 调整统计信息
#[derive(Debug, Clone, Default)]
pub struct AdjustmentStats {
    pub total_tasks: u32,
    pub too_simple: u32,
    pub too_complex: u32,
    pub just_right: u32,
    pub avg_complexity: f64,
    pub avg_depth: f64,
    pub max_depth: u32,
    pub avg_children: f64,
    pub max_children: u32,
}

/// 调整结果
#[derive(Debug, Clone, Default)]
pub struct AdjustmentResult {
    /// 是否需要调整
    pub needs_adjustment: bool,
    /// 拆分建议
    pub split_suggestions: Vec<SplitSuggestion>,
    /// 合并建议
    pub merge_suggestions: Vec<MergeSuggestion>,
    /// 统计信息
    pub stats: AdjustmentStats,
    /// 诊断问题
    pub issues: Vec<StructureIssue>,
}

// ============================================================================
// 任务粒度控制器
// ============================================================================

/// 任务粒度控制器
pub struct TaskGranularityController {
    config: GranularityConfig,
}

impl TaskGranularityController {
    /// 创建新的控制器
    pub fn new(config: GranularityConfig) -> Self {
        Self { config }
    }

    /// 更新配置
    pub fn update_config(&mut self, config: GranularityConfig) {
        self.config = config;
    }

    /// 获取当前配置
    pub fn config(&self) -> &GranularityConfig {
        &self.config
    }

    // --------------------------------------------------------------------------
    // 复杂度评估
    // --------------------------------------------------------------------------

    /// 评估任务复杂度
    pub fn assess_complexity(
        &self,
        task: &TaskNode,
        module: Option<&SystemModule>,
    ) -> ComplexityScore {
        let factors = ComplexityFactors {
            code_size: self.assess_code_size_factor(task, module),
            dependencies: self.assess_dependencies_factor(task, module),
            interfaces: self.assess_interfaces_factor(module),
            test_coverage: self.assess_test_coverage_factor(task),
            description_length: self.assess_description_length_factor(task),
            children_count: self.assess_children_count_factor(task),
        };

        let weights = ComplexityWeights::default();
        let total = factors.code_size * weights.code_size
            + factors.dependencies * weights.dependencies
            + factors.interfaces * weights.interfaces
            + factors.test_coverage * weights.test_coverage
            + factors.description_length * weights.description_length
            + factors.children_count * weights.children_count;

        let estimated_lines = self.estimate_code_lines(task, module);
        let estimated_duration = self.estimate_duration(estimated_lines, &factors);

        ComplexityScore {
            total: (total * 100.0 * 100.0).round() / 100.0,
            factors,
            weights,
            diagnostic: ComplexityDiagnostic {
                estimated_lines,
                estimated_duration,
                has_dependencies: !task.dependencies.is_empty(),
                has_interfaces: module.is_some_and(|m| !m.interfaces.is_empty()),
                has_tests: !task.acceptance_tests.is_empty() || task.test_spec.is_some(),
                depth: task.depth,
                children_count: task.children.len(),
            },
        }
    }

    /// 代码量因子（0-1）
    fn assess_code_size_factor(&self, task: &TaskNode, module: Option<&SystemModule>) -> f64 {
        let estimated_lines = self.estimate_code_lines(task, module) as f64;
        let normalized = estimated_lines / self.config.estimated_lines_per_task as f64;
        (1.0 / (1.0 + (-2.0 * (normalized - 1.0)).exp())).min(1.0)
    }

    /// 依赖复杂度因子（0-1）
    fn assess_dependencies_factor(&self, task: &TaskNode, module: Option<&SystemModule>) -> f64 {
        let task_deps = task.dependencies.len();
        let module_deps = module.map_or(0, |m| m.dependencies.len());
        let total_deps = task_deps + module_deps;
        (total_deps as f64 / 10.0).min(1.0)
    }

    /// 接口复杂度因子（0-1）
    fn assess_interfaces_factor(&self, module: Option<&SystemModule>) -> f64 {
        module.map_or(0.0, |m| (m.interfaces.len() as f64 / 6.0).min(1.0))
    }

    /// 测试覆盖度因子（0-1）
    fn assess_test_coverage_factor(&self, task: &TaskNode) -> f64 {
        let test_factor = (task.acceptance_tests.len() as f64 / 6.0).min(1.0);
        let has_test_spec = if task.test_spec.is_some() { 0.2 } else { 0.0 };
        (test_factor + has_test_spec).min(1.0)
    }

    /// 描述长度因子（0-1）
    fn assess_description_length_factor(&self, task: &TaskNode) -> f64 {
        (task.description.len() as f64 / 300.0).min(1.0)
    }

    /// 子任务数量因子（0-1）
    fn assess_children_count_factor(&self, task: &TaskNode) -> f64 {
        if task.children.is_empty() {
            0.3
        } else {
            0.3 + (task.children.len() as f64 / 10.0 * 0.7).min(0.7)
        }
    }

    /// 估算代码行数
    fn estimate_code_lines(&self, task: &TaskNode, module: Option<&SystemModule>) -> u32 {
        let mut base_lines = self.config.estimated_lines_per_task as f64;

        // 根据任务类型调整
        if task.name.contains("设计") {
            base_lines *= 0.3;
        } else if task.name.contains("测试") {
            base_lines *= 0.6;
        } else if task.name.contains("实现") || task.name.contains("功能") {
            base_lines *= 1.2;
        } else if task.name.contains("接口") {
            base_lines *= 0.8;
        }

        // 根据模块类型调整
        if let Some(m) = module {
            match m.module_type {
                super::types::ModuleType::Frontend => base_lines *= 1.3,
                super::types::ModuleType::Backend => base_lines *= 1.1,
                super::types::ModuleType::Database => base_lines *= 0.7,
                _ => {}
            }
        }

        // 根据依赖数量调整
        let dep_multiplier = 1.0 + (task.dependencies.len() as f64 * 0.1);
        base_lines *= dep_multiplier;

        // 根据描述长度调整
        let desc_multiplier = (1.0 + task.description.len() as f64 / 1000.0).min(1.5);
        base_lines *= desc_multiplier;

        base_lines.round() as u32
    }

    /// 估算执行时间（分钟）
    fn estimate_duration(&self, estimated_lines: u32, factors: &ComplexityFactors) -> u32 {
        let mut duration = estimated_lines as f64 / 10.0;
        duration *= 1.0 + (factors.dependencies * 0.5);
        duration *= 1.0 + (factors.interfaces * 0.3);
        duration *= 1.0 + (factors.test_coverage * 0.4);
        duration.round() as u32
    }

    // --------------------------------------------------------------------------
    // 拆分/合并判断
    // --------------------------------------------------------------------------

    /// 检查任务是否需要拆分
    pub fn should_split(&self, task: &TaskNode, module: Option<&SystemModule>) -> SplitCheck {
        let score = self.assess_complexity(task, module);

        // 情况 1：复杂度过高
        if score.total > self.config.max_task_complexity {
            return SplitCheck {
                should_split: true,
                reason: format!(
                    "任务复杂度过高（{:.1} > {}）",
                    score.total, self.config.max_task_complexity
                ),
                complexity: score.total,
            };
        }

        // 情况 2：估算时间过长
        if score.diagnostic.estimated_duration > self.config.max_task_duration {
            return SplitCheck {
                should_split: true,
                reason: format!(
                    "估算执行时间过长（{} 分钟 > {} 分钟）",
                    score.diagnostic.estimated_duration, self.config.max_task_duration
                ),
                complexity: score.total,
            };
        }

        // 情况 3：子任务过多
        if task.children.len() as u32 > self.config.max_children_per_node {
            return SplitCheck {
                should_split: true,
                reason: format!(
                    "子任务数量过多（{} > {}）",
                    task.children.len(),
                    self.config.max_children_per_node
                ),
                complexity: score.total,
            };
        }

        // 情况 4：深度不够但任务复杂
        if task.depth < self.config.min_depth && score.total > 50.0 && task.children.is_empty() {
            return SplitCheck {
                should_split: true,
                reason: format!(
                    "任务深度不够且复杂度较高（depth={}, complexity={:.1}）",
                    task.depth, score.total
                ),
                complexity: score.total,
            };
        }

        SplitCheck {
            should_split: false,
            reason: "任务粒度合适".to_string(),
            complexity: score.total,
        }
    }
}

/// 拆分检查结果
#[derive(Debug, Clone)]
pub struct SplitCheck {
    pub should_split: bool,
    pub reason: String,
    pub complexity: f64,
}

impl TaskGranularityController {
    /// 检查任务列表是否需要合并
    pub fn should_merge(&self, tasks: &[TaskNode], modules: Option<&[SystemModule]>) -> MergeCheck {
        if tasks.len() < 2 {
            return MergeCheck {
                should_merge: false,
                reason: "任务数量不足 2 个".to_string(),
                task_ids: Vec::new(),
            };
        }

        // 检查是否是兄弟任务
        let parent_ids: std::collections::HashSet<_> =
            tasks.iter().filter_map(|t| t.parent_id.clone()).collect();
        if parent_ids.len() > 1 {
            return MergeCheck {
                should_merge: false,
                reason: "任务不是兄弟节点".to_string(),
                task_ids: Vec::new(),
            };
        }

        // 计算平均复杂度
        let complexities: Vec<_> = tasks
            .iter()
            .map(|t| {
                let module = modules.and_then(|ms| {
                    ms.iter()
                        .find(|m| Some(&m.id) == t.blueprint_module_id.as_ref())
                });
                self.assess_complexity(t, module)
            })
            .collect();

        let avg_complexity =
            complexities.iter().map(|s| s.total).sum::<f64>() / complexities.len() as f64;

        // 情况 1：所有任务复杂度都很低
        if avg_complexity < self.config.min_task_complexity {
            let too_simple: Vec<_> = tasks
                .iter()
                .zip(complexities.iter())
                .filter(|(_, s)| s.total < self.config.min_task_complexity)
                .map(|(t, _)| t.id.clone())
                .collect();

            if too_simple.len() >= 2 {
                return MergeCheck {
                    should_merge: true,
                    reason: format!(
                        "多个任务复杂度过低（平均 {:.1} < {}）",
                        avg_complexity, self.config.min_task_complexity
                    ),
                    task_ids: too_simple,
                };
            }
        }

        // 情况 2：任务数量过多且平均复杂度低
        if tasks.len() as u32 > self.config.max_children_per_node && avg_complexity < 30.0 {
            return MergeCheck {
                should_merge: true,
                reason: format!(
                    "任务数量过多（{} > {}）且复杂度较低",
                    tasks.len(),
                    self.config.max_children_per_node
                ),
                task_ids: tasks.iter().map(|t| t.id.clone()).collect(),
            };
        }

        MergeCheck {
            should_merge: false,
            reason: "任务粒度合适".to_string(),
            task_ids: Vec::new(),
        }
    }
}

/// 合并检查结果
#[derive(Debug, Clone)]
pub struct MergeCheck {
    pub should_merge: bool,
    pub reason: String,
    pub task_ids: Vec<String>,
}

impl TaskGranularityController {
    // --------------------------------------------------------------------------
    // 自动调整
    // --------------------------------------------------------------------------

    /// 自动调整任务树粒度
    pub fn auto_adjust(
        &self,
        tree: &TaskTree,
        modules: Option<&[SystemModule]>,
    ) -> AdjustmentResult {
        let mut result = AdjustmentResult::default();

        // 收集所有任务
        let mut all_tasks = Vec::new();
        self.collect_all_tasks(&tree.root, &mut all_tasks);

        let mut total_complexity = 0.0;
        let mut total_depth = 0u32;
        let mut total_children = 0usize;

        for task in &all_tasks {
            let module = modules.and_then(|ms| {
                ms.iter()
                    .find(|m| Some(&m.id) == task.blueprint_module_id.as_ref())
            });
            let complexity = self.assess_complexity(task, module);

            total_complexity += complexity.total;
            total_depth += task.depth;
            total_children += task.children.len();

            // 统计复杂度分布
            if complexity.total < self.config.min_task_complexity {
                result.stats.too_simple += 1;
            } else if complexity.total > self.config.max_task_complexity {
                result.stats.too_complex += 1;
            } else {
                result.stats.just_right += 1;
            }

            // 更新最大值
            if task.depth > result.stats.max_depth {
                result.stats.max_depth = task.depth;
            }
            if task.children.len() as u32 > result.stats.max_children {
                result.stats.max_children = task.children.len() as u32;
            }

            // 检查是否需要拆分
            let split_check = self.should_split(task, module);
            if split_check.should_split {
                result
                    .split_suggestions
                    .push(self.generate_split_suggestion(task, module, &split_check));
            }
        }

        // 计算统计信息
        let task_count = all_tasks.len() as f64;
        result.stats.total_tasks = all_tasks.len() as u32;
        result.stats.avg_complexity = total_complexity / task_count;
        result.stats.avg_depth = total_depth as f64 / task_count;
        result.stats.avg_children = total_children as f64 / task_count;

        // 检测结构问题
        self.detect_structure_issues(&result.stats, &mut result.issues);

        // 判断是否需要调整
        result.needs_adjustment = !result.split_suggestions.is_empty()
            || !result.merge_suggestions.is_empty()
            || result
                .issues
                .iter()
                .any(|i| i.severity == IssueSeverity::High);

        result
    }

    /// 收集所有任务
    fn collect_all_tasks<'a>(&self, node: &'a TaskNode, result: &mut Vec<&'a TaskNode>) {
        result.push(node);
        for child in &node.children {
            self.collect_all_tasks(child, result);
        }
    }

    /// 生成拆分建议
    fn generate_split_suggestion(
        &self,
        task: &TaskNode,
        module: Option<&SystemModule>,
        split_check: &SplitCheck,
    ) -> SplitSuggestion {
        let mut suggested_splits = Vec::new();

        // 策略 1：按功能点拆分
        if task.description.contains("和") || task.description.contains("及") {
            suggested_splits.push(SuggestedSplit {
                name: format!("{} - 功能A", task.name),
                description: "拆分为独立的功能点".to_string(),
                strategy: SplitStrategy::ByFunction,
            });
            suggested_splits.push(SuggestedSplit {
                name: format!("{} - 功能B", task.name),
                description: "拆分为独立的功能点".to_string(),
                strategy: SplitStrategy::ByFunction,
            });
        }

        // 策略 2：按层次拆分
        if let Some(m) = module {
            match m.module_type {
                super::types::ModuleType::Frontend => {
                    suggested_splits.push(SuggestedSplit {
                        name: format!("{} - UI组件", task.name),
                        description: "实现用户界面组件".to_string(),
                        strategy: SplitStrategy::ByLayer,
                    });
                    suggested_splits.push(SuggestedSplit {
                        name: format!("{} - 业务逻辑", task.name),
                        description: "实现业务逻辑处理".to_string(),
                        strategy: SplitStrategy::ByLayer,
                    });
                }
                super::types::ModuleType::Backend => {
                    suggested_splits.push(SuggestedSplit {
                        name: format!("{} - API接口", task.name),
                        description: "实现 API 接口定义".to_string(),
                        strategy: SplitStrategy::ByLayer,
                    });
                    suggested_splits.push(SuggestedSplit {
                        name: format!("{} - 业务逻辑", task.name),
                        description: "实现核心业务逻辑".to_string(),
                        strategy: SplitStrategy::ByLayer,
                    });
                }
                _ => {}
            }
        }

        // 如果没有特定的拆分策略，提供通用拆分
        if suggested_splits.is_empty() {
            suggested_splits.push(SuggestedSplit {
                name: format!("{} - 第一部分", task.name),
                description: "拆分任务的第一部分".to_string(),
                strategy: SplitStrategy::ByFunction,
            });
            suggested_splits.push(SuggestedSplit {
                name: format!("{} - 第二部分", task.name),
                description: "拆分任务的第二部分".to_string(),
                strategy: SplitStrategy::ByFunction,
            });
        }

        SplitSuggestion {
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            reason: split_check.reason.clone(),
            complexity: split_check.complexity,
            suggested_splits: suggested_splits.into_iter().take(5).collect(),
        }
    }

    /// 检测树结构问题
    fn detect_structure_issues(&self, stats: &AdjustmentStats, issues: &mut Vec<StructureIssue>) {
        // 检查树深度
        if stats.max_depth > self.config.max_depth {
            issues.push(StructureIssue {
                issue_type: IssueType::TooDeep,
                task_id: None,
                task_name: None,
                description: format!(
                    "任务树过深（{} > {}），建议减少层级",
                    stats.max_depth, self.config.max_depth
                ),
                severity: IssueSeverity::High,
            });
        } else if stats.max_depth < self.config.min_depth {
            issues.push(StructureIssue {
                issue_type: IssueType::TooShallow,
                task_id: None,
                task_name: None,
                description: format!(
                    "任务树过浅（{} < {}），建议增加细化",
                    stats.max_depth, self.config.min_depth
                ),
                severity: IssueSeverity::Medium,
            });
        }

        // 检查子任务数量
        if stats.max_children > self.config.max_children_per_node {
            issues.push(StructureIssue {
                issue_type: IssueType::TooManyChildren,
                task_id: None,
                task_name: None,
                description: format!(
                    "某些节点子任务过多（最多 {} > {}）",
                    stats.max_children, self.config.max_children_per_node
                ),
                severity: IssueSeverity::High,
            });
        }

        // 检查粒度问题
        if stats.too_simple > stats.total_tasks * 30 / 100 {
            issues.push(StructureIssue {
                issue_type: IssueType::TooShallow,
                task_id: None,
                task_name: None,
                description: format!(
                    "{} 个任务（{}%）复杂度过低，建议合并",
                    stats.too_simple,
                    stats.too_simple * 100 / stats.total_tasks
                ),
                severity: IssueSeverity::High,
            });
        }

        if stats.too_complex > stats.total_tasks * 20 / 100 {
            issues.push(StructureIssue {
                issue_type: IssueType::TooDeep,
                task_id: None,
                task_name: None,
                description: format!(
                    "{} 个任务（{}%）复杂度过高，建议拆分",
                    stats.too_complex,
                    stats.too_complex * 100 / stats.total_tasks
                ),
                severity: IssueSeverity::High,
            });
        }
    }
}

impl Default for TaskGranularityController {
    fn default() -> Self {
        Self::new(GranularityConfig::default())
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建任务粒度控制器
pub fn create_task_granularity_controller(
    config: Option<GranularityConfig>,
) -> TaskGranularityController {
    TaskGranularityController::new(config.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = GranularityConfig::default();
        assert_eq!(config.min_task_complexity, 15.0);
        assert_eq!(config.max_task_complexity, 75.0);
        assert_eq!(config.ideal_task_duration, 30);
    }

    #[test]
    fn test_complexity_weights_default() {
        let weights = ComplexityWeights::default();
        let total = weights.code_size
            + weights.dependencies
            + weights.interfaces
            + weights.test_coverage
            + weights.description_length
            + weights.children_count;
        assert!((total - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_assess_complexity() {
        let controller = TaskGranularityController::default();
        let task = TaskNode::new(
            "测试任务".to_string(),
            "这是一个测试任务描述".to_string(),
            1,
        );

        let score = controller.assess_complexity(&task, None);

        assert!(score.total >= 0.0);
        assert!(score.total <= 100.0);
        assert_eq!(score.diagnostic.depth, 1);
    }

    #[test]
    fn test_should_split_simple_task() {
        let controller = TaskGranularityController::default();
        let task = TaskNode::new("简单任务".to_string(), "描述".to_string(), 2);

        let check = controller.should_split(&task, None);

        assert!(!check.should_split);
    }

    #[test]
    fn test_should_merge_few_tasks() {
        let controller = TaskGranularityController::default();
        let task = TaskNode::new("任务".to_string(), "描述".to_string(), 1);

        let check = controller.should_merge(&[task], None);

        assert!(!check.should_merge);
        assert_eq!(check.reason, "任务数量不足 2 个");
    }
}
