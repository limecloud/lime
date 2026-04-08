//! 蓝图系统类型定义
//!
//!
//! 核心概念：
//! - Blueprint（蓝图）：需求调研后形成的目标业务流程、功能边界和系统架构草图
//! - TaskTree（任务树）：由蓝图推导出的层级化任务结构
//! - TDD Loop：每个 Agent 都在 任务→测试→编码→验证 的循环中
//! - Checkpoint（检查点）：支持时光倒流的快照系统

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// 蓝图相关类型
// ============================================================================

/// 蓝图状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BlueprintStatus {
    /// 草稿：正在与用户对话完善中
    #[default]
    Draft,
    /// 审核：等待用户确认签字
    Review,
    /// 已批准：用户已签字确认，可以开始执行
    Approved,
    /// 执行中：任务树正在执行
    Executing,
    /// 已完成：所有任务都已完成
    Completed,
    /// 已暂停：用户暂停了执行
    Paused,
    /// 已修改：执行中用户修改了蓝图，需要重新规划
    Modified,
}

/// 蓝图来源
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlueprintSource {
    /// 需求生成
    Requirement,
    /// 代码逆向生成
    Codebase,
}

/// 业务流程类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProcessType {
    /// 现状
    AsIs,
    /// 目标
    ToBe,
}

/// 流程步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessStep {
    pub id: String,
    pub order: u32,
    pub name: String,
    pub description: String,
    /// 执行角色
    pub actor: String,
    /// 系统动作
    pub system_action: Option<String>,
    /// 用户动作
    pub user_action: Option<String>,
    /// 前置条件
    pub conditions: Vec<String>,
    /// 产出
    pub outcomes: Vec<String>,
}

/// 业务流程定义（As-Is/To-Be）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessProcess {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub process_type: ProcessType,
    pub steps: Vec<ProcessStep>,
    /// 参与角色
    pub actors: Vec<String>,
    /// 输入
    pub inputs: Vec<String>,
    /// 输出
    pub outputs: Vec<String>,
}

/// 模块类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleType {
    Frontend,
    Backend,
    Database,
    Service,
    Infrastructure,
    Other,
}

/// 接口方向
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceDirection {
    In,
    Out,
    Both,
}

/// 接口类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceType {
    Api,
    Event,
    Message,
    File,
    Other,
}

/// 模块接口
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInterface {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub interface_type: InterfaceType,
    pub direction: InterfaceDirection,
    pub description: String,
    /// 接口契约
    pub schema: Option<serde_json::Value>,
}

/// 系统模块定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemModule {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub module_type: ModuleType,
    /// 职责
    pub responsibilities: Vec<String>,
    /// 依赖的其他模块 ID
    pub dependencies: Vec<String>,
    /// 对外接口
    pub interfaces: Vec<ModuleInterface>,
    /// 技术栈
    pub tech_stack: Option<Vec<String>>,
    /// 模块根目录路径
    pub root_path: Option<String>,
}

/// NFR 类别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NfrCategory {
    Performance,
    Security,
    Scalability,
    Availability,
    Maintainability,
    Usability,
    Other,
}

/// MoSCoW 优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoscowPriority {
    Must,
    Should,
    Could,
    Wont,
}

/// 非功能性要求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonFunctionalRequirement {
    pub id: String,
    pub category: NfrCategory,
    pub name: String,
    pub description: String,
    /// 量化指标
    pub metric: Option<String>,
    pub priority: MoscowPriority,
}

/// 变更类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeType {
    Create,
    Update,
    Approve,
    Reject,
    Pause,
    Resume,
}

/// 变更作者
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeAuthor {
    User,
    Agent,
}

/// 蓝图变更记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintChange {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "type")]
    pub change_type: ChangeType,
    pub description: String,
    pub previous_version: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub author: ChangeAuthor,
}

/// 项目蓝图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blueprint {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub status: BlueprintStatus,

    // 核心内容
    pub business_processes: Vec<BusinessProcess>,
    pub modules: Vec<SystemModule>,
    pub nfrs: Vec<NonFunctionalRequirement>,

    // 元数据
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub approved_at: Option<DateTime<Utc>>,
    pub approved_by: Option<String>,

    // 变更历史
    pub change_history: Vec<BlueprintChange>,

    // 关联的任务树
    pub task_tree_id: Option<String>,

    // 蓝图来源
    pub source: Option<BlueprintSource>,
}

