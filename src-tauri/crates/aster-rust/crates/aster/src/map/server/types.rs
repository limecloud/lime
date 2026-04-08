//! 可视化服务器类型定义
//!

use serde::{Deserialize, Serialize};

// ============================================================================
// 模块详情接口 - 用于下钻展示
// ============================================================================

/// 模块详情信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDetailInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub language: String,
    pub lines: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<serde_json::Value>,
    /// 文件内的符号分组
    pub symbols: ModuleSymbols,
    /// 导入的外部依赖
    pub external_imports: Vec<String>,
    /// 导入的内部模块
    pub internal_imports: Vec<String>,
}

/// 模块符号分组
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModuleSymbols {
    pub classes: Vec<SymbolInfo>,
    pub interfaces: Vec<SymbolInfo>,
    pub functions: Vec<SymbolInfo>,
    pub types: Vec<SymbolInfo>,
    pub variables: Vec<SymbolInfo>,
    pub constants: Vec<SymbolInfo>,
    /// re-export 的符号
    pub exports: Vec<SymbolInfo>,
}

/// 符号信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<serde_json::Value>,
    pub location: SymbolLocation,
    /// 子符号（如类的方法）
    pub children: Vec<SymbolInfo>,
}

/// 符号位置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolLocation {
    pub start_line: usize,
    pub end_line: usize,
}

// ============================================================================
// 符号引用接口 - 展示调用关系
// ============================================================================

/// 符号引用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRefInfo {
    pub symbol_id: String,
    pub symbol_name: String,
    pub symbol_kind: String,
    pub module_id: String,
    /// 被谁调用
    pub called_by: Vec<CallerInfo>,
    /// 调用了谁
    pub calls: Vec<CalleeInfo>,
    /// 类型引用（extends/implements）
    pub type_refs: Vec<TypeRefInfo>,
}

/// 调用者信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallerInfo {
    pub symbol_id: String,
    pub symbol_name: String,
    pub module_id: String,
    pub call_type: String,
    pub locations: Vec<LineLocation>,
}

/// 被调用者信息
pub type CalleeInfo = CallerInfo;

/// 行位置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineLocation {
    pub line: usize,
}

/// 类型引用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeRefInfo {
    pub related_symbol_id: String,
    pub related_symbol_name: String,
    /// extends 或 implements
    pub kind: String,
    /// parent 或 child
    pub direction: String,
}

// ============================================================================
// 入口点检测和依赖树构建
// ============================================================================

/// 依赖树节点
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<serde_json::Value>,
    pub children: Vec<DependencyTreeNode>,
    pub depth: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_circular: Option<bool>,
}

// ============================================================================
// 逻辑架构图 - 按目录/功能聚合模块
// ============================================================================

/// 逻辑块类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogicBlockType {
    Entry,
    Core,
    Feature,
    #[default]
    Util,
    Ui,
    Data,
    Config,
}

/// 逻辑块
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicBlock {
    pub id: String,
    /// 简短名称
    pub name: String,
    /// 语义描述（做什么）
    pub description: String,
    #[serde(rename = "type")]
    pub block_type: LogicBlockType,
    /// 包含的文件 ID
    pub files: Vec<String>,
    pub file_count: usize,
    pub total_lines: usize,
    /// 子逻辑块
    pub children: Vec<LogicBlock>,
    /// 依赖的其他逻辑块 ID
    pub dependencies: Vec<String>,
}

/// 架构图
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureMap {
    pub project_name: String,
    pub project_description: String,
    pub blocks: Vec<LogicBlock>,
}

// ============================================================================
// 流程图数据结构
// ============================================================================

/// 流程图节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowchartNodeType {
    Entry,
    Process,
    Decision,
    Io,
    End,
}

/// 流程图节点
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowchartNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: FlowchartNodeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
}

/// 流程图边类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowchartEdgeType {
    #[default]
    Normal,
    Yes,
    No,
    Error,
}

/// 流程图边
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowchartEdge {
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub edge_type: Option<FlowchartEdgeType>,
}

/// 流程图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Flowchart {
    pub title: String,
    pub description: String,
    pub nodes: Vec<FlowchartNode>,
    pub edges: Vec<FlowchartEdge>,
}

/// 场景信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_points: Vec<String>,
    pub related_modules: Vec<String>,
}

// ============================================================================
// 新手导览数据结构
// ============================================================================

/// 文件重要性
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileImportance {
    Critical,
    Important,
    Normal,
}

/// 导览卡片文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuideCardFile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub importance: FileImportance,
}

/// 导览卡片
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideCard {
    pub id: String,
    pub group_id: String,
    pub icon: String,
    pub title: String,
    pub description: String,
    pub explain: String,
    pub analogy: String,
    pub badge: String,
    pub files: Vec<GuideCardFile>,
}

/// 新手导览
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginnerGuide {
    pub project_name: String,
    pub project_description: String,
    pub total_files: usize,
    pub total_lines: usize,
    pub main_languages: Vec<String>,
    pub cards: Vec<GuideCard>,
}

// ============================================================================
// 业务故事视图
// ============================================================================

/// 故事章节关键文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryKeyFile {
    pub id: String,
    pub name: String,
    pub role: String,
}

/// 代码片段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnippet {
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
    pub explanation: String,
}

/// 故事章节
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryChapter {
    pub id: String,
    pub title: String,
    pub narrative: String,
    pub key_files: Vec<StoryKeyFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_snippet: Option<CodeSnippet>,
}

/// 业务故事
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessStory {
    pub id: String,
    pub title: String,
    pub description: String,
    pub protagonist: String,
    pub chapters: Vec<StoryChapter>,
}

/// 故事导览
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryGuide {
    pub project_type: String,
    pub main_story: BusinessStory,
    pub sub_stories: Vec<BusinessStory>,
}

// ============================================================================
// 代码阅读引擎
// ============================================================================

/// 阅读难度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadingDifficulty {
    Beginner,
    Intermediate,
    Advanced,
}

/// 阅读步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStep {
    pub id: String,
    pub title: String,
    pub description: String,
    pub file_id: String,
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_lines: Option<LineRange>,
    pub key_points: Vec<String>,
    pub next_steps: Vec<String>,
}

/// 行范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
}

/// 阅读路径
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingPath {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<ReadingStep>,
}

/// 代码阅读导览
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReadingGuide {
    pub title: String,
    pub description: String,
    pub estimated_time: String,
    pub difficulty: ReadingDifficulty,
    pub paths: Vec<ReadingPath>,
}

// ============================================================================
// 知识快照
// ============================================================================

/// 知识快照摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSnapshotSummary {
    pub total_modules: usize,
    pub total_symbols: usize,
    pub total_dependencies: usize,
    pub entry_points: Vec<String>,
    pub main_patterns: Vec<String>,
}

/// 知识快照
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSnapshot {
    pub version: String,
    pub timestamp: u64,
    pub project_hash: String,
    pub summary: KnowledgeSnapshotSummary,
}

// ============================================================================
// API 响应类型
// ============================================================================

/// 入口点响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPointsResponse {
    pub entry_points: Vec<String>,
}

/// 搜索结果项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    #[serde(rename = "type")]
    pub result_type: String,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 搜索响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResultItem>,
}
