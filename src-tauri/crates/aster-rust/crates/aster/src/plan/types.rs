//! Plan 模块类型定义
//!
//! 用于计划持久化、版本控制和多方案对比

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// 计划状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Pending,
    Approved,
    InProgress,
    Completed,
    Abandoned,
    Rejected,
}

/// 复杂度级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Complexity {
    Simple,
    Moderate,
    Complex,
    VeryComplex,
}

/// 步骤复杂度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepComplexity {
    Low,
    Medium,
    High,
}

/// 优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Medium,
    High,
    Critical,
}

/// 风险级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// 风险类别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskCategory {
    Technical,
    Architectural,
    Compatibility,
    Performance,
    Security,
    Maintainability,
}

/// 实现步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: u32,
    pub description: String,
    pub files: Vec<String>,
    pub complexity: StepComplexity,
    pub dependencies: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risks: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

/// 关键文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalFile {
    pub path: String,
    pub reason: String,
    pub importance: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_new: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

/// 风险评估
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Risk {
    pub category: RiskCategory,
    pub level: RiskLevel,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mitigation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probability: Option<RiskLevel>,
}

/// 替代方案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternative {
    pub name: String,
    pub description: String,
    pub pros: Vec<String>,
    pub cons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_for: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_complexity: Option<Complexity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_hours: Option<f32>,
}

/// 架构决策
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitecturalDecision {
    pub decision: String,
    pub chosen: String,
    pub alternatives: Vec<String>,
    pub rationale: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tradeoffs: Option<Tradeoffs>,
}

/// 权衡分析
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tradeoffs {
    pub benefits: Vec<String>,
    pub drawbacks: Vec<String>,
}

/// 需求分析结果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RequirementsAnalysis {
    pub functional_requirements: Vec<String>,
    pub non_functional_requirements: Vec<String>,
    pub technical_constraints: Vec<String>,
    pub success_criteria: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_of_scope: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assumptions: Option<Vec<String>>,
}

/// 计划元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMetadata {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: PlanStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub working_directory: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
}

/// 完整的计划数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPlan {
    pub metadata: PlanMetadata,
    pub summary: String,
    pub requirements_analysis: RequirementsAnalysis,
    pub architectural_decisions: Vec<ArchitecturalDecision>,
    pub steps: Vec<PlanStep>,
    pub critical_files: Vec<CriticalFile>,
    pub risks: Vec<Risk>,
    pub alternatives: Vec<Alternative>,
    pub estimated_complexity: Complexity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_hours: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendations: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_steps: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_hours: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

/// 计划列表选项
#[derive(Debug, Clone, Default)]
pub struct PlanListOptions {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub search: Option<String>,
    pub sort_by: Option<SortField>,
    pub sort_order: Option<SortOrder>,
    pub tags: Option<Vec<String>>,
    pub status: Option<Vec<PlanStatus>>,
    pub priority: Option<Vec<Priority>>,
    pub working_directory: Option<PathBuf>,
}

/// 排序字段
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortField {
    CreatedAt,
    UpdatedAt,
    Title,
    Priority,
    Status,
}

/// 排序顺序
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    Asc,
    Desc,
}

/// 计划统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlanStatistics {
    pub total_plans: usize,
    pub by_status: HashMap<String, usize>,
    pub by_priority: HashMap<String, usize>,
    pub by_tags: HashMap<String, usize>,
    pub average_steps: f32,
    pub average_estimated_hours: f32,
    pub average_actual_hours: f32,
    pub total_estimated_hours: f32,
    pub total_actual_hours: f32,
}

/// 计划对比标准
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonCriteria {
    pub name: String,
    pub description: String,
    pub weight: f32,
    pub score_range: (f32, f32),
}

/// 计划版本历史
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanVersion {
    pub version: u32,
    pub plan_id: String,
    pub created_at: u64,
    pub change_summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub is_current: bool,
}

/// 计划导出选项
#[derive(Debug, Clone)]
pub struct PlanExportOptions {
    pub format: ExportFormat,
    pub include_metadata: bool,
    pub include_risks: bool,
    pub include_alternatives: bool,
    pub include_decisions: bool,
}

/// 导出格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Json,
    Markdown,
    Html,
}

/// 计划模板
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_priority: Option<Priority>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predefined_steps: Option<Vec<PlanStep>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predefined_criteria: Option<Vec<ComparisonCriteria>>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 计划对比结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanComparison {
    pub plans: Vec<SavedPlan>,
    pub criteria: Vec<ComparisonCriteria>,
    pub scores: HashMap<String, HashMap<String, f32>>,
    pub total_scores: HashMap<String, f32>,
    pub recommended_plan_id: String,
    pub recommendation: String,
    pub analysis: ComparisonAnalysis,
    pub generated_at: u64,
}

/// 对比分析
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonAnalysis {
    pub strengths: HashMap<String, Vec<String>>,
    pub weaknesses: HashMap<String, Vec<String>>,
    pub risk_comparison: HashMap<String, Vec<Risk>>,
    pub complexity_comparison: HashMap<String, String>,
}

impl Default for PlanExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Markdown,
            include_metadata: true,
            include_risks: true,
            include_alternatives: true,
            include_decisions: true,
        }
    }
}