impl Blueprint {
    /// 创建新蓝图
    pub fn new(name: String, description: String) -> Self {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();

        Self {
            id: id.clone(),
            name: name.clone(),
            description,
            version: "1.0.0".to_string(),
            status: BlueprintStatus::Draft,
            business_processes: Vec::new(),
            modules: Vec::new(),
            nfrs: Vec::new(),
            created_at: now,
            updated_at: now,
            approved_at: None,
            approved_by: None,
            change_history: vec![BlueprintChange {
                id: Uuid::new_v4().to_string(),
                timestamp: now,
                change_type: ChangeType::Create,
                description: format!("蓝图创建：{}", name),
                previous_version: None,
                changes: None,
                author: ChangeAuthor::Agent,
            }],
            task_tree_id: None,
            source: None,
        }
    }
}

// ============================================================================
// 任务树相关类型
// ============================================================================

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// 等待中：还未开始
    #[default]
    Pending,
    /// 阻塞：等待依赖任务完成
    Blocked,
    /// 编写测试：Agent 正在编写测试代码
    TestWriting,
    /// 编码中：Agent 正在编写实现代码
    Coding,
    /// 测试中：正在运行测试
    Testing,
    /// 测试失败：需要修复
    TestFailed,
    /// 已通过：测试通过
    Passed,
    /// 待审核：等待人类审核
    Review,
    /// 已批准：人类审核通过
    Approved,
    /// 被拒绝：人类审核不通过
    Rejected,
    /// 已取消
    Cancelled,
}

/// 测试类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestType {
    Unit,
    Integration,
    E2e,
    Manual,
}

/// 测试结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub passed: bool,
    /// 执行时长（毫秒）
    pub duration: u64,
    /// 测试输出
    pub output: String,
    /// 错误信息
    pub error_message: Option<String>,
    /// 代码覆盖率
    pub coverage: Option<f64>,
    pub details: Option<serde_json::Value>,
}

/// 测试规格
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSpec {
    pub id: String,
    pub task_id: String,
    #[serde(rename = "type")]
    pub test_type: TestType,
    pub description: String,

    /// 测试代码内容
    pub test_code: Option<String>,
    /// 测试文件路径
    pub test_file_path: Option<String>,
    /// 执行测试的命令
    pub test_command: Option<String>,

    /// 验收标准
    pub acceptance_criteria: Vec<String>,

    /// 执行结果
    pub last_result: Option<TestResult>,
    pub run_history: Vec<TestResult>,
}

/// 验收标准检查类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceCheckType {
    Output,
    Behavior,
    Performance,
    ErrorHandling,
}

/// 验收标准项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub description: String,
    pub check_type: AcceptanceCheckType,
    pub expected_result: String,
    pub passed: Option<bool>,
}

/// 验收测试（由主 Agent 生成，子 Agent 不能修改）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptanceTest {
    pub id: String,
    pub task_id: String,

    /// 测试名称
    pub name: String,
    /// 测试描述
    pub description: String,
    /// 测试代码
    pub test_code: String,
    /// 测试文件路径
    pub test_file_path: String,
    /// 执行命令
    pub test_command: String,

    /// 验收标准（必须全部满足）
    pub criteria: Vec<AcceptanceCriterion>,

    /// 生成信息
    pub generated_by: String,
    pub generated_at: DateTime<Utc>,

    /// 执行结果
    pub last_result: Option<TestResult>,
    pub run_history: Vec<TestResult>,
}

/// 代码产出物类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactType {
    File,
    Patch,
    Command,
}

/// 代码产出物
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeArtifact {
    pub id: String,
    #[serde(rename = "type")]
    pub artifact_type: ArtifactType,
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub command: Option<String>,
    pub created_at: DateTime<Utc>,
    pub checkpoint_id: Option<String>,
}

/// 代码快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSnapshot {
    pub file_path: String,
    pub content: String,
    /// 内容哈希
    pub hash: String,
}

/// 检查点（用于时光倒流）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub task_id: String,
    pub timestamp: DateTime<Utc>,
    pub name: String,
    pub description: Option<String>,

    /// 状态快照
    pub task_status: TaskStatus,
    pub test_result: Option<TestResult>,

    /// 代码快照
    pub code_snapshot: Vec<CodeSnapshot>,

    /// 可以回滚到此检查点
    pub can_restore: bool,

    pub metadata: Option<serde_json::Value>,
}

/// 任务节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    /// 父任务 ID（根任务没有）
    pub parent_id: Option<String>,
    /// 关联的蓝图模块 ID
    pub blueprint_module_id: Option<String>,

    // 基本信息
    pub name: String,
    pub description: String,
    /// 优先级（越大越高）
    pub priority: i32,
    /// 在树中的深度（根节点为 0）
    pub depth: u32,

    // 状态
    pub status: TaskStatus,

    // 子任务
    pub children: Vec<TaskNode>,

    /// 依赖关系（同级任务间的依赖）
    pub dependencies: Vec<String>,

    // TDD 相关
    /// 测试规格（Worker Agent 的单元测试）
    pub test_spec: Option<TestSpec>,
    /// 验收测试（由 Queen Agent 生成，Worker 不能修改）
    pub acceptance_tests: Vec<AcceptanceTest>,

    /// 执行该任务的 Agent ID
    pub agent_id: Option<String>,
    /// 分配的模型
    pub assigned_model: Option<String>,

    /// 代码产出
    pub code_artifacts: Vec<CodeArtifact>,

    // 时间线
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,

    // 重试信息
    pub retry_count: u32,
    pub max_retries: u32,

    /// 检查点（用于时光倒流）
    pub checkpoints: Vec<Checkpoint>,

    pub metadata: Option<serde_json::Value>,
}

impl TaskNode {
    /// 创建新任务节点
    pub fn new(name: String, description: String, depth: u32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            parent_id: None,
            blueprint_module_id: None,
            name,
            description,
            priority: 50,
            depth,
            status: TaskStatus::Pending,
            children: Vec::new(),
            dependencies: Vec::new(),
            test_spec: None,
            acceptance_tests: Vec::new(),
            agent_id: None,
            assigned_model: None,
            code_artifacts: Vec::new(),
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            retry_count: 0,
            max_retries: 3,
            checkpoints: Vec::new(),
            metadata: None,
        }
    }
}

/// 文件变更类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeType {
    Create,
    Modify,
    Delete,
}

/// 文件变更
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub file_path: String,
    #[serde(rename = "type")]
    pub change_type: FileChangeType,
    pub previous_content: Option<String>,
    pub new_content: Option<String>,
}

/// 全局检查点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalCheckpoint {
    pub id: String,
    pub tree_id: String,
    pub timestamp: DateTime<Utc>,
    pub name: String,
    pub description: Option<String>,

    /// 整棵树的状态快照（JSON 序列化）
    pub tree_snapshot: String,

    /// 文件系统快照（差异形式）
    pub file_changes: Vec<FileChange>,

    pub can_restore: bool,
}

/// 任务树统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskTreeStats {
    pub total_tasks: u32,
    pub pending_tasks: u32,
    pub running_tasks: u32,
    pub passed_tasks: u32,
    pub failed_tasks: u32,
    pub blocked_tasks: u32,

    pub total_tests: u32,
    pub passed_tests: u32,
    pub failed_tests: u32,

    pub max_depth: u32,
    pub avg_depth: f64,

    pub estimated_completion: Option<DateTime<Utc>>,
    pub progress_percentage: f64,
}

/// 任务树状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskTreeStatus {
    #[default]
    Pending,
    Executing,
    Paused,
    Completed,
    Failed,
}

/// 任务树
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTree {
    pub id: String,
    pub blueprint_id: String,

    /// 根节点
    pub root: TaskNode,

    /// 统计信息
    pub stats: TaskTreeStats,

    /// 执行状态
    pub status: TaskTreeStatus,

    // 时间线
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,

    /// 全局检查点（整棵树的快照）
    pub global_checkpoints: Vec<GlobalCheckpoint>,
}

impl TaskTree {
    /// 创建新任务树
    pub fn new(blueprint_id: String, root: TaskNode) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            blueprint_id,
            root,
            stats: TaskTreeStats::default(),
            status: TaskTreeStatus::Pending,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            global_checkpoints: Vec::new(),
        }
    }
}

// ============================================================================
// Agent 协调相关类型
// ============================================================================

/// 蜂王状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueenStatus {
    Idle,
    Planning,
    Coordinating,
    Reviewing,
    Paused,
}

/// Agent 决策类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionType {
    TaskAssignment,
    Retry,
    Escalate,
    ModifyPlan,
    Checkpoint,
    Rollback,
}

/// Agent 决策
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDecision {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "type")]
    pub decision_type: DecisionType,
    pub description: String,
    pub reasoning: String,
    pub result: Option<String>,
}

/// Agent 动作类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionType {
    Read,
    Write,
    Edit,
    Test,
    Think,
    Ask,
    Report,
}

/// Agent 动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAction {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "type")]
    pub action_type: ActionType,
    pub description: String,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    /// 持续时间（毫秒）
    pub duration: u64,
}

/// TDD 循环阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TddPhase {
    #[default]
    WriteTest,
    RunTestRed,
    WriteCode,
    RunTestGreen,
    Refactor,
    Done,
}

/// TDD 循环状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TddCycleState {
    pub phase: TddPhase,
    /// 当前迭代次数
    pub iteration: u32,
    /// 最大迭代次数
    pub max_iterations: u32,
    pub test_written: bool,
    pub test_passed: bool,
    pub code_written: bool,
}

impl Default for TddCycleState {
    fn default() -> Self {
        Self {
            phase: TddPhase::WriteTest,
            iteration: 0,
            max_iterations: 10,
            test_written: false,
            test_passed: false,
            code_written: false,
        }
    }
}

/// Worker 状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatus {
    Idle,
    TestWriting,
    Coding,
    Testing,
    Waiting,
}

/// 子 Agent（蜜蜂）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerAgent {
    pub id: String,
    pub queen_id: String,
    /// 当前处理的任务
    pub task_id: String,

    pub status: WorkerStatus,

    /// TDD 循环状态
    pub tdd_cycle: TddCycleState,

    /// 执行历史
    pub history: Vec<AgentAction>,
}

/// 主 Agent（蜂王）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueenAgent {
    pub id: String,
    pub blueprint_id: String,
    pub task_tree_id: String,

    pub status: QueenStatus,

    /// 管理的子 Agent
    pub worker_agents: Vec<WorkerAgent>,

    /// 全局视野
    pub global_context: String,

    /// 决策历史
    pub decisions: Vec<AgentDecision>,
}

// ============================================================================
// 可视化相关类型
// ============================================================================

/// 时间线事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineEventType {
    TaskStart,
    TaskComplete,
    TestPass,
    TestFail,
    Checkpoint,
    Rollback,
    UserAction,
}

/// 时间线事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "type")]
    pub event_type: TimelineEventType,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub description: String,
    pub data: Option<serde_json::Value>,
}

/// 树可视化节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeViewNode {
    pub id: String,
    pub label: String,
    pub status: TaskStatus,
    /// 0-100
    pub progress: u8,
    pub children: Vec<TreeViewNode>,
    pub depth: u32,
    pub is_expanded: bool,
    pub has_checkpoint: bool,
    pub agent_status: Option<String>,
}

/// 仪表板数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintDashboard {
    pub blueprint: Blueprint,
    pub task_tree: TaskTree,
    pub queen: QueenAgent,
    pub workers: Vec<WorkerAgent>,
    pub timeline: Vec<TimelineEvent>,
    pub stats: TaskTreeStats,
}

// ============================================================================
// 验证相关类型
// ============================================================================

/// 验证结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    /// 是否有效
    pub valid: bool,
    /// 错误列表
    pub errors: Vec<String>,
}

impl ValidationResult {
    /// 创建成功的验证结果
    pub fn success() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
        }
    }

    /// 创建失败的验证结果
    pub fn failure(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
        }
    }
}
